import { useEffect, useMemo, useState } from 'react';
import type {
  FootballMatchReplayFormationPlayer,
  FootballMatchReplayShotEvent,
} from '@workspace/api-client-react';
import { Pause, Play, RotateCcw } from 'lucide-react';

function minuteValue(value: string) {
  const match = value.match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) + (match[2] ? Number(match[2]) / 100 : 0);
}

function isLocatedShot(shot: FootballMatchReplayShotEvent) {
  return (
    typeof shot.x === 'number' &&
    Number.isFinite(shot.x) &&
    typeof shot.y === 'number' &&
    Number.isFinite(shot.y)
  );
}

function Pitch({
  homeTeam,
  awayTeam,
  players,
  shots,
  activeIndex,
}: {
  homeTeam: string;
  awayTeam: string;
  players: FootballMatchReplayFormationPlayer[];
  shots: FootballMatchReplayShotEvent[];
  activeIndex: number;
}) {
  const activeShot = shots[activeIndex];

  return (
    <svg
      viewBox="0 0 100 64"
      className="block w-full rounded-xl border border-[#a8bca5] bg-[#dce9d8]"
      role="img"
      aria-label={`Recorded shot locations and source lineup positions for ${homeTeam} and ${awayTeam}`}
      data-testid="pitch-recorded-events"
    >
      <defs>
        <pattern id="replay-pitch-stripes" width="20" height="64" patternUnits="userSpaceOnUse">
          <rect width="10" height="64" fill="#e3eddf" />
        </pattern>
      </defs>
      <rect width="100" height="64" fill="#dce9d8" />
      <rect width="100" height="64" fill="url(#replay-pitch-stripes)" opacity=".42" />
      <rect x="1.2" y="1.2" width="97.6" height="61.6" fill="none" stroke="#8da88e" strokeWidth=".55" />
      <line x1="50" y1="1.2" x2="50" y2="62.8" stroke="#8da88e" strokeWidth=".5" />
      <circle cx="50" cy="32" r="8" fill="none" stroke="#8da88e" strokeWidth=".5" />
      <circle cx="50" cy="32" r=".6" fill="#8da88e" />
      <rect x="1.2" y="19" width="13" height="26" fill="none" stroke="#8da88e" strokeWidth=".5" />
      <rect x="85.8" y="19" width="13" height="26" fill="none" stroke="#8da88e" strokeWidth=".5" />
      <rect x="1.2" y="25" width="4.5" height="14" fill="none" stroke="#8da88e" strokeWidth=".5" />
      <rect x="94.3" y="25" width="4.5" height="14" fill="none" stroke="#8da88e" strokeWidth=".5" />
      <path d="M 14.2 25 A 8 8 0 0 1 14.2 39" fill="none" stroke="#8da88e" strokeWidth=".45" />
      <path d="M 85.8 25 A 8 8 0 0 0 85.8 39" fill="none" stroke="#8da88e" strokeWidth=".45" />

      {players.map((player, index) => {
        const fill = player.teamSide === 'home' ? '#f7ecd4' : '#315746';
        const stroke = player.teamSide === 'home' ? '#9a644e' : '#f7ecd4';
        const label = player.shirtNumber === null ? '' : String(player.shirtNumber);
        return (
          <g key={`${player.teamSide}-${player.playerName}-${index}`}>
            <title>
              {`${player.playerName}${label ? ` · shirt ${label}` : ''}${player.position ? ` · ${player.position}` : ''} · source starting position`}
            </title>
            <circle cx={player.x} cy={player.y} r="1.6" fill={fill} stroke={stroke} strokeWidth=".45" />
            {label && (
              <text
                x={player.x}
                y={player.y + 0.55}
                textAnchor="middle"
                fontSize="1.65"
                fontWeight="700"
                fill={player.teamSide === 'home' ? '#594238' : '#fff9e9'}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      {shots.map((shot, index) => {
        if (!isLocatedShot(shot)) return null;
        const isActive = index === activeIndex;
        const color = shot.teamSide === 'home' ? '#d96f51' : '#d8a744';
        const x = shot.x as number;
        const y = shot.y as number;
        return (
          <g key={`${shot.sourceOrder}-${shot.minute}-${index}`}>
            <title>
              {`${shot.minute} · ${shot.teamSide === 'home' ? homeTeam : awayTeam}${shot.playerName ? ` · ${shot.playerName}` : ''}${shot.outcome ? ` · ${shot.outcome}` : ''} · source coordinates ${x.toFixed(1)}, ${y.toFixed(1)}`}
            </title>
            {isActive && (
              <circle
                cx={x}
                cy={y}
                r="3.2"
                fill="none"
                stroke={color}
                strokeWidth=".65"
                className="animate-ping motion-reduce:animate-none"
              />
            )}
            <circle
              cx={x}
              cy={y}
              r={isActive ? '2.15' : '1.35'}
              fill={color}
              stroke="#fffaf0"
              strokeWidth={isActive ? '.65' : '.35'}
              opacity={isActive ? '1' : '.8'}
            />
            {isActive && <circle cx={x} cy={y} r=".45" fill="#fffaf0" />}
          </g>
        );
      })}

      {!players.length && !shots.length && (
        <text x="50" y="33" textAnchor="middle" fontSize="3" fill="#637b68">
          No source positions available
        </text>
      )}
      {activeShot && isLocatedShot(activeShot) && (
        <circle cx={activeShot.x as number} cy={activeShot.y as number} r="3.2" fill="none" stroke="#fffaf0" strokeWidth=".4" />
      )}
    </svg>
  );
}

export function RecordedEventPitch({
  homeTeam,
  awayTeam,
  shotEvents,
  formationPlayers,
}: {
  homeTeam: string;
  awayTeam: string;
  shotEvents: FootballMatchReplayShotEvent[];
  formationPlayers: FootballMatchReplayFormationPlayer[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const locatedShots = useMemo(
    () =>
      shotEvents
        .filter(isLocatedShot)
        .sort((a, b) => minuteValue(a.minute) - minuteValue(b.minute) || a.sourceOrder - b.sourceOrder),
    [shotEvents],
  );
  const activeShot = locatedShots[activeIndex];
  const missingCoordinateCount = shotEvents.length - locatedShots.length;

  useEffect(() => {
    setActiveIndex(0);
    setIsPlaying(false);
  }, [shotEvents]);

  useEffect(() => {
    if (!isPlaying || locatedShots.length < 2) return;
    const timeout = window.setTimeout(() => {
      if (activeIndex >= locatedShots.length - 1) {
        setIsPlaying(false);
      } else {
        setActiveIndex(activeIndex + 1);
      }
    }, 1_100);
    return () => window.clearTimeout(timeout);
  }, [activeIndex, isPlaying, locatedShots.length]);

  const startPlayback = () => {
    if (activeIndex >= locatedShots.length - 1) setActiveIndex(0);
    setIsPlaying(true);
  };

  return (
    <section
      className="overflow-hidden rounded-[15px] border border-[#d9d9cf] bg-[#f9f8f2]"
      aria-labelledby="recorded-pitch-title"
      data-testid="section-recorded-event-pitch"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e3e2d9] bg-[#f3f2ea] px-4 py-3.5 sm:px-5">
        <div>
          <p className="mono text-[8px] uppercase tracking-[.17em] text-[#9b7160]">Source-recorded actions</p>
          <h3 id="recorded-pitch-title" className="mt-1 text-[13px] font-extrabold text-[#354a45]">Shot events on the pitch</h3>
        </div>
        <span className="rounded-full border border-[#d7dfd3] bg-[#e8ede5] px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.08em] text-[#56715e]">
          {locatedShots.length} located · {shotEvents.length} recorded
        </span>
      </div>

      <div className="grid gap-4 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,.72fr)]">
        <div className="min-w-0">
          <Pitch
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            players={formationPlayers}
            shots={locatedShots}
            activeIndex={activeIndex}
          />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[8px] text-[#68756c]">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full border border-[#9a644e] bg-[#f7ecd4]" /> {homeTeam} lineup</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full border border-[#f7ecd4] bg-[#315746]" /> {awayTeam} lineup</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#d96f51]" /> Home shots</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#d8a744]" /> Away shots</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-between">
          {activeShot ? (
            <div aria-live="polite" data-testid="text-active-recorded-shot">
              <p className="mono text-[8px] uppercase tracking-[.12em] text-[#9b7160]">
                Recorded shot {activeIndex + 1} of {locatedShots.length}
              </p>
              <p className="mt-1 text-[11px] font-extrabold text-[#354a45]">
                {activeShot.minute}&apos; · {activeShot.teamSide === 'home' ? homeTeam : awayTeam}
              </p>
              <p className="mt-1 text-[9px] leading-5 text-[#788078]">
                {[activeShot.playerName, activeShot.outcome, activeShot.bodyPart].filter(Boolean).join(' · ') || 'Player and outcome details unavailable'}
              </p>
              <p className="mono mt-2 text-[8px] text-[#7b8378]">
                Pitch position {activeShot.x?.toFixed(1)}%, {activeShot.y?.toFixed(1)}%
              </p>
              {(activeShot.xg || activeShot.xgot) && (
                <p className="mono mt-1 text-[8px] text-[#7b8378]">
                  {activeShot.xg ? `xG ${activeShot.xg}` : ''}
                  {activeShot.xg && activeShot.xgot ? ' · ' : ''}
                  {activeShot.xgot ? `xGOT ${activeShot.xgot}` : ''}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#d8d8cc] bg-[#f4f3eb] px-3 py-4" role="status" data-testid="status-no-located-shots">
              <p className="text-[10px] font-extrabold text-[#53645a]">No located shot events</p>
              <p className="mt-1 text-[9px] leading-5 text-[#83877d]">
                {shotEvents.length
                  ? 'The source recorded shots but did not provide usable pitch coordinates for them.'
                  : 'The source supplied no shot events with pitch coordinates.'}
              </p>
            </div>
          )}

          {locatedShots.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={isPlaying ? () => setIsPlaying(false) : startPlayback}
                  disabled={locatedShots.length < 2}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#314d40] px-3 text-[9px] font-extrabold text-[#f7f2e6] transition hover:bg-[#263f34] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={isPlaying ? 'Pause recorded shot animation' : 'Play recorded shot animation'}
                  data-testid="button-play-recorded-shots"
                >
                  {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setActiveIndex(0);
                  }}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-[#d9d9cf] bg-[#fbfaf5] text-[#566b5e] transition hover:bg-white"
                  aria-label="Restart recorded shot animation"
                  data-testid="button-restart-recorded-shots"
                >
                  <RotateCcw size={12} />
                </button>
                <span className="mono ml-auto text-[8px] text-[#858a80]">
                  {activeShot?.minute || '—'}&apos;
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, locatedShots.length - 1)}
                step={1}
                value={activeIndex}
                onChange={(event) => {
                  setIsPlaying(false);
                  setActiveIndex(Number(event.target.value));
                }}
                disabled={locatedShots.length < 2}
                aria-label="Choose recorded shot"
                className="h-2 w-full cursor-pointer accent-[#527b60] disabled:cursor-not-allowed"
                data-testid="slider-recorded-shot"
              />
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[#e3e2d9] px-4 py-3 text-[8px] leading-[1.7] text-[#7d847a] sm:px-5">
        {missingCoordinateCount > 0 && (
          <p className="mb-1 text-[#856f48]" data-testid="status-unlocated-shots">
            {missingCoordinateCount} recorded shot{missingCoordinateCount === 1 ? '' : 's'} without source coordinates are not placed on the pitch.
          </p>
        )}
        <p>
          The animation advances between recorded shot times and source coordinates. Lineup markers show listed starting positions only; continuous player tracking and runs were not supplied.
        </p>
        {!formationPlayers.length && (
          <p className="mt-1" data-testid="status-lineup-positions-unavailable">No source lineup coordinates were available; player positions are not estimated.</p>
        )}
      </div>
    </section>
  );
}
