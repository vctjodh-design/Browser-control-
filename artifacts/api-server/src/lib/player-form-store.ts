// What each footballer actually did in the matches he played, kept between
// requests so a fixture only pays for the matches it has not read yet.
//
// One row per (player, match): the rating the source gave him, his minutes and
// the whole stat block, plus the coordinates of his shots and his heat map.
// The archive is the same SQLite file the processed-match store uses, so the
// app keeps one database on the volume rather than two.
import { mkdirSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const databasePath =
  process.env.PROCESSED_MATCH_DB_PATH ??
  resolve(moduleDirectory, "../data/processed-matches.sqlite");

let database: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (database) return database;
  mkdirSync(dirname(databasePath), { recursive: true });
  const opened = new DatabaseSync(databasePath);
  opened.exec(`
    CREATE TABLE IF NOT EXISTS player_match_form (
      player_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      team_name TEXT NOT NULL,
      name TEXT NOT NULL,
      match_date TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 0,
      rating REAL,
      stats_json TEXT NOT NULL DEFAULT '{}',
      shots_json TEXT NOT NULL DEFAULT '[]',
      heat_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (player_id, match_id)
    );
    CREATE INDEX IF NOT EXISTS player_match_form_player
      ON player_match_form (player_id, match_date DESC);
    CREATE TABLE IF NOT EXISTS player_availability (
      team_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      expected_return TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (team_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS fixture_form_source (
      fixture_id INTEGER PRIMARY KEY,
      source_match_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `);
  database = opened;
  return opened;
}

/** A shot, in the source's own 0..100 pitch coordinates plus its xG. */
export type StoredShot = {
  minute: number | null;
  x: number;
  y: number;
  expectedGoals: number | null;
  expectedGoalsOnTarget: number | null;
  onTarget: boolean;
  blocked: boolean;
  insideBox: boolean;
  situation: string | null;
  bodyPart: string | null;
  outcome: string;
};

/** One heat-map point, in metres-ish pitch units (105 x 68). */
export type StoredHeatPoint = { x: number; y: number; intensity: number };

export type StoredPerformance = {
  playerId: number;
  matchId: number;
  teamId: number;
  teamName: string;
  name: string;
  date: string;
  minutes: number;
  rating: number | null;
  stats: Record<string, number | null>;
  shots: StoredShot[];
  heat: StoredHeatPoint[];
};

export type StoredAvailability = {
  teamId: number;
  playerId: number;
  name: string;
  kind: "injury" | "suspension" | "other";
  expectedReturn: string | null;
};

function text(value: SQLOutputValue | undefined): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function number(value: SQLOutputValue | undefined): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function parseJson<T>(value: SQLOutputValue | undefined, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function savePerformances(performances: StoredPerformance[]): void {
  if (!performances.length) return;
  const store = db();
  const statement = store.prepare(`
    INSERT INTO player_match_form
      (player_id, match_id, team_id, team_name, name, match_date, minutes,
       rating, stats_json, shots_json, heat_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (player_id, match_id) DO UPDATE SET
      name = excluded.name,
      team_name = excluded.team_name,
      match_date = excluded.match_date,
      minutes = excluded.minutes,
      rating = excluded.rating,
      stats_json = excluded.stats_json,
      shots_json = excluded.shots_json,
      heat_json = CASE
        WHEN excluded.heat_json = '[]' THEN player_match_form.heat_json
        ELSE excluded.heat_json
      END,
      updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  store.exec("BEGIN");
  try {
    for (const row of performances) {
      statement.run(
        row.playerId,
        row.matchId,
        row.teamId,
        row.teamName,
        row.name,
        row.date,
        row.minutes,
        row.rating,
        JSON.stringify(row.stats),
        JSON.stringify(row.shots),
        JSON.stringify(row.heat),
        now,
      );
    }
    store.exec("COMMIT");
  } catch (error) {
    store.exec("ROLLBACK");
    throw error;
  }
}

/** Newest first, which is the order the weighting reads. */
export function readPlayerPerformances(playerId: number, limit = 40): StoredPerformance[] {
  const rows = db()
    .prepare(
      `SELECT player_id, match_id, team_id, team_name, name, match_date, minutes,
              rating, stats_json, shots_json, heat_json
         FROM player_match_form
        WHERE player_id = ?
        ORDER BY match_date DESC
        LIMIT ?`,
    )
    .all(playerId, limit);

  return rows.map((row) => ({
    playerId: number(row.player_id),
    matchId: number(row.match_id),
    teamId: number(row.team_id),
    teamName: text(row.team_name),
    name: text(row.name),
    date: text(row.match_date),
    minutes: number(row.minutes),
    rating: row.rating === null ? null : number(row.rating),
    stats: parseJson<Record<string, number | null>>(row.stats_json, {}),
    shots: parseJson<StoredShot[]>(row.shots_json, []),
    heat: parseJson<StoredHeatPoint[]>(row.heat_json, []),
  }));
}

/** Which matches have already been read, so a repeat costs no requests. */
export function readStoredMatches(matchIds: number[]): Set<number> {
  if (!matchIds.length) return new Set();
  const placeholders = matchIds.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT DISTINCT match_id FROM player_match_form WHERE match_id IN (${placeholders})`,
    )
    .all(...matchIds);
  return new Set(rows.map((row) => number(row.match_id)));
}

export function saveAvailability(rows: StoredAvailability[]): void {
  const store = db();
  const statement = store.prepare(`
    INSERT INTO player_availability
      (team_id, player_id, name, kind, expected_return, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (team_id, player_id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      expected_return = excluded.expected_return,
      updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  for (const row of rows) {
    statement.run(row.teamId, row.playerId, row.name, row.kind, row.expectedReturn, now);
  }
}

export function readAvailability(teamId: number, freshAfterMs = 1000 * 60 * 30): StoredAvailability[] {
  const cutoff = new Date(Date.now() - freshAfterMs).toISOString();
  const rows = db()
    .prepare(
      `SELECT team_id, player_id, name, kind, expected_return
         FROM player_availability
        WHERE team_id = ? AND updated_at >= ?`,
    )
    .all(teamId, cutoff);
  return rows.map((row) => ({
    teamId: number(row.team_id),
    playerId: number(row.player_id),
    name: text(row.name),
    kind: text(row.kind) === "suspension" ? "suspension" : text(row.kind) === "injury" ? "injury" : "other",
    expectedReturn: row.expected_return === null ? null : text(row.expected_return),
  }));
}

export function saveFixtureSource(fixtureId: number, matchId: number, source: string): void {
  db()
    .prepare(
      `INSERT INTO fixture_form_source (fixture_id, source_match_id, source, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (fixture_id) DO UPDATE SET
         source_match_id = excluded.source_match_id,
         source = excluded.source,
         fetched_at = excluded.fetched_at`,
    )
    .run(fixtureId, matchId, source, new Date().toISOString());
}

export function readFixtureSource(
  fixtureId: number,
  freshAfterMs = 1000 * 60 * 60 * 12,
): { matchId: number; source: string; fetchedAt: string } | null {
  const row = db()
    .prepare(
      `SELECT source_match_id, source, fetched_at FROM fixture_form_source WHERE fixture_id = ?`,
    )
    .get(fixtureId);
  if (!row) return null;
  const fetchedAt = text(row.fetched_at);
  if (Date.now() - new Date(fetchedAt).getTime() > freshAfterMs) return null;
  return { matchId: number(row.source_match_id), source: text(row.source), fetchedAt };
}
