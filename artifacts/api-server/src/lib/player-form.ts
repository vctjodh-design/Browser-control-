// What a footballer actually did, read from the match feeds that publish it.
//
// The app's own predictions come from team-level numbers. This module goes one
// level down: every player's rating, his whole stat block, the coordinates of
// every shot he took and the heat map of where he spent the match. Those are
// kept per match in SQLite (player-form-store.ts), so a player accumulates a
// history rather than a single afternoon.
//
// The last part turns that history into weights on the engine's own skills. It
// is deliberately not an average of ratings: each match contributes an
// adjustment to the individual abilities its statistics speak to — finishing
// from his shots and their xG, tackling from his duels, reflexes from his saves
// — decayed by how old the match is and capped so a purple patch cannot turn a
// squad player into a striker with 20 finishing.
//
// Source: FotMob's public match feed (www.fotmob.com/api/data/...). The same
// numbers 365Scores shows for a player come from the same Opta family of stats;
// FotMob exposes them as JSON, which 365Scores' web API does not.
import {
  readAvailability,
  readFixtureSource,
  readPlayerPerformances,
  readStoredMatches,
  saveAvailability,
  saveFixtureSource,
  savePerformances,
  type StoredAvailability,
  type StoredHeatPoint,
  type StoredPerformance,
  type StoredShot,
} from "./player-form-store.ts";

const FOTMOB = "https://www.fotmob.com/api/data";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const matchCache = new Map<number, Promise<FotMobMatchForm>>();

export class PlayerFormUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerFormUnavailableError";
  }
}

async function fotmobJson<T>(path: string): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${FOTMOB}/${path}`, {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new PlayerFormUnavailableError(`The match feed answered ${response.status}.`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new PlayerFormUnavailableError("The match feed could not be read.");
}

// ---------------------------------------------------------------------------
// Reading one match
// ---------------------------------------------------------------------------

type FotMobStatEntry = {
  key?: string | null;
  stat?: { value?: unknown; total?: unknown; type?: string };
};
type FotMobStatGroup = { title?: string; stats?: Record<string, FotMobStatEntry> };
type FotMobPlayerStats = {
  id: number;
  optaId?: string;
  name: string;
  teamId: number;
  teamName: string;
  isGoalkeeper?: boolean;
  stats?: FotMobStatGroup[];
  shotmap?: Record<string, unknown>[];
};
type FotMobLineupPlayer = {
  id: number;
  name: string;
  shirtNumber?: string;
  positionId?: number;
  performance?: { rating?: number | null };
};
type FotMobLineupSide = {
  id: number;
  name: string;
  formation?: string;
  starters?: FotMobLineupPlayer[];
  subs?: FotMobLineupPlayer[];
  unavailable?: {
    id: number;
    name: string;
    unavailability?: { type?: string; expectedReturn?: string | null };
  }[];
};
type FotMobMatchDetails = {
  general?: { matchId?: string; matchName?: string; matchTimeUTCDate?: string };
  content?: {
    lineup?: { homeTeam?: FotMobLineupSide; awayTeam?: FotMobLineupSide };
    playerStats?: Record<string, FotMobPlayerStats>;
  };
};
type FotMobSuggestion = { type?: string; id?: string; name?: string; leagueName?: string };

export type PlayerFormTeam = {
  teamId: number;
  name: string;
  formation: string | null;
  players: PlayerFormPlayer[];
  unavailable: { playerId: number; name: string; kind: StoredAvailability["kind"]; expectedReturn: string | null }[];
};

export type PlayerFormPlayer = {
  playerId: number;
  name: string;
  shirt: number | null;
  rating: number | null;
  minutes: number;
  starter: boolean;
  stats: Record<string, number | null>;
  shots: StoredShot[];
  heat: StoredHeatPoint[];
  weights: PlayerFormWeights;
};

export type PlayerFormWeights = {
  /** Additive points on the engine's 1..20 skill scale, per skill. */
  skills: Record<string, number>;
  /** Additive levels on the engine's 1..20 overall scale. */
  level: number;
  /** How many stored matches the weights were read from. */
  games: number;
  /** Mean rating across those matches, and the direction of the last three. */
  rating: number | null;
  trend: number | null;
  /** One short line per skill that moved most, for the panel. */
  notes: string[];
};

export type FotMobMatchForm = {
  matchId: number;
  date: string;
  source: "fotmob";
  teams: [PlayerFormTeam, PlayerFormTeam];
};

function numericStat(entry: FotMobStatEntry | undefined): number | null {
  if (!entry) return null;
  const value = entry.stat?.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace("%", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Flatten the feed's stat groups into one map keyed by the machine name.
 *
 * The feed labels a stat both ways — "Expected goals (xG)" and
 * `expected_goals` — and only the second one is stable across languages, so
 * that is what the weighting reads. Fractions keep their own total so a pass
 * completion rate is never mistaken for a count.
 */
function flattenStats(groups: FotMobStatGroup[] | undefined): Record<string, number | null> {
  const stats: Record<string, number | null> = {};
  for (const group of groups ?? []) {
    for (const [label, entry] of Object.entries(group.stats ?? {})) {
      const key = typeof entry.key === "string" && entry.key ? entry.key : label;
      if (!key) continue;
      const value = numericStat(entry);
      stats[key] = value;
      const total = entry.stat?.total;
      if (typeof total === "number") stats[`${key}_total`] = total;
    }
  }
  return stats;
}

function toShot(raw: Record<string, unknown>): StoredShot | null {
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const xg = Number(raw.expectedGoals);
  const xgot = Number(raw.expectedGoalsOnTarget);
  return {
    minute: Number.isFinite(Number(raw.min)) ? Number(raw.min) : null,
    x,
    y,
    expectedGoals: Number.isFinite(xg) ? xg : null,
    expectedGoalsOnTarget: Number.isFinite(xgot) ? xgot : null,
    onTarget: raw.isOnTarget === true,
    blocked: raw.isBlocked === true,
    insideBox: raw.isFromInsideBox === true,
    situation: typeof raw.situation === "string" ? raw.situation : null,
    bodyPart: typeof raw.shotType === "string" ? raw.shotType : null,
    outcome: typeof raw.eventType === "string" ? raw.eventType : "Attempt",
  };
}

/**
 * The feed ships the heat map as SVG circles, one group per player, keyed by
 * the provider's own athlete id rather than the feed's player id. The caller
 * joins them through `playerStats[id].optaId`.
 */
async function fetchHeat(matchId: number): Promise<Map<number, StoredHeatPoint[]>> {
  const byPlayer = new Map<number, StoredHeatPoint[]>();
  try {
    const payload = await fotmobJson<{ players?: Record<string, string> }>(
      `heatmap/match/${matchId}/heatmaps?heatmapUrl=${encodeURIComponent(
        `https://pub.fotmob.com/prod/db/api/heatmap/match/${matchId}`,
      )}`,
    );
    for (const [key, svg] of Object.entries(payload.players ?? {})) {
      const playerId = Number(key.replace(/^p/, ""));
      if (!Number.isSafeInteger(playerId)) continue;
      const points: StoredHeatPoint[] = [];
      for (const match of svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
        points.push({
          x: Number(match[1]),
          y: Number(match[2]),
          intensity: Math.min(1, Number(match[3]) / 10),
        });
      }
      if (points.length) byPlayer.set(playerId, points);
    }
  } catch {
    // A missing heat map must not cost the ratings and the stat block.
  }
  return byPlayer;
}

function availabilityKind(raw: string | undefined): StoredAvailability["kind"] {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("suspend")) return "suspension";
  if (value.includes("injur") || value.includes("doubt")) return "injury";
  return "other";
}

async function loadMatch(matchId: number): Promise<FotMobMatchForm> {
  const cached = matchCache.get(matchId);
  if (cached) return cached;

  const pending = (async () => {
    const [details, heat] = await Promise.all([
      fotmobJson<FotMobMatchDetails>(`matchDetails?matchId=${matchId}`),
      fetchHeat(matchId),
    ]);
    const lineup = details.content?.lineup;
    const sides = [lineup?.homeTeam, lineup?.awayTeam].filter(
      (side): side is FotMobLineupSide => Boolean(side && typeof side.id === "number"),
    );
    if (sides.length !== 2) {
      throw new PlayerFormUnavailableError("The feed had no lineups for that match.");
    }

    const playerStats = details.content?.playerStats ?? {};
    const ratings = new Map<number, number | null>();
    const starters = new Set<number>();
    for (const side of sides) {
      for (const player of side.starters ?? []) {
        starters.add(player.id);
        ratings.set(player.id, player.performance?.rating ?? null);
      }
      for (const player of side.subs ?? []) {
        if (!ratings.has(player.id)) ratings.set(player.id, player.performance?.rating ?? null);
      }
    }

    const date =
      details.general?.matchTimeUTCDate ??
      (details.general?.matchName?.match(/([A-Z][a-z]{2}, [A-Z][a-z]{2} \d+, \d{4}.*)$/)?.[1] ?? "") ??
      "";

    const teams = sides.map((side) => {
      const players: PlayerFormPlayer[] = [];
      const seen = new Set<number>();
      for (const entry of [...(side.starters ?? []), ...(side.subs ?? [])]) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        const stats = playerStats[String(entry.id)];
        const flat = flattenStats(stats?.stats);
        const shots = (stats?.shotmap ?? [])
          .map(toShot)
          .filter((shot): shot is StoredShot => Boolean(shot));
        const minutes = Number(flat.minutes_played ?? 0) || 0;
        players.push({
          playerId: entry.id,
          name: entry.name,
          shirt: entry.shirtNumber ? Number(entry.shirtNumber) : null,
          rating: ratings.get(entry.id) ?? null,
          minutes,
          starter: (side.starters ?? []).some((starter) => starter.id === entry.id),
          stats: flat,
          shots,
          heat: heat.get(Number(stats?.optaId)) ?? heat.get(entry.id) ?? [],
          weights: emptyWeights(),
        });
      }

      const unavailable = (side.unavailable ?? []).map((entry) => ({
        playerId: entry.id,
        name: entry.name,
        kind: availabilityKind(entry.unavailability?.type),
        expectedReturn: entry.unavailability?.expectedReturn ?? null,
      }));

      return {
        teamId: side.id,
        name: side.name,
        formation: side.formation ?? null,
        players,
        unavailable,
      };
    }) as [PlayerFormTeam, PlayerFormTeam];

    return { matchId, date, source: "fotmob" as const, teams };
  })();

  matchCache.set(matchId, pending);
  try {
    return await pending;
  } catch (error) {
    matchCache.delete(matchId);
    throw error;
  }
}

function emptyWeights(): PlayerFormWeights {
  return { skills: {}, level: 0, games: 0, rating: null, trend: null, notes: [] };
}

function normaliseName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|sk|sc|ac|club|city|united|fk)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How much two spellings of a footballer's name are the same footballer. */
export function nameSimilarity(left: string, right: string): number {
  const a = normaliseName(left);
  const b = normaliseName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  const surnameA = aParts.at(-1) ?? "";
  const surnameB = bParts.at(-1) ?? "";
  if (surnameA && surnameA === surnameB) {
    // "Tchouaméni" and "Aurélien Tchouaméni" are the same man: one spelling
    // carries the first name and the other does not.
    if (aParts.length === 1 || bParts.length === 1) return 0.9;
    const firstA = aParts[0]?.[0] ?? "";
    const firstB = bParts[0]?.[0] ?? "";
    return firstA && firstB && firstA === firstB ? 0.95 : 0.8;
  }
  if (a.includes(b) || b.includes(a)) return 0.7;
  const setA = new Set(aParts);
  const shared = bParts.filter((part) => setA.has(part)).length;
  return shared / Math.max(aParts.length, bParts.length);
}

/** Find the feed's match for a fixture, by the two club names. */
export async function resolveFotMobMatch(home: string, away: string): Promise<number | null> {
  const query = encodeURIComponent(`${home} ${away}`);
  let suggestions: { suggestions?: FotMobSuggestion[] }[] = [];
  try {
    suggestions = await fotmobJson<{ suggestions?: FotMobSuggestion[] }[]>(`search/suggest?term=${query}`);
  } catch {
    return null;
  }
  const candidates = suggestions
    .flatMap((group) => group.suggestions ?? [])
    .filter((entry) => entry.type === "match" && entry.id)
    .slice(0, 4);

  for (const candidate of candidates) {
    const matchId = Number(candidate.id);
    if (!Number.isSafeInteger(matchId)) continue;
    try {
      const details = await fotmobJson<FotMobMatchDetails>(`matchDetails?matchId=${matchId}`);
      const name = details.general?.matchName ?? "";
      const [homePart, awayPart] = name.split("-vs-");
      if (!homePart || !awayPart) continue;
      const homeScore = nameSimilarity(homePart, home);
      const awayScore = nameSimilarity(awayPart.split("_")[0] ?? awayPart, away);
      if (homeScore >= 0.6 && awayScore >= 0.6) return matchId;
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Turning performances into weights
// ---------------------------------------------------------------------------

type SkillRule = {
  skill: string;
  /**
   * One entry per statistic that speaks to this skill. `ref` is what an
   * ordinary 90 minutes at this level produces; the weight is the distance
   * from it, per 90 played, times `per`. Distance from a reference, not the
   * raw count, is what makes the adjustment about the player rather than
   * about the position: forty completed passes is a quiet match for a deep
   * midfielder and a very busy one for a centre-forward.
   */
  from: { stat: string; ref: number; per: number }[];
};

/**
 * Which statistic speaks to which ability.
 *
 * Every entry is a real column in the feed's stat block; a missing one simply
 * contributes nothing, so a keeper never gets finishing points from an empty
 * shot list and a centre-back is not punished for stats his role never sees.
 */
const SKILL_RULES: SkillRule[] = [
  {
    skill: "finishing",
    from: [
      { stat: "goals", ref: 0.25, per: 0.5 },
      { stat: "expected_goals_on_target_variant", ref: 0.35, per: 0.3 },
      { stat: "ShotsOnTarget", ref: 1.2, per: 0.12 },
    ],
  },
  {
    skill: "composure",
    from: [
      { stat: "goals", ref: 0.25, per: 0.25 },
      { stat: "dispossessed", ref: 5, per: -0.02 },
    ],
  },
  {
    skill: "long_shots",
    from: [
      { stat: "expected_goals", ref: 0.35, per: 0.3 },
      { stat: "total_shots", ref: 1.6, per: 0.08 },
    ],
  },
  { skill: "heading", from: [{ stat: "aerials_won", ref: 1.5, per: 0.1 }] },
  {
    skill: "passing",
    from: [
      { stat: "accurate_passes", ref: 28, per: 0.012 },
      { stat: "chances_created", ref: 1.2, per: 0.08 },
      { stat: "expected_assists", ref: 0.12, per: 0.6 },
    ],
  },
  {
    skill: "technique",
    from: [
      { stat: "chances_created", ref: 1.2, per: 0.05 },
      { stat: "successful_dribbles", ref: 1.2, per: 0.05 },
      { stat: "line_breaking_passes", ref: 1, per: 0.04 },
    ],
  },
  {
    skill: "dribbling",
    from: [
      { stat: "successful_dribbles", ref: 1.2, per: 0.08 },
      { stat: "touches_opposition_box", ref: 3, per: 0.015 },
    ],
  },
  {
    skill: "crossing",
    from: [
      { stat: "accurate_crosses", ref: 0.8, per: 0.15 },
      { stat: "corners_taken", ref: 0.5, per: 0.05 },
    ],
  },
  {
    skill: "tackling",
    from: [
      { stat: "tackles", ref: 2, per: 0.1 },
      { stat: "tackles_won", ref: 1.2, per: 0.1 },
    ],
  },
  {
    skill: "marking",
    from: [
      { stat: "interceptions", ref: 1.2, per: 0.12 },
      { stat: "clearances", ref: 2, per: 0.05 },
      { stat: "dribbled_past", ref: 0.8, per: -0.12 },
    ],
  },
  {
    skill: "anticipation",
    from: [
      { stat: "interceptions", ref: 1.2, per: 0.1 },
      { stat: "recoveries", ref: 5, per: 0.03 },
    ],
  },
  {
    skill: "positioning",
    from: [
      { stat: "blocks", ref: 0.8, per: 0.08 },
      { stat: "dribbled_past", ref: 0.8, per: -0.1 },
    ],
  },
  { skill: "off_the_ball", from: [{ stat: "touches_opposition_box", ref: 3, per: 0.03 }] },
  {
    skill: "work_rate",
    from: [
      { stat: "recoveries", ref: 5, per: 0.03 },
      { stat: "defensive_actions", ref: 4, per: 0.03 },
    ],
  },
  { skill: "stamina", from: [{ stat: "minutes_played", ref: 75, per: 0.01 }] },
  {
    skill: "strength",
    from: [
      { stat: "duels_won", ref: 5, per: 0.04 },
      { stat: "duels_lost", ref: 5, per: -0.03 },
    ],
  },
  { skill: "jumping", from: [{ stat: "aerials_won", ref: 1.5, per: 0.06 }] },
  {
    skill: "reflexes",
    from: [
      { stat: "saves", ref: 2.5, per: 0.12 },
      { stat: "goals_prevented", ref: 0, per: 0.3 },
    ],
  },
  {
    skill: "handling",
    from: [
      { stat: "saves", ref: 2.5, per: 0.08 },
      { stat: "punches", ref: 0.3, per: 0.12 },
    ],
  },
  { skill: "one_on_ones", from: [{ stat: "saves_inside_box", ref: 1.2, per: 0.15 }] },
  { skill: "aerial_reach", from: [{ stat: "high_claims", ref: 0.5, per: 0.2 }] },
  {
    skill: "command_of_area",
    from: [
      { stat: "high_claims", ref: 0.5, per: 0.2 },
      { stat: "punches", ref: 0.3, per: 0.1 },
    ],
  },
  { skill: "kicking", from: [{ stat: "long_balls_accurate", ref: 2, per: 0.05 }] },
];

/** Skills only a keeper's match can speak to, and the ones only the outfield
 *  can: a keeper is not marked down for tackles he never makes, and a striker
 *  is not credited with saves he never made. */
const KEEPER_SKILLS = new Set([
  "reflexes",
  "handling",
  "one_on_ones",
  "aerial_reach",
  "command_of_area",
  "kicking",
]);
const OUTFIELD_SKILLS = new Set([
  "finishing",
  "long_shots",
  "composure",
  "heading",
  "jumping",
  "dribbling",
  "crossing",
  "tackling",
  "marking",
  "anticipation",
  "positioning",
  "off_the_ball",
  "strength",
  "work_rate",
]);

const SKILL_CAP = 2.2;
const LEVEL_CAP = 1.6;
const MATCH_SKILL_CAP = 0.7;

function recencyWeight(date: string, newest: number): number {
  const played = new Date(date).getTime();
  if (!Number.isFinite(played)) return 0.4;
  const ageDays = Math.max(0, (newest - played) / (1000 * 60 * 60 * 24));
  return Math.pow(0.5, ageDays / 45);
}

/**
 * The additive weight one player's history puts on his skills.
 *
 * Each match contributes `recency × statistic × rule` to the abilities that
 * statistic speaks to. Nothing is averaged away: a striker who has scored in
 * four straight matches carries four separate finishing adjustments, decaying
 * with age, instead of one blended number. The total is capped per skill so
 * the base the table and the rating gave him still dominates.
 */
export function weightsFromPerformances(performances: StoredPerformance[]): PlayerFormWeights {
  if (!performances.length) return emptyWeights();
  const newest = Math.max(
    ...performances.map((row) => new Date(row.date).getTime()).filter((value) => Number.isFinite(value)),
  );
  const ordered = [...performances].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

  const skills: Record<string, number> = {};
  let level = 0;
  let weightSum = 0;
  const ratings: { date: string; rating: number }[] = [];

  for (const row of ordered) {
    if (row.minutes < 20 || row.rating === null) continue;
    const weight = recencyWeight(row.date, newest);
    const nineties = Math.max(0.25, row.minutes / 90);
    weightSum += weight;
    level += weight * (row.rating - 6.8) * 0.32;
    ratings.push({ date: row.date, rating: row.rating });

    const isKeeper = "saves" in row.stats || "goals_conceded" in row.stats;
    const perMatch: Record<string, number> = {};
    for (const rule of SKILL_RULES) {
      if (isKeeper ? OUTFIELD_SKILLS.has(rule.skill) : KEEPER_SKILLS.has(rule.skill)) continue;
      let points = 0;
      for (const { stat, ref, per } of rule.from) {
        const raw = row.stats[stat];
        if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
        // Per 90, so a 20-minute cameo cannot read as a bad match.
        const rate = stat === "minutes_played" ? raw : raw / nineties;
        points += (rate - ref) * per;
      }
      if (points) perMatch[rule.skill] = (perMatch[rule.skill] ?? 0) + points;
    }

    // Pass completion is a rate of its own, and a far better signal than the
    // count: 48% of 21 passes and 48% of 60 are not the same performance.
    const completed = row.stats.accurate_passes;
    const attempted = row.stats.accurate_passes_total;
    if (typeof completed === "number" && typeof attempted === "number" && attempted >= 8) {
      perMatch.passing = (perMatch.passing ?? 0) + (completed / attempted - 0.8) * 1.2;
    }

    for (const [skill, points] of Object.entries(perMatch)) {
      const bounded = Math.max(-MATCH_SKILL_CAP, Math.min(MATCH_SKILL_CAP, points));
      skills[skill] = (skills[skill] ?? 0) + bounded * weight;
    }
  }

  const rounded: Record<string, number> = {};
  for (const [skill, value] of Object.entries(skills)) {
    const bounded = Math.max(-SKILL_CAP, Math.min(SKILL_CAP, value));
    if (Math.abs(bounded) >= 0.05) rounded[skill] = Math.round(bounded * 100) / 100;
  }

  const mean = ratings.length
    ? Math.round((ratings.reduce((total, entry) => total + entry.rating, 0) / ratings.length) * 100) / 100
    : null;
  const sorted = [...ratings].sort((a, b) => a.date.localeCompare(b.date));
  const early = sorted.slice(0, 3);
  const late = sorted.slice(-3);
  const trend =
    early.length >= 2 && late.length >= 2
      ? Math.round(
          (late.reduce((t, e) => t + e.rating, 0) / late.length -
            early.reduce((t, e) => t + e.rating, 0) / early.length) * 100,
        ) / 100
      : null;

  const notes = Object.entries(rounded)
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .slice(0, 3)
    .map(([skill, value]) => `${skill.replace(/_/g, " ")} ${value > 0 ? "+" : ""}${value.toFixed(2)}`);

  return {
    skills: rounded,
    level: Math.round(Math.max(-LEVEL_CAP, Math.min(LEVEL_CAP, level)) * 100) / 100,
    games: weightSum > 0 ? ratings.length : 0,
    rating: mean,
    trend,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Collecting a fixture's sides
// ---------------------------------------------------------------------------

/** The matches a player has appeared in, newest first, with the feed's rating. */
export type PlayerMatchLogEntry = {
  matchId: number;
  date: string;
  opponent: string;
  home: boolean;
  minutes: number;
  rating: number | null;
  goals: number;
  assists: number;
  league: string;
};

type FotMobPlayerMatch = {
  id: number;
  matchDate?: { utcTime?: string };
  opponentTeamName?: string;
  isHomeTeam?: boolean;
  minutesPlayed?: number;
  goals?: number;
  assists?: number;
  leagueName?: string;
  ratingProps?: { rating?: string | number };
};

export async function readPlayerMatchLog(
  playerId: number,
  limit = 30,
): Promise<PlayerMatchLogEntry[]> {
  const data = await fotmobJson<{ recentMatches?: FotMobPlayerMatch[] }>(`playerData?id=${playerId}`);
  return (data.recentMatches ?? []).slice(0, limit).map((row) => {
    const rawRating = row.ratingProps?.rating;
    const rating = typeof rawRating === "number" ? rawRating : Number(rawRating);
    return {
      matchId: row.id,
      date: row.matchDate?.utcTime ?? "",
      opponent: row.opponentTeamName ?? "",
      home: row.isHomeTeam === true,
      minutes: Number(row.minutesPlayed ?? 0) || 0,
      rating: Number.isFinite(rating) && rating > 0 ? rating : null,
      goals: Number(row.goals ?? 0) || 0,
      assists: Number(row.assists ?? 0) || 0,
      league: row.leagueName ?? "",
    };
  });
}

/** Write one match's players and availability into the store. */
function persistMatch(form: FotMobMatchForm): void {
  const rows: StoredPerformance[] = [];
  for (const team of form.teams) {
    for (const player of team.players) {
      rows.push({
        playerId: player.playerId,
        matchId: form.matchId,
        teamId: team.teamId,
        teamName: team.name,
        name: player.name,
        date: form.date || new Date().toISOString(),
        minutes: player.minutes,
        rating: player.rating,
        stats: player.stats,
        shots: player.shots,
        heat: player.heat,
      });
    }
    saveAvailability(
      team.unavailable.map((entry) => ({
        teamId: team.teamId,
        playerId: entry.playerId,
        name: entry.name,
        kind: entry.kind,
        expectedReturn: entry.expectedReturn,
      })),
    );
  }
  savePerformances(rows);
}

/** Read a handful of match ids into the store, skipping what is already there. */
async function ingestMatches(matchIds: number[]): Promise<void> {
  const wanted = [...new Set(matchIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!wanted.length) return;
  const known = readStoredMatches(wanted);
  const missing = wanted.filter((id) => !known.has(id));
  const workers = 2;
  let cursor = 0;

  const run = async () => {
    while (cursor < missing.length) {
      const matchId = missing[cursor];
      cursor += 1;
      try {
        persistMatch(await loadMatch(matchId));
      } catch {
        // One unreadable match must not stop the history.
      }
    }
  };

  await Promise.all(Array.from({ length: workers }, () => run()));
}

/**
 * The whole picture for one fixture: both sides, every player's rating and
 * stat block for this match, his heat map and shot map, the weights his stored
 * history puts on him, and who is out injured or suspended.
 */
export async function loadFixturePlayerForm(
  fixtureId: number,
  home: string,
  away: string,
  options: { historyMatches?: number } = {},
): Promise<FotMobMatchForm> {
  const cached = readFixtureSource(fixtureId);
  const matchId = cached?.matchId ?? (await resolveFotMobMatch(home, away));
  if (!matchId) {
    throw new PlayerFormUnavailableError(
      `No player data feed was found for ${home} against ${away}.`,
    );
  }
  if (!cached) saveFixtureSource(fixtureId, matchId, "fotmob");

  const form = await loadMatch(matchId);
  // The fixture's own match is always rewritten, never skipped: it is the one
  // the panel shows, so it must reflect the feed as it is now.
  persistMatch(form);

  // Each starter's recent matches, so the weights come from a history rather
  // than this one afternoon. The ids overlap heavily across a squad, so this is
  // a dozen or so match reads, not twenty-two players' worth.
  const historyIds: number[] = [];
  const perPlayer = Math.max(1, Math.min(12, options.historyMatches ?? 5));
  await Promise.all(
    form.teams.flatMap((team) =>
      team.players
        .filter((player) => player.starter)
        .slice(0, 11)
        .map(async (player) => {
          try {
            const log = await readPlayerMatchLog(player.playerId, perPlayer + 1);
            historyIds.push(...log.filter((entry) => entry.minutes > 0).map((entry) => entry.matchId));
          } catch {
            // A player with no readable log still has this match.
          }
        }),
    ),
  );
  await ingestMatches(historyIds);

  for (const team of form.teams) {
    for (const player of team.players) {
      const history = readPlayerPerformances(player.playerId, 20);
      player.weights = weightsFromPerformances(history);
      if (!player.weights.games && player.rating !== null) {
        player.weights = weightsFromPerformances([
          {
            playerId: player.playerId,
            matchId: form.matchId,
            teamId: team.teamId,
            teamName: team.name,
            name: player.name,
            date: form.date,
            minutes: player.minutes,
            rating: player.rating,
            stats: player.stats,
            shots: player.shots,
            heat: player.heat,
          },
        ]);
      }
    }
  }

  return form;
}

/** Who the feed says is unavailable for a side, newest answer first. */
export async function unavailableForTeam(teamId: number): Promise<StoredAvailability[]> {
  return readAvailability(teamId);
}

/** The latest weights a player's history supports, from the store alone. */
export function storedWeights(playerId: number): PlayerFormWeights {
  return weightsFromPerformances(readPlayerPerformances(playerId, 20));
}

/** Best player of the match by the feed's rating. */
export function topRated(form: FotMobMatchForm): PlayerFormPlayer | null {
  const all = form.teams.flatMap((team) => team.players).filter((player) => player.rating !== null);
  if (!all.length) return null;
  return all.reduce((best, player) => ((player.rating ?? 0) > (best.rating ?? 0) ? player : best));
}
