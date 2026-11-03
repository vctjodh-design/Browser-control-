import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Gauge, Loader2, Play } from 'lucide-react';
import {
  onMatchSummary,
  runOddsSimulation,
  settleOddsBoard,
  type MarketSimulationRow,
  type OddsSettlement,
  type OddsSimulationResult,
  type SettledMarket,
} from '@/lib/odds-simulation';

const MIN_ROUNDS = 100;
const MAX_ROUNDS = 10_000;
const DEFAULTS = [1000, 5000, 10_000];

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}`;
const money = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;

function edgeTone(edge: number) {
  if (edge >= 0.03) return 'text-[#2f6b4f]';
  if (edge <= -0.03) return 'text-[#8a3b34]';
  return 'text-[#7d7f77]';
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-[#e2e0d7] bg-[#fbfaf6] px-3 py-2.5">
      <p className="mono text-[8px] uppercase tracking-[.14em] text-[#98998f]">{label}</p>
      <p className="mt-1 text-[15px] font-semibold leading-none text-[#33413f]">{value}</p>
      {detail ? <p className="mt-1 text-[9px] text-[#8b8d84]">{detail}</p> : null}
    </div>
  );
}

function MarketGroup({
  name,
  rows,
  open,
  onToggle,
}: {
  name: string;
  rows: MarketSimulationRow[];
  open: boolean;
  onToggle: () => void;
}) {
  const best = rows.reduce((top, row) => (row.edge > top.edge ? row : top), rows[0]);
  return (
    <div className="overflow-hidden rounded-xl border border-[#deddd4] bg-[#fbfaf6]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-2.5 text-left"
        data-testid={`sim-market-${name}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown
            size={12}
            className={`shrink-0 text-[#8b8d84] transition-transform ${open ? '' : '-rotate-90'}`}
          />
          <span className="truncate text-[11px] font-extrabold text-[#43575a]">{name}</span>
          <span className="mono shrink-0 rounded-full bg-[#e7ede7] px-2 py-0.5 text-[8px] uppercase tracking-[.1em] text-[#668071]">
            {rows.length}
          </span>
        </span>
        <span className="mono shrink-0 text-[9px] text-[#8b8d84]">
          best edge{' '}
          <span className={edgeTone(best.edge)}>{signedPct(best.edge)}</span>
        </span>
      </button>
      {open ? (
        <div className="divide-y divide-[#eeece4]">
          {rows
            .slice()
            .sort((left, right) => right.edge - left.edge)
            .map((row) => (
              <div
                key={`${row.market}-${row.selection}`}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <span className="min-w-0 truncate text-[10px] font-bold text-[#52615e]">
                  {row.selection}
                </span>
                <span className="mono text-[10px] text-[#43575a]">{row.bestPrice.toFixed(2)}</span>
                <span className="col-span-2 flex items-center gap-2 text-[9px] text-[#8b8d84]">
                  <span className="mono">sim {pct(row.probability)}</span>
                  <span className="text-[#c9c7bd]">·</span>
                  <span className="mono">market {pct(row.fair)}</span>
                  <span className="text-[#c9c7bd]">·</span>
                  <span className={`mono font-semibold ${edgeTone(row.edge)}`}>
                    {signedPct(row.edge)} pp
                  </span>
                  <span className="text-[#c9c7bd]">·</span>
                  <span className="truncate">
                    {row.bestBookmaker} · {row.books} {row.books === 1 ? 'book' : 'books'}
                  </span>
                </span>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function SettlementCard({ settlement }: { settlement: OddsSettlement }) {
  const topMarkets = useMemo<SettledMarket[]>(
    () =>
      settlement.markets
        .slice()
        .sort((left, right) => right.profit - left.profit)
        .slice(0, 6),
    [settlement],
  );
  const home = settlement.summary.home;
  const away = settlement.summary.away;

  return (
    <div className="mt-4 rounded-xl border border-[#d8ded3] bg-[#f5f7f0]" data-testid="odds-settlement">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e6da] px-4 py-3">
        <div>
          <p className="mono text-[8px] uppercase tracking-[.14em] text-[#7f8a76]">Played match</p>
          <h3 className="mt-1 text-[12px] font-extrabold text-[#3d5148]">
            Settled against what happened — {home.goals}–{away.goals}
          </h3>
        </div>
        <span
          className={`mono rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ${
            settlement.totals.profit >= 0
              ? 'bg-[#e3efe4] text-[#2f6b4f]'
              : 'bg-[#f6e5e2] text-[#8a3b34]'
          }`}
        >
          {money(settlement.totals.profit)} per 1u
        </span>
      </div>
      <div className="grid gap-2 px-4 py-3 sm:grid-cols-4">
        <StatTile label="Half time" value={`${settlement.summary.halfTime.home}–${settlement.summary.halfTime.away}`} />
        <StatTile label="Corners" value={`${home.corners}–${away.corners}`} />
        <StatTile label="Cards" value={`${home.cards}–${away.cards}`} />
        <StatTile
          label="Selections landed"
          value={`${settlement.totals.wins}/${settlement.totals.selections}`}
          detail={`${settlement.totals.pushes} push · ROI ${pct(settlement.totals.roi)}`}
        />
      </div>
      <div className="space-y-1.5 px-4 pb-4">
        {topMarkets.map((market) => (
          <div key={market.market} className="flex items-center justify-between gap-3 text-[9.5px]">
            <span className="min-w-0 truncate text-[#5d6b62]">{market.market}</span>
            <span className="mono shrink-0 text-[#8b8d84]">
              {market.wins}/{market.selections.length} landed ·{' '}
              <span className={market.profit >= 0 ? 'text-[#2f6b4f]' : 'text-[#8a3b34]'}>
                {money(market.profit)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OddsSimulationPanel({ fixtureId }: { fixtureId: number }) {
  const [rounds, setRounds] = useState(1000);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OddsSimulationResult | null>(null);
  const [settlement, setSettlement] = useState<OddsSettlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openMarkets, setOpenMarkets] = useState<Record<string, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    const count = Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, Math.round(rounds)));
    setRounds(count);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    try {
      const next = await runOddsSimulation(fixtureId, count, controller.signal);
      setResult(next);
      // Open the markets where the simulation and the price disagree most.
      const grouped = new Map<string, number>();
      for (const row of next.markets) {
        grouped.set(row.market, Math.max(grouped.get(row.market) ?? 0, Math.abs(row.edge)));
      }
      const top = [...grouped.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3);
      setOpenMarkets(Object.fromEntries(top.map(([name]) => [name, true])));
    } catch (cause) {
      if ((cause as Error)?.name !== 'AbortError') {
        setError(cause instanceof Error ? cause.message : 'The simulation could not run.');
      }
    } finally {
      if (abortRef.current === controller) {
        setRunning(false);
        abortRef.current = null;
      }
    }
  }, [fixtureId, rounds]);

  // The frame on the match page reports the match it just played; settle the
  // board against that instead of guessing from the scoreline.
  useEffect(() => {
    let cancelled = false;
    const stop = onMatchSummary((summary) => {
      settleOddsBoard(fixtureId, summary)
        .then((next) => {
          if (!cancelled) setSettlement(next);
        })
        .catch(() => {
          /* a settlement failure must not break the odds tab */
        });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [fixtureId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const byMarket = useMemo(() => {
    if (!result) return [];
    const grouped = new Map<string, MarketSimulationRow[]>();
    for (const row of result.markets) {
      const list = grouped.get(row.market) ?? [];
      list.push(row);
      grouped.set(row.market, list);
    }
    return [...grouped.entries()]
      .map(([name, rows]) => ({
        name,
        rows,
        // Rank by the markets whose price can be de-vigged; one-way player
        // props would otherwise dominate purely because their price is raw.
        maxEdge: rows.reduce((top, row) => {
          if (row.fairSource !== 'normalised') return top;
          return Math.max(top, Math.abs(row.edge));
        }, 0),
      }))
      .sort((left, right) => right.maxEdge - left.maxEdge);
  }, [result]);

  const disagreements = useMemo(() => {
    if (!result) return [];
    // Only markets whose price can be de-vigged belong in a like-for-like
    // comparison; player props and correct scores are one-way prices.
    const comparable = result.markets.filter((row) => row.fairSource === 'normalised');
    const sorted = comparable.slice().sort((left, right) => right.edge - left.edge);
    return [...sorted.slice(0, 6), ...sorted.slice(-4)];
  }, [result]);

  return (
    <section className="mt-6" data-testid="panel-odds-simulation">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mono text-[9px] uppercase tracking-[.18em] text-[#9b9d93]">Simulated markets</p>
          <h2 className="mt-1 text-[17px] font-extrabold tracking-tight text-[#2f3c3a]">
            Every price, graded by the match
          </h2>
          <p className="mt-1 max-w-[62ch] text-[11px] leading-relaxed text-[#7f837b]">
            The fixture is played out from the squads and form — never from the prices — and every
            selection on the board is graded against what happened. Thousands of rounds give the
            distribution behind each market.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="mono block text-[8px] uppercase tracking-[.14em] text-[#9b9d93]">
              Rounds
            </span>
            <input
              type="number"
              min={MIN_ROUNDS}
              max={MAX_ROUNDS}
              step={100}
              value={rounds}
              onChange={(event) => setRounds(Number(event.target.value) || 0)}
              className="mono mt-1 w-[92px] rounded-lg border border-[#d8d6cc] bg-[#fbfaf6] px-2.5 py-2 text-[12px] text-[#33413f] outline-none focus:border-[#7f9a8a]"
              data-testid="input-odds-rounds"
            />
          </label>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-[#2f6b4f] px-3.5 py-2.5 text-[10px] font-extrabold uppercase tracking-[.08em] text-[#f2f7f1] transition hover:bg-[#285c44] disabled:opacity-60"
            data-testid="button-run-odds"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? 'Running' : 'Run'}
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] text-[#9b9d93]">
        <Gauge size={11} />
        {DEFAULTS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setRounds(preset)}
            className="mono rounded-full border border-[#deddd4] bg-[#fbfaf6] px-2 py-0.5 text-[9px] text-[#6d7a72] hover:border-[#c3c8bd]"
          >
            {preset.toLocaleString()}
          </button>
        ))}
        <span className="mono" data-testid="odds-run-status">
          {running
            ? `playing ${rounds.toLocaleString()} matches…`
            : result
              ? `${result.rounds.toLocaleString()} rounds in ${(result.elapsedMs / 1000).toFixed(1)}s · ${result.markets.length} selections graded`
              : 'no run yet'}
        </span>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-[#e6d3cc] bg-[#fbf0ec] px-3 py-2 text-[10px] text-[#8a3b34]">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-4" data-testid="odds-simulation-results">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Result"
              value={`${pct(result.summary.homeWin, 0)} / ${pct(result.summary.draw, 0)} / ${pct(result.summary.awayWin, 0)}`}
              detail="home / draw / away"
            />
            <StatTile
              label="Goals"
              value={result.summary.averageGoals.toFixed(2)}
              detail={`${result.summary.averageHomeGoals.toFixed(2)} – ${result.summary.averageAwayGoals.toFixed(2)}`}
            />
            <StatTile label="Over 2.5" value={pct(result.summary.over25, 0)} detail={`BTTS ${pct(result.summary.btts, 0)}`} />
            <StatTile label="Corners" value={result.summary.averageCorners.toFixed(1)} />
            <StatTile label="Cards" value={result.summary.averageCards.toFixed(1)} />
            <StatTile label="Shots on target" value={result.summary.averageShotsOnTarget.toFixed(1)} />
          </div>

          <div className="rounded-xl border border-[#deddd4] bg-[#fbfaf6]">
            <div className="border-b border-[#e8e6de] bg-[#f3f2eb] px-4 py-2.5">
              <h3 className="text-[11px] font-extrabold text-[#43575a]">
                Where the simulation disagrees with the price
              </h3>
              <p className="mt-0.5 text-[9px] text-[#8b8d84]">
                Simulated chance minus the margin-free market chance, in percentage points.
              </p>
            </div>
            <div className="divide-y divide-[#eeece4]">
              {disagreements.map((row) => (
                <div
                  key={`${row.market}-${row.selection}`}
                  className="flex items-center justify-between gap-3 px-4 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[10px] font-bold text-[#52615e]">
                      {row.selection}
                      <span className="ml-1.5 font-normal text-[#9b9d93]">{row.market}</span>
                    </span>
                  </span>
                  <span className="mono flex shrink-0 items-center gap-2 text-[9px] text-[#8b8d84]">
                    <span>sim {pct(row.probability)}</span>
                    <span>mkt {pct(row.fair)}</span>
                    <span className={`font-semibold ${edgeTone(row.edge)}`}>{signedPct(row.edge)} pp</span>
                    <span className="rounded border border-[#d8e2d8] bg-[#edf2ec] px-1.5 py-0.5 text-[#456b58]">
                      {row.bestPrice.toFixed(2)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {byMarket.map((group) => (
              <MarketGroup
                key={group.name}
                name={group.name}
                rows={group.rows}
                open={Boolean(openMarkets[group.name])}
                onToggle={() =>
                  setOpenMarkets((current) => ({
                    ...current,
                    [group.name]: !current[group.name],
                  }))
                }
              />
            ))}
          </div>

          {result.untrackedMarkets.length ? (
            <p className="text-[9px] text-[#9b9d93]">
              Not graded by this engine:{' '}
              {result.untrackedMarkets.map((entry) => entry.market).join(', ')}.
            </p>
          ) : null}
        </div>
      ) : null}

      {settlement ? <SettlementCard settlement={settlement} /> : null}
    </section>
  );
}
