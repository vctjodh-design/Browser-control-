import type {
  FootballMatchDetails,
  FootballMatchTmpContext,
} from '@workspace/api-client-react';
import { AlertCircle, BarChart3, RefreshCw, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Side = 'home' | 'away';

type MatchPoint = {
  fixtureId: number;
  date: string;
  dateLabel: string;
  opponent: string;
  scoreLabel: string;
  outcome: 'W' | 'D' | 'L';
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheet: boolean;
  expectedPoints: number | null;
  actualPoints: number;
  gameTmp: number | null;
  oddsTmp: number | null;
  normalizedProbabilities: [number, number, number] | null;
};

type TeamSample = {
  side: Side;
  name: string;
  color: string;
  matches: MatchPoint[];
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  resultsTmp: number | null;
  expectationGap: number | null;
  oddsCovered: number;
  total: number;
};

function formatDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date || 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(parsed);
}

function readError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Historical performance context could not be loaded.';
}

function normalizeProbabilities(
  history: FootballMatchTmpContext['oddsHistory'][number] | undefined,
): [number, number, number] | null {
  if (!history) return null;
  const values = [history.homeProbability, history.drawProbability, history.awayProbability];
  if (values.some((value) => value === null || !Number.isFinite(value) || value < 0)) return null;
  const [home, draw, away] = values as [number, number, number];
  const sum = home + draw + away;
  if (sum <= 0) return null;
  return [home / sum, draw / sum, away / sum];
}

function buildTeamSample(
  details: FootballMatchDetails,
  context: FootballMatchTmpContext | undefined,
  side: Side,
): TeamSample {
  const team = details.match[side];
  const sourceGames = (side === 'home' ? details.homeRecent : details.awayRecent).slice(0, 15);
  const historyByFixture = new Map((context?.oddsHistory ?? []).map((record) => [record.fixtureId, record]));

  const chronological = [...sourceGames]
    .filter((game) => game.homeScore !== null && game.awayScore !== null)
    .sort((a, b) => {
      const delta = new Date(a.date).getTime() - new Date(b.date).getTime();
      return Number.isNaN(delta) || delta === 0 ? 0 : delta;
    });

  let rollingOddsTmp: number | null = null;
  const matches: MatchPoint[] = chronological.map((game) => {
    const isHome = game.homeTeam.id === team.id;
    const goalsFor = isHome ? game.homeScore! : game.awayScore!;
    const goalsAgainst = isHome ? game.awayScore! : game.homeScore!;
    const outcome = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
    const actualPoints = outcome === 'W' ? 3 : outcome === 'D' ? 1 : 0;
    const probabilities = normalizeProbabilities(historyByFixture.get(game.fixtureId));
    const expectedPoints = probabilities
      ? (isHome ? 3 * probabilities[0] : 3 * probabilities[2]) + probabilities[1]
      : null;
    const gameTmp = expectedPoints === null
      ? null
      : 50 + 10 * (actualPoints - expectedPoints) + 8 * (goalsFor - goalsAgainst);
    if (gameTmp !== null) {
      rollingOddsTmp = rollingOddsTmp === null
        ? gameTmp
        : 0.6 * rollingOddsTmp + 0.4 * gameTmp;
    }
    const opponent = isHome ? game.awayTeam.name : game.homeTeam.name;
    return {
      fixtureId: game.fixtureId,
      date: game.date,
      dateLabel: formatDate(game.date),
      opponent,
      scoreLabel: `${goalsFor}–${goalsAgainst}`,
      outcome,
      points: actualPoints,
      goalsFor,
      goalsAgainst,
      cleanSheet: goalsAgainst === 0,
      expectedPoints,
      actualPoints,
      gameTmp,
      oddsTmp: gameTmp === null ? null : rollingOddsTmp,
      normalizedProbabilities: probabilities,
    };
  });

  const wins = matches.filter((match) => match.outcome === 'W').length;
  const draws = matches.filter((match) => match.outcome === 'D').length;
  const losses = matches.filter((match) => match.outcome === 'L').length;
  const goalsFor = matches.reduce((sum, match) => sum + match.goalsFor, 0);
  const goalsAgainst = matches.reduce((sum, match) => sum + match.goalsAgainst, 0);
  const cleanSheets = matches.filter((match) => match.cleanSheet).length;
  const oddsMatches = matches.filter((match) => match.expectedPoints !== null);
  const resultsTmp = matches.length
    ? 100 + 18 * wins + 8 * draws - 6 * losses + 4 * (goalsFor - goalsAgainst)
    : null;

  return {
    side,
    name: team.name,
    color: side === 'home' ? '#557d66' : '#c77a5e',
    matches,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    cleanSheets,
    resultsTmp,
    expectationGap: oddsMatches.length
      ? oddsMatches.reduce((sum, match) => sum + match.actualPoints - match.expectedPoints!, 0)
      : null,
    oddsCovered: oddsMatches.length,
    total: sourceGames.length,
  };
}

function SummaryMetric({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string | number;
  note?: string;
  testId: string;
}) {
  return (
    <div className="min-w-0 border-l border-[#e7e5dc] pl-3 first:border-0 first:pl-0 sm:pl-4" data-testid={testId}>
      <p className="text-[8px] font-extrabold uppercase tracking-[.11em] text-[#8e9187]">{label}</p>
      <p className="mono mt-1 text-[15px] font-medium leading-none tracking-[-.04em] text-[#34494b]">{value}</p>
      {note && <p className="mt-1 text-[8px] text-[#92948b]">{note}</p>}
    </div>
  );
}

function ResultPill({ match, index }: { match: MatchPoint; index: number }) {
  const colors = match.outcome === 'W'
    ? 'border-[#cbdccf] bg-[#e7efe7] text-[#4e755c]'
    : match.outcome === 'L'
      ? 'border-[#ead4ca] bg-[#f6e9e2] text-[#a5634e]'
      : 'border-[#e3e0d4] bg-[#f1f0e7] text-[#817b68]';
  return (
    <span
      className={`relative grid size-7 shrink-0 place-items-center rounded-[8px] border text-[9px] font-extrabold ${colors}`}
      title={`${match.dateLabel} · ${match.opponent} · ${match.scoreLabel}${match.cleanSheet ? ' · Clean sheet' : ''}`}
      aria-label={`${match.dateLabel}, ${match.opponent}, ${match.scoreLabel}, ${match.outcome}${match.cleanSheet ? ', clean sheet' : ''}`}
      data-testid={`performance-result-${match.fixtureId}-${index}`}
    >
      {match.outcome}
      {match.cleanSheet && <span className="absolute -bottom-1 -right-1 size-2 rounded-full border border-[#fbfaf6] bg-[#6f8c77]" aria-hidden="true" />}
    </span>
  );
}

function OddsTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: MatchPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="max-w-[240px] rounded-lg border border-[#d9d8ce] bg-[#fffdf8] px-3 py-2.5 shadow-[0_8px_24px_rgba(48,58,55,.13)]">
      <p className="text-[9px] font-extrabold text-[#43575a]">{point.dateLabel} · {point.opponent}</p>
      {point.expectedPoints !== null ? (
        <>
          <p className="mono mt-2 text-[9px] text-[#63766a]">Expected {point.expectedPoints.toFixed(2)} pts <span className="text-[#a3a398]">/</span> actual {point.actualPoints}</p>
          <p className="mono mt-1 text-[9px] text-[#52615e]">Game TMP {point.gameTmp!.toFixed(1)} <span className="text-[#a3a398]">→</span> roll {point.oddsTmp!.toFixed(1)}</p>
        </>
      ) : <p className="mt-2 text-[9px] text-[#96978f]">No complete historical 1X2 probabilities for this fixture.</p>}
    </div>
  );
}

function TeamPerformanceCard({ sample }: { sample: TeamSample }) {
  const chartRows = sample.matches.map((match, index) => ({ ...match, sequence: index + 1 }));
  const latestOddsMatch = [...sample.matches].reverse().find((match) => match.oddsTmp !== null);
  const oddsGaps = sample.total - sample.oddsCovered;
  const resultTone = sample.resultsTmp === null ? 'text-[#a0a196]' : sample.resultsTmp >= 100 ? 'text-[#53745f]' : 'text-[#a2604c]';

  return (
    <article className="overflow-hidden rounded-[14px] border border-[#deddd4] bg-[#fbfaf6]" data-testid={`performance-team-${sample.side}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-7 w-[3px] rounded-full" style={{ backgroundColor: sample.color }} aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="truncate text-[12px] font-extrabold text-[#3e5355]" data-testid={`performance-team-name-${sample.side}`}>{sample.name}</h3>
            <p className="mono mt-0.5 text-[8px] uppercase tracking-[.1em] text-[#91938a]">Recent performance · chronological</p>
          </div>
        </div>
        <span className="mono rounded-full border border-[#deddd3] bg-[#fbfaf6] px-2.5 py-1 text-[8px] text-[#7c857d]" data-testid={`performance-coverage-${sample.side}`}>
          {sample.matches.length} / 15 results
        </span>
      </header>

      {sample.matches.length ? (
        <>
          <div className="grid grid-cols-3 gap-y-4 border-b border-[#e9e7df] px-4 py-4 sm:grid-cols-6 sm:px-5">
            <SummaryMetric label="W · D · L" value={`${sample.wins} · ${sample.draws} · ${sample.losses}`} testId={`performance-record-${sample.side}`} />
            <SummaryMetric label="Goals for" value={sample.goalsFor} testId={`performance-goals-for-${sample.side}`} />
            <SummaryMetric label="Goals against" value={sample.goalsAgainst} testId={`performance-goals-against-${sample.side}`} />
            <SummaryMetric label="Clean sheets" value={`${sample.cleanSheets}/${sample.matches.length}`} testId={`performance-clean-sheets-${sample.side}`} />
            <SummaryMetric label="Results TMP" value={sample.resultsTmp?.toFixed(0) ?? '—'} note="Results-only index" testId={`performance-results-tmp-${sample.side}`} />
            <SummaryMetric label="Expectation gap" value={sample.expectationGap === null ? '—' : `${sample.expectationGap > 0 ? '+' : ''}${sample.expectationGap.toFixed(2)}`} note="Actual − expected pts" testId={`performance-expectation-gap-${sample.side}`} />
          </div>

          <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(250px,.8fr)]">
            <section aria-labelledby={`odds-trend-${sample.side}`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="mono text-[8px] uppercase tracking-[.13em] text-[#9b7160]">Market expectation</p>
                  <h4 id={`odds-trend-${sample.side}`} className="mt-1 text-[11px] font-extrabold text-[#42575a]">Odds TMP roll</h4>
                </div>
                <div className="text-right">
                  <p className="mono text-[19px] leading-none text-[#426a56]" data-testid={`performance-odds-current-${sample.side}`}>
                    {latestOddsMatch ? latestOddsMatch.oddsTmp!.toFixed(1) : '—'}
                  </p>
                  <p className="mt-1 text-[8px] text-[#92948b]">{sample.oddsCovered} of {sample.total} odds-covered</p>
                </div>
              </div>
              {sample.oddsCovered ? (
                <div className="h-[190px] rounded-lg border border-[#e6e5dc] bg-[#f8f8f2] px-1 py-2" data-testid={`performance-odds-chart-${sample.side}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartRows} margin={{ top: 10, right: 12, bottom: 0, left: -16 }}>
                      <defs>
                        <linearGradient id={`odds-fill-${sample.side}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={sample.color} stopOpacity={0.18} />
                          <stop offset="95%" stopColor={sample.color} stopOpacity={0.015} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e8e8df" strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="sequence" tickLine={false} axisLine={false} tick={{ fill: '#999b91', fontSize: 8 }} tickFormatter={(value) => `M${value}`} minTickGap={18} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fill: '#999b91', fontSize: 8 }} domain={['auto', 'auto']} width={32} />
                      <ReferenceLine y={50} stroke="#c9c9be" strokeDasharray="4 4" />
                      <Tooltip content={<OddsTooltip />} cursor={{ stroke: '#b6bdb2', strokeDasharray: '3 3' }} />
                      <Area
                        type="linear"
                        dataKey="oddsTmp"
                        stroke={sample.color}
                        strokeWidth={2.4}
                        fill={`url(#odds-fill-${sample.side})`}
                        connectNulls={false}
                        isAnimationActive={false}
                        activeDot={{ r: 4, fill: sample.color, stroke: '#fbfaf6', strokeWidth: 2 }}
                        dot={{ r: 2.5, fill: sample.color, stroke: '#fbfaf6', strokeWidth: 1.5 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="grid h-[190px] place-items-center rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-5 text-center" data-testid={`performance-no-odds-${sample.side}`}>
                  <div><p className="text-[10px] font-bold text-[#65756d]">No complete historical 1X2 coverage</p><p className="mt-1 max-w-xs text-[8px] leading-4 text-[#92948b]">Results and goals are still shown. No market values are inferred.</p></div>
                </div>
              )}
              <p className="mt-2 text-[8px] leading-4 text-[#898d84]">
                Gaps are unobserved fixtures, not zeroes. The roll resumes only when complete 1X2 probabilities are available.
                {oddsGaps > 0 && <span className="font-bold text-[#7d8279]"> {oddsGaps} match{oddsGaps === 1 ? '' : 'es'} without odds coverage.</span>}
              </p>
            </section>

            <section aria-labelledby={`goals-trend-${sample.side}`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="mono text-[8px] uppercase tracking-[.13em] text-[#9b7160]">On the pitch</p>
                  <h4 id={`goals-trend-${sample.side}`} className="mt-1 text-[11px] font-extrabold text-[#42575a]">Goals per match</h4>
                </div>
                <div className="flex gap-3 text-[8px] text-[#858982]">
                  <span className="inline-flex items-center gap-1"><i className="size-1.5 rounded-full bg-[#557d66]" /> For</span>
                  <span className="inline-flex items-center gap-1"><i className="size-1.5 rounded-full bg-[#c77a5e]" /> Against</span>
                </div>
              </div>
              <div className="h-[190px] rounded-lg border border-[#e6e5dc] bg-[#f8f8f2] px-1 py-2" data-testid={`performance-goals-chart-${sample.side}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 10, right: 10, bottom: 0, left: -16 }}>
                    <CartesianGrid stroke="#e8e8df" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="sequence" tickLine={false} axisLine={false} tick={{ fill: '#999b91', fontSize: 8 }} tickFormatter={(value) => `M${value}`} minTickGap={18} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#999b91', fontSize: 8 }} domain={[0, 'auto']} width={32} />
                    <Tooltip
                      labelFormatter={(value) => `Match ${value}`}
                      formatter={(value, name, item) => {
                        const point = item.payload as MatchPoint;
                        return [`${value} · ${point.dateLabel} · ${point.opponent}`, name === 'goalsFor' ? 'Goals for' : 'Goals against'];
                      }}
                    />
                    <Line type="monotone" dataKey="goalsFor" name="Goals for" stroke="#557d66" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 1, fill: '#557d66', stroke: '#fbfaf6' }} activeDot={{ r: 4 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="goalsAgainst" name="Goals against" stroke="#c77a5e" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 1, fill: '#c77a5e', stroke: '#fbfaf6' }} activeDot={{ r: 4 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-[8px] leading-4 text-[#898d84]">Chronological scores, independent of odds. Results TMP: 100 + 18W + 8D − 6L + 4(GF − GA).</p>
            </section>
          </div>

          <details className="border-t border-[#e8e6de]">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[9px] font-bold text-[#64766b] outline-none transition hover:bg-[#f7f6f0] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#9b7160] sm:px-5" data-testid={`performance-match-detail-toggle-${sample.side}`}>
              <span>Inspect match-by-match record and odds calculation</span>
              <span className="mono text-[8px] text-[#999b91]">{sample.matches.length} matches · oldest first</span>
            </summary>
            <div className="overflow-x-auto border-t border-[#e8e6de]">
              <table className="w-full min-w-[760px] text-left text-[8px]" data-testid={`performance-match-table-${sample.side}`}>
                <thead className="bg-[#f7f6f0] text-[8px] font-bold uppercase tracking-[.08em] text-[#8c9086]">
                  <tr><th className="px-4 py-2.5">Date · opponent</th><th className="px-3 py-2.5">Result</th><th className="px-3 py-2.5">GF / GA</th><th className="px-3 py-2.5">Clean sheet</th><th className="px-3 py-2.5">Expected / actual pts</th><th className="px-3 py-2.5">Game TMP</th><th className="px-3 py-2.5">Odds TMP roll</th></tr>
                </thead>
                <tbody>
                  {sample.matches.map((match) => (
                    <tr key={match.fixtureId} className="border-t border-[#ebe9e1]" data-testid={`performance-match-row-${sample.side}-${match.fixtureId}`}>
                      <td className="px-4 py-2.5 text-[#52615e]">{match.dateLabel} · {match.opponent}</td>
                      <td className="mono px-3 py-2.5 font-bold text-[#56685d]">{match.outcome} · {match.scoreLabel}</td>
                      <td className="mono px-3 py-2.5 text-[#66716d]">{match.goalsFor} / {match.goalsAgainst}</td>
                      <td className="px-3 py-2.5 text-[#66716d]">{match.cleanSheet ? 'Yes' : 'No'}</td>
                      <td className="mono px-3 py-2.5 text-[#66716d]">{match.expectedPoints === null ? 'No odds' : `${match.expectedPoints.toFixed(2)} / ${match.actualPoints}`}</td>
                      <td className="mono px-3 py-2.5 text-[#66716d]">{match.gameTmp === null ? '—' : match.gameTmp.toFixed(1)}</td>
                      <td className="mono px-3 py-2.5 font-bold text-[#4f735c]">{match.oddsTmp === null ? '—' : match.oddsTmp.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[#e8e6de] bg-[#f8f7f1] px-4 py-3 sm:px-5" aria-label={`${sample.name} result strip`}>
            <span className="mr-1 text-[8px] font-extrabold uppercase tracking-[.1em] text-[#8d9086]">Oldest → latest</span>
            <div className="flex flex-wrap gap-x-1.5 gap-y-2" data-testid={`performance-result-strip-${sample.side}`}>
              {sample.matches.map((match, index) => <ResultPill key={match.fixtureId} match={match} index={index} />)}
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[8px] text-[#858982]"><i className="size-2 rounded-full bg-[#6f8c77]" /> Clean sheet</span>
          </div>
        </>
      ) : (
        <div className="flex min-h-[240px] flex-col items-center justify-center px-6 py-10 text-center" data-testid={`performance-empty-results-${sample.side}`}>
          <span className="grid size-10 place-items-center rounded-xl bg-[#e9eee8] text-[#708679]"><BarChart3 size={17} /></span>
          <h4 className="mt-3 text-[11px] font-extrabold text-[#3c5058]">No completed scores to chart</h4>
          <p className="mt-1.5 max-w-sm text-[9px] leading-5 text-[#858982]">Recent match records are missing completed scores. No results, goals, or TMP values have been inferred.</p>
        </div>
      )}
    </article>
  );
}

export function PerformanceGraphsPanel({
  details,
  context,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  details: FootballMatchDetails;
  context?: FootballMatchTmpContext;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const home = buildTeamSample(details, context, 'home');
  const away = buildTeamSample(details, context, 'away');

  return (
    <section className="space-y-5" data-testid="panel-performance-graphs" aria-labelledby="performance-panel-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mono text-[9px] uppercase tracking-[.17em] text-[#9b7160]">Recent form · last 15</p>
          <h2 id="performance-panel-title" className="mt-1 text-[20px] font-extrabold tracking-[-.05em] text-[#2b3e49]">Performance graphs</h2>
        </div>
        <p className="max-w-[420px] text-[9px] leading-5 text-[#858982]">Results and goals use completed scores. Odds TMP uses only complete historical 1X2 probabilities; standings and current-match odds are not inputs.</p>
      </div>

      <div className="grid gap-3 rounded-xl border border-[#deddd4] bg-[#f3f2eb] p-3.5 sm:grid-cols-[auto_1fr] sm:items-center sm:p-4" data-testid="performance-method-note">
        <span className="grid size-9 place-items-center rounded-lg bg-[#e6eee8] text-[#537867]"><TrendingUp size={16} /></span>
        <div className="space-y-1">
          <p className="text-[9px] font-extrabold text-[#43575a]">Odds TMP game = 50 + 10(actual pts − expected pts) + 8(goal difference)</p>
          <p className="text-[8px] leading-4 text-[#858982]">Expected points are calculated from normalized historical 1X2 probabilities and the team’s home/away perspective. First covered game starts the roll; later covered games blend 60% prior roll with 40% game TMP.</p>
        </div>
      </div>

      {isError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e3c3b6] bg-[#fff6f0] px-4 py-3 text-[9px] text-[#8c6b5e]" role="alert" data-testid="performance-context-error">
          <span className="inline-flex items-start gap-2"><AlertCircle size={13} className="mt-0.5 shrink-0" />{readError(error)} Result and goals trends remain available from match scores.</span>
          <button type="button" onClick={onRetry} className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-3 text-[8px] font-extrabold text-[#855542] transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9b7160]" data-testid="button-retry-performance-context"><RefreshCw size={11} /> Retry odds history</button>
        </div>
      )}

      {isLoading && !context && (
        <div className="grid gap-4 lg:grid-cols-2" role="status" aria-label="Loading historical odds coverage" data-testid="performance-context-loading">
          {[0, 1].map((item) => (
            <div key={item} className="overflow-hidden rounded-[14px] border border-[#deddd4] bg-[#fbfaf6]">
              <div className="h-[54px] animate-pulse border-b border-[#e8e6de] bg-[#f3f2eb]" />
              <div className="grid grid-cols-3 gap-4 p-4"><div className="h-8 animate-pulse rounded bg-[#eeede6]" /><div className="h-8 animate-pulse rounded bg-[#eeede6]" /><div className="h-8 animate-pulse rounded bg-[#eeede6]" /></div>
              <div className="m-4 h-[190px] animate-pulse rounded-lg bg-[#eeede6]" />
            </div>
          ))}
        </div>
      )}

      {context && !context.oddsHistory.length && (
        <div className="rounded-lg border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-4 py-3 text-[9px] leading-5 text-[#858982]" role="status" data-testid="performance-no-history">
          No historical odds records were returned. Results, goals, clean sheets, and Results TMP remain score-based; Odds TMP is left unavailable.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <TeamPerformanceCard sample={home} />
        <TeamPerformanceCard sample={away} />
      </div>
      <p className="px-1 text-[8px] leading-4 text-[#92948b]" data-testid="performance-source-note">
        Source coverage: up to 15 most recent score-complete fixtures per team. Outcomes are recalculated from each team’s own perspective; the result strip marks clean sheets with a dot.
      </p>
    </section>
  );
}
