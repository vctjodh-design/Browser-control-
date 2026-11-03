import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Maximize2, MonitorPlay, Play, RotateCcw, Square } from 'lucide-react';
import {
  loadSimFormProfile,
  stashFormProfile,
  type SimFormProfile,
  type SimTeamProfile,
} from '@/lib/sim-form-profile';

// Clubs arrive from the fixture feed as names only, so each side gets a stable
// kit colour derived from its name. The same club therefore always plays in the
// same colours, and the two sides never share one.
const KIT_COLOURS = [
  0xc8102e, 0x12327a, 0x0f7b4b, 0xd8a012, 0x5b2d8e,
  0x0b6fa4, 0xb84a1f, 0x2f6f4f, 0x8a1c3b, 0x1f2b38,
];

function kitColour(name: string) {
  let hash = 7;
  for (const character of name.trim().toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1_000_003;
  }
  return KIT_COLOURS[hash % KIT_COLOURS.length];
}

const hex = (colour: number) => colour.toString(16).padStart(6, '0');

function formLetters(team: SimTeamProfile, games = 5) {
  const results = team.recent.slice(0, games).map((match) => match.result).reverse();
  return results.length ? results : team.record.form.slice(-games).split('');
}

// A match covers 90 minutes of football in roughly nine minutes of real time at
// 1x, and the game stops drawing frames above WATCHABLE_SPEED so a batch can
// actually reach the rest of the range.
const MATCH_SECONDS = 540;
const WATCHABLE_SPEED = 4;
const SPEEDS = Array.from({ length: 20 }, (_, index) => index + 1);

function durationText(totalMatches: number, speed: number) {
  const seconds = Math.round((totalMatches * MATCH_SECONDS) / Math.max(1, speed));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

type SeriesResult = {
  round: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  homeShots: number;
  awayShots: number;
  homePossession: number;
  awayPossession: number;
};

type SeriesRun = {
  total: number;
  done: number;
  running: boolean;
  live: { home: number; away: number } | null;
  results: SeriesResult[];
};

const RESULT_STYLE: Record<string, string> = {
  W: 'bg-[#2f6b4f] text-[#e8f3ec]',
  D: 'bg-[#4a5a5f] text-[#e6ecec]',
  L: 'bg-[#8a3b34] text-[#f7e9e6]',
};

function FormChips({ team }: { team: SimTeamProfile }) {
  return (
    <span className="flex items-center gap-1">
      {formLetters(team).map((result, index) => (
        <span
          key={`${result}-${index}`}
          className={`grid size-[15px] place-items-center rounded-[3px] text-[8px] font-extrabold ${RESULT_STYLE[result] ?? RESULT_STYLE.D}`}
        >
          {result}
        </span>
      ))}
    </span>
  );
}

function LineupRow({ player, index }: { player: SimTeamProfile['lineup'][number]; index: number }) {
  const rating = player.averageRating;
  return (
    <li className="grid grid-cols-[18px_26px_minmax(0,1fr)_auto_auto_auto] items-center gap-1.5 border-b border-[#243746] py-[3px] last:border-0">
      <span className="mono text-[8px] text-[#6f847f]">{index + 1}</span>
      <span className="mono text-[8px] text-[#8ba39c]">{player.number ?? '–'}</span>
      <span className="truncate text-[9px] font-bold text-[#dbe6e0]">{player.name}</span>
      <span className="mono text-[7px] uppercase tracking-[.08em] text-[#7d938d]">{player.role}</span>
      <span
        className="mono w-[22px] text-right text-[8px] text-[#7bc4a2]"
        title="Match intelligence: pass volume and accuracy, key passes and discipline"
      >
        {Math.round((player.signals.intelligence ?? 0.5) * 100)}
      </span>
      <span className="mono w-[34px] text-right text-[8px] text-[#9fb5ad]">
        {rating !== null ? rating.toFixed(1) : '–'}
      </span>
    </li>
  );
}

function TeamFormCard({ team }: { team: SimTeamProfile }) {
  const [open, setOpen] = useState(false);
  const games = team.record.games;
  return (
    <details
      className="group rounded-lg border border-[#2c4152] bg-[#16242f]"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      data-testid={`sim-form-${team.side}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[9px] font-extrabold uppercase tracking-[.04em] text-[#e6efe9]">
              {team.name}
            </span>
            <span className="mono rounded bg-[#22384a] px-1 text-[7.5px] text-[#9db6ac]">
              {team.formation}
            </span>
            {team.formationSource === 'roles' ? (
              <span
                className="mono rounded bg-[#1d2f3c] px-1 text-[7px] uppercase text-[#7f978f]"
                title="The archived team sheets label nearly every club the same way, so this shape is read from the XI's own roles."
              >
                roles
              </span>
            ) : null}
          </span>
          <span className="mono mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[7.5px] uppercase tracking-[.09em] text-[#7f978f]">
            <FormChips team={team} />
            <span>{games} games</span>
            <span>{team.record.pointsPerGame.toFixed(2)} ppg</span>
            <span>
              {team.record.goalsFor}-{team.record.goalsAgainst} goals
            </span>
            {team.table ? (
              <span data-testid={`sim-table-${team.side}`}>
                #{team.table.rank} · {team.table.points} pts
              </span>
            ) : null}
          </span>
        </span>
        <ChevronDown
          size={11}
          className={`shrink-0 text-[#7f978f] transition ${open ? 'rotate-180' : ''}`}
        />
      </summary>
      <div className="border-t border-[#243746] px-2.5 py-2">
        <p className="mono mb-1 flex items-center justify-between text-[7px] uppercase tracking-[.12em] text-[#7f978f]">
          <span>Predicted XI · {team.lineupSample} team sheets</span>
          <span>{team.tactics.label}</span>
        </p>
        <ol>
          {team.lineup.map((player, index) => (
            <LineupRow key={`${player.name}-${index}`} player={player} index={index} />
          ))}
        </ol>
        {team.bench.length ? (
          <p className="mono mt-1 text-[7px] leading-3 text-[#6f847f]">
            Bench: {team.bench.slice(0, 5).map((player) => player.name).join(' · ')}
          </p>
        ) : null}
      </div>
    </details>
  );
}

export function MatchSimPanel({
  fixtureId,
  home,
  away,
  venue,
  variant = 'inline',
}: {
  fixtureId: number;
  home: string;
  away: string;
  venue?: string | null;
  /** `theatre` fills a whole tab body: no outer margin, taller pitch, no rounding. */
  variant?: 'inline' | 'theatre';
}) {
  const theatre = variant === 'theatre';
  const [generation, setGeneration] = useState(0);
  const [profile, setProfile] = useState<SimFormProfile | null>(null);
  const [profileState, setProfileState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [rounds, setRounds] = useState(5);
  const [speed, setSpeed] = useState(10);
  const [run, setRun] = useState<SeriesRun | null>(null);

  useEffect(() => {
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      setProfileState('unavailable');
      return;
    }
    const controller = new AbortController();
    let settled = false;
    setProfileState('loading');
    setProfile(null);

    loadSimFormProfile(fixtureId, controller.signal)
      .then((loaded) => {
        settled = true;
        stashFormProfile(loaded);
        setProfile(loaded);
        setProfileState('ready');
      })
      .catch(() => {
        if (settled) return;
        setProfileState('unavailable');
      });

    return () => controller.abort();
  }, [fixtureId]);

  const source = useMemo(() => {
    let homeColour = kitColour(home);
    const awayColour = kitColour(away);
    if (awayColour === homeColour) homeColour = KIT_COLOURS[(KIT_COLOURS.indexOf(homeColour) + 3) % KIT_COLOURS.length];

    const params = new URLSearchParams({
      home,
      away,
      homeColour: hex(homeColour),
      awayColour: hex(awayColour),
      fixture: String(fixtureId),
    });
    if (venue) params.set('venue', venue);
    return `${import.meta.env.BASE_URL}sim.html?${params.toString()}`;
  }, [home, away, venue, fixtureId]);

  // The game inside the frame runs the batch and reports each scoreline back.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as {
        source?: string;
        type?: string;
        total?: number;
        done?: number;
        result?: SeriesResult;
        results?: SeriesResult[];
      } | null;
      if (!data || data.source !== 'match-sim') return;

      if (data.type === 'sim-ready') {
        setEngineReady(true);
      } else if (data.type === 'sim-series-start') {
        setRun({ total: data.total ?? 0, done: 0, running: true, live: null, results: [] });
      } else if (data.type === 'sim-series-round' && data.result) {
        const result = data.result;
        setRun((previous) =>
          previous
            ? {
                ...previous,
                done: data.done ?? previous.done + 1,
                live: { home: result.homeScore, away: result.awayScore },
                results: [...previous.results, result],
              }
            : previous,
        );
      } else if (data.type === 'sim-series-done') {
        const results = (data.results ?? []) as SeriesResult[];
        setRun((previous) =>
          previous ? { ...previous, running: false, live: null, results, done: results.length } : previous,
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const postToSim = (message: Record<string, unknown>) => {
    const frame = frameRef.current?.contentWindow;
    if (!frame) return;
    frame.postMessage({ target: 'match-sim', ...message }, window.location.origin);
  };

  const startRun = () => {
    const total = Math.max(1, Math.min(50, Math.round(rounds) || 1));
    setRounds(total);
    setRun({ total, done: 0, running: true, live: null, results: [] });
    postToSim({ type: 'sim-series', count: total, speed });
  };

  const stopRun = () => postToSim({ type: 'sim-series-stop' });

  const changeSpeed = (value: number) => {
    setSpeed(value);
    postToSim({ type: 'sim-speed', speed: value });
  };

  const restart = () => {
    setRun(null);
    setEngineReady(false);
    setGeneration((value) => value + 1);
  };

  const seriesSummary = useMemo(() => {
    const results = run?.results ?? [];
    if (!results.length) return null;
    const homeWins = results.filter((result) => result.homeScore > result.awayScore).length;
    const draws = results.filter((result) => result.homeScore === result.awayScore).length;
    const awayWins = results.length - homeWins - draws;
    const goals = results.reduce((total, result) => total + result.homeScore + result.awayScore, 0);
    return { homeWins, draws, awayWins, averageGoals: goals / results.length };
  }, [run]);

  const running = run?.running ?? false;

  const goFullscreen = () => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.requestFullscreen?.().catch(() => undefined);
  };

  const teams = profile?.teams ?? null;
  const lineupSample = teams ? Math.max(teams[0].lineupSample, teams[1].lineupSample) : 0;

  return (
    <section
      ref={shellRef}
      className={`overflow-hidden border border-[#253746] bg-[#111c28] shadow-[0_18px_50px_rgba(23,35,45,.18)] ${theatre ? 'rounded-none border-x-0' : 'mt-5 rounded-[16px]'}`}
      aria-label="Live match simulation"
      data-testid="panel-match-simulation"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2c4152] bg-[#1b2b38] px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-[#22384a] text-[#8fb7a4]"><MonitorPlay size={14} /></span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[10px] font-extrabold tracking-[-.01em] text-[#eaf2ee]">
              <span className="size-1.5 rounded-full bg-[#7bc4a2]" /> Live simulation
            </p>
            <p
              className={`mono truncate text-[8px] uppercase tracking-[.13em] text-[#89a3a0] ${theatre ? 'hidden sm:block' : ''}`}
              data-testid="sim-formation-banner"
            >
              {teams
                ? `${teams[0].formation} · ${teams[0].record.form.slice(-5)} v ${teams[1].formation} · ${teams[1].record.form.slice(-5)}`
                : `${home} v ${away}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={restart}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#334b5d] bg-[#22384a] px-2.5 text-[9px] font-extrabold text-[#c9dcd4] transition hover:bg-[#2a4457]"
            data-testid="button-sim-restart"
          >
            <RotateCcw size={11} /> Restart
          </button>
          <button
            type="button"
            onClick={goFullscreen}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#334b5d] bg-[#22384a] px-2.5 text-[9px] font-extrabold text-[#c9dcd4] transition hover:bg-[#2a4457]"
            data-testid="button-sim-fullscreen"
          >
            <Maximize2 size={11} /> Full screen
          </button>
        </div>
      </div>

      <div className="border-b border-[#2c4152] bg-[#182836] px-3 py-2.5 sm:px-5" data-testid="sim-run-bar">
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="mono text-[7px] uppercase tracking-[.14em] text-[#7f978f]">Matches</span>
            <input
              type="number"
              min={1}
              max={50}
              step={1}
              inputMode="numeric"
              value={rounds}
              disabled={running}
              onChange={(event) => setRounds(Number(event.target.value))}
              onBlur={() => setRounds((value) => Math.max(1, Math.min(50, Math.round(value) || 1)))}
              className="mono h-7 w-[58px] rounded-md border border-[#334b5d] bg-[#0f1c27] px-2 text-[11px] font-bold text-[#eaf2ee] outline-none focus:border-[#5d8a7b] disabled:opacity-50"
              aria-label="Number of matches to simulate"
              data-testid="input-sim-rounds"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="mono text-[7px] uppercase tracking-[.14em] text-[#7f978f]">Speed</span>
            <select
              value={speed}
              onChange={(event) => changeSpeed(Number(event.target.value))}
              className="mono h-7 rounded-md border border-[#334b5d] bg-[#0f1c27] px-1.5 text-[11px] font-bold text-[#eaf2ee] outline-none focus:border-[#5d8a7b]"
              aria-label="Simulation playback speed"
              data-testid="select-sim-speed"
            >
              {SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
          {running ? (
            <button
              type="button"
              onClick={stopRun}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#7a4a3a] bg-[#3a2320] px-3 text-[9px] font-extrabold text-[#f0d3cb] transition hover:bg-[#4a2b26]"
              data-testid="button-sim-stop"
            >
              <Square size={10} /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={startRun}
              disabled={!engineReady}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#3d6156] bg-[#25463c] px-3 text-[9px] font-extrabold text-[#d8f0e3] transition hover:bg-[#2d564a] disabled:cursor-not-allowed disabled:opacity-45"
              data-testid="button-sim-run"
            >
              <Play size={10} /> Run {Math.max(1, Math.min(50, Math.round(rounds) || 1))}
            </button>
          )}
          <span className="mono ml-auto pb-1 text-[8px] uppercase tracking-[.11em] text-[#8ba39c]" data-testid="sim-run-status">
            {running && run
              ? `Round ${Math.min(run.done + 1, run.total)} of ${run.total}${run.live ? ` · ${run.live.home}–${run.live.away}` : ''}`
              : run && run.results.length
                ? `${run.results.length} of ${run.total} played`
                : engineReady
                  ? `≈ ${durationText(Math.max(1, Math.min(50, Math.round(rounds) || 1)), speed)} at ${speed}×`
                  : 'Warming up…'}
          </span>
        </div>
        {run ? (
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-[#22384a]">
            <div
              className="h-full rounded-full bg-[#7bc4a2] transition-[width] duration-300"
              style={{ width: `${Math.round((run.done / Math.max(1, run.total)) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>

      <div
        className={
          theatre
            ? 'relative h-[62dvh] min-h-[320px] w-full bg-black sm:h-auto sm:aspect-video sm:max-h-[78vh] sm:min-h-0'
            : 'relative aspect-video max-h-[70vh] w-full bg-black'
        }
      >
        {profileState === 'loading' ? (
          <div
            className="absolute inset-0 grid place-items-center bg-[#0d1722] px-6 text-center"
            data-testid="sim-profile-loading"
          >
            <div>
              <p className="mono text-[9px] uppercase tracking-[.16em] text-[#7fa79a]">Reading form and lineups…</p>
              <p className="mt-2 text-[10px] leading-4 text-[#6b837c]">
                Last {profile ? profile.formGames : 15} results, player ratings and the team sheets behind each side.
              </p>
            </div>
          </div>
        ) : (
          <iframe
            key={generation}
            ref={frameRef}
            src={source}
            title={`${home} v ${away} — live match simulation`}
            className="absolute inset-0 size-full border-0"
            allow="autoplay; fullscreen"
            onLoad={() => setEngineReady(true)}
            data-testid="iframe-match-simulation"
          />
        )}
        {running && speed > WATCHABLE_SPEED ? (
          <div
            className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0b1520]/88 px-6 text-center"
            data-testid="sim-batch-overlay"
          >
            <div>
              <p className="mono text-[9px] uppercase tracking-[.16em] text-[#7fa79a]">Simulating at {speed}×</p>
              <p className="mt-2 text-[26px] font-extrabold leading-none tracking-[-.02em] text-[#eaf2ee]">
                {Math.min((run?.done ?? 0) + 1, run?.total ?? 1)}
                <span className="text-[#5b7a71]"> / {run?.total ?? 1}</span>
              </p>
              <p className="mono mt-2 text-[8px] uppercase leading-3 tracking-[.1em] text-[#6b837c]">
                {run?.results.length ?? 0} played · the pitch pauses above {WATCHABLE_SPEED}× so the rounds finish sooner
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {run && run.results.length ? (
        <div className="border-t border-[#2c4152] bg-[#16242f] px-3 py-2.5 sm:px-5" data-testid="panel-sim-results">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <p className="mono text-[7.5px] uppercase tracking-[.14em] text-[#7f978f]">
              Results · {run.results.length} of {run.total} matches
            </p>
            <p className="mono text-[7.5px] uppercase tracking-[.12em] text-[#8fb7a4]" data-testid="sim-results-state">
              {running ? `Round ${Math.min(run.done + 1, run.total)} of ${run.total}` : 'Complete'}
            </p>
          </div>
          <ol className="grid gap-[3px]" data-testid="sim-results-list">
            {run.results.map((result) => {
              const homeWin = result.homeScore > result.awayScore;
              const awayWin = result.awayScore > result.homeScore;
              return (
                <li
                  key={result.round}
                  className="grid grid-cols-[22px_minmax(0,1fr)_46px_minmax(0,1fr)] items-center gap-1.5 rounded border border-[#243746] bg-[#182836] px-2 py-[3px]"
                  data-testid={`sim-result-${result.round}`}
                >
                  <span className="mono text-[7.5px] text-[#6f847f]">R{result.round}</span>
                  <span
                    className={`truncate text-right text-[9px] font-bold ${homeWin ? 'text-[#dbe6e0]' : 'text-[#7f918c]'}`}
                  >
                    {result.home}
                  </span>
                  <span className="mono whitespace-nowrap text-center text-[10px] font-extrabold tracking-[.02em] text-[#eaf2ee]">
                    {result.homeScore}–{result.awayScore}
                  </span>
                  <span className={`truncate text-[9px] font-bold ${awayWin ? 'text-[#dbe6e0]' : 'text-[#7f918c]'}`}>
                    {result.away}
                  </span>
                </li>
              );
            })}
          </ol>
          {seriesSummary ? (
            <p className="mono mt-2 text-[7.5px] leading-3 uppercase tracking-[.1em] text-[#7f978f]" data-testid="sim-results-summary">
              {teams?.[0]?.name ?? home} {seriesSummary.homeWins} wins · {seriesSummary.draws} drawn ·{' '}
              {teams?.[1]?.name ?? away} {seriesSummary.awayWins} wins · {seriesSummary.averageGoals.toFixed(2)} goals a match
            </p>
          ) : null}
        </div>
      ) : null}

      {teams ? (
        <div className="border-t border-[#2c4152] bg-[#16242f] px-3 py-2.5 sm:px-5" data-testid="panel-sim-form">
          <p className="mono mb-2 text-[7.5px] uppercase tracking-[.14em] text-[#7f978f]">
            Form &amp; lineups · {teams[0].record.games} results and {lineupSample} team sheets per club
          </p>
          <div className={`grid gap-2 ${theatre ? '' : 'sm:grid-cols-2'}`}>
            <TeamFormCard team={teams[0]} />
            <TeamFormCard team={teams[1]} />
          </div>
          {profile?.expectations ? (
            <p
              className="mono mt-2 text-[7px] leading-3 text-[#6b837c]"
              data-testid="sim-market-targets"
            >
              {profile.expectations.source === 'odds' ? 'Market targets' : 'Form targets'} ·{' '}
              {profile.expectations.totalGoals.toFixed(1)} goals ({profile.expectations.homeGoals.toFixed(1)}–
              {profile.expectations.awayGoals.toFixed(1)})
              {profile.expectations.over25 !== null ? ` · over 2.5 ${Math.round(profile.expectations.over25 * 100)}%` : ''}
              {profile.expectations.bothTeamsScore !== null
                ? ` · both score ${Math.round(profile.expectations.bothTeamsScore * 100)}%`
                : ''}
              {` · corners ${profile.expectations.homeCorners.toFixed(1)}–${profile.expectations.awayCorners.toFixed(1)}`}
              {` · clean sheets ${Math.round((profile.expectations.homeCleanSheet ?? 0) * 100)}%/${Math.round((profile.expectations.awayCleanSheet ?? 0) * 100)}%`}
            </p>
          ) : null}
          <p className="mono mt-2 text-[7px] leading-3 text-[#6b837c]">
            Ratings, shot and duel output and each club's own match style shape the players; the result still has to be played out.
          </p>
        </div>
      ) : null}

      <p className={`border-t border-[#2c4152] bg-[#16242f] px-4 py-2 text-[9px] leading-4 text-[#8ba39c] sm:px-5 ${theatre ? 'hidden sm:block' : ''}`}>
        {profileState === 'unavailable'
          ? 'Form data was unavailable, so this match uses the simulation’s default squads. KICK OFF starts it.'
          : 'KICK OFF starts the match. Cameras, playback speed and BE A PLAYER sit in the dock; move with WASD, pass with space, shoot with F, slide in with X.'}
      </p>
    </section>
  );
}
