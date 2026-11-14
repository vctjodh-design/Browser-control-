import { archiveDatabase } from './decision-store';
import { getKickoffScoreFixtures } from './kickoffscore-fixtures';
import type { HistoryMatch } from './team-shape';
import { normalizeTeamName } from './team-shape';

// Every finished match the app has seen, kept as bare facts: who, when, and the
// score. This is the backbone the rest of the analysis stands on — a team's shape
// is computed from these rows, never from "the most recent matches" asked for
// today, and a card's lines are marked against the same scores.
//
// The date is the fixture's own date. A window is always read as "before this
// kickoff", so ingesting a whole season today still cannot leak a result into a
// prediction made last month.

export type HistoryRecord = {
  fixtureId: number;
  matchDate: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

function schema(): void {
  const handle = archiveDatabase();
  if (!handle) return;
  try {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS match_history (
        fixture_id INTEGER PRIMARY KEY,
        match_date TEXT NOT NULL,
        competition TEXT NOT NULL DEFAULT '',
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        home_key TEXT NOT NULL,
        away_key TEXT NOT NULL,
        home_score INTEGER NOT NULL,
        away_score INTEGER NOT NULL,
        ingested_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS match_history_date ON match_history (match_date);
      CREATE INDEX IF NOT EXISTS match_history_home ON match_history (home_key, match_date);
      CREATE INDEX IF NOT EXISTS match_history_away ON match_history (away_key, match_date);
      CREATE TABLE IF NOT EXISTS match_history_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    migrateKeys();
  } catch {
    // A read-only volume leaves the app working and the history empty.
  }
}

/**
 * Re-reads the stored names when the way a name is keyed changes.
 *
 * Rows keep what the feed called the team; only the key changes, so a rewrite costs
 * a pass over the table and never a feed call.
 */
const KEYS_VERSION = '2';

function migrateKeys(): void {
  const handle = archiveDatabase();
  if (!handle) return;
  try {
    const row = handle
      .prepare("SELECT value FROM match_history_meta WHERE key = 'keys_version'")
      .get() as { value: string } | undefined;
    if (row?.value === KEYS_VERSION) return;
    const rows = handle
      .prepare('SELECT fixture_id, home_team, away_team FROM match_history')
      .all() as Array<{ fixture_id: number; home_team: string; away_team: string }>;
    const update = handle.prepare('UPDATE match_history SET home_key = ?, away_key = ? WHERE fixture_id = ?');
    for (const match of rows) {
      update.run(
        normalizeTeamName(match.home_team),
        normalizeTeamName(match.away_team),
        match.fixture_id,
      );
    }
    handle
      .prepare(
        `INSERT INTO match_history_meta (key, value) VALUES ('keys_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(KEYS_VERSION);
  } catch {
    // Keys stay as they are; the next open tries again.
  }
}

/** Writes finished matches. Re-ingesting a date updates it rather than doubling it. */
export function recordHistory(rows: HistoryRecord[]): number {
  const handle = archiveDatabase();
  if (!handle || !rows.length) return 0;
  schema();
  let written = 0;
  try {
    const statement = handle.prepare(
      `INSERT INTO match_history
        (fixture_id, match_date, competition, home_team, away_team, home_key, away_key,
         home_score, away_score, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fixture_id) DO UPDATE SET
         match_date = excluded.match_date,
         competition = excluded.competition,
         home_team = excluded.home_team,
         away_team = excluded.away_team,
         home_key = excluded.home_key,
         away_key = excluded.away_key,
         home_score = excluded.home_score,
         away_score = excluded.away_score,
         ingested_at = excluded.ingested_at`,
    );
    const now = Date.now();
    for (const row of rows) {
      statement.run(
        row.fixtureId,
        row.matchDate,
        row.competition,
        row.homeTeam,
        row.awayTeam,
        normalizeTeamName(row.homeTeam),
        normalizeTeamName(row.awayTeam),
        row.homeScore,
        row.awayScore,
        now,
      );
      written += 1;
    }
  } catch {
    return written;
  }
  return written;
}

/** Everything this team played before `asOf`, newest first. */
export function historyForTeam(team: string, asOf: string, limit = 60): HistoryMatch[] {
  const handle = archiveDatabase();
  if (!handle) return [];
  schema();
  try {
    const key = normalizeTeamName(team);
    const rows = handle
      .prepare(
        `SELECT fixture_id, match_date, home_team, away_team, home_score, away_score, competition
         FROM match_history
         WHERE home_key = ? OR away_key = ?
         ORDER BY match_date DESC
         LIMIT ?`,
      )
      .all(key, key, limit) as Array<{
      fixture_id: number;
      match_date: string;
      home_team: string;
      away_team: string;
      home_score: number;
      away_score: number;
      competition: string;
    }>;
    return rows.map((row) => ({
      fixtureId: Number(row.fixture_id),
      date: String(row.match_date),
      homeTeam: String(row.home_team),
      awayTeam: String(row.away_team),
      homeScore: Number(row.home_score),
      awayScore: Number(row.away_score),
      competition: String(row.competition ?? ''),
    }));
  } catch {
    return [];
  }
}

export type HistoryCoverage = {
  matches: number;
  teams: number;
  firstDate: string | null;
  lastDate: string | null;
};

export function historyCoverage(): HistoryCoverage {
  const handle = archiveDatabase();
  if (!handle) return { matches: 0, teams: 0, firstDate: null, lastDate: null };
  schema();
  try {
    const row = handle
      .prepare(
        `SELECT COUNT(*) AS matches, MIN(match_date) AS first_date, MAX(match_date) AS last_date
         FROM match_history`,
      )
      .get() as { matches: number; first_date: string | null; last_date: string | null };
    const distinct = handle
      .prepare(
        `SELECT COUNT(*) AS teams FROM (
           SELECT home_key AS team FROM match_history UNION SELECT away_key FROM match_history
         )`,
      )
      .get() as { teams: number } | undefined;
    return {
      matches: Number(row?.matches ?? 0),
      teams: Number(distinct?.teams ?? 0),
      firstDate: row?.first_date ?? null,
      lastDate: row?.last_date ?? null,
    };
  } catch {
    return { matches: 0, teams: 0, firstDate: null, lastDate: null };
  }
}

/** Fixtures on a date that are finished, with the score they finished on. */
export async function finishedFixturesOn(date: string): Promise<HistoryRecord[]> {
  const page = await getKickoffScoreFixtures(date);
  return (page.fixtures ?? []).flatMap<HistoryRecord>((fixture) => {
    const fixtureId = Number(fixture.matchUrl.split('/').filter(Boolean).pop());
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) return [];
    if (fixture.homeScore === null || fixture.awayScore === null) return [];
    if (!/finished|full.?time|\bft\b/i.test(fixture.status)) return [];
    return [
      {
        fixtureId,
        matchDate: date,
        competition: fixture.competition ?? '',
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
      },
    ];
  });
}

/** One feed call for a date: reads its finished matches into the table. */
export async function ingestHistoryDate(date: string): Promise<HistoryRecord[]> {
  const finished = await finishedFixturesOn(date);
  recordHistory(finished);
  return finished;
}
