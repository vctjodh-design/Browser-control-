// Resolves a fixture once instead of sampling it two thousand times.
//
// `runDuelSimulation` plays the match over and over and reports the share of
// each scoreline. That answers "what does this fixture usually do", and by
// construction it averages away the one thing a reader wants: what this match
// does. This module walks the same duel board a single time, resolves every
// contest at its own rate instead of by a coin, and prints the chain that
// produced the result.
//
// Nothing here is random. Two calls on the same profile return the same
// verdict, the same goal minutes and the same words, so a verdict can be
// checked after full time instead of being one draw out of two thousand.
//
// The difference from the sampled engine is only where the goals come from.
// There, a possession is played out and sometimes it ends in a goal. Here, a
// possession contributes what it is worth, the contributions are added up in
// the order they would have happened, and a goal is recorded at the possession
// that carries the running total past its mark. The scoreline is therefore the
// residue of the contests, not a draw from them.

import type { SimFormProfile, SimTeamProfile } from "./sim-form-profile";
import {
  bandOf,
  buildDuelBoard,
  chainP,
  DUEL_CONSTANTS,
  DUEL_LANES,
  DUEL_LANE_LABELS,
  laneWeightsOf,
  pick,
  possessionShare,
  preMatchLevel,
  ratedXI,
  winP,
  type Band,
  type DuelBoard,
  type DuelPairing,
  type LevelBasis,
  type Rated,
} from "./squad-duel-sim.ts";

type Side = "home" | "away";

const CARRY_BANDS: Band[] = ["FWD", "MID", "DEF"];
const STOP_BANDS: Band[] = ["DEF", "MID", "FWD"];
const BLOCK_BANDS: Band[] = ["MID", "DEF", "FWD"];

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const other = (side: Side): Side => (side === "home" ? "away" : "home");

/**
 * No side is read past five goals.
 *
 * A sixth says more about the board than about the match: the walk multiplies
 * independent contest rates, so a rout compounds faster than a side can really
 * score. Five is a result a reader can hold against a real one.
 */
export const INEVITABILITY_MAX_GOALS = 5;

/**
 * A number in [0, 1) that never moves for the same input.
 *
 * FNV-1a over the fixture and the side. The engine needs one thing that behaves
 * like a draw without being one: the residue of a side's goal worth. A hash is
 * the same answer every time it is asked, so two calls on one fixture still
 * return the same verdict, and the verdict still repeats after a reload.
 */
function hashUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/**
 * One draw from a side's goal worth.
 *
 * The worth is a mean, not a scoreline. A side worth 1.26 goals scores none
 * about a quarter of the time, one most of the rest, and two or more rarely —
 * which is why real leagues draw a quarter of their matches, while reading the
 * worth as a floor-or-ceiling integer draws half of them and every fixture ends
 * 1-1 or 2-1. The draw is the fixture's own hash read as a quantile, so it is
 * taken once and never moves: the same fixture always scores the same goals.
 */
function goalCount(worth: number, seed: string): number {
  const quantile = hashUnit(seed);
  let term = Math.exp(-worth);
  let cumulative = term;
  let goals = 0;
  while (quantile > cumulative && goals < INEVITABILITY_MAX_GOALS * 2) {
    goals += 1;
    term *= worth / goals;
    cumulative += term;
  }
  return goals;
}

/**
 * What a side turned into a shot over the whole walk.
 *
 * Not its goal worth: the worth is what those openings are worth once the
 * finish is priced, and the two answer different questions. This is the volume
 * a defence actually had to deal with.
 */
function openingsOf(attempts: Attempt[], side: Side): number {
  return attempts
    .filter((attempt) => attempt.side === side)
    .reduce((sum, attempt) => sum + attempt.pCarry * attempt.pProgress * attempt.pChance, 0);
}

/** Thrown when a fixture offers no contest to resolve at all. */
export class InevitabilityUnavailableError extends Error {
  constructor(message = "This fixture has no duel board to resolve.") {
    super(message);
    this.name = "InevitabilityUnavailableError";
  }
}

/**
 * The one contest the fixture is decided on.
 *
 * `forcedAdaptation` is the number this engine ranks on, and it is deliberately
 * not the size of the mismatch. A winger who wins six carries in ten against a
 * tired full-back is worth a little. The same winger is worth the match when
 * stopping him forces a second defender across, because the space that leaves
 * behind is worth more than the carries themselves. So the ranking is the edge
 * multiplied by how far the nearest help has to travel to answer it: a mismatch
 * the opponent can cover from one slot away is decoration, and one that has to
 * be covered from outside the channel is the match.
 */
export type InevitabilityLynchpin = {
  side: Side;
  team: string;
  opponent: string;
  lane: string;
  kind: DuelPairing["kind"];
  attacker: string;
  attackerRole: string;
  defender: string;
  defenderRole: string;
  /** How often the attacker wins this contest on the two men's own numbers. */
  share: number;
  /** Rating points between the two men in this contest. */
  edge: number;
  /** Distance in slot space to the nearest man who could cover. */
  coverDistance: number;
  /** |edge| weighted by how far the cover has to come. Ranks the candidates. */
  forcedAdaptation: number;
  /** What the defending side has to give up to answer it. */
  response: string;
  /** What the adjustment leaves open. */
  opens: string;
};

export type InevitabilityGoal = {
  minute: number;
  side: Side;
  scorer: string;
  team: string;
  channel: string;
  /** The contest that carried the possession over the line. */
  detail: string;
};

export type InevitabilityStep = {
  label: string;
  detail: string;
  value: number;
  unit: string;
};

/**
 * How much of the verdict is the board, and how much is the fixture's residue.
 *
 * Not a percentage. There is no distribution behind a single resolved match, so
 * a "62%" would be invented. What is measured is the gap between the two
 * sides' own goal worth: two goals apart is a verdict about the elevens, four
 * hundredths apart is a verdict about one channel on one night, and the reader
 * deserves to know which they are looking at.
 */
export type InevitabilityConfidence = {
  tier: "firm" | "leaning" | "knife-edge";
  label: string;
  /** Goals between the two sides' own worth. */
  separation: number;
  text: string;
  basis: string;
};

/**
 * The sheet a side keeps, and what the opponent brought to break it.
 *
 * The engine used to leave this to a supporting count on another panel. It is a
 * call in its own right: a side that holds the sheet clean does not win 2–1, it
 * wins 2–0, and the scoreline should say which.
 */
export type InevitabilityShutout = {
  /** The side that keeps it clean, or null when both sides score. */
  side: Side | null;
  clean: boolean;
  keeper: string;
  /** Goals the opponent's own play is worth here. */
  threat: number;
  /** Openings the opponent created: entries that became a shot. */
  shotsFaced: number;
  /** What this defence concedes a game in its own recent matches. */
  concededPerGame: number;
  /** Clean sheets in this side's own recent matches. */
  cleanSheets: number;
  recentGames: number;
  text: string;
  basis: string;
};

/** One reasoning pass over the fixture, with the numbers it read and what it called. */
export type InevitabilityMethod = {
  id: string;
  label: string;
  reads: string;
  call: string;
};

export type InevitabilityVerdict = {
  fixtureId: number;
  teams: [string, string];
  short: [string, string];
  scoreline: string;
  verdict: { home: number; away: number; winner: Side | "draw"; text: string };
  lynchpin: InevitabilityLynchpin;
  /** The sheet either side keeps, read off the opponent's own numbers. */
  shutout: InevitabilityShutout;
  /** Every reasoning pass that shaped the verdict, in the order it was read. */
  methods: InevitabilityMethod[];
  /** The lynchpin channel's own arithmetic, from possessions to goals. */
  cascade: InevitabilityStep[];
  goals: InevitabilityGoal[];
  expectedGoals: { home: number; away: number };
  confidence: InevitabilityConfidence;
  /** The verdict as a script, one line per beat. */
  trace: string[];
  /** The fact that would void this verdict. */
  killCondition: string;
  note: string;
};

/** One possession, resolved at what it is worth rather than played out. */
type Attempt = {
  order: number;
  minute: number;
  side: Side;
  lane: number;
  carrier: string;
  stopper: string;
  creator: string;
  keeper: string;
  pCarry: number;
  pProgress: number;
  pChance: number;
  pShot: number;
  /** What this possession is worth as goals. */
  p: number;
};

/**
 * The best man for a part in a channel, weighted the way the sampled engine
 * weights it (out of position and out of band both cost), but chosen
 * deterministically so the same profile always picks the same man.
 */
function bestBy(
  list: Rated[],
  lane: number,
  bands: Band[],
  strength: (man: Rated) => number,
  exclude: Rated | null,
): Rated | null {
  let best: { man: Rated; cost: number } | null = null;
  for (const man of list) {
    if (exclude && man === exclude) continue;
    const bandRank = bands.indexOf(man.band);
    const cost = Math.abs(man.lane - lane) * 1.1 + (bandRank < 0 ? 8 : bandRank) - strength(man) * 0.35;
    if (!best || cost < best.cost) best = { man, cost };
  }
  return best?.man ?? null;
}

/** How many possessions start in each channel, at the side's own lane weights. */
function allocate(weights: number[], total: number): number[] {
  const sum = weights.reduce((carry, weight) => carry + weight, 0) || 1;
  const raw = weights.map((weight) => (weight / sum) * total);
  const counts = raw.map((value) => Math.floor(value));
  let spare = total - counts.reduce((carry, count) => carry + count, 0);
  const order = raw
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((left, right) => right.rest - left.rest);
  for (const entry of order) {
    if (spare <= 0) break;
    counts[entry.index] += 1;
    spare -= 1;
  }
  return counts;
}

/**
 * The order the channel allocations are played in.
 *
 * A side does not spend its first forty possessions on the left and its last
 * forty on the right: play keeps returning to what the side is set up to use.
 * This spreads each channel's share evenly across the match, so the possession
 * a goal lands on has a plausible minute.
 */
function sequence(counts: number[]): number[] {
  const left = [...counts];
  const seen = counts.map(() => 0);
  const total = counts.reduce((carry, count) => carry + count, 0);
  const out: number[] = [];
  while (out.length < total) {
    let best = -1;
    let bestScore = -Infinity;
    for (const [index, remaining] of left.entries()) {
      if (remaining <= 0) continue;
      const score = ((out.length + 1) * counts[index]) / total - seen[index];
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }
    if (best < 0) break;
    out.push(best);
    left[best] -= 1;
    seen[best] += 1;
  }
  return out;
}

/** Every possession of the fixture, resolved once at its own worth. */
function resolveMatch(
  profile: SimFormProfile,
  chance: { home: number; away: number },
  shift: { home: number; away: number },
  levelOf: LevelBasis,
): { home: number; away: number; attempts: Attempt[] } {
  const [home, away] = profile.teams;
  const share = possessionShare(home, away);
  const homePossessions = Math.round(DUEL_CONSTANTS.possessions * share);
  const awayPossessions = DUEL_CONSTANTS.possessions - homePossessions;

  const elevens: Record<Side, Rated[]> = {
    home: ratedXI(home, shift.home, levelOf),
    away: ratedXI(away, shift.away, levelOf),
  };
  const squads: Record<Side, SimTeamProfile> = { home, away };

  const attempts: Attempt[] = [];
  let order = 0;

  for (const side of ["home", "away"] as Side[]) {
    const attacking = elevens[side];
    const defending = elevens[other(side)];
    const total = side === "home" ? homePossessions : awayPossessions;
    const lanes = sequence(allocate(laneWeightsOf(squads[side]), total));
    const edge = side === "home" ? DUEL_CONSTANTS.homeEdge : 0;
    const scale = side === "home" ? chance.home : chance.away;
    const keeper = defending.find((man) => man.band === "GK") ?? null;

    for (const [index, lane] of lanes.entries()) {
      const carrier = pick(attacking, lane, CARRY_BANDS);
      const stopper = pick(defending, lane, STOP_BANDS);
      const minute = Math.min(
        93,
        Math.floor(((index * 2 + (side === "home" ? 0 : 1)) / DUEL_CONSTANTS.possessions) * 93) + 1,
      );
      if (!carrier || !stopper || !keeper) {
        order += 1;
        continue;
      }
      // The man who finishes a move is usually not the man who carried it.
      const creator = bestBy(attacking, lane, CARRY_BANDS, (man) => man.threat, carrier) ?? carrier;
      const blocker = bestBy(defending, lane, BLOCK_BANDS, (man) => man.block, null) ?? stopper;

      const pCarry = chainP(DUEL_CONSTANTS.carrySurvives, carrier.takeOn + edge, stopper.stop);
      const pProgress = chainP(DUEL_CONSTANTS.progressSurvives, creator.create + edge, blocker.breakUp);
      const pChance = chainP(
        clamp(DUEL_CONSTANTS.chanceMade * scale, 0.02, 0.94),
        creator.threat + edge,
        blocker.block,
      );
      const pShot = clamp(DUEL_CONSTANTS.shotToGoal * 2 * winP(creator.finish + edge, keeper.keeper), 0, 1);

      attempts.push({
        order,
        minute,
        side,
        lane,
        carrier: carrier.name,
        stopper: stopper.name,
        creator: creator.name,
        keeper: keeper.name,
        pCarry,
        pProgress,
        pChance,
        pShot,
        p: pCarry * pProgress * pChance * pShot,
      });
      order += 1;
    }
  }

  attempts.sort((left, right) => left.minute - right.minute || left.order - right.order);
  const homeGoals = attempts.filter((entry) => entry.side === "home").reduce((sum, entry) => sum + entry.p, 0);
  const awayGoals = attempts.filter((entry) => entry.side === "away").reduce((sum, entry) => sum + entry.p, 0);
  return { home: homeGoals, away: awayGoals, attempts };
}

/**
 * How far the nearest help is from the man who has to be helped.
 *
 * Read off the formation slots the profile already carries (nx up the pitch,
 * nz across it), because that is what the engine knows: the shape, not the
 * tracking. Space up the pitch is weighted heavier than space across it — a
 * centre-back can shuffle three metres sideways in the time a midfielder needs
 * to cover fifteen metres backwards.
 */
function coverDistanceOf(team: SimTeamProfile, index: number): number {
  const slot = team.slots[index];
  if (!slot) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (const [otherIndex, candidate] of team.slots.entries()) {
    if (otherIndex === index) continue;
    const distance = Math.hypot(Math.abs(candidate.nx - slot.nx) * 1.6, Math.abs(candidate.nz - slot.nz));
    if (distance < best) best = distance;
  }
  return Number.isFinite(best) ? round2(best) : 0;
}

/**
 * The one contest that decides the fixture, and what answering it costs.
 *
 * Candidates are every man-versus-man contest on the board, including the two
 * midfield progressions. They are not ranked by the size of the edge; they are
 * ranked by the edge multiplied by the distance cover has to travel. That is
 * the difference between a mismatch and a structural problem.
 */
function lynchpinOf(profile: SimFormProfile, board: DuelBoard): InevitabilityLynchpin | null {
  const squads: Record<Side, SimTeamProfile> = { home: profile.teams[0], away: profile.teams[1] };
  const rows: DuelPairing[] = [...board.lanes, ...board.midfield];

  let best: { row: DuelPairing; cost: number; cover: number } | null = null;
  for (const row of rows) {
    const attackBand = bandOf(row.attacker.role);
    const defendBand = bandOf(row.defender.role);
    // A carry against another forward is not a structural problem: nobody has
    // to cover anything, and nothing opens behind it. The lynchpin has to be a
    // man whose job is to defend the channel he is being attacked in.
    if (attackBand === "GK" || (defendBand !== "DEF" && defendBand !== "MID")) continue;
    const defence = squads[other(row.side)];
    const index = defence.lineup.findIndex((man) => man.name === row.defender.name);
    if (index < 0) continue;
    const cover = coverDistanceOf(defence, index);
    // Signed, not absolute: a contest the attacker loses is not a structural
    // problem the opponent has to answer, it is one they are already winning.
    // The lynchpin is the largest edge someone actually holds, weighted by what
    // it costs to cover.
    const cost = row.edge * (0.5 + clamp(cover, 0, 1.2) * 1.5);
    if (!best || cost > best.cost) best = { row, cost, cover };
  }
  if (!best) return null;

  const { row, cost, cover } = best;
  const attack = squads[row.side];
  const defence = squads[other(row.side)];
  const laneIndex = DUEL_LANES.indexOf(row.lane);
  const wide = laneIndex >= 0 && (laneIndex === 0 || laneIndex === DUEL_LANES.length - 1);

  const response =
    cover >= 0.45
      ? `${defence.short} cannot answer this from inside the channel. The nearest help is ${cover.toFixed(
          2,
        )} slots away, so covering ${row.attacker.name} pulls a man out of the position he was picked to hold.`
      : `${defence.short} can cover this from ${cover.toFixed(
          2,
        )} slots away, so it is answered by a shuffle rather than a change of shape — the edge is what makes it decisive.`;

  const opens = wide
    ? `The channel between the full-back and the centre-back, which is where ${row.attacker.name}'s carries arrive.`
    : `The space in front of ${defence.short}'s back line, which their deepest midfielder was holding.`;

  return {
    side: row.side,
    team: attack.short,
    opponent: defence.short,
    lane: DUEL_LANE_LABELS[row.lane as keyof typeof DUEL_LANE_LABELS] ?? row.lane,
    kind: row.kind,
    attacker: row.attacker.name,
    attackerRole: row.attacker.role,
    defender: row.defender.name,
    defenderRole: row.defender.role,
    share: round3(row.winPct / 100),
    edge: round2(row.edge),
    coverDistance: cover,
    forcedAdaptation: round2(cost),
    response,
    opens,
  };
}

/**
 * Resolve the fixture once.
 *
 * Nothing from the market goes in. How often a side turns a good position into
 * a shot is the engine's own fixed rate; who wins each contest is the two men's
 * numbers; the scoreline is what those contests add up to. A verdict that
 * leaned on a price would be a restatement of the price rather than a reading
 * of the two squads.
 */
export function buildInevitability(profile: SimFormProfile): InevitabilityVerdict {
  const [home, away] = profile.teams;
  // Both the ranking board and the match itself are read on the same basis:
  // what was known before kick-off. Reading the ranking off one set of numbers
  // and the match off another is how a verdict ends up explaining a goal it did
  // not produce.
  const board = buildDuelBoard(profile, { level: preMatchLevel });
  const lynchpin = lynchpinOf(profile, board);
  if (!lynchpin) throw new InevitabilityUnavailableError();

  const played = resolveMatch(profile, { home: 1, away: 1 }, { home: 0, away: 0 }, preMatchLevel);

  // The match's goals are resolved once, not once per side: one draw for the
  // fixture's total, then that total divided by what each side was worth.
  //
  // Two independent draws can hand a side worth 1.15 a 2-0 against one worth
  // 1.70, which is a verdict arguing with its own arithmetic. One shared draw
  // cannot: the side worth more always takes at least its share, the goals add
  // up to the total that was drawn, and two evenly-matched sides are free to
  // draw — which is what evenly-matched sides do. The goals are then placed
  // inside each side's own sequence of possessions, so a minute means where
  // that side's play had actually got to.
  const goalAt = (attempt: Attempt, side: Side): InevitabilityGoal => ({
    minute: attempt.minute,
    side,
    scorer: attempt.creator,
    team: side === "home" ? home.short : away.short,
    channel: DUEL_LANE_LABELS[DUEL_LANES[attempt.lane]] ?? "centre",
    detail: `${attempt.carrier} carried it past ${attempt.stopper}; ${attempt.creator} finished past ${attempt.keeper}`,
  });

  const worth: Record<Side, number> = { home: played.home, away: played.away };
  const squads: Record<Side, SimTeamProfile> = { home, away };
  const elevens: Record<Side, Rated[]> = {
    home: ratedXI(home, 0, preMatchLevel),
    away: ratedXI(away, 0, preMatchLevel),
  };
  const keeperOf = (side: Side) =>
    elevens[side].find((man) => man.band === "GK")?.name ?? `${squads[side].short} keeper`;
  // What each side actually turned into a shot in this walk, not what it was worth.
  const openings: Record<Side, number> = {
    home: openingsOf(played.attempts, "home"),
    away: openingsOf(played.attempts, "away"),
  };

  /**
   * The sheet one side keeps, read off the other side's own numbers.
   *
   * Two rates decide it: what the opponent's play is worth here, and what they
   * score a game, against what this defence concedes a game. The sheet holds
   * when the opponent is worth less than a goal and their scoring rate does not
   * run ahead of the concession.
   */
  const shutoutOf = (side: Side): InevitabilityShutout => {
    const defence = squads[side];
    const attack = squads[other(side)];
    const threat = round2(worth[other(side)]);
    const shotsFaced = round1(openings[other(side)]);
    // A club with no completed matches in the archive reports nothing, not zero:
    // reading its own goal worth is the honest fallback.
    const concededPerGame = Number.isFinite(defence.record.goalsAgainstPerGame)
      ? defence.record.goalsAgainstPerGame
      : threat;
    const scoredPerGame = attack.record.goalsForPerGame || threat;
    // Two ways to a clean sheet. A side worth well under a goal rarely scores at
    // all, so the sheet holds on this match's own arithmetic. Above that it holds
    // only when the opponent's scoring rate does not run ahead of the concession:
    // their attack against this defence, which is what a sheet actually is.
    const clean =
      threat <= 0.85 || (threat <= 1.25 && scoredPerGame <= concededPerGame + 0.1);
    const keeper = keeperOf(side);
    return {
      // Only a sheet that holds has a side; both scoring means neither keeps one.
      side: clean ? side : null,
      clean,
      keeper,
      threat,
      shotsFaced,
      concededPerGame: round2(concededPerGame),
      cleanSheets: defence.record.cleanSheets,
      recentGames: defence.record.games,
      text: clean
        ? `${keeper} keeps the sheet clean: ${attack.short} are worth ${threat.toFixed(
            2,
          )} goals here and score ${scoredPerGame.toFixed(
            2,
          )} a game, against ${defence.short} conceding ${concededPerGame.toFixed(2)}.`
        : `${keeper}'s sheet does not hold: ${attack.short} are worth ${threat.toFixed(
            2,
          )} goals and score ${scoredPerGame.toFixed(
            2,
          )} a game, more than ${defence.short}'s ${concededPerGame.toFixed(2)} conceded.`,
      basis: `Clean sheets ${defence.record.cleanSheets} in ${defence.record.games}, ${concededPerGame.toFixed(
        2,
      )} conceded a game; ${attack.short} score ${scoredPerGame.toFixed(
        2,
      )} a game and made ${shotsFaced.toFixed(1)} openings here.`,
    };
  };

  const stronger: Side | null =
    worth.home === worth.away ? null : worth.home > worth.away ? "home" : "away";
  // Only the side the verdict calls stronger may keep the sheet: a clean sheet
  // for the weaker side would be this verdict arguing with its own arithmetic.
  const shutout: InevitabilityShutout = stronger
    ? shutoutOf(stronger)
    : {
        ...shutoutOf("home"),
        side: null,
        clean: false,
        text: "The two sides are worth the same, so neither sheet is called clean: both score.",
      };

  // The goals are drawn once for the fixture and then split by worth, but no side
  // is ever read past the cap: five goals is a result a reader can check, and a
  // sixth is the walk compounding rather than the match.
  const totalWorth = worth.home + worth.away;
  const drawn =
    totalWorth > 0
      ? Math.min(goalCount(totalWorth, `${profile.fixtureId}:goals`), INEVITABILITY_MAX_GOALS * 2)
      : 0;
  let counts: [number, number] = [0, 0];

  if (shutout.clean && stronger) {
    // A clean sheet fixes the other side at nothing, and the margin is the strong
    // side's own worth read in whole goals.
    counts[stronger === "home" ? 0 : 1] = clamp(
      Math.round(worth[stronger]),
      1,
      INEVITABILITY_MAX_GOALS,
    );
  } else {
    const shares = [
      totalWorth > 0 ? (drawn * worth.home) / totalWorth : 0,
      totalWorth > 0 ? (drawn * worth.away) / totalWorth : 0,
    ];
    counts = [Math.floor(shares[0] + 1e-9), Math.floor(shares[1] + 1e-9)];
    const leftover = drawn - counts[0] - counts[1];
    if (leftover > 0) {
      // A goal left over by the division goes to the larger remainder, and a tie
      // goes to the side worth more: the split may never tell a stronger side it
      // lost to a weaker one.
      const order = [0, 1].sort(
        (left, right) =>
          shares[right] - counts[right] - (shares[left] - counts[left]) ||
          [worth.home, worth.away][right] - [worth.home, worth.away][left],
      );
      for (let index = 0; index < leftover; index += 1) counts[order[index % 2]] += 1;
    }
    counts[0] = Math.min(counts[0], INEVITABILITY_MAX_GOALS);
    counts[1] = Math.min(counts[1], INEVITABILITY_MAX_GOALS);
    // The sheet is broken, so both score: a 1–0 from this same walk would
    // contradict the sheet call that was just made.
    if (drawn >= 2) {
      if (counts[0] === 0) {
        counts[0] = 1;
        counts[1] = Math.max(1, counts[1] - 1);
      } else if (counts[1] === 0) {
        counts[1] = 1;
        counts[0] = Math.max(1, counts[0] - 1);
      }
    }
  }

  const goals: InevitabilityGoal[] = [];
  for (const [index, side] of (["home", "away"] as Side[]).entries()) {
    const counted = counts[index];
    if (counted <= 0) continue;
    // Each goal sits where the side's own play had reached its share of the
    // side's worth — the first at half a share, the second at one and a half —
    // so the minutes follow the possession chain instead of every goal in the
    // match landing on the last possession of the 93rd minute.
    const step = worth[side] / counted;
    let running = 0;
    let next = 1;
    let last: Attempt | null = null;
    for (const attempt of played.attempts) {
      if (attempt.side !== side) continue;
      last = attempt;
      running += attempt.p;
      while (next <= counted && running >= (next - 0.5) * step - 1e-9) {
        goals.push(goalAt(attempt, side));
        next += 1;
      }
    }
    // A goal the walk stopped a hair short of belongs on the last possession
    // the side had rather than nowhere.
    while (next <= counted && last) {
      goals.push(goalAt(last, side));
      next += 1;
    }
  }
  goals.sort((left, right) => left.minute - right.minute);

  const homeScore = goals.filter((goal) => goal.side === "home").length;
  const awayScore = goals.filter((goal) => goal.side === "away").length;
  const scoreline = `${home.short} ${homeScore}–${awayScore} ${away.short}`;
  const winner: Side | "draw" =
    homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : "draw";
  const winnerSide: Side | null = winner === "draw" ? null : winner;
  const margin = Math.abs(homeScore - awayScore);
  const firstGoal = goals[0] ?? null;
  const trailing: Side | null = firstGoal ? other(firstGoal.side) : null;

  // Every pass that shaped the verdict, in the order it was read. The sheet call
  // is one of them and it is the one that picks the scoreline, so a reader can
  // argue with a number instead of with a tone.
  const methods: InevitabilityMethod[] = [
    {
      id: "board",
      label: "Duel ledger",
      reads: `${board.lanes.length + board.midfield.length} man-versus-man contests, on take-on, stop, create, break-up, block and finish.`,
      call: `${lynchpin.attacker} holds ${Math.round(lynchpin.share * 10)} carries in 10 against ${
        lynchpin.defender
      }, which makes the ${lynchpin.lane} channel the one the board is lopsided in.`,
    },
    {
      id: "cover",
      label: "Forced-adaptation test",
      reads: `How far the nearest cover stands from ${lynchpin.defender} — ${lynchpin.coverDistance.toFixed(
        2,
      )} slots — weighted by the edge he is losing.`,
      call: `${lynchpin.forcedAdaptation.toFixed(2)} of forced adaptation: ${
        lynchpin.coverDistance >= 0.45
          ? "answering it costs a change of shape, not a shuffle"
          : "answering it costs only a shuffle, so the edge itself has to carry it"
      } — that is why this contest, and not the biggest mismatch, decides the match.`,
    },
    {
      id: "sheet",
      label: "Clean-sheet ledger",
      reads: shutout.basis,
      call: shutout.text,
    },
    {
      id: "margin",
      label: "Margin ladder",
      reads: `Worth of ${round2(worth.home).toFixed(2)} against ${round2(
        worth.away,
      ).toFixed(2)} goals, read in whole goals and capped at ${INEVITABILITY_MAX_GOALS} a side.`,
      call:
        shutout.clean && winnerSide
          ? `${squads[winnerSide].short} win by ${margin}: ${margin}-0 is the ladder step their worth reaches, and ${
              Math.min(margin + 1, INEVITABILITY_MAX_GOALS)
            }-0 would need a goal the board does not give them.`
          : `No sheet is clean, so the drawn total of ${drawn} is split by worth into ${homeScore}–${awayScore}, the ladder step both sides' own play reaches.`,
    },
    {
      id: "state",
      label: "Game-state test",
      reads: firstGoal
        ? `The first goal lands on ${firstGoal.minute}', from ${firstGoal.scorer}'s ${firstGoal.channel} possession.`
        : "The walk produces no goal at all.",
      call:
        firstGoal && trailing
          ? `${squads[trailing].short} trail from ${firstGoal.minute}' and have to ${
              squads[trailing].tactics.risk >= 0.5
                ? "raise the risk they already play with"
                : "push their line up"
            } to answer it, which is the state the rest of the match is played in.`
          : "With no goal in the walk, neither side is ever chasing the game.",
    },
    {
      id: "volume",
      label: "Volume ceiling",
      reads: `${played.attempts.length} possessions were priced, producing ${round1(
        openings.home + openings.away,
      )} openings across the two sides.`,
      call: `The cap is ${INEVITABILITY_MAX_GOALS} goals a side: nothing in this walk generates a sixth, so a bigger scoreline would be the board's arithmetic rather than the match.`,
    },
  ];

  // The lynchpin channel's own arithmetic: what the mismatch is worth once the
  // whole chain from carry to finish is walked, on this fixture's numbers.
  const laneIndex = DUEL_LANES.findIndex((lane) => DUEL_LANE_LABELS[lane] === lynchpin.lane);
  const channel = played.attempts.filter(
    (attempt) => attempt.side === lynchpin.side && attempt.lane === laneIndex,
  );
  const sum = (pickValue: (attempt: Attempt) => number) =>
    channel.reduce((total, attempt) => total + pickValue(attempt), 0);
  const retained = sum((attempt) => attempt.pCarry);
  const entries = sum((attempt) => attempt.pCarry * attempt.pProgress);
  const shots = sum((attempt) => attempt.pCarry * attempt.pProgress * attempt.pChance);
  const channelGoals = sum((attempt) => attempt.p);

  const cascade: InevitabilityStep[] = [
    {
      label: "Possessions into the channel",
      detail: `${lynchpin.team} start this many possessions in the ${lynchpin.lane} channel.`,
      value: channel.length,
      unit: "possessions",
    },
    {
      label: "Carries retained",
      detail: `${lynchpin.attacker} keeps the ball against ${lynchpin.defender} this many times.`,
      value: round1(retained),
      unit: "carries",
    },
    {
      label: "Final-third entries",
      detail: "Carries that become a ball played into the last third.",
      value: round1(entries),
      unit: "entries",
    },
    {
      label: "Shots",
      detail: "Entries that become a shot rather than a turnover.",
      value: round1(shots),
      unit: "shots",
    },
    {
      label: "Goals from the channel",
      detail: "The whole chain added up, before it is read against the rest of the match.",
      value: round2(channelGoals),
      unit: "goals",
    },
  ];

  // Confidence is the gap between the two sides' worth, not a share of
  // anything. It says whether the verdict is about the elevens or about one
  // channel on one night, and it moves when the board moves.
  const separation = round2(Math.abs(played.home - played.away));
  const tier: InevitabilityConfidence["tier"] =
    separation >= 1 ? "firm" : separation >= 0.45 ? "leaning" : "knife-edge";
  const confidence: InevitabilityConfidence = {
    tier,
    label: tier === "firm" ? "Firm verdict" : tier === "leaning" ? "Leaning verdict" : "Knife-edge",
    separation,
    text:
      tier === "firm"
        ? `${separation.toFixed(2)} goals separate the two sides' own worth, and ${lynchpin.attacker} wins his channel ${Math.round(
            lynchpin.share * 10,
          )} carries in 10. The margin is the board, not the finishing.`
        : tier === "leaning"
          ? `${separation.toFixed(2)} goals separate the two sides' worth — enough to name a winner, not enough to swear to the margin.`
          : `The sides are ${separation.toFixed(2)} goals apart in worth, so this scoreline is one channel resolving on one night rather than a verdict on the elevens.`,
    basis: "Measured on the gap between the two sides' own goal worth, not on a price.",
  };

  const trace: string[] = [];
  trace.push(`Kick-off — ${home.name} (${home.formation}) v ${away.name} (${away.formation})`);
  trace.push(
    `${board.lanes.length + board.midfield.length} contests were priced. One forces an adjustment rather than an answer.`,
  );
  trace.push(
    `Lynchpin — ${lynchpin.attacker} (${lynchpin.team}) into the ${lynchpin.lane} channel against ${lynchpin.defender} (${lynchpin.opponent}): he keeps ${Math.round(
      lynchpin.share * 10,
    )} carries in 10, on ${lynchpin.edge > 0 ? "+" : ""}${lynchpin.edge.toFixed(1)} rating points.`,
  );
  trace.push(`Cover — ${lynchpin.response}`);
  trace.push(`Opens — ${lynchpin.opens}`);
  trace.push(`Call — ${confidence.label}: ${confidence.text}`);
  for (const goal of goals) {
    trace.push(`${goal.minute}' ${goal.team} — ${goal.scorer}, ${goal.channel}. ${goal.detail}.`);
  }
  trace.push(`Sheet — ${shutout.text}`);
  trace.push(
    `Ceiling — ${played.attempts.length} possessions and ${round1(
      openings.home + openings.away,
    )} openings, read against a cap of ${INEVITABILITY_MAX_GOALS} goals a side.`,
  );
  trace.push(`Full time — ${scoreline}`);

  return {
    fixtureId: profile.fixtureId,
    teams: [home.name, away.name],
    short: [home.short, away.short],
    scoreline,
    verdict: {
      home: homeScore,
      away: awayScore,
      winner,
      text: `${scoreline}. ${
        shutout.clean ? `${shutout.keeper} keeps the sheet clean` : "Neither sheet holds"
      }, ${
        lynchpin.share >= 0.5
          ? `${lynchpin.attacker} is not answered in the ${lynchpin.lane} channel`
          : `nothing ${lynchpin.team} run wins its channel and ${lynchpin.defender} is where it costs most`
      }, and everything below follows from that.`,
    },
    lynchpin,
    shutout,
    methods,
    cascade,
    goals,
    expectedGoals: { home: round2(played.home), away: round2(played.away) },
    confidence,
    trace,
    killCondition: `${lynchpin.attacker} unavailable, or ${lynchpin.defender} replaced by a fresher ${lynchpin.defenderRole}, and this verdict is void.`,
    note: `One match, resolved once. ${played.attempts.length} possessions were priced at their own worth and read in order, so this scoreline is the arithmetic residue of the contests above — not one draw out of two thousand. The sheet call fixes the losing side at nothing, and no side is read past ${INEVITABILITY_MAX_GOALS} goals.`,
  };
}
