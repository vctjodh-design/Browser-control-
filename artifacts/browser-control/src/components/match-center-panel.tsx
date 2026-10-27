import { useMemo } from 'react';
import type {
  FootballLastFiveEvent,
  FootballLastFivePlayer,
  FootballLastFiveStat,
  FootballMatchCenter,
  FootballMatchReplayFormationPlayer,
  FootballMatchReplayShotEvent,
} from '@workspace/api-client-react';
import { Activity, CircleAlert, RefreshCw } from 'lucide-react';
import { RecordedEventPitch } from './recorded-event-pitch';

function readableError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') {
    return error.error;
  }
  return 'The source match data could not be loaded. Try again.';
}

function display(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

type DisplayStat = { label: string; value: string | number | null };
type Metric = { label: string; paths: string[] };

const topMetrics: Metric[] = [
  { label: 'Minutes', paths: ['games minutes', 'minutes'] },
  { label: 'Goals', paths: ['goals total', 'bsd statistics goals'] },
  { label: 'Assists', paths: ['goals assists', 'bsd statistics goal assist'] },
];

const attackingMetrics: Metric[] = [
  { label: 'Expected Goals', paths: ['bsd statistics expected goals', 'expected goals'] },
  { label: 'Total Shots', paths: ['shots total', 'bsd statistics total shots'] },
  { label: 'Shots On Target', paths: ['shots on', 'bsd statistics shots on target'] },
  { label: 'Expected Goals On Target', paths: ['bsd statistics expected goals on target', 'expected goals on target', 'xgot'] },
  { label: 'Offsides', paths: ['offsides', 'bsd statistics total offside'] },
  { label: 'Expected Assists', paths: ['bsd statistics expected assists', 'expected assists'] },
  { label: 'Key Passes', paths: ['passes key', 'bsd statistics key pass'] },
  { label: 'Passes Into Final Third', paths: ['passes final third', 'bsd statistics final third passes'] },
  { label: 'Backward Passes', paths: ['backward passes'] },
  { label: 'Passes Completed', paths: [] },
  { label: 'Successful Dribbles', paths: [] },
  { label: 'Touches', paths: ['bsd statistics touches', 'touches'] },
  { label: 'Was Fouled', paths: ['fouls drawn', 'bsd statistics was fouled'] },
  { label: 'Accurate Passes Into Opposition Half', paths: ['bsd statistics accurate opposition half passes'] },
  { label: 'Pass Attempts Into Opposition Half', paths: ['bsd statistics total opposition half passes'] },
];

const defendingMetrics: Metric[] = [
  { label: 'Fouls Made', paths: ['fouls committed', 'bsd statistics fouls'] },
  { label: 'Possession Lost', paths: ['bsd statistics possession lost', 'bsd statistics dispossessed'] },
  { label: 'Was Dribbled Past', paths: ['was dribbled past'] },
  { label: 'Clearances', paths: ['bsd statistics total clearance', 'clearances'] },
  { label: 'Interceptions', paths: ['tackles interceptions', 'bsd statistics interception'] },
  { label: 'Ball Recovery', paths: ['bsd statistics ball recovery', 'ball recovery'] },
  { label: 'Tackles', paths: ['tackles total', 'bsd statistics total tackle'] },
  { label: 'Tackles Won', paths: ['bsd statistics won tackle'] },
  { label: 'Blocks', paths: ['tackles blocks', 'bsd statistics outfielder block'] },
];

const otherMetrics: Metric[] = [
  { label: 'Duels Won', paths: ['duels won', 'bsd statistics duel won'] },
  { label: 'Yellow Cards', paths: ['cards yellow', 'bsd statistics yellow card'] },
  { label: 'Red Cards', paths: ['cards red', 'bsd statistics red card'] },
  { label: 'Saves', paths: ['goals saves', 'bsd statistics saves'] },
  { label: 'Big Chances Created', paths: ['bsd statistics big chance created'] },
  { label: 'Big Chances Missed', paths: ['bsd statistics big chance missed'] },
  { label: 'Progressive Carries', paths: ['bsd statistics progressive ball carries count'] },
];

function statPath(stat: FootballLastFiveStat) {
  return stat.label
    .replace(/^Player\s*·\s*/i, '')
    .replaceAll(' · ', ' ')
    .toLowerCase()
    .replaceAll('_', ' ')
    .trim();
}

function cleanStatLabel(label: string) {
  return label
    .split(' · ')
    .map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' '))
    .join(' · ');
}

function metricValue(player: FootballLastFivePlayer, metric: Metric): string | number | null {
  for (const path of metric.paths) {
    const row = player.statistics.find((stat) => statPath(stat).endsWith(path));
    if (row && row.value !== null) return row.value;
  }
  if (metric.label === 'Passes Completed') {
    const accurate = metricValue(player, { label: '', paths: ['bsd statistics accurate pass', 'passes accuracy'] });
    const attempted = metricValue(player, { label: '', paths: ['bsd statistics total pass', 'passes total'] });
    const completedNumber = Number(accurate);
    const attemptedNumber = Number(attempted);
    if (accurate !== null && attempted !== null && Number.isFinite(completedNumber) && Number.isFinite(attemptedNumber) && attemptedNumber > 0) {
      return `${completedNumber}/${attemptedNumber} (${Math.round((completedNumber / attemptedNumber) * 100)}%)`;
    }
  }
  if (metric.label === 'Successful Dribbles') {
    const successful = metricValue(player, { label: '', paths: ['dribbles success'] });
    const attempted = metricValue(player, { label: '', paths: ['dribbles attempts'] });
    const successfulNumber = Number(successful);
    const attemptedNumber = Number(attempted);
    if (successful !== null && attempted !== null && Number.isFinite(successfulNumber) && Number.isFinite(attemptedNumber)) {
      return attemptedNumber > 0
        ? `${successfulNumber}/${attemptedNumber} (${Math.round((successfulNumber / attemptedNumber) * 100)}%)`
        : `${successfulNumber}/${attemptedNumber}`;
    }
  }
  return null;
}

function metricRows(player: FootballLastFivePlayer, metrics: Metric[]): DisplayStat[] {
  return metrics.map((metric) => {
    const value = metricValue(player, metric);
    if (
      value !== null &&
      Number.isFinite(Number(value)) &&
      /expected goals|expected assists/i.test(metric.label)
    ) {
      return {
        label: metric.label,
        value: Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, ''),
      };
    }
    return { label: metric.label, value };
  });
}

function PlayerStatList({ title, rows }: { title: string; rows: DisplayStat[] }) {
  return (
    <section>
      <h5 className="mb-2 text-[9px] font-extrabold uppercase tracking-[.13em] text-[#77847c]">{title}</h5>
      {rows.length ? (
        <div className="divide-y divide-[#eceae2] overflow-hidden rounded-lg border border-[#e5e3da] bg-[#fcfbf7]">
          {rows.map((stat, index) => (
            <div key={`${stat.label}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-[9px]">
              <span className="text-[#758078]">{cleanStatLabel(stat.label)}</span>
              <span className="mono text-right font-medium text-[#40564e]">{display(stat.value)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-[#deddd4] px-3 py-3 text-[9px] text-[#95978e]">No values returned for this group.</p>
      )}
    </section>
  );
}

function PlayerCard({ player }: { player: FootballLastFivePlayer }) {
  const topStats = useMemo(() => metricRows(player, topMetrics), [player]);
  const groups = useMemo(() => ({
    attacking: metricRows(player, attackingMetrics),
    defending: metricRows(player, defendingMetrics),
    other: metricRows(player, otherMetrics).filter((stat) =>
      stat.value !== null && !/^0(?:\.0+)?$/.test(String(stat.value)),
    ),
  }), [player]);

  return (
    <details className="overflow-hidden rounded-xl border border-[#e2e0d7] bg-[#fbfaf6]" data-testid={`match-center-player-${player.id ?? player.name}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 outline-none transition hover:bg-[#f4f3ed] focus-visible:ring-2 focus-visible:ring-[#9b7160]">
        {player.photo ? (
          <img src={player.photo} alt="" loading="lazy" className="size-10 shrink-0 rounded-full border border-[#e1dfd6] bg-white object-cover" />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#e9eee8] text-[10px] font-extrabold text-[#64806d]">{player.name.slice(0, 2).toUpperCase()}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] font-extrabold text-[#43574f]">{player.name}</span>
          <span className="mt-0.5 block truncate text-[8px] text-[#93968d]">{[player.number === null ? null : `#${player.number}`, player.position].filter(Boolean).join(' · ') || 'Position unavailable'}</span>
        </span>
        <span className="mono rounded-md bg-[#f1efe7] px-2 py-1 text-[8px] text-[#726d5e]">Rating {display(player.rating)}</span>
        <span aria-hidden="true" className="mono text-[12px] text-[#8a9289]">⌄</span>
      </summary>
      <div className="border-t border-[#e5e3da] p-3">
        <h4 className="mb-2 text-[9px] font-extrabold uppercase tracking-[.13em] text-[#77847c]">Top stats</h4>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {topMetrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-[#e5e3da] bg-[#fcfbf7] px-2 py-2.5 text-center">
              <p className="mono text-[13px] font-semibold text-[#344c43]">{display(metricValue(player, metric))}</p>
              <p className="mt-1 text-[8px] text-[#92968c]">{metric.label === 'Minutes' ? 'Min' : metric.label}</p>
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <PlayerStatList title="Attacking" rows={groups.attacking} />
          <PlayerStatList title="Defending" rows={groups.defending} />
          {groups.other.length > 0 && <PlayerStatList title="Other source stats" rows={groups.other} />}
        </div>
      </div>
    </details>
  );
}

function EventRow({ event, index }: { event: FootballLastFiveEvent; index: number }) {
  const isShot = /shot/i.test(event.type);
  const eventName = [event.type, event.detail].filter(Boolean).join(' · ');
  const actor = [
    event.player,
    event.assist ? `Assist: ${event.assist}` : null,
    event.teamName,
  ].filter(Boolean).join(' · ');

  return (
    <article className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 border-b border-[#eceae2] px-3 py-3 last:border-0" data-testid={`match-center-event-${index}`}>
      <span className="mono h-fit rounded-md bg-[#eef0e9] px-1.5 py-1 text-center text-[8px] text-[#62796a]">
        {event.minute === null ? '—' : `${event.minute}${event.extraMinute !== null ? `+${event.extraMinute}` : ''}′`}
      </span>
      <div className="min-w-0">
        <p className="text-[9px] font-bold text-[#4d6057]">
          {eventName || 'Match event'}
          {isShot && <span className="ml-2 rounded-full bg-[#f7e8df] px-1.5 py-0.5 text-[7px] uppercase tracking-wide text-[#a45c45]">Shot</span>}
        </p>
        <p className="mt-1 truncate text-[8px] text-[#828980]">{actor || 'Player details not supplied'}</p>
        {event.comments && <p className="mt-1 text-[8px] leading-4 text-[#999b92]">{event.comments}</p>}
      </div>
    </article>
  );
}

export function MatchCenterPanel({
  data,
  isLoading,
  isError,
  error,
  onRetry,
  shotEvents,
  formationPlayers,
  shotFeedLoading,
  shotFeedError,
  onRetryShotFeed,
}: {
  data?: FootballMatchCenter;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  shotEvents?: FootballMatchReplayShotEvent[];
  formationPlayers?: FootballMatchReplayFormationPlayer[];
  shotFeedLoading: boolean;
  shotFeedError: unknown;
  onRetryShotFeed: () => void;
}) {
  if (isLoading && !data) {
    return (
      <section className="space-y-3" role="status" aria-label="Loading live match data" data-testid="status-match-center-loading">
        <div className="h-14 animate-pulse rounded-xl bg-[#eeede6]" />
        <div className="h-44 animate-pulse rounded-xl bg-[#eeede6]" />
        <div className="h-64 animate-pulse rounded-xl bg-[#eeede6]" />
      </section>
    );
  }

  if (isError && !data) {
    return (
      <section className="flex min-h-[250px] flex-col items-center justify-center rounded-xl border border-[#e3c3b6] bg-[#fff6f0] px-6 py-10 text-center" role="alert" data-testid="status-match-center-error">
        <span className="grid size-10 place-items-center rounded-xl bg-[#f6e2d8] text-[#b85b46]"><CircleAlert size={17} /></span>
        <h2 className="mt-3 text-[14px] font-extrabold text-[#784b3e]">Live match data unavailable</h2>
        <p className="mt-1.5 max-w-md text-[10px] leading-5 text-[#8c6b5e]">{readableError(error)}</p>
        <button type="button" onClick={onRetry} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-3 text-[9px] font-extrabold text-[#855542] hover:bg-white" data-testid="button-retry-match-center"><RefreshCw size={12} /> Try again</button>
      </section>
    );
  }

  if (!data) return null;

  const isLive = /\b(live|in play|in progress|first half|second half|1st half|2nd half|1h|2h|half[ -]?time|halftime)\b/i.test(data.match.status);
  const events = [...data.events].sort((left, right) =>
    (right.minute ?? -1) - (left.minute ?? -1) ||
    (right.extraMinute ?? 0) - (left.extraMinute ?? 0),
  );
  const observedLabel = new Date(data.observedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <section className="space-y-5" data-testid="panel-match-center">
      <header className="rounded-xl border border-[#d9e0d6] bg-[#f0f4ed] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Source match feed</p>
            <h2 className="mt-1 text-[15px] font-extrabold text-[#344550]">{data.match.home.name} {display(data.match.home.score)} : {display(data.match.away.score)} {data.match.away.name}</h2>
          <p className="mt-1 text-[9px] text-[#727973]">
            {data.elapsedMinute !== null ? `${data.elapsedMinute}′ · ` : ''}{data.match.status}
            {isLive ? ' · Updating every 15 seconds' : ''}
          </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#d9dfd5] bg-[#f8faf5] px-2.5 py-1.5 text-[8px] text-[#68796e]">
            <Activity size={12} className={isLive ? 'text-[#c5654a]' : 'text-[#68816e]'} />
            <span>{isLive ? 'LIVE' : 'SOURCE DATA'}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#dfe5db] pt-2.5">
          <p className="mono text-[8px] text-[#899087]">Source snapshot · {observedLabel}</p>
          <button type="button" onClick={onRetry} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#d9dfd5] bg-[#fafbf8] px-2.5 text-[8px] font-bold text-[#60716a] hover:bg-white" data-testid="button-refresh-match-center"><RefreshCw size={11} /> Refresh</button>
        </div>
      </header>

      {data.issues.length > 0 && (
        <div className="space-y-1.5" role="status" data-testid="match-center-issues">
          {data.issues.map((issue, index) => <p key={`${issue}-${index}`} className="flex items-start gap-2 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2.5 text-[9px] leading-4 text-[#84684f]"><CircleAlert size={12} className="mt-0.5 shrink-0" />{issue}</p>)}
        </div>
      )}

      <section data-testid="match-center-shot-feed">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-extrabold uppercase tracking-[.13em] text-[#77847c]">Shot map & shot-by-shot feed</h3>
          {shotEvents && <span className="mono text-[8px] text-[#9a9d93]">{shotEvents.length} recorded shots</span>}
        </div>
        {isLive && <p className="mb-2 text-[8px] text-[#858982]">Player totals refresh every 15 seconds; the separate shot feed refreshes about once a minute.</p>}
        {shotEvents?.length ? (
          <RecordedEventPitch
            homeTeam={data.match.home.name}
            awayTeam={data.match.away.name}
            shotEvents={shotEvents}
            formationPlayers={formationPlayers ?? []}
          />
        ) : shotFeedLoading ? (
          <p className="rounded-lg border border-[#e5e3da] bg-[#f7f6f0] px-3 py-3 text-[9px] leading-4 text-[#858982]" role="status" data-testid="status-match-center-shots-loading">
            Loading the separate shot feed. The live score and player statistics above remain available while it loads.
          </p>
        ) : shotFeedError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-3 text-[9px] leading-4 text-[#84684f]" role="status" data-testid="status-match-center-shots-error">
            <span>{readableError(shotFeedError)}</span>
            <button type="button" onClick={onRetryShotFeed} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#e5c5b8] bg-[#fffaf6] px-2.5 text-[8px] font-bold text-[#855542] hover:bg-white" data-testid="button-retry-match-center-shots"><RefreshCw size={11} /> Retry shots</button>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[#deddd4] bg-[#f7f6f0] px-3 py-3 text-[9px] leading-4 text-[#95978e]" data-testid="status-match-center-shots-empty">
            The source has not returned shot coordinates for this fixture. Player shot totals remain listed in each player card.
          </p>
        )}
      </section>

      <section data-testid="match-center-events">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-extrabold uppercase tracking-[.13em] text-[#77847c]">Match events</h3>
          <span className="mono text-[8px] text-[#9a9d93]">{events.length} source events</span>
        </div>
        {events.length ? (
          <div className="overflow-hidden rounded-xl border border-[#e5e3da] bg-[#fcfbf7]">
            {events.map((event, index) => <EventRow key={`${event.minute}-${event.type}-${event.playerId}-${index}`} event={event} index={index} />)}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[#deddd4] bg-[#f7f6f0] px-3 py-3 text-[9px] leading-4 text-[#95978e]">The source has not returned event rows for this fixture yet.</p>
        )}
      </section>

      <section data-testid="match-center-team-statistics">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-extrabold uppercase tracking-[.13em] text-[#77847c]">Team statistics</h3>
          <span className="mono text-[8px] text-[#9a9d93]">{data.statistics.length} teams</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.statistics.map((team, index) => (
            <section key={`${team.teamId ?? team.teamName}-${index}`} className="rounded-xl border border-[#e5e3da] bg-[#fcfbf7] p-3" data-testid={`match-center-team-${team.teamId ?? index}`}>
              <h4 className="mb-2 text-[9px] font-extrabold text-[#52635a]">{team.teamName}</h4>
          <PlayerStatList
            title="Full-match totals"
            rows={team.statistics
              .filter((stat) => stat.label.startsWith('Full match · '))
              .map((stat) => ({ ...stat, label: stat.label.replace(/^Full match\s*·\s*/, '') }))}
          />
            </section>
          ))}
        </div>
        {!data.statistics.length && <p className="rounded-lg border border-dashed border-[#deddd4] bg-[#f7f6f0] px-3 py-3 text-[9px] text-[#95978e]">Team statistics were not provided for this match.</p>}
      </section>

      <section data-testid="match-center-player-statistics">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-extrabold uppercase tracking-[.13em] text-[#77847c]">Player statistics</h3>
          <span className="mono text-[8px] text-[#9a9d93]">{data.players.reduce((total, group) => total + group.players.length, 0)} players</span>
        </div>
        <p className="mb-3 text-[9px] leading-4 text-[#858982]">Open a player for their source-reported minutes, goals, assists, shooting, passing, dribbling, and defensive totals. Missing values stay blank rather than being estimated.</p>
        <div className="space-y-3">
          {data.players.map((group, groupIndex) => (
            <section key={`${group.teamId ?? group.teamName}-${groupIndex}`} className="rounded-xl border border-[#e5e3da] bg-[#f7f6f0] p-3" data-testid={`match-center-player-group-${group.teamId ?? groupIndex}`}>
              <h4 className="mb-2 text-[9px] font-extrabold text-[#52635a]">{group.teamName}</h4>
              {group.players.length ? (
                <div className="space-y-2">
                  {group.players.map((player, playerIndex) => <PlayerCard key={`${player.id ?? player.name}-${playerIndex}`} player={player} />)}
                </div>
              ) : (
                <p className="text-[9px] text-[#95978e]">No player records were returned.</p>
              )}
            </section>
          ))}
        </div>
        {!data.players.length && <p className="rounded-lg border border-dashed border-[#deddd4] bg-[#f7f6f0] px-3 py-3 text-[9px] text-[#95978e]">Player statistics are not available in the source response for this fixture.</p>}
      </section>

      <p className="rounded-lg border border-[#e5e3da] bg-[#f7f6f0] px-3.5 py-3 text-[9px] leading-4 text-[#8b8d84]">
        This feed shows source-provided events and aggregate player stats. It does not supply a continuous sequence for every pass, dribble, or tackle, or verified player heatmap positions.
      </p>
    </section>
  );
}
