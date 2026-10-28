import { useMemo, useState } from 'react';
import type { FootballMatchLastFive, FootballMatchReplay, FootballMatchReplayEvent } from '@workspace/api-client-react';
import { LastFivePanel } from '@/components/last-five-panel';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  Footprints,
  RefreshCw,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { RecordedEventPitch } from './recorded-event-pitch';

function readableError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') return error.error;
  return 'The source replay could not be loaded. Please try again.';
}

function parseMinute(value: string) {
  const match = value.match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) + (match[2] ? Number(match[2]) / 100 : 0);
}

function minuteBase(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function eventTone(kind: string) {
  const value = kind.toLowerCase();
  if (value.includes('goal')) return 'bg-[#d96f51] text-[#fff8ed]';
  if (value.includes('card')) return 'bg-[#e4c36d] text-[#4f4325]';
  if (value.includes('sub')) return 'bg-[#cadbd0] text-[#3e6956]';
  return 'bg-[#e7e8dd] text-[#64746d]';
}

function EventRow({ event, index }: { event: FootballMatchReplayEvent; index: number }) {
  return (
    <article className="group relative grid grid-cols-[52px_18px_minmax(0,1fr)] gap-3 py-3.5 sm:grid-cols-[68px_22px_minmax(0,1fr)] sm:gap-4" data-testid={`replay-event-${index}`}>
      <span className="mono pt-0.5 text-right text-[10px] font-medium text-[#77827a]" data-testid={`text-event-minute-${index}`}>{event.minute || '—'}&apos;</span>
      <span className="relative flex justify-center" aria-hidden="true">
        <span className={`relative z-[1] mt-0.5 grid size-[18px] place-items-center rounded-full ring-4 ring-[#f8f7f0] transition-transform duration-200 group-hover:scale-110 ${eventTone(event.kind)}`}>
          {event.kind.toLowerCase().includes('goal') ? <Footprints size={10} /> : event.kind.toLowerCase().includes('card') ? <span className="h-2 w-1.5 rounded-[1px] bg-current" /> : <span className="size-1 rounded-full bg-current" />}
        </span>
      </span>
      <div className="min-w-0 border-b border-[#e9e8df] pb-3.5 transition-colors group-hover:border-[#d2ded3]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-[11px] font-extrabold text-[#354a45]" data-testid={`text-event-title-${index}`}>{event.title}</h3>
          <span className="mono rounded-full bg-[#f0efe7] px-2 py-0.5 text-[8px] uppercase tracking-[.08em] text-[#878c80]">{event.kind}</span>
        </div>
        <p className="mt-1 text-[10px] leading-[1.7] text-[#7a8178]" data-testid={`text-event-detail-${index}`}>{event.detail}</p>
        <p className="mono mt-1.5 text-[8px] uppercase tracking-[.1em] text-[#a2a295]">Source comment {event.sourceOrder}</p>
      </div>
    </article>
  );
}

function LoadingReplay() {
  return (
    <section className="overflow-hidden rounded-[16px] border border-[#d7d9ce] bg-[#f9f8f2]" role="status" aria-label="Loading match replay" data-testid="status-replay-loading">
      <div className="h-1 bg-[#e3e9df]"><div className="h-full w-1/3 animate-pulse bg-[#527b60]" /></div>
      <div className="flex items-start gap-3 border-b border-[#e6e5dc] bg-[#f4f3eb] px-5 py-3.5 sm:px-7">
        <span className="mt-0.5 size-2 shrink-0 animate-pulse rounded-full bg-[#527b60]" aria-hidden="true" />
        <div>
          <p className="text-[10px] font-extrabold text-[#465a52]">Loading the source match report</p>
          <p className="mt-1 text-[9px] leading-5 text-[#80847a]">Fetching recorded events, shot locations, and lineup positions. If the source is unavailable, a retry option will appear.</p>
        </div>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-[1.2fr_.8fr] sm:p-7">
        <div className="space-y-4"><div className="h-3 w-28 animate-pulse rounded bg-[#e7e6dc]" /><div className="h-8 w-3/4 animate-pulse rounded bg-[#e7e6dc]" /><div className="h-20 animate-pulse rounded-xl bg-[#efeee6]" /><div className="space-y-3 pt-2">{[0, 1, 2].map((row) => <div key={row} className="h-12 animate-pulse rounded-lg bg-[#efeee6]" />)}</div></div>
        <div className="h-52 animate-pulse rounded-xl bg-[#efeee6]" />
      </div>
    </section>
  );
}

function ReplayError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <section className="flex flex-col items-start gap-4 rounded-[16px] border border-[#e5c7b8] bg-[#fff6ef] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7" role="alert" data-testid="status-replay-error">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f5e3d8] text-[#ad6049]"><CircleAlert size={18} /></span>
        <div><p className="text-[12px] font-extrabold text-[#714c40]">Replay source unavailable</p><p className="mt-1 max-w-lg text-[10px] leading-5 text-[#8c6b5e]">{readableError(error)}</p></div>
      </div>
      <button type="button" onClick={onRetry} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#e4c2b2] bg-[#fffaf6] px-3 text-[10px] font-extrabold text-[#855542] transition hover:-translate-y-0.5 hover:bg-white" data-testid="button-retry-replay"><RefreshCw size={13} /> Try again</button>
    </section>
  );
}

function ReplayEmpty({ fixtureId }: { fixtureId: number }) {
  return (
    <section className="rounded-[16px] border border-dashed border-[#d4d8cc] bg-[#f8f7f0] px-6 py-10 text-center" data-testid="status-replay-empty">
      <span className="mx-auto grid size-11 place-items-center rounded-[14px] bg-[#e8ede5] text-[#64806d]"><Footprints size={18} /></span>
      <p className="mono mt-4 text-[9px] uppercase tracking-[.16em] text-[#9b7160]">Fixture {fixtureId}</p>
      <h3 className="mt-1.5 text-[14px] font-extrabold text-[#3b5049]">No replay records returned</h3>
      <p className="mx-auto mt-2 max-w-md text-[10px] leading-5 text-[#82867d]">The match is complete, but the source has not supplied a replay record. No events or match details have been inferred.</p>
    </section>
  );
}

function ReplaySectionCard({ section }: { section: FootballMatchReplay['sections'][number] }) {
  const available = section.available && Boolean(section.text?.trim());
  return (
    <article className={`rounded-xl border p-4 transition-colors ${available ? 'border-[#dce2d8] bg-[#fbfaf5] hover:border-[#b9ccbd]' : 'border-[#e4e3da] bg-[#f2f1e9]'}`} data-testid={`replay-section-${section.key}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[10px] font-extrabold text-[#465a52]">{section.title}</h3>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-[.08em] ${available ? 'bg-[#e5eee5] text-[#547960]' : 'bg-[#e9e8df] text-[#898b80]'}`}>
          {available ? <><Check size={10} /> Source provided</> : 'Unavailable'}
        </span>
      </div>
      {available ? (
        <p className="mt-3 whitespace-pre-wrap text-[10px] leading-[1.8] text-[#737b72]" data-testid={`text-replay-section-${section.key}`}>{section.text}</p>
      ) : (
        <p className="mt-3 text-[9px] leading-5 text-[#929388]">
          {section.key === 'shot-map'
            ? 'The text shot-map section was not present. The recorded-event pitch above uses typed source coordinates when they are available.'
            : 'This section was not present in the source report.'}
        </p>
      )}
    </article>
  );
}

function ReplayContent({
  replay,
  lastFive,
  lastFiveLoading,
  lastFiveError,
  lastFiveErrorDetail,
  onRetryLastFive,
}: {
  replay: FootballMatchReplay;
  lastFive?: FootballMatchLastFive;
  lastFiveLoading: boolean;
  lastFiveError: boolean;
  lastFiveErrorDetail: unknown;
  onRetryLastFive: () => void;
}) {
  const [period, setPeriod] = useState<'all' | 'first' | 'second'>('all');
  const sortedEvents = useMemo(
    () => [...replay.events].sort((a, b) => parseMinute(a.minute) - parseMinute(b.minute) || a.sourceOrder - b.sourceOrder),
    [replay.events],
  );
  const visibleEvents = sortedEvents.filter((event) => {
    const minute = minuteBase(event.minute);
    if (period === 'first') return minute <= 45;
    if (period === 'second') return minute > 45;
    return true;
  });
  const providedCount = replay.sections.filter((section) => section.available && Boolean(section.text?.trim())).length;
  const hasReplayContent =
    replay.events.length > 0 ||
    replay.shotEvents.length > 0 ||
    replay.formationPlayers.length > 0 ||
    replay.sections.some((section) => section.available && Boolean(section.text?.trim()));

  if (!hasReplayContent) return <ReplayEmpty fixtureId={replay.fixtureId} />;

  return (
    <div className="animate-rise space-y-5" data-testid="panel-match-replay">
      <section className="overflow-hidden rounded-[17px] border border-[#2c443b] bg-[#243b32] text-[#f5f1e5] shadow-[0_18px_50px_rgba(36,59,50,.15)]">
        <div className="relative overflow-hidden px-5 py-5 sm:px-7 sm:py-6">
          <div className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full border border-[#6d8973]/20" />
          <div className="pointer-events-none absolute -right-8 -top-16 size-44 rounded-full border border-[#6d8973]/20" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mono flex items-center gap-2 text-[8px] uppercase tracking-[.2em] text-[#c9a187]"><span className="size-1.5 rounded-full bg-[#d98b64]" /> Finished match · replay</p>
              <h2 className="mt-2 text-[18px] font-extrabold tracking-[-.045em] sm:text-[22px]" data-testid="text-replay-matchup">{replay.homeTeam}<span className="mx-2 font-medium text-[#91a095]">v</span>{replay.awayTeam}</h2>
              <p className="mt-1.5 text-[9px] text-[#b8c3b5]" data-testid="text-replay-competition">{replay.competition}</p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-[#718675]/30 bg-[#1d332b]/55 px-4 py-2.5">
              <span className="mono text-[25px] font-medium tracking-[-.08em] text-[#faf4e8]" data-testid="text-replay-score">{replay.homeScore ?? '–'} <span className="text-[#839589]">:</span> {replay.awayScore ?? '–'}</span>
              {replay.halfTimeScore && <span className="border-l border-[#718675]/40 pl-3 text-left"><span className="block text-[7px] font-bold uppercase tracking-[.12em] text-[#9eac9f]">Half-time</span><span className="mono mt-1 block text-[10px] text-[#d7dfd3]" data-testid="text-replay-half-time">{replay.halfTimeScore}</span></span>}
            </div>
          </div>
          <div className="relative mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-[#8ba18b]/20 pt-3 text-[9px] text-[#c0cabc]">
            <span className="flex items-center gap-1.5"><CalendarDays size={12} className="text-[#d2a07f]" /><span data-testid="text-replay-date">{formatDate(replay.date)}</span></span>
            <span className="flex items-center gap-1.5"><Footprints size={12} className="text-[#d2a07f]" /> Actual play: <span className="mono" data-testid="text-replay-play-time">{replay.actualPlayTime || 'Unavailable'}</span></span>
            <span className="flex items-center gap-1.5"><Timer size={12} className="text-[#d2a07f]" /> Total duration: <span className="mono" data-testid="text-replay-duration">{replay.totalDuration || 'Unavailable'}</span></span>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-[#8ba18b]/20 bg-[#1d332b]/55 sm:grid-cols-3">
          <div className="px-4 py-3 sm:px-6"><p className="mono text-[8px] uppercase tracking-[.12em] text-[#96a697]">Timeline entries</p><p className="mono mt-1 text-[14px] text-[#f4efe2]" data-testid="text-replay-event-count">{replay.events.length.toString().padStart(2, '0')}</p></div>
          <div className="border-l border-[#8ba18b]/20 px-4 py-3 sm:px-6"><p className="mono text-[8px] uppercase tracking-[.12em] text-[#96a697]">Report sections</p><p className="mono mt-1 text-[14px] text-[#f4efe2]" data-testid="text-replay-section-count">{providedCount} <span className="text-[9px] text-[#98a99a]">/ {replay.sections.length}</span></p></div>
          <div className="col-span-2 hidden items-center gap-2 border-l border-[#8ba18b]/20 px-6 py-3 text-[9px] text-[#b8c5b8] sm:col-span-1 sm:flex"><ShieldCheck size={14} className="text-[#a5c4a8]" /> Source coverage, not reconstruction</div>
        </div>
      </section>

      {(replay.events.length === 0 || providedCount < replay.sections.length) && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[#e1d8bd] bg-[#faf5e9] px-4 py-3 text-[9px] leading-5 text-[#766747]" role="status" data-testid="status-replay-partial">
          <CircleAlert size={13} className="mt-0.5 shrink-0 text-[#aa8950]" />
          <p>{replay.events.length === 0 ? 'No event commentary was supplied. The timeline is intentionally empty.' : `${replay.events.length} source event${replay.events.length === 1 ? '' : 's'} shown; ${replay.sections.length - providedCount} report section${replay.sections.length - providedCount === 1 ? '' : 's'} unavailable. Gaps are left explicit.`}</p>
        </div>
      )}

      <RecordedEventPitch
        homeTeam={replay.homeTeam}
        awayTeam={replay.awayTeam}
        shotEvents={replay.shotEvents}
        formationPlayers={replay.formationPlayers}
      />

      <section className="overflow-hidden rounded-[15px] border border-[#d9d9cf] bg-[#f9f8f2]" aria-labelledby="replay-fair-ai-history-title" data-testid="section-replay-fair-ai-stats">
        <div className="border-b border-[#e3e2d9] bg-[#f3f2ea] px-4 py-3.5 sm:px-5">
          <p className="mono text-[8px] uppercase tracking-[.17em] text-[#9b7160]">FAIR AI · source-backed history</p>
          <h3 id="replay-fair-ai-history-title" className="mt-1 text-[13px] font-extrabold text-[#354a45]">Recent team and player statistics</h3>
          <p className="mt-1 text-[9px] leading-4 text-[#858982]">Both teams’ past match records include available full-match, first-half, second-half, lineup, and player statistics. Missing source fields stay marked as unavailable.</p>
        </div>
        <div className="p-4 sm:p-5">
          <LastFivePanel
            data={lastFive}
            isLoading={lastFiveLoading}
            isError={lastFiveError}
            error={lastFiveErrorDetail}
            onRetry={onRetryLastFive}
          />
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(330px,.92fr)]">
        <section className="overflow-hidden rounded-[15px] border border-[#d9d9cf] bg-[#f9f8f2]" aria-labelledby="replay-timeline-title" data-testid="section-replay-timeline">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e3e2d9] bg-[#f3f2ea] px-4 py-3.5 sm:px-5">
            <div><p className="mono text-[8px] uppercase tracking-[.17em] text-[#9b7160]">As reported</p><h3 id="replay-timeline-title" className="mt-1 text-[13px] font-extrabold text-[#354a45]">Match timeline</h3></div>
            <div className="flex rounded-lg border border-[#deded3] bg-[#ebeae1] p-0.5" role="group" aria-label="Filter timeline period">
              {(['all', 'first', 'second'] as const).map((value) => <button type="button" key={value} onClick={() => setPeriod(value)} className={`min-h-7 rounded-md px-2.5 text-[8px] font-extrabold transition ${period === value ? 'bg-[#314d40] text-[#f7f2e6] shadow-sm' : 'text-[#798379] hover:text-[#394e43]'}`} aria-pressed={period === value} data-testid={`button-replay-period-${value}`}>{value === 'all' ? 'All' : value === 'first' ? '1st half' : '2nd half'}</button>)}
            </div>
          </div>
          {visibleEvents.length ? (
            <div className="relative px-4 py-1 sm:px-5">
              <div className="absolute bottom-6 left-[80px] top-6 w-px bg-[#e1e2d8] sm:left-[97px]" aria-hidden="true" />
              {visibleEvents.map((event, index) => <EventRow key={`${event.sourceOrder}-${event.minute}-${index}`} event={event} index={index} />)}
              <p className="border-t border-[#e9e8df] py-3 text-center mono text-[8px] uppercase tracking-[.15em] text-[#9b9c90]">End of available source commentary</p>
            </div>
          ) : <div className="px-5 py-12 text-center"><span className="mx-auto grid size-9 place-items-center rounded-xl bg-[#eeeee5] text-[#849085]"><Clock3 size={15} /></span><p className="mt-3 text-[10px] font-bold text-[#58685e]">No events for this period</p><p className="mt-1 text-[9px] text-[#96988c]">{replay.events.length ? 'Try another timeline filter.' : 'The source supplied no commentary events.'}</p></div>}
        </section>

        <section className="space-y-3" aria-labelledby="replay-report-title" data-testid="section-replay-report">
          <div className="flex items-end justify-between gap-2 px-1">
            <div><p className="mono text-[8px] uppercase tracking-[.17em] text-[#9b7160]">Source inventory</p><h3 id="replay-report-title" className="mt-1 text-[13px] font-extrabold text-[#354a45]">Match report details</h3></div>
            <span className="mono text-[8px] text-[#929489]">{providedCount} / {replay.sections.length} present</span>
          </div>
          {replay.sections.length ? replay.sections.map((section) => <ReplaySectionCard key={section.key} section={section} />) : (
            <div className="rounded-xl border border-dashed border-[#d6d7cc] bg-[#f5f4ed] p-5 text-[9px] leading-5 text-[#888b80]" data-testid="status-replay-no-sections">No match report sections were returned.</div>
          )}
        </section>
      </div>

      <footer className="flex flex-col gap-3 rounded-xl border border-[#d9d9cf] bg-[#f5f4ed] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-lg text-[9px] leading-5 text-[#7d847a]">Events are sorted by match minute for review. Detail and availability labels reflect the source; missing information is not estimated.</p>
        <div className="flex flex-wrap gap-2">
          <a href={replay.sourceDateListUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#d9d9cf] bg-[#fbfaf5] px-3 text-[9px] font-extrabold text-[#566b5e] transition hover:-translate-y-0.5 hover:border-[#b7c8b9] hover:bg-white" data-testid="link-replay-date-source"><CalendarDays size={12} /> Daily results <ArrowUpRight size={11} /></a>
          <a href={replay.sourceMatchUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#314d40] px-3 text-[9px] font-extrabold text-[#f7f2e6] transition hover:-translate-y-0.5 hover:bg-[#263f34]" data-testid="link-replay-match-source"><ExternalLink size={12} /> Match report <ArrowUpRight size={11} /></a>
        </div>
      </footer>
    </div>
  );
}

export function MatchReplayPanel({
  fixtureId,
  replay,
  lastFive,
  isLoading,
  isError,
  error,
  onRetry,
  lastFiveLoading,
  lastFiveError,
  lastFiveErrorDetail,
  onRetryLastFive,
}: {
  fixtureId: number;
  replay: FootballMatchReplay | undefined;
  lastFive?: FootballMatchLastFive;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  lastFiveLoading: boolean;
  lastFiveError: boolean;
  lastFiveErrorDetail: unknown;
  onRetryLastFive: () => void;
}) {
  if (isLoading) return <LoadingReplay />;
  if (isError) return <ReplayError error={error} onRetry={onRetry} />;
  if (!replay) return <ReplayEmpty fixtureId={fixtureId} />;
  return (
    <ReplayContent
      replay={replay}
      lastFive={lastFive}
      lastFiveLoading={lastFiveLoading}
      lastFiveError={lastFiveError}
      lastFiveErrorDetail={lastFiveErrorDetail}
      onRetryLastFive={onRetryLastFive}
    />
  );
}
