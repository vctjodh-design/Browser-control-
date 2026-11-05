import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Dices, LoaderCircle, Play } from 'lucide-react';
import { loadDuels, type DuelPairing, type DuelSimulation, type DuelSide } from '@/lib/squad-duel';

// The fixture played as man-versus-man contests.
//
// Everything on this panel is the consequence of the board at the top of it:
// the winger who wins six carries in ten is why his side's goals land where
// they do, and the keeper who stops two thirds of the shots he faces is why the
// scoreline most often comes out 1-1 rather than 3-2. Nothing here is drawn
// around an average.

const HOME = '#c97555';
const AWAY = '#557b68';
const HOME_TEXT = '#e2a184';
const AWAY_TEXT = '#8fbfa9';

const TRIAL_CHOICES = [1000, 5000, 20000];

function pct(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

function sideColour(side: DuelSide) {
  return side === 'home' ? HOME : AWAY;
}

function sideText(side: DuelSide) {
  return side === 'home' ? HOME_TEXT : AWAY_TEXT;
}

function Bar({ value, side }: { value: number; side: DuelSide }) {
  return (
    <span className="relative block h-[6px] w-full overflow-hidden rounded-full bg-[#243746]">
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: sideColour(side) }}
      />
    </span>
  );
}

function DuelRow({ row }: { row: DuelPairing }) {
  const attackerSide = row.side;
  return (
    <li
      className="grid grid-cols-[46px_minmax(0,1fr)_38px] items-center gap-2 border-b border-[#1f3040] py-[5px] last:border-0"
      data-testid={`duel-row-${row.side}-${row.lane}`}
    >
      <span className="mono truncate text-[7px] uppercase tracking-[.08em] text-[#6f847f]">{row.label}</span>
      <div className="min-w-0">
        <p className="flex items-baseline gap-1 truncate text-[9px] font-bold" style={{ color: sideText(attackerSide) }}>
          <span className="truncate">{row.attacker.name}</span>
          <span className="mono shrink-0 text-[7.5px] font-normal text-[#7d938d]">{row.attacker.rating}</span>
          <span className="mono shrink-0 text-[7.5px] font-normal text-[#5f7570]">
            vs {row.defender.name} {row.defender.rating}
          </span>
        </p>
        <span className="mt-[3px] block">
          <Bar value={row.winPct} side={attackerSide} />
        </span>
      </div>
      <span className="mono text-right text-[10px] font-extrabold" style={{ color: sideText(attackerSide) }}>
        {row.winPct.toFixed(0)}%
      </span>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-[#243746] bg-[#182836] px-2 py-1.5 text-center">
      <p className="mono text-[7px] uppercase leading-3 tracking-[.1em] text-[#7f978f]">{label}</p>
      <p className="mono text-[13px] font-extrabold leading-tight" style={{ color: tone ?? '#dbe6e0' }}>
        {value}
      </p>
    </div>
  );
}

export function SquadDuelPanel({ fixtureId, homeName, awayName }: { fixtureId: number; homeName: string; awayName: string }) {
  const [trials, setTrials] = useState(5000);
  const [seed, setSeed] = useState(1);
  const [data, setData] = useState<DuelSimulation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const play = (nextSeed: number, nextTrials: number) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError(null);
    loadDuels(fixtureId, { trials: nextTrials, seed: nextSeed, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'The duels could not be played.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  };

  useEffect(() => {
    play(1, 5000);
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId]);

  const home = homeName || data?.teams[0] || 'Home';
  const away = awayName || data?.teams[1] || 'Away';
  const outcome = data?.outcome;

  return (
    <section className="overflow-hidden rounded-xl border border-[#2c4152] bg-[#101d27]" data-testid="panel-squad-duels">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2c4152] bg-[#16242f] px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="mono text-[9px] font-extrabold uppercase tracking-[.16em] text-[#dbe6e0]">Player duels</h2>
          <p className="mt-0.5 max-w-[70ch] text-[8.5px] leading-4 text-[#7f978f]">
            Every possession is a contest between two named players — the winger against that full-back, the
            midfielder against that midfield, the shot against that keeper. The scoreline is whatever those
            contests produce.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {TRIAL_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => {
                setTrials(choice);
                play(seed, choice);
              }}
              className={`mono rounded border px-2 py-1 text-[8px] uppercase tracking-[.08em] transition ${
                trials === choice
                  ? 'border-[#3f7a63] bg-[#234838] text-[#c6e6d5]'
                  : 'border-[#2c4152] bg-[#182836] text-[#8ba39c] hover:text-[#cfe0d8]'
              }`}
              data-testid={`duel-trials-${choice}`}
            >
              {(choice / 1000).toFixed(0)}k
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const next = Math.floor(Math.random() * 100000) + 1;
              setSeed(next);
              play(next, trials);
            }}
            className="flex items-center gap-1 rounded border border-[#2c4152] bg-[#182836] px-2 py-1 text-[8px] font-bold uppercase tracking-[.08em] text-[#9fb8ae] transition hover:text-[#dbe6e0]"
            data-testid="duel-reseed"
            title="Play the fixture again with a different random stream"
          >
            <Dices size={11} /> Replay
          </button>
          <button
            type="button"
            onClick={() => play(seed, trials)}
            disabled={loading}
            className="flex items-center gap-1 rounded bg-[#2f6b4f] px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.08em] text-[#eef6f0] transition hover:bg-[#285c44] disabled:opacity-60"
            data-testid="duel-play"
          >
            {loading ? <LoaderCircle size={11} className="animate-spin" /> : <Play size={11} />} Play
          </button>
        </div>
      </header>

      {error ? (
        <div className="flex items-start gap-2 px-4 py-4 text-[10px] text-[#e2a184]" data-testid="duel-error">
          <CircleAlert size={13} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      {outcome ? (
        <div className="grid gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div className="space-y-2.5">
            <div className="grid grid-cols-3 gap-1.5" data-testid="duel-outcome">
              <Stat label={home.length > 12 ? home.slice(0, 12) : home} value={pct(outcome.home)} tone={HOME_TEXT} />
              <Stat label="draw" value={pct(outcome.draw)} />
              <Stat label={away.length > 12 ? away.slice(0, 12) : away} value={pct(outcome.away)} tone={AWAY_TEXT} />
            </div>
            <p className="mono text-[8px] uppercase leading-4 tracking-[.1em] text-[#9fb8ae]" data-testid="duel-most-likely">
              Most likely{' '}
              <span className="text-[#eaf2ee]">
                {outcome.mostLikely ? `${outcome.mostLikely.home}–${outcome.mostLikely.away}` : '—'}
              </span>{' '}
              at {outcome.mostLikely ? pct(outcome.mostLikely.pct) : '—'} · {outcome.homeGoals.toFixed(2)}–
              {outcome.awayGoals.toFixed(2)} goals · {data?.trials.toLocaleString()} matches in{' '}
              {((data?.elapsedMs ?? 0) / 1000).toFixed(1)}s
            </p>
            {data?.expectations ? (
              <p
                className="mono text-[7.5px] uppercase leading-4 tracking-[.09em] text-[#6f847f]"
                data-testid="duel-vs-market"
              >
                the market has {data.expectations.homeGoals.toFixed(2)}–{data.expectations.awayGoals.toFixed(2)}{' '}
                ({data.expectations.totalGoals.toFixed(2)} goals) — this is what the players produced, not a copy of it
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Stat label="both score" value={pct(outcome.btts)} />
              <Stat label="over 2.5" value={pct(outcome.over25)} />
              <Stat label={`${data?.short[0] ?? 'Home'} clean sheet`} value={pct(outcome.cleanSheetHome)} />
              <Stat label={`${data?.short[1] ?? 'Away'} clean sheet`} value={pct(outcome.cleanSheetAway)} />
            </div>

            <div>
              <p className="mono mb-1 text-[7.5px] uppercase tracking-[.14em] text-[#7f978f]">Scorelines</p>
              <ol className="grid max-h-[188px] gap-[3px] overflow-y-auto pr-0.5" data-testid="duel-scorelines">
                {data?.scorelines.slice(0, 14).map((line) => (
                  <li
                    key={`${line.home}-${line.away}`}
                    className="relative grid grid-cols-[44px_38px_minmax(0,1fr)] items-center gap-2 overflow-hidden rounded border border-[#243746] bg-[#182836] px-2 py-[3px]"
                  >
                    <span className="absolute inset-y-0 left-0 bg-[#25463c]/45" style={{ width: `${Math.min(100, line.pct * 4)}%` }} />
                    <span className="mono relative text-[10px] font-extrabold text-[#eaf2ee]">
                      {line.home}–{line.away}
                    </span>
                    <span className="mono relative text-[8px] text-[#9fb8ae]">{line.count.toLocaleString()}×</span>
                    <span className="mono relative text-right text-[8px] text-[#8ba39c]">{pct(line.pct)}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex flex-wrap gap-1" data-testid="duel-twists">
              {data?.twists.map((twist) => (
                <span
                  key={`${twist.label}-${twist.detail}`}
                  className="mono rounded border border-[#2c4152] bg-[#182836] px-1.5 py-0.5 text-[7px] uppercase tracking-[.07em] text-[#9fb8ae]"
                >
                  {twist.label} <span className="text-[#dbe6e0]">{twist.detail}</span>{' '}
                  {twist.pct < 0.1 ? '<0.1%' : `${twist.pct.toFixed(1)}%`}
                </span>
              ))}
            </div>
            <p className="text-[8.5px] leading-4 text-[#6f847f]">{data?.note}</p>
          </div>

          <div className="space-y-2.5">
            <div>
              <p className="mono mb-1 text-[7.5px] uppercase tracking-[.14em] text-[#7f978f]">
                The board · who meets whom ({data?.formation[0]} v {data?.formation[1]})
              </p>
              <ol className="rounded-lg border border-[#243746] bg-[#152531] px-2" data-testid="duel-board">
                {data?.board.lanes.map((row) => (
                  <DuelRow key={`${row.side}-${row.lane}`} row={row} />
                ))}
              </ol>
            </div>
            <div>
              <p className="mono mb-1 text-[7.5px] uppercase tracking-[.14em] text-[#7f978f]">Through the middle</p>
              <ol className="rounded-lg border border-[#243746] bg-[#152531] px-2" data-testid="duel-midfield">
                {data?.board.midfield.map((row) => (
                  <DuelRow key={`mid-${row.side}`} row={row} />
                ))}
              </ol>
            </div>
            <div>
              <p className="mono mb-1 text-[7.5px] uppercase tracking-[.14em] text-[#7f978f]">In goal</p>
              <ul className="rounded-lg border border-[#243746] bg-[#152531] px-2" data-testid="duel-keepers">
                {data?.board.keepers.map((keeper) => (
                  <li key={keeper.side} className="flex items-center justify-between gap-2 border-b border-[#1f3040] py-[5px] last:border-0">
                    <span className="truncate text-[9px] font-bold" style={{ color: sideText(keeper.side) }}>
                      {keeper.name}
                    </span>
                    <span className="mono shrink-0 text-[8px] text-[#7d938d]">
                      {keeper.rating} · faces {keeper.faces}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mono mb-1 text-[7.5px] uppercase tracking-[.14em] text-[#7f978f]">
                One match, contest by contest
              </p>
              <ol className="max-h-[150px] overflow-y-auto rounded-lg border border-[#243746] bg-[#152531] px-2 py-1" data-testid="duel-sample">
                {data?.sample.map((event, index) => (
                  <li
                    key={`${event.minute}-${index}`}
                    className={`mono flex gap-2 py-[2px] text-[8px] ${event.goal ? 'font-extrabold text-[#eaf2ee]' : 'text-[#8ba39c]'}`}
                  >
                    <span className="w-[22px] shrink-0 text-right text-[#6f847f]">{event.minute}′</span>
                    <span className="shrink-0" style={{ color: sideText(event.side) }}>
                      {event.side === 'home' ? (data?.short[0] ?? 'H') : (data?.short[1] ?? 'A')}
                    </span>
                    <span className="min-w-0 truncate">{event.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : loading ? (
        <p className="mono flex items-center gap-2 px-4 py-5 text-[9px] uppercase tracking-[.1em] text-[#7f978f]">
          <LoaderCircle size={12} className="animate-spin" /> Playing the duels…
        </p>
      ) : null}

      {data?.players.length ? (
        <div className="border-t border-[#2c4152] px-3 py-2.5 sm:px-4">
          <p className="mono mb-1 text-[7.5px] uppercase tracking-[.14em] text-[#7f978f]">Who is winning his contests</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[300px] border-collapse" data-testid="duel-players">
              <thead>
                <tr className="mono text-[7px] uppercase tracking-[.09em] text-[#6f847f]">
                  <th className="py-1 text-left font-normal">Player</th>
                  <th className="py-1 text-right font-normal">contests</th>
                  <th className="py-1 text-right font-normal">won</th>
                  <th className="py-1 text-right font-normal">win%</th>
                  <th className="py-1 text-right font-normal">shots</th>
                  <th className="py-1 text-right font-normal">goals</th>
                  <th className="py-1 text-right font-normal">saves</th>
                </tr>
              </thead>
              <tbody>
                {data.players.slice(0, 10).map((player) => (
                  <tr key={`${player.side}-${player.name}`} className="border-t border-[#1f3040]">
                    <td className="max-w-[150px] truncate py-[3px] text-[9px] font-bold" style={{ color: sideText(player.side) }}>
                      {player.name}
                      <span className="mono ml-1 text-[7px] font-normal text-[#6f847f]">{player.role}</span>
                    </td>
                    <td className="mono py-[3px] text-right text-[8px] text-[#8ba39c]">{player.duels.toFixed(1)}</td>
                    <td className="mono py-[3px] text-right text-[8px] text-[#9fb8ae]">{player.won.toFixed(1)}</td>
                    <td className="mono py-[3px] text-right text-[9px] font-extrabold text-[#dbe6e0]">
                      {player.winPct.toFixed(0)}%
                    </td>
                    <td className="mono py-[3px] text-right text-[8px] text-[#9fb8ae]">{player.shots.toFixed(2)}</td>
                    <td className="mono py-[3px] text-right text-[8px] text-[#c6e6d5]">{player.goals.toFixed(2)}</td>
                    <td className="mono py-[3px] text-right text-[8px] text-[#9fb8ae]">
                      {player.saves ? player.saves.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
