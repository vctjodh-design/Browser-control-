// Turns a fixture's surrounding match data into the inputs the browser
// simulation needs: recent form, the way each side actually plays, and the XI
// the last few team sheets point to.
//
// Nothing here decides a winner. It reads what the clubs have done (results,
// team statistics, individual ratings and per-match output) and hands the
// simulation style and trait signals, so the match still has to be played.

import type {
  FootballLastFiveLineup,
  FootballLastFivePlayer,
  FootballLastFivePlayerGroup,
  FootballLastFiveStat,
  FootballLastFiveTeamStatistics,
  FootballRecentMatch,
} from "@workspace/api-zod";
import { getKickoffScoreMatchDetails } from "./kickoffscore-match-details";
import {
  getHistoricalMatchSnapshot,
  type HistoricalMatchSnapshot,
} from "./kickoffscore-last-five";
import { UpstreamRateLimitError } from "./upstream-rate-limit";

const PROFILE_TTL_MS = 3 * 60_000;
const DEFAULT_FORM_GAMES = 15;
const DEFAULT_DETAIL_GAMES = 8;
const MAX_FORM_GAMES = 15;
const MAX_DETAIL_GAMES = 15;
const MAX_PROFILE_CACHE_ENTRIES = 24;

export type SimFormResult = {
  fixtureId: number;
  date: string;
  competition: string;
  opponent: string;
  home: boolean;
  scored: number;
  conceded: number;
  result: "W" | "D" | "L";
  scoreline: string;
};

export type SimFormRecord = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  pointsPerGame: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  cleanSheets: number;
  failedToScore: number;
  /** Oldest first, e.g. "WWDLW". */
  form: string;
  homePointsPerGame: number | null;
  awayPointsPerGame: number | null;
};

export type SimTeamStyle = {
  matches: number;
  possession: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  shotAccuracy: number | null;
  expectedGoals: number | null;
  passes: number | null;
  passAccuracy: number | null;
  longBallShare: number | null;
  crosses: number | null;
  corners: number | null;
  fouls: number | null;
  yellows: number | null;
  reds: number | null;
  tackles: number | null;
  interceptions: number | null;
  recoveries: number | null;
  aerialDuelsWon: number | null;
  boxTouches: number | null;
  bigChances: number | null;
};

export type SimPlayerMatchLine = {
  fixtureId: number;
  date: string;
  opponent: string;
  rating: number | null;
  minutes: number;
};

export type SimLineupPlayer = {
  id: number | null;
  name: string;
  number: number | null;
  position: string | null;
  role: string;
  grid: string | null;
  starts: number;
  appearances: number;
  averageMinutes: number;
  averageRating: number | null;
  ratingTrend: number | null;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  passAccuracy: number | null;
  keyPasses: number;
  tackles: number;
  interceptions: number;
  duelsWon: number;
  dribblesCompleted: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  saves: number | null;
  /** 0..1 blend of starts, ratings and recency. */
  impact: number;
  /** Multiplier the engine applies to the role's base attributes. */
  quality: number;
  /** 0..1 trait signals, 0.5 = neutral. */
  signals: Record<string, number>;
  matchRatings: SimPlayerMatchLine[];
};

export type SimTeamProfile = {
  side: "home" | "away";
  teamId: number;
  name: string;
  short: string;
  record: SimFormRecord;
  recent: SimFormResult[];
  style: SimTeamStyle;
  formation: string;
  formationConfidence: number;
  lineup: SimLineupPlayer[];
  bench: SimLineupPlayer[];
  /** Engine positioning for each predicted starter, in lineup order. */
  slots: { role: string; nx: number; nz: number }[];
  /** How many team sheets the predicted XI was read from. */
  lineupSample: number;
  squadQuality: number;
  tactics: {
    press: number;
    line: number;
    width: number;
    risk: number;
    tempo: number;
    direct: number;
    label: string;
  };
};

export type SimFormProfile = {
  fixtureId: number;
  observedAt: string;
  formGames: number;
  detailGames: number;
  teams: [SimTeamProfile, SimTeamProfile];
  issues: string[];
};

type DetailedMatch = {
  fixtureId: number;
  date: Date;
  opponent: string;
  home: boolean;
  scored: number | null;
  conceded: number | null;
  snapshot: HistoricalMatchSnapshot;
};

type PlayerTally = {
  id: number | null;
  name: string;
  number: number | null;
  position: string | null;
  starts: number;
  appearances: number;
  minutes: number;
  lastPlayed: number;
  ratings: { date: Date; rating: number }[];
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  passes: number;
  passesAccurate: number;
  keyPasses: number;
  tackles: number;
  interceptions: number;
  duelsTotal: number;
  duelsWon: number;
  aerialTotal: number;
  aerialWon: number;
  dribblesAttempted: number;
  dribblesCompleted: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  goalsConceded: number;
  normalized: {
    defensive: number[];
    passing: number[];
    shooting: number[];
    dribbling: number[];
    goalkeeping: number[];
  };
  slots: Map<string, number>;
  matchRatings: SimPlayerMatchLine[];
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function statMap(statistics: FootballLastFiveStat[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const stat of statistics) {
    const label = stat.label.split("·").pop()?.trim() ?? stat.label;
    const value = parseNumber(stat.value);
    if (value !== null) map.set(label.toLowerCase(), value);
  }
  return map;
}

function fullMatchStats(
  statistics: FootballLastFiveTeamStatistics[],
  teamId: number,
  teamName: string,
): Map<string, number> | null {
  const entry =
    statistics.find((row) => row.teamId === teamId) ??
    statistics.find(
      (row) => row.teamName.trim().toLowerCase() === teamName.trim().toLowerCase(),
    );
  if (!entry) return null;
  const full = entry.statistics.filter((stat) =>
    stat.label.toLowerCase().startsWith("full match"),
  );
  return statMap(full.length ? full : entry.statistics);
}

function pick(
  map: Map<string, number> | null,
  labels: string[],
): number | null {
  if (!map) return null;
  for (const label of labels) {
    const value = map.get(label.toLowerCase());
    if (value !== undefined) return value;
  }
  return null;
}

function playerLineup(
  lineups: FootballLastFiveLineup[],
  teamId: number,
  teamName: string,
): FootballLastFiveLineup | null {
  return (
    lineups.find((lineup) => lineup.teamId === teamId) ??
    lineups.find(
      (lineup) =>
        lineup.teamName.trim().toLowerCase() === teamName.trim().toLowerCase(),
    ) ??
    null
  );
}

function playerGroup(
  groups: FootballLastFivePlayerGroup[],
  teamId: number,
  teamName: string,
): FootballLastFivePlayerGroup | null {
  return (
    groups.find((group) => group.teamId === teamId) ??
    groups.find(
      (group) =>
        group.teamName.trim().toLowerCase() === teamName.trim().toLowerCase(),
    ) ??
    null
  );
}

function playerKey(player: { id: number | null; name: string }): string {
  return player.id !== null ? `id:${player.id}` : `name:${player.name.trim().toLowerCase()}`;
}

function isBenchPlayer(player: FootballLastFivePlayer): boolean {
  const substitute = player.statistics.find((stat) =>
    stat.label.toLowerCase().endsWith("games · substitute"),
  );
  return typeof substitute?.value === "string" && /^yes$/i.test(substitute.value);
}

function playerMinutes(player: FootballLastFivePlayer): number {
  const minutes = player.statistics.find((stat) =>
    stat.label.toLowerCase().endsWith("games · minutes"),
  );
  return parseNumber(minutes?.value) ?? 0;
}

function emptyTally(player: {
  id: number | null;
  name: string;
  number: number | null;
  position: string | null;
}): PlayerTally {
  return {
    id: player.id,
    name: player.name,
    number: player.number,
    position: player.position,
    starts: 0,
    appearances: 0,
    minutes: 0,
    lastPlayed: 0,
    ratings: [],
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    passesAccurate: 0,
    keyPasses: 0,
    tackles: 0,
    interceptions: 0,
    duelsTotal: 0,
    duelsWon: 0,
    aerialTotal: 0,
    aerialWon: 0,
    dribblesAttempted: 0,
    dribblesCompleted: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    goalsConceded: 0,
    normalized: { defensive: [], passing: [], shooting: [], dribbling: [], goalkeeping: [] },
    slots: new Map(),
    matchRatings: [],
  };
}

function tallyPlayer(
  tally: PlayerTally,
  stats: Map<string, number>,
  rating: number | null,
  minutes: number,
  match: DetailedMatch,
): void {
  tally.appearances += 1;
  tally.minutes += minutes;
  tally.lastPlayed = Math.max(tally.lastPlayed, match.date.getTime());
  if (rating !== null) {
    tally.ratings.push({ date: match.date, rating });
    tally.matchRatings.push({
      fixtureId: match.fixtureId,
      date: match.date.toISOString(),
      opponent: match.opponent,
      rating,
      minutes,
    });
  }
  tally.goals += pick(stats, ["goals · total", "goals"]) ?? 0;
  tally.assists += pick(stats, ["goals · assists", "goal_assist"]) ?? 0;
  tally.shots += pick(stats, ["shots · total", "total_shots"]) ?? 0;
  tally.shotsOnTarget += pick(stats, ["shots · on", "shots_on_target"]) ?? 0;
  tally.passes += pick(stats, ["passes · total", "total_pass"]) ?? 0;
  tally.passesAccurate += pick(stats, ["passes · accuracy", "accurate_pass"]) ?? 0;
  tally.keyPasses += pick(stats, ["passes · key", "key_pass"]) ?? 0;
  tally.tackles += pick(stats, ["tackles · total", "total_tackle"]) ?? 0;
  tally.interceptions += pick(stats, ["tackles · interceptions", "interception"]) ?? 0;
  tally.duelsTotal += pick(stats, ["duels · total", "total_contest"]) ?? 0;
  tally.duelsWon += pick(stats, ["duels · won", "duel_won", "won_contest"]) ?? 0;
  const aerialsWon = pick(stats, ["bsd · statistics · aerial_won"]) ?? 0;
  tally.aerialWon += aerialsWon;
  tally.aerialTotal += aerialsWon + (pick(stats, ["bsd · statistics · aerial_lost"]) ?? 0);
  tally.dribblesAttempted += pick(stats, ["dribbles · attempts", "total_contest"]) ?? 0;
  tally.dribblesCompleted += pick(stats, ["dribbles · success", "won_contest"]) ?? 0;
  tally.fouls += pick(stats, ["fouls · committed", "fouls"]) ?? 0;
  tally.yellowCards += pick(stats, ["cards · yellow", "yellow_card"]) ?? 0;
  tally.redCards += pick(stats, ["cards · red", "red_card"]) ?? 0;
  tally.saves += pick(stats, ["goals · saves", "saves"]) ?? 0;
  tally.goalsConceded += pick(stats, ["goals · conceded", "goals_conceded"]) ?? 0;

  const normalized = tally.normalized;
  const push = (bucket: number[], value: number | null) => {
    if (value !== null) bucket.push(value);
  };
  push(normalized.defensive, pick(stats, ["bsd · statistics · defensive_value_normalized"]));
  push(normalized.passing, pick(stats, ["bsd · statistics · pass_value_normalized"]));
  push(normalized.shooting, pick(stats, ["bsd · statistics · shot_value_normalized"]));
  push(normalized.dribbling, pick(stats, ["bsd · statistics · dribble_value_normalized"]));
  push(normalized.goalkeeping, pick(stats, ["bsd · statistics · goalkeeper_value_normalized"]));
}

const average = (values: number[], fallback: number | null = null): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;

/** -1..1 normalized source value -> 0..1 signal around a neutral 0.5. */
function signal(values: number[], fallback = 0.5): number {
  const mean = average(values);
  if (mean === null) return fallback;
  return clamp(0.5 + mean * 0.55, 0.05, 0.95);
}

function formationRows(formation: string): number[] | null {
  const rows = formation
    .split(/[-:]/)
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 6);
  if (!rows.length) return null;
  const outfield = rows.length === 4 && rows.reduce((sum, n) => sum + n, 0) === 10
    ? rows
    : rows.reduce((sum, n) => sum + n, 0) === 10
      ? rows
      : null;
  return outfield;
}

type SlotRole = { role: string; row: number; col: number };

function rolesForFormation(rows: number[]): SlotRole[] {
  const slots: SlotRole[] = [{ role: "GK", row: 1, col: 1 }];
  rows.forEach((count, rowIndex) => {
    const row = rowIndex + 2;
    for (let col = 1; col <= count; col += 1) {
      slots.push({ role: roleForBand(rowIndex, rows.length, count, col), row, col });
    }
  });
  return slots;
}

function roleForBand(
  bandIndex: number,
  bandCount: number,
  count: number,
  col: number,
): string {
  const left = col === 1;
  const right = col === count;
  if (bandIndex === 0) {
    if (count >= 4) return left ? "LB" : right ? "RB" : "CB";
    if (count === 3) return left ? "LB" : right ? "RB" : "CB";
    if (count === 5) return left ? "LB" : right ? "RB" : "CB";
    return "CB";
  }
  if (bandIndex === bandCount - 1) {
    if (count === 1) return "ST";
    if (count === 2) return "ST";
    if (count === 3) return left ? "LW" : right ? "RW" : "ST";
    return left ? "LW" : right ? "RW" : "ST";
  }
  // midfield band
  if (count === 1) return "CM";
  if (count === 2) return bandIndex === 1 ? "DM" : "CM";
  if (count === 3) {
    if (left) return "LW";
    if (right) return "RW";
    return "CM";
  }
  if (count === 4) {
    if (left) return "LM";
    if (right) return "RM";
    return "CM";
  }
  if (left) return "LM";
  if (right) return "RM";
  return "CM";
}

const ROLE_DEPTH: Record<string, number> = {
  GK: 0.035, CB: 0.19, RB: 0.26, LB: 0.26, DM: 0.36, CM: 0.45,
  RM: 0.46, LM: 0.46, RW: 0.63, LW: 0.63, ST: 0.73,
};

function slotGeometry(role: string, count: number, col: number) {
  const depth = ROLE_DEPTH[role] ?? 0.45;
  if (count <= 1) return { nx: depth, nz: 0.5 };
  // Source grids number columns from the left touchline, which the engine
  // models as the low z end of the pitch.
  const spread = 0.13 + (col - 1) * (0.74 / (count - 1));
  return { nx: depth, nz: round(spread, 3) };
}

function playerSignals(tally: PlayerTally, role: string): Record<string, number> {
  const apps = Math.max(1, tally.appearances);
  const per90 = (value: number) => (value / apps) * (90 / Math.max(30, tally.minutes / apps));
  const passAccuracy = tally.passes ? tally.passesAccurate / tally.passes : null;
  const duelWin = tally.duelsTotal ? tally.duelsWon / tally.duelsTotal : null;
  const dribbleSuccess = tally.dribblesAttempted
    ? tally.dribblesCompleted / tally.dribblesAttempted
    : null;
  const saveRate = tally.saves + tally.goalsConceded > 0
    ? tally.saves / (tally.saves + tally.goalsConceded)
    : null;

  const finishing = clamp(
    0.5 * signal(tally.normalized.shooting) +
      0.3 * clamp(per90(tally.shotsOnTarget) / 1.6, 0, 1) +
      0.2 * clamp(per90(tally.goals) / 0.6, 0, 1),
    0.05,
    0.95,
  );
  const creation = clamp(
    0.55 * signal(tally.normalized.passing) +
      0.25 * (passAccuracy ?? 0.75) +
      0.2 * clamp(per90(tally.keyPasses) / 2.2, 0, 1),
    0.05,
    0.95,
  );
  const retention = clamp(
    0.6 * signal(tally.normalized.dribbling) + 0.4 * (dribbleSuccess ?? 0.5),
    0.05,
    0.95,
  );
  const defending = clamp(
    0.6 * signal(tally.normalized.defensive) +
      0.2 * clamp(per90(tally.tackles) / 3.4, 0, 1) +
      0.2 * clamp(per90(tally.interceptions) / 2.4, 0, 1),
    0.05,
    0.95,
  );
  const aerialWin = tally.aerialTotal ? tally.aerialWon / tally.aerialTotal : 0.5;
  const duels = clamp(
    0.45 + 0.55 * ((duelWin ?? 0.5) - 0.5) + 0.35 * (aerialWin - 0.5),
    0.18,
    0.85,
  );
  const discipline = clamp(
    0.85 - clamp(per90(tally.fouls) / 4, 0, 1) * 0.4 - clamp(per90(tally.yellowCards) / 0.6, 0, 1) * 0.3,
    0.05,
    0.95,
  );
  const activity = clamp(
    0.35 + 0.4 * clamp(tally.minutes / apps / 90, 0, 1) + 0.25 * (duelWin ?? 0.5),
    0.1,
    0.98,
  );
  const goalkeeping = role === "GK"
    ? clamp(0.5 * signal(tally.normalized.goalkeeping) + 0.5 * (saveRate ?? 0.68), 0.05, 0.95)
    : 0.5;

  return {
    finishing: round(finishing, 3),
    creation: round(creation, 3),
    retention: round(retention, 3),
    defending: round(defending, 3),
    duels: round(duels, 3),
    discipline: round(discipline, 3),
    activity: round(activity, 3),
    goalkeeping: round(goalkeeping, 3),
  };
}

function ratingScore(rating: number | null): number {
  if (rating === null) return 0.5;
  return clamp((rating - 5.6) / 2.6, 0, 1);
}

function summariseTally(
  tally: PlayerTally,
  role: string,
  grid: string | null,
  sampleSize: number,
  newestPlayed: number,
): SimLineupPlayer {
  const apps = Math.max(1, tally.appearances);
  const averageRating = tally.ratings.length
    ? round(average(tally.ratings.map((entry) => entry.rating)) ?? 0, 2)
    : null;
  const ordered = [...tally.ratings].sort((a, b) => a.date.getTime() - b.date.getTime());
  const early = ordered.slice(0, 3);
  const late = ordered.slice(-3);
  const ratingTrend = early.length >= 2 && late.length >= 2
    ? round((average(late.map((e) => e.rating)) ?? 0) - (average(early.map((e) => e.rating)) ?? 0), 2)
    : null;
  const startRate = tally.starts / Math.max(1, sampleSize);
  const recency = newestPlayed
    ? clamp(1 - (newestPlayed - tally.lastPlayed) / (1000 * 60 * 60 * 24 * 21), 0, 1)
    : 0.5;
  const impact = clamp(
    0.34 * startRate +
      0.36 * ratingScore(averageRating) +
      0.18 * clamp(tally.minutes / apps / 90, 0, 1) +
      0.12 * recency,
    0,
    1,
  );

  return {
    id: tally.id,
    name: tally.name,
    number: tally.number,
    position: tally.position,
    role,
    grid,
    starts: tally.starts,
    appearances: tally.appearances,
    averageMinutes: round(tally.minutes / apps, 1),
    averageRating,
    ratingTrend,
    goals: tally.goals,
    assists: tally.assists,
    shots: tally.shots,
    shotsOnTarget: tally.shotsOnTarget,
    passAccuracy: tally.passes ? round((tally.passesAccurate / tally.passes) * 100, 1) : null,
    keyPasses: tally.keyPasses,
    tackles: tally.tackles,
    interceptions: tally.interceptions,
    duelsWon: tally.duelsWon,
    dribblesCompleted: tally.dribblesCompleted,
    fouls: tally.fouls,
    yellowCards: tally.yellowCards,
    redCards: tally.redCards,
    saves: role === "GK" ? tally.saves : null,
    impact: round(impact, 3),
    quality: round(clamp(0.93 + impact * 0.13, 0.92, 1.07), 3),
    signals: playerSignals(tally, role),
    matchRatings: tally.matchRatings
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-8),
  };
}

function predictLineup(
  tallies: Map<string, PlayerTally>,
  formation: string,
  sampleSize: number,
  geometry: { role: string; nx: number; nz: number }[],
): { lineup: SimLineupPlayer[]; bench: SimLineupPlayer[] } {
  const rows = formationRows(formation) ?? [4, 4, 2];
  const slots = rolesForFormation(rows);
  const newestPlayed = Math.max(0, ...[...tallies.values()].map((tally) => tally.lastPlayed));
  const used = new Set<string>();
  const lineup: SimLineupPlayer[] = [];

  const rowCounts = new Map<number, number>();
  for (const slot of slots) {
    rowCounts.set(slot.row, (rowCounts.get(slot.row) ?? 0) + (slot.row === 1 ? 0 : 1));
  }

  const bandLetter = (row: number): string => {
    if (row === 1) return "G";
    if (row === 2) return "D";
    if (row === rows.length + 1) return "F";
    return "M";
  };

  const scoreForSlot = (tally: PlayerTally, grid: string) => {
    const slotStarts = tally.slots.get(grid) ?? 0;
    const recency = newestPlayed
      ? clamp(1 - (newestPlayed - tally.lastPlayed) / (1000 * 60 * 60 * 24 * 21), 0, 1)
      : 0.5;
    const rating = average(tally.ratings.map((entry) => entry.rating));
    return 0.52 * (slotStarts / Math.max(1, sampleSize)) +
      0.3 * ratingScore(rating) +
      0.18 * recency;
  };

  const byPosition = (letter: string) =>
    [...tallies.entries()]
      .filter(([key]) => !used.has(key))
      .filter(([, tally]) => {
        const position = (tally.position ?? "").toUpperCase();
        if (!position) return true;
        if (letter === "G") return position.startsWith("G");
        if (letter === "D") return position.startsWith("D");
        if (letter === "M") return position.startsWith("M");
        return position.startsWith("F") || position.startsWith("S") || position.startsWith("A");
      })
      .sort(([, left], [, right]) => {
        const impactOf = (tally: PlayerTally) =>
          0.5 * (tally.starts / Math.max(1, sampleSize)) +
          0.5 * ratingScore(average(tally.ratings.map((entry) => entry.rating)));
        return impactOf(right) - impactOf(left);
      });

  // Score every (slot, player) pair once and take the best pairings first, so a
  // regular starter is never consumed by a slot they only covered once.
  const assignments: (string | null)[] = slots.map(() => null);
  const takenSlots = new Set<number>();
  const pairs: { key: string; slotIndex: number; score: number }[] = [];
  slots.forEach((slot, slotIndex) => {
    const grid = `${slot.row}:${slot.col}`;
    for (const [key, tally] of tallies.entries()) {
      const starts = tally.slots.get(grid) ?? 0;
      if (!starts) continue;
      pairs.push({ key, slotIndex, score: scoreForSlot(tally, grid) });
    }
  });
  pairs.sort((left, right) => right.score - left.score);
  for (const pair of pairs) {
    if (used.has(pair.key) || takenSlots.has(pair.slotIndex)) continue;
    used.add(pair.key);
    takenSlots.add(pair.slotIndex);
    assignments[pair.slotIndex] = pair.key;
  }

  slots.forEach((slot, index) => {
    let key = assignments[index];
    if (!key) {
      const letter = bandLetter(slot.row);
      const fallback =
        byPosition(letter)[0] ?? byPosition("M")[0] ?? byPosition("D")[0] ?? null;
      if (!fallback) return;
      key = fallback[0];
      used.add(key);
    }
    const tally = tallies.get(key);
    if (!tally) return;
    const standing = geometry[index];
    if (standing) standing.role = slot.role;
    const grid = `${slot.row}:${slot.col}`;
    lineup.push(
      summariseTally(tally, slot.role, (tally.slots.get(grid) ?? 0) > 0 ? grid : null, sampleSize, newestPlayed),
    );
  });

  const bench = [...tallies.entries()]
    .filter(([key]) => !used.has(key))
    .map(([, tally]) => summariseTally(tally, "SUB", null, sampleSize, newestPlayed))
    .sort((left, right) => right.impact - left.impact)
    .slice(0, 7);

  return { lineup, bench };
}

function buildRecord(recent: FootballRecentMatch[], teamId: number): SimFormRecord {
  const rows = recent.map((match) => {
    const home = match.homeTeam.id === teamId;
    const scored = (home ? match.homeScore : match.awayScore) ?? 0;
    const conceded = (home ? match.awayScore : match.homeScore) ?? 0;
    return { home, scored, conceded };
  });
  const wins = rows.filter((row) => row.scored > row.conceded).length;
  const draws = rows.filter((row) => row.scored === row.conceded).length;
  const losses = rows.filter((row) => row.scored < row.conceded).length;
  const homeRows = rows.filter((row) => row.home);
  const awayRows = rows.filter((row) => !row.home);
  const ppg = (list: typeof rows) =>
    list.length
      ? round(
          list.reduce(
            (sum, row) => sum + (row.scored > row.conceded ? 3 : row.scored === row.conceded ? 1 : 0),
            0,
          ) / list.length,
          2,
        )
      : null;
  const goalsFor = rows.reduce((sum, row) => sum + row.scored, 0);
  const goalsAgainst = rows.reduce((sum, row) => sum + row.conceded, 0);
  const played = rows.length || 1;

  return {
    games: rows.length,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    pointsPerGame: round((wins * 3 + draws) / played, 2),
    goalsForPerGame: round(goalsFor / played, 2),
    goalsAgainstPerGame: round(goalsAgainst / played, 2),
    cleanSheets: rows.filter((row) => row.conceded === 0).length,
    failedToScore: rows.filter((row) => row.scored === 0).length,
    form: [...rows]
      .reverse()
      .map((row) => (row.scored > row.conceded ? "W" : row.scored === row.conceded ? "D" : "L"))
      .join(""),
    homePointsPerGame: ppg(homeRows),
    awayPointsPerGame: ppg(awayRows),
  };
}

function averageStyle(
  maps: (Map<string, number> | null)[],
): SimTeamStyle {
  const usable = maps.filter((map): map is Map<string, number> => map !== null);
  const mean = (labels: string[], fallback: number | null = null) => {
    const values = usable
      .map((map) => pick(map, labels))
      .filter((value): value is number => value !== null);
    return values.length ? round(average(values) ?? 0, 2) : fallback;
  };
  const shots = mean(["total shots"]);
  const onTarget = mean(["shots on goal"]);
  return {
    matches: usable.length,
    possession: mean(["ball possession"]),
    shots,
    shotsOnTarget: onTarget,
    shotAccuracy: shots && onTarget !== null ? round((onTarget / shots) * 100, 1) : null,
    expectedGoals: mean(["expected_goals", "expected goals"]),
    passes: mean(["total passes"]),
    passAccuracy: mean(["passes %"]),
    longBallShare: mean(["long balls %"]),
    crosses: mean(["crosses total"]),
    corners: mean(["corner kicks"]),
    fouls: mean(["fouls"]),
    yellows: mean(["yellow cards"]),
    reds: mean(["red cards"]),
    tackles: mean(["total tackles", "tackles"]),
    interceptions: mean(["interceptions"]),
    recoveries: mean(["recoveries"]),
    aerialDuelsWon: mean(["aerial duels %"]),
    boxTouches: mean(["touches in opposition box"]),
    bigChances: mean(["big chances"]),
  };
}

function styleTactics(
  style: SimTeamStyle,
  record: SimFormRecord,
): SimTeamProfile["tactics"] {
  const possession = style.possession ?? 50;
  const control = clamp((possession - 50) / 34, -1, 1);
  const workRate = clamp(
    ((style.recoveries ?? 40) / 58) * 0.45 + ((style.tackles ?? 15) / 24) * 0.35 +
      ((style.interceptions ?? 8) / 13) * 0.2,
    0.2,
    1,
  );
  const line = clamp(0.42 + control * 0.26 + (record.goalsForPerGame - 1.2) * 0.05, 0.24, 0.9);
  const press = clamp(0.26 + workRate * 0.5 + (0.5 - control) * 0.12, 0.3, 0.9);
  const width = clamp(0.5 + ((style.crosses ?? 18) / 30) * 0.22 - ((style.longBallShare ?? 30) / 100) * 0.1, 0.35, 0.8);
  const risk = clamp(
    0.36 + ((style.boxTouches ?? 28) / 45) * 0.28 + (record.goalsForPerGame - 1.2) * 0.06,
    0.25,
    0.82,
  );
  const tempo = clamp(((style.passes ?? 420) / 560) * 0.55 + ((style.shots ?? 12) / 20) * 0.3, 0.3, 0.9);
  const direct = clamp(((style.longBallShare ?? 30) / 100) * 0.9 + (1 - control) * 0.12, 0.18, 0.85);
  const label = press > 0.62 ? "HIGH PRESS" : line < 0.42 ? "LOW BLOCK" : "MID BLOCK";

  return {
    press: round(press, 3),
    line: round(line, 3),
    width: round(width, 3),
    risk: round(risk, 3),
    tempo: round(tempo, 3),
    direct: round(direct, 3),
    label,
  };
}

function shortName(name: string): string {
  const compact = name.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (compact.slice(0, 3) || "TBD").padEnd(3, "X");
}

async function loadDetailedMatches(
  recent: FootballRecentMatch[],
  teamId: number,
  detailGames: number,
  issues: string[],
): Promise<DetailedMatch[]> {
  const wanted = recent.slice(0, detailGames);
  const loaded: DetailedMatch[] = [];

  // Each completed fixture costs one request, so a modest batch keeps the
  // profile quick without tripping the upstream rate limiter.
  for (let offset = 0; offset < wanted.length; offset += 3) {
    const batch = wanted.slice(offset, offset + 3);
    const rows = await Promise.all(
      batch.map(async (match) => {
        try {
          const snapshot = await getHistoricalMatchSnapshot(match.fixtureId);
          return { match, snapshot };
        } catch (error) {
          if (error instanceof UpstreamRateLimitError) throw error;
          return null;
        }
      }),
    );
    for (const row of rows) {
      if (!row) continue;
      const home = row.match.homeTeam.id === teamId;
      loaded.push({
        fixtureId: row.match.fixtureId,
        date: new Date(row.match.date),
        opponent: home ? row.match.awayTeam.name : row.match.homeTeam.name,
        home,
        scored: home ? row.match.homeScore : row.match.awayScore,
        conceded: home ? row.match.awayScore : row.match.homeScore,
        snapshot: row.snapshot,
      });
    }
  }

  if (loaded.length < Math.min(detailGames, recent.length)) {
    issues.push(
      `Only ${loaded.length} of the last ${Math.min(detailGames, recent.length)} team sheets could be read for this club.`,
    );
  }

  return loaded.sort((left, right) => right.date.getTime() - left.date.getTime());
}

function aggregateTeam(
  teamId: number,
  teamName: string,
  detailed: DetailedMatch[],
  issues: string[],
): {
  formation: string;
  formationConfidence: number;
  lineup: SimLineupPlayer[];
  bench: SimLineupPlayer[];
  slots: { role: string; nx: number; nz: number }[];
  sample: number;
  style: SimTeamStyle;
} {
  const tallies = new Map<string, PlayerTally>();
  const formations = new Map<string, number>();
  const styleMaps: (Map<string, number> | null)[] = [];
  let sample = 0;

  for (const match of detailed) {
    const lineup = playerLineup(match.snapshot.lineups, teamId, teamName);
    const group = playerGroup(match.snapshot.players, teamId, teamName);
    const stats = fullMatchStats(match.snapshot.statistics, teamId, teamName);
    if (stats) styleMaps.push(stats);
    if (!lineup && !group) continue;
    sample += 1;

    if (lineup?.formation) {
      const key = lineup.formation.trim();
      formations.set(key, (formations.get(key) ?? 0) + 1);
    }

    const starters = new Map<string, { grid: string | null; number: number | null }>();
    for (const starter of lineup?.starters ?? []) {
      starters.set(playerKey(starter), { grid: starter.grid, number: starter.number });
    }

    const seen = new Set<string>();
    for (const player of group?.players ?? []) {
      const key = playerKey(player);
      seen.add(key);
      const tally = tallies.get(key) ?? emptyTally({
        id: player.id,
        name: player.name,
        number: player.number,
        position: player.position,
      });
      const statsMap = statMap(player.statistics);
      const starter = starters.get(key);
      const minutes = playerMinutes(player);
      if (starter) {
        tally.starts += 1;
        if (starter.grid) tally.slots.set(starter.grid, (tally.slots.get(starter.grid) ?? 0) + 1);
        if (starter.number !== null && tally.number === null) tally.number = starter.number;
      }
      if (minutes <= 0 && isBenchPlayer(player)) {
        // unused substitute: keep the squad record but do not count an appearance
        tallies.set(key, tally);
        continue;
      }
      const rating = parseNumber(player.rating);
      tallyPlayer(tally, statsMap, rating, minutes, match);
      tallies.set(key, tally);
    }

    // Starters that never appeared in the player-statistics group still count
    // as selected so the predicted XI is not blind to them.
    for (const starter of lineup?.starters ?? []) {
      const key = playerKey(starter);
      if (seen.has(key)) continue;
      const tally = tallies.get(key) ?? emptyTally({
        id: starter.id,
        name: starter.name,
        number: starter.number,
        position: starter.position,
      });
      tally.starts += 1;
      if (starter.grid) tally.slots.set(starter.grid, (tally.slots.get(starter.grid) ?? 0) + 1);
      if (starter.number !== null) tally.number = starter.number;
      tallies.set(key, tally);
    }
  }

  const style = averageStyle(styleMaps);
  if (!tallies.size) issues.push(`${teamName} did not return lineups for the sample.`);

  const rankedFormations = [...formations.entries()].sort((left, right) => right[1] - left[1]);
  const formation = rankedFormations[0]?.[0] ?? "4-3-3";
  const formationConfidence = sample
    ? round((rankedFormations[0]?.[1] ?? 0) / sample, 2)
    : 0;

  const rows = formationRows(formation) ?? [4, 4, 2];
  const slots = rolesForFormation(rows).map((slot) => {
    const count = slot.row === 1 ? 1 : rows[slot.row - 2];
    const { nx, nz } = slotGeometry(slot.role, count, slot.col);
    return { role: slot.role, nx, nz };
  });
  const { lineup, bench } = tallies.size
    ? predictLineup(tallies, formation, Math.max(1, sample), slots)
    : { lineup: [], bench: [] };

  return { formation, formationConfidence, lineup, bench, slots, sample, style };
}

export type SimFormProfileOptions = {
  formGames?: number;
  detailGames?: number;
};

async function buildProfile(
  fixtureId: number,
  options: SimFormProfileOptions,
): Promise<SimFormProfile> {
  const formGames = clamp(
    Math.round(options.formGames ?? DEFAULT_FORM_GAMES),
    5,
    MAX_FORM_GAMES,
  );
  const detailGames = clamp(
    Math.round(options.detailGames ?? DEFAULT_DETAIL_GAMES),
    3,
    MAX_DETAIL_GAMES,
  );
  const issues: string[] = [];

  const details = await getKickoffScoreMatchDetails(fixtureId);

  const homeRecent = [...details.homeRecent]
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, formGames);
  const awayRecent = [...details.awayRecent]
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, formGames);

  if (homeRecent.length < formGames) {
    issues.push(`Only ${homeRecent.length} of the last ${formGames} results were available for ${details.match.home.name}.`);
  }
  if (awayRecent.length < formGames) {
    issues.push(`Only ${awayRecent.length} of the last ${formGames} results were available for ${details.match.away.name}.`);
  }

  const buildTeam = async (
    side: "home" | "away",
  ): Promise<SimTeamProfile> => {
    const participant = side === "home" ? details.match.home : details.match.away;
    const recent = side === "home" ? homeRecent : awayRecent;
    const detailed = await loadDetailedMatches(
      recent,
      participant.id,
      detailGames,
      issues,
    );
    const aggregate = aggregateTeam(participant.id, participant.name, detailed, issues);
    const record = buildRecord(recent, participant.id);
    const tactics = styleTactics(aggregate.style, record);
    const recentResults: SimFormResult[] = recent.map((match) => {
      const home = match.homeTeam.id === participant.id;
      const scored = (home ? match.homeScore : match.awayScore) ?? 0;
      const conceded = (home ? match.awayScore : match.homeScore) ?? 0;
      return {
        fixtureId: match.fixtureId,
        date: new Date(match.date).toISOString(),
        competition: match.competition,
        opponent: home ? match.awayTeam.name : match.homeTeam.name,
        home,
        scored,
        conceded,
        result: scored > conceded ? "W" : scored < conceded ? "L" : "D",
        scoreline: `${scored}-${conceded}`,
      };
    });

    // Team strength moves slightly with results and goal difference, but stays
    // inside a band that leaves the match itself to decide the outcome.
    const squadQuality = round(
      clamp(
        1 +
          (record.pointsPerGame - 1.4) * 0.022 +
          record.goalsForPerGame * 0.004 -
          record.goalsAgainstPerGame * 0.004,
        0.95,
        1.06,
      ),
      3,
    );

    return {
      side,
      teamId: participant.id,
      name: participant.name,
      short: shortName(participant.name),
      record,
      recent: recentResults,
      style: aggregate.style,
      formation: aggregate.formation,
      formationConfidence: aggregate.formationConfidence,
      lineup: aggregate.lineup,
      bench: aggregate.bench,
      slots: aggregate.slots,
      lineupSample: aggregate.sample,
      squadQuality,
      tactics,
    };
  };

  const [home, away] = await Promise.all([buildTeam("home"), buildTeam("away")]);

  if (!home.lineup.length || !away.lineup.length) {
    issues.push("One or both predicted lineups are incomplete because the source had no team sheets.");
  }

  return {
    fixtureId,
    observedAt: new Date().toISOString(),
    formGames,
    detailGames,
    teams: [home, away],
    issues,
  };
}

const profileCache = new Map<number, { expiresAt: number; data: SimFormProfile }>();
const inFlightProfiles = new Map<number, Promise<SimFormProfile>>();

export function getSimFormProfile(
  fixtureId: number,
  options: SimFormProfileOptions = {},
): Promise<SimFormProfile> {
  const cached = profileCache.get(fixtureId);
  // A cached profile built from a smaller sample is still served so the page
  // stays fast; the sample size travels with the data.
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);

  const active = inFlightProfiles.get(fixtureId);
  if (active) return active;

  const request = buildProfile(fixtureId, options)
    .then((data) => {
      profileCache.set(fixtureId, { data, expiresAt: Date.now() + PROFILE_TTL_MS });
      if (profileCache.size > MAX_PROFILE_CACHE_ENTRIES) {
        const oldest = profileCache.keys().next().value;
        if (oldest !== undefined) profileCache.delete(oldest);
      }
      return data;
    })
    .finally(() => {
      inFlightProfiles.delete(fixtureId);
    });

  inFlightProfiles.set(fixtureId, request);
  return request;
}
