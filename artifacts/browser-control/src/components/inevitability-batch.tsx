import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleSlash, LoaderCircle, Play, Square, TimerReset } from 'lucide-react';
import {
  InevitabilityRequestError,
  fixtureId,
  loadInevitability,
  type FixtureOption,
  type InevitabilityVerdict,
} from '@/lib/inevitability';

// Resolving a whole date, one fixture at a time.
//
// The verdict for a single fixture costs a real squad read upstream, so the run
// is paced rather than fired off all at once, and rows appear as each match
// settles instead of waiting for the last one. A fixture with no board to read
// is recorded as skipped and the run carries on: one thin archive entry should
// not cost the other fixtures their verdicts.
//
// The read is upstream data, so the run is built to be a polite client rather
// than a fast one. Two fixtures are in flight at most, each start is separated
// by a jittered gap that widens every time the source complains, and a rate
// limit is waited out and retried instead of being thrown away. If the source
// keeps refusing, the run stops on its own and says how long to wait — hammering
// a feed that has already said no is how an address gets blocked.

const CONCURRENCY = 2;
const BASE_PACE_MS = 350;
const MAX_PACE_MS = 5_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_TRANSIENT_RETRIES = 2;
const MAX_PAUSES_PER_RUN = 4;
const MAX_WAIT_MS = 120_000;

/** The part of a verdict a row prints; the full reasoning is re-read when the row is opened. */
type RowVerdict = Pick<InevitabilityVerdict, 'scoreline' | 'confidence'>;

type BatchRow =
  | { kind: 'pending'; fixture: FixtureOption }
  | { kind: 'running'; fixture: FixtureOption }
  | { kind: 'resolved'; fixture: FixtureOption; verdict: RowVerdict }
  | { kind: 'skipped'; fixture: FixtureOption; reason: string };

/** What a finished run leaves behind for this date, so a reload does not cost the work. */
type StoredRow =
  | { kind: 'resolved'; fixture: FixtureOption; verdict: RowVerdict }
  | { kind: 'skipped'; fixture: FixtureOption; reason: string };

type RunSnapshot = { version: number; date: string; savedAt: number; rows: StoredRow[] };

const SNAPSHOT_VERSION = 1;

function snapshotKey(date: string): string {
  return `browser-control:inevitability-batch:${date}`;
}

function readSnapshot(date: string): RunSnapshot | null {
  try {
    const raw = window.localStorage.getItem(snapshotKey(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunSnapshot;
    if (parsed?.version !== SNAPSHOT_VERSION || parsed.date !== date || !Array.isArray(parsed.rows)) return null;
    const rows = parsed.rows.filter((row) =>
      row?.fixture?.matchUrl && (row.kind === 'resolved' ? Boolean(row.verdict) : Boolean(row.reason)),
    );
    return rows.length ? { ...parsed, rows } : null;
  } catch {
    return null;
  }
}

function writeSnapshot(date: string, rows: BatchRow[]): void {
  const settled = rows.flatMap<StoredRow>((row) =>
    row.kind === 'resolved'
      ? [{ kind: 'resolved', fixture: row.fixture, verdict: row.verdict }]
      : row.kind === 'skipped'
        ? [{ kind: 'skipped', fixture: row.fixture, reason: row.reason }]
        : [],
  );
  // An empty save would erase a finished run the moment a new one starts; there is
  // nothing to remember until the first fixture settles.
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
  if (!(error instanceof InevitabilityRequestError)) return true;
  return error.status === 502 || error.status === 503 || error.status === 504;
}

function isRateLimit(error: unknown): error is InevitabilityRequestError {
  return error instanceof InevitabilityRequestError && error.status === 429;
}

function skipReason(error: unknown): string {
  if (error instanceof InevitabilityRequestError) {
    if (error.status === 422) return 'Skipped: no board to read, the eleven is missing.';
    if (error.status === 404) return 'Skipped: not in the feed.';
    if (error.status === 429) return 'Skipped: the source kept rate limiting, even after waiting.';
    return `Skipped: ${error.message}`;
  }
  return error instanceof Error ? `Skipped: ${error.message}` : 'Skipped: could not be resolved.';
}

function ConfidenceChip({ verdict }: { verdict: RowVerdict }) {
  const tone =
    verdict.confidence.tier === 'firm'
      ? 'border-[#c3d2c8] bg-[#eef3ee] text-[#4c6b58]'
      : verdict.confidence.tier === 'leaning'
        ? 'border-[#e0cdc0] bg-[#faf1ea] text-[#8a6a58]'
        : 'border-[#e3c3b6] bg-[#fff6f0] text-[#b85b46]';
  return (
    <span
      className={`mono inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[.12em] ${tone}`}
      title={verdict.confidence.basis}
    >
      {verdict.confidence.label}
      <span className="text-[#9a9c93]">· {verdict.confidence.separation.toFixed(2)}</span>
    </span>
  );
}

export function InevitabilityBatch({
  date,
  fixtures,
  selected,
  onSelect,
}: {
  date: string;
  fixtures: FixtureOption[];
  selected: number | null;
  onSelect: (fixtureId: number) => void;
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
  // Whatever that date already resolved is put back, so a reload costs nothing.
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
    if (!fixtures.length || !stored) {
      setRows([]);
      setRestoredAt(null);
      return;
    }

    const saved = new Map(stored.rows.map((row) => [row.fixture.matchUrl, row]));
    setRows(
      fixtures.map<BatchRow>((fixture) => {
        const previous = saved.get(fixture.matchUrl);
        if (!previous) return { kind: 'pending', fixture };
        return previous.kind === 'resolved'
          ? { kind: 'resolved', fixture, verdict: previous.verdict }
          : { kind: 'skipped', fixture, reason: previous.reason };
      }),
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

  // Keep the date's results as they settle. Debounced, because writing the whole
  // date's list on every resolved fixture would be a save per row.
  useEffect(() => {
    if (!date || !rows.length) return;
    const timer = setTimeout(() => writeSnapshot(date, rows), 400);
    return () => clearTimeout(timer);
  }, [date, rows]);

  const resolved = rows.filter((row) => row.kind === 'resolved');
  const skipped = rows.filter((row) => row.kind === 'skipped');
  const settled = resolved.length + skipped.length;
  const total = rows.length;
  const percent = total ? Math.round((settled / total) * 100) : 0;
  const remainingCooling = cooling ? Math.max(0, Math.ceil((cooling.until - clock) / 1_000)) : 0;
  const counts = useMemo(() => {
    const tally = { firm: 0, leaning: 0, 'knife-edge': 0 };
    for (const row of rows) {
      if (row.kind === 'resolved') tally[row.verdict.confidence.tier] += 1;
    }
    return tally;
  }, [rows]);

  const start = async () => {
    if (running || !fixtures.length) return;
    const controller = new AbortController();
    abortRef.current = controller;
    paceRef.current = BASE_PACE_MS;
    pausesRef.current = 0;
    haltRef.current = false;
    setHalted('');
    setCooling(null);
    setRestoredAt(null);
    setRows(fixtures.map((fixture) => ({ kind: 'pending', fixture })));
    setRunning(true);

    const entries = fixtures.map((fixture, index) => ({ fixture, index }));
    let cursor = 0;
    const setRow = (index: number, row: BatchRow) =>
      setRows((previous) => previous.map((current, position) => (position === index ? row : current)));

    // One fixture, retried through a cooldown rather than abandoned at the first 429.
    const resolve = async (id: number): Promise<InevitabilityVerdict> => {
      let rateLimitRetries = 0;
      let transientRetries = 0;
      for (;;) {
        try {
          return await loadInevitability(id, controller.signal);
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
          const verdict = await resolve(id);
          setRow(entry.index, { kind: 'resolved', fixture: entry.fixture, verdict });
          // Easing back once the source is answering again.
          paceRef.current = Math.max(BASE_PACE_MS, Math.round(paceRef.current * 0.85));
        } catch (error) {
          if (controller.signal.aborted) return;
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
    setRows((previous) =>
      previous.map((row) =>
        row.kind === 'running' ? { kind: 'skipped', fixture: row.fixture, reason: 'Skipped: stopped mid-read.' } : row,
      ),
    );
  };

  return (
    <section
      className="mb-5 overflow-hidden rounded-[17px] border border-[#d6d5cc] bg-[#f9f8f3]"
      data-testid="section-inevitability-batch"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1dfd7] bg-[#f1f0e9] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="mono text-[9px] uppercase tracking-[.17em] text-[#9b7160]">Process the date</p>
          <p className="mt-0.5 max-w-[520px] text-[10px] leading-5 text-[#858780]">
            Every fixture on this date is read once and listed with its verdict. Matches with no board to read are
            skipped, and the run carries on.
          </p>
        </div>
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#dcd9d0] bg-white px-3 text-[10px] font-extrabold text-[#784b3e] transition hover:bg-[#fff6f0]"
            data-testid="button-batch-stop"
          >
            <Square size={11} /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!fixtures.length}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#253746] px-3.5 text-[10px] font-extrabold text-[#f8f2e7] transition hover:bg-[#1d2b37] disabled:opacity-40"
            data-testid="button-batch-start"
          >
            <Play size={11} /> Process {fixtures.length || ''} fixtures
          </button>
        )}
      </div>

      {(running || rows.length > 0) && (
        <div className="border-b border-[#e1dfd7] px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p
              className="mono text-[8px] uppercase tracking-[.16em] text-[#9a8c80]"
              data-testid="status-batch-progress"
            >
              {running
                ? `Resolving ${Math.min(settled + CONCURRENCY, total)} of ${total}`
                : `${settled} of ${total} read`}
            </p>
            <p className="mono text-[8px] uppercase tracking-[.14em] text-[#9a8c80]" data-testid="text-batch-summary">
              {resolved.length} read · {skipped.length} skipped
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
              data-testid="status-batch-restored"
            >
              kept from the run saved at{' '}
              {new Date(restoredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {cooling && (
            <p
              className="mono mt-2 flex items-center gap-1.5 text-[9px] leading-4 text-[#8a6a58]"
              data-testid="status-batch-cooling"
            >
              <TimerReset size={11} className="shrink-0" /> Cooling down {remainingCooling}s — the data source asked us
              to wait, then this fixture is retried.
            </p>
          )}
          {halted && (
            <p
              className="mono mt-2 border-t border-[#e1dfd7] pt-2 text-[9px] leading-4 text-[#784b3e]"
              data-testid="status-batch-halted"
            >
              {halted}
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-[#e8e6dd]" data-testid="list-batch-rows">
          {rows.map((row) => {
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
                  data-testid={id === null ? undefined : `button-batch-${id}`}
                >
                  <span className="min-w-0 flex-1 basis-[180px]">
                    <span className="mono block truncate text-[8px] uppercase tracking-[.1em] text-[#9a8c80]">
                      {row.fixture.competition}
                    </span>
                    <span className="block truncate text-[11px] font-bold text-[#2b3e49]">
                      {row.fixture.homeTeam} v {row.fixture.awayTeam}
                    </span>
                  </span>

                  {row.kind === 'resolved' ? (
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <span
                        className="mono text-[13px] font-extrabold tracking-[-.02em] text-[#2b3e49]"
                        data-testid={id === null ? undefined : `text-batch-scoreline-${id}`}
                      >
                        {row.verdict.scoreline}
                      </span>
                      <ConfidenceChip verdict={row.verdict} />
                    </span>
                  ) : row.kind === 'running' ? (
                    <span className="mono flex shrink-0 items-center gap-1.5 text-[9px] text-[#8b8d84]">
                      <LoaderCircle size={12} className="animate-spin" /> resolving
                    </span>
                  ) : row.kind === 'pending' ? (
                    <span className="mono shrink-0 text-[9px] text-[#a0a29a]">queued</span>
                  ) : (
                    <span
                      className="mono flex w-full min-w-0 items-start gap-1.5 text-[9px] leading-4 text-[#a37a68]"
                      title={row.reason}
                      data-testid={id === null ? undefined : `text-batch-skip-${id}`}
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
