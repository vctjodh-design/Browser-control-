import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Maximize2, MonitorPlay, RotateCcw } from 'lucide-react';
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
    <li className="grid grid-cols-[18px_26px_minmax(0,1fr)_auto_auto] items-center gap-1.5 border-b border-[#243746] py-[3px] last:border-0">
      <span className="mono text-[8px] text-[#6f847f]">{index + 1}</span>
      <span className="mono text-[8px] text-[#8ba39c]">{player.number ?? '–'}</span>
      <span className="truncate text-[9px] font-bold text-[#dbe6e0]">{player.name}</span>
      <span className="mono text-[7px] uppercase tracking-[.08em] text-[#7d938d]">{player.role}</span>
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
          </span>
          <span className="mono mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[7.5px] uppercase tracking-[.09em] text-[#7f978f]">
            <FormChips team={team} />
            <span>{games} games</span>
            <span>{team.record.pointsPerGame.toFixed(2)} ppg</span>
            <span>
              {team.record.goalsFor}-{team.record.goalsAgainst} goals
            </span>
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

  const restart = () => setGeneration((value) => value + 1);

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
            <p className={`mono truncate text-[8px] uppercase tracking-[.13em] text-[#89a3a0] ${theatre ? 'hidden sm:block' : ''}`}>
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
            src={source}
            title={`${home} v ${away} — live match simulation`}
            className="absolute inset-0 size-full border-0"
            allow="autoplay; fullscreen"
            data-testid="iframe-match-simulation"
          />
        )}
      </div>

      {teams ? (
        <div className="border-t border-[#2c4152] bg-[#16242f] px-3 py-2.5 sm:px-5" data-testid="panel-sim-form">
          <p className="mono mb-2 text-[7.5px] uppercase tracking-[.14em] text-[#7f978f]">
            Form &amp; lineups · {teams[0].record.games} results and {lineupSample} team sheets per club
          </p>
          <div className={`grid gap-2 ${theatre ? '' : 'sm:grid-cols-2'}`}>
            <TeamFormCard team={teams[0]} />
            <TeamFormCard team={teams[1]} />
          </div>
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
