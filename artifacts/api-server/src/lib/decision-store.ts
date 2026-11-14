import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { DecisionCardSummary } from "./decision-tree";

// Settled cards, kept where a restart cannot reach them.
//
// A card costs a real squad read — seconds of upstream work per fixture — and it
// never changes once the board has been read: the worths, the scoreline and every
// line on it are arithmetic on that one read. Holding them only in process memory
// meant a restart, a redeploy or an idle container being replaced threw the whole
// date away and made the next reader pay for it again, fixture by fixture.
//
// So they are written to the same SQLite file the archive uses, which DEPLOY.md
// already asks the host to keep on a persistent volume. The table is small: one
// row per fixture, the plan the summary needs, and the full payload so the card can
// be re-opened without another read.

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const databasePath =
  process.env.PROCESSED_MATCH_DB_PATH ?? resolve(moduleDirectory, "../data/processed-matches.sqlite");

/** How long a stored card is served before the board is read again. */
export const DECISION_STORED_TTL_MS = 12 * 60 * 60 * 1_000;

/** The plan of one settled card, in the shape the date list prints. */
export type StoredDecisionSummary = DecisionCardSummary;

export type StoredDecisionCard = {
  fixtureId: number;
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  settledAt: number;
  summary: StoredDecisionSummary;
};

let database: DatabaseSync | null = null;
let unusable = false;

function db(): DatabaseSync | null {
  if (unusable) return null;
  if (database) return database;
  try {
    mkdirSync(dirname(databasePath), { recursive: true });
    const opened = new DatabaseSync(databasePath);
    opened.exec(`
      CREATE TABLE IF NOT EXISTS decision_cards (
        fixture_id INTEGER PRIMARY KEY,
        match_date TEXT NOT NULL,
        home_team TEXT NOT NULL DEFAULT '',
        away_team TEXT NOT NULL DEFAULT '',
        competition TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL,
        payload TEXT NOT NULL,
        settled_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS decision_cards_date ON decision_cards (match_date, settled_at DESC);
    `);
    database = opened;
    return database;
  } catch {
    // A read-only or missing volume must not take the API down with it: the
    // endpoint still settles cards, it just cannot keep them.
    unusable = true;
    return null;
  }
}

type StoredRow = {
  fixture_id: SQLOutputValue;
  match_date: SQLOutputValue;
  home_team: SQLOutputValue;
  away_team: SQLOutputValue;
  competition: SQLOutputValue;
  summary: SQLOutputValue;
  payload: SQLOutputValue;
  settled_at: SQLOutputValue;
};

function text(value: SQLOutputValue): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function number(value: SQLOutputValue): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

/** The full card for a fixture, if one was settled inside the window. */
export function readStoredCard<T>(
  fixtureId: number,
  maxAgeMs = DECISION_STORED_TTL_MS,
): { card: T; settledAt: number } | null {
  const handle = db();
  if (!handle) return null;
  try {
    const row = handle
      .prepare("SELECT payload, settled_at FROM decision_cards WHERE fixture_id = ?")
      .get(fixtureId) as StoredRow | undefined;
    if (!row) return null;
    const settledAt = number(row.settled_at);
    if (!settledAt || Date.now() - settledAt > maxAgeMs) return null;
    return { card: JSON.parse(text(row.payload)) as T, settledAt };
  } catch {
    return null;
  }
}

export function writeStoredCard(input: {
  fixtureId: number;
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  summary: StoredDecisionSummary;
  payload: unknown;
  settledAt?: number;
}): void {
  const handle = db();
  if (!handle) return;
  try {
    handle
      .prepare(
        `INSERT INTO decision_cards (fixture_id, match_date, home_team, away_team, competition, summary, payload, settled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(fixture_id) DO UPDATE SET
           match_date = excluded.match_date,
           home_team = excluded.home_team,
           away_team = excluded.away_team,
           competition = excluded.competition,
           summary = excluded.summary,
           payload = excluded.payload,
           settled_at = excluded.settled_at`,
      )
      .run(
        input.fixtureId,
        input.matchDate,
        input.homeTeam,
        input.awayTeam,
        input.competition,
        JSON.stringify(input.summary),
        JSON.stringify(input.payload),
        input.settledAt ?? Date.now(),
      );
  } catch {
    // Keeping the card is a nicety; settling it is the job.
  }
}

/** Every card already settled for a date — what a page needs to come back to. */
export function listStoredCards(date: string, maxAgeMs = DECISION_STORED_TTL_MS): StoredDecisionCard[] {
  const handle = db();
  if (!handle) return [];
  try {
    const rows = handle
      .prepare(
        `SELECT fixture_id, match_date, home_team, away_team, competition, summary, payload, settled_at
         FROM decision_cards WHERE match_date = ? AND settled_at >= ? ORDER BY settled_at ASC`,
      )
      .all(date, Date.now() - maxAgeMs) as StoredRow[];
    return rows.flatMap<StoredDecisionCard>((row) => {
      try {
        return [
          {
            fixtureId: number(row.fixture_id),
            matchDate: text(row.match_date),
            homeTeam: text(row.home_team),
            awayTeam: text(row.away_team),
            competition: text(row.competition),
            settledAt: number(row.settled_at),
            summary: JSON.parse(text(row.summary)) as StoredDecisionSummary,
          },
        ];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
