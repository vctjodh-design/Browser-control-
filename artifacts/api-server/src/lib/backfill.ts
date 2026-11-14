import { archiveDatabase } from './decision-store';
import { settleDecisionCard } from './decision-card';
import { InevitabilityUnavailableError } from './inevitability-engine';
import { KickoffScoreMatchNotFoundError } from './kickoffscore-match-details';
import { ingestHistoryDate } from './match-history';
import { resolveLedger } from './decision-ledger';

// Filling the ledger from the past, a fixture at a time.
//
// A finished match still has its board on the feed, so settling it today answers
// the question the app would have asked before kick-off — the prices were set
// before the whistle. That is the whole point: hundreds of marked lines instead of
// two, without pretending anything was known that was not.
//
// A cold settle is ten to fifteen seconds of upstream work, so this runs as a
// paced queue rather than a loop over a list: one fixture, a pause, the next. Every
// step is written down, which is what lets a restart at any point continue instead
// of starting over.

export type QueueState = 'queued' | 'done' | 'skipped' | 'failed';

export type BackfillStatus = {
  running: boolean;
  working: boolean;
  current: number | null;
  gapMs: number;
  queued: number;
  done: number;
  skipped: number;
  failed: number;
  lastNote: string | null;
  firstDate: string | null;
  lastDate: string | null;
};

type QueueRow = {
  fixture_id: number;
  match_date: string;
  home_score: number;
  away_score: number;
  state: string;
  attempts: number;
  note: string | null;
};

const MAX_ATTEMPTS = 3;
const DEFAULT_GAP_MS = 4_000;
const MAX_GAP_MS = 60_000;
const MAX_DATE_SPAN_DAYS = 31;

let timer: ReturnType<typeof setInterval> | null = null;
let working = false;
let current: number | null = null;
let gapMs = DEFAULT_GAP_MS;
let lastNote: string | null = null;

function schema(): void {
  const handle = archiveDatabase();
  if (!handle) return;
  try {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS backfill_queue (
        fixture_id INTEGER PRIMARY KEY,
        match_date TEXT NOT NULL,
        home_score INTEGER NOT NULL,
        away_score INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS backfill_queue_state ON backfill_queue (state, match_date);
    `);
  } catch {
    // A read-only volume leaves the queue empty and the app working.
  }
}

function nextQueued(): QueueRow | null {
  const handle = archiveDatabase();
  if (!handle) return null;
  schema();
  try {
    const row = handle
      .prepare(
        `SELECT fixture_id, match_date, home_score, away_score, state, attempts, note
         FROM backfill_queue
         WHERE state = 'queued' AND attempts < ?
         ORDER BY match_date ASC, fixture_id ASC
         LIMIT 1`,
      )
      .get(MAX_ATTEMPTS) as QueueRow | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function mark(fixtureId: number, state: QueueState, note: string): void {
  const handle = archiveDatabase();
  if (!handle) return;
  try {
    handle
      .prepare('UPDATE backfill_queue SET state = ?, note = ?, updated_at = ? WHERE fixture_id = ?')
      .run(state, note, Date.now(), fixtureId);
    lastNote = note;
  } catch {
    // A failed bookkeeping write costs a retry, not the run.
  }
}

function bump(fixtureId: number, note: string): void {
  const handle = archiveDatabase();
  if (!handle) return;
  try {
    const row = handle
      .prepare('SELECT attempts FROM backfill_queue WHERE fixture_id = ?')
      .get(fixtureId) as { attempts: number } | undefined;
    const attempts = Number(row?.attempts ?? 0) + 1;
    handle
      .prepare('UPDATE backfill_queue SET state = ?, attempts = ?, note = ?, updated_at = ? WHERE fixture_id = ?')
      .run(attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', attempts, note, Date.now(), fixtureId);
    lastNote = note;
  } catch {
    // Same: the queue survives a bookkeeping miss.
  }
}

function parseDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === text ? text : null;
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && dates.length < MAX_DATE_SPAN_DAYS) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export type EnqueueResult = {
  dates: number;
  discovered: number;
  queued: number;
  failedDates: string[];
};

export type EnqueueOptions = {
  /**
   * Whether the finished fixtures are also queued for a board read.
   *
   * Reading results is one feed call per date and takes seconds; settling cards is
   * ten to fifteen seconds each. They are the same range but nothing like the same
   * amount of work, so a range read for team history does not queue thousands of
   * board reads behind it unless that was asked for.
   */
  cards?: boolean;
  /** The most fixtures one range read may queue, so the queue stays a queue. */
  cardLimit?: number;
};

const DEFAULT_CARD_LIMIT = 200;
const MAX_CARD_LIMIT = 2_000;

/**
 * Reads a range of dates and queues every finished fixture on them.
 *
 * The feed is asked once per date, and the finished matches go into the history
 * table on the way through, so a range read for the queue also builds the backbone
 * a team's shape is computed from.
 */
export async function enqueueBackfill(
  from: unknown,
  to: unknown,
  options: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end || start > end) {
    throw new Error('Choose a date range in YYYY-MM-DD format, with the start on or before the end.');
  }

  const cards = options.cards === true;
  const requestedLimit = Number(options.cardLimit);
  const cardLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(MAX_CARD_LIMIT, Math.round(requestedLimit))
    : DEFAULT_CARD_LIMIT;

  const handle = archiveDatabase();
  schema();
  const insert = handle?.prepare(
    `INSERT INTO backfill_queue (fixture_id, match_date, home_score, away_score, state, attempts, note, updated_at)
     VALUES (?, ?, ?, ?, 'queued', 0, NULL, ?)
     ON CONFLICT(fixture_id) DO NOTHING`,
  );

  let discovered = 0;
  let queued = 0;
  const failedDates: string[] = [];
  for (const date of datesBetween(start, end)) {
    try {
      const finished = await ingestHistoryDate(date);
      discovered += finished.length;
      if (!insert || !cards) continue;
      for (const fixture of finished) {
        if (queued >= cardLimit) break;
        // A card already settled for this fixture is not read again; the queue is
        // for what the ledger is still missing.
        const existing = handle
          ?.prepare("SELECT state FROM backfill_queue WHERE fixture_id = ?")
          .get(fixture.fixtureId) as { state: string } | undefined;
        if (existing) continue;
        const result = insert.run(
          fixture.fixtureId,
          date,
          fixture.homeScore,
          fixture.awayScore,
          Date.now(),
        ) as { changes?: number };
        if (Number(result?.changes ?? 0) > 0) queued += 1;
      }
    } catch {
      // A date the feed will not answer is reported and skipped; the rest of the
      // range is still worth queueing.
      failedDates.push(date);
    }
  }
  return { dates: datesBetween(start, end).length, discovered, queued, failedDates };
}

async function tick(): Promise<void> {
  if (working) return;
  const job = nextQueued();
  if (!job) {
    stopBackfill();
    return;
  }
  working = true;
  current = job.fixture_id;
  try {
    const startedAt = Date.now();
    await settleDecisionCard(job.fixture_id, job.match_date);
    resolveLedger([{ fixtureId: job.fixture_id, home: job.home_score, away: job.away_score }]);
    mark(job.fixture_id, 'done', `settled in ${Date.now() - startedAt} ms`);
  } catch (error) {
    if (error instanceof InevitabilityUnavailableError) {
      mark(job.fixture_id, 'skipped', 'no board to read');
    } else if (error instanceof KickoffScoreMatchNotFoundError) {
      mark(job.fixture_id, 'skipped', 'fixture not found');
    } else {
      bump(job.fixture_id, error instanceof Error ? error.name : 'UnknownError');
    }
  } finally {
    working = false;
    current = null;
  }
}

/** Starts the paced queue. Already running means nothing changes but the pace. */
export function startBackfill(requestedGapMs?: unknown): BackfillStatus {
  const parsed = Number(requestedGapMs);
  if (Number.isFinite(parsed) && parsed >= 0) gapMs = Math.min(MAX_GAP_MS, Math.max(500, Math.round(parsed)));
  if (!timer) timer = setInterval(() => void tick(), gapMs);
  return backfillStatus();
}

export function stopBackfill(): BackfillStatus {
  if (timer) clearInterval(timer);
  timer = null;
  return backfillStatus();
}

export function isBackfillRunning(): boolean {
  return timer !== null;
}

export function backfillStatus(): BackfillStatus {
  const handle = archiveDatabase();
  const counts: Record<string, number> = { queued: 0, done: 0, skipped: 0, failed: 0 };
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  if (handle) {
    schema();
    try {
      for (const row of handle
        .prepare('SELECT state, COUNT(*) AS total FROM backfill_queue GROUP BY state')
        .all() as Array<{ state: string; total: number }>) {
        counts[String(row.state)] = Number(row.total ?? 0);
      }
      const span = handle
        .prepare('SELECT MIN(match_date) AS first_date, MAX(match_date) AS last_date FROM backfill_queue')
        .get() as { first_date: string | null; last_date: string | null } | undefined;
      firstDate = span?.first_date ?? null;
      lastDate = span?.last_date ?? null;
    } catch {
      // Counts of zero are the honest answer when the table cannot be read.
    }
  }
  return {
    running: timer !== null,
    working,
    current,
    gapMs,
    queued: counts.queued ?? 0,
    done: counts.done ?? 0,
    skipped: counts.skipped ?? 0,
    failed: counts.failed ?? 0,
    lastNote,
    firstDate,
    lastDate,
  };
}

/** Picks the queue back up after a restart, if it was left with work in it. */
export function resumeBackfill(): void {
  if (process.env.BACKFILL_AUTO_RESUME === '0') return;
  const status = backfillStatus();
  if (status.queued > 0) startBackfill();
}
