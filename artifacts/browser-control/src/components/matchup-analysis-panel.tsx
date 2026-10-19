import type { FootballMatchLastFive } from '@workspace/api-client-react';
import { buildMatchupAnalysis } from '@/lib/matchup-analysis';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { MatchupTeamAnalysis } from '@/lib/matchup-analysis';

const HOME = '#c97555';
const AWAY = '#557b68';
const GRID = '#e6e4db';
const TICK = '#878c83';

function number(value: number | null, digits = 2) {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function percent(value: number | null) {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(parsed);
}

function Card({ title, eyebrow, children, testId }: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  testId: string;
}) {
  return <section className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]" data-testid={testId}>
    <header className="border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3">
      {eyebrow && <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">{eyebrow}</p>}
      <h3 className="mt-0.5 text-[11px] font-extrabold text-[#43575a]">{title}</h3>
    </header>
    <div className="p-4">{children}</div>
  </section>;
}

function valueLabel(value: number | null, unit: string) {
  if (value === null) return 'Not enough data';
  return `${number(value)}${unit === '%' ? '%' : ` ${unit}`}`;
}

function TeamEvidence({ team, accent, testId }: { team: MatchupTeamAnalysis; accent: string; testId: string }) {
  return <article className="min-w-0 rounded-lg border border-[#e4e2d9] bg-[#fcfbf7] p-3.5" data-testid={testId}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-[11px] font-extrabold text-[#40534f]">{team.name}</p>
        <p className="mono mt-1 text-[8px] text-[#8c9188]">{team.sample} completed matches · {team.wins}W {team.draws}D {team.losses}L</p>
      </div>
      <span className="mono shrink-0 rounded-md px-2 py-1 text-[9px] font-medium" style={{ color: accent, backgroundColor: `${accent}16` }}>
        {team.pointsPerMatch === null ? '—' : `${team.pointsPerMatch.toFixed(2)} pts / match`}
      </span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
      {[
        ['Goals for', valueLabel(team.goalsForAverage, '/ match')],
        ['Goals against', valueLabel(team.goalsAgainstAverage, '/ match')],
        ['xG for', valueLabel(team.expectedGoalsForAverage, '/ match')],
        ['xG against', valueLabel(team.expectedGoalsAgainstAverage, '/ match')],
        ['Shots on target', valueLabel(team.shotsOnTargetAverage, '/ match')],
        ['Possession', percent(team.possessionAverage)],
      ].map(([label, val]) => <div key={label} className="border-l border-[#e2e1d8] pl-2.5">
        <p className="text-[7px] font-bold uppercase tracking-[.08em] text-[#92968d]">{label}</p>
        <p className="mono mt-1 text-[11px] text-[#4b6258]">{val}</p>
      </div>)}
    </div>
    <p className="mt-3 border-t border-[#eceae2] pt-2.5 text-[8px] leading-4 text-[#858982]" data-testid={`${testId}-coverage`}>
      xG coverage: {team.expectedGoalsCoverage}/{team.sample} matches with both sides recorded.
      {team.passAccuracyAverage !== null ? ` Pass accuracy ${percent(team.passAccuracyAverage)}.` : ' Pass accuracy not returned.'}
      {team.bigChancesForAverage !== null ? ` Big chances ${number(team.bigChancesForAverage)} for / ${number(team.bigChancesAgainstAverage)} against per match.` : ' Big-chance data not returned.'}
    </p>
  </article>;
}

function Trends({ home, away }: { home: MatchupTeamAnalysis; away: MatchupTeamAnalysis }) {
  const rows = [
    ...home.trends.map((point) => ({ ...point, side: home.name, color: HOME })),
    ...away.trends.map((point) => ({ ...point, side: away.name, color: AWAY })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const shared = new Map<number, { date: string; homeGoals: number | null; awayGoals: number | null; homeXg: number | null; awayXg: number | null; homeLabel: string; awayLabel: string }>();
  home.trends.forEach((point, index) => {
    shared.set(point.fixtureId, {
      date: date(point.date), homeGoals: point.goalsFor, awayGoals: point.goalsAgainst,
      homeXg: point.expectedGoalsFor, awayXg: point.expectedGoalsAgainst,
      homeLabel: `${point.opponent} · ${point.score}`,
      awayLabel: '',
    });
  });
  away.trends.forEach((point) => {
    const row = shared.get(point.fixtureId);
    if (row) {
      row.awayGoals = point.goalsFor;
      row.awayXg = point.expectedGoalsFor;
      row.awayLabel = `${point.opponent} · ${point.score}`;
    }
  });
  const trendRows = rows.map((point, index) => ({
    ...point,
    label: `${point.side === home.name ? 'H' : 'A'} · ${date(point.date)} · ${point.opponent}`,
    order: index + 1,
  }));
  const bothXg = [...home.trends, ...away.trends].filter((point) => point.expectedGoalsFor !== null).length;
  return <div className="space-y-5">
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[8px] font-bold uppercase tracking-[.1em] text-[#858982]">Goals scored and conceded · chronological</p>
        <p className="mono text-[8px] text-[#9a9c93]">Each point is one completed match</p>
      </div>
      {trendRows.length ? <div className="h-[230px] w-full" data-testid="matchup-trend-chart">
        <ResponsiveContainer width="100%" height="100%" debounce={0}>
          <LineChart data={trendRows} margin={{ top: 8, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 4" />
            <XAxis dataKey="label" hide />
            <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: TICK }} stroke={GRID} />
            <Tooltip isAnimationActive={false} cursor={{ stroke: '#c8c7bd', strokeDasharray: '3 3' }} contentStyle={{ border: '1px solid #deddd4', borderRadius: 8, fontSize: 10, background: '#fbfaf6' }} labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ''} />
            <Line dataKey="goalsFor" name="Goals for" stroke={HOME} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
            <Line dataKey="goalsAgainst" name="Goals against" stroke={AWAY} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div> : <p className="rounded-lg border border-dashed border-[#deddd4] px-3 py-5 text-center text-[9px] text-[#898d84]">No completed score trend is available.</p>}
      <div className="mt-2 flex flex-wrap gap-3 text-[8px] text-[#737d76]"><span><i className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ background: HOME }} />Goals for</span><span><i className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ background: AWAY }} />Goals against</span></div>
    </div>
    <div className="border-t border-[#e8e6de] pt-4">
      <p className="mb-2 text-[8px] font-bold uppercase tracking-[.1em] text-[#858982]">Recent match evidence, by side</p>
      {bothXg ? <div className="overflow-x-auto">
        <table className="w-full min-w-[500px] text-left text-[8px]" data-testid="matchup-trend-table">
          <thead className="text-[7px] uppercase tracking-[.08em] text-[#92968d]"><tr><th className="pb-2">Side / opponent</th><th className="pb-2 text-center">Score</th><th className="pb-2 text-center">xG for</th><th className="pb-2 text-center">xG against</th><th className="pb-2 text-center">Shots</th><th className="pb-2 text-center">Poss.</th></tr></thead>
          <tbody>{trendRows.map((point) => <tr key={`${point.fixtureId}-${point.side}`} className="border-t border-[#eceae2]" data-testid={`matchup-trend-${point.fixtureId}-${point.side === home.name ? 'home' : 'away'}`}>
            <td className="py-2 pr-2"><span className="font-bold text-[#56675f]">{point.side === home.name ? 'H' : 'A'}</span> · {point.opponent} <span className="text-[#989a91]">· {date(point.date)}</span></td>
            <td className="mono py-2 text-center">{point.score}</td><td className="mono py-2 text-center">{number(point.expectedGoalsFor)}</td><td className="mono py-2 text-center">{number(point.expectedGoalsAgainst)}</td><td className="mono py-2 text-center">{point.shotsFor ?? '—'} / {point.shotsAgainst ?? '—'}</td><td className="mono py-2 text-center">{percent(point.possession)}</td>
          </tr>)}</tbody>
        </table>
        <p className="mt-2 text-[7px] leading-4 text-[#92958b]">{bothXg} match-side xG observations returned across the sample. Missing observations remain blank; no xG timeline or shot locations are supplied.</p>
      </div> : <p className="rounded-lg border border-dashed border-[#deddd4] px-3 py-4 text-[9px] leading-4 text-[#898d84]">xG, shot, and possession detail was not returned for these recent matches. The score chart above uses observed final scores only.</p>}
    </div>
  </div>;
}

function LossReviews({ team }: { team: MatchupTeamAnalysis }) {
  return <div className="space-y-2" data-testid={`matchup-losses-${team.id}`}>
    <p className="mb-2 text-[8px] leading-4 text-[#868a81]">{team.name}: {team.losses} losses in {team.sample} completed matches.</p>
    {team.lossReviews.length ? team.lossReviews.map((loss) => <article key={loss.fixtureId} className="rounded-lg border border-[#e7ddd3] bg-[#faf6f0] p-3" data-testid={`matchup-loss-${team.id}-${loss.fixtureId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[9px] font-extrabold text-[#5e514a]">{loss.opponent} · {loss.score}</p><span className="mono text-[8px] text-[#999187]">{date(loss.date)}</span></div>
      <p className="mt-1.5 text-[8px] leading-4 text-[#7e756d]">
        {loss.expectedGoalsFor !== null || loss.expectedGoalsAgainst !== null ? `xG ${number(loss.expectedGoalsFor)} for / ${number(loss.expectedGoalsAgainst)} against` : 'xG not recorded'}
        {loss.shotsFor !== null || loss.shotsAgainst !== null ? ` · shots ${loss.shotsFor ?? '—'} / ${loss.shotsAgainst ?? '—'}` : ' · shot totals not recorded'}
        {loss.bigChancesFor !== null || loss.bigChancesAgainst !== null ? ` · big chances ${loss.bigChancesFor ?? '—'} / ${loss.bigChancesAgainst ?? '—'}` : ''}
        {loss.errorsLeadingToGoal !== null ? ` · errors leading to goal ${loss.errorsLeadingToGoal}` : ''}
      </p>
    </article>) : <p className="rounded-lg border border-dashed border-[#deddd4] px-3 py-4 text-[8px] text-[#898d84]" data-testid={`matchup-losses-empty-${team.id}`}>{team.sample ? 'No losses in this sample.' : 'Insufficient completed matches to review losses.'}</p>}
  </div>;
}

function TeamTactics({ team }: { team: MatchupTeamAnalysis }) {
  const substitutions = team.substitutions;
  return <article className="rounded-lg border border-[#e5e3da] bg-[#fcfbf7] p-3.5" data-testid={`matchup-tactics-${team.id}`}>
    <p className="text-[10px] font-extrabold text-[#4b5d55]">{team.name}</p>
    <div className="mt-2">
      <p className="text-[7px] font-bold uppercase tracking-[.1em] text-[#92968d]">Observed formations</p>
      {team.formations.length ? <div className="mt-1.5 flex flex-wrap gap-1.5">{team.formations.map((formation) => <span key={formation.name} className="mono rounded-md border border-[#e3e4d9] bg-[#f3f4ed] px-2 py-1 text-[8px] text-[#607366]" data-testid={`matchup-formation-${team.id}-${formation.name}`}>{formation.name} · {formation.count}</span>)}</div> : <p className="mt-1 text-[8px] text-[#96998f]">Formation data not returned.</p>}
    </div>
    <div className="mt-3 border-t border-[#eceae2] pt-2.5">
      <p className="text-[7px] font-bold uppercase tracking-[.1em] text-[#92968d]">Substitution and later-goal record</p>
      {substitutions.matchesWithChanges ? <p className="mt-1.5 text-[8px] leading-4 text-[#737d76]" data-testid={`matchup-subs-${team.id}`}>
        Changes recorded in {substitutions.matchesWithChanges} matches; {number(substitutions.changesPerMatch)} changes per match across returned events; first change at {substitutions.firstChangeMinute === null ? '—' : `${number(substitutions.firstChangeMinute, 0)}′`}.
        After the first change, goals recorded: {substitutions.goalsForAfterFirstChange} for and {substitutions.goalsAgainstAfterFirstChange} against. This is timing context only, not evidence of causation.
      </p> : <p className="mt-1 text-[8px] text-[#96998f]" data-testid={`matchup-subs-${team.id}`}>Substitution events were not recorded in the sample.</p>}
    </div>
  </article>;
}

function PlayerSection({ team }: { team: MatchupTeamAnalysis }) {
  return <section className="rounded-lg border border-[#e5e3da] bg-[#fcfbf7] p-3.5" data-testid={`matchup-players-${team.id}`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="text-[10px] font-extrabold text-[#4b5d55]">{team.name}</h4><span className="mono text-[8px] text-[#92968d]">leaders from returned player records</span></div>
    {team.playerLeaders.length ? <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-left text-[8px]" data-testid={`matchup-player-table-${team.id}`}>
        <thead className="text-[7px] uppercase tracking-[.08em] text-[#92968d]"><tr><th className="pb-2">Player</th><th className="pb-2 text-center">Apps / starts</th><th className="pb-2 text-center">Mins</th><th className="pb-2 text-center">Rating</th><th className="pb-2 text-center">G / A</th><th className="pb-2 text-center">xG / xA</th><th className="pb-2 text-center">Key pass / tackles</th></tr></thead>
        <tbody>{team.playerLeaders.map((player) => <tr key={player.id ?? player.name} className="border-t border-[#eceae2]" data-testid={`matchup-player-${team.id}-${player.id ?? player.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
          <td className="py-2 pr-2"><span className="font-bold text-[#52615b]">{player.name}</span>{player.position && <span className="ml-1 text-[#96998f]">{player.position}</span>}</td>
          <td className="mono py-2 text-center">{player.appearances} / {player.starts}</td><td className="mono py-2 text-center">{player.minutes}</td><td className="mono py-2 text-center">{number(player.averageRating)}</td><td className="mono py-2 text-center">{player.goals} / {player.assists}</td><td className="mono py-2 text-center">{number(player.expectedGoals)} / {number(player.expectedAssists)}</td><td className="mono py-2 text-center">{player.keyPasses} / {player.tackles}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="rounded-lg border border-dashed border-[#deddd4] px-3 py-4 text-[8px] text-[#898d84]">Player records are not sufficient to compare leaders.</p>}
    <div className="mt-3 space-y-2">
      <p className="text-[7px] leading-4 text-[#8b8f86]">Availability labels below describe record presence only: “played” means listed player minutes were greater than zero; “not listed/not on pitch” means no appearance was recorded. This does not identify why.</p>
      {team.playerAvailability.length ? team.playerAvailability.map((row) => <div key={row.playerId ?? row.playerName} className="grid gap-2 rounded-md bg-[#f5f4ed] px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid={`matchup-availability-${team.id}-${row.playerId ?? row.playerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
        <p className="truncate text-[8px] font-bold text-[#59675f]">{row.playerName} <span className="font-normal text-[#8d9188]">· {row.coverage} covered matches</span></p>
        <p className="mono text-[7px] leading-4 text-[#727d75]">played {row.withMatches}: {number(row.pointsPerMatchWith)} pts/m · GD {number(row.goalDifferenceWith)} <span className="px-1 text-[#aaa99f]">/</span> not listed/not on pitch {row.withoutMatches}: {number(row.pointsPerMatchWithout)} pts/m · GD {number(row.goalDifferenceWithout)}</p>
      </div>) : <p className="text-[8px] text-[#96998f]">With/without comparison needs at least two covered lineup and player-stat records.</p>}
    </div>
  </section>;
}

export function MatchupAnalysisPanel({ data, isLoading, isError, error, onRetry }: {
  data?: FootballMatchLastFive;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (isLoading) return <section aria-label="Loading matchup analysis" role="status" data-testid="status-matchup-loading">
    <div className="mb-5 space-y-2"><div className="h-2 w-28 animate-pulse rounded bg-[#e5e3da]" /><div className="h-6 w-52 animate-pulse rounded bg-[#e5e3da]" /></div>
    <div className="space-y-4"><div className="h-28 animate-pulse rounded-xl bg-[#eeede6]" /><div className="h-64 animate-pulse rounded-xl bg-[#eeede6]" /><div className="grid gap-3 sm:grid-cols-2"><div className="h-36 animate-pulse rounded-xl bg-[#eeede6]" /><div className="h-36 animate-pulse rounded-xl bg-[#eeede6]" /></div></div>
  </section>;

  if (isError) return <section className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-[#e3c3b6] bg-[#fff6f0] px-6 py-9 text-center" role="alert" data-testid="status-matchup-error">
    <AlertCircle size={18} className="text-[#b85b46]" /><h2 className="mt-3 text-[13px] font-extrabold text-[#784b3e]">Matchup evidence unavailable</h2>
    <p className="mt-1.5 max-w-md text-[9px] leading-5 text-[#8c6b5e]">{error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Recent match details could not be loaded. The fixture itself is still available.'}</p>
    <button type="button" onClick={onRetry} className="mt-4 inline-flex h-8 items-center gap-2 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-3 text-[8px] font-extrabold text-[#855542] hover:bg-white" data-testid="button-retry-matchup"><RefreshCw size={11} /> Retry evidence</button>
  </section>;

  if (!data) return <section className="rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-6 py-9 text-center" data-testid="status-matchup-empty">
    <h2 className="text-[12px] font-extrabold text-[#52635a]">No matchup sample returned</h2><p className="mt-1.5 text-[9px] text-[#92958c]">There are no recent match records to compare yet.</p>
    <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[8px] font-bold text-[#718079] hover:bg-[#eeede6]" data-testid="button-retry-matchup-empty"><RefreshCw size={10} /> Try again</button>
  </section>;

  const analysis = buildMatchupAnalysis(data);
  const { home, away } = analysis;
  const comparisonData = analysis.comparisons.map((row) => ({
    label: row.label,
    home: row.homeValue,
    away: row.awayValue,
    unit: row.unit,
  })).filter((row) => row.home !== null || row.away !== null);
  const pairedXg = home.expectedGoalsCoverage + away.expectedGoalsCoverage;
  return <section className="space-y-5" data-testid="panel-matchup-analysis">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="mono text-[9px] uppercase tracking-[.17em] text-[#9b7160]">Recent evidence · fixture {data.fixtureId}</p>
        <h2 className="mt-1 text-[20px] font-extrabold tracking-[-.05em] text-[#2b3e49]">Matchup analysis</h2>
        <p className="mt-1 text-[9px] text-[#858982]">A five-match scouting read. Observed records are separated from interpretation.</p></div>
      <span className="mono rounded-md border border-[#dcded3] bg-[#f3f4ed] px-2.5 py-1.5 text-[8px] text-[#748078]" data-testid="matchup-sample-count">{home.sample}/5 home · {away.sample}/5 away</span>
    </header>

    {(data.issues.length > 0 || home.sample < 5 || away.sample < 5) && <div className="space-y-1.5" role="status" data-testid="matchup-partial-notice">
      {data.issues.map((issue, index) => <p key={`${issue}-${index}`} className="rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2 text-[8px] leading-4 text-[#84684f]">{issue}</p>)}
      {(home.sample < 5 || away.sample < 5) && <p className="rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2 text-[8px] leading-4 text-[#84684f]">Partial sample: completed records returned are {home.sample}/5 for {home.name} and {away.sample}/5 for {away.name}. Missing data is not treated as a negative result.</p>}
    </div>}

    <Card title="The short read" eyebrow="Observed signal, not a match script" testId="matchup-summary">
      <div className="grid gap-3 sm:grid-cols-2"><TeamEvidence team={home} accent={HOME} testId={`matchup-team-${home.id}`} /><TeamEvidence team={away} accent={AWAY} testId={`matchup-team-${away.id}`} /></div>
      <ul className="mt-4 space-y-2">
        {[...home.evidence.map((text) => ({ team: home.name, text })), ...away.evidence.map((text) => ({ team: away.name, text }))].length
          ? [...home.evidence.map((text) => ({ team: home.name, text })), ...away.evidence.map((text) => ({ team: away.name, text }))].map((item, index) => <li key={`${item.team}-${index}`} className="flex gap-2 text-[9px] leading-5 text-[#68756d]" data-testid={`matchup-evidence-${index}`}><span className="mono mt-0.5 shrink-0 text-[8px] text-[#9b7160]">{item.team === home.name ? 'H' : 'A'}</span><span><strong className="text-[#53635b]">{item.team}:</strong> {item.text}</span></li>)
          : <li className="text-[9px] leading-5 text-[#898d84]">Insufficient sample to produce a directional read; the comparisons below show available observations and coverage.</li>}
      </ul>
      <p className="mt-3 border-t border-[#eceae2] pt-2.5 text-[8px] leading-4 text-[#92958b]" data-testid="matchup-sample-limit">Five-match samples are small and may omit relevant context. xG is available for {pairedXg} team-match observations; recorded coverage is shown beside each metric.</p>
    </Card>

    <Card title="Recent match-to-match shape" eyebrow="Results and chance profile" testId="matchup-trends">
      <Trends home={home} away={away} />
    </Card>

    <Card title="Side-by-side measures" eyebrow="Returned match statistics only" testId="matchup-comparisons">
      {comparisonData.length ? <div className="h-[290px] w-full" data-testid="matchup-comparison-chart">
        <ResponsiveContainer width="100%" height="100%" debounce={0}>
          <BarChart data={comparisonData} layout="vertical" margin={{ top: 5, right: 16, left: 4, bottom: 5 }} barGap={3}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 4" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 8, fill: TICK }} stroke={GRID} />
            <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 8, fill: '#68756d' }} stroke={GRID} />
            <Tooltip isAnimationActive={false} cursor={{ fill: '#f0efe8' }} contentStyle={{ border: '1px solid #deddd4', borderRadius: 8, fontSize: 9, background: '#fbfaf6' }} formatter={(value: number, name: string, item) => [`${number(value)} ${item.payload.unit}`, name]} />
            <Bar dataKey="home" name={home.name} fill={HOME} fillOpacity={0.82} radius={[0, 3, 3, 0]} isAnimationActive={false} />
            <Bar dataKey="away" name={away.name} fill={AWAY} fillOpacity={0.82} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div> : <p className="text-[9px] text-[#898d84]">No paired comparison measures were returned.</p>}
      <div className="mt-2 flex flex-wrap gap-4 text-[8px] text-[#737d76]"><span><i className="mr-1.5 inline-block size-2 rounded-sm" style={{ background: HOME }} />{home.name}</span><span><i className="mr-1.5 inline-block size-2 rounded-sm" style={{ background: AWAY }} />{away.name}</span></div>
      <div className="mt-3 overflow-x-auto border-t border-[#eceae2] pt-2">
        <table className="w-full min-w-[430px] text-left text-[8px]" data-testid="matchup-comparison-table">
          <thead className="text-[7px] uppercase tracking-[.08em] text-[#92968d]"><tr><th className="pb-1.5">Measure</th><th className="pb-1.5 text-right">{home.name}</th><th className="pb-1.5 text-right">{away.name}</th></tr></thead>
          <tbody>{analysis.comparisons.map((row) => <tr key={row.label} className="border-t border-[#eceae2]" data-testid={`matchup-comparison-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
            <td className="py-1.5 text-[#68756d]">{row.label}{row.lowerIsBetter ? ' · lower is better' : ''}</td>
            <td className="mono py-1.5 text-right text-[#52635a]">{valueLabel(row.homeValue, row.unit)}</td>
            <td className="mono py-1.5 text-right text-[#52635a]">{valueLabel(row.awayValue, row.unit)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </Card>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Loss review" eyebrow="Observed loss details" testId="matchup-loss-review"><div className="grid gap-3 sm:grid-cols-2"><LossReviews team={home} /><LossReviews team={away} /></div></Card>
      <Card title="Tactical record" eyebrow="Lineups and event timing" testId="matchup-tactical-profile"><div className="grid gap-3 sm:grid-cols-2"><TeamTactics team={home} /><TeamTactics team={away} /></div></Card>
    </div>

    <Card title="Player comparison" eyebrow="Recent player records and availability split" testId="matchup-player-comparison">
      <div className="space-y-3"><PlayerSection team={home} /><PlayerSection team={away} /></div>
      <p className="mt-3 rounded-lg border border-[#e6e4dc] bg-[#f7f6f0] px-3 py-2 text-[8px] leading-4 text-[#858982]">With/without results describe only the sample in which lineup and player-stat records were available. These splits are descriptive, not causal; absence from a record does not establish injury, selection reason, or tactical intent.</p>
    </Card>

    <p className="rounded-lg border border-[#e4d7c9] bg-[#faf4ed] px-3.5 py-2.5 text-[8px] leading-4 text-[#806b59]" data-testid="matchup-data-limitations">Source limits: no shot coordinates, xG progression timeline, or archived completed-fixture odds are available in this feed. Current-fixture markets, when supplied, are shown in the model section below.</p>
  </section>;
}
