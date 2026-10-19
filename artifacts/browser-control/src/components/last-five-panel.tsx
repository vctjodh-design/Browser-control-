import type {
  FootballLastFiveLineup,
  FootballLastFiveMatch,
  FootballLastFivePlayerGroup,
  FootballLastFiveTeam,
  FootballMatchLastFive,
} from '@workspace/api-client-react';
import { ArrowUpRight, CircleAlert, RefreshCw } from 'lucide-react';

function display(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? 'Not available' : String(value);
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value || 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function SectionTitle({ title, count }: { title: string; count?: string | number }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h4 className="text-[9px] font-extrabold uppercase tracking-[.14em] text-[#77847c]">{title}</h4>
      {count !== undefined && <span className="mono text-[8px] text-[#9a9d93]">{count}</span>}
    </div>
  );
}

function NotReturned({ label }: { label: string }) {
  return <p className="rounded-lg border border-dashed border-[#deddd4] bg-[#f7f6f0] px-3 py-3 text-[9px] leading-4 text-[#95978e]" data-testid={`unavailable-${label}`}>No {label} were returned for this match.</p>;
}

function StatRows({ rows }: { rows: { label: string; value: string | number | null }[] }) {
  if (!rows.length) return <NotReturned label="statistics" />;
  return (
    <div className="divide-y divide-[#eceae2] rounded-lg border border-[#e5e3da] bg-[#fcfbf7]" data-testid="list-statistics">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-[9px]">
          <span className="text-[#758078]">{row.label}</span>
          <span className="mono text-right font-medium text-[#40564e]">{display(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

function LineupCard({ lineup }: { lineup: FootballLastFiveLineup }) {
  const players = (entries: FootballLastFiveLineup['starters'], label: string) => (
    <div>
      <p className="mb-1.5 text-[8px] font-bold uppercase tracking-[.1em] text-[#92968c]">{label} <span className="mono ml-1">{entries.length}</span></p>
      {entries.length ? <ul className="space-y-1.5">
        {entries.map((player, index) => (
          <li key={`${player.id ?? player.name}-${index}`} className="flex min-w-0 items-center gap-2 text-[9px]" data-testid={`lineup-player-${player.id ?? index}`}>
            <span className="mono grid size-5 shrink-0 place-items-center rounded-md bg-[#edf0e9] text-[8px] text-[#67806e]">{display(player.number)}</span>
            <span className="min-w-0 flex-1 truncate font-semibold text-[#53615b]">{player.name}</span>
            <span className="shrink-0 text-[#96998f]">{display(player.position)}{player.grid ? ` · ${player.grid}` : ''}</span>
          </li>
        ))}
      </ul> : <p className="text-[9px] text-[#96998f]">Not available</p>}
    </div>
  );
  return (
    <article className="rounded-lg border border-[#e5e3da] bg-[#fcfbf7] p-3" data-testid={`lineup-${lineup.teamId ?? lineup.teamName}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div><p className="text-[10px] font-extrabold text-[#455951]">{lineup.teamName}</p><p className="mt-1 text-[8px] text-[#8d9289]">Coach · {display(lineup.coach)}</p></div>
        <span className="mono rounded-md bg-[#eef1ea] px-2 py-1 text-[9px] text-[#657b6d]">Formation {display(lineup.formation)}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{players(lineup.starters, 'Starters')}{players(lineup.substitutes, 'Substitutes')}</div>
    </article>
  );
}

function PlayerGroups({ groups }: { groups: FootballLastFivePlayerGroup[] }) {
  if (!groups.length) return <NotReturned label="player statistics" />;
  return (
    <div className="space-y-3">
      {groups.map((group, groupIndex) => (
        <section key={`${group.teamId ?? group.teamName}-${groupIndex}`} className="rounded-lg border border-[#e5e3da] bg-[#fcfbf7] p-3" data-testid={`player-group-${group.teamId ?? groupIndex}`}>
          <SectionTitle title={group.teamName} count={`${group.players.length} players`} />
          {group.players.length ? <div className="space-y-2.5">
            {group.players.map((player, playerIndex) => (
              <article key={`${player.id ?? player.name}-${playerIndex}`} className="border-t border-[#eceae2] pt-2.5 first:border-0 first:pt-0" data-testid={`player-stats-${player.id ?? playerIndex}`}>
                <div className="mb-2 flex items-center gap-2">
                  {player.photo ? <img src={player.photo} alt="" loading="lazy" className="size-7 rounded-full border border-[#e1dfd6] object-cover" /> : <span className="grid size-7 place-items-center rounded-full bg-[#e9eee8] text-[8px] font-extrabold text-[#64806d]">{player.name.slice(0, 2).toUpperCase()}</span>}
                  <div className="min-w-0 flex-1"><p className="truncate text-[9px] font-bold text-[#4a5e55]">{player.name}</p><p className="mt-0.5 text-[8px] text-[#93968d]">{display(player.number)} · {display(player.position)}</p></div>
                  <span className="mono rounded-md bg-[#f1efe7] px-2 py-1 text-[9px] text-[#726d5e]">Rating {display(player.rating)}</span>
                </div>
                <StatRows rows={player.statistics} />
              </article>
            ))}
          </div> : <NotReturned label="players" />}
        </section>
      ))}
    </div>
  );
}

function MatchRecord({ record, index }: { record: FootballLastFiveMatch; index: number }) {
  const match = record.match;
  const hasIssues = record.issues.length > 0;
  const home = match.homeTeam;
  const away = match.awayTeam;
  return (
    <details className="group overflow-hidden rounded-[13px] border border-[#dcdad1] bg-[#fbfaf6] shadow-[0_5px_16px_rgba(47,59,64,.035)]" data-testid={`last-five-match-${match.fixtureId}-${index}`}>
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-3 px-3.5 py-3.5 outline-none transition hover:bg-[#f4f3ed] focus-visible:ring-2 focus-visible:ring-[#9b7160] sm:px-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="mono text-[8px] uppercase tracking-[.1em] text-[#9b7160]">{dateLabel(match.date)}</span>
            <span className="size-1 rounded-full bg-[#c8c8bb]" />
            <span className="truncate text-[8px] text-[#90938a]">{match.competition}</span>
          </div>
          <p className="truncate text-[10px] font-extrabold text-[#455951]">{home.name} <span className="mx-1 font-medium text-[#a1a197]">vs</span> {away.name}</p>
        </div>
        <div className="text-right">
          <p className="mono text-[14px] font-medium tracking-[-.04em] text-[#344c43]">{match.homeScore ?? '–'} <span className="text-[#a1a69d]">:</span> {match.awayScore ?? '–'}</p>
          <p className="mt-0.5 text-[8px] uppercase tracking-[.1em] text-[#92968c]">{match.status}</p>
        </div>
        <span className="mono text-[13px] text-[#869087] transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
      </summary>
      <div className="border-t border-[#e5e3da] p-3.5 sm:p-4">
        {hasIssues && <div className="mb-4 space-y-1.5" role="status" data-testid={`match-issues-${match.fixtureId}`}>
          {record.issues.map((issue, issueIndex) => <p key={`${issue}-${issueIndex}`} className="flex items-start gap-2 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2.5 text-[9px] leading-4 text-[#84684f]"><CircleAlert size={12} className="mt-0.5 shrink-0" />{issue}</p>)}
        </div>}
        <div className="space-y-5">
          <section data-testid={`match-statistics-${match.fixtureId}`}>
            <SectionTitle title="Match statistics" count={record.statistics.length} />
            {record.statistics.length ? <div className="grid gap-3 sm:grid-cols-2">
              {record.statistics.map((team, teamIndex) => <div key={`${team.teamId ?? team.teamName}-${teamIndex}`}><p className="mb-1.5 text-[8px] font-bold text-[#7e8980]">{team.teamName}</p><StatRows rows={team.statistics} /></div>)}
            </div> : <NotReturned label="match statistics" />}
          </section>
          <section data-testid={`match-events-${match.fixtureId}`}>
            <SectionTitle title="Commentary & events" count={record.events.length} />
            {record.events.length ? <div className="overflow-hidden rounded-lg border border-[#e5e3da] bg-[#fcfbf7]">
              {record.events.map((event, eventIndex) => <article key={`${event.minute}-${event.type}-${eventIndex}`} className="grid grid-cols-[42px_minmax(0,1fr)] gap-2.5 border-b border-[#eceae2] px-3 py-2.5 last:border-0" data-testid={`event-${match.fixtureId}-${eventIndex}`}>
                <span className="mono rounded-md bg-[#eef0e9] px-1.5 py-1 text-center text-[8px] text-[#62796a]">{event.minute === null ? '—' : `${event.minute}${event.extraMinute !== null ? `+${event.extraMinute}` : ''}′`}</span>
                <div className="min-w-0"><p className="text-[9px] font-bold text-[#4d6057]">{event.type}{event.detail ? ` · ${event.detail}` : ''}</p><p className="mt-0.5 truncate text-[8px] text-[#828980]">{[event.player, event.assist ? `Assist: ${event.assist}` : null, event.teamName ?? (event.teamId !== null ? `Team ${event.teamId}` : null)].filter(Boolean).join(' · ') || 'Event details not available'}</p>{event.comments && <p className="mt-1 text-[8px] leading-4 text-[#999b92]">{event.comments}</p>}</div>
              </article>)}
            </div> : <NotReturned label="events" />}
          </section>
          <section data-testid={`match-lineups-${match.fixtureId}`}>
            <SectionTitle title="Lineups" count={record.lineups.length} />
            {record.lineups.length ? <div className="grid gap-2.5 xl:grid-cols-2">{record.lineups.map((lineup, lineupIndex) => <LineupCard key={`${lineup.teamId ?? lineup.teamName}-${lineupIndex}`} lineup={lineup} />)}</div> : <NotReturned label="lineups" />}
          </section>
          <section data-testid={`match-players-${match.fixtureId}`}>
            <SectionTitle title="Player statistics" count={record.players.length} />
            <PlayerGroups groups={record.players} />
          </section>
          <section data-testid={`match-odds-${match.fixtureId}`}>
            <SectionTitle title="Odds markets" count={record.oddsMarkets.length} />
            {record.oddsMarkets.length ? <div className="space-y-2">
              {record.oddsMarkets.map((market, marketIndex) => <article key={`${market.marketId}-${marketIndex}`} className="overflow-hidden rounded-lg border border-[#e5e3da] bg-[#fcfbf7]" data-testid={`last-five-market-${market.marketId}-${match.fixtureId}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eceae2] bg-[#f3f2eb] px-3 py-2"><p className="text-[9px] font-extrabold text-[#52635a]">{market.name}</p><span className="mono text-[8px] uppercase text-[#899087]">{market.category}</span></div>
                {market.bookmakers.length ? <div className="divide-y divide-[#eceae2]">
                  {market.bookmakers.map((bookmaker, bookIndex) => <div key={`${bookmaker.name}-${bookIndex}`} className="px-3 py-2.5" data-testid={`bookmaker-${match.fixtureId}-${marketIndex}-${bookIndex}`}>
                    <p className="mb-1.5 text-[8px] font-bold text-[#7f8980]">{bookmaker.name}</p>
                    {bookmaker.selections.length ? <div className="flex flex-wrap gap-1.5">{bookmaker.selections.map((selection, selectionIndex) => <span key={`${selection.selection}-${selectionIndex}`} className="inline-flex items-center gap-2 rounded-md border border-[#e2e5da] bg-[#f6f7f1] px-2 py-1 text-[8px] text-[#68756b]"><span>{selection.selection}</span><span className="mono font-medium text-[#456b58]">{selection.odd}</span></span>)}</div> : <p className="text-[8px] text-[#96998f]">No selections returned.</p>}
                  </div>)}
                </div> : <p className="px-3 py-3 text-[8px] text-[#96998f]">No bookmaker quotes returned.</p>}
              </article>)}
            </div> : <NotReturned label="odds markets" />}
          </section>
          <section data-testid={`prematch-stats-${match.fixtureId}`}>
            <SectionTitle title="Prematch context" count={record.prematchStats.length} />
            <StatRows rows={record.prematchStats} />
          </section>
        </div>
        <div className="mt-4 border-t border-[#e8e6de] pt-3">
          {record.sourceUrl ? <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1.5 text-[8px] font-medium tracking-wide text-[#758078] hover:text-[#d06c4f]" data-testid={`link-last-five-source-${match.fixtureId}`}>OPEN MATCH SOURCE <ArrowUpRight size={11} /></a> : <p className="text-[8px] text-[#989a91]">Source link unavailable.</p>}
        </div>
      </div>
    </details>
  );
}

function TeamHistory({ team }: { team: FootballLastFiveTeam }) {
  return (
    <section className="min-w-0" data-testid={`last-five-team-${team.team.id}`}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[11px] border border-[#e0dfd6] bg-[#f7f6ef] text-[9px] font-extrabold text-[#65766d]">
          {team.team.logo ? <img src={team.team.logo} alt="" loading="lazy" className="size-full object-contain p-1" /> : team.team.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1"><h3 className="truncate text-[12px] font-extrabold text-[#344a43]">{team.team.name}</h3><p className="mono mt-0.5 text-[8px] uppercase tracking-[.1em] text-[#97998f]">Previous fixtures</p></div>
        <span className="mono rounded-full bg-[#e9eee8] px-2.5 py-1 text-[8px] text-[#668071]">{team.matches.length} / 5</span>
      </div>
      {team.matches.length ? <div className="space-y-2.5">{team.matches.map((match, index) => <MatchRecord key={`${match.match.fixtureId}-${index}`} record={match} index={index} />)}</div> : <div className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-5 text-center" data-testid={`empty-last-five-${team.team.id}`}><p className="text-[10px] font-bold text-[#69796f]">No recent matches returned</p><p className="mt-1.5 max-w-[230px] text-[9px] leading-4 text-[#92958c]">There are no previous fixtures available for {team.team.name}.</p></div>}
    </section>
  );
}

export function LastFivePanel({ data, isLoading, isError, error, onRetry }: {
  data?: FootballMatchLastFive;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (isLoading) return (
    <section aria-label="Loading last five matches" role="status" data-testid="status-last-five-loading">
      <div className="mb-5"><div className="h-2 w-24 animate-pulse rounded bg-[#e5e3da]" /><div className="mt-3 h-6 w-52 animate-pulse rounded bg-[#e5e3da]" /></div>
      <div className="grid gap-5 lg:grid-cols-2">{[0, 1].map((side) => <div key={side} className="space-y-2"><div className="h-12 animate-pulse rounded-xl bg-[#eeede6]" />{[0, 1, 2].map((item) => <div key={item} className="h-[68px] animate-pulse rounded-xl bg-[#eeede6]" />)}</div>)}</div>
    </section>
  );

  if (isError) return (
    <section className="flex min-h-[250px] flex-col items-center justify-center rounded-xl border border-[#e3c3b6] bg-[#fff6f0] px-6 py-10 text-center" role="alert" data-testid="status-last-five-error">
      <span className="grid size-10 place-items-center rounded-xl bg-[#f6e2d8] text-[#b85b46]"><CircleAlert size={17} /></span>
      <h2 className="mt-3 text-[14px] font-extrabold text-[#784b3e]">Recent match detail unavailable</h2>
      <p className="mt-1.5 max-w-md text-[10px] leading-5 text-[#8c6b5e]">{error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'The source could not return recent match context. Your current fixture remains available above.'}</p>
      <button type="button" onClick={onRetry} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-3 text-[9px] font-extrabold text-[#855542] transition hover:bg-white" data-testid="button-retry-last-five"><RefreshCw size={12} /> Try again</button>
    </section>
  );

  if (!data) return <section className="rounded-xl border border-dashed border-[#d9d9cf] bg-[#f7f6f0] px-6 py-10 text-center" data-testid="status-last-five-empty"><h2 className="text-[12px] font-extrabold text-[#52635a]">No recent-match data returned</h2><p className="mt-1.5 text-[9px] text-[#92958c]">There is no history payload for this fixture.</p></section>;

  const hasRecords = data.home.matches.length > 0 || data.away.matches.length > 0;
  return (
    <section data-testid="panel-last-five">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="mono text-[9px] uppercase tracking-[.17em] text-[#9b7160]">Fixture history · #{data.fixtureId}</p><h2 className="mt-1 text-[20px] font-extrabold tracking-[-.05em] text-[#2b3e49]">Last five</h2></div>
        <p className="max-w-sm text-[10px] leading-5 text-[#858982]">Detailed source-backed records for both sides, kept alongside the fixture you are examining.</p>
      </div>
      {data.issues.length > 0 && <div className="mb-4 space-y-1.5" role="status" data-testid="last-five-issues">{data.issues.map((issue, index) => <p key={`${issue}-${index}`} className="flex items-start gap-2 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3.5 py-3 text-[9px] leading-4 text-[#84684f]"><CircleAlert size={13} className="mt-0.5 shrink-0 text-[#bb8755]" />{issue}</p>)}</div>}
      {!hasRecords && <div className="mb-4 rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3.5 py-3 text-[9px] text-[#84684f]" role="status" data-testid="status-last-five-no-results">No prior results were returned for either team.</div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <TeamHistory team={data.home} />
        <TeamHistory team={data.away} />
      </div>
    </section>
  );
}
