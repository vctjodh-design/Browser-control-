import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FootballMatchDetails,
  FootballMatchLastFive,
  FootballMatchTmpContext,
  FootballProcessedMatchRecord,
  FootballProcessedMatchSummary,
  FootballProcessingJob,
  FootballProcessingJobStatus,
} from "@workspace/api-zod";

type SqlRow = Record<string, SQLOutputValue>;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const databasePath =
  process.env.PROCESSED_MATCH_DB_PATH ??
  resolve(moduleDirectory, "../data/processed-matches.sqlite");

mkdirSync(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS bulk_processing_jobs (
    id TEXT PRIMARY KEY,
    match_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
    total_fixtures INTEGER NOT NULL DEFAULT 0,
    processed_fixtures INTEGER NOT NULL DEFAULT 0,
    saved_fixtures INTEGER NOT NULL DEFAULT 0,
    skipped_fixtures INTEGER NOT NULL DEFAULT 0,
    failed_fixtures INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS bulk_processing_jobs_date_created
    ON bulk_processing_jobs(match_date, created_at DESC);

  CREATE TABLE IF NOT EXISTS processed_matches (
    fixture_id INTEGER PRIMARY KEY,
    calendar_date TEXT NOT NULL,
    match_date TEXT NOT NULL,
    competition TEXT NOT NULL,
    league_id INTEGER,
    season INTEGER,
    home_team_name TEXT NOT NULL,
    away_team_name TEXT NOT NULL,
    home_score INTEGER,
    away_score INTEGER,
    actual_outcome TEXT CHECK (actual_outcome IN ('home', 'draw', 'away') OR actual_outcome IS NULL),
    total_goals INTEGER,
    league_average_goals REAL,
    league_average_matches INTEGER,
    average_source TEXT NOT NULL CHECK (average_source IN ('season-standings-at-processing-time', 'unavailable')),
    completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'partial')),
    issue_count INTEGER NOT NULL DEFAULT 0,
    processed_at TEXT NOT NULL,
    details_json TEXT NOT NULL,
    last_five_json TEXT NOT NULL,
    tmp_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS processed_matches_calendar_date
    ON processed_matches(calendar_date, match_date DESC);
  CREATE INDEX IF NOT EXISTS processed_matches_competition
    ON processed_matches(competition, match_date DESC);
`);

database
  .prepare(
    `UPDATE bulk_processing_jobs
     SET status = 'failed',
         error = 'Processing stopped when the API server restarted. Start the date again to retry.',
         updated_at = ?
     WHERE status IN ('queued', 'running')`,
  )
  .run(new Date().toISOString());

function numberValue(value: SQLOutputValue): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function stringValue(value: SQLOutputValue): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableNumber(value: SQLOutputValue): number | null {
  return value === null ? null : numberValue(value);
}

function nullableString(value: SQLOutputValue): string | null {
  return value === null ? null : stringValue(value);
}

function toJob(row: SqlRow | undefined): FootballProcessingJob | null {
  if (!row) return null;
  return {
    id: stringValue(row.id),
    date: new Date(stringValue(row.match_date)),
    status: stringValue(row.status) as FootballProcessingJobStatus,
    totalFixtures: numberValue(row.total_fixtures),
    processedFixtures: numberValue(row.processed_fixtures),
    savedFixtures: numberValue(row.saved_fixtures),
    skippedFixtures: numberValue(row.skipped_fixtures),
    failedFixtures: numberValue(row.failed_fixtures),
    error: nullableString(row.error),
    createdAt: new Date(stringValue(row.created_at)),
    updatedAt: new Date(stringValue(row.updated_at)),
  };
}

function summaryFromRow(row: SqlRow): FootballProcessedMatchSummary {
  return {
    fixtureId: numberValue(row.fixture_id),
    date: new Date(stringValue(row.match_date)),
    competition: stringValue(row.competition),
    leagueId: nullableNumber(row.league_id),
    season: nullableNumber(row.season),
    homeTeamName: stringValue(row.home_team_name),
    awayTeamName: stringValue(row.away_team_name),
    homeScore: nullableNumber(row.home_score),
    awayScore: nullableNumber(row.away_score),
    actualOutcome: nullableString(row.actual_outcome) as FootballProcessedMatchSummary["actualOutcome"],
    totalGoals: nullableNumber(row.total_goals),
    leagueAverageGoals: nullableNumber(row.league_average_goals),
    leagueAverageMatches: nullableNumber(row.league_average_matches),
    averageSource: stringValue(row.average_source) as FootballProcessedMatchSummary["averageSource"],
    completeness: stringValue(row.completeness) as FootballProcessedMatchSummary["completeness"],
    issueCount: numberValue(row.issue_count),
    processedAt: new Date(stringValue(row.processed_at)),
  };
}

export function createProcessingJob(
  date: string,
  totalFixtures: number,
): FootballProcessingJob {
  const now = new Date().toISOString();
  const job: FootballProcessingJob = {
    id: randomUUID(),
    date: new Date(`${date}T00:00:00.000Z`),
    status: "queued",
    totalFixtures,
    processedFixtures: 0,
    savedFixtures: 0,
    skippedFixtures: 0,
    failedFixtures: 0,
    error: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  database
    .prepare(
      `INSERT INTO bulk_processing_jobs (
        id, match_date, status, total_fixtures, processed_fixtures,
        saved_fixtures, skipped_fixtures, failed_fixtures, error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      job.id,
      date,
      job.status,
      job.totalFixtures,
      job.processedFixtures,
      job.savedFixtures,
      job.skippedFixtures,
      job.failedFixtures,
      job.error,
      now,
      now,
    );
  return job;
}

export function findActiveProcessingJob(
  date: string,
): FootballProcessingJob | null {
  const row = database
    .prepare(
      `SELECT * FROM bulk_processing_jobs
       WHERE match_date = ? AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(date) as SqlRow | undefined;
  return toJob(row);
}

export function getProcessingJob(id: string): FootballProcessingJob | null {
  const row = database
    .prepare("SELECT * FROM bulk_processing_jobs WHERE id = ?")
    .get(id) as SqlRow | undefined;
  return toJob(row);
}

export function updateProcessingJob(
  id: string,
  update: Pick<
    FootballProcessingJob,
    | "status"
    | "processedFixtures"
    | "savedFixtures"
    | "skippedFixtures"
    | "failedFixtures"
    | "error"
  >,
): FootballProcessingJob | null {
  const updatedAt = new Date().toISOString();
  database
    .prepare(
      `UPDATE bulk_processing_jobs
       SET status = ?, processed_fixtures = ?, saved_fixtures = ?,
           skipped_fixtures = ?, failed_fixtures = ?, error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      update.status,
      update.processedFixtures,
      update.savedFixtures,
      update.skippedFixtures,
      update.failedFixtures,
      update.error,
      updatedAt,
      id,
    );
  return getProcessingJob(id);
}

export function saveProcessedMatch(
  calendarDate: string,
  summary: FootballProcessedMatchSummary,
  payloads: {
    details: FootballMatchDetails;
    lastFive: FootballMatchLastFive;
    tmp: FootballMatchTmpContext;
  },
): void {
  database
    .prepare(
      `INSERT INTO processed_matches (
        fixture_id, calendar_date, match_date, competition, league_id, season,
        home_team_name, away_team_name, home_score, away_score, actual_outcome,
        total_goals, league_average_goals, league_average_matches, average_source,
        completeness, issue_count, processed_at, details_json, last_five_json,
        tmp_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fixture_id) DO UPDATE SET
        calendar_date = excluded.calendar_date,
        match_date = excluded.match_date,
        competition = excluded.competition,
        league_id = excluded.league_id,
        season = excluded.season,
        home_team_name = excluded.home_team_name,
        away_team_name = excluded.away_team_name,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        actual_outcome = excluded.actual_outcome,
        total_goals = excluded.total_goals,
        league_average_goals = excluded.league_average_goals,
        league_average_matches = excluded.league_average_matches,
        average_source = excluded.average_source,
        completeness = excluded.completeness,
        issue_count = excluded.issue_count,
        processed_at = excluded.processed_at,
        details_json = excluded.details_json,
        last_five_json = excluded.last_five_json,
        tmp_json = excluded.tmp_json`,
    )
    .run(
      summary.fixtureId,
      calendarDate,
      summary.date.toISOString(),
      summary.competition,
      summary.leagueId,
      summary.season,
      summary.homeTeamName,
      summary.awayTeamName,
      summary.homeScore,
      summary.awayScore,
      summary.actualOutcome,
      summary.totalGoals,
      summary.leagueAverageGoals,
      summary.leagueAverageMatches,
      summary.averageSource,
      summary.completeness,
      summary.issueCount,
      summary.processedAt.toISOString(),
      JSON.stringify(payloads.details),
      JSON.stringify(payloads.lastFive),
      JSON.stringify(payloads.tmp),
    );
}

export function listProcessedMatches(input: {
  date?: string;
  limit: number;
  offset: number;
}): { matches: FootballProcessedMatchSummary[]; total: number } {
  const countRow = (input.date
    ? database
        .prepare(
          "SELECT COUNT(*) AS total FROM processed_matches WHERE calendar_date = ?",
        )
        .get(input.date)
    : database.prepare("SELECT COUNT(*) AS total FROM processed_matches").get()) as
    | SqlRow
    | undefined;
  const rows = (input.date
    ? database
        .prepare(
          `SELECT * FROM processed_matches WHERE calendar_date = ?
           ORDER BY match_date DESC, fixture_id DESC LIMIT ? OFFSET ?`,
        )
        .all(input.date, input.limit, input.offset)
    : database
        .prepare(
          `SELECT * FROM processed_matches
           ORDER BY match_date DESC, fixture_id DESC LIMIT ? OFFSET ?`,
        )
        .all(input.limit, input.offset)) as SqlRow[];
  return {
    matches: rows.map(summaryFromRow),
    total: numberValue(countRow?.total ?? 0),
  };
}

export function getProcessedMatch(
  fixtureId: number,
): FootballProcessedMatchRecord | null {
  const row = database
    .prepare("SELECT * FROM processed_matches WHERE fixture_id = ?")
    .get(fixtureId) as SqlRow | undefined;
  if (!row) return null;

  return {
    ...summaryFromRow(row),
    details: JSON.parse(stringValue(row.details_json)) as FootballMatchDetails,
    lastFive: JSON.parse(stringValue(row.last_five_json)) as FootballMatchLastFive,
    tmp: JSON.parse(stringValue(row.tmp_json)) as FootballMatchTmpContext,
  };
}
