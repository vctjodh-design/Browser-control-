// Fast batch engine.
//
// The tick-by-tick simulation draws 22 players and a ball at 60 Hz, which is
// what makes it watchable but also means a single match costs seconds of CPU.
// Asking for thousands of replays needs a different tool, so this module plays
// the same fixture from the same inputs (squad quality, per-player ratings,
// predicted XI, tactics, league position) and produces the same match record —
// goals with minutes and scorers, half-time and second-half scores, corners,
// cards, shots on target per player — in microseconds.
//
// The rates are calibrated from the full engine's own output: total goals sit
// near the engine's average, corners and cards likewise, and the split between
// the sides comes from the profile rather than from any bookmaker price. Each
// round is an independent match, so a run of 5,000 gives a genuine distribution
// of results instead of one replay repeated.

import type { SimFormProfile, SimLineupPlayer, SimTeamProfile } from "./sim-form-profile";
import {
  createSimMatchSummary,
  type SimGoalEvent,
  type SimPlayerLine,
  type SimMatchSummary,
} from "./match-settlement";

export type FastSimOverrides = {
  /** Total goals a match in this league averages; defaults to the engine's. */
  goalsPerMatch?: number;
};

const HALF_TIME_MINUTE = 45;

/** Small deterministic PRNG so the same seed gives the same batch. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lambda: number, random: () => number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit && count < 40);
  return count - 1;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

type Role = "GK" | "DEF" | "MID" | "FWD";

function roleOf(player: SimLineupPlayer): Role {
  const label = `${player.role ?? ""} ${player.position ?? ""}`.toUpperCase();
  if (/GK|GOAL/.test(label)) return "GK";
  if (/FWD|ST|CF|LW|RW|ATTACK/.test(label)) return "FWD";
  if (/MID|CM|DM|AM/.test(label)) return "MID";
  if (/DEF|CB|LB|RB|WB/.test(label)) return "DEF";
  return "MID";
}

const SCORER_WEIGHT: Record<Role, number> = { GK: 0.02, DEF: 0.22, MID: 0.72, FWD: 1.55 };
const SHOT_WEIGHT: Record<Role, number> = { GK: 0, DEF: 0.35, MID: 0.85, FWD: 1.4 };

function attackInfluence(player: SimLineupPlayer, role: Role): number {
  const goalsPerStart = player.starts > 0 ? player.goals / player.starts : 0;
  const keyPasses = player.keyPasses;
  const creative = player.signals?.creation ?? 0.5;
  return (
    SCORER_WEIGHT[role] *
    (0.7 + player.quality * 0.5) *
    (1 + goalsPerStart * 0.55 + keyPasses * 0.012 + (creative - 0.5) * 0.35)
  );
}

function shotInfluence(player: SimLineupPlayer, role: Role): number {
  return SHOT_WEIGHT[role] * (0.75 + player.quality * 0.45) * (1 + (player.shots ?? 0) * 0.01);
}

function pickWeighted<T>(items: T[], weights: number[], random: () => number): T {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return items[Math.floor(random() * items.length)];
  let target = random() * total;
  for (let index = 0; index < items.length; index += 1) {
    target -= Math.max(0, weights[index]);
    if (target <= 0) return items[index];
  }
  return items[items.length - 1];
}

type TeamRates = {
  goals: number;
  corners: number;
  cards: number;
  shotsOnTarget: number;
  /** Weighted attacking share relative to the opponent, 0.5 is even. */
  share: number;
};

/** Prior for one side's goals in an average match before any form is read. */
const LEAGUE_TEAM_GOALS = 1.36;
const FORM_SAMPLE = 15;
const FORM_PRIOR_WEIGHT = 6;

/** Pull a short scoring record towards the league average so 15 games is not
 *  treated as gospel, while still letting real output show through. */
function shrink(value: number, sample: number): number {
  const weight = Math.max(0, Math.min(FORM_SAMPLE, sample || 0));
  return (value * weight + LEAGUE_TEAM_GOALS * FORM_PRIOR_WEIGHT) / (weight + FORM_PRIOR_WEIGHT);
}

function attackIndex(team: SimTeamProfile): number {
  const games = team.record?.games ?? 0;
  const perGame = team.record?.goalsForPerGame ?? LEAGUE_TEAM_GOALS;
  return clamp(shrink(perGame, games) / LEAGUE_TEAM_GOALS, 0.4, 2.2);
}

function defenceIndex(team: SimTeamProfile): number {
  const games = team.record?.games ?? 0;
  const perGame = team.record?.goalsAgainstPerGame ?? LEAGUE_TEAM_GOALS;
  return clamp(shrink(perGame, games) / LEAGUE_TEAM_GOALS, 0.4, 2.2);
}

/** How good the eleven actually is, from their own ratings. */
function xiQuality(team: SimTeamProfile): number {
  const xi = team.lineup.slice(0, 11);
  if (!xi.length) return 1;
  const quality = mean(xi.map((player) => player.quality ?? 1));
  const ratings = xi.map((player) => player.averageRating ?? 0).filter((value) => value > 0);
  const ratingEdge = ratings.length ? (mean(ratings) - 6.6) / 6.6 : 0;
  const table = team.table?.edge ?? 0;
  return clamp(1 + (quality - 1) * 2.2 + ratingEdge * 0.5 + table * 0.02, 0.85, 1.18);
}

function ratesFor(profile: SimFormProfile, goalsPerMatch?: number): [TeamRates, TeamRates] {
  const [home, away] = profile.teams;

  const tempo = (team: SimTeamProfile) => team.tactics?.tempo ?? 0.6;
  const press = (team: SimTeamProfile) => team.tactics?.press ?? 0.55;
  const risk = (team: SimTeamProfile) => team.tactics?.risk ?? 0.5;
  const line = (team: SimTeamProfile) => team.tactics?.line ?? 0.5;

  // Classic attack/defence product: what a side scores against what the
  // opponent concedes, with home advantage. Both indices come from the club's
  // own results, so a side that has been scoring travels with that.
  const shape = (team: SimTeamProfile) =>
    xiQuality(team) * (0.9 + tempo(team) * 0.22) * (0.95 + risk(team) * 0.12);

  let homeGoals =
    LEAGUE_TEAM_GOALS *
    Math.pow(attackIndex(home), 1.1) *
    Math.pow(defenceIndex(away), 0.85) *
    1.1 *
    shape(home);
  let awayGoals =
    LEAGUE_TEAM_GOALS *
    Math.pow(attackIndex(away), 1.1) *
    Math.pow(defenceIndex(home), 0.85) *
    0.92 *
    shape(away);

  if (goalsPerMatch && goalsPerMatch > 0) {
    const total = homeGoals + awayGoals;
    const scale = goalsPerMatch / Math.max(0.2, total);
    homeGoals *= scale;
    awayGoals *= scale;
  }

  homeGoals = clamp(homeGoals, 0.18, 4.8);
  awayGoals = clamp(awayGoals, 0.18, 4.8);

  const attackingGap = attackIndex(home) - attackIndex(away);
  const corners = (
    team: SimTeamProfile,
    opponent: SimTeamProfile,
    gap: number,
    homeSide: boolean,
  ) =>
    clamp(
      4.7 +
        (tempo(team) - 0.6) * 2.1 +
        (line(team) - 0.5) * 1.2 +
        (0.5 - line(opponent)) * 1.4 +
        // Sides that attack more win more corners, and the home crowd adds a
        // little more pressure than a neutral model would.
        gap * 1.5 +
        (homeSide ? 0.55 : -0.35),
      1.6,
      9.5,
    );

  const cards = (team: SimTeamProfile) =>
    clamp(1.7 + (press(team) - 0.55) * 1.9 + (risk(team) - 0.5) * 1.1, 0.6, 4.2);

  const shotsOnTarget = (goals: number) => clamp(2.9 + goals * 1.15, 2.2, 9.5);

  return [
    {
      goals: homeGoals,
      corners: corners(home, away, attackingGap, true),
      cards: cards(home),
      shotsOnTarget: shotsOnTarget(homeGoals),
      share: homeGoals / (homeGoals + awayGoals || 1),
    },
    {
      goals: awayGoals,
      corners: corners(away, home, -attackingGap, false),
      cards: cards(away),
      shotsOnTarget: shotsOnTarget(awayGoals),
      share: awayGoals / (homeGoals + awayGoals || 1),
    },
  ];
}

function goalMinute(random: () => number, sideRate: number, otherRate: number): number {
  // Goals arrive a little more often after the break, when legs and shape go.
  const secondHalfBias = clamp(0.54 + (sideRate - otherRate) * 0.02, 0.46, 0.6);
  const inSecondHalf = random() < secondHalfBias;
  const minute = inSecondHalf
    ? HALF_TIME_MINUTE + 1 + Math.floor(random() * 45)
    : 1 + Math.floor(random() * HALF_TIME_MINUTE);
  return Math.min(minute, 90);
}

/** Play one match from the profile. Pure: the caller owns the RNG. */
export function simulateMatch(
  profile: SimFormProfile,
  random: () => number,
  overrides: FastSimOverrides = {},
): SimMatchSummary {
  const rates = ratesFor(profile, overrides.goalsPerMatch);
  const sides = profile.teams;

  const xi: SimLineupPlayer[][] = sides.map((team) => team.lineup.slice(0, 11));
  const roles: Role[][] = xi.map((lineup) => lineup.map(roleOf));
  const scorerWeights: number[][] = xi.map((lineup, side) =>
    lineup.map((player, index) => attackInfluence(player, roles[side][index])),
  );
  const shotWeights: number[][] = xi.map((lineup, side) =>
    lineup.map((player, index) => shotInfluence(player, roles[side][index])),
  );

  const players: SimPlayerLine[] = xi.flatMap((lineup, side) =>
    lineup.map((player) => ({
      name: player.name,
      side: side === 0 ? "home" : "away",
      goals: 0,
      assists: 0,
      shotsOnTarget: 0,
    })),
  );

  const goals: SimGoalEvent[] = [];
  const corners = { home: 0, away: 0 };
  const cards = { home: 0, away: 0 };
  const shotsOnTarget = { home: 0, away: 0 };

  for (const sideIndex of [0, 1] as const) {
    const sideName = sideIndex === 0 ? "home" : "away";
    const rate = rates[sideIndex];
    const otherRate = rates[1 - sideIndex].goals;
    const goalCount = poisson(rate.goals, random);

    for (let index = 0; index < goalCount; index += 1) {
      const minute = goalMinute(random, rate.goals, otherRate);
      const ownGoal = random() < 0.018;
      if (ownGoal) {
        goals.push({ side: sideName, minute, scorer: "", assist: null, ownGoal: true });
        continue;
      }
      const scorerIndex = xi[sideIndex].indexOf(
        pickWeighted(xi[sideIndex], scorerWeights[sideIndex], random),
      );
      const candidates = xi[sideIndex]
        .map((player, index) => ({ player, index }))
        .filter((entry) => entry.index !== scorerIndex);
      const assist =
        random() < 0.72
          ? pickWeighted(
              candidates.map((entry) => entry.player),
              candidates.map((entry) => 0.4 + (entry.player.keyPasses ?? 0) * 0.06 + (entry.player.signals?.creation ?? 0.5)),
              random,
            )
          : null;
      const scorer = xi[sideIndex][scorerIndex];
      goals.push({
        side: sideName,
        minute,
        scorer: scorer.name,
        assist: assist?.name ?? null,
        ownGoal: false,
      });
      const scorerLine = players.find((line) => line.name === scorer.name && line.side === sideName);
      if (scorerLine) scorerLine.goals += 1;
      if (assist) {
        const assistLine = players.find((line) => line.name === assist.name && line.side === sideName);
        if (assistLine) assistLine.assists += 1;
      }
    }

    corners[sideName] = poisson(rate.corners, random);
    cards[sideName] = poisson(rate.cards, random);

    // Shots on target track the goals but not perfectly: a side can have a
    // dozen efforts and no goal, or score twice from three shots on target.
    const totalShotsOnTarget = poisson(rate.shotsOnTarget, random);
    shotsOnTarget[sideName] = totalShotsOnTarget;
    for (let shot = 0; shot < totalShotsOnTarget; shot += 1) {
      const shooter = pickWeighted(xi[sideIndex], shotWeights[sideIndex], random);
      const line = players.find((entry) => entry.name === shooter.name && entry.side === sideName);
      if (line) line.shotsOnTarget += 1;
    }
  }

  return createSimMatchSummary({
    goals,
    corners,
    cards,
    shotsOnTarget,
    players,
  });
}

export function simulateSeries(
  profile: SimFormProfile,
  rounds: number,
  seed: number,
  overrides: FastSimOverrides = {},
): SimMatchSummary[] {
  const random = mulberry32(seed);
  const matches: SimMatchSummary[] = [];
  for (let index = 0; index < rounds; index += 1) {
    matches.push(simulateMatch(profile, random, overrides));
  }
  return matches;
}
