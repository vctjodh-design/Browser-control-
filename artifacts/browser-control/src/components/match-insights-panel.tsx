import type { ReactNode } from 'react';
import type {
  FootballMatchDetails,
  FootballMatchLastFive,
  FootballMatchTmpContext,
  FootballRecentMatch,
} from '@workspace/api-client-react';
import { AlertCircle, ArrowDownRight, BarChart3, RefreshCw, Sigma } from 'lucide-react';
import { BookmakerComparisonPanel } from '@/components/bookmaker-comparison-panel';
import { buildMatchupAnalysis } from '@/lib/matchup-analysis';
import type { OddsModelInput } from '@/lib/odds-edge-analysis';

type OutcomeRates = { wins: number; draws: number; losses: number; count: number };
type TeamFormStats = OutcomeRates & {
  scored: number;
  conceded: number;
  goalsForAverage: number;
  goalsAgainstAverage: number;
  overallTmp: number;
  scoringTmp: number;
  concedingTmp: number;
};

function completed(games: FootballRecentMatch[]) {
  return games.filter((game) => Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore));
}

function perspective(game: FootballRecentMatch, teamId: number) {
  if (game.homeScore === null || game.awayScore === null) return null;
  const home = game.homeTeam.id === teamId;
  const scored = home ? game.homeScore : game.awayScore;
  const conceded = home ? game.awayScore : game.homeScore;
  return {
    scored,
    conceded,
    goalDifference: scored - conceded,
    outcome: scored > conceded ? 'W' as const : scored < conceded ? 'L' as const : 'D' as const,
  };
}

function formStats(games: FootballRecentMatch[], teamId: number): TeamFormStats | null {
  const rows = completed(games).slice(0, 15).map((game) => perspective(game, teamId)).filter((row): row is NonNullable<typeof row> => row !== null);
  if (!rows.length) return null;
  const wins = rows.filter((row) => row.outcome === 'W').length;
  const draws = rows.filter((row) => row.outcome === 'D').length;
  const losses = rows.filter((row) => row.outcome === 'L').length;
  const scored = rows.reduce((sum, row) => sum + row.scored, 0);
  const conceded = rows.reduce((sum, row) => sum + row.conceded, 0);
  const goalsForAverage = scored / rows.length;
  const goalsAgainstAverage = conceded / rows.length;
  return {
    wins, draws, losses, count: rows.length, scored, conceded, goalsForAverage, goalsAgainstAverage,
    overallTmp: 100 + 18 * wins + 8 * draws - 6 * losses + 4 * (scored - conceded),
    scoringTmp: 100 + 4 * goalsForAverage,
    concedingTmp: 100 - 4 * goalsAgainstAverage,
  };
}

function rates(stats: OutcomeRates) {
  return [stats.wins / stats.count, stats.draws / stats.count, stats.losses / stats.count];
}

function normalize(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? values.map((value) => value / total) : values.map(() => 0);
}

function poissonBuckets(lambda: number) {
  const values: number[] = [Math.exp(-lambda)];
  for (let goals = 1; goals < 10; goals += 1) values.push(values[goals - 1] * lambda / goals);
  values.push(Math.max(0, 1 - values.reduce((sum, value) => sum + value, 0)));
  return values;
}

function scoreMatrix(homeLambda: number, awayLambda: number) {
  const home = poissonBuckets(homeLambda);
  const away = poissonBuckets(awayLambda);
  return home.map((homeProbability, homeGoals) => away.map((awayProbability, awayGoals) => ({
    homeGoals, awayGoals, probability: homeProbability * awayProbability,
  })));
}

function scoreMarkets(matrix: ReturnType<typeof scoreMatrix>) {
  let home = 0;
  let draw = 0;
  let away = 0;
  let bttsYes = 0;
  let over25 = 0;
  let over35 = 0;
  matrix.forEach((row) => row.forEach((cell) => {
    const { homeGoals, awayGoals, probability } = cell;
    if (homeGoals > awayGoals) home += probability;
    else if (homeGoals < awayGoals) away += probability;
    else draw += probability;
    if (homeGoals > 0 && awayGoals > 0) bttsYes += probability;
    const totalGoals = homeGoals === 10 || awayGoals === 10 ? 10 : homeGoals + awayGoals;
    if (totalGoals > 2.5) over25 += probability;
    if (totalGoals > 3.5) over35 += probability;
  }));
  return {
    result: normalize([home, draw, away]),
    btts: [bttsYes, 1 - bttsYes],
    total25: [over25, 1 - over25],
    total35: [over35, 1 - over35],
  };
}

function h2hStats(games: FootballRecentMatch[], homeId: number, awayId: number) {
  const rows = completed(games).slice(0, 8).map((game) => ({
    home: perspective(game, homeId),
    away: perspective(game, awayId),
  })).filter((row): row is { home: NonNullable<ReturnType<typeof perspective>>; away: NonNullable<ReturnType<typeof perspective>> } => !!row.home && !!row.away);
  const homeWins = rows.filter((row) => row.home.outcome === 'W').length;
  const draws = rows.filter((row) => row.home.outcome === 'D').length;
  const awayWins = rows.filter((row) => row.home.outcome === 'L').length;
  return {
    rows,
    rates: rows.length >= 3 ? [homeWins / rows.length, draws / rows.length, awayWins / rows.length] : null,
    homeGoals: rows.length ? rows.reduce((sum, row) => sum + row.home.scored, 0) / rows.length : null,
    awayGoals: rows.length ? rows.reduce((sum, row) => sum + row.away.scored, 0) / rows.length : null,
    homeWins, draws, awayWins,
  };
}

function historicalOddsTmp(
  games: FootballRecentMatch[],
  teamId: number,
  context?: FootballMatchTmpContext,
) {
  const odds = context?.oddsHistory ?? [];
  const gameById = new Map(games.map((game) => [game.fixtureId, game]));
  const steps = odds.flatMap((quote) => {
    const game = gameById.get(quote.fixtureId);
    if (!game || game.homeScore === null || game.awayScore === null ||
      quote.homeProbability === null || quote.drawProbability === null || quote.awayProbability === null) return [];
    const normalized = normalize([quote.homeProbability, quote.drawProbability, quote.awayProbability]);
    if (!normalized.some((probability) => probability > 0)) return [];
    const result = perspective(game, teamId);
    if (!result) return [];
    const expected = game.homeTeam.id === teamId ? 3 * normalized[0] + normalized[1] : 3 * normalized[2] + normalized[1];
    return [{
      date: new Date(game.date).getTime(),
      score: 50 + 10 * ((result.outcome === 'W' ? 3 : result.outcome === 'D' ? 1 : 0) - expected) + 8 * result.goalDifference,
      verifiedBookmakers: quote.verifiedBookmakerCount,
      unverifiedBookmakers: quote.unverifiedBookmakerCount,
    }];
  }).sort((a, b) => a.date - b.date);
  let rolling = 0;
  steps.forEach((step, index) => {
    rolling = index === 0 ? step.score : 0.6 * rolling + 0.4 * step.score;
  });
  return {
    score: steps.length ? rolling : null,
    count: steps.length,
    available: completed(games).slice(0, 15).length,
    verifiedBookmakers: steps.reduce((total, step) => total + step.verifiedBookmakers, 0),
    unverifiedBookmakers: steps.reduce((total, step) => total + step.unverifiedBookmakers, 0),
  };
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function CoverageBadge({ children, testId }: { children: ReactNode; testId: string }) {
  return <span className="mono rounded-md border border-[#dcded3] bg-[#f3f4ed] px-2 py-1 text-[8px] text-[#748078]" data-testid={testId}>{children}</span>;
}

function StatBlock({ label, value, detail, testId }: { label: string; value: string; detail?: string; testId: string }) {
  return <div className="min-w-0 border-l border-[#e4e4da] pl-3 first:border-0 first:pl-0">
    <p className="text-[8px] font-extrabold uppercase tracking-[.11em] text-[#8b9187]">{label}</p>
    <p className="mono mt-1 text-[17px] font-medium tracking-[-.04em] text-[#334b4d]" data-testid={testId}>{value}</p>
    {detail && <p className="mt-1 text-[8px] leading-4 text-[#92958b]">{detail}</p>}
  </div>;
}

function IssueNotice({ message, testId }: { message: string; testId: string }) {
  return <div className="flex items-start gap-2 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2.5 text-[9px] leading-4 text-[#84684f]" role="status" data-testid={testId}>
    <AlertCircle size={13} className="mt-0.5 shrink-0 text-[#bb8755]" />{message}
  </div>;
}

export function MatchInsightsPanel({ details, lastFive, lastFiveLoading, lastFiveError, context, isLoading, isError, error, onRetry }: {
  details: FootballMatchDetails;
  lastFive?: FootballMatchLastFive;
  lastFiveLoading: boolean;
  lastFiveError: boolean;
  context?: FootballMatchTmpContext;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const { match } = details;
  const homeGames = completed(details.homeRecent).slice(0, 15);
  const awayGames = completed(details.awayRecent).slice(0, 15);
  const h2h = h2hStats(details.headToHead, match.home.id, match.away.id);
  const home = formStats(homeGames, match.home.id);
  const away = formStats(awayGames, match.away.id);
  const lastFiveAnalysis = lastFive ? buildMatchupAnalysis(lastFive) : null;
  const currentHomeStanding = details.standings.find((row) => row.teamId === match.home.id);
  const currentAwayStanding = details.standings.find((row) => row.teamId === match.away.id);
  const contextHomeStanding = context?.seasonStandings.find((row) => row.teamId === match.home.id &&
    (match.leagueId === null || row.leagueId === match.leagueId) && (match.season === null || row.season === match.season));
  const contextAwayStanding = context?.seasonStandings.find((row) => row.teamId === match.away.id &&
    (match.leagueId === null || row.leagueId === match.leagueId) && (match.season === null || row.season === match.season));
  const missing: string[] = [];
  if (homeGames.length < 15) missing.push(`${match.home.name} recent form ${homeGames.length}/15 completed`);
  if (awayGames.length < 15) missing.push(`${match.away.name} recent form ${awayGames.length}/15 completed`);
  if (!lastFiveAnalysis) missing.push(lastFiveLoading
    ? 'Last-five xG context is loading'
    : lastFiveError
      ? 'Last-five xG context failed to load'
      : 'Last-five xG context unavailable');
  else if (lastFiveAnalysis.home.sample < 3 || lastFiveAnalysis.away.sample < 3) {
    missing.push('Last-five samples under 3 matches; 15-result rates are used as fallback');
  }
  else if (lastFiveAnalysis.home.expectedGoalsCoverage < 3 || lastFiveAnalysis.away.expectedGoalsCoverage < 3) {
    missing.push('Five-match xG coverage is below 3 observations for one or both teams');
  }
  if (h2h.rows.length < 3) missing.push(`H2H blend unavailable (${h2h.rows.length}/3 minimum; ${h2h.rows.length}/8 used)`);
  if (!details.oddsMarkets.length) missing.push('Current fixture odds not supplied');
  if (!currentHomeStanding || !currentAwayStanding) missing.push('Current competition standings incomplete');
  if (!context) missing.push('Historical odds and latest-season TMP context unavailable');
  else {
    if (!context.oddsHistory.length) missing.push('Historical odds TMP unavailable');
    if (!context.seasonStandings.length) missing.push('TMP-context season standings unavailable');
  }

  const hasCoreData = !!home && !!away;
  const homeFiveUsable = !!lastFiveAnalysis && lastFiveAnalysis.home.sample >= 3;
  const awayFiveUsable = !!lastFiveAnalysis && lastFiveAnalysis.away.sample >= 3;
  const homeAttackRate = homeFiveUsable ? lastFiveAnalysis.home.forecastAttackRate ?? home?.goalsForAverage ?? 0 : home?.goalsForAverage ?? 0;
  const awayDefenseRate = awayFiveUsable ? lastFiveAnalysis.away.forecastDefenseRate ?? away?.goalsAgainstAverage ?? 0 : away?.goalsAgainstAverage ?? 0;
  const awayAttackRate = awayFiveUsable ? lastFiveAnalysis.away.forecastAttackRate ?? away?.goalsForAverage ?? 0 : away?.goalsForAverage ?? 0;
  const homeDefenseRate = homeFiveUsable ? lastFiveAnalysis.home.forecastDefenseRate ?? home?.goalsAgainstAverage ?? 0 : home?.goalsAgainstAverage ?? 0;
  const formHomeLambda = home && away ? (homeAttackRate + awayDefenseRate) / 2 : 0;
  const formAwayLambda = home && away ? (awayAttackRate + homeDefenseRate) / 2 : 0;
  const blended = h2h.rows.length >= 3;
  const homeLambda = blended ? formHomeLambda * 0.8 + (h2h.homeGoals ?? 0) * 0.2 : formHomeLambda;
  const awayLambda = blended ? formAwayLambda * 0.8 + (h2h.awayGoals ?? 0) * 0.2 : formAwayLambda;
  const matrix = scoreMatrix(homeLambda, awayLambda);
  const poisson = scoreMarkets(matrix);
  const recentHomeRates = home ? rates(home) : null;
  const recentAwayRates = away ? rates(away) : null;
  const recentSignal = recentHomeRates && recentAwayRates
    ? normalize([(recentHomeRates[0] + recentAwayRates[2]) / 2, (recentHomeRates[1] + recentAwayRates[1]) / 2, (recentHomeRates[2] + recentAwayRates[0]) / 2])
    : null;
  const resultSignal = recentSignal && h2h.rates
    ? normalize([poisson.result[0] * 0.7 + recentSignal[0] * 0.2 + h2h.rates[0] * 0.1, poisson.result[1] * 0.7 + recentSignal[1] * 0.2 + h2h.rates[1] * 0.1, poisson.result[2] * 0.7 + recentSignal[2] * 0.2 + h2h.rates[2] * 0.1])
    : recentSignal
      ? normalize([poisson.result[0] * (0.7 / 0.9) + recentSignal[0] * (0.2 / 0.9), poisson.result[1] * (0.7 / 0.9) + recentSignal[1] * (0.2 / 0.9), poisson.result[2] * (0.7 / 0.9) + recentSignal[2] * (0.2 / 0.9)])
      : null;
  const topScores = matrix.flat().filter((cell) => cell.homeGoals < 10 && cell.awayGoals < 10)
    .sort((a, b) => b.probability - a.probability).slice(0, 3);
  const homeOddsTmp = historicalOddsTmp(details.homeRecent, match.home.id, context);
  const awayOddsTmp = historicalOddsTmp(details.awayRecent, match.away.id, context);
  const evidenceSufficient = !!home && !!away &&
    home.count >= 8 && away.count >= 8 &&
    !!lastFiveAnalysis &&
    lastFiveAnalysis.home.sample >= 4 && lastFiveAnalysis.away.sample >= 4 &&
    lastFiveAnalysis.home.expectedGoalsCoverage >= 3 &&
    lastFiveAnalysis.away.expectedGoalsCoverage >= 3;
  const evidenceReason = !home || !away || home.count < 8 || away.count < 8
    ? 'At least 8 completed recent results per team are required for an edge screen.'
    : !lastFiveAnalysis
      ? lastFiveLoading
        ? 'Waiting for the last-five xG sample.'
        : 'Last-five xG data is unavailable; no edge will be flagged.'
      : lastFiveAnalysis.home.sample < 4 || lastFiveAnalysis.away.sample < 4
        ? 'At least 4 completed last-five matches per team are required for an edge screen.'
        : 'At least 3 xG observations per team are required for an edge screen.';
  const oddsModel: OddsModelInput = {
    result: hasCoreData ? resultSignal : null,
    btts: hasCoreData ? poisson.btts : null,
    scoreMatrix: hasCoreData ? matrix : [],
    evidenceSufficient,
  };

  return <section className="space-y-5" data-testid="panel-insights">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="mono text-[9px] uppercase tracking-[.17em] text-[#9b7160]">Evidence-led forecast</p>
        <h2 className="mt-1 text-[20px] font-extrabold tracking-[-.05em] text-[#2b3e49]">Price and probability analysis</h2>
        <p className="mt-1 text-[9px] text-[#858982]">{match.home.name} at home · {match.away.name} away</p></div>
      <CoverageBadge testId="insight-sample-coverage">{homeGames.length}/15 · {awayGames.length}/15 · {h2h.rows.length}/8 H2H · {lastFiveAnalysis ? `${lastFiveAnalysis.home.expectedGoalsCoverage}/${lastFiveAnalysis.away.expectedGoalsCoverage} xG` : 'xG pending'}</CoverageBadge>
    </header>

    <div className="grid gap-3 rounded-xl border border-[#d8ded5] bg-[#edf2ec] p-4 sm:grid-cols-[auto_1fr] sm:items-center">
      <span className="grid size-9 place-items-center rounded-lg bg-[#dce8dd] text-[#537867]"><Sigma size={17} /></span>
      <div><p className="text-[9px] font-extrabold text-[#43575a]">Model method · transparent weights</p>
        <p className="mt-1 text-[8px] leading-4 text-[#63766b]" data-testid="insight-model-method">
          The goal-rate forecast uses the last-five sample when a team has at least three completed records: where at least three xG observations are available, attack and defensive rates blend 70% xG with 30% actual goals; otherwise they use goals only. Smaller samples fall back to up to 15 recent scores. Each team’s attack rate is averaged with its opponent’s conceded/xG-against rate. With ≥3 H2H, the resulting rates blend 80% recent form / 20% H2H. The independent Poisson score matrix includes a 10+ tail.
          1X2 = 70% Poisson + 20% recent W/D/L from up to 15 results + 10% H2H W/D/L; without qualifying H2H, available weights are renormalized. Bookmaker prices are a separate benchmark and do not feed into the model.
        </p>
      </div>
    </div>
    <p className="rounded-lg border border-[#e4d7c9] bg-[#faf4ed] px-3.5 py-2.5 text-[9px] leading-4 text-[#806b59]" data-testid="insight-model-disclaimer">
      These are model estimates from the available historical data, not guarantees. They are not a certainty or a promise of an outcome.
    </p>

    {missing.length > 0 && <div className="flex flex-wrap gap-2" data-testid="insight-input-gaps">
      {missing.map((item) => <CoverageBadge key={item} testId={`insight-gap-${item.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{item}</CoverageBadge>)}
    </div>}
    <BookmakerComparisonPanel
      markets={details.oddsMarkets}
      homeName={match.home.name}
      awayName={match.away.name}
      model={oddsModel}
      evidenceReason={evidenceReason}
    />
    {isLoading && <div className="space-y-3" role="status" aria-label="Loading additional forecast context" data-testid="insight-context-loading">
      <div className="h-16 animate-pulse rounded-xl bg-[#eeede6]" /><div className="grid gap-3 sm:grid-cols-2"><div className="h-28 animate-pulse rounded-xl bg-[#eeede6]" /><div className="h-28 animate-pulse rounded-xl bg-[#eeede6]" /></div>
    </div>}
    {isError && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-4 py-3 text-[9px] text-[#8c6b5e]" role="alert" data-testid="insight-context-error">
      <span>{error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Historical odds and latest-season context could not be loaded. Forecasts use available match results only.'}</span>
      <button type="button" onClick={onRetry} className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-3 text-[8px] font-extrabold text-[#855542] hover:bg-white" data-testid="button-retry-insight-context"><RefreshCw size={11} /> Retry context</button>
    </div>}

    {!hasCoreData ? <div className="flex min-h-[170px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-6 py-9 text-center" data-testid="insight-predictions-unavailable">
      <span className="grid size-10 place-items-center rounded-xl bg-[#e9eee8] text-[#708679]"><BarChart3 size={17} /></span>
      <h3 className="mt-3 text-[12px] font-extrabold text-[#3c5058]">Predictions unavailable</h3>
      <p className="mt-1.5 max-w-md text-[9px] leading-5 text-[#858982]">At least one team has no completed recent scores. The model will not infer a forecast without both core samples.</p>
    </div> : <>
      <section className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" aria-label="Forecast probabilities">
        <div className="flex items-center justify-between gap-2 border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3"><h3 className="text-[10px] font-extrabold text-[#43575a]">Estimated outcomes</h3><span className="mono text-[8px] text-[#898d84]">Probability · model output</span></div>
        <div className="divide-y divide-[#e9e7df]">
          <div className="grid gap-2 p-3.5 sm:grid-cols-[115px_1fr] sm:items-center">
            <p className="text-[9px] font-extrabold text-[#536763]">1X2 <span className="block mt-1 font-normal text-[#92958b]">Weighted signals</span></p>
            <div className="grid grid-cols-3 gap-2">{[match.home.name, 'Draw', match.away.name].map((label, i) => <div key={label} className={`rounded-lg border px-3 py-2.5 ${resultSignal && i === resultSignal.indexOf(Math.max(...resultSignal)) ? 'border-[#b9ccbd] bg-[#edf3ed]' : 'border-[#e7e5dc] bg-[#f8f7f1]'}`} data-testid={`insight-1x2-${['home', 'draw', 'away'][i]}`}>
              <span className="block truncate text-[8px] font-bold text-[#828a81]">{label}</span><span className="mono mt-1 block text-[17px] font-medium text-[#3e6455]">{pct(resultSignal?.[i] ?? 0)}</span></div>)}</div>
          </div>
          {[
            { name: 'BTTS', left: 'Yes', right: 'No', values: poisson.btts, id: 'btts' },
            { name: 'Goals · 2.5', left: 'Over', right: 'Under', values: poisson.total25, id: 'total-25' },
            { name: 'Goals · 3.5', left: 'Over', right: 'Under', values: poisson.total35, id: 'total-35' },
          ].map((market) => <div key={market.id} className="grid gap-2 p-3.5 sm:grid-cols-[115px_1fr] sm:items-center">
            <p className="text-[9px] font-extrabold text-[#536763]">{market.name}<span className="block mt-1 font-normal text-[#92958b]">Poisson matrix</span></p>
            <div className="grid grid-cols-2 gap-2">{[market.left, market.right].map((label, i) => <div key={label} className="flex items-center justify-between rounded-lg border border-[#e7e5dc] bg-[#f8f7f1] px-3 py-2.5" data-testid={`insight-${market.id}-${i === 0 ? 'yes-over' : 'no-under'}`}>
              <span className="text-[8px] font-bold text-[#828a81]">{label}</span><span className="mono text-[15px] font-medium text-[#3e6455]">{pct(market.values[i])}</span></div>)}</div>
          </div>)}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" data-testid="insight-correct-scores">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3">
          <div><h3 className="text-[10px] font-extrabold text-[#43575a]">Correct-score probabilities</h3><p className="mt-1 text-[8px] text-[#898d84]">Most likely model outcomes, not recommended selections</p></div>
          <span className="mono text-[8px] text-[#898d84]">Top 3 estimates</span>
        </div>
        {topScores.map((score, index) => <div key={`${score.homeGoals}-${score.awayGoals}`} className="grid grid-cols-[30px_1fr_auto] items-center gap-3 border-b border-[#e9e7df] px-4 py-3 last:border-0" data-testid={`insight-correct-score-${index + 1}`}>
          <span className="mono text-[8px] text-[#9b7160]">0{index + 1}</span><span className="mono text-[14px] font-medium text-[#43575a]">{score.homeGoals} – {score.awayGoals}</span><span className="mono text-[11px] text-[#537867]">{pct(score.probability)}</span>
        </div>)}
      </section>

      <section className="space-y-3" data-testid="insight-context-evidence">
        <div className="flex items-end justify-between gap-3"><div><p className="mono text-[8px] uppercase tracking-[.14em] text-[#9b7160]">Supporting context</p><h3 className="mt-1 text-[13px] font-extrabold text-[#43575a]">What informs the read</h3></div><p className="max-w-[400px] text-right text-[8px] leading-4 text-[#858982]">TMP transforms are displayed as context. Goal averages already feed expected goals and are not counted again.</p></div>
        <div className="grid gap-3 lg:grid-cols-2">
          {[{ label: match.home.name, stats: home, oddsTmp: homeOddsTmp, teamId: match.home.id }, { label: match.away.name, stats: away, oddsTmp: awayOddsTmp, teamId: match.away.id }].map((team) => <article key={team.teamId} className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" data-testid={`insight-team-context-${team.teamId}`}>
            <div className="flex items-center justify-between border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3"><h4 className="truncate text-[10px] font-extrabold text-[#43575a]">{team.label}</h4><CoverageBadge testId={`insight-team-sample-${team.teamId}`}>{team.stats?.count ?? 0} / 15 completed</CoverageBadge></div>
            <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
              <StatBlock label="W · D · L" value={team.stats ? `${team.stats.wins} · ${team.stats.draws} · ${team.stats.losses}` : '—'} testId={`insight-team-wdl-${team.teamId}`} />
              <StatBlock label="Overall TMP" value={team.stats ? team.stats.overallTmp.toFixed(0) : '—'} detail="100 + 18W + 8D − 6L + 4(GF−GA)" testId={`insight-team-overall-tmp-${team.teamId}`} />
              <StatBlock label="Scoring TMP" value={team.stats ? team.stats.scoringTmp.toFixed(1) : '—'} detail={`GF avg ${team.stats?.goalsForAverage.toFixed(2) ?? '—'}`} testId={`insight-team-scoring-tmp-${team.teamId}`} />
              <StatBlock label="Conceding TMP" value={team.stats ? team.stats.concedingTmp.toFixed(1) : '—'} detail={`GA avg ${team.stats?.goalsAgainstAverage.toFixed(2) ?? '—'}`} testId={`insight-team-conceding-tmp-${team.teamId}`} />
            </div>
            <div className="grid grid-cols-2 border-t border-[#e9e7df] bg-[#f8f7f1] px-4 py-3">
              <StatBlock label="Historical odds TMP" value={team.oddsTmp.score === null ? 'Unavailable' : team.oddsTmp.score.toFixed(1)} detail={`${team.oddsTmp.count} / ${team.oddsTmp.available} usable · ${team.oddsTmp.verifiedBookmakers} verified / ${team.oddsTmp.unverifiedBookmakers} untimestamped books`} testId={`insight-team-odds-tmp-${team.teamId}`} />
              <StatBlock label="Quote coverage" value={`${team.oddsTmp.count} / ${team.oddsTmp.available}`} detail="Expected points from normalized 1X2 probabilities" testId={`insight-team-odds-coverage-${team.teamId}`} />
            </div>
          </article>)}
        </div>
        <p className="rounded-lg border border-[#e6e4dc] bg-[#f7f6f0] px-3.5 py-2.5 text-[8px] leading-4 text-[#858982]" data-testid="insight-odds-tmp-method">Historical odds TMP: normalize historical 1X2 probabilities; expected points = 3 × win probability + draw probability. Game TMP = 50 + 10 × (actual points − expected points) + 8 × goal difference; the first game sets the roll, then it updates 60% prior / 40% game score in date order.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <article className="rounded-xl border border-[#deddd4] bg-[#fbfaf6] p-4" data-testid="insight-h2h-context">
            <div className="flex items-center justify-between gap-2"><h4 className="text-[10px] font-extrabold text-[#43575a]">H2H · home team perspective</h4><CoverageBadge testId="insight-h2h-coverage">{h2h.rows.length} / 8 completed</CoverageBadge></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">{[
              { label: `${match.home.name} W`, value: h2h.homeWins },
              { label: 'Draw', value: h2h.draws },
              { label: `${match.away.name} W`, value: h2h.awayWins },
            ].map((item, index) => <div key={item.label} className="rounded-lg border border-[#e7e5dc] bg-[#f8f7f1] px-2 py-2"><p className="truncate text-[7px] font-bold text-[#858982]">{item.label}</p><p className="mono mt-1 text-[14px] text-[#526b5c]" data-testid={`insight-h2h-count-${index}`}>{item.value}</p></div>)}</div>
            <p className="mt-3 text-[8px] leading-4 text-[#898d84]">Recent-result signal: {recentSignal ? `${pct(recentSignal[0])} / ${pct(recentSignal[1])} / ${pct(recentSignal[2])}` : 'unavailable'}. H2H result signal: {h2h.rates ? `${pct(h2h.rates[0])} / ${pct(h2h.rates[1])} / ${pct(h2h.rates[2])}` : 'unavailable; excluded, remaining weights renormalized'}.</p>
          </article>
          <article className="rounded-xl border border-[#deddd4] bg-[#fbfaf6] p-4" data-testid="insight-table-context">
            <div className="flex items-center justify-between gap-2"><h4 className="text-[10px] font-extrabold text-[#43575a]">Standings comparison</h4><span className="mono text-[8px] text-[#898d84]">Context only</span></div>
            <div className="mt-3 space-y-2">{[
              { team: match.home.name, current: currentHomeStanding, historical: contextHomeStanding, id: match.home.id },
              { team: match.away.name, current: currentAwayStanding, historical: contextAwayStanding, id: match.away.id },
            ].map((row) => <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-[#eceae2] pt-2 first:border-0 first:pt-0" data-testid={`insight-standing-${row.id}`}>
              <span className="truncate text-[8px] font-bold text-[#52615e]">{row.team}</span>
              <span className="mono text-right text-[8px] leading-4 text-[#737d76]">{row.current ? `Current #${row.current.rank} · ${row.current.points} pts · GD ${row.current.goalDifference > 0 ? '+' : ''}${row.current.goalDifference}` : 'Current standing unavailable'}<br />{row.historical ? `TMP context latest #${row.historical.rank} · ${row.historical.points} pts · GD ${row.historical.goalDifference > 0 ? '+' : ''}${row.historical.goalDifference}` : 'TMP-context standing unavailable'}</span>
            </div>)}</div>
            <p className="mt-3 text-[7px] leading-4 text-[#92958b]">TMP-context tables are latest available for the season, not archived match-day ranks.</p>
          </article>
        </div>
      </section>

    </>}

    {details.issues.map((issue, index) => <IssueNotice key={`${issue.section}-${index}`} message={issue.message} testId={`insight-details-issue-${issue.section}`} />)}
    {context && context.issues.map((issue, index) => <IssueNotice key={`${issue.section}-${index}`} message={issue.message} testId={`insight-context-issue-${issue.section}`} />)}
    {context && !context.oddsHistory.length && !context.seasonStandings.length && <div className="flex items-center gap-2 rounded-lg border border-[#e5e3da] bg-[#f7f6f0] px-4 py-3 text-[8px] text-[#858982]" data-testid="insight-context-empty"><ArrowDownRight size={12} /> Historical market and TMP-context standings were not returned.</div>}
    {home && away && <p className="text-[8px] leading-4 text-[#92958b]" data-testid="insight-expected-goals">
      Expected goals: {match.home.name} {homeLambda.toFixed(2)} · {match.away.name} {awayLambda.toFixed(2)}. Five-match attack rates {homeAttackRate.toFixed(2)} / {awayAttackRate.toFixed(2)} and xG-against rates {homeDefenseRate.toFixed(2)} / {awayDefenseRate.toFixed(2)} when returned; five-match xG is blended 70/30 with goals at ≥3 observations, otherwise five-match goals are used. The 15-result rates remain the fallback when last-five records are missing{blended ? `; H2H scoring averages ${h2h.homeGoals?.toFixed(2)} / ${h2h.awayGoals?.toFixed(2)}` : '; no H2H scoring blend applied'}.
    </p>}
  </section>;
}
