import { useState, type FormEvent } from 'react';
import {
  getGetFootballLiveActionQueryKey,
  useGetFootballLiveAction,
} from '@workspace/api-client-react';
import type {
  FootballLiveAction,
  FootballMatchDetails,
} from '@workspace/api-client-react';
import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  Clock3,
  Eye,
  RefreshCw,
  ScanLine,
} from 'lucide-react';
import { LiveScreenCapture } from './live-screen-capture';
import { RecordedEventPitch } from './recorded-event-pitch';

const CEARA_GOIAS_SOURCE_URL = 'https://www.365scores.com/football/match/brasileirao-serie-b-superbet-116/ceara-goias-1217-1781-116#id=4669926';

function normalizeTeamName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function initialSourceUrl(match: FootballMatchDetails['match']) {
  const isCearaGoias =
    normalizeTeamName(match.home.name).includes('ceara') &&
    normalizeTeamName(match.away.name).includes('goias') &&
    match.date.startsWith('2026-10-27');
  return isCearaGoias ? CEARA_GOIAS_SOURCE_URL : '';
}

function readableError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') {
    return error.error;
  }
  return '365Scores live action data could not be loaded. Please try again.';
}

function minuteValue(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : -1;
}

function isLiveStatus(status: string) {
  return /\b(live|in play|in progress|first half|second half|1st half|2nd half|1h|2h|half[ -]?time|halftime)\b/i.test(status);
}

function actionLabel(text: string) {
  if (/\b(goal|penalty|red card)\b/i.test(text)) return 'Key moment';
  if (/\b(shot|attempt|saved|blocked|missed)\b/i.test(text)) return 'Shot';
  if (/\b(corner|attack|cross|breakaway)\b/i.test(text)) return 'Attack';
  return 'Match event';
}

function scoreText(home: number | null, away: number | null) {
  return home !== null && away !== null ? `${home} – ${away}` : 'Score unavailable';
}

function formatUpdatedAt(value: string | undefined) {
  if (!value) return 'Waiting for the first source snapshot';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Source time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function LiveActionSourcePanel({
  match,
}: {
  match: FootballMatchDetails['match'];
}) {
  const presetUrl = initialSourceUrl(match);
  const [sourceUrl, setSourceUrl] = useState(presetUrl);
  const [activeSourceUrl, setActiveSourceUrl] = useState(presetUrl);
  const liveActionQuery = useGetFootballLiveAction(
    { sourceUrl: activeSourceUrl },
    {
      query: {
        enabled: Boolean(activeSourceUrl),
        queryKey: getGetFootballLiveActionQueryKey({ sourceUrl: activeSourceUrl }),
        retry: false,
        staleTime: 0,
        refetchInterval: (query) =>
          isLiveStatus(query.state.data?.status ?? '') ? 15_000 : false,
        refetchIntervalInBackground: false,
      },
    },
  );

  const liveAction = liveActionQuery.data as FootballLiveAction | undefined;
  const events = [...(liveAction?.events ?? [])].sort((left, right) => {
    const minuteDifference = minuteValue(right.minute) - minuteValue(left.minute);
    return minuteDifference || right.sourceOrder - left.sourceOrder;
  });
  const actionEvents = events
    .filter((event) => {
      const content = `${event.kind} ${event.title} ${event.detail}`;
      return /\b(goal|shot|attempt|saved|blocked|missed|corner|attack|cross|penalty|foul|offside|card|substitution)\b/i.test(content);
    })
    .slice(0, 7);
  const recentShots = liveAction?.shotEvents.filter((shot) => {
    if (liveAction.elapsedMinute === null) return false;
    const shotMinute = minuteValue(shot.minute);
    return shotMinute >= 0 &&
      liveAction.elapsedMinute - shotMinute >= 0 &&
      liveAction.elapsedMinute - shotMinute <= 15;
  }) ?? [];
  const latestEvent = actionEvents[0];
  const sourceIsLive = isLiveStatus(liveAction?.status ?? '');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedUrl = sourceUrl.trim();
    if (!submittedUrl) return;
    if (submittedUrl === activeSourceUrl) {
      void liveActionQuery.refetch();
    } else {
      setActiveSourceUrl(submittedUrl);
    }
  };

  return (
    <section className="space-y-5" data-testid="panel-live-action">
      <header className="rounded-xl border border-[#d9e0d6] bg-[#f0f4ed] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">365Scores live source</p>
            <h2 className="mt-1 text-[15px] font-extrabold text-[#344550]">Live action analyzer</h2>
            <p className="mt-1 text-[9px] text-[#727973]">
              Track the source-reported match state, events, and shot locations.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d9dfd5] bg-[#f8faf5] px-2.5 py-1.5 text-[8px] font-extrabold uppercase tracking-wide text-[#68796e]">
            <Activity size={11} className={liveActionQuery.isFetching ? 'animate-pulse text-[#c5654a]' : 'text-[#68816e]'} />
            {liveActionQuery.isFetching ? 'Updating' : sourceIsLive ? 'Live feed' : 'Source feed'}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 grid gap-2 border-t border-[#dfe5db] pt-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="min-w-0">
            <span className="mb-1 block text-[8px] font-bold uppercase tracking-wide text-[#77847c]">365Scores match link</span>
            <input
              type="url"
              required
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://www.365scores.com/football/match/…#id=…"
              className="h-9 w-full rounded-lg border border-[#d9dfd5] bg-[#fafbf8] px-3 text-[9px] text-[#40564e] outline-none focus:border-[#8ea393] focus:ring-2 focus:ring-[#dbe6da]"
              aria-label="365Scores match link"
              data-testid="input-live-action-source"
            />
          </label>
          <button
            type="submit"
            disabled={!sourceUrl.trim() || liveActionQuery.isFetching}
            className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#314d40] px-3 text-[9px] font-extrabold text-[#f7f2e6] hover:bg-[#263f34] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-start-live-action"
          >
            <ScanLine size={12} /> {activeSourceUrl ? 'Update source' : 'Analyze match'}
          </button>
        </form>
      </header>

      <section className="rounded-xl border border-[#e8dfca] bg-[#faf5e9] p-4" data-testid="status-live-action-vision">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[#f1e8d5] text-[#8b7251]"><Eye size={14} /></span>
          <div>
            <p className="text-[10px] font-extrabold text-[#6f5d42]">Source feed and visual capture are separate</p>
            <p className="mt-1 text-[9px] leading-5 text-[#7d6c4d]">
              365Scores embeds its live pitch in a tracker widget. The source feed below reports incidents; the opt-in capture prototype can locally follow a ball marker, but it is not trained AI or player tracking.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[8px] font-bold">
              <span className="rounded-full border border-[#d9dfd5] bg-[#f8faf5] px-2 py-1 text-[#58705e]">Current input: events + shot locations</span>
              <span className="rounded-full border border-[#e5d8bd] bg-[#fffaf0] px-2 py-1 text-[#8a7654]">Visual prototype: local template tracking</span>
            </div>
          </div>
        </div>
      </section>

      <LiveScreenCapture />

      {!activeSourceUrl && (
        <p className="rounded-lg border border-dashed border-[#deddd4] bg-[#f7f6f0] px-3 py-4 text-[9px] leading-5 text-[#858982]" data-testid="status-live-action-source-empty">
          Paste a 365Scores football match link above to load its current source feed.
        </p>
      )}

      {liveActionQuery.isLoading && (
        <section className="space-y-3" role="status" aria-label="Loading live action feed" data-testid="status-live-action-loading">
          <div className="h-20 animate-pulse rounded-xl bg-[#eeede6]" />
          <div className="h-52 animate-pulse rounded-xl bg-[#eeede6]" />
        </section>
      )}

      {liveActionQuery.isError && !liveAction && (
        <section className="flex flex-col items-start gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4" role="alert" data-testid="status-live-action-error">
          <div className="flex items-start gap-2.5">
            <CircleAlert size={15} className="mt-0.5 shrink-0 text-[#b85b46]" />
            <div>
              <h3 className="text-[10px] font-extrabold text-[#784b3e]">Live action data unavailable</h3>
              <p className="mt-1 text-[9px] leading-5 text-[#8c6b5e]">{readableError(liveActionQuery.error)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { void liveActionQuery.refetch(); }}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-2.5 text-[8px] font-extrabold text-[#855542] hover:bg-white"
            data-testid="button-retry-live-action"
          >
            <RefreshCw size={11} /> Try again
          </button>
        </section>
      )}

      {liveAction && (
        <>
          {liveActionQuery.isError && (
            <p className="rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2.5 text-[8px] leading-4 text-[#84684f]" role="status" data-testid="status-live-action-stale">
              The latest refresh failed. Showing the last successful source snapshot.
            </p>
          )}

          <header className="rounded-xl border border-[#d9e0d6] bg-[#f0f4ed] p-4" data-testid="section-live-action-match">
            <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">{liveAction.competition}</p>
            <h3 className="mt-1 text-[13px] font-extrabold text-[#344550]">{liveAction.homeTeam} {scoreText(liveAction.homeScore, liveAction.awayScore)} {liveAction.awayTeam}</h3>
            <p className="mt-1 text-[9px] text-[#727973]">
              {liveAction.elapsedMinute !== null ? `${liveAction.elapsedMinute}′ · ` : ''}{liveAction.status}
            </p>
            <p className="mono mt-2 inline-flex items-center gap-1.5 border-t border-[#dfe5db] pt-2 text-[8px] text-[#899087]">
              <Clock3 size={10} /> Source snapshot · {formatUpdatedAt(liveAction.observedAt)}
            </p>
          </header>

          <section className="grid gap-3 sm:grid-cols-3" aria-label="Live action summary">
            <article className="rounded-xl border border-[#e5e3da] bg-[#fcfbf7] p-3">
              <p className="mono text-[8px] uppercase tracking-wide text-[#92968c]">Latest action</p>
              <p className="mt-1 text-[11px] font-extrabold text-[#40564e]">{latestEvent?.title || 'No action reported yet'}</p>
              <p className="mt-1 text-[8px] text-[#858982]">{latestEvent ? `${latestEvent.minute}′ · ${latestEvent.kind}` : 'Waiting for source commentary'}</p>
            </article>
            <article className="rounded-xl border border-[#e5e3da] bg-[#fcfbf7] p-3">
              <p className="mono text-[8px] uppercase tracking-wide text-[#92968c]">Recorded shots</p>
              <p className="mt-1 text-[18px] font-semibold text-[#40564e]">{liveAction.shotEvents.length}</p>
              <p className="mt-1 text-[8px] text-[#858982]">Discrete source events, not continuous tracking</p>
            </article>
            <article className="rounded-xl border border-[#e5e3da] bg-[#fcfbf7] p-3">
              <p className="mono text-[8px] uppercase tracking-wide text-[#92968c]">Shots · last 15′</p>
              <p className="mt-1 text-[18px] font-semibold text-[#40564e]">{liveAction.elapsedMinute === null ? '—' : recentShots.length}</p>
              <p className="mt-1 text-[8px] text-[#858982]">{liveAction.elapsedMinute === null ? 'Match minute unavailable' : 'Counted from supplied shot times'}</p>
            </article>
          </section>

          {liveAction.shotEvents.length > 0 && (
            <RecordedEventPitch
              homeTeam={liveAction.homeTeam}
              awayTeam={liveAction.awayTeam}
              shotEvents={liveAction.shotEvents}
              formationPlayers={liveAction.formationPlayers}
            />
          )}

          <section data-testid="section-live-action-events">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Source-reported</p>
                <h3 className="mt-1 text-[11px] font-extrabold text-[#40564e]">Recent match actions</h3>
              </div>
              <span className="mono text-[8px] text-[#9a9d93]">{actionEvents.length} shown · {events.length} in feed</span>
            </div>
            {actionEvents.length ? (
              <div className="overflow-hidden rounded-xl border border-[#e5e3da] bg-[#fcfbf7]">
                {actionEvents.map((event, index) => (
                  <article
                    key={`${event.sourceOrder}-${event.minute}-${index}`}
                    className="grid grid-cols-[42px_minmax(0,1fr)] gap-3 border-b border-[#eceae2] px-3 py-3 last:border-0"
                    data-testid={`live-action-event-${index}`}
                  >
                    <span className="mono h-fit rounded-md bg-[#eef0e9] px-1.5 py-1 text-center text-[8px] text-[#62796a]">{event.minute}′</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-[9px] font-bold text-[#4d6057]">{event.title || event.kind}</p>
                        <span className="rounded-full bg-[#f2f0e8] px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide text-[#7e8379]">{actionLabel(`${event.kind} ${event.title} ${event.detail}`)}</span>
                      </div>
                      {event.detail && <p className="mt-1 text-[8px] leading-4 text-[#828980]">{event.detail}</p>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-[#deddd4] bg-[#f7f6f0] px-3 py-3 text-[9px] leading-4 text-[#95978e]" data-testid="status-live-action-empty">
                The source has not returned a commentary action for this match yet.
              </p>
            )}
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e5e3da] bg-[#f7f6f0] px-3 py-2.5">
            <p className="inline-flex items-center gap-1.5 text-[8px] leading-4 text-[#858982]">
              <ScanLine size={11} /> {sourceIsLive ? 'Refreshes every 15 seconds while live.' : 'Automatic refresh stops when the source match is no longer live.'}
            </p>
            <a
              href={liveAction.sourceMatchUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[#314d40] px-2.5 text-[8px] font-extrabold text-[#f7f2e6] hover:bg-[#263f34]"
              data-testid="link-live-action-source"
            >
              Open 365Scores <ArrowUpRight size={10} />
            </a>
          </footer>
        </>
      )}
    </section>
  );
}
