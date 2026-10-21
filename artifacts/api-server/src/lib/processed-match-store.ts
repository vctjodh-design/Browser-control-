import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FootballMatchDetails,
  FootballMatchLastFive,
  FootballMatchTmpContext,
  FootballProcessedMatchSummary,
  FootballTesterMatchSummary,
  FootballProcessingJob,
  FootballProcessingJobStatus,
  FootballModelTrainingInput,
  FootballModelTrainingRun,
  FootballModelTrainingStatus,
  FootballModelType,
} from "@workspace/api-zod";

type SqlRow = Record<string, SQLOutputValue>;
type ProcessingDataset = "archive" | "tester";
const SUMMARY_COLUMNS = `fixture_id, match_date, competition, league_id, season,
  home_team_name, away_team_name, home_score, away_score, actual_outcome,
  total_goals, league_average_goals, league_average_matches, average_source,
  completeness, issue_count, processed_at`;
const TESTER_SUMMARY_COLUMNS = `fixture_id, match_date, competition, league_id, season,
  home_team_name, away_team_name, league_average_goals, league_average_matches,
  average_source, completeness, issue_count, processed_at`;

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
    updated_at TEXT NOT NULL,
    target_dataset TEXT NOT NULL DEFAULT 'archive'
      CHECK (target_dataset IN ('archive', 'tester'))
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

  CREATE TABLE IF NOT EXISTS tester_matches (
    fixture_id INTEGER PRIMARY KEY,
    calendar_date TEXT NOT NULL,
    match_date TEXT NOT NULL,
    competition TEXT NOT NULL,
    league_id INTEGER,
    season INTEGER,
    home_team_name TEXT NOT NULL,
    away_team_name TEXT NOT NULL,
    league_average_goals REAL,
    league_average_matches INTEGER,
    average_source TEXT NOT NULL CHECK (average_source IN ('season-standings-at-processing-time', 'unavailable')),
    completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'partial')),
    issue_count INTEGER NOT NULL DEFAULT 0,
    processed_at TEXT NOT NULL,
    prematch_json TEXT NOT NULL,
    last_five_json TEXT NOT NULL,
    tmp_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS tester_matches_calendar_date
    ON tester_matches(calendar_date, match_date DESC);
  CREATE INDEX IF NOT EXISTS tester_matches_competition
    ON tester_matches(competition, match_date DESC);

  CREATE TABLE IF NOT EXISTS model_training_runs (
    id TEXT PRIMARY KEY,
    model_type TEXT NOT NULL CHECK (model_type IN ('lstm', 'gru', 'transformer', 'gnn', 'dynamic-graph')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'training', 'completed', 'failed')),
    epochs INTEGER NOT NULL,
    completed_epochs INTEGER NOT NULL DEFAULT 0,
    sequence_length INTEGER NOT NULL,
    hidden_units INTEGER NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    training_sample_count INTEGER NOT NULL DEFAULT 0,
    validation_sample_count INTEGER NOT NULL DEFAULT 0,
    verified_odds_fixture_count INTEGER NOT NULL DEFAULT 0,
    accuracy REAL,
    baseline_accuracy REAL,
    log_loss REAL,
    brier_score REAL,
    confusion_json TEXT NOT NULL DEFAULT '[[0,0,0],[0,0,0],[0,0,0]]',
    training_loss_json TEXT NOT NULL DEFAULT '[]',
    validation_loss_json TEXT NOT NULL DEFAULT '[]',
    weights_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS model_training_runs_created
    ON model_training_runs(created_at DESC);

  CREATE TABLE IF NOT EXISTS model_training_match_index (
    fixture_id INTEGER PRIMARY KEY,
    calendar_date TEXT NOT NULL,
    match_date TEXT NOT NULL,
    competition TEXT NOT NULL,
    season INTEGER,
    home_team_name TEXT NOT NULL,
    away_team_name TEXT NOT NULL,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    odds_history_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS model_training_match_index_date
    ON model_training_match_index(calendar_date, match_date, fixture_id);

  CREATE TABLE IF NOT EXISTS model_training_index_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
  );
`);

const jobColumns = database
  .prepare("PRAGMA table_info(bulk_processing_jobs)")
  .all() as SqlRow[];
if (!jobColumns.some((column) => column.name === "target_dataset")) {
  database.exec(`
    ALTER TABLE bulk_processing_jobs
    ADD COLUMN target_dataset TEXT NOT NULL DEFAULT 'archive'
    CHECK (target_dataset IN ('archive', 'tester'));
  `);
}
database.exec(`
  CREATE INDEX IF NOT EXISTS bulk_processing_jobs_dataset_date_created
    ON bulk_processing_jobs(target_dataset, match_date, created_at DESC);
`);

database
  .prepare(
    `UPDATE bulk_processing_jobs
     SET status = 'failed',
         error = 'Processing stopped when the API server restarted. Resume this date to continue with fixtures not already saved.',
         updated_at = ?
     WHERE status IN ('queued', 'running')`,
  )
  .run(new Date().toISOString());
database
  .prepare(
    `UPDATE bulk_processing_jobs
     SET error = 'Processing stopped when the API server restarted. Resume this date to continue with fixtures not already saved.'
     WHERE status = 'failed'
       AND error = 'Processing stopped when the API server restarted. Start the date again to retry.'`,
  )
  .run();
database
  .prepare(
    `UPDATE model_training_runs
     SET status = 'failed',
         error = 'Training was interrupted when the API server restarted. Start a new run to continue.',
         updated_at = ?
     WHERE status IN ('queued', 'training')`,
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

const VERIFIED_ODDS_HISTORY_SQL = `COALESCE(
  (
    SELECT json_group_array(json_object(
      'fixtureId', json_extract(q.value, '$.fixtureId'),
      'homeProbability', json_extract(q.value, '$.homeProbability'),
      'drawProbability', json_extract(q.value, '$.drawProbability'),
      'awayProbability', json_extract(q.value, '$.awayProbability'),
      'verifiedBookmakerCount', json_extract(q.value, '$.verifiedBookmakerCount'),
      'quoteSource', json_extract(q.value, '$.quoteSource')
    ))
    FROM json_each(processed_matches.tmp_json, '$.oddsHistory') AS q
    WHERE json_extract(q.value, '$.quoteSource') = 'verified'
      AND json_type(q.value, '$.fixtureId') = 'integer'
      AND json_type(q.value, '$.verifiedBookmakerCount') = 'integer'
      AND json_extract(q.value, '$.verifiedBookmakerCount') > 0
      AND json_type(q.value, '$.homeProbability') IN ('integer', 'real')
      AND json_type(q.value, '$.drawProbability') IN ('integer', 'real')
      AND json_type(q.value, '$.awayProbability') IN ('integer', 'real')
      AND json_extract(q.value, '$.homeProbability') >= 0
      AND json_extract(q.value, '$.drawProbability') >= 0
      AND json_extract(q.value, '$.awayProbability') >= 0
      AND (
        json_extract(q.value, '$.homeProbability') +
        json_extract(q.value, '$.drawProbability') +
        json_extract(q.value, '$.awayProbability')
      ) BETWEEN 0.98 AND 1.02
  ),
  '[]'
)`;

let modelTrainingIndexReady = false;

function ensureModelTrainingMatchIndex(): void {
  if (modelTrainingIndexReady) return;
  const state = database
    .prepare("SELECT version FROM model_training_index_state WHERE id = 1")
    .get() as SqlRow | undefined;
  if (numberValue(state?.version ?? 0) < 1) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec("DELETE FROM model_training_match_index");
      database.prepare(
        `INSERT INTO model_training_match_index (
           fixture_id, calendar_date, match_date, competition, season,
           home_team_name, away_team_name, home_score, away_score,
           odds_history_json
         )
         SELECT fixture_id, calendar_date, match_date, competition, season,
                home_team_name, away_team_name, home_score, away_score,
                ${VERIFIED_ODDS_HISTORY_SQL}
         FROM processed_matches
         WHERE home_score IS NOT NULL AND away_score IS NOT NULL
           AND actual_outcome IS NOT NULL`,
      ).run();
      database.prepare(
        `INSERT INTO model_training_index_state (id, version) VALUES (1, 1)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version`,
      ).run();
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  modelTrainingIndexReady = true;
}

function compactVerifiedOddsHistory(
  quotes: FootballMatchTmpContext["oddsHistory"],
): string {
  return JSON.stringify(
    quotes
      .filter((quote) => {
        const probabilities = [
          quote.homeProbability,
          quote.drawProbability,
          quote.awayProbability,
        ];
        if (
          !Number.isSafeInteger(quote.fixtureId) ||
          quote.quoteSource !== "verified" ||
          typeof quote.verifiedBookmakerCount !== "number" ||
          quote.verifiedBookmakerCount <= 0 ||
          probabilities.some(
            (value) =>
              typeof value !== "number" ||
              !Number.isFinite(value) ||
              value < 0,
          )
        ) {
          return false;
        }
        const total = (probabilities as number[]).reduce(
          (sum, value) => sum + value,
          0,
        );
        return total >= 0.98 && total <= 1.02;
      })
      .map((quote) => ({
        fixtureId: quote.fixtureId,
        homeProbability: quote.homeProbability,
        drawProbability: quote.drawProbability,
        awayProbability: quote.awayProbability,
        verifiedBookmakerCount: quote.verifiedBookmakerCount,
        quoteSource: quote.quoteSource,
      })),
  );
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

function testerSummaryFromRow(row: SqlRow): FootballTesterMatchSummary {
  return {
    fixtureId: numberValue(row.fixture_id),
    date: new Date(stringValue(row.match_date)),
    competition: stringValue(row.competition),
    leagueId: nullableNumber(row.league_id),
    season: nullableNumber(row.season),
    homeTeamName: stringValue(row.home_team_name),
    awayTeamName: stringValue(row.away_team_name),
    leagueAverageGoals: nullableNumber(row.league_average_goals),
    leagueAverageMatches: nullableNumber(row.league_average_matches),
    averageSource: stringValue(row.average_source) as FootballTesterMatchSummary["averageSource"],
    completeness: stringValue(row.completeness) as FootballTesterMatchSummary["completeness"],
    issueCount: numberValue(row.issue_count),
    processedAt: new Date(stringValue(row.processed_at)),
  };
}

export function createProcessingJob(
  date: string,
  totalFixtures: number,
  targetDataset: ProcessingDataset = "archive",
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
        created_at, updated_at, target_dataset
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      targetDataset,
    );
  return job;
}

export function findActiveProcessingJob(
  date: string,
  targetDataset: ProcessingDataset = "archive",
): FootballProcessingJob | null {
  const row = database
    .prepare(
      `SELECT * FROM bulk_processing_jobs
       WHERE match_date = ? AND target_dataset = ?
         AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(date, targetDataset) as SqlRow | undefined;
  return toJob(row);
}

export function getLatestProcessingJob(
  date: string,
  targetDataset: ProcessingDataset = "archive",
): FootballProcessingJob | null {
  const row = database
    .prepare(
      `SELECT * FROM bulk_processing_jobs
       WHERE match_date = ? AND target_dataset = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(date, targetDataset) as SqlRow | undefined;
  return toJob(row);
}

export function findAnyActiveProcessingJob(
  targetDataset?: ProcessingDataset,
): FootballProcessingJob | null {
  const row = (targetDataset
    ? database
        .prepare(
          `SELECT * FROM bulk_processing_jobs
           WHERE target_dataset = ? AND status IN ('queued', 'running')
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(targetDataset)
    : database
        .prepare(
          `SELECT * FROM bulk_processing_jobs
           WHERE status IN ('queued', 'running')
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get()) as SqlRow | undefined;
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

export function listProcessedFixtureIds(
  calendarDate: string,
  targetDataset: ProcessingDataset,
): number[] {
  const table = targetDataset === "tester" ? "tester_matches" : "processed_matches";
  const rows = database
    .prepare(`SELECT fixture_id FROM ${table} WHERE calendar_date = ?`)
    .all(calendarDate) as SqlRow[];
  return rows.map((row) => numberValue(row.fixture_id));
}

export type ModelTrainingMatch = {
  fixtureId: number;
  calendarDate: string;
  matchDate: string;
  competition: string;
  season: number | null;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  tmpJson: string;
};

function storedJson<T>(value: SQLOutputValue, fallback: T): T {
  try {
    return JSON.parse(stringValue(value)) as T;
  } catch {
    return fallback;
  }
}

function correctedLegacyBaselineAccuracy(
  trainingSampleCount: number,
  validationSampleCount: number,
): number | null {
  if (trainingSampleCount < 1 || validationSampleCount < 1) return null;
  ensureModelTrainingMatchIndex();
  const sampleCount = trainingSampleCount + validationSampleCount;
  const rows = database
    .prepare(
      `SELECT home_score, away_score FROM (
         SELECT home_score, away_score, calendar_date, match_date, fixture_id
         FROM model_training_match_index
         ORDER BY calendar_date DESC, match_date DESC, fixture_id DESC
         LIMIT ?
       )
       ORDER BY calendar_date ASC, match_date ASC, fixture_id ASC`,
    )
    .all(sampleCount) as SqlRow[];
  if (rows.length <= trainingSampleCount) return null;
  const labels = rows.map((match) => {
    const home = numberValue(match.home_score);
    const away = numberValue(match.away_score);
    return home > away ? 0 : home === away ? 1 : 2;
  });
  const trainingLabels = labels.slice(0, trainingSampleCount);
  const classCounts = [0, 0, 0];
  for (const label of trainingLabels) classCounts[label] += 1;
  const majorityLabel = classCounts.indexOf(Math.max(...classCounts));
  const validationLabels = labels.slice(trainingSampleCount);
  return validationLabels.filter((label) => label === majorityLabel).length /
    validationLabels.length;
}

function modelTrainingRunFromRow(row: SqlRow): FootballModelTrainingRun {
  const storedBaselineAccuracy = nullableNumber(row.baseline_accuracy);
  const baselineAccuracy =
    storedBaselineAccuracy !== null && storedBaselineAccuracy > 1
      ? correctedLegacyBaselineAccuracy(
          numberValue(row.training_sample_count),
          numberValue(row.validation_sample_count),
        )
      : storedBaselineAccuracy;
  return {
    id: stringValue(row.id),
    modelType: stringValue(row.model_type) as FootballModelType,
    status: stringValue(row.status) as FootballModelTrainingStatus,
    epochs: numberValue(row.epochs),
    completedEpochs: numberValue(row.completed_epochs),
    sequenceLength: numberValue(row.sequence_length),
    hiddenUnits: numberValue(row.hidden_units),
    sampleCount: numberValue(row.sample_count),
    trainingSampleCount: numberValue(row.training_sample_count),
    validationSampleCount: numberValue(row.validation_sample_count),
    verifiedOddsFixtureCount: numberValue(row.verified_odds_fixture_count),
    accuracy: nullableNumber(row.accuracy),
    baselineAccuracy,
    logLoss: nullableNumber(row.log_loss),
    brierScore: nullableNumber(row.brier_score),
    confusionMatrix: storedJson<number[][]>(row.confusion_json, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]),
    trainingLoss: storedJson<number[]>(row.training_loss_json, []),
    validationLoss: storedJson<number[]>(row.validation_loss_json, []),
    hasSavedWeights: nullableString(row.weights_json) !== null,
    error: nullableString(row.error),
    createdAt: new Date(stringValue(row.created_at)),
    updatedAt: new Date(stringValue(row.updated_at)),
  };
}

export function listModelTrainingMatches(limit = 10_000): ModelTrainingMatch[] {
  ensureModelTrainingMatchIndex();
  const safeLimit = Math.min(10_000, Math.max(1, Math.trunc(limit)));
  const rows = database
    .prepare(
      `SELECT fixture_id, calendar_date, match_date, competition, season,
              home_team_name, away_team_name, home_score, away_score,
              odds_history_json
       FROM (
         SELECT fixture_id, calendar_date, match_date, competition, season,
                home_team_name, away_team_name, home_score, away_score,
                odds_history_json
         FROM model_training_match_index
         ORDER BY calendar_date DESC, match_date DESC, fixture_id DESC
         LIMIT ?
       )
       ORDER BY calendar_date ASC, match_date ASC, fixture_id ASC`,
    )
    .all(safeLimit) as SqlRow[];
  return rows.map((row) => ({
    fixtureId: numberValue(row.fixture_id),
    calendarDate: stringValue(row.calendar_date),
    matchDate: stringValue(row.match_date),
    competition: stringValue(row.competition),
    season: nullableNumber(row.season),
    homeTeamName: stringValue(row.home_team_name),
    awayTeamName: stringValue(row.away_team_name),
    homeScore: numberValue(row.home_score),
    awayScore: numberValue(row.away_score),
    tmpJson: `{"oddsHistory":${stringValue(row.odds_history_json)}}`,
  }));
}

export function listModelTrainingRuns(limit = 10): FootballModelTrainingRun[] {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const rows = database
    .prepare(
      "SELECT * FROM model_training_runs ORDER BY created_at DESC LIMIT ?",
    )
    .all(safeLimit) as SqlRow[];
  return rows.map(modelTrainingRunFromRow);
}

export function getModelTrainingRun(id: string): FootballModelTrainingRun | null {
  const row = database
    .prepare("SELECT * FROM model_training_runs WHERE id = ?")
    .get(id) as SqlRow | undefined;
  return row ? modelTrainingRunFromRow(row) : null;
}

export function findActiveModelTrainingRun(): FootballModelTrainingRun | null {
  const row = database
    .prepare(
      `SELECT * FROM model_training_runs
       WHERE status IN ('queued', 'training')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as SqlRow | undefined;
  return row ? modelTrainingRunFromRow(row) : null;
}

export function createModelTrainingRun(
  input: FootballModelTrainingInput,
  sampleCount: number,
): FootballModelTrainingRun {
  const now = new Date().toISOString();
  const run: FootballModelTrainingRun = {
    id: randomUUID(),
    modelType: input.modelType,
    status: "queued",
    epochs: input.epochs ?? 24,
    completedEpochs: 0,
    sequenceLength: input.sequenceLength ?? 10,
    hiddenUnits: input.hiddenUnits ?? 16,
    sampleCount,
    trainingSampleCount: 0,
    validationSampleCount: 0,
    verifiedOddsFixtureCount: 0,
    accuracy: null,
    baselineAccuracy: null,
    logLoss: null,
    brierScore: null,
    confusionMatrix: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    trainingLoss: [],
    validationLoss: [],
    hasSavedWeights: false,
    error: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  database
    .prepare(
      `INSERT INTO model_training_runs (
        id, model_type, status, epochs, completed_epochs, sequence_length,
        hidden_units, sample_count, training_sample_count, validation_sample_count,
        verified_odds_fixture_count, accuracy, baseline_accuracy, log_loss,
        brier_score, confusion_json, training_loss_json, validation_loss_json,
        weights_json, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.modelType,
      run.status,
      run.epochs,
      run.completedEpochs,
      run.sequenceLength,
      run.hiddenUnits,
      run.sampleCount,
      run.trainingSampleCount,
      run.validationSampleCount,
      run.verifiedOddsFixtureCount,
      run.accuracy,
      run.baselineAccuracy,
      run.logLoss,
      run.brierScore,
      JSON.stringify(run.confusionMatrix),
      JSON.stringify(run.trainingLoss),
      JSON.stringify(run.validationLoss),
      null,
      run.error,
      now,
      now,
    );
  return run;
}

type ModelTrainingRunUpdate = Pick<
  FootballModelTrainingRun,
  | "status"
  | "completedEpochs"
  | "sampleCount"
  | "trainingSampleCount"
  | "validationSampleCount"
  | "verifiedOddsFixtureCount"
  | "accuracy"
  | "baselineAccuracy"
  | "logLoss"
  | "brierScore"
  | "confusionMatrix"
  | "trainingLoss"
  | "validationLoss"
  | "error"
>;

export function updateModelTrainingRun(
  id: string,
  update: ModelTrainingRunUpdate,
  weightsJson?: string | null,
): FootballModelTrainingRun | null {
  const updatedAt = new Date().toISOString();
  database
    .prepare(
      `UPDATE model_training_runs
       SET status = ?, completed_epochs = ?, sample_count = ?,
           training_sample_count = ?, validation_sample_count = ?,
           verified_odds_fixture_count = ?, accuracy = ?, baseline_accuracy = ?,
           log_loss = ?, brier_score = ?, confusion_json = ?,
           training_loss_json = ?, validation_loss_json = ?, error = ?,
           weights_json = COALESCE(?, weights_json), updated_at = ?
       WHERE id = ?`,
    )
    .run(
      update.status,
      update.completedEpochs,
      update.sampleCount,
      update.trainingSampleCount,
      update.validationSampleCount,
      update.verifiedOddsFixtureCount,
      update.accuracy,
      update.baselineAccuracy,
      update.logLoss,
      update.brierScore,
      JSON.stringify(update.confusionMatrix),
      JSON.stringify(update.trainingLoss),
      JSON.stringify(update.validationLoss),
      update.error,
      weightsJson === undefined ? null : weightsJson,
      updatedAt,
      id,
    );
  return getModelTrainingRun(id);
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
  if (
    summary.homeScore !== null &&
    summary.awayScore !== null &&
    summary.actualOutcome !== null
  ) {
    database
      .prepare(
        `INSERT INTO model_training_match_index (
           fixture_id, calendar_date, match_date, competition, season,
           home_team_name, away_team_name, home_score, away_score,
           odds_history_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(fixture_id) DO UPDATE SET
           calendar_date = excluded.calendar_date,
           match_date = excluded.match_date,
           competition = excluded.competition,
           season = excluded.season,
           home_team_name = excluded.home_team_name,
           away_team_name = excluded.away_team_name,
           home_score = excluded.home_score,
           away_score = excluded.away_score,
           odds_history_json = excluded.odds_history_json`,
      )
      .run(
        summary.fixtureId,
        calendarDate,
        summary.date.toISOString(),
        summary.competition,
        summary.season,
        summary.homeTeamName,
        summary.awayTeamName,
        summary.homeScore,
        summary.awayScore,
        compactVerifiedOddsHistory(payloads.tmp.oddsHistory),
      );
  } else {
    database
      .prepare("DELETE FROM model_training_match_index WHERE fixture_id = ?")
      .run(summary.fixtureId);
  }
}

export function saveTesterMatch(
  calendarDate: string,
  summary: FootballTesterMatchSummary,
  payloads: {
    prematch: Record<string, unknown>;
    lastFive: FootballMatchLastFive;
    tmp: FootballMatchTmpContext;
  },
): void {
  database
    .prepare(
      `INSERT INTO tester_matches (
        fixture_id, calendar_date, match_date, competition, league_id, season,
        home_team_name, away_team_name, league_average_goals,
        league_average_matches, average_source, completeness, issue_count,
        processed_at, prematch_json, last_five_json, tmp_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fixture_id) DO UPDATE SET
        calendar_date = excluded.calendar_date,
        match_date = excluded.match_date,
        competition = excluded.competition,
        league_id = excluded.league_id,
        season = excluded.season,
        home_team_name = excluded.home_team_name,
        away_team_name = excluded.away_team_name,
        league_average_goals = excluded.league_average_goals,
        league_average_matches = excluded.league_average_matches,
        average_source = excluded.average_source,
        completeness = excluded.completeness,
        issue_count = excluded.issue_count,
        processed_at = excluded.processed_at,
        prematch_json = excluded.prematch_json,
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
      summary.leagueAverageGoals,
      summary.leagueAverageMatches,
      summary.averageSource,
      summary.completeness,
      summary.issueCount,
      summary.processedAt.toISOString(),
      JSON.stringify(payloads.prematch),
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
          `SELECT ${SUMMARY_COLUMNS} FROM processed_matches WHERE calendar_date = ?
           ORDER BY match_date DESC, fixture_id DESC LIMIT ? OFFSET ?`,
        )
        .all(input.date, input.limit, input.offset)
    : database
        .prepare(
          `SELECT ${SUMMARY_COLUMNS} FROM processed_matches
           ORDER BY match_date DESC, fixture_id DESC LIMIT ? OFFSET ?`,
        )
        .all(input.limit, input.offset)) as SqlRow[];
  return {
    matches: rows.map(summaryFromRow),
    total: numberValue(countRow?.total ?? 0),
  };
}

export function getProcessedMatchSummary(
  fixtureId: number,
): FootballProcessedMatchSummary | null {
  const row = database
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM processed_matches WHERE fixture_id = ?`,
    )
    .get(fixtureId) as SqlRow | undefined;
  if (!row) return null;

  return summaryFromRow(row);
}

export function getProcessedMatchPayload(
  fixtureId: number,
  section: "details" | "lastFive" | "tmp",
): unknown | null {
  const row = database
    .prepare(
      `SELECT details_json, last_five_json, tmp_json
       FROM processed_matches WHERE fixture_id = ?`,
    )
    .get(fixtureId) as SqlRow | undefined;
  if (!row) return null;
  const column = {
    details: row.details_json,
    lastFive: row.last_five_json,
    tmp: row.tmp_json,
  }[section];
  return JSON.parse(stringValue(column));
}

export function deleteAllProcessedMatches(): number {
  const result = database.prepare("DELETE FROM processed_matches").run();
  database.prepare("DELETE FROM model_training_match_index").run();
  return Number(result.changes);
}

export function listTesterMatches(input: {
  date?: string;
  limit: number;
  offset: number;
}): { matches: FootballTesterMatchSummary[]; total: number } {
  const countRow = (input.date
    ? database
        .prepare(
          "SELECT COUNT(*) AS total FROM tester_matches WHERE calendar_date = ?",
        )
        .get(input.date)
    : database.prepare("SELECT COUNT(*) AS total FROM tester_matches").get()) as
    | SqlRow
    | undefined;
  const rows = (input.date
    ? database
        .prepare(
          `SELECT ${TESTER_SUMMARY_COLUMNS} FROM tester_matches
           WHERE calendar_date = ?
           ORDER BY match_date DESC, fixture_id DESC LIMIT ? OFFSET ?`,
        )
        .all(input.date, input.limit, input.offset)
    : database
        .prepare(
          `SELECT ${TESTER_SUMMARY_COLUMNS} FROM tester_matches
           ORDER BY match_date DESC, fixture_id DESC LIMIT ? OFFSET ?`,
        )
        .all(input.limit, input.offset)) as SqlRow[];
  return {
    matches: rows.map(testerSummaryFromRow),
    total: numberValue(countRow?.total ?? 0),
  };
}

export function getTesterMatchSummary(
  fixtureId: number,
): FootballTesterMatchSummary | null {
  const row = database
    .prepare(
      `SELECT ${TESTER_SUMMARY_COLUMNS} FROM tester_matches WHERE fixture_id = ?`,
    )
    .get(fixtureId) as SqlRow | undefined;
  return row ? testerSummaryFromRow(row) : null;
}

export function getTesterMatchPayload(
  fixtureId: number,
  section: "details" | "lastFive" | "tmp",
): unknown | null {
  const row = database
    .prepare(
      `SELECT prematch_json, last_five_json, tmp_json
       FROM tester_matches WHERE fixture_id = ?`,
    )
    .get(fixtureId) as SqlRow | undefined;
  if (!row) return null;
  const column = {
    details: row.prematch_json,
    lastFive: row.last_five_json,
    tmp: row.tmp_json,
  }[section];
  return JSON.parse(stringValue(column));
}

export function deleteAllTesterMatches(): number {
  const result = database.prepare("DELETE FROM tester_matches").run();
  return Number(result.changes);
}
