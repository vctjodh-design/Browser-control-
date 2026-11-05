// The players' card: what each of them actually did in this match, where he
// spent it, where his shots came from, and what his last few matches have added
// to his abilities. It reads the same numbers 365Scores shows on a player's
// page — rating, xG, duels, passes — because they are the same Opta data.
import { useEffect, useMemo, useState } from 'react';
import {
  loadFixturePlayerForm,
  loadPlayerMatches,
  ratingTone,
  TOP_STATS,
  type FixturePlayerForm,
  type PlayerFormEntry,
  type PlayerMatchLogEntry,
  type PlayerFormWeights,
} from '../lib/player-form';

const PITCH_W = 105;
const PITCH_H = 68;

function Pitch({
  player,
  mode,
}: {
  player: PlayerFormEntry;
  mode: 'heat' | 'shots';
}) {
  const heat = useMemo(
    () =>
      player.heat.map((point, index) => ({
        ...point,
        key: `${index}-${point.x}-${point.y}`,
      })),
    [player.heat],
  );

  return (
    <svg
      viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
      className="w-full rounded-md border border-[#2c4152] bg-[#1d3b26]"
      role="img"
      aria-label={mode === 'heat' ? `${player.name} heat map` : `${player.name} shot map`}
      data-testid="player-form-pitch"
    >
      <g stroke="#cfe3d4" strokeWidth="0.35" fill="none" opacity="0.6">
        <rect x="0.5" y="0.5" width={PITCH_W - 1} height={PITCH_H - 1} />
        <line x1={PITCH_W / 2} y1="0.5" x2={PITCH_W / 2} y2={PITCH_H - 0.5} />
        <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r="9.15" />
        <rect x="0.5" y={PITCH_H / 2 - 20.15} width="16.5" height="40.3" />
        <rect x={PITCH_W - 17} y={PITCH_H / 2 - 20.15} width="16.5" height="40.3" />
        <rect x="0.5" y={PITCH_H / 2 - 9.16} width="5.5" height="18.32" />
        <rect x={PITCH_W - 6} y={PITCH_H / 2 - 9.16} width="5.5" height="18.32" />
      </g>

      {mode === 'heat'
        ? heat.map((point) => (
            <circle
              key={point.key}
              cx={point.x}
              cy={point.y}
              r={2.2 + point.intensity * 2.6}
              fill="#ffd166"
              opacity={0.06 + point.intensity * 0.24}
            />
          ))
        : player.shots.map((shot, index) => (
            <circle
              key={`${shot.minute}-${index}-${shot.x}`}
              cx={shot.x * 1.05}
              cy={shot.y * 0.68}
              r={1.4 + Math.min(6, (shot.expectedGoals ?? 0.05) * 22)}
              fill={shot.outcome.toLowerCase().includes('goal') ? '#7bc4a2' : shot.onTarget ? '#ffd166' : '#7f918c'}
              opacity={shot.outcome.toLowerCase().includes('goal') ? 0.95 : 0.6}
              stroke={shot.outcome.toLowerCase().includes('goal') ? '#eaf7ef' : 'none'}
              strokeWidth="0.3"
            />
          ))}
    </svg>
  );
}

function WeightList({ weights }: { weights: PlayerFormWeights }) {
  const rows = Object.entries(weights.skills).sort(
    (left, right) => Math.abs(right[1]) - Math.abs(left[1]),
  );
  if (!rows.length) {
    return (
      <p className="mono text-[7.5px] uppercase tracking-[.1em] text-[#6b837c]">
        No stored matches yet · his abilities are the ones his level gave him.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1" data-testid="player-form-weights">
      {rows.slice(0, 10).map(([skill, value]) => (
        <span
          key={skill}
          className={`mono rounded border px-1.5 py-[2px] text-[7px] uppercase tracking-[.08em] ${
            value > 0
              ? 'border-[#3d6156] bg-[#223c33] text-[#9fe0b7]'
              : 'border-[#6b4a3a] bg-[#3a2a24] text-[#e6b9a4]'
          }`}
        >
          {skill.replace(/_/g, ' ')} {value > 0 ? '+' : ''}
          {value.toFixed(2)}
        </span>
      ))}
      {weights.level !== 0 ? (
        <span className="mono rounded border border-[#334b5d] bg-[#22384a] px-1.5 py-[2px] text-[7px] uppercase tracking-[.08em] text-[#bcd2cb]">
          level {weights.level > 0 ? '+' : ''}
          {weights.level.toFixed(2)}
        </span>
      ) : null}
    </div>
  );
}

export function PlayerFormPanel({ fixtureId }: { fixtureId: number }) {
  const [form, setForm] = useState<FixturePlayerForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<'heat' | 'shots'>('heat');
  const [log, setLog] = useState<PlayerMatchLogEntry[] | null>(null);

  useEffect(() => {
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) return;
    const controller = new AbortController();
    setForm(null);
    setError(null);
    setSelected(null);
    loadFixturePlayerForm(fixtureId, controller.signal)
      .then((loaded) => {
        setForm(loaded);
        const first = loaded.teams[0]?.players.find((player) => player.starter) ?? loaded.teams[0]?.players[0];
        setSelected(first?.playerId ?? null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'Player performances are unavailable.');
      });
    return () => controller.abort();
  }, [fixtureId]);

  const player = useMemo(() => {
    if (!form || selected === null) return null;
    for (const team of form.teams) {
      const found = team.players.find((entry) => entry.playerId === selected);
      if (found) return { player: found, team: team.name };
    }
    return null;
  }, [form, selected]);

  useEffect(() => {
    if (!player) return;
    const controller = new AbortController();
    setLog(null);
    loadPlayerMatches(player.player.playerId, controller.signal)
      .then((loaded) => setLog(loaded.matches))
      .catch(() => setLog([]));
    return () => controller.abort();
  }, [player?.player.playerId]);

  if (error) {
    return (
      <div className="border-t border-[#2c4152] bg-[#16242f] px-3 py-2.5 sm:px-5" data-testid="panel-player-form-error">
        <p className="mono text-[7.5px] uppercase tracking-[.13em] text-[#7f978f]">Player performances</p>
        <p className="mt-1 text-[9px] leading-4 text-[#a9bdb6]">{error}</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="border-t border-[#2c4152] bg-[#16242f] px-3 py-2.5 sm:px-5" data-testid="panel-player-form-loading">
        <p className="mono text-[7.5px] uppercase tracking-[.13em] text-[#7f978f]">
          Reading ratings, heat maps and shot maps…
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-[#2c4152] bg-[#16242f] px-3 py-2.5 sm:px-5" data-testid="panel-player-form">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p className="mono text-[7.5px] uppercase tracking-[.14em] text-[#7f978f]">
          Player performances · ratings, heat maps, shot maps
        </p>
        <p className="mono text-[7px] uppercase tracking-[.1em] text-[#6b837c]">
          {form.teams.flatMap((team) => team.players).length} players · history kept per match
        </p>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {form.teams.map((team) => (
          <div key={team.name} className="rounded border border-[#243746] bg-[#182836] p-2">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <p className="text-[9px] font-extrabold text-[#eaf2ee]">{team.name}</p>
              {team.formation ? (
                <span className="mono rounded border border-[#334b5d] bg-[#22384a] px-1.5 py-[1px] text-[7px] uppercase tracking-[.08em] text-[#bcd2cb]">
                  {team.formation}
                </span>
              ) : null}
            </div>
            {team.unavailable.length ? (
              <p className="mono mb-1.5 text-[7px] leading-3 uppercase tracking-[.06em] text-[#e6b9a4]" data-testid="player-form-out">
                Out ·{' '}
                {team.unavailable
                  .map((entry) => `${entry.name} (${entry.kind}${entry.expectedReturn ? `, ${entry.expectedReturn}` : ''})`)
                  .join(' · ')}
              </p>
            ) : (
              <p className="mono mb-1.5 text-[7px] uppercase tracking-[.06em] text-[#6b837c]">No injuries or suspensions listed.</p>
            )}
            <ul className="grid gap-[3px]">
              {[...team.players]
                .sort((left, right) => (right.rating ?? 0) - (left.rating ?? 0))
                .map((entry) => {
                  const active = entry.playerId === selected;
                  return (
                    <li key={entry.playerId}>
                      <button
                        type="button"
                        onClick={() => setSelected(entry.playerId)}
                        className={`flex w-full items-center gap-1.5 rounded border px-1.5 py-[3px] text-left transition ${
                          active
                            ? 'border-[#5d8a7b] bg-[#20392f]'
                            : 'border-transparent hover:border-[#334b5d] hover:bg-[#1e3140]'
                        }`}
                        data-testid={`player-form-${entry.playerId}`}
                      >
                        <span className="mono w-[15px] shrink-0 text-right text-[7px] text-[#7f918c]">
                          {entry.shirt ?? '–'}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[9px] font-bold text-[#dbe6e0]">
                          {entry.name}
                          {entry.starter ? '' : ' · sub'}
                        </span>
                        <span className="mono shrink-0 text-[7px] text-[#7f918c]">
                          {entry.minutes}'
                        </span>
                        <span
                          className={`mono w-[30px] shrink-0 rounded border px-1 text-center text-[8px] font-extrabold ${ratingTone(entry.rating)}`}
                        >
                          {entry.rating === null ? '–' : entry.rating.toFixed(1)}
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>

      {player ? (
        <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="player-form-detail">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <p className="text-[10px] font-extrabold text-[#eaf2ee]">{player.player.name}</p>
              <span className={`mono rounded border px-1.5 py-[1px] text-[8px] font-extrabold ${ratingTone(player.player.rating)}`}>
                {player.player.rating === null ? '–' : player.player.rating.toFixed(1)}
              </span>
              <span className="mono text-[7px] uppercase tracking-[.08em] text-[#7f978f]">{player.team}</span>
              <div className="ml-auto flex gap-1">
                <button
                  type="button"
                  onClick={() => setMode('heat')}
                  className={`mono rounded border px-1.5 py-[2px] text-[7px] uppercase tracking-[.08em] ${
                    mode === 'heat'
                      ? 'border-[#5d8a7b] bg-[#20392f] text-[#cdf0de]'
                      : 'border-[#334b5d] bg-[#22384a] text-[#9fb4ae]'
                  }`}
                >
                  Heat map
                </button>
                <button
                  type="button"
                  onClick={() => setMode('shots')}
                  className={`mono rounded border px-1.5 py-[2px] text-[7px] uppercase tracking-[.08em] ${
                    mode === 'shots'
                      ? 'border-[#5d8a7b] bg-[#20392f] text-[#cdf0de]'
                      : 'border-[#334b5d] bg-[#22384a] text-[#9fb4ae]'
                  }`}
                >
                  Shot map
                </button>
              </div>
            </div>
            <Pitch player={player.player} mode={mode} />
            <p className="mono mt-1 text-[7px] leading-3 text-[#6b837c]">
              {mode === 'heat'
                ? `${player.player.heat.length} positions from the feed's heat map`
                : `${player.player.shots.length} shots · ${player.player.shots.filter((shot) => shot.outcome.toLowerCase().includes('goal')).length} goal(s) · circle size is xG`}
            </p>
          </div>

          <div>
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-5">
              {TOP_STATS.map((stat) => {
                const value = player.player.stats[stat.key];
                if (value === null || value === undefined) return null;
                return (
                  <div key={stat.key} className="rounded border border-[#243746] bg-[#182836] px-1.5 py-1">
                    <p className="mono text-[7px] uppercase tracking-[.06em] text-[#7f978f]">{stat.label}</p>
                    <p className="mono text-[10px] font-extrabold text-[#eaf2ee]">
                      {Number.isInteger(value) ? value : value.toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </div>

            <p className="mono mt-2 text-[7px] uppercase tracking-[.1em] text-[#7f978f]">
              Where his matches moved his abilities · {player.player.weights.games} match
              {player.player.weights.games === 1 ? '' : 'es'} read
              {player.player.weights.rating !== null ? ` · ${player.player.weights.rating.toFixed(2)} average` : ''}
            </p>
            <div className="mt-1">
              <WeightList weights={player.player.weights} />
            </div>

            <p className="mono mt-2 text-[7px] uppercase tracking-[.1em] text-[#7f978f]">
              Every match the feed has for him
            </p>
            <ul className="mt-1 grid gap-[2px]" data-testid="player-form-log">
              {(log ?? []).slice(0, 8).map((entry) => (
                <li
                  key={`${entry.matchId}-${entry.date}`}
                  className="flex items-center gap-1.5 rounded border border-[#243746] bg-[#182836] px-1.5 py-[2px]"
                >
                  <span className="mono w-[46px] shrink-0 text-[7px] text-[#7f918c]">
                    {entry.date ? new Date(entry.date).toISOString().slice(5, 10) : '–'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[8px] text-[#c9dcd4]">
                    {entry.home ? 'v' : '@'} {entry.opponent}
                  </span>
                  <span className="mono shrink-0 text-[7px] text-[#7f918c]">{entry.minutes}'</span>
                  <span className={`mono w-[26px] shrink-0 rounded border text-center text-[7px] font-extrabold ${ratingTone(entry.rating)}`}>
                    {entry.rating === null ? '–' : entry.rating.toFixed(1)}
                  </span>
                </li>
              ))}
              {log && !log.length ? (
                <li className="mono text-[7px] uppercase tracking-[.08em] text-[#6b837c]">No match log for him yet.</li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
