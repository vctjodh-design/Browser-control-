import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleSlash, LoaderCircle, Play, Square, TimerReset } from 'lucide-react';
import { fixtureId, type FixtureOption } from '@/lib/inevitability';
import {
  DecisionRequestError,
  boardAgreementPercent,
  loadDecisionTree,
  summarizeDecision,
  type DecisionSummary,
  type DecisionTier,
} from '@/lib/decision-tree';

// Settling a whole date, one fixture at a time.
//
// Each row costs a real squad read upstream — seconds, not milliseconds — and the
// server memo only helps once it has been asked, so the run is paced rather than
// fired off all at once, and rows appear as each fixture settles instead of
// waiting for the last one. A fixture with no board to read is recorded as
// skipped and the run carries on: one thin archive entry should not cost the
// other fixtures their card.
//
// Everything the run settles is kept per date, so closing the page and coming
// back leaves a "Continue" that only pays for what is left, and an explicit
// "Read the date again" is needed to spend the work over.

const CONCURRENCY = 2;
const BASE_PACE_MS = 350;
const MAX_PACE_MS = 5_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_TRANSIENT_RETRIES = 2;
const MAX_PAUSES_PER_RUN = 4;
const MAX_WAIT_MS = 120_000;

type BatchRow =
  | { kind: 'pending'; fixture: FixtureOption }
  | { kind: 'running'; fixture: FixtureOption }
  | { kind: 'resolved'; fixture: FixtureOption; summary: DecisionSummary }
  | { kind: 'skipped'; fixture: FixtureOption; reason: string };

/** What a finished run leaves behind for this date, so a reload does not cost the work. */
type StoredRow =
  | { kind: 'resolved'; fixture: FixtureOption; summary: DecisionSummary }
  | { kind: 'skipped'; fixture: FixtureOption; reason: string };

type RunSnapshot = { version: number; date: string; savedAt: number; rows: StoredRow[] };

// Bumped when a saved row gained fields; a run saved by an older build is dropped
// rather than rendered with half a card on it.
const SNAPSHOT_VERSION = 3;
const STOPPED_MID_READ = 'Skipped: stopped mid-read.';

const TIER_STYLE: Record<DecisionTier, string> = {
  firm: 'border-[#c6d8c9] bg-[#e6efe4] text-[#41694f]',
  leaning: 'border-[#e2d6bd] bg-[#f6efdf] text-[#8a6a38]',
  'knife-edge': 'border-[#e0d3cd] bg-[#f7ece7] text-[#9a5c46]',
};

function snapshotKey(date: string): string {
  return `browser-control:decision-batch:${date}`;
}

function readSnapshot(date: string): RunSnapshot | null {
  try {
    const raw = window.localStorage.getItem(snapshotKey(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunSnapshot;
    if (parsed?.version !== SNAPSHOT_VERSION || parsed.date !== date || !Array.isArray(parsed.rows)) return null;
    const rows = parsed.rows.filter(
      (row) =>
        row?.fixture?.matchUrl &&
        (row.kind === 'resolved'
          ? Boolean(row.summary?.scoreline)
          : // A read cut off by Stop was never made, so it comes back queued instead
            // of being remembered as a skip that a later Continue will not touch.
            Boolean(row.reason) && row.reason !== STOPPED_MID_READ),
    );
    return rows.length ? { ...parsed, rows } : null;
  } catch {
    return null;
  }
}

function writeSnapshot(date: string, rows: BatchRow[]): void {
  const settled = rows.flatMap<StoredRow>((row) =>
    row.kind === 'resolved'
      ? [{ kind: 'resolved', fixture: row.fixture, summary: row.summary }]
      : row.kind === 'skipped'
        ? [{ kind: 'skipped', fixture: row.fixture, reason: row.reason }]
        : [],
  );
  // An empty save would erase a finished run the moment a new one starts.
  if (!settled.length) return;
  try {
    window.localStorage.setItem(
      snapshotKey(date),
      JSON.stringify({ version: SNAPSHOT_VERSION, date, savedAt: Date.now(), rows: settled } satisfies RunSnapshot),
    );
  } catch {
    // Storage can be full or disabled; the run still works, it just will not survive a reload.
  }
}

/** A pause that ends early when the run is stopped, so Stop never waits out a cooldown. */
function sleepWithAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || milliseconds <= 0) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function isRetryableTransient(error: unknown): boolean {
  if (!(error instanceof DecisionRequestError)) return true;
  return error.status === 502 || error.status === 503 || error.status === 504;
}

function isRateLimit(error: unknown): error is DecisionRequestError {
  return error instanceof DecisionRequestError && error.status === 429;
}

function skipReason(error: unknown): string {
  if (error instanceof DecisionRequestError) {
    if (error.status === 422) return 'Skipped: no board to read, the eleven is missing.';
    if (error.status === 404) return 'Skipped: not in the feed.';
    if (error.status === 429) return 'Skipped: the source kept rate limiting, even after waiting.';
    return `Skipped: ${error.message}`;
  }
  return error instanceof Error ? `Skipped: ${error.message}` : 'Skipped: the card could not be settled.';
}

function TierChip({ summary }: { summary: DecisionSummary }) {
  return (
    <span
      className={`mono shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[.12em] ${
        TIER_STYLE[summary.resultTier]
      }`}
      title={`${summary.firms} of the settled lines came back firm`}
    >
      {summary.resultTier}
    </span>
  );
}

/**
 * How much of the card the market board is on the same side of. Shown for
 * comparison only: the board is not an input to any call on the card, so this is
 * a second opinion being measured, not the model agreeing with itself.
 */
function BoardChip({ summary }: { summary: DecisionSummary }) {
  const percent = boardAgreementPercent(summary);
  if (percent === null) {
    return (
      <span
        className="mono shrink-0 rounded-full border border-[#e0dfd6] bg-[#f4f3ec] px-2 py-0.5 text-[8px] uppercase tracking-[.1em] text-[#a0a29a]"
        title="The market board priced nothing this card compares to."
        data-testid={`board-none-${summary.scoreline}`}
      >
        board n/a
      </span>
    );
  }
  const tone =
    percent >= 70
      ? 'border-[#c6d8c9] bg-[#e6efe4] text-[#41694f]'
      : percent >= 40
        ? 'border-[#e2d6bd] bg-[#f6efdf] text-[#8a6a38]'
        : 'border-[#e0d3cd] bg-[#f7ece7] text-[#9a5c46]';
  return (
    <span
      className={`mono shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[.1em] ${tone}`}
      title={`Across the ${summary.compared} lines the board priced, it puts ${percent}% of the weight on the sides the card called, and is on the card's side on ${summary.agreed} of them.`}
      data-testid={`board-agreement-${summary.scoreline}`}
    >
      board {percent}%
    </span>
  );
}

export function DecisionBatch({
  date,
  fixtures,
  selected,
  onSelect,
  query = '',
}: {
  date: string;
  fixtures: FixtureOption[];
  selected: number | null;
  onSelect: (fixtureId: number) => void;
  /** A search that narrows what the list shows. The run still covers the date. */
  query?: string;
}) {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [cooling, setCooling] = useState<{ until: number; seconds: number } | null>(null);
  const [halted, setHalted] = useState('');
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const paceRef = useRef(BASE_PACE_MS);
  const pausesRef = useRef(0);
  const haltRef = useRef(false);

  // A new date is a new run: nothing from the previous date's fixtures applies.
  // Whatever that date already settled is put back, so a reload costs nothing.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setCooling(null);
    setHalted('');
    paceRef.current = BASE_PACE_MS;
    pausesRef.current = 0;
    haltRef.current = false;

    const stored = readSnapshot(date);
    if (!stored) {
      setRows([]);
      setRestoredAt(null);
      return;
    }

    // A saved row carries its own fixture, so the date's cards still show when the
    // fixture list is slow or refused — the run is not lost just because the list is.
    const saved = new Map(stored.rows.map((row) => [row.fixture.matchUrl, row]));
    setRows(
      fixtures.length
        ? fixtures.map<BatchRow>((fixture) => {
            const previous = saved.get(fixture.matchUrl);
            if (!previous) return { kind: 'pending', fixture };
            return previous.kind === 'resolved'
              ? { kind: 'resolved', fixture, summary: previous.summary }
              : { kind: 'skipped', fixture, reason: previous.reason };
          })
        : stored.rows.map<BatchRow>((row) =>
            row.kind === 'resolved'
              ? { kind: 'resolved', fixture: row.fixture, summary: row.summary }
              : { kind: 'skipped', fixture: row.fixture, reason: row.reason },
          ),
    );
    setRestoredAt(stored.savedAt);
  }, [date, fixtures]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Only the cooldown needs a ticking clock; nothing else here re-renders on time.
  useEffect(() => {
    if (!cooling) return;
    const timer = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(timer);
  }, [cooling]);

  // Keep the date's cards as they settle. Debounced, because writing the whole
  // date's list on every resolved fixture would be a save per row.
  useEffect(() => {
    if (!date || !rows.length) return;
    const timer = setTimeout(() => writeSnapshot(date, rows), 400);
    return () => clearTimeout(timer);
  }, [date, rows]);

  const search = query.trim().toLowerCase();
  const visibleRows = search
    ? rows.filter((row) =>
        [row.fixture.competition, row.fixture.homeTeam, row.fixture.awayTeam]
          .join(' ')
          .toLowerCase()
          .includes(search),
      )
    : rows;
  const resolved = rows.filter((row) => row.kind === 'resolved');
  const skipped = rows.filter((row) => row.kind === 'skipped');
  const settled = resolved.length + skipped.length;
  const total = rows.length;
  const percent = total ? Math.round((settled / total) * 100) : 0;
  const outstanding = total ? total - settled : fixtures.length;
  const resuming = outstanding > 0 && outstanding < fixtures.length;
  const finished = total > 0 && outstanding === 0;
  const remainingCooling = cooling ? Math.max(0, Math.ceil((cooling.until - clock) / 1_000)) : 0;
  const counts = useMemo(() => {
    const tally = { firm: 0, leaning: 0, 'knife-edge': 0 };
    for (const row of rows) {
      if (row.kind === 'resolved') tally[row.summary.resultTier] += 1;
    }
    return tally;
  }, [rows]);

  const start = async (readAgain = false) => {
    if (running || !fixtures.length) return;

    // What this date already settled stays settled: a refreshed page picks the run
    // up where it stopped instead of paying upstream for every fixture again.
    const kept = new Map<string, StoredRow>();
    if (!readAgain) {
      for (const row of rows) {
        if (row.kind === 'resolved') {
          kept.set(row.fixture.matchUrl, { kind: 'resolved', fixture: row.fixture, summary: row.summary });
        } else if (row.kind === 'skipped') {
          kept.set(row.fixture.matchUrl, { kind: 'skipped', fixture: row.fixture, reason: row.reason });
        }
      }
    }
    const entries: Array<{ fixture: FixtureOption; index: number }> = [];
    const queued = fixtures.map<BatchRow>((fixture, index) => {
      const previous = kept.get(fixture.matchUrl);
      if (previous) {
        return previous.kind === 'resolved'
          ? { kind: 'resolved', fixture, summary: previous.summary }
          : { kind: 'skipped', fixture, reason: previous.reason };
      }
      entries.push({ fixture, index });
      return { kind: 'pending', fixture };
    });
    if (!entries.length) return;

    const controller = new AbortController();
    abortRef.current = controller;
    paceRef.current = BASE_PACE_MS;
    pausesRef.current = 0;
    haltRef.current = false;
    setHalted('');
    setCooling(null);
    setRestoredAt(null);
    setRows(queued);
    setRunning(true);

    let cursor = 0;
    const setRow = (index: number, row: BatchRow) =>
      setRows((previous) => previous.map((current, position) => (position === index ? row : current)));

    // One fixture, retried through a cooldown rather than abandoned at the first 429.
    const settle = async (id: number): Promise<DecisionSummary> => {
      let rateLimitRetries = 0;
      let transientRetries = 0;
      for (;;) {
        try {
          return summarizeDecision(await loadDecisionTree(id, controller.signal));
        } catch (error) {
          if (controller.signal.aborted) throw error;

          if (isRateLimit(error)) {
            const requestedMs = Math.max(0, (error.retryAfterSeconds ?? 0) * 1_000);
            if (requestedMs > MAX_WAIT_MS) {
              const askedFor =
                requestedMs >= 60_000
                  ? `${Math.round(requestedMs / 60_000)}-minute`
                  : `${Math.round(requestedMs / 1_000)}-second`;
              haltRef.current = true;
              setHalted(
                `Run stopped: the data source asked for a ${askedFor} cooldown. Wait that long before starting again — retrying now is what gets an address blocked.`,
              );
              throw error;
            }
            if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES || pausesRef.current >= MAX_PAUSES_PER_RUN) {
              haltRef.current = true;
              setHalted(
                'Run stopped: the data source refused the read repeatedly. Give it a few minutes before starting the date again.',
              );
              throw error;
            }

            rateLimitRetries += 1;
            pausesRef.current += 1;
            // Backing the whole run off, not just this fixture: the cooldown upstream
            // is per origin, so every request in flight is about to be refused too.
            paceRef.current = Math.min(MAX_PACE_MS, Math.round(paceRef.current * 2));
            const waitMs = Math.min(Math.max(requestedMs, 4_000 * 2 ** rateLimitRetries), MAX_WAIT_MS);
            setCooling({ until: Date.now() + waitMs, seconds: Math.ceil(waitMs / 1_000) });
            await sleepWithAbort(waitMs, controller.signal);
            setCooling(null);
            continue;
          }

          if (isRetryableTransient(error) && transientRetries < MAX_TRANSIENT_RETRIES) {
            transientRetries += 1;
            await sleepWithAbort(1_500 * 2 ** transientRetries + Math.random() * 800, controller.signal);
            continue;
          }

          throw error;
        }
      }
    };

    const worker = async () => {
      while (!controller.signal.aborted && !haltRef.current) {
        const entry = entries[cursor];
        cursor += 1;
        if (!entry) return;

        const id = fixtureId(entry.fixture);
        if (id === null) {
          setRow(entry.index, {
            kind: 'skipped',
            fixture: entry.fixture,
            reason: 'Skipped: the fixture has no match id.',
          });
          continue;
        }

        // A human-paced gap, jittered so the run does not arrive as a metronome.
        await sleepWithAbort(paceRef.current * (0.6 + Math.random() * 0.8), controller.signal);
        if (controller.signal.aborted || haltRef.current) return;

        setRow(entry.index, { kind: 'running', fixture: entry.fixture });
        try {
          const summary = await settle(id);
          setRow(entry.index, { kind: 'resolved', fixture: entry.fixture, summary });
          // Easing back once the source is answering again.
          paceRef.current = Math.max(BASE_PACE_MS, Math.round(paceRef.current * 0.85));
        } catch (error) {
          if (controller.signal.aborted) return;
          // A halted run never read this fixture, so it returns to the queue rather
          // than being remembered as a skip that a later Continue will not touch.
          if (haltRef.current) {
            setRow(entry.index, { kind: 'pending', fixture: entry.fixture });
            return;
          }
          setRow(entry.index, { kind: 'skipped', fixture: entry.fixture, reason: skipReason(error) });
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
    } finally {
      setCooling(null);
      if (!controller.signal.aborted) setRunning(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setCooling(null);
    // A read that was cut off never happened: fixtures that were mid-flight go back
    // in the queue, so Stop followed by Continue does not quietly lose them.
    setRows((previous) =>
      previous.map((row) => (row.kind === 'running' ? { kind: 'pending', fixture: row.fixture } : row)),
    );
  };

  return (
    <section
      className="mb-5 overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]"
      data-testid="section-decision-batch"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f1f0e9] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="mono text-[9px] uppercase tracking-[.17em] text-[#9b7160]">Settle the date</p>
          <p className="mt-0.5 max-w-[520px] text-[10px] leading-5 text-[#858780]">
            Every fixture on this date is read once and listed with the card its board settles. Matches with no board
            to read are skipped, and the run carries on.
          </p>
        </div>
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#dcd9d0] bg-white px-3 text-[10px] font-extrabold text-[#784b3e] transition hover:bg-[#fff6f0]"
            data-testid="button-decision-batch-stop"
          >
            <Square size={11} /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start(finished)}
            disabled={!fixtures.length}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#253746] px-3.5 text-[10px] font-extrabold text-[#f8f2e7] transition hover:bg-[#1d2b37] disabled:opacity-40"
            data-testid="button-decision-batch-start"
          >
            <Play size={11} />
            {finished
              ? 'Read the date again'
              : resuming
                ? `Continue · ${outstanding} left`
                : fixtures.length
                  ? `Settle ${fixtures.length} fixtures`
                  : 'Settle the date'}
          </button>
        )}
      </div>

      {(running || rows.length > 0) && (
        <div className="border-b border-[#e1dfd7] px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p
              className="mono text-[8px] uppercase tracking-[.16em] text-[#9a8c80]"
              data-testid="status-decision-batch-progress"
            >
              {running
                ? `Settling ${Math.min(settled + CONCURRENCY, total)} of ${total}`
                : `${settled} of ${total} read`}
            </p>
            <p className="mono text-[8px] uppercase tracking-[.14em] text-[#9a8c80]" data-testid="text-decision-batch-summary">
              {resolved.length} carded · {skipped.length} skipped
              {search ? ` · ${visibleRows.length} shown` : ''}
            </p>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#e4e2d9]">
            <div className="h-full rounded-full bg-[#253746] transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="mono mt-2 text-[8px] uppercase tracking-[.1em] text-[#a0a29a]">
            firm {counts.firm} · leaning {counts.leaning} · knife-edge {counts['knife-edge']}
          </p>
          {restoredAt !== null && !running && (
            <p
              className="mono mt-1 text-[8px] uppercase tracking-[.1em] text-[#a0a29a]"
              data-testid="status-decision-batch-restored"
            >
              kept from the run saved at{' '}
              {new Date(restoredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {cooling && (
            <p
              className="mono mt-2 flex items-center gap-1.5 text-[9px] leading-4 text-[#8a6a58]"
              data-testid="status-decision-batch-cooling"
            >
              <TimerReset size={11} className="shrink-0" /> Cooling down {remainingCooling}s — the data source asked us
              to wait, then this fixture is retried.
            </p>
          )}
          {halted && (
            <p
              className="mono mt-2 border-t border-[#e1dfd7] pt-2 text-[9px] leading-4 text-[#784b3e]"
              data-testid="status-decision-batch-halted"
            >
              {halted}
            </p>
          )}
        </div>
      )}

      {visibleRows.length === 0 && search && (
        <p className="px-4 py-4 text-[10px] text-[#93958b] sm:px-6" data-testid="text-decision-no-match">
          No fixture on this date matches “{query.trim()}”.
        </p>
      )}

      {visibleRows.length > 0 && (
        <ul className="divide-y divide-[#e8e6dd]" data-testid="list-decision-rows">
          {visibleRows.map((row) => {
            const id = fixtureId(row.fixture);
            const active = id !== null && id === selected;
            return (
              <li key={row.fixture.matchUrl}>
                <button
                  type="button"
                  onClick={() => {
                    if (row.kind === 'resolved' && id !== null) onSelect(id);
                  }}
                  disabled={row.kind !== 'resolved' || id === null}
                  className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-left transition sm:px-6 ${
                    active ? 'bg-[#eef0ea]' : row.kind === 'resolved' ? 'hover:bg-white' : 'opacity-70'
                  } disabled:cursor-default`}
                  data-testid={id === null ? undefined : `button-decision-batch-${id}`}
                >
                  <span className="min-w-0 flex-1 basis-[170px]">
                    <span className="mono block truncate text-[8px] uppercase tracking-[.1em] text-[#9a8c80]">
                      {row.fixture.competition}
                    </span>
                    <span className="block truncate text-[11px] font-bold text-[#2b3e49]">
                      {row.fixture.homeTeam} v {row.fixture.awayTeam}
                    </span>
                    {row.kind === 'resolved' && (
                      <span
                        className="mono mt-0.5 block truncate text-[9px] leading-4 text-[#8b8d84]"
                        data-testid={id === null ? undefined : `text-decision-batch-calls-${id}`}
                        title={`${row.summary.result} · Both teams to score ${row.summary.btts} · xG ${row.summary.homeWorth.toFixed(
                          2,
                        )} – ${row.summary.awayWorth.toFixed(2)} · ${row.summary.goals}`}
                      >
                        {row.summary.result} · BTTS {row.summary.btts} · xG {row.summary.homeWorth.toFixed(2)}–
                        {row.summary.awayWorth.toFixed(2)}
                      </span>
                    )}
                  </span>

                  {row.kind === 'resolved' ? (
                    <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <span
                        className="mono text-[13px] font-extrabold tracking-[-.02em] text-[#2b3e49]"
                        data-testid={id === null ? undefined : `text-decision-batch-scoreline-${id}`}
                      >
                        {row.summary.scoreline}
                      </span>
                      <TierChip summary={row.summary} />
                      <BoardChip summary={row.summary} />
                    </span>
                  ) : row.kind === 'running' ? (
                    <span className="mono flex shrink-0 items-center gap-1.5 text-[9px] text-[#8b8d84]">
                      <LoaderCircle size={12} className="animate-spin" /> settling
                    </span>
                  ) : row.kind === 'pending' ? (
                    <span className="mono shrink-0 text-[9px] text-[#a0a29a]">queued</span>
                  ) : (
                    <span
                      className="mono flex w-full min-w-0 items-start gap-1.5 text-[9px] leading-4 text-[#a37a68]"
                      title={row.reason}
                      data-testid={id === null ? undefined : `text-decision-batch-skip-${id}`}
                    >
                      <CircleSlash size={11} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 whitespace-normal">{row.reason}</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
