import type { FootballMatchDetails, FootballMatchTmpContext, FootballRecentMatch } from '@workspace/api-client-react';
import { AlertCircle, ArrowDownRight, ArrowUpRight, BarChart3, RefreshCw, Sigma } from 'lucide-react';

type Side = 'home' | 'away';

function resultFor(game: FootballRecentMatch, teamId: number) {
  if (game.homeScore === null || game.awayScore === null) return null;
  const isHome = game.homeTeam.id === teamId;
  const scored = isHome ? game.homeScore : game.awayScore;
  const conceded = isHome ? game.awayScore : game.homeScore;
  return { scored, conceded, outcome: scored > conceded ? 'W' : scored < conceded ? 'L' : 'D', points: scored > conceded ? 3 : scored < conceded ? 0 : 1, goalDifference: scored - conceded };
}

function proxyScore(games: FootballRecentMatch[], teamId: number) {
  const rows = games.map((game) => resultFor(game, teamId)).filter((row): row is NonNullable<typeof row> => row !== null);
  if (!rows.length) return null;
  const wins = rows.filter((row) => row.outcome === 'W').length;
  const draws = rows.filter((row) => row.outcome === 'D').length;
  const losses = rows.filter((row) => row.outcome === 'L').length;
  const goalsFor = rows.reduce((sum, row) => sum + row.scored, 0);
  const goalsAgainst = rows.reduce((sum, row) => sum + row.conceded, 0);
  const average = goalsFor / rows.length;
  const over = rows.filter((row) => row.scored + row.conceded > 2.5).length;
  const cleanSheets = rows.filter((row) => row.conceded === 0).length;
  return {
    score: 100 + 18 * wins + 8 * draws - 6 * losses + 4 * (goalsFor - goalsAgainst),
    count: rows.length, wins, draws, losses, goalsFor, goalsAgainst, average,
    goalsScoredAverage: average, goalsConcededAverage: goalsAgainst / rows.length,
    cleanSheets, over, under: rows.length - over,
  };
}

function NumberCell({ label, value }: { label: string; value: string | number }) {
  return <div className="min-w-0"><p className="text-[8px] font-bold uppercase tracking-[.12em] text-[#92958c]">{label}</p><p className="mono mt-1 text-[12px] font-semibold text-[#47595b]">{value}</p></div>;
}

function SampleCard({ title, games, teamId }: { title: string; games: FootballRecentMatch[]; teamId: number }) {
  const sample = proxyScore(games, teamId);
  const performanceGroups = sample ? [
    {
      label: 'Overperform · above average',
      matches: games.filter((game) => {
        const row = resultFor(game, teamId);
        return row !== null && row.scored > sample.goalsScoredAverage;
      }),
    },
    {
      label: 'Aligned · at average',
      matches: games.filter((game) => {
        const row = resultFor(game, teamId);
        return row !== null && row.scored === sample.goalsScoredAverage;
      }),
    },
    {
      label: 'Underperform · below average',
      matches: games.filter((game) => {
        const row = resultFor(game, teamId);
        return row !== null && row.scored < sample.goalsScoredAverage;
      }),
    },
  ] : [];
  return (
    <article className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" data-testid={`tmp-sample-${title.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="flex items-center justify-between border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3">
        <h4 className="text-[10px] font-extrabold text-[#43575a]">{title}</h4>
        <span className="mono text-[8px] text-[#898d84]">{sample ? `${sample.count} matches` : 'No sample'}</span>
      </div>
      {sample ? <>
        <div className="flex items-end justify-between gap-3 px-4 py-4">
          <div><p className="mono text-[8px] uppercase tracking-[.13em] text-[#92958c]">Proxy TMP</p><p className="mono mt-1 text-[30px] leading-none font-medium tracking-[-.08em] text-[#2f4a42]">{sample.score}</p></div>
          <span className="rounded-md bg-[#e9eee8] px-2 py-1.5 text-[8px] font-bold text-[#64806d]">W {sample.wins} · D {sample.draws} · L {sample.losses}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-3">
          <div className="rounded-lg border border-[#e4e5da] bg-[#f3f5ee] px-3 py-2.5">
            <p className="text-[8px] font-bold uppercase tracking-[.1em] text-[#858982]">Avg goals scored</p>
            <p className="mono mt-1 text-[19px] font-semibold leading-none text-[#435f50]">{sample.goalsScoredAverage.toFixed(2)} <span className="text-[8px] font-normal text-[#858982]">per match</span></p>
          </div>
          <div className="rounded-lg border border-[#e4e5da] bg-[#f3f5ee] px-3 py-2.5">
            <p className="text-[8px] font-bold uppercase tracking-[.1em] text-[#858982]">Avg goals conceded</p>
            <p className="mono mt-1 text-[19px] font-semibold leading-none text-[#435f50]">{sample.goalsConcededAverage.toFixed(2)} <span className="text-[8px] font-normal text-[#858982]">per match</span></p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 px-4 pb-3">
          <NumberCell label="Clean sheets" value={`${sample.cleanSheets}/${sample.count}`} />
          <NumberCell label="Over 2.5" value={`${sample.over}/${sample.count}`} />
          <NumberCell label="Under 2.5" value={`${sample.under}/${sample.count}`} />
        </div>
        <div className="mx-4 mb-3 rounded-lg border border-[#e8e6de] bg-[#f7f6f0] px-3 py-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[.1em] text-[#858982]"><Sigma size={11} /> TMP by goals-scored performance</p>
          <p className="mb-1.5 text-[8px] text-[#92958c]">Scoring average baseline: <span className="mono font-semibold text-[#66766a]">{sample.goalsScoredAverage.toFixed(2)} goals / match</span></p>
          {performanceGroups.map(({ label, matches }) => {
            const group = proxyScore(matches, teamId);
            return (
              <div key={label} className="border-t border-[#e9e7df] py-2 first:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[8px] font-semibold text-[#68766d]">{label}</span>
                  <span className="mono shrink-0 text-[8px] text-[#81877f]">{matches.length} matches · TMP <span className="font-semibold text-[#52615e]">{group?.score ?? '—'}</span></span>
                </div>
                <p className="mono mt-1 text-[8px] text-[#858982]">
                  Avg scored {group ? group.goalsScoredAverage.toFixed(2) : '—'} · Avg conceded {group ? group.goalsConcededAverage.toFixed(2) : '—'}
                </p>
              </div>
            );
          })}
        </div>
        <p className="px-4 pb-3 text-[8px] leading-4 text-[#96978f]">Each split shows its own TMP and goals scored/conceded averages; the split is based on goals scored versus the full sample average.</p>
      </> : <p className="px-4 py-8 text-center text-[9px] text-[#858982]">Completed scores are not available for this sample.</p>}
    </article>
  );
}

function OddsScore({ details, context, side }: { details: FootballMatchDetails; context: FootballMatchTmpContext; side: Side }) {
  const team = details.match[side];
  const sourceGames = (side === 'home' ? details.homeRecent : details.awayRecent).slice(0, 15);
  const usable = sourceGames.map((game) => ({ game, odds: context.oddsHistory.find((item) => item.fixtureId === game.fixtureId) }))
    .filter((item): item is { game: FootballRecentMatch; odds: NonNullable<typeof item.odds> } =>
      !!item.odds && item.odds.homeProbability !== null && item.odds.drawProbability !== null && item.odds.awayProbability !== null &&
      item.game.homeScore !== null && item.game.awayScore !== null)
    .sort((a, b) => new Date(a.game.date).getTime() - new Date(b.game.date).getTime());
  let rolling = 50;
  let expectationGap = 0;
  const steps = usable.map(({ game, odds }) => {
    const isHome = game.homeTeam.id === team.id;
    const pHome = odds.homeProbability!;
    const pDraw = odds.drawProbability!;
    const pAway = odds.awayProbability!;
    const expected = isHome ? 3 * pHome + pDraw : 3 * pAway + pDraw;
    const actual = resultFor(game, team.id)!;
    const gameScore = 50 + 10 * (actual.points - expected) + 8 * actual.goalDifference;
    rolling = 0.6 * rolling + 0.4 * gameScore;
    expectationGap += actual.points - expected;
    const teamProbability = isHome ? pHome : pAway;
    const opponentProbability = isHome ? pAway : pHome;
    const expectedOutcome =
      teamProbability >= pDraw && teamProbability >= opponentProbability
        ? 'W'
        : pDraw >= opponentProbability
          ? 'D'
          : 'L';
    return {
      game,
      odds,
      expected,
      actual,
      expectedOutcome,
      outcomeMatched: expectedOutcome === actual.outcome,
      gameScore,
      rolling,
    };
  });
  const verifiedBookmakers = steps.reduce(
    (total, step) => total + step.odds.verifiedBookmakerCount,
    0,
  );
  const unverifiedBookmakers = steps.reduce(
    (total, step) => total + step.odds.unverifiedBookmakerCount,
    0,
  );
  return (
    <article className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" data-testid={`tmp-odds-score-${side}`}>
      <div className="flex items-center justify-between border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3"><h4 className="text-[10px] font-extrabold text-[#43575a]">{team.name}</h4><span className="mono text-[8px] text-[#898d84]">1X2 only</span></div>
      <div className="flex items-end justify-between gap-3 px-4 py-4"><div><p className="mono text-[8px] uppercase tracking-[.13em] text-[#92958c]">Odds TMP · current roll</p><p className="mono mt-1 text-[30px] leading-none font-medium tracking-[-.08em] text-[#2f4a42]">{steps.length ? rolling.toFixed(1) : '—'}</p></div><span className="rounded-md bg-[#e9eee8] px-2 py-1.5 text-[8px] font-bold text-[#64806d]">{steps.length} / {sourceGames.length} covered</span></div>
      <div className="grid grid-cols-2 gap-4 px-4 pb-4">
        <NumberCell label="Expectation gap" value={steps.length ? `${expectationGap > 0 ? '+' : ''}${expectationGap.toFixed(2)} pts` : '—'} />
        <NumberCell label="Usable 1X2 history" value={`${steps.length} of ${sourceGames.length}`} />
        <NumberCell label="Timestamp-verified books" value={verifiedBookmakers} />
        <NumberCell label="Untimestamped books" value={unverifiedBookmakers} />
      </div>
      {!!unverifiedBookmakers && <p className="px-4 pb-3 text-[8px] leading-4 text-[#96978f]">The roll includes complete source quotes even when the source does not provide a timestamp; verified and untimestamped bookmaker counts are shown separately.</p>}
      <details className="border-t border-[#e8e6de]">
        <summary className="cursor-pointer list-none px-4 py-3 text-[9px] font-bold text-[#667870] hover:bg-[#f7f6f0]">Inspect match-by-match calculation <span className="float-right text-[#a1a398]">+</span></summary>
        {steps.length ? <div className="overflow-x-auto border-t border-[#e8e6de]"><table className="w-full min-w-[760px] text-left text-[8px]"><thead className="bg-[#f7f6f0] text-[#858982]"><tr><th className="px-3 py-2">Fixture · oldest first</th><th className="px-3 py-2">1X2 p</th><th className="px-3 py-2">Expected vs actual</th><th className="px-3 py-2">Expected pts / actual</th><th className="px-3 py-2">GD</th><th className="px-3 py-2">TMP game</th><th className="px-3 py-2">Roll</th><th className="px-3 py-2">Quote source</th></tr></thead><tbody>{steps.map(({ game, odds, expected, actual, expectedOutcome, outcomeMatched, gameScore, rolling: value }) => <tr key={game.fixtureId} className="border-t border-[#ebe9e1]"><td className="px-3 py-2 text-[#52615e]">{game.homeTeam.name} {game.homeScore}–{game.awayScore} {game.awayTeam.name}</td><td className="mono px-3 py-2">{(odds.homeProbability! * 100).toFixed(0)} / {(odds.drawProbability! * 100).toFixed(0)} / {(odds.awayProbability! * 100).toFixed(0)}%</td><td className="px-3 py-2"><span className="mono">{expectedOutcome} / {actual.outcome}</span><span className={`ml-1.5 ${outcomeMatched ? 'text-[#54745e]' : 'text-[#ad6955]'}`}>{outcomeMatched ? 'correct' : 'missed'}</span></td><td className="mono px-3 py-2">{expected.toFixed(2)} / {actual.points}</td><td className="mono px-3 py-2">{actual.goalDifference > 0 ? '+' : ''}{actual.goalDifference}</td><td className="mono px-3 py-2">{gameScore.toFixed(1)}</td><td className="mono px-3 py-2 font-bold text-[#456b58]">{value.toFixed(1)}</td><td className="px-3 py-2">{odds.quoteSource}</td></tr>)}</tbody></table></div> : <p className="px-4 pb-4 text-[8px] text-[#858982]">No recent completed result has a complete historical 1X2 probability set.</p>}
      </details>
    </article>
  );
}

function MarketContext({ details, context }: { details: FootballMatchDetails; context: FootballMatchTmpContext }) {
  const matches = [...details.homeRecent, ...details.awayRecent, ...details.headToHead].reduce<FootballRecentMatch[]>((unique, game) => {
    if (!unique.some((entry) => entry.fixtureId === game.fixtureId)) unique.push(game);
    return unique;
  }, []);
  const records = context.oddsHistory;
  const standingByTeam = new Map(context.seasonStandings.map((row) => [`${row.leagueId}:${row.season}:${row.teamId}`, row]));
  return (
    <section className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" data-testid="tmp-market-context">
      <div className="border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3"><h3 className="text-[10px] font-extrabold text-[#43575a]">Historical market & opponent context</h3><p className="mt-1 text-[8px] leading-4 text-[#898d84]">Supporting evidence only. These markets and table positions do not add scoring weights.</p></div>
      {records.length ? <div className="divide-y divide-[#e9e7df]">{records.map((record) => {
        const game = matches.find((item) => item.fixtureId === record.fixtureId);
        const homeTeam = game?.homeTeam.name ?? `Fixture ${record.fixtureId}`;
        const awayTeam = game?.awayTeam.name ?? 'Match details unavailable';
        const homeRow = game?.leagueId && game.season ? standingByTeam.get(`${game.leagueId}:${game.season}:${game.homeTeam.id}`) : undefined;
        const awayRow = game?.leagueId && game.season ? standingByTeam.get(`${game.leagueId}:${game.season}:${game.awayTeam.id}`) : undefined;
        const allProbabilities = [record.homeProbability, record.drawProbability, record.awayProbability];
        return <details key={record.fixtureId} className="group">
          <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-[#f7f6f0]" data-testid={`tmp-market-fixture-${record.fixtureId}`}>
            <span className="min-w-0"><span className="block truncate text-[9px] font-bold text-[#52615e]">{homeTeam} <span className="font-normal text-[#9a9a90]">vs</span> {awayTeam}</span><span className="mt-1 block truncate text-[8px] text-[#96978f]">{game ? `${game.competition} · ${new Date(game.date).toLocaleDateString()}` : `Fixture ${record.fixtureId}`}</span></span>
            <span className="text-right"><span className="mono block text-[9px] text-[#5b7266]">{allProbabilities.every((p) => p !== null) ? `${(record.homeProbability! * 100).toFixed(0)} / ${(record.drawProbability! * 100).toFixed(0)} / ${(record.awayProbability! * 100).toFixed(0)}%` : 'No complete 1X2'}</span><span className="mono mt-1 block text-[7px] uppercase tracking-[.08em] text-[#92958c]">{record.quoteSource} · {record.bookmakerCount} books</span></span>
          </summary>
          <div className="border-t border-[#e9e7df] bg-[#f8f7f1] px-4 py-3">
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[8px] text-[#7d837b]"><span>{record.verifiedBookmakerCount} verified</span><span>{record.unverifiedBookmakerCount} unverified</span><span>{record.marketCount} markets</span><span>{record.marketCategories.join(', ') || 'No categories'}</span></div>
            {(homeRow || awayRow) && <div className="mb-3 rounded-md border border-[#e6e4dc] bg-[#fbfaf6] px-3 py-2"><p className="mb-1 text-[8px] font-bold uppercase tracking-[.1em] text-[#9b7160]">Latest available for that season, not match-day rank</p><p className="text-[8px] text-[#69766f]">{homeRow ? `${homeRow.teamName} · #${homeRow.rank} · ${homeRow.points} pts` : 'Home rank unavailable'} <span className="px-1 text-[#b0b0a6]">/</span> {awayRow ? `${awayRow.teamName} · #${awayRow.rank} · ${awayRow.points} pts` : 'Away rank unavailable'}</p></div>}
            {record.markets.length ? <div className="space-y-2">{record.markets.map((market) => <div key={market.marketId} className="rounded-md border border-[#e6e4dc] bg-[#fbfaf6] px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[8px] font-bold text-[#52615e]">{market.name}</span><span className="mono text-[7px] uppercase text-[#96978f]">{market.category}</span></div><div className="mt-2 flex flex-wrap gap-1.5">{market.selections.map((selection, index) => <span key={`${selection.selection}-${index}`} className="rounded border border-[#e3e2d9] bg-[#f7f6f0] px-2 py-1 text-[7px] text-[#737d76]">{selection.selection} · {(selection.probability * 100).toFixed(1)}% · {selection.bookmakerCount} bk</span>)}</div></div>)}</div> : <p className="text-[8px] text-[#96978f]">No additional historical markets were returned.</p>}
          </div>
        </details>;
      })}</div> : <div className="px-4 py-7 text-center text-[9px] text-[#858982]">No historical market records were returned.</div>}
      {context.seasonStandings.length > 0 && <div className="border-t border-[#e8e6de]">
        <div className="px-4 py-3"><p className="text-[8px] font-bold uppercase tracking-[.1em] text-[#9b7160]">Latest available season tables</p><p className="mt-1 text-[8px] text-[#898d84]">These are not archived standings as of each historical match.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[450px] text-left text-[8px]"><thead className="bg-[#f7f6f0] text-[#858982]"><tr><th className="px-4 py-2">League / season</th><th className="px-3 py-2">Club</th><th className="px-3 py-2">Rank</th><th className="px-3 py-2">P</th><th className="px-3 py-2">Pts</th><th className="px-3 py-2">GD</th></tr></thead><tbody>{context.seasonStandings.map((row) => <tr key={`${row.leagueId}-${row.season}-${row.teamId}`} className="border-t border-[#ebe9e1]"><td className="mono px-4 py-2 text-[#858982]">{row.leagueId} · {row.season}</td><td className="px-3 py-2 font-medium text-[#52615e]">{row.teamName}</td><td className="mono px-3 py-2">#{row.rank}</td><td className="mono px-3 py-2">{row.played}</td><td className="mono px-3 py-2">{row.points}</td><td className="mono px-3 py-2">{row.goalDifference > 0 ? '+' : ''}{row.goalDifference}</td></tr>)}</tbody></table></div>
      </div>}
    </section>
  );
}

export function MatchTmpPanel({ details, context, isLoading, isError, error, onRetry }: {
  details: FootballMatchDetails;
  context?: FootballMatchTmpContext;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const homeH2h = details.headToHead.slice(0, 8);
  const awayH2h = details.headToHead.slice(0, 8);
  if (isLoading) return <section className="space-y-4" aria-label="Loading TMP context" data-testid="status-tmp-loading"><div className="h-5 w-48 animate-pulse rounded bg-[#e6e4dc]" /><div className="grid gap-4 lg:grid-cols-2"><div className="h-52 animate-pulse rounded-xl bg-[#eeede6]" /><div className="h-52 animate-pulse rounded-xl bg-[#eeede6]" /></div><div className="h-40 animate-pulse rounded-xl bg-[#eeede6]" /></section>;
  const issues = context?.issues ?? [];
  const hasAnyData = !!context && (context.oddsHistory.length > 0 || context.seasonStandings.length > 0);
  return (
    <section className="space-y-6" data-testid="panel-tmp">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="mono text-[9px] uppercase tracking-[.17em] text-[#9b7160]">Transparent match pressure</p><h2 className="mt-1 text-[20px] font-extrabold tracking-[-.05em] text-[#2b3e49]">TMP, with the arithmetic exposed</h2></div>
        <p className="max-w-[410px] text-[9px] leading-5 text-[#858982]">Two separate lenses: a results-based proxy and an odds-based roll. Market context never becomes a hidden scoring weight.</p>
      </div>
      <div className="grid gap-3 rounded-xl border border-[#deddd4] bg-[#f3f2eb] p-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <span className="grid size-9 place-items-center rounded-lg bg-[#e6eee8] text-[#537867]"><Sigma size={17} /></span>
        <div><p className="text-[9px] font-extrabold text-[#43575a]">Proxy TMP = 100 + 18W + 8D − 6L + 4(GF − GA)</p><p className="mt-1 text-[8px] leading-4 text-[#858982]">Computed independently from each side’s perspective. Samples include completed results with scores; recent form is capped at 15 and H2H at the latest 8.</p></div>
      </div>
      {isError && !context && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-4 py-3 text-[9px] text-[#8c6b5e]" role="alert" data-testid="status-tmp-error"><span>{error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Historical odds and standings context could not be loaded.'} Proxy TMP calculations remain available from match results.</span><button type="button" onClick={onRetry} className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-3 text-[8px] font-extrabold text-[#855542] hover:bg-white" data-testid="button-retry-tmp"><RefreshCw size={11} /> Retry context</button></div>}
      {issues.map((issue, index) => <div key={`${issue.section}-${index}`} className="flex items-start gap-2 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3.5 py-3 text-[9px] leading-5 text-[#84684f]" role="status" data-testid={`tmp-issue-${issue.section}`}><AlertCircle size={13} className="mt-0.5 shrink-0 text-[#bb8755]" />{issue.message}</div>)}
      {context && !hasAnyData && <div className="rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-4 py-3 text-[9px] text-[#858982]" data-testid="status-tmp-partial">The context request returned no odds or season standings. Proxy TMP remains available from match results; historical context is currently empty.</div>}
      {context && hasAnyData && (!context.oddsHistory.length || !context.seasonStandings.length) && <div className="rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-4 py-3 text-[9px] leading-5 text-[#84684f]" role="status" data-testid="status-tmp-partial">{context.oddsHistory.length ? 'Historical odds are available; latest-season standings were not returned.' : 'Latest-season standings are available; historical odds were not returned.'} Available TMP evidence is shown below.</div>}
      <div className="space-y-3">
        <div className="flex items-center gap-2"><BarChart3 size={14} className="text-[#9b7160]" /><h3 className="text-[12px] font-extrabold text-[#43575a]">Proxy TMP · recent form</h3></div>
        <div className="grid gap-4 lg:grid-cols-2"><SampleCard title={`${details.match.home.name} · last 15`} games={details.homeRecent.slice(0, 15)} teamId={details.match.home.id} /><SampleCard title={`${details.match.away.name} · last 15`} games={details.awayRecent.slice(0, 15)} teamId={details.match.away.id} /></div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-2"><BarChart3 size={14} className="text-[#9b7160]" /><h3 className="text-[12px] font-extrabold text-[#43575a]">Proxy TMP · latest eight meetings</h3></div>
        <p className="text-[8px] leading-4 text-[#858982]">Each side is calculated from its own perspective: average goals scored and conceded, plus TMP for matches above, at, or below that side’s average goals scored.</p>
        <div className="grid gap-4 lg:grid-cols-2"><SampleCard title={`${details.match.home.name} perspective`} games={homeH2h} teamId={details.match.home.id} /><SampleCard title={`${details.match.away.name} perspective`} games={awayH2h} teamId={details.match.away.id} /></div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-2"><ArrowUpRight size={14} className="text-[#9b7160]" /><h3 className="text-[12px] font-extrabold text-[#43575a]">Odds TMP · market expectation</h3></div>
        <p className="text-[8px] leading-4 text-[#858982]">Expected points: home 3pH + pD, away 3pA + pD. Per match: 50 + 10(actual − expected) + 8 goal difference; neutral roll starts at 50 and updates 60% previous / 40% game score in date order.</p>
        <div className="grid gap-4 lg:grid-cols-2"><OddsScore details={details} context={context ?? { fixtureId: details.match.fixtureId, oddsHistory: [], seasonStandings: [], issues: [] }} side="home" /><OddsScore details={details} context={context ?? { fixtureId: details.match.fixtureId, oddsHistory: [], seasonStandings: [], issues: [] }} side="away" /></div>
      </div>
      {context ? <MarketContext details={details} context={context} /> : <div className="flex items-center gap-2 rounded-lg border border-[#e5e3da] bg-[#f7f6f0] px-4 py-3 text-[8px] text-[#858982]" data-testid="status-tmp-partial"><ArrowDownRight size={12} /> Historical market and latest-season opponent context are not available yet.</div>}
      {context && !context.oddsHistory.length && !context.seasonStandings.length && <p className="text-[8px] text-[#92958c]">No historical context records were supplied. The TMP calculations above use only the returned match results.</p>}
    </section>
  );
}
