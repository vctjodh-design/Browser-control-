import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  getGetFootballLiveActionQueryKey,
  useGetFootballLiveAction,
} from '@workspace/api-client-react';
import type {
  FootballLiveAction,
  FootballMatchCenter,
  FootballMatchReplay,
} from '@workspace/api-client-react';
import {
  Activity,
  AlertTriangle,
  Check,
  Clock3,
  Crosshair,
  RefreshCw,
  ShieldAlert,
  Signal,
  Users,
} from 'lucide-react';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { analyzeLiveMatch, LIVE_SIMULATION_RUNS } from '@/lib/live-match-intelligence';

function readableError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') return error.error;
  return 'The source could not be reached. Try the lookup again.';
}

function matchCenterLiveSnapshot(matchCenter?: FootballMatchCenter): FootballLiveAction | undefined {
  if (
    !matchCenter ||
    matchCenter.match.home.score === null ||
    matchCenter.match.away.score === null
  ) {
    return undefined;
  }
  return {
    sourceMatchUrl: matchCenter.sourceUrl,
    gameId: matchCenter.match.fixtureId,
    competition: matchCenter.match.competition,
    status: matchCenter.match.status,
    elapsedMinute: matchCenter.elapsedMinute,
    homeTeam: matchCenter.match.home.name,
    awayTeam: matchCenter.match.away.name,
    homeScore: matchCenter.match.home.score,
    awayScore: matchCenter.match.away.score,
    observedAt: matchCenter.observedAt,
    events: matchCenter.events.map((event, sourceOrder) => ({
      minute: event.minute === null
        ? '—'
        : `${event.minute}${event.extraMinute === null ? '' : `+${event.extraMinute}`}`,
      kind: event.type,
      title: event.detail ?? event.type,
      detail: event.comments ?? '',
      sourceOrder,
    })),
    shotEvents: [],
    formationPlayers: [],
  };
}

function formatTime(value?: string | null) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function amount(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

const coverageLabels = [
  ['xg', 'xG'],
  ['xgot', 'xGOT'],
  ['shotCoordinates', 'Shot origins'],
  ['playerRatings', 'Player ratings'],
  ['commentary', 'Commentary'],
] as const;

function ShotOriginMap({
  homeName,
  awayName,
  homeShots,
  awayShots,
}: {
  homeName: string;
  awayName: string;
  homeShots: NonNullable<ReturnType<typeof analyzeLiveMatch>['home']>;
  awayShots: NonNullable<ReturnType<typeof analyzeLiveMatch>['away']>;
}) {
  const shots = [...homeShots.shotEvents, ...awayShots.shotEvents].filter(
    (shot) => shot.x !== null && shot.y !== null,
  );
  return (
    <div className="rounded-xl border border-[#dfe2d8] bg-[#f3f5ed] p-3 sm:p-4" data-testid="live-shot-origin-map">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Recorded event coordinates</p>
          <h3 className="mt-1 text-[12px] font-extrabold text-[#344550]">Shot-origin map</h3>
        </div>
        <span className="mono text-[8px] text-[#858982]">{shots.length} / {homeShots.shotEvents.length + awayShots.shotEvents.length} shots located</span>
      </div>
      <div className="relative overflow-hidden rounded-lg border border-[#c9d5c4] bg-[#dfe9d9]">
        <svg viewBox="0 0 100 60" role="img" aria-label="Pitch plot of recorded shot origins" className="block aspect-[5/3] w-full">
          <rect x="1" y="1" width="98" height="58" rx="1.5" fill="#e4ecdf" stroke="#9db59e" strokeWidth=".6" />
          <line x1="50" y1="1" x2="50" y2="59" stroke="#afc2aa" strokeWidth=".5" />
          <circle cx="50" cy="30" r="8" fill="none" stroke="#afc2aa" strokeWidth=".5" />
          <circle cx="50" cy="30" r=".7" fill="#9fb59d" />
          <rect x="1" y="15" width="15" height="30" fill="none" stroke="#afc2aa" strokeWidth=".5" />
          <rect x="84" y="15" width="15" height="30" fill="none" stroke="#afc2aa" strokeWidth=".5" />
          <rect x="1" y="22" width="5" height="16" fill="none" stroke="#afc2aa" strokeWidth=".5" />
          <rect x="94" y="22" width="5" height="16" fill="none" stroke="#afc2aa" strokeWidth=".5" />
          {shots.map((shot, index) => {
            const team = shot.teamSide === 'home' ? homeShots : awayShots;
            const x = Math.max(2, Math.min(98, shot.x ?? 0));
            const y = Math.max(2, Math.min(58, ((shot.y ?? 0) / 100) * 60));
            return (
              <g key={`${shot.minute}-${shot.sourceOrder}-${index}`}>
                <circle cx={x} cy={y} r="2.1" fill={team.side === 'home' ? '#c76b4b' : '#3f7160'} stroke="#f8f7ef" strokeWidth=".7" />
                <title>{`${team.name} · ${shot.minute}′ · xG ${shot.xg ?? '—'} · ${shot.outcome ?? 'shot'}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[8px] text-[#747f75]">
        <div className="flex flex-wrap gap-3"><span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#c76b4b]" />{homeName}</span><span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#3f7160]" />{awayName}</span></div>
        <span>Origins only · no continuous tracking</span>
      </div>
    </div>
  );
}

function TeamSignalCard({ team }: { team: NonNullable<ReturnType<typeof analyzeLiveMatch>['home']> }) {
  const metrics = [
    ['xG', amount(team.xg)],
    ['xGOT', amount(team.xgot)],
    ['Shots', String(team.shots)],
    ['On target', team.shotsOnTarget === null ? '—' : String(team.shotsOnTarget)],
  ];
  return (
    <article className="overflow-hidden rounded-xl border border-[#dfded5] bg-[#fbfaf6]" data-testid={`live-team-${team.side}`}>
      <header className="flex items-center justify-between gap-3 border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`size-2 rounded-full ${team.side === 'home' ? 'bg-[#c76b4b]' : 'bg-[#3f7160]'}`} />
          <h3 className="truncate text-[11px] font-extrabold text-[#40534e]">{team.name}</h3>
        </div>
        <span className="mono text-[10px] text-[#899087]">score {team.score}</span>
      </header>
      <div className="grid grid-cols-2 divide-x divide-y divide-[#eceae2] sm:grid-cols-4 sm:divide-y-0">
        {metrics.map(([label, value]) => <div key={label} className="px-3 py-3"><p className="mono text-[7px] uppercase tracking-wide text-[#9a9d93]">{label}</p><p className="mono mt-1 text-[15px] font-medium text-[#40564e]">{value}</p></div>)}
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-[#eceae2] bg-[#eceae2] sm:grid-cols-4">
        <div className="bg-[#fbfaf6] px-3 py-2.5"><p className="mono text-[7px] uppercase text-[#9a9d93]">λ Kinetic intensity</p><p className="mono mt-1 text-[10px] font-medium text-[#40564e]">{amount(team.kineticIntensity, 1)}<span className="text-[8px] text-[#9a9d93]"> / 100</span></p></div>
        <div className="bg-[#fbfaf6] px-3 py-2.5"><p className="mono text-[7px] uppercase text-[#9a9d93]">μ Resistance decay</p><p className="mono mt-1 text-[10px] font-medium text-[#40564e]">{amount(team.resistanceDecay, 1)}<span className="text-[8px] text-[#9a9d93]"> / 100</span></p></div>
        <div className="bg-[#fbfaf6] px-3 py-2.5"><p className="mono text-[7px] uppercase text-[#9a9d93]">Expected remaining goals</p><p className="mono mt-1 text-[10px] font-medium text-[#40564e]">{amount(team.projectedGoalsRemaining)}</p></div>
        <div className="bg-[#fbfaf6] px-3 py-2.5"><p className="mono text-[7px] uppercase text-[#9a9d93]">Incidents</p><p className="mt-1 flex flex-wrap gap-x-2 text-[8px] text-[#69766e]"><span>{team.redCards} red</span><span>{team.injurySignals} injury</span><span>{team.substitutions} subs</span></p></div>
      </div>
    </article>
  );
}

export function LiveIntelligencePanel({
  fixtureId,
  matchCenter,
  replay,
  replayLoading,
  replayError,
  onRetryReplay,
}: {
  fixtureId: number;
  matchCenter?: FootballMatchCenter;
  replay?: FootballMatchReplay;
  replayLoading: boolean;
  replayError: unknown;
  onRetryReplay: () => void;
}) {
  const automaticSourceUrl = replay?.sourceMatchUrl ?? '';
  const [manualSourceUrl, setManualSourceUrl] = useState('');
  const effectiveSourceUrl = manualSourceUrl || automaticSourceUrl;
  const sourceForm = useForm<{ sourceUrl: string }>({
    defaultValues: { sourceUrl: manualSourceUrl || automaticSourceUrl },
    mode: 'onSubmit',
  });
  const setFormSourceUrl = sourceForm.setValue;
  useEffect(() => {
    if (!manualSourceUrl) {
      setFormSourceUrl('sourceUrl', automaticSourceUrl, { shouldDirty: false, shouldValidate: false });
    }
  }, [automaticSourceUrl, manualSourceUrl, setFormSourceUrl]);
  const liveActionQuery = useGetFootballLiveAction(
    { sourceUrl: effectiveSourceUrl },
    {
      query: {
        enabled: Boolean(effectiveSourceUrl),
        queryKey: getGetFootballLiveActionQueryKey({ sourceUrl: effectiveSourceUrl }),
        retry: false,
        staleTime: 0,
        refetchInterval: (query) =>
          /\b(live|in play|in progress|first half|second half|1st half|2nd half|1h|2h|half[ -]?time|halftime|extra time|extra-time)\b/i.test(query.state.data?.status ?? '')
            ? 15_000
            : false,
        refetchIntervalInBackground: false,
      },
    },
  );
  const liveAction = liveActionQuery.data as FootballLiveAction | undefined;
  const fallbackLiveAction = useMemo(
    () => matchCenterLiveSnapshot(matchCenter),
    [matchCenter],
  );
  const liveSnapshot = liveAction ?? fallbackLiveAction;
  const isUsingMatchCenterFallback = !liveAction && Boolean(fallbackLiveAction);
  const intelligence = useMemo(
    () => analyzeLiveMatch({ matchCenter, liveAction: liveSnapshot }),
    [matchCenter, liveSnapshot],
  );
  const playerGroups = matchCenter?.players ?? [];
  const teams = intelligence.home && intelligence.away ? [intelligence.home, intelligence.away] : [];
  const ratings = teams.map((team) => {
    const sourceGroup = playerGroups.find((group) =>
      group.teamId !== null && group.teamId === (team.side === 'home' ? matchCenter?.match.home.id : matchCenter?.match.away.id),
    ) ?? playerGroups.find((group) => group.teamName.toLowerCase() === team.name.toLowerCase());
    return { team, players: (sourceGroup?.players ?? []).filter((player) => player.rating !== null && player.rating.trim() !== '') };
  });
  const hasCurrentScores = liveSnapshot?.homeScore !== null && liveSnapshot?.homeScore !== undefined && liveSnapshot?.awayScore !== null && liveSnapshot?.awayScore !== undefined;
  const sourceLink = liveAction ? effectiveSourceUrl : matchCenter?.sourceUrl;
  const submitSource = sourceForm.handleSubmit(({ sourceUrl: submittedUrl }) => {
    const normalizedUrl = submittedUrl.trim();
    setManualSourceUrl(normalizedUrl === automaticSourceUrl ? '' : normalizedUrl);
  });
  const clearManualSource = () => {
    setManualSourceUrl('');
    setFormSourceUrl('sourceUrl', automaticSourceUrl, { shouldDirty: false, shouldValidate: false });
  };

  return (
    <section className="space-y-5" data-testid="panel-live-intelligence">
      <header className="overflow-hidden rounded-xl border border-[#d9e0d6] bg-[#f0f4ed]">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:px-5 sm:py-4">
          <div>
            <p className="mono text-[8px] uppercase tracking-[.16em] text-[#9b7160]">Live match intelligence · fixture {fixtureId}</p>
            <h2 className="mt-1 text-[16px] font-extrabold tracking-[-.04em] text-[#344550]">Evidence first. Scenarios second.</h2>
            <p className="mt-1 max-w-2xl text-[9px] leading-5 text-[#727973]">Forecasts continue from the live score and estimate what may happen in the remaining minutes using match state and live chances.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d9dfd5] bg-[#f8faf5] px-2.5 py-1.5 text-[8px] font-extrabold uppercase tracking-wide text-[#68796e]">
            <Activity size={11} className={liveActionQuery.isFetching ? 'animate-pulse text-[#c5654a]' : 'text-[#68816e]'} />
            {liveActionQuery.isFetching ? 'Refreshing' : liveAction ? '365Scores snapshot' : fallbackLiveAction ? 'Live match-center data' : 'Awaiting source'}
          </span>
        </div>
        <div className="grid gap-2 border-t border-[#dfe5db] bg-[#f7f8f2] px-4 py-3 text-[8px] leading-4 text-[#788178] sm:grid-cols-3 sm:px-5">
          <span className="inline-flex items-start gap-1.5"><Crosshair size={12} className="mt-0.5 shrink-0 text-[#a66c53]" /> Shot origins are discrete recorded events, not player or ball tracking.</span>
          <span className="inline-flex items-start gap-1.5"><Users size={12} className="mt-0.5 shrink-0 text-[#66816f]" /> Player tracking and fatigue velocity are unavailable unless supplied by the source.</span>
          <span className="inline-flex items-start gap-1.5"><Signal size={12} className="mt-0.5 shrink-0 text-[#66816f]" /> Refresh cadence: every 15 seconds while the source reports live play.</span>
        </div>
      </header>

      <section className="rounded-xl border border-[#dfe2d8] bg-[#fbfaf6] p-4 sm:p-5" data-testid="section-live-intelligence-source-override">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Source resolution</p>
            <h3 className="mt-1 text-[12px] font-extrabold text-[#344550]">{manualSourceUrl ? 'Manual 365Scores source active' : automaticSourceUrl ? 'Match link found automatically' : 'Finding this fixture on 365Scores'}</h3>
            <p className="mt-1 max-w-2xl text-[8px] leading-4 text-[#858982]">The app matches the fixture’s teams and kickoff time to 365Scores. The optional link below is only needed if you want to override that match.</p>
          </div>
          {manualSourceUrl && (
            <button type="button" onClick={clearManualSource} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#d9dfd5] bg-[#f6f7f1] px-2.5 text-[8px] font-extrabold text-[#62776a] hover:bg-[#edf3ed]" data-testid="button-clear-live-source-override">
              Use replay source
            </button>
          )}
        </div>
        <Form {...sourceForm}>
          <form onSubmit={submitSource} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <FormField
              control={sourceForm.control}
              name="sourceUrl"
              rules={{
                validate: (value) => {
                  if (!value.trim()) return true;
                  try {
                    const url = new URL(value);
                    return /^https?:$/.test(url.protocol) && /(^|\.)365scores\.com$/i.test(url.hostname)
                      ? true
                      : 'Use a full match URL on 365scores.com.';
                  } catch {
                    return 'Enter a valid full 365Scores match URL.';
                  }
                },
              }}
              render={({ field }) => (
                <FormItem className="min-w-0 space-y-1">
                  <FormLabel className="text-[8px] font-bold uppercase tracking-wide text-[#77847c]">365Scores football match URL</FormLabel>
                  <FormControl>
                    <input
                      {...field}
                      type="url"
                      autoComplete="url"
                      placeholder="https://www.365scores.com/football/match/…"
                      className="h-9 w-full rounded-lg border border-[#d9dfd5] bg-[#fafbf8] px-3 text-[9px] text-[#40564e] outline-none focus:border-[#8ea393] focus:ring-2 focus:ring-[#dbe6da]"
                      aria-label="Full 365Scores football match URL"
                      data-testid="input-live-intelligence-source-url"
                    />
                  </FormControl>
                  <FormDescription className="text-[8px] leading-4 text-[#858982]">Optional override. Leave blank to use the automatically resolved fixture.</FormDescription>
                  <FormMessage className="text-[8px] text-[#a85c49]" />
                </FormItem>
              )}
            />
            <button type="submit" disabled={liveActionQuery.isFetching} className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#314d40] px-3 text-[9px] font-extrabold text-[#f7f2e6] hover:bg-[#263f34] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-submit-live-source-override">
              {liveActionQuery.isFetching ? <Activity size={11} className="animate-pulse" /> : <Signal size={11} />}
              {manualSourceUrl ? 'Update manual link' : 'Apply manual link'}
            </button>
          </form>
        </Form>
      </section>

      {replayLoading && !replay && !manualSourceUrl && (
        <section className="space-y-3" role="status" aria-label="Resolving verified match source" data-testid="status-live-intelligence-replay-loading">
          <div className="h-16 animate-pulse rounded-xl bg-[#e8e9df]" />
          <div className="h-40 animate-pulse rounded-xl bg-[#e8e9df]" />
          <p className="mono text-[8px] uppercase tracking-wide text-[#899087]">Resolving replay source link…</p>
        </section>
      )}
      {Boolean(replayError) && !replay && !manualSourceUrl && (
        <section className="flex flex-col items-start gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4" role="alert" data-testid="status-live-intelligence-replay-error">
          <div className="flex items-start gap-2.5"><AlertTriangle size={15} className="mt-0.5 text-[#b85b46]" /><div><h3 className="text-[10px] font-extrabold text-[#784b3e]">Replay lookup unavailable</h3><p className="mt-1 text-[9px] leading-5 text-[#8c6b5e]">{readableError(replayError)}</p></div></div>
          <button type="button" onClick={onRetryReplay} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-2.5 text-[8px] font-extrabold text-[#855542] hover:bg-white" data-testid="button-retry-live-replay"><RefreshCw size={11} /> Retry replay lookup</button>
        </section>
      )}
      {!replayLoading && !replayError && !automaticSourceUrl && !manualSourceUrl && (
        <div className="rounded-xl border border-dashed border-[#deddd4] bg-[#f7f6f0] px-4 py-4 text-[9px] leading-5 text-[#858982]" data-testid="status-live-intelligence-replay-empty">365Scores has not returned a verified link for this fixture yet. You can retry the automatic lookup or use an optional manual link.</div>
      )}
      {effectiveSourceUrl && liveActionQuery.isLoading && !liveSnapshot && (
        <section className="space-y-3" role="status" aria-label="Loading live intelligence source" data-testid="status-live-intelligence-loading">
          <div className="h-24 animate-pulse rounded-xl bg-[#e8e9df]" /><div className="h-36 animate-pulse rounded-xl bg-[#e8e9df]" />
          <p className="mono text-[8px] uppercase tracking-wide text-[#899087]">Fetching 365Scores live snapshot…</p>
        </section>
      )}
      {effectiveSourceUrl && liveActionQuery.isError && !liveSnapshot && (
        <section className="flex flex-col items-start gap-3 rounded-xl border border-[#e3c3b6] bg-[#fff6f0] p-4" role="alert" data-testid="status-live-intelligence-error">
          <div className="flex items-start gap-2.5"><AlertTriangle size={15} className="mt-0.5 text-[#b85b46]" /><div><h3 className="text-[10px] font-extrabold text-[#784b3e]">Live snapshot unavailable</h3><p className="mt-1 text-[9px] leading-5 text-[#8c6b5e]">{readableError(liveActionQuery.error)}</p></div></div>
          <button type="button" onClick={() => { void liveActionQuery.refetch(); }} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#e5c5b8] bg-[#fffaf6] px-2.5 text-[8px] font-extrabold text-[#855542] hover:bg-white" data-testid="button-retry-live-intelligence"><RefreshCw size={11} /> Try again</button>
        </section>
      )}
      {isUsingMatchCenterFallback && (
        <p className="rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2.5 text-[8px] leading-4 text-[#84684f]" role="status" data-testid="status-live-intelligence-match-center-fallback">
          Forecasting from the live score, match minute, events, and statistics while the 365Scores source is unavailable.
        </p>
      )}
      {liveSnapshot && (
        <>
          {liveActionQuery.isError && liveAction && <p className="rounded-lg border border-[#ead9c4] bg-[#fbf3e9] px-3 py-2.5 text-[8px] leading-4 text-[#84684f]" role="status" data-testid="status-live-intelligence-stale">Refresh failed; showing the last successful live snapshot.</p>}
          <section className="grid gap-3 sm:grid-cols-[1.1fr_.9fr]" data-testid="section-live-intelligence-baseline">
            <article className="rounded-xl border border-[#283d4b] bg-[#2d4350] p-4 text-[#f5f1e7]">
              <div className="flex items-start justify-between gap-3"><div><p className="mono text-[8px] uppercase tracking-[.16em] text-[#d6a38b]">Current match state</p><p className="mt-2 text-[12px] font-bold">{liveSnapshot.homeTeam}<span className="mx-2 text-[#aab4ae]">vs</span>{liveSnapshot.awayTeam}</p></div><span className="rounded-full border border-white/15 px-2 py-1 text-[8px] font-bold uppercase text-[#d9e4d6]">{liveSnapshot.status}</span></div>
              <div className="mt-3 flex items-end gap-2"><span className="mono text-[38px] leading-none tracking-[-.08em]">{hasCurrentScores ? `${liveSnapshot.homeScore}–${liveSnapshot.awayScore}` : '—'}</span><span className="mono pb-1 text-[9px] text-[#c6d0c8]">{intelligence.elapsedMinute ?? liveSnapshot.elapsedMinute ?? '—'}′ · {intelligence.remainingMinutes ?? '—'}′ remaining</span></div>
              <p className="mt-3 border-t border-white/10 pt-2 text-[8px] leading-4 text-[#c7d0c8]">The forecast starts from this observed score and estimates goals during the remaining minutes.</p>
            </article>
            <article className="rounded-xl border border-[#dfded5] bg-[#fbfaf6] p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Source freshness</p><h3 className="mt-1 text-[12px] font-extrabold text-[#40534e]">Latest observation</h3></div><Clock3 size={15} className="text-[#758779]" /></div>
              <p className="mono mt-3 text-[16px] text-[#40564e]">{formatTime(liveSnapshot.observedAt)}</p>
              <p className="mt-1 text-[8px] text-[#858982]">{intelligence.observedAgeSeconds === null ? 'Age unavailable' : `${intelligence.observedAgeSeconds}s old at render`}</p>
              {sourceLink && <a href={sourceLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-[8px] font-extrabold text-[#597563] underline decoration-[#b5c6b4] underline-offset-2" data-testid="link-live-intelligence-source">{liveAction ? manualSourceUrl ? 'Open manual 365Scores source' : 'Open 365Scores match source' : 'Open live match-center source'}</a>}
            </article>
          </section>

          {intelligence.status === 'ready' && intelligence.home && intelligence.away && intelligence.simulation && (
            <>
              <section className="grid gap-3 lg:grid-cols-[1.15fr_.85fr]" data-testid="section-live-scenarios">
                <article className="rounded-xl border border-[#dfded5] bg-[#fbfaf6] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Scenario distribution</p><h3 className="mt-1 text-[14px] font-extrabold tracking-[-.03em] text-[#344550]">{LIVE_SIMULATION_RUNS.toLocaleString()} simulated continuations</h3></div>
                    <span className={`rounded-full px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-wide ${intelligence.confidence?.level === 'medium' ? 'bg-[#e3eee4] text-[#55725d]' : 'bg-[#f3e9d6] text-[#8a7048]'}`} data-testid="text-live-confidence">{intelligence.confidence?.label}</span>
                  </div>
                  <p className="mt-1 text-[8px] leading-4 text-[#858982]">Simulation shares only — not calibrated real-world probabilities or betting advice.</p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[
                      [intelligence.home.name, intelligence.simulation.homeWinShare, 'home'],
                      ['Draw', intelligence.simulation.drawShare, 'draw'],
                      [intelligence.away.name, intelligence.simulation.awayWinShare, 'away'],
                    ].map(([label, share, key]) => <div key={key} className="rounded-lg border border-[#e8e6de] bg-[#f6f5ef] p-3"><p className="truncate text-[8px] font-bold text-[#778078]">{label}</p><p className="mono mt-1 text-[19px] text-[#40564e]">{share}%</p><div className="mt-2 h-1 overflow-hidden rounded bg-[#e4e4da]"><div className="h-full rounded bg-[#698b72]" style={{ width: `${share}%` }} /></div></div>)}
                  </div>
                  <div className="mt-4 border-t border-[#eceae2] pt-3">
                    <p className="mono mb-2 text-[7px] uppercase tracking-[.14em] text-[#9a9d93]">Most frequent exact scorelines</p>
                    <div className="grid gap-2 sm:grid-cols-3">{intelligence.simulation.topScorelines.map((scoreline) => <div key={`${scoreline.homeScore}-${scoreline.awayScore}`} className="flex items-center justify-between rounded-lg border border-[#e8e6de] px-3 py-2" data-testid={`scenario-scoreline-${scoreline.homeScore}-${scoreline.awayScore}`}><span className="mono text-[13px] font-medium text-[#40564e]">{scoreline.homeScore}–{scoreline.awayScore}</span><span className="mono text-[9px] text-[#748077]">{scoreline.share}% <span className="text-[#a0a198]">· {scoreline.runs.toLocaleString()} runs</span></span></div>)}</div>
                  </div>
                </article>
                <article className="rounded-xl border border-[#e8dfca] bg-[#faf5e9] p-4 sm:p-5">
                  <div className="flex items-center gap-2"><ShieldAlert size={15} className="text-[#9b754f]" /><div><p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Model limits</p><h3 className="text-[12px] font-extrabold text-[#6f5d42]">Confidence: {intelligence.confidence?.level}</h3></div></div>
                  <p className="mt-2 text-[8px] leading-4 text-[#7d6c4d]">Transparent heuristic, not trained AI. Scenario shares are not calibrated forecasts.</p>
                  <ul className="mt-3 space-y-2">{(intelligence.confidence?.reasons ?? []).map((reason, index) => <li key={`${reason}-${index}`} className="flex items-start gap-2 text-[8px] leading-4 text-[#786c55]"><span className="mt-1 size-1 shrink-0 rounded-full bg-[#b68b57]" />{reason}</li>)}</ul>
                  {!intelligence.signalCoverage.xg && <p className="mt-3 rounded-lg border border-[#ead9c4] bg-[#fffaf0] px-2.5 py-2 text-[8px] leading-4 text-[#84684f]">At least one side lacks source xG. A shot-count proxy is used when shots exist; a neutral scoring prior prevents a shotless side from being treated as unable to score.</p>}
                </article>
              </section>
              {intelligence.matchDynamics && (
                <section className="overflow-hidden rounded-xl border border-[#d7dfd4] bg-[#eef3eb]" data-testid="section-live-match-dynamics">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#dce4d9] px-4 py-3.5 sm:px-5">
                    <div>
                      <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Second layer · match dynamics</p>
                      <h3 className="mt-1 text-[13px] font-extrabold tracking-[-.03em] text-[#344550]">Pressure balance & outcome entropy</h3>
                    </div>
                    <span className="rounded-full border border-[#cad9c9] bg-[#f8faf5] px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.08em] text-[#55725d]" data-testid="text-live-dynamics-state">
                      {intelligence.matchDynamics.state}
                    </span>
                  </div>
                  <div className="grid gap-px bg-[#dce4d9] sm:grid-cols-3">
                    <article className="bg-[#f8faf5] px-4 py-3.5 sm:px-5">
                      <p className="mono text-[7px] uppercase tracking-[.12em] text-[#92968c]">Pressure imbalance</p>
                      <p className="mono mt-1.5 text-[23px] leading-none text-[#40564e]" data-testid="text-live-pressure-imbalance">{amount(intelligence.matchDynamics.imbalanceIndex, 1)}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#e6e9e0] pt-2">
                        <div><p className="truncate text-[7px] font-bold text-[#9a9d93]">{intelligence.home.name} pressure</p><p className="mono mt-1 text-[10px] text-[#c16b4d]">{intelligence.matchDynamics.homePressure > 0 ? '+' : ''}{amount(intelligence.matchDynamics.homePressure, 1)}</p></div>
                        <div><p className="truncate text-[7px] font-bold text-[#9a9d93]">{intelligence.away.name} pressure</p><p className="mono mt-1 text-[10px] text-[#3f7160]">{intelligence.matchDynamics.awayPressure > 0 ? '+' : ''}{amount(intelligence.matchDynamics.awayPressure, 1)}</p></div>
                      </div>
                    </article>
                    <article className="bg-[#f8faf5] px-4 py-3.5 sm:px-5">
                      <p className="mono text-[7px] uppercase tracking-[.12em] text-[#92968c]">Outcome-distribution entropy</p>
                      <p className="mono mt-1.5 text-[23px] leading-none text-[#40564e]" data-testid="text-live-outcome-entropy">{amount(intelligence.matchDynamics.outcomeEntropy, 1)}</p>
                      <p className="mt-2 text-[8px] leading-4 text-[#858982]">Entropy of the Monte Carlo final-scoreline distribution, not measured match volatility.</p>
                    </article>
                    <article className="flex flex-col justify-center bg-[#f8faf5] px-4 py-3.5 sm:px-5">
                      <p className="mono text-[7px] uppercase tracking-[.12em] text-[#92968c]">Current reading</p>
                      <p className="mt-1.5 text-[9px] font-bold leading-5 text-[#53675c]" data-testid="text-live-dynamics-reading">{intelligence.matchDynamics.reading}</p>
                    </article>
                  </div>
                  <p className="px-4 py-2.5 text-[8px] leading-4 text-[#788178] sm:px-5">State, pressure and imbalance indices are heuristic proxies based on the available match inputs; they are not tracking measurements.</p>
                </section>
              )}
              <section className="grid gap-3 xl:grid-cols-[1fr_1fr]" aria-label="Team live signals">
                <TeamSignalCard team={intelligence.home} />
                <TeamSignalCard team={intelligence.away} />
              </section>
              <div className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]">
                <ShotOriginMap homeName={intelligence.home.name} awayName={intelligence.away.name} homeShots={intelligence.home} awayShots={intelligence.away} />
                <section className="rounded-xl border border-[#dfded5] bg-[#fbfaf6] p-4" data-testid="section-live-player-ratings">
                  <div className="mb-3 flex items-end justify-between gap-2"><div><p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Source-reported ratings</p><h3 className="mt-1 text-[12px] font-extrabold text-[#344550]">Available player ratings</h3></div><span className="mono text-[8px] text-[#92968c]">{ratings.reduce((count, item) => count + item.players.length, 0)} rated</span></div>
                  {ratings.some((item) => item.players.length > 0) ? <div className="grid gap-3 sm:grid-cols-2">{ratings.map(({ team, players }) => <div key={team.side}><p className="mb-1.5 truncate text-[8px] font-extrabold text-[#6e7d73]">{team.name}</p><div className="space-y-1">{players.slice(0, 8).map((player) => <div key={`${player.id}-${player.name}`} className="flex items-center justify-between gap-3 rounded-md bg-[#f5f4ee] px-2.5 py-1.5"><span className="truncate text-[8px] text-[#58665f]">{player.name}</span><span className="mono text-[9px] font-medium text-[#4f705b]">{player.rating}</span></div>)}</div></div>)}</div> : <p className="rounded-lg border border-dashed border-[#deddd4] bg-[#f7f6f0] px-3 py-4 text-[8px] leading-4 text-[#858982]">No source-reported player ratings are available in this snapshot.</p>}
                </section>
              </div>
              <section className="rounded-xl border border-[#dfded5] bg-[#fbfaf6] p-4" data-testid="section-live-timeline">
                <div className="mb-3 flex items-end justify-between gap-2"><div><p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Source commentary</p><h3 className="mt-1 text-[12px] font-extrabold text-[#344550]">Incident timeline</h3></div><span className="mono text-[8px] text-[#92968c]">{intelligence.timeline.length} latest events</span></div>
                {intelligence.timeline.length ? <div className="grid gap-2 sm:grid-cols-2">{intelligence.timeline.map((event, index) => <article key={`${event.minute}-${event.title}-${index}`} className="grid grid-cols-[42px_minmax(0,1fr)] gap-2.5 rounded-lg border border-[#e9e7df] bg-[#f8f7f2] p-2.5"><span className="mono h-fit rounded-md bg-[#e9eee8] px-1.5 py-1 text-center text-[8px] text-[#62796a]">{event.minute}′</span><div><p className="text-[9px] font-bold text-[#4d6057]">{event.title}</p>{event.detail && <p className="mt-1 text-[8px] leading-4 text-[#828980]">{event.detail}</p>}<p className="mono mt-1 text-[7px] uppercase tracking-wide text-[#a0a198]">{event.kind}</p></div></article>)}</div> : <p className="rounded-lg border border-dashed border-[#deddd4] bg-[#f7f6f0] px-3 py-4 text-[8px] text-[#858982]">No incident or commentary events were returned for this snapshot.</p>}
              </section>
              <section className="rounded-xl border border-[#e5e3da] bg-[#f7f6f0] p-3.5" data-testid="section-live-input-coverage">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Input audit</p><h3 className="mt-1 text-[10px] font-extrabold text-[#56645d]">Snapshot coverage</h3></div><div className="flex flex-wrap gap-1.5">{coverageLabels.map(([key, label]) => { const covered = intelligence.signalCoverage[key]; return <span key={key} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[7px] font-bold ${covered ? 'border-[#d5e2d5] bg-[#edf3ed] text-[#5d7863]' : 'border-[#e3e0d7] bg-[#f1f0e9] text-[#92958b]'}`}><Check size={9} />{label}: {covered ? 'available' : 'missing'}</span>; })}</div></div>
              </section>
            </>
          )}
          {intelligence.status !== 'ready' && (
            <section className="rounded-xl border border-dashed border-[#deddd4] bg-[#f7f6f0] px-4 py-5" data-testid="status-live-intelligence-insufficient">
              <p className="mono text-[8px] uppercase tracking-[.15em] text-[#9b7160]">Scenario engine paused</p>
              <p className="mt-1 text-[10px] font-extrabold text-[#56645d]">{intelligence.message ?? 'Live scenario data is not available.'}</p>
              <p className="mt-1 text-[8px] leading-4 text-[#858982]">Source facts and freshness remain visible above; a score simulation is withheld until required live inputs are available. If this source does not match the fixture teams, submit a different 365Scores match URL above.</p>
            </section>
          )}
        </>
      )}
    </section>
  );
}
