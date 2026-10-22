import type {
  FootballFairAiSimulation,
  FootballFairAiSimulationInput,
  FootballFairAiTeam,
  FootballMatchDetails,
  FootballMatchLastFive,
  FootballProcessedMatchSummary,
} from "@workspace/api-zod";
import { database } from "./processed-match-store";

type JsonObject = Record<string, unknown>;
type SqlRow = Record<string, unknown>;
type IngestionStatus = "idle" | "running" | "completed" | "failed";

type FairAiDataSummary = {
  status: IngestionStatus;
  sourceFixtureCount: number;
  processedSourceFixtureCount: number;
  skippedSourceFixtureCount: number;
  remainingSourceFixtureCount: number;
  teamCount: number;
  matchCount: number;
  playerCount: number;
  coachCount: number;
  playerMatchCount: number;
  tacticalProfileCount: number;
  standingSnapshotCount: number;
  eventCount: number;
  playerWithStableIdCount: number;
  playerWithRatingCount: number;
  coachWithStableIdCount: number;
  teamWithFormationCount: number;
  lastImportedAt: string | null;
  lastError: string | null;
  trackingCoordinateRecords: number;
};

const BATCH_SIZE = 12;
const SOURCE_ORIGIN = "https://kickoffscore.com";

database.exec(`
  CREATE TABLE IF NOT EXISTS fair_ai_ingestion_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'completed', 'failed')),
    cursor_fixture_id INTEGER NOT NULL DEFAULT 0,
    source_fixture_count INTEGER NOT NULL DEFAULT 0,
    processed_fixture_count INTEGER NOT NULL DEFAULT 0,
    skipped_fixture_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    updated_at TEXT NOT NULL,
    last_error TEXT
  );
  INSERT OR IGNORE INTO fair_ai_ingestion_state
    (id, status, cursor_fixture_id, source_fixture_count, processed_fixture_count,
     skipped_fixture_count, updated_at)
  VALUES (1, 'idle', 0, 0, 0, 0, CURRENT_TIMESTAMP);

  CREATE TABLE IF NOT EXISTS fair_ai_teams (
    team_key TEXT PRIMARY KEY,
    source_team_id INTEGER,
    name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    observed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fair_ai_matches (
    fixture_id INTEGER PRIMARY KEY,
    match_date TEXT,
    competition TEXT,
    league_id INTEGER,
    season INTEGER,
    home_team_key TEXT,
    away_team_key TEXT,
    home_score INTEGER,
    away_score INTEGER,
    source_url TEXT NOT NULL,
    observed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS fair_ai_matches_date
    ON fair_ai_matches(match_date DESC);
  CREATE INDEX IF NOT EXISTS fair_ai_matches_home_team_recent
    ON fair_ai_matches(home_team_key, match_date DESC, fixture_id DESC);
  CREATE INDEX IF NOT EXISTS fair_ai_matches_away_team_recent
    ON fair_ai_matches(away_team_key, match_date DESC, fixture_id DESC);

  CREATE TABLE IF NOT EXISTS fair_ai_players (
    player_key TEXT PRIMARY KEY,
    source_player_id INTEGER,
    name TEXT NOT NULL,
    photo TEXT,
    number INTEGER,
    position TEXT,
    source_url TEXT NOT NULL,
    observed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fair_ai_player_matches (
    fixture_id INTEGER NOT NULL,
    player_key TEXT NOT NULL,
    team_key TEXT NOT NULL,
    rating REAL,
    statistics_json TEXT NOT NULL,
    source_url TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (fixture_id, player_key, team_key)
  );
  CREATE INDEX IF NOT EXISTS fair_ai_player_matches_player
    ON fair_ai_player_matches(player_key, observed_at DESC);
  CREATE INDEX IF NOT EXISTS fair_ai_player_matches_team_fixture_rating
    ON fair_ai_player_matches(team_key, fixture_id DESC, rating);

  CREATE TABLE IF NOT EXISTS fair_ai_coaches (
    coach_key TEXT PRIMARY KEY,
    source_coach_id INTEGER,
    name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    observed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fair_ai_team_match_profiles (
    fixture_id INTEGER NOT NULL,
    team_key TEXT NOT NULL,
    formation TEXT,
    coach_key TEXT,
    starter_count INTEGER NOT NULL,
    substitute_count INTEGER NOT NULL,
    team_statistics_json TEXT NOT NULL,
    source_url TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (fixture_id, team_key)
  );
  CREATE INDEX IF NOT EXISTS fair_ai_team_match_profiles_team_formation
    ON fair_ai_team_match_profiles(team_key, fixture_id DESC, formation);
  CREATE TABLE IF NOT EXISTS fair_ai_standings_snapshots (
    team_key TEXT NOT NULL,
    league_id INTEGER,
    season INTEGER,
    rank INTEGER,
    played INTEGER,
    points INTEGER,
    goal_difference INTEGER,
    form TEXT,
    source_url TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (team_key, league_id, season, observed_at)
  );
  CREATE INDEX IF NOT EXISTS fair_ai_standings_team
    ON fair_ai_standings_snapshots(team_key, observed_at DESC);
  CREATE TABLE IF NOT EXISTS fair_ai_match_events (
    fixture_id INTEGER NOT NULL,
    event_index INTEGER NOT NULL,
    minute INTEGER,
    extra_minute INTEGER,
    team_key TEXT,
    player_id INTEGER,
    player_name TEXT,
    assist_id INTEGER,
    assist_name TEXT,
    event_type TEXT NOT NULL,
    detail TEXT,
    comments TEXT,
    source_url TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (fixture_id, event_index)
  );
  CREATE INDEX IF NOT EXISTS fair_ai_match_events_actor
    ON fair_ai_match_events(player_name, fixture_id);
`);

const eventColumns = database
  .prepare("PRAGMA table_info(fair_ai_match_events)")
  .all() as { name?: unknown }[];
if (!eventColumns.some((column) => column.name === "player_id")) {
  database.exec("ALTER TABLE fair_ai_match_events ADD COLUMN player_id INTEGER");
}
if (!eventColumns.some((column) => column.name === "assist_id")) {
  database.exec("ALTER TABLE fair_ai_match_events ADD COLUMN assist_id INTEGER");
}

const stateQuery = database.prepare(
  "SELECT * FROM fair_ai_ingestion_state WHERE id = 1",
);
const stateUpdate = database.prepare(
  `UPDATE fair_ai_ingestion_state SET
     status = ?, cursor_fixture_id = ?, source_fixture_count = ?,
     processed_fixture_count = ?, skipped_fixture_count = ?,
     started_at = ?, updated_at = ?, last_error = ?
   WHERE id = 1`,
);

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integer(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function normalizedName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function teamKey(id: unknown, name: string): string {
  const sourceId = integer(id);
  return sourceId === null ? `name:${normalizedName(name)}` : `id:${sourceId}`;
}

function playerKey(id: unknown, name: string, team: string): string {
  const sourceId = integer(id);
  return sourceId === null
    ? `name:${normalizedName(name)}:team:${team}`
    : `id:${sourceId}`;
}

function safeSourceUrl(value: unknown, fixtureId: number): string {
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && url.hostname === "kickoffscore.com") {
        return url.toString();
      }
    } catch {
      // Construct the canonical source URL below when the stored value is invalid.
    }
  }
  return `${SOURCE_ORIGIN}/match/${fixtureId}`;
}

function ratingValue(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== null ? parsed : null;
}

const upsertTeam = database.prepare(
  `INSERT INTO fair_ai_teams (team_key, source_team_id, name, source_url, observed_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(team_key) DO UPDATE SET
     source_team_id = COALESCE(excluded.source_team_id, fair_ai_teams.source_team_id),
     name = excluded.name, source_url = excluded.source_url,
     observed_at = excluded.observed_at`,
);
const upsertMatch = database.prepare(
  `INSERT INTO fair_ai_matches
    (fixture_id, match_date, competition, league_id, season, home_team_key,
     away_team_key, home_score, away_score, source_url, observed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(fixture_id) DO UPDATE SET
     match_date = COALESCE(excluded.match_date, fair_ai_matches.match_date),
     competition = COALESCE(excluded.competition, fair_ai_matches.competition),
     league_id = COALESCE(excluded.league_id, fair_ai_matches.league_id),
     season = COALESCE(excluded.season, fair_ai_matches.season),
     home_team_key = COALESCE(excluded.home_team_key, fair_ai_matches.home_team_key),
     away_team_key = COALESCE(excluded.away_team_key, fair_ai_matches.away_team_key),
     home_score = COALESCE(excluded.home_score, fair_ai_matches.home_score),
     away_score = COALESCE(excluded.away_score, fair_ai_matches.away_score),
     source_url = excluded.source_url, observed_at = excluded.observed_at`,
);
const upsertPlayer = database.prepare(
  `INSERT INTO fair_ai_players
    (player_key, source_player_id, name, photo, number, position, source_url, observed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(player_key) DO UPDATE SET
     source_player_id = COALESCE(excluded.source_player_id, fair_ai_players.source_player_id),
     name = excluded.name, photo = COALESCE(excluded.photo, fair_ai_players.photo),
     number = COALESCE(excluded.number, fair_ai_players.number),
     position = COALESCE(excluded.position, fair_ai_players.position),
     source_url = excluded.source_url, observed_at = excluded.observed_at`,
);
const upsertPlayerMatch = database.prepare(
  `INSERT INTO fair_ai_player_matches
    (fixture_id, player_key, team_key, rating, statistics_json, source_url, observed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(fixture_id, player_key, team_key) DO UPDATE SET
     rating = COALESCE(excluded.rating, fair_ai_player_matches.rating),
     statistics_json = excluded.statistics_json, source_url = excluded.source_url,
     observed_at = excluded.observed_at`,
);
const upsertCoach = database.prepare(
  `INSERT INTO fair_ai_coaches (coach_key, source_coach_id, name, source_url, observed_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(coach_key) DO UPDATE SET
     source_coach_id = COALESCE(excluded.source_coach_id, fair_ai_coaches.source_coach_id),
     name = excluded.name, source_url = excluded.source_url,
     observed_at = excluded.observed_at`,
);
const upsertTactics = database.prepare(
  `INSERT INTO fair_ai_team_match_profiles
    (fixture_id, team_key, formation, coach_key, starter_count, substitute_count,
     team_statistics_json, source_url, observed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(fixture_id, team_key) DO UPDATE SET
     formation = COALESCE(excluded.formation, fair_ai_team_match_profiles.formation),
     coach_key = COALESCE(excluded.coach_key, fair_ai_team_match_profiles.coach_key),
     starter_count = excluded.starter_count,
     substitute_count = excluded.substitute_count,
     team_statistics_json = excluded.team_statistics_json,
     source_url = excluded.source_url, observed_at = excluded.observed_at`,
);
const upsertStanding = database.prepare(
  `INSERT OR REPLACE INTO fair_ai_standings_snapshots
    (team_key, league_id, season, rank, played, points, goal_difference,
     form, source_url, observed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertEvent = database.prepare(
  `INSERT OR REPLACE INTO fair_ai_match_events
    (fixture_id, event_index, minute, extra_minute, team_key, player_id,
     player_name, assist_id, assist_name, event_type, detail, comments,
     source_url, observed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

function registerTeam(
  id: unknown,
  nameValue: unknown,
  sourceUrl: string,
  observedAt: string,
): string | null {
  const name = text(nameValue);
  if (!name) return null;
  const idValue = integer(id);
  const key = teamKey(idValue, name);
  upsertTeam.run(key, idValue, name, sourceUrl, observedAt);
  return key;
}

function registerMatch(
  value: unknown,
  sourceUrl: string,
  observedAt: string,
  fallbackFixtureId?: number,
): number | null {
  const row = object(value);
  const fixtureId = integer(row.fixtureId) ?? fallbackFixtureId ?? null;
  if (fixtureId === null) return null;
  const home = object(row.home ?? row.homeTeam);
  const away = object(row.away ?? row.awayTeam);
  const homeName = text(home.name);
  const awayName = text(away.name);
  const homeKey = homeName
    ? registerTeam(home.id, homeName, sourceUrl, observedAt)
    : null;
  const awayKey = awayName
    ? registerTeam(away.id, awayName, sourceUrl, observedAt)
    : null;
  upsertMatch.run(
    fixtureId,
    text(row.date),
    text(row.competition),
    integer(row.leagueId),
    integer(row.season),
    homeKey,
    awayKey,
    integer(home.score ?? row.homeScore),
    integer(away.score ?? row.awayScore),
    sourceUrl,
    observedAt,
  );
  return fixtureId;
}

function importStandings(
  details: JsonObject,
  sourceUrl: string,
  observedAt: string,
): void {
  const match = object(details.match);
  const leagueId = integer(match.leagueId);
  const season = integer(match.season);
  for (const entry of array(details.standings)) {
    const row = object(entry);
    const key = registerTeam(row.teamId, row.teamName, sourceUrl, observedAt);
    if (!key) continue;
    upsertStanding.run(
      key,
      leagueId,
      season,
      integer(row.rank),
      integer(row.played),
      integer(row.points),
      integer(row.goalDifference),
      text(row.form),
      sourceUrl,
      observedAt,
    );
  }
}

function importPlayers(
  fixtureId: number,
  teamKeyValue: string,
  players: unknown[],
  sourceUrl: string,
  observedAt: string,
): void {
  for (const entry of players) {
    const row = object(entry);
    const name = text(row.name);
    if (!name) continue;
    const id = integer(row.id);
    const key = playerKey(id, name, teamKeyValue);
    const stats = array(row.statistics);
    const minutes = stats.find((item) =>
      /(?:games|minutes)/i.test(text(object(item).label) ?? ""),
    );
    upsertPlayer.run(
      key,
      id,
      name,
      text(row.photo),
      integer(row.number),
      text(row.position),
      sourceUrl,
      observedAt,
    );
    upsertPlayerMatch.run(
      fixtureId,
      key,
      teamKeyValue,
      ratingValue(row.rating),
      JSON.stringify({
        statistics: stats,
        minutes: minutes ? object(minutes).value ?? null : null,
      }),
      sourceUrl,
      observedAt,
    );
  }
}

function importLineups(
  fixtureId: number,
  lineups: unknown[],
  teamStatistics: unknown[],
  sourceUrl: string,
  observedAt: string,
): void {
  const statsByTeam = new Map<string, unknown[]>();
  for (const value of teamStatistics) {
    const stats = object(value);
    const id = integer(stats.teamId);
    const name = text(stats.teamName);
    if (!name) continue;
    statsByTeam.set(teamKey(id, name), array(stats.statistics));
  }

  for (const value of lineups) {
    const lineup = object(value);
    const teamName = text(lineup.teamName);
    if (!teamName) continue;
    const team = registerTeam(lineup.teamId, teamName, sourceUrl, observedAt);
    if (!team) continue;
    const coachName = text(lineup.coach);
    const coachId = integer(lineup.coachId);
    const coachKey = coachName
      ? coachId === null
        ? `name:${normalizedName(coachName)}`
        : `id:${coachId}`
      : null;
    if (coachName && coachKey) {
      upsertCoach.run(coachKey, coachId, coachName, sourceUrl, observedAt);
    }
    const starters = array(lineup.starters);
    const substitutes = array(lineup.substitutes);
    upsertTactics.run(
      fixtureId,
      team,
      text(lineup.formation),
      coachKey,
      starters.length,
      substitutes.length,
      JSON.stringify(statsByTeam.get(team) ?? []),
      sourceUrl,
      observedAt,
    );
    importPlayers(fixtureId, team, starters, sourceUrl, observedAt);
    importPlayers(fixtureId, team, substitutes, sourceUrl, observedAt);
  }
}

function importPlayerGroups(
  fixtureId: number,
  groups: unknown[],
  sourceUrl: string,
  observedAt: string,
): void {
  for (const value of groups) {
    const group = object(value);
    const teamName = text(group.teamName);
    if (!teamName) continue;
    const team = registerTeam(group.teamId, teamName, sourceUrl, observedAt);
    if (team) {
      importPlayers(fixtureId, team, array(group.players), sourceUrl, observedAt);
    }
  }
}

function importEvents(
  fixtureId: number,
  events: unknown[],
  sourceUrl: string,
  observedAt: string,
): void {
  events.forEach((value, eventIndex) => {
    const event = object(value);
    const type = text(event.type);
    if (!type) return;
    const teamName = text(event.teamName);
    const team = teamName
      ? registerTeam(event.teamId, teamName, sourceUrl, observedAt)
      : null;
    const playerName = text(event.player);
    const playerId = integer(event.playerId);
    if (playerName) {
      upsertPlayer.run(
        playerKey(playerId, playerName, team ?? "unassigned"),
        playerId,
        playerName,
        null,
        null,
        null,
        sourceUrl,
        observedAt,
      );
    }
    const assistName = text(event.assist);
    const assistId = integer(event.assistId);
    if (assistName) {
      upsertPlayer.run(
        playerKey(assistId, assistName, team ?? "unassigned"),
        assistId,
        assistName,
        null,
        null,
        null,
        sourceUrl,
        observedAt,
      );
    }
    insertEvent.run(
      fixtureId,
      eventIndex,
      integer(event.minute),
      integer(event.extraMinute),
      team,
      playerId,
      playerName,
      assistId,
      assistName,
      type,
      text(event.detail),
      text(event.comments),
      sourceUrl,
      observedAt,
    );
  });
}

function importArchivePayload(
  fixtureId: number,
  details: JsonObject,
  lastFive: JsonObject,
  fallback: {
    matchDate: string;
    competition: string;
    leagueId: number | null;
    season: number | null;
    homeTeamName: string;
    awayTeamName: string;
    homeScore: number | null;
    awayScore: number | null;
    observedAt: string;
  },
): void {
  const detailUrl = safeSourceUrl(details.sourceUrl, fixtureId);
  const primary = object(details.match);
  const primaryMatch = {
    ...primary,
    fixtureId,
    date: primary.date ?? fallback.matchDate,
    competition: primary.competition ?? fallback.competition,
    leagueId: primary.leagueId ?? fallback.leagueId,
    season: primary.season ?? fallback.season,
    home: {
      ...object(primary.home),
      name: object(primary.home).name ?? fallback.homeTeamName,
      score: object(primary.home).score ?? fallback.homeScore,
    },
    away: {
      ...object(primary.away),
      name: object(primary.away).name ?? fallback.awayTeamName,
      score: object(primary.away).score ?? fallback.awayScore,
    },
  };

  database.exec("BEGIN IMMEDIATE");
  try {
    registerMatch(primaryMatch, detailUrl, fallback.observedAt, fixtureId);
    importStandings(details, detailUrl, fallback.observedAt);

    for (const side of ["home", "away"] as const) {
      const sideData = object(lastFive[side]);
      for (const wrapperValue of array(sideData.matches)) {
        const wrapper = object(wrapperValue);
        const match = object(wrapper.match);
        const recentFixtureId = integer(match.fixtureId);
        if (recentFixtureId === null) continue;
        const matchUrl = safeSourceUrl(wrapper.sourceUrl, recentFixtureId);
        registerMatch(match, matchUrl, fallback.observedAt, recentFixtureId);
        importLineups(
          recentFixtureId,
          array(wrapper.lineups),
          array(wrapper.statistics),
          matchUrl,
          fallback.observedAt,
        );
        importPlayerGroups(
          recentFixtureId,
          array(wrapper.players),
          matchUrl,
          fallback.observedAt,
        );
        importEvents(
          recentFixtureId,
          array(wrapper.events),
          matchUrl,
          fallback.observedAt,
        );
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function sourceRecordFromRow(row: SqlRow) {
  const fixtureId = integer(row.fixture_id);
  if (fixtureId === null) throw new Error("Archive row has no valid fixture ID.");
  const detailsText = text(row.details_json);
  const lastFiveText = text(row.last_five_json);
  if (!detailsText || !lastFiveText) {
    throw new Error(`Archive fixture ${fixtureId} is missing a required source payload.`);
  }
  const details = object(JSON.parse(detailsText));
  const lastFive = object(JSON.parse(lastFiveText));
  const match = object(details.match);
  const home = object(match.home);
  const away = object(match.away);

  return {
    fixtureId,
    details,
    lastFive,
    fallback: {
      matchDate: text(row.match_date) ?? "",
      competition: text(row.competition) ?? "Football",
      leagueId: integer(row.league_id),
      season: integer(row.season),
      homeTeamName: text(row.home_team_name) ?? "",
      awayTeamName: text(row.away_team_name) ?? "",
      homeScore: integer(row.home_score),
      awayScore: integer(row.away_score),
      observedAt: text(row.processed_at) ?? new Date().toISOString(),
    },
  };
}

export function saveFairAiFixture(
  summary: FootballProcessedMatchSummary,
  details: FootballMatchDetails,
  lastFive: FootballMatchLastFive,
): void {
  importArchivePayload(
    summary.fixtureId,
    details as unknown as JsonObject,
    lastFive as unknown as JsonObject,
    {
      matchDate: summary.date.toISOString(),
      competition: summary.competition,
      leagueId: summary.leagueId,
      season: summary.season,
      homeTeamName: summary.homeTeamName,
      awayTeamName: summary.awayTeamName,
      homeScore: summary.homeScore,
      awayScore: summary.awayScore,
      observedAt: summary.processedAt.toISOString(),
    },
  );
}

let workerStarted = false;

function readState(): SqlRow {
  return (stateQuery.get() as SqlRow | undefined) ?? {};
}

function numericState(state: SqlRow, key: string): number {
  return integer(state[key]) ?? 0;
}

function stateStatus(state: SqlRow): IngestionStatus {
  const value = text(state.status);
  return value === "running" || value === "completed" || value === "failed"
    ? value
    : "idle";
}

function count(table: string, where = ""): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS total FROM ${table} ${where}`)
    .get() as SqlRow | undefined;
  return integer(row?.total) ?? 0;
}

function fairAiTeamRows(search: string, teamKey?: string): FootballFairAiTeam[] {
  const rows = database
    .prepare(
      `WITH team_matches AS (
         SELECT home_team_key AS team_key, fixture_id, match_date,
                home_score AS goals_for, away_score AS goals_against
         FROM fair_ai_matches
         WHERE home_team_key IS NOT NULL AND home_score IS NOT NULL AND away_score IS NOT NULL
         UNION ALL
         SELECT away_team_key AS team_key, fixture_id, match_date,
                away_score AS goals_for, home_score AS goals_against
         FROM fair_ai_matches
         WHERE away_team_key IS NOT NULL AND home_score IS NOT NULL AND away_score IS NOT NULL
       ),
       ranked AS (
         SELECT team_key, fixture_id, match_date, goals_for, goals_against,
                ROW_NUMBER() OVER (PARTITION BY team_key ORDER BY match_date DESC, fixture_id DESC) AS recent_rank
         FROM team_matches
       ),
       summary AS (
         SELECT team_key, COUNT(*) AS match_count,
                SUM(CASE WHEN recent_rank <= 10 THEN 1 ELSE 0 END) AS recent_match_count,
                AVG(CASE WHEN recent_rank <= 10 THEN goals_for END) AS avg_goals_for,
                AVG(CASE WHEN recent_rank <= 10 THEN goals_against END) AS avg_goals_against
         FROM ranked
         GROUP BY team_key
       ),
       ratings AS (
         SELECT ranked.team_key, AVG(player_matches.rating) AS avg_player_rating
         FROM ranked
         JOIN fair_ai_player_matches AS player_matches
           ON player_matches.fixture_id = ranked.fixture_id
          AND player_matches.team_key = ranked.team_key
         WHERE ranked.recent_rank <= 5 AND player_matches.rating IS NOT NULL
         GROUP BY ranked.team_key
       ),
       latest_formation AS (
         SELECT profiles.team_key, profiles.formation
         FROM fair_ai_team_match_profiles AS profiles
         JOIN (
           SELECT team_key, MAX(fixture_id) AS fixture_id
           FROM fair_ai_team_match_profiles
           WHERE formation IS NOT NULL
           GROUP BY team_key
         ) AS latest
           ON latest.team_key = profiles.team_key
          AND latest.fixture_id = profiles.fixture_id
       )
       SELECT teams.team_key, teams.name, summary.match_count, summary.recent_match_count,
              summary.avg_goals_for, summary.avg_goals_against,
              ratings.avg_player_rating, latest_formation.formation
       FROM summary
       JOIN fair_ai_teams AS teams ON teams.team_key = summary.team_key
       LEFT JOIN ratings ON ratings.team_key = teams.team_key
       LEFT JOIN latest_formation ON latest_formation.team_key = teams.team_key
       WHERE (? = '' OR teams.name LIKE ? COLLATE NOCASE)
         AND (? IS NULL OR teams.team_key = ?)
       ORDER BY summary.match_count DESC, teams.name COLLATE NOCASE
       LIMIT ?`,
    )
    .all(
      search,
      `%${search}%`,
      teamKey ?? null,
      teamKey ?? null,
      teamKey ? 1 : 40,
    ) as SqlRow[];

  return rows.map((row) => ({
    teamKey: String(row.team_key),
    name: String(row.name),
    matchCount: integer(row.match_count) ?? 0,
    recentMatchCount: integer(row.recent_match_count) ?? 0,
    avgGoalsFor: number(row.avg_goals_for) ?? 0,
    avgGoalsAgainst: number(row.avg_goals_against) ?? 0,
    avgPlayerRating: number(row.avg_player_rating),
    formation: text(row.formation),
  }));
}

export function getFairAiTeams(search = ""): { teams: FootballFairAiTeam[] } {
  return { teams: fairAiTeamRows(search.trim().slice(0, 80)) };
}

function samplePoisson(lambda: number): number {
  const threshold = Math.exp(-lambda);
  let product = 1;
  let events = 0;
  do {
    events += 1;
    product *= Math.random();
  } while (product > threshold);
  return events - 1;
}

export function runFairAiArchiveSimulation(
  input: FootballFairAiSimulationInput,
): FootballFairAiSimulation | null {
  const home = fairAiTeamRows("", input.homeTeamKey)[0];
  const away = fairAiTeamRows("", input.awayTeamKey)[0];
  if (!home || !away) return null;

  const iterations = Math.min(50000, Math.max(1000, input.iterations ?? 10000));
  const expectedHomeGoals = Math.min(
    3.8,
    Math.max(0.15, (home.avgGoalsFor + away.avgGoalsAgainst) / 2 + 0.12),
  );
  const expectedAwayGoals = Math.min(
    3.5,
    Math.max(0.15, (away.avgGoalsFor + home.avgGoalsAgainst) / 2),
  );
  const scorelines = new Map<string, { homeGoals: number; awayGoals: number; count: number }>();
  const outcomes = { home: 0, draw: 0, away: 0 };

  for (let run = 0; run < iterations; run += 1) {
    const homeGoals = samplePoisson(expectedHomeGoals);
    const awayGoals = samplePoisson(expectedAwayGoals);
    if (homeGoals > awayGoals) outcomes.home += 1;
    else if (homeGoals === awayGoals) outcomes.draw += 1;
    else outcomes.away += 1;
    const key = `${homeGoals}-${awayGoals}`;
    const scoreline = scorelines.get(key);
    if (scoreline) scoreline.count += 1;
    else scorelines.set(key, { homeGoals, awayGoals, count: 1 });
  }

  return {
    iterations,
    home,
    away,
    expectedHomeGoals,
    expectedAwayGoals,
    outcomes,
    probabilities: {
      home: outcomes.home / iterations,
      draw: outcomes.draw / iterations,
      away: outcomes.away / iterations,
    },
    topScorelines: [...scorelines.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, 6)
      .map((scoreline) => ({
        ...scoreline,
        probability: scoreline.count / iterations,
      })),
    method: "Monte Carlo scoreline sampling from each team's last 10 completed archive matches.",
    limitations: [
      "This is an archive-based scoreline preview, not the full FAIR AI reinforcement-learning simulator.",
      "Player ratings and formations are shown as source context; the forecast uses match goals, not player action policies.",
      "No tracking coordinates, action trajectories, or spatial xT/EVA inputs are available in the imported source.",
      "Results are experimental and are not betting advice.",
    ],
  };
}

export function getFairAiDataSummary(): FairAiDataSummary {
  const state = readState();
  const stateStatusValue = stateStatus(state);
  const sourceFixtureCount = count("processed_matches");
  const processedSourceFixtureCount = numericState(
    state,
    "processed_fixture_count",
  );
  const skippedSourceFixtureCount = numericState(state, "skipped_fixture_count");
  const imported = database
    .prepare(
      `SELECT MAX(observed_at) AS last_imported_at
       FROM fair_ai_matches`,
    )
    .get() as SqlRow | undefined;

  return {
    status: stateStatusValue,
    sourceFixtureCount,
    processedSourceFixtureCount,
    skippedSourceFixtureCount,
    remainingSourceFixtureCount: Math.max(
      0,
      sourceFixtureCount -
        processedSourceFixtureCount -
        skippedSourceFixtureCount,
    ),
    teamCount: count("fair_ai_teams"),
    matchCount: count("fair_ai_matches"),
    playerCount: count("fair_ai_players"),
    coachCount: count("fair_ai_coaches"),
    playerMatchCount: count("fair_ai_player_matches"),
    tacticalProfileCount: count("fair_ai_team_match_profiles"),
    standingSnapshotCount: count("fair_ai_standings_snapshots"),
    eventCount: count("fair_ai_match_events"),
    playerWithStableIdCount: count(
      "fair_ai_players",
      "WHERE source_player_id IS NOT NULL",
    ),
    playerWithRatingCount: count(
      "fair_ai_player_matches",
      "WHERE rating IS NOT NULL",
    ),
    coachWithStableIdCount: count(
      "fair_ai_coaches",
      "WHERE source_coach_id IS NOT NULL",
    ),
    teamWithFormationCount: count(
      "fair_ai_team_match_profiles",
      "WHERE formation IS NOT NULL",
    ),
    lastImportedAt: text(imported?.last_imported_at),
    lastError: text(state.last_error),
    trackingCoordinateRecords: 0,
  };
}

function persistState(input: {
  status: IngestionStatus;
  cursor: number;
  sourceCount: number;
  processedCount: number;
  skippedCount: number;
  startedAt: string | null;
  error: string | null;
}): void {
  stateUpdate.run(
    input.status,
    input.cursor,
    input.sourceCount,
    input.processedCount,
    input.skippedCount,
    input.startedAt,
    new Date().toISOString(),
    input.error,
  );
}

function runIngestionBatch(): void {
  if (!workerStarted) return;
  const state = readState();
  const cursor = numericState(state, "cursor_fixture_id");
  const sourceCount = Math.max(
    numericState(state, "source_fixture_count"),
    count("processed_matches"),
  );
  let processedCount = numericState(state, "processed_fixture_count");
  let skippedCount = numericState(state, "skipped_fixture_count");
  let nextCursor = cursor;
  let lastError = text(state.last_error);
  const rows = database
    .prepare(
      `SELECT fixture_id, match_date, competition, league_id, season,
              home_team_name, away_team_name, home_score, away_score,
              processed_at, details_json, last_five_json
       FROM processed_matches
       WHERE fixture_id > ?
       ORDER BY fixture_id
       LIMIT ?`,
    )
    .all(cursor, BATCH_SIZE) as SqlRow[];

  for (const row of rows) {
    const fixtureId = integer(row.fixture_id);
    if (fixtureId === null) continue;
    try {
      const source = sourceRecordFromRow(row);
      importArchivePayload(
        source.fixtureId,
        source.details,
        source.lastFive,
        source.fallback,
      );
      processedCount += 1;
    } catch (error) {
      skippedCount += 1;
      lastError = `Fixture ${fixtureId} was skipped: ${
        error instanceof Error ? error.message : "source record could not be read"
      }`;
    }
    nextCursor = fixtureId;
  }

  if (!rows.length) {
    persistState({
      status: "completed",
      cursor,
      sourceCount,
      processedCount,
      skippedCount,
      startedAt: text(state.started_at),
      error: lastError,
    });
    workerStarted = false;
    return;
  }

  persistState({
    status: "running",
    cursor: nextCursor,
    sourceCount,
    processedCount,
    skippedCount,
    startedAt: text(state.started_at) ?? new Date().toISOString(),
    error: lastError,
  });
  setImmediate(runIngestionBatch);
}

export function startFairAiDataIngestion(): FairAiDataSummary {
  const state = readState();
  if (stateStatus(state) === "running") {
    if (!workerStarted) {
      workerStarted = true;
      setImmediate(runIngestionBatch);
    }
    return getFairAiDataSummary();
  }

  const sourceCount = count("processed_matches");
  const previousCount = numericState(state, "processed_fixture_count");
  const previousSkipped = numericState(state, "skipped_fixture_count");
  const cursor = numericState(state, "cursor_fixture_id");
  const startedAt = new Date().toISOString();
  persistState({
    status: "running",
    cursor,
    sourceCount,
    processedCount: previousCount,
    skippedCount: previousSkipped,
    startedAt,
    error: null,
  });
  workerStarted = true;
  setImmediate(runIngestionBatch);
  return getFairAiDataSummary();
}

export function clearFairAiData(): void {
  workerStarted = false;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      DELETE FROM fair_ai_standings_snapshots;
      DELETE FROM fair_ai_match_events;
      DELETE FROM fair_ai_team_match_profiles;
      DELETE FROM fair_ai_coaches;
      DELETE FROM fair_ai_player_matches;
      DELETE FROM fair_ai_players;
      DELETE FROM fair_ai_matches;
      DELETE FROM fair_ai_teams;
    `);
    persistState({
      status: "idle",
      cursor: 0,
      sourceCount: 0,
      processedCount: 0,
      skippedCount: 0,
      startedAt: null,
      error: null,
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

const priorState = readState();
if (stateStatus(priorState) === "running") {
  workerStarted = true;
  setImmediate(runIngestionBatch);
}
