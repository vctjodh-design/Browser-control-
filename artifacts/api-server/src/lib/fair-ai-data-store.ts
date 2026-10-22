import type {
  FootballFairAiSimulation,
  FootballFairAiSimulationInput,
  FootballFairAiSimulationPlayer,
  FootballFairAiTeam,
  FootballFairAiTeamStats,
  FootballMatchDetails,
  FootballMatchLastFive,
  FootballProcessedMatchSummary,
} from "@workspace/api-zod";
import { database } from "./processed-match-store";
import { runFairAiPossessionSimulation } from "./fair-ai-possession-simulator";
import { getFreshKickoffScoreFairAiSnapshots } from "./kickoffscore-last-five";

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
  starter: boolean | null = null,
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
    const priorRow = database
      .prepare(
        `SELECT statistics_json FROM fair_ai_player_matches
         WHERE fixture_id = ? AND player_key = ? AND team_key = ?`,
      )
      .get(fixtureId, key, teamKeyValue) as SqlRow | undefined;
    let prior: JsonObject = {};
    try {
      prior = object(JSON.parse(String(priorRow?.statistics_json ?? "{}")));
    } catch {
      prior = {};
    }
    const importedProfile: JsonObject = {};
    const rowProfile = object(row.profile);
    for (const field of [
      "age",
      "height",
      "weight",
      "nationality",
      "preferredFoot",
      "marketValue",
      "contractUntil",
    ]) {
      const value = row[field] ?? rowProfile[field];
      if (value !== undefined && value !== null) {
        importedProfile[field] = value;
      }
    }
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
        ...prior,
        statistics: stats,
        minutes: minutes ? object(minutes).value ?? null : null,
        starter: starter ?? (typeof prior.starter === "boolean" ? prior.starter : null),
        profile: { ...object(prior.profile), ...importedProfile },
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
    importPlayers(fixtureId, team, starters, sourceUrl, observedAt, true);
    importPlayers(fixtureId, team, substitutes, sourceUrl, observedAt, false);
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
  replaceFixtureData = false,
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
    if (replaceFixtureData) {
      database.prepare("DELETE FROM fair_ai_player_matches WHERE fixture_id = ?").run(fixtureId);
      database.prepare("DELETE FROM fair_ai_team_match_profiles WHERE fixture_id = ?").run(fixtureId);
      database.prepare("DELETE FROM fair_ai_match_events WHERE fixture_id = ?").run(fixtureId);
    }
    registerMatch(primaryMatch, detailUrl, fallback.observedAt, fixtureId);
    importStandings(details, detailUrl, fallback.observedAt);
    importLineups(
      fixtureId,
      array(details.lineups),
      array(details.statistics),
      detailUrl,
      fallback.observedAt,
    );
    importPlayerGroups(fixtureId, array(details.players), detailUrl, fallback.observedAt);
    importEvents(fixtureId, array(details.events), detailUrl, fallback.observedAt);

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

function saveFreshFairAiSourceSnapshot(
  fixtureId: number,
  details: JsonObject,
): void {
  const match = object(details.match);
  const home = object(match.home);
  const away = object(match.away);
  const matchDate = text(match.date);
  const homeTeamName = text(home.name);
  const awayTeamName = text(away.name);
  if (!matchDate || !homeTeamName || !awayTeamName) {
    throw new Error(`KickoffScore returned incomplete match details for fixture ${fixtureId}.`);
  }
  importArchivePayload(
    fixtureId,
    details,
    {},
    {
      matchDate,
      competition: text(match.competition) ?? "Football",
      leagueId: integer(match.leagueId),
      season: integer(match.season),
      homeTeamName,
      awayTeamName,
      homeScore: integer(home.score),
      awayScore: integer(away.score),
      observedAt: new Date().toISOString(),
    },
    true,
  );
}

async function refreshFairAiTeamsFromSource(teamKeys: string[]): Promise<void> {
  const selectedTeams = [...new Set(teamKeys)].map((key) => {
    const row = database
      .prepare("SELECT source_team_id FROM fair_ai_teams WHERE team_key = ?")
      .get(key) as SqlRow | undefined;
    const sourceTeamId = integer(row?.source_team_id);
    if (sourceTeamId === null) {
      throw new Error("This team has no KickoffScore ID, so its live match details cannot be refreshed.");
    }
    return sourceTeamId;
  });
  const refreshed = await getFreshKickoffScoreFairAiSnapshots(selectedTeams, 5);
  for (const snapshot of refreshed.snapshots) {
    if (snapshot) saveFreshFairAiSourceSnapshot(snapshot.fixtureId, snapshot.details);
  }
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

function numericStat(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function eventExpectedGoals(event: JsonObject): number | null {
  const description = [
    text(event.event_type),
    text(event.detail),
    text(event.comments),
  ].filter(Boolean).join(" ");
  const match = description.match(/\bxg\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : null;
}

function statToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function statRows(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.map(object);
}

function matchingStat(stats: JsonObject[], aliases: string[]): number | null {
  const target = new Set(aliases.map(statToken));
  for (const stat of stats) {
    const label = text(stat.label);
    if (!label) continue;
    const parts = label.split("·").map(statToken);
    const leaf = parts.at(-1) ?? "";
    if (target.has(leaf) || parts.some((part) => target.has(part))) {
      return numericStat(stat.value);
    }
  }
  return null;
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length ? present.reduce((total, value) => total + value, 0) / present.length : null;
}

function playerStat(
  stats: JsonObject[],
  categories: string[],
  metrics: string[],
): number | null {
  const categorySet = new Set(categories.map(statToken));
  const metricSet = new Set(metrics.map(statToken));
  for (const stat of stats) {
    const label = text(stat.label);
    if (!label) continue;
    const parts = label.split("·").map(statToken);
    const metric = parts.at(-1) ?? "";
    if (metricSet.has(metric) && parts.slice(0, -1).some((part) => categorySet.has(part))) {
      return numericStat(stat.value);
    }
  }
  return null;
}

type PlayerAccumulator = {
  playerKey: string;
  name: string;
  position: string | null;
  shirtNumber: number | null;
  age: number | null;
  height: string | null;
  weight: string | null;
  nationality: string | null;
  preferredFoot: string | null;
  marketValue: string | null;
  contractUntil: string | null;
  appearances: number;
  minutes: number;
  cleanSheets: number;
  goalsConceded: number;
  ratingTotal: number;
  ratingCount: number;
  yellowCards: number;
  redCards: number;
  starter: boolean;
  latestAppearance: number;
  passTotal: number;
  passAccurate: number;
  keyPasses: number;
  shots: number;
  shotsOnTarget: number;
  expectedGoals: number;
  goals: number;
  assists: number;
  duelsTotal: number;
  duelsWon: number;
  tackles: number;
  interceptions: number;
  saves: number;
};

function summarizePlayers(teamKey: string): FootballFairAiSimulationPlayer[] {
  const rows = database
    .prepare(
      `WITH recent AS (
         SELECT profiles.fixture_id, profiles.team_key, matches.match_date,
                matches.home_team_key, matches.home_score,
                matches.away_team_key, matches.away_score
         FROM fair_ai_team_match_profiles AS profiles
         JOIN fair_ai_matches AS matches ON matches.fixture_id = profiles.fixture_id
         WHERE profiles.team_key = ?
         ORDER BY matches.match_date DESC, matches.fixture_id DESC
         LIMIT 10
       )
       SELECT players.player_key, players.source_player_id, players.number AS shirt_number,
              players.name, players.position, player_matches.rating,
              player_matches.statistics_json, recent.match_date,
              recent.fixture_id,
              CASE WHEN recent.team_key = recent.home_team_key
                   THEN recent.home_score ELSE recent.away_score END AS team_score,
              CASE WHEN recent.team_key = recent.home_team_key
                   THEN recent.away_score ELSE recent.home_score END AS opponent_score
       FROM recent
       JOIN fair_ai_player_matches AS player_matches
         ON player_matches.fixture_id = recent.fixture_id
        AND player_matches.team_key = ?
       JOIN fair_ai_players AS players ON players.player_key = player_matches.player_key
       ORDER BY recent.match_date DESC`,
    )
    .all(teamKey, teamKey) as SqlRow[];

  const fixtureIds = [...new Set(
    rows.map((row) => integer(row.fixture_id)).filter((value): value is number => value !== null),
  )];
  let matchEvents: SqlRow[] = [];
  if (fixtureIds.length) {
    const placeholders = fixtureIds.map(() => "?").join(", ");
    matchEvents = database
      .prepare(
        `SELECT fixture_id, player_id, player_name, assist_id, assist_name,
                event_type, detail, comments
         FROM fair_ai_match_events
         WHERE team_key = ? AND fixture_id IN (${placeholders})`,
      )
      .all(teamKey, ...fixtureIds) as SqlRow[];
  }
  const eventsByFixture = new Map<number, SqlRow[]>();
  for (const event of matchEvents) {
    const fixtureId = integer(event.fixture_id);
    if (fixtureId === null) continue;
    const fixtureEvents = eventsByFixture.get(fixtureId) ?? [];
    fixtureEvents.push(event);
    eventsByFixture.set(fixtureId, fixtureEvents);
  }

  const playerMap = new Map<string, PlayerAccumulator>();
  for (const row of rows) {
    const key = text(row.player_key);
    const name = text(row.name);
    if (!key || !name) continue;
    let data: JsonObject = {};
    try {
      data = object(JSON.parse(String(row.statistics_json)));
    } catch {
      continue;
    }
    const stats = statRows(data.statistics);
    const appearanceDate = Date.parse(String(row.match_date ?? ""));
    const player = playerMap.get(key) ?? {
      playerKey: key,
      name,
      position: text(row.position),
      shirtNumber: integer(row.shirt_number),
      age: null,
      height: null,
      weight: null,
      nationality: null,
      preferredFoot: null,
      marketValue: null,
      contractUntil: null,
      appearances: 0,
      minutes: 0,
      cleanSheets: 0,
      goalsConceded: 0,
      ratingTotal: 0,
      ratingCount: 0,
      yellowCards: 0,
      redCards: 0,
      starter: false,
      latestAppearance: 0,
      passTotal: 0,
      passAccurate: 0,
      keyPasses: 0,
      shots: 0,
      shotsOnTarget: 0,
      expectedGoals: 0,
      goals: 0,
      assists: 0,
      duelsTotal: 0,
      duelsWon: 0,
      tackles: 0,
      interceptions: 0,
      saves: 0,
    };
    const profile = object(data.profile);
    player.shirtNumber = integer(row.shirt_number) ?? player.shirtNumber;
    player.age = integer(profile.age) ?? player.age;
    player.height = text(profile.height) ?? player.height;
    player.weight = text(profile.weight) ?? player.weight;
    player.nationality = text(profile.nationality) ?? player.nationality;
    player.preferredFoot = text(profile.preferredFoot) ?? player.preferredFoot;
    player.marketValue = text(profile.marketValue) ?? player.marketValue;
    player.contractUntil = text(profile.contractUntil) ?? player.contractUntil;
    const minutes =
      playerStat(stats, ["games"], ["minutes"]) ??
      numericStat(data.minutes);
    const explicitStarter = typeof data.starter === "boolean" ? data.starter : null;
    const substituteValue = text(
      stats.find((stat) =>
        statToken(text(stat.label) ?? "").endsWith("substitute"),
      )?.value,
    )?.toLowerCase();
    const inferredStarter = explicitStarter ??
      (substituteValue === "no" || substituteValue === "false"
        ? true
        : substituteValue === "yes" || substituteValue === "true"
          ? false
          : null);
    if ((minutes !== null && minutes > 0) || inferredStarter === true) {
      player.appearances += 1;
      player.minutes += Math.max(0, minutes ?? 0);
    }
    const rating = number(row.rating);
    if (rating !== null) {
      player.ratingTotal += rating;
      player.ratingCount += 1;
    }
    const fixtureEvents = eventsByFixture.get(integer(row.fixture_id) ?? -1) ?? [];
    const sourcePlayerId = integer(row.source_player_id);
    const normalizedPlayerName = normalizedName(name);
    const playerEvents = fixtureEvents.filter((event) =>
      (sourcePlayerId !== null && integer(event.player_id) === sourcePlayerId) ||
      normalizedName(text(event.player_name) ?? "") === normalizedPlayerName,
    );
    const assistEvents = fixtureEvents.filter((event) =>
      (sourcePlayerId !== null && integer(event.assist_id) === sourcePlayerId) ||
      normalizedName(text(event.assist_name) ?? "") === normalizedPlayerName,
    );
    if (appearanceDate >= player.latestAppearance) {
      player.latestAppearance = appearanceDate;
      player.starter = inferredStarter ?? player.starter;
    }
    const passTotal = playerStat(stats, ["passes"], ["total"]);
    const passAccurate =
      playerStat(stats, ["passes"], ["accurate"]) ??
      playerStat(stats, ["passes"], ["accuracy"]);
    player.passTotal += passTotal ?? 0;
    player.passAccurate += passAccurate ?? 0;
    player.keyPasses += playerStat(stats, ["passes"], ["key"]) ?? 0;
    const eventShots = playerEvents.filter((event) => {
      const signal = statToken(
        [text(event.event_type), text(event.detail)]
          .filter(Boolean)
          .join(" "),
      );
      return /\b(shot|attempt|goal)\b/.test(signal);
    });
    const eventShotsOnTarget = eventShots.filter((event) => {
      const signal = statToken(
        [text(event.event_type), text(event.detail), text(event.comments)]
          .filter(Boolean)
          .join(" "),
      );
      return /\b(goal|saved|save)\b/.test(signal);
    }).length;
    const eventXg = playerEvents.reduce(
      (total, event) => total + (eventExpectedGoals(event) ?? 0),
      0,
    );
    player.shots += playerStat(stats, ["shots"], ["total"]) ?? eventShots.length;
    player.shotsOnTarget +=
      playerStat(stats, ["shots"], ["on target", "on goal"]) ?? eventShotsOnTarget;
    player.expectedGoals +=
      playerStat(stats, ["statistics", "bsd"], ["expected_goals"]) ?? eventXg;
    const goalEvents = playerEvents.filter((event) =>
      statToken(text(event.event_type) ?? "") === "goal",
    ).length;
    const eventAssists = assistEvents.filter((event) =>
      statToken(text(event.event_type) ?? "") === "goal",
    ).length;
    player.goals += playerStat(stats, ["goals"], ["total"]) ?? goalEvents;
    player.assists += playerStat(stats, ["goals"], ["assists"]) ?? eventAssists;
    player.duelsTotal += playerStat(stats, ["duels"], ["total"]) ?? 0;
    player.duelsWon += playerStat(stats, ["duels"], ["won"]) ?? 0;
    player.tackles += playerStat(stats, ["tackles"], ["total"]) ?? 0;
    player.interceptions += playerStat(stats, ["tackles"], ["interceptions"]) ?? 0;
    const saves =
      playerStat(stats, ["goals"], ["saves"]) ??
      playerStat(stats, ["goalkeeper", "goalkeeping"], ["saves"]) ??
      0;
    player.saves += saves;
    const playerCardCounts = playerEvents.reduce<{ red: number; yellow: number }>(
      (counts, event) => {
        const eventText = statToken(
          [text(event.event_type), text(event.detail), text(event.comments)]
            .filter(Boolean)
            .join(" "),
        );
        if (/\bred(?: card)?\b/.test(eventText)) counts.red += 1;
        else if (/\byellow(?: card)?\b/.test(eventText)) counts.yellow += 1;
        return counts;
      },
      { red: 0, yellow: 0 },
    );
    player.yellowCards += Math.max(
      playerStat(stats, ["cards"], ["yellow", "yellow card", "yellow cards"]) ?? 0,
      playerCardCounts.yellow,
    );
    player.redCards += Math.max(
      playerStat(stats, ["cards"], ["red", "red card", "red cards"]) ?? 0,
      playerCardCounts.red,
    );
    const position = text(row.position) ?? "";
    const isKeeper = /\b(goalkeeper|keeper|gk|g)\b/i.test(position);
    const opponentGoals = integer(row.opponent_score);
    const conceded =
      playerStat(stats, ["goals", "goalkeeper"], ["conceded", "goals conceded"]) ??
      (isKeeper && minutes !== null && minutes > 0 ? opponentGoals : null);
    if (isKeeper && minutes !== null && minutes > 0 && conceded !== null) {
      player.goalsConceded += conceded;
      const cleanSheet = playerStat(stats, ["goals", "goalkeeper"], ["clean sheets", "clean sheet"]);
      player.cleanSheets += cleanSheet ?? (conceded === 0 ? 1 : 0);
    }
    playerMap.set(key, player);
  }

  return [...playerMap.values()]
    .filter((player) => player.appearances > 0)
    .sort((left, right) =>
      Number(right.starter) - Number(left.starter) ||
      (right.ratingTotal / Math.max(1, right.ratingCount)) -
        (left.ratingTotal / Math.max(1, left.ratingCount)),
    )
    .slice(0, 22)
    .map((player) => {
      const per90 = (value: number) => player.minutes > 0 ? (value / player.minutes) * 90 : 0;
      return {
        playerKey: player.playerKey,
        name: player.name,
        shirtNumber: player.shirtNumber,
        position: player.position,
        age: player.age,
        height: player.height,
        weight: player.weight,
        nationality: player.nationality,
        preferredFoot: player.preferredFoot,
        marketValue: player.marketValue,
        contractUntil: player.contractUntil,
        starter: player.starter,
        appearances: player.appearances,
        ratedAppearances: player.ratingCount,
        minutesPlayed: Math.round(player.minutes),
        cleanSheets: player.cleanSheets,
        goalsConceded: player.goalsConceded,
        totalSaves: Math.round(player.saves),
        yellowCards: player.yellowCards,
        redCards: player.redCards,
        averageRating: player.ratingCount ? player.ratingTotal / player.ratingCount : null,
        minutesPerMatch: player.appearances ? player.minutes / player.appearances : 0,
        passCompletionPct: player.passTotal > 0
          ? Math.min(100, (player.passAccurate / player.passTotal) * 100)
          : null,
        keyPassesPer90: per90(player.keyPasses),
        shotsPer90: per90(player.shots),
        shotAccuracyPct: player.shots > 0
          ? Math.min(100, (player.shotsOnTarget / player.shots) * 100)
          : null,
        expectedGoalsPer90: per90(player.expectedGoals),
        goalsPer90: per90(player.goals),
        assistsPer90: per90(player.assists),
        duelsWonPct: player.duelsTotal > 0
          ? Math.min(100, (player.duelsWon / player.duelsTotal) * 100)
          : null,
        tacklesPer90: per90(player.tackles),
        interceptionsPer90: per90(player.interceptions),
        savesPer90: per90(player.saves),
      };
    });
}

function summarizeTeamStats(teamKey: string): FootballFairAiTeamStats {
  const rows = database
    .prepare(
      `SELECT profiles.fixture_id, profiles.coach_key, profiles.team_statistics_json,
              matches.home_team_key, matches.away_team_key, matches.match_date,
              matches.league_id, matches.season
       FROM fair_ai_team_match_profiles AS profiles
       JOIN fair_ai_matches AS matches ON matches.fixture_id = profiles.fixture_id
       WHERE profiles.team_key = ?
       ORDER BY matches.match_date DESC, matches.fixture_id DESC
       LIMIT 10`,
    )
    .all(teamKey) as SqlRow[];
  const ownStats = rows.map((row) => {
    try {
      return statRows(JSON.parse(String(row.team_statistics_json)));
    } catch {
      return [];
    }
  });
  const opponentStats = rows.map((row) => {
    const opponentKey = row.home_team_key === teamKey
      ? text(row.away_team_key)
      : text(row.home_team_key);
    if (!opponentKey) return [];
    const opponent = database
      .prepare(
        `SELECT team_statistics_json FROM fair_ai_team_match_profiles
         WHERE fixture_id = ? AND team_key = ?`,
      )
      .get(integer(row.fixture_id) ?? 0, opponentKey) as SqlRow | undefined;
    if (!opponent?.team_statistics_json) return [];
    try {
      return statRows(JSON.parse(String(opponent.team_statistics_json)));
    } catch {
      return [];
    }
  });
  const values = (samples: JsonObject[][], aliases: string[]) =>
    average(samples.map((stats) => matchingStat(stats, aliases)));
  const completionValues = (
    samples: JsonObject[][],
    directAliases: string[],
    accurateAliases: string[],
    totalAliases: string[],
  ) =>
    average(samples.map((stats) => {
      const direct = matchingStat(stats, directAliases);
      if (direct !== null) return direct;
      const accurate = matchingStat(stats, accurateAliases);
      const total = matchingStat(stats, totalAliases);
      return accurate !== null && total !== null && total > 0
        ? (accurate / total) * 100
        : null;
    }));
  const defensiveActions = ownStats.map((stats) => {
    if (!stats.length) return null;
    const tackles = matchingStat(stats, ["tackles", "total tackles"]) ?? 0;
    const interceptions = matchingStat(stats, ["interceptions"]) ?? 0;
    const recoveries = matchingStat(stats, ["recoveries"]) ?? 0;
    return tackles + interceptions + recoveries;
  });
  const recoveries = ownStats.map((stats) => matchingStat(stats, ["recoveries"]));
  const coachKey = text(rows.find((row) => text(row.coach_key))?.coach_key);
  const coach = coachKey
    ? database.prepare("SELECT name FROM fair_ai_coaches WHERE coach_key = ?").get(coachKey) as SqlRow | undefined
    : undefined;
  const coachRecord = coachKey
    ? database
        .prepare(
          `SELECT COUNT(*) AS matches,
                  SUM(CASE
                    WHEN (profiles.team_key = matches.home_team_key
                          AND matches.home_score > matches.away_score)
                      OR (profiles.team_key = matches.away_team_key
                          AND matches.away_score > matches.home_score)
                    THEN 1 ELSE 0 END) AS wins,
                  SUM(CASE WHEN matches.home_score = matches.away_score
                           THEN 1 ELSE 0 END) AS draws,
                  SUM(CASE
                    WHEN (profiles.team_key = matches.home_team_key
                          AND matches.home_score < matches.away_score)
                      OR (profiles.team_key = matches.away_team_key
                          AND matches.away_score < matches.home_score)
                    THEN 1 ELSE 0 END) AS losses
           FROM fair_ai_team_match_profiles AS profiles
           JOIN fair_ai_matches AS matches ON matches.fixture_id = profiles.fixture_id
           WHERE profiles.coach_key = ?
             AND matches.home_score IS NOT NULL
             AND matches.away_score IS NOT NULL`,
        )
        .get(coachKey) as SqlRow | undefined
    : undefined;
  const competitionCounts = new Map<
    string,
    { leagueId: number; season: number; count: number; firstRowIndex: number }
  >();
  rows.forEach((row, index) => {
    const leagueId = integer(row.league_id);
    const season = integer(row.season);
    if (leagueId === null || season === null) return;
    const key = `${leagueId}:${season}`;
    const current = competitionCounts.get(key);
    if (current) current.count += 1;
    else competitionCounts.set(key, { leagueId, season, count: 1, firstRowIndex: index });
  });
  const primaryCompetition = [...competitionCounts.values()].sort(
    (left, right) =>
      right.count - left.count || left.firstRowIndex - right.firstRowIndex,
  )[0];
  const latestStanding = primaryCompetition
    ? database
        .prepare(
          `SELECT standing.league_id, standing.season, standing.rank, standing.played,
                  standing.points, standing.goal_difference, standing.form,
                  standing.observed_at,
                  (
                    SELECT COUNT(DISTINCT peer.team_key)
                    FROM fair_ai_standings_snapshots AS peer
                    WHERE peer.league_id = standing.league_id
                      AND peer.season = standing.season
                      AND peer.observed_at = standing.observed_at
                  ) AS team_count
           FROM fair_ai_standings_snapshots AS standing
           WHERE standing.team_key = ?
             AND standing.league_id = ?
             AND standing.season = ?
           ORDER BY standing.observed_at DESC
           LIMIT 1`,
        )
        .get(teamKey, primaryCompetition.leagueId, primaryCompetition.season) as
        | SqlRow
        | undefined
    : undefined;
  const fixtureIds = rows
    .map((row) => integer(row.fixture_id))
    .filter((fixtureId): fixtureId is number => fixtureId !== null);
  let cardRows: SqlRow[] = [];
  if (fixtureIds.length) {
    const placeholders = fixtureIds.map(() => "?").join(", ");
    cardRows = database
      .prepare(
        `SELECT fixture_id, event_type, detail, comments
         FROM fair_ai_match_events
         WHERE team_key = ? AND fixture_id IN (${placeholders})`,
      )
      .all(teamKey, ...fixtureIds) as SqlRow[];
  }
  const eventMatchCount = new Set(
    cardRows.map((row) => integer(row.fixture_id)).filter((value) => value !== null),
  ).size;
  const cardCounts = cardRows.reduce<{ red: number; yellow: number }>(
    (counts, row) => {
      const eventText = statToken(
        [text(row.event_type), text(row.detail), text(row.comments)]
          .filter(Boolean)
          .join(" "),
      );
      if (/\bred(?: card)?\b/.test(eventText)) counts.red += 1;
      else if (/\byellow(?: card)?\b/.test(eventText)) counts.yellow += 1;
      return counts;
    },
    { red: 0, yellow: 0 },
  );
  const eventExpectedGoalsByFixture = new Map<number, number>();
  for (const event of cardRows) {
    const fixtureId = integer(event.fixture_id);
    const xg = eventExpectedGoals(event);
    if (fixtureId === null || xg === null) continue;
    eventExpectedGoalsByFixture.set(
      fixtureId,
      (eventExpectedGoalsByFixture.get(fixtureId) ?? 0) + xg,
    );
  }
  const expectedGoalsFor = average(
    ownStats.map((stats, index) => {
      const sourceXg = matchingStat(stats, ["expected goals", "expected goals xg", "xg"]);
      if (sourceXg !== null) return sourceXg;
      const fixtureId = integer(rows[index]?.fixture_id);
      return fixtureId === null ? null : eventExpectedGoalsByFixture.get(fixtureId) ?? null;
    }),
  );
  const lastMatchDate = Date.parse(String(rows[0]?.match_date ?? ""));
  const daysSinceLastMatch = Number.isFinite(lastMatchDate)
    ? Math.max(0, (Date.now() - lastMatchDate) / 86_400_000)
    : null;
  const coachMatches = integer(coachRecord?.matches) ?? 0;
  const coachWins = integer(coachRecord?.wins) ?? 0;
  const coachDraws = integer(coachRecord?.draws) ?? 0;
  const coachLosses = integer(coachRecord?.losses) ?? 0;

  return {
    expectedGoalsFor,
    expectedGoalsAgainst: values(opponentStats, ["expected goals", "expected goals xg", "xg"]),
    possessionPct: values(ownStats, ["ball possession", "possession"]),
    shotsPerMatch: values(ownStats, ["total shots", "shots"]),
    shotsOnTargetPerMatch: values(ownStats, ["shots on goal", "shots on target"]),
    passesPerMatch: values(ownStats, ["total passes", "passes"]),
    shotsInsideBoxPerMatch: values(ownStats, ["shots inside box", "shots inside the box", "shots insidebox"]),
    boxTouchesPerMatch: values(ownStats, ["touches in opposition box", "touches in opponent box"]),
    bigChancesPerMatch: values(ownStats, ["big chances"]),
    bigChancesMissedPerMatch: values(ownStats, ["big chances missed"]),
    passCompletionPct: completionValues(
      ownStats,
      ["passes %", "passes percentage", "pass accuracy"],
      ["passes accurate", "accurate passes"],
      ["total passes", "passes"],
    ),
    longBallCompletionPct: completionValues(
      ownStats,
      ["accurate long balls %", "long balls %", "long ball accuracy"],
      ["accurate long balls"],
      ["total long balls", "long balls"],
    ),
    finalThirdPassCompletionPct: completionValues(
      ownStats,
      ["passes in final third %", "final third passes %"],
      ["accurate passes in final third", "accurate final third passes"],
      ["passes in final third", "final third passes"],
    ),
    duelWinPct: completionValues(
      ownStats,
      ["duels %", "duels won %", "duel win percentage"],
      ["duels won"],
      ["total duels", "duels"],
    ),
    defensiveActionsPerMatch: average(defensiveActions),
    recoveriesPerMatch: average(recoveries),
    redCardsPerMatch: eventMatchCount ? cardCounts.red / eventMatchCount : null,
    yellowCardsPerMatch: eventMatchCount ? cardCounts.yellow / eventMatchCount : null,
    leagueId: integer(latestStanding?.league_id),
    leagueSeason: integer(latestStanding?.season),
    leagueRank: integer(latestStanding?.rank),
    leaguePlayed: integer(latestStanding?.played),
    leaguePoints: integer(latestStanding?.points),
    goalDifference: integer(latestStanding?.goal_difference),
    leagueForm: text(latestStanding?.form),
    leagueTeamCount: integer(latestStanding?.team_count) ?? 0,
    leagueStandingObservedAt: text(latestStanding?.observed_at),
    coachMatches,
    coachWins,
    coachDraws,
    coachLosses,
    coachWinPct: coachMatches ? (coachWins / coachMatches) * 100 : null,
    daysSinceLastMatch,
    matchStatSampleCount: ownStats.filter((stats) => stats.length > 0).length,
    coachName: text(coach?.name),
  };
}

function simulationTeam(team: FootballFairAiTeam): FootballFairAiTeam {
  return {
    ...team,
    teamStats: summarizeTeamStats(team.teamKey),
    players: summarizePlayers(team.teamKey),
  };
}

export async function runFairAiArchiveSimulation(
  input: FootballFairAiSimulationInput,
): Promise<FootballFairAiSimulation | null> {
  const homeBase = fairAiTeamRows("", input.homeTeamKey)[0];
  const awayBase = fairAiTeamRows("", input.awayTeamKey)[0];
  if (!homeBase || !awayBase) return null;
  await refreshFairAiTeamsFromSource([input.homeTeamKey, input.awayTeamKey]);
  const refreshedHomeBase = fairAiTeamRows("", input.homeTeamKey)[0];
  const refreshedAwayBase = fairAiTeamRows("", input.awayTeamKey)[0];
  if (!refreshedHomeBase || !refreshedAwayBase) return null;
  const home = simulationTeam(refreshedHomeBase);
  const away = simulationTeam(refreshedAwayBase);
  return runFairAiPossessionSimulation(home, away, input.iterations ?? 10_000);
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
  const completed = stateStatus(state) === "completed";
  const previousCount = completed ? 0 : numericState(state, "processed_fixture_count");
  const previousSkipped = completed ? 0 : numericState(state, "skipped_fixture_count");
  const cursor = completed ? 0 : numericState(state, "cursor_fixture_id");
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
