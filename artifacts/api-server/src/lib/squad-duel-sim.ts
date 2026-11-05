// Plays a fixture as a chain of individual contests rather than as a pair of
// goal averages.
//
// The other simulations in this app decide a scoreline from team-level numbers:
// how many goals a side scores, how many it concedes, and a random draw around
// that rate. This one never looks at a scoreline until the match is over. It
// puts the eleven the team sheets name onto five channels of the pitch, and
// plays the match as a sequence of possessions where a named player has to beat
// a named opponent: the winger has to get past that full-back, the midfielder
// has to play through that midfield, the forward has to beat that centre-back,
// and the shot has to beat that keeper.
//
// Every contest is a logit on the two men's own numbers. Those numbers are the
// skills their level gave them plus the additive weights their own match
// history argues for (player-form.ts), so a winger who has been beating his man
// for a month really is likelier to beat this one. Nothing is compared to a
// price, a league table or an expected scoreline: the score is what the duels
// produced, and a 3-0 falls out of a winger winning five of six carries rather
// than out of a random draw around an average.
//
// The rates that are fixed are the ones football itself fixes — how often a
// possession survives a carry, a progression and a final-third contest, and how
// often a shot on target is a goal — and they are the same for both sides. All
// the difference between the teams comes from the players.

import { levelFor } from "./open-football-replay.ts";
import type { SimFormProfile, SimLineupPlayer, SimTeamProfile } from "./sim-form-profile";

type Side = "home" | "away";
type Band = "GK" | "DEF" | "MID" | "FWD";
type Lane = "left" | "left-in" | "centre" | "right-in" | "right";

const LANES: Lane[] = ["left", "left-in", "centre", "right-in", "right"];
const LANE_LABEL: Record<Lane, string> = {
  left: "Left wing",
  "left-in": "Left inside",
  centre: "Centre",
  "right-in": "Right inside",
  right: "Right wing",
};

// Football's own shape, not this fixture's: a possession survives its carry
// about six times in ten, a side that keeps the ball gets into the final third
// about half the time, and the final-third contest becomes a shot about a third
// of the time. A shot is a goal a little over a tenth of the time. Those four
// numbers produce the ~11 shots and ~2.6 goals a match real football does, and
// they are identical for both teams; who wins each contest is the only thing
// that differs.
const POSSESSIONS = 190;
/** At even numbers: a carry survives six times in ten, a progression five and
 *  a half, a final-third contest becomes a shot a third of the time, and a
 *  shot at an even keeper goes in a little over a tenth of the time. Those
 *  multiply out to ~11 shots and ~1.2 goals a side, which is the shape of a
 *  football match; the duel shifts each of them rather than replacing them. */
const CARRY_SURVIVES = 0.62;
const PROGRESS_SURVIVES = 0.55;
const CHANCE_MADE = 0.35;
const SHOT_TO_GOAL = 0.11;
// Playing at home is worth a little in the duel itself — the crowd, the pitch,
// the referee's ear — and it is the same amount in every match.
const HOME_EDGE = 0.12;
// How steeply a rating difference turns into a win probability. At 3.2 a man
// a full point better than his opponent wins about 58% of their contests.
const DUEL_SCALE = 3.2;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const logistic = (value: number) => 1 / (1 + Math.exp(-value));

function bandOf(role: string | null | undefined): Band {
  const value = (role ?? "").toUpperCase();
  if (value.startsWith("GK")) return "GK";
  if (value.startsWith("D") || value === "LB" || value === "RB" || value === "CB") return "DEF";
  if (value.startsWith("M") || value === "DM" || value === "CM" || value === "LM" || value === "RM") {
    return "MID";
  }
  return "FWD";
}

/**
 * One skill of one player on the engine's 1..20 scale.
 *
 * The level he has earned sets the base for every skill, and his own match
 * history adds to the skills it speaks to. A winger with no history has the
 * skills his level implies; one who has completed nine dribbles in five matches
 * has a higher dribbling and it shows up in the carry duel.
 */
function attr(player: SimLineupPlayer, skill: string, level: number): number {
  const base = 8.6 + (level - 12) * 0.62;
  return clamp(base + (player.form?.skills?.[skill] ?? 0), 1, 20);
}

/** A weighted blend of the skills a duel is about. */
function blend(player: SimLineupPlayer, level: number, parts: [string, number][]): number {
  let total = 0;
  for (const [skill, weight] of parts) total += attr(player, skill, level) * weight;
  return total;
}

type Rated = {
  player: SimLineupPlayer;
  name: string;
  role: string;
  band: Band;
  lane: number;
  level: number;
  takeOn: number;
  stop: number;
  create: number;
  breakUp: number;
  threat: number;
  block: number;
  finish: number;
  keeper: number;
};

function rated(player: SimLineupPlayer, lane: number): Rated {
  const level = levelFor(player);
  return {
    player,
    name: player.name,
    role: player.role,
    band: bandOf(player.role),
    lane,
    level,
    takeOn: blend(player, level, [["dribbling", 0.45], ["technique", 0.3], ["composure", 0.25]]),
    stop: blend(player, level, [["tackling", 0.45], ["positioning", 0.3], ["strength", 0.25]]),
    create: blend(player, level, [["passing", 0.45], ["anticipation", 0.3], ["crossing", 0.25]]),
    breakUp: blend(player, level, [["anticipation", 0.45], ["positioning", 0.3], ["tackling", 0.25]]),
    threat: blend(player, level, [["finishing", 0.45], ["technique", 0.3], ["composure", 0.25]]),
    block: blend(player, level, [["marking", 0.5], ["strength", 0.3], ["positioning", 0.2]]),
    finish: blend(player, level, [["finishing", 0.6], ["composure", 0.25], ["technique", 0.15]]),
    keeper: blend(player, level, [
      ["reflexes", 0.45],
      ["handling", 0.3],
      ["command_of_area", 0.25],
    ]),
  };
}

/**
 * Which channel of the pitch a player stands in.
 *
 * The slots carry `nx` (how far up the pitch, keeper 0.04 to striker 0.73) and
 * `nz` (how far across, 0.13 to 0.87), so the channel is the across one. A left
 * back and a left winger share a channel; the two centre-backs do not.
 */
function laneOf(team: SimTeamProfile, index: number): number {
  const slot = team.slots[index];
  const nz = typeof slot?.nz === "number" ? slot.nz : 0.5;
  return clamp(Math.floor(nz * LANES.length), 0, LANES.length - 1);
}

function ratedXI(team: SimTeamProfile): Rated[] {
  return team.lineup.map((player, index) => {
    // A substitute brought in for an injured starter has no position of his
    // own in the sheet he came from, so the slot he fills says what he is here.
    const slotRole = team.slots[index]?.role;
    if (slotRole && player.role.toUpperCase() === "SUB") {
      return rated({ ...player, role: slotRole }, laneOf(team, index));
    }
    return rated(player, laneOf(team, index));
  });
}

/**
 * Who plays the part in a channel.
 *
 * The man who carries in a channel is the furthest forward one in it; the man
 * who stops him is the deepest one in the same channel. When a channel has
 * nobody in the right band the nearest man along plays it slightly out of
 * position, which is what a side with three at the back asks of its wide
 * midfielders anyway.
 */
function pick(list: Rated[], lane: number, bands: Band[]): Rated | null {
  let best: { player: Rated; cost: number } | null = null;
  for (const player of list) {
    const bandRank = bands.indexOf(player.band);
    const cost = Math.abs(player.lane - lane) * 1.1 + (bandRank < 0 ? 8 : bandRank);
    if (!best || cost < best.cost) best = { player, cost };
  }
  return best?.player ?? null;
}

/**
 * The same pick, but the ball goes to whoever is in the channel rather than
 * always to the best of them.
 *
 * A possession is not always the winger's: the striker drops into the channel,
 * the full-back overlaps, the midfielder drifts wide. Choosing the closest men
 * with a weighting — rather than the single best one every time — is what keeps
 * one man from carrying every ball down his flank and turning the table into a
 * list of one player's 100 contests.
 */
function pickRotating(
  list: Rated[],
  lane: number,
  bands: Band[],
  random: () => number,
  bias?: (player: Rated) => number,
): Rated | null {
  const scored = list
    .map((player) => {
      const bandRank = bands.indexOf(player.band);
      return { player, cost: Math.abs(player.lane - lane) * 1.1 + (bandRank < 0 ? 8 : bandRank) };
    })
    .sort((left, right) => left.cost - right.cost)
    .slice(0, 3);
  if (!scored.length) return null;
  // Being in the channel makes a man likely; being good at the job makes him
  // likelier. That is why a striker takes more of his side's shots than a
  // centre-back does without anybody scripting it.
  const weights = scored.map(
    (entry) => Math.exp(-entry.cost * 0.9 + (bias ? bias(entry.player) : 0)),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = random() * total;
  for (const [index, weight] of weights.entries()) {
    target -= weight;
    if (target <= 0) return scored[index]?.player ?? scored[0].player;
  }
  return scored[0].player;
}

export type DuelPairing = {
  lane: Lane;
  /** Which side is carrying the ball in this contest. */
  side: Side;
  label: string;
  attacker: { name: string; role: string; rating: number };
  defender: { name: string; role: string; rating: number };
  /** Chance the attacker's side, on these numbers, wins this contest. */
  winPct: number;
  /** What the contest is about, e.g. "carry" or "final third". */
  kind: "carry" | "progression" | "final third";
  /** Attacker's rating on the scale the contest is decided on. */
  edge: number;
};

export type DuelBoard = {
  lanes: DuelPairing[];
  midfield: DuelPairing[];
  keepers: {
    side: Side;
    name: string;
    rating: number;
    faces: string;
  }[];
  /** Mean level of the XI each side puts out, and the gap between them. */
  strength: { home: number; away: number; gap: number };
  /** Rating edges that separate the two elevens, per band. */
  bands: { band: Band; home: number; away: number }[];
};

export type DuelPlayerLine = {
  name: string;
  side: Side;
  role: string;
  duels: number;
  won: number;
  winPct: number;
  shots: number;
  goals: number;
  saves: number;
  conceded: number;
};

export type DuelScoreline = { home: number; away: number; count: number; pct: number };

export type DuelSimulation = {
  trials: number;
  seed: number;
  board: DuelBoard;
  outcome: {
    home: number;
    draw: number;
    away: number;
    mostLikely: DuelScoreline | null;
    homeGoals: number;
    awayGoals: number;
    totalGoals: number;
    btts: number;
    over25: number;
    cleanSheetHome: number;
    cleanSheetAway: number;
  };
  scorelines: DuelScoreline[];
  twists: {
    label: string;
    detail: string;
    pct: number;
    kind: "rout" | "upset" | "draw" | "goalfest" | "clean sheet";
  }[];
  players: DuelPlayerLine[];
  sample: { minute: number; side: Side; text: string; goal: boolean }[];
  note: string;
};

function pairing(
  lane: Lane,
  side: Side,
  kind: DuelPairing["kind"],
  attacker: Rated,
  defender: Rated,
  attackRating: number,
  defenceRating: number,
  edge: number,
): DuelPairing {
  return {
    lane,
    side,
    label: LANE_LABEL[lane],
    kind,
    attacker: { name: attacker.name, role: attacker.role, rating: Math.round(attackRating * 10) / 10 },
    defender: { name: defender.name, role: defender.role, rating: Math.round(defenceRating * 10) / 10 },
    edge: Math.round((attackRating - defenceRating) * 100) / 100,
    winPct: Math.round(logistic((attackRating - defenceRating) / DUEL_SCALE) * 1000) / 10,
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

/**
 * The ten channel contests and the two keeper contests this fixture sets up.
 * This is the board the match is played on, and it is also the answer to "why
 * does the simulation think that": the winger who wins six carries in ten is
 * the reason his side's goals land where they do.
 */
export function buildDuelBoard(profile: SimFormProfile): DuelBoard {
  const [home, away] = profile.teams;
  const homeXI = ratedXI(home);
  const awayXI = ratedXI(away);
  const lanes: DuelPairing[] = [];
  const midfield: DuelPairing[] = [];

  // One row per man-versus-man contest. A player who covers two channels — a
  // winger who plays both the wide and the inside part of his flank — is only
  // listed once, against the man he actually meets.
  const seen = new Set<string>();
  const add = (row: DuelPairing) => {
    const key = `${row.side}:${row.attacker.name}|${row.defender.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    lanes.push(row);
  };

  for (const [index, lane] of LANES.entries()) {
    const homeCarrier = pick(homeXI, index, ["FWD", "MID", "DEF"]);
    const awayCarrier = pick(awayXI, index, ["FWD", "MID", "DEF"]);
    const homeStopper = pick(homeXI, index, ["DEF", "MID", "FWD"]);
    const awayStopper = pick(awayXI, index, ["DEF", "MID", "FWD"]);
    if (homeCarrier && awayStopper) {
      add(
        pairing(lane, "home", "carry", homeCarrier, awayStopper, homeCarrier.takeOn + HOME_EDGE, awayStopper.stop, 0),
      );
    }
    if (awayCarrier && homeStopper) {
      add(
        pairing(lane, "away", "carry", awayCarrier, homeStopper, awayCarrier.takeOn, homeStopper.stop + HOME_EDGE, 0),
      );
    }
  }

  const homeMid = pick(homeXI, 2, ["MID", "FWD", "DEF"]);
  const awayMid = pick(awayXI, 2, ["MID", "FWD", "DEF"]);
  const homeBreaker = pick(homeXI, 2, ["MID", "DEF", "FWD"]);
  const awayBreaker = pick(awayXI, 2, ["MID", "DEF", "FWD"]);
  if (homeMid && awayBreaker) {
    midfield.push(
      pairing("centre", "home", "progression", homeMid, awayBreaker, homeMid.create + HOME_EDGE, awayBreaker.breakUp, 0),
    );
  }
  if (awayMid && homeBreaker) {
    midfield.push(
      pairing("centre", "away", "progression", awayMid, homeBreaker, awayMid.create, homeBreaker.breakUp + HOME_EDGE, 0),
    );
  }

  const keeper = (team: SimTeamProfile, xi: Rated[]) => {
    const man = xi.find((entry) => entry.band === "GK") ?? null;
    return { name: man?.name ?? "—", rating: man ? Math.round(man.keeper * 10) / 10 : 0 };
  };
  const homeKeeper = keeper(home, homeXI);
  const awayKeeper = keeper(away, awayXI);
  // The man a keeper most expects to face is the forward with the best
  // finishing, not whichever outfielder scored highest overall.
  const shooterOf = (xi: Rated[]) => {
    const forwards = xi.filter((entry) => entry.band === "FWD");
    return [...(forwards.length ? forwards : xi)].sort((a, b) => b.finish - a.finish)[0] ?? null;
  };
  const homeShooter = shooterOf(homeXI);
  const awayShooter = shooterOf(awayXI);

  const homeMean = mean(homeXI.map((entry) => entry.level));
  const awayMean = mean(awayXI.map((entry) => entry.level));
  const bands: DuelBoard["bands"] = (["GK", "DEF", "MID", "FWD"] as Band[])
    .map((band) => ({
      band,
      home: Math.round(mean(homeXI.filter((entry) => entry.band === band).map((entry) => entry.level)) * 10) / 10,
      away: Math.round(mean(awayXI.filter((entry) => entry.band === band).map((entry) => entry.level)) * 10) / 10,
    }))
    .filter((row) => Number.isFinite(row.home) && Number.isFinite(row.away));

  return {
    lanes,
    midfield,
    keepers: [
      {
        side: "home",
        name: homeKeeper.name,
        rating: homeKeeper.rating,
        faces: awayShooter?.name ?? "—",
      },
      {
        side: "away",
        name: awayKeeper.name,
        rating: awayKeeper.rating,
        faces: homeShooter?.name ?? "—",
      },
    ],
    strength: {
      home: Math.round(homeMean * 100) / 100,
      away: Math.round(awayMean * 100) / 100,
      gap: Math.round((homeMean - awayMean) * 100) / 100,
    },
    bands,
  };
}

/** A deterministic random stream, so a seed is a match you can come back to. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Play the fixture `trials` times, duel by duel.
 *
 * Each trial is 190 possessions shared by the two sides in the proportion their
 * own recent matches say they have the ball. A possession is four contests in
 * the channel it starts in; losing any of the first three ends it. No trial
 * knows or looks at what the others produced, so the spread of scorelines across
 * the trials is the spread the elevens produce, and a rout is a rout because one
 * side kept winning its duels rather than because the draw went wide.
 */
export function runDuelSimulation(
  profile: SimFormProfile,
  options: { trials?: number; seed?: number } = {},
): DuelSimulation {
  const trials = clamp(Math.round(options.trials ?? 2000), 1, 20_000);
  const seed = Math.abs(Math.round(options.seed ?? 1)) || 1;
  const board = buildDuelBoard(profile);
  const [home, away] = profile.teams;

  const homeShare = possessionShare(home, away);
  const homePossessions = Math.round(POSSESSIONS * homeShare);
  const awayPossessions = POSSESSIONS - homePossessions;

  const homeXI = ratedXI(home);
  const awayXI = ratedXI(away);
  const lines = new Map<Rated, { side: Side; duels: number; won: number; shots: number; goals: number; saves: number; conceded: number }>();
  const line = (player: Rated, side: Side) => {
    let row = lines.get(player);
    if (!row) {
      row = { side, duels: 0, won: 0, shots: 0, goals: 0, saves: 0, conceded: 0 };
      lines.set(player, row);
    }
    return row;
  };
  for (const player of homeXI) line(player, "home");
  for (const player of awayXI) line(player, "away");

  const scorelines = new Map<string, number>();
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let homeGoalsTotal = 0;
  let awayGoalsTotal = 0;
  let btts = 0;
  let over25 = 0;
  let cleanSheetHome = 0;
  let cleanSheetAway = 0;
  let biggestHome = { home: 0, away: 0, count: 0 };
  let biggestAway = { home: 0, away: 0, count: 0 };
  let highest = { home: 0, away: 0, count: 0 };
  let sample: DuelSimulation["sample"] = [];

  // The channel a possession starts in: the wings are where play starts, a
  // direct side goes through the middle more often, and each side plays its own
  // shape rather than the same five lanes every time.
  const laneWeights = (team: SimTeamProfile): number[] => {
    const direct = clamp((team.style.longBallShare ?? 0.2) / 0.4, 0, 1);
    const crosses = clamp((team.style.crosses ?? 20) / 40, 0, 1);
    const centre = 1 + direct * 0.9;
    const wing = 1 + crosses * 0.8;
    return [wing, 0.9, centre, 0.9, wing];
  };
  const homeLanes = laneWeights(home);
  const awayLanes = laneWeights(away);

  for (let trial = 0; trial < trials; trial += 1) {
    const random = mulberry32(seed + trial * 7919);
    const record = trial === 0;
    let homeScore = 0;
    let awayScore = 0;
    const events: DuelSimulation["sample"] = [];

    const play = (side: Side, minute: number) => {
      const attacking = side === "home" ? homeXI : awayXI;
      const defending = side === "home" ? awayXI : homeXI;
      const weights = side === "home" ? homeLanes : awayLanes;
      const laneIndex = drawLane(random, weights);
      const edge = side === "home" ? HOME_EDGE : 0;

      const carrier = pickRotating(attacking, laneIndex, ["FWD", "MID", "DEF"], random, (man) =>
        (man.takeOn - 9) * 0.35,
      );
      const stopper = pickRotating(defending, laneIndex, ["DEF", "MID", "FWD"], random, (man) =>
        (man.stop - 9) * 0.25,
      );
      // The man who finishes the move is usually not the man who carried it.
      const creator = pickRotating(
        attacking.filter((entry) => entry !== carrier),
        laneIndex,
        ["FWD", "MID", "DEF"],
        random,
        (man) => (man.threat - 9) * 0.6,
      );
      const blocker = pickRotating(defending, laneIndex, ["DEF", "MID", "FWD"], random, (man) =>
        (man.block - 9) * 0.3,
      );
      const keeper = defending.find((entry) => entry.band === "GK") ?? null;
      if (!carrier || !stopper || !creator || !blocker || !keeper) return;

      // 1. Beating the man in front of him.
      const carryLine = line(carrier, side);
      const stopLine = line(stopper, side === "home" ? "away" : "home");
      carryLine.duels += 1;
      stopLine.duels += 1;
      if (random() > chainP(CARRY_SURVIVES, carrier.takeOn + edge, stopper.stop)) {
        stopLine.won += 1;
        return;
      }
      carryLine.won += 1;
      if (record && random() < 0.06) {
        events.push({ minute, side, goal: false, text: `${carrier.name} goes past ${stopper.name}` });
      }

      // 2. Playing through the block.
      const createLine = line(creator, side);
      const breakLine = line(blocker, side === "home" ? "away" : "home");
      createLine.duels += 1;
      breakLine.duels += 1;
      if (random() > chainP(PROGRESS_SURVIVES, creator.create + edge, blocker.breakUp)) {
        breakLine.won += 1;
        return;
      }
      createLine.won += 1;

      // 3. Beating the last man to get a shot away.
      const shotLine = line(creator, side);
      const blockLine = line(blocker, side === "home" ? "away" : "home");
      shotLine.duels += 1;
      blockLine.duels += 1;
      if (random() > chainP(CHANCE_MADE, creator.threat + edge, blocker.block)) {
        blockLine.won += 1;
        return;
      }
      shotLine.won += 1;
      shotLine.shots += 1;

      // 4. Beating the keeper. A striker wins this contest about half the time
      //    against an equal keeper, and half of that is a goal.
      const keeperLine = line(keeper, side === "home" ? "away" : "home");
      // At an even finish-vs-keeper duel this is SHOT_TO_GOAL; a striker a
      // point better than the keeper is worth a few per cent on top.
      const scores = random() < SHOT_TO_GOAL * 2 * winP(creator.finish + edge, keeper.keeper);
      if (scores) {
        shotLine.goals += 1;
        keeperLine.conceded += 1;
        if (side === "home") homeScore += 1;
        else awayScore += 1;
        if (record) {
          events.push({
            minute,
            side,
            goal: true,
            text: `${creator.name} beats ${keeper.name}`,
          });
        }
      } else {
        keeperLine.saves += 1;
        if (record && random() < 0.1) {
          events.push({ minute, side, goal: false, text: `${creator.name} forces a save from ${keeper.name}` });
        }
      }
    };

    for (let index = 0; index < homePossessions; index += 1) {
      play("home", Math.min(93, Math.floor(((index * 2) / POSSESSIONS) * 93) + 1));
    }
    for (let index = 0; index < awayPossessions; index += 1) {
      play("away", Math.min(93, Math.floor(((index * 2 + 1) / POSSESSIONS) * 93) + 1));
    }

    // A goal that arrives in the last minute is a goal in the last minute.
    events.sort((left, right) => left.minute - right.minute);
    if (record) {
      sample = [
        { minute: 0, side: "home", text: "Kick-off", goal: false },
        ...events,
        {
          minute: 90,
          side: homeScore >= awayScore ? "home" : "away",
          text: `Full time ${homeScore}–${awayScore}`,
          goal: false,
        },
      ];
    }

    homeGoalsTotal += homeScore;
    awayGoalsTotal += awayScore;
    const key = `${homeScore}-${awayScore}`;
    scorelines.set(key, (scorelines.get(key) ?? 0) + 1);
    if (homeScore > awayScore) homeWins += 1;
    else if (homeScore < awayScore) awayWins += 1;
    else draws += 1;
    if (homeScore > 0 && awayScore > 0) btts += 1;
    if (homeScore + awayScore > 2.5) over25 += 1;
    if (awayScore === 0) cleanSheetHome += 1;
    if (homeScore === 0) cleanSheetAway += 1;

    const margin = Math.abs(homeScore - awayScore);
    if (homeScore > awayScore && margin > biggestHome.home - biggestHome.away) {
      biggestHome = { home: homeScore, away: awayScore, count: 1 };
    } else if (homeScore > awayScore && margin === biggestHome.home - biggestHome.away) {
      biggestHome.count += 1;
    }
    if (awayScore > homeScore && margin > biggestAway.away - biggestAway.home) {
      biggestAway = { home: homeScore, away: awayScore, count: 1 };
    } else if (awayScore > homeScore && margin === biggestAway.away - biggestAway.home) {
      biggestAway.count += 1;
    }
    if (homeScore + awayScore > highest.home + highest.away) {
      highest = { home: homeScore, away: awayScore, count: 1 };
    } else if (homeScore + awayScore === highest.home + highest.away) {
      highest.count += 1;
    }
  }

  const ordered = [...scorelines.entries()]
    .map(([key, count]) => {
      const [homeGoals, awayGoals] = key.split("-").map(Number);
      return {
        home: homeGoals ?? 0,
        away: awayGoals ?? 0,
        count,
        pct: Math.round((count / trials) * 1000) / 10,
      };
    })
    .sort((left, right) => right.count - left.count || left.home - right.home);

  const pct = (count: number) => Math.round((count / trials) * 1000) / 10;
  const stronger = board.strength.gap >= 0 ? "home" : "away";
  const upsetWins = stronger === "home" ? awayWins : homeWins;

  const players: DuelPlayerLine[] = [...lines.entries()]
    .map(([player, row]) => ({
      name: player.name,
      side: row.side,
      role: player.role,
      duels: Math.round((row.duels / trials) * 10) / 10,
      won: Math.round((row.won / trials) * 10) / 10,
      winPct: row.duels ? Math.round((row.won / row.duels) * 1000) / 10 : 0,
      shots: Math.round((row.shots / trials) * 100) / 100,
      goals: Math.round((row.goals / trials) * 100) / 100,
      saves: Math.round((row.saves / trials) * 100) / 100,
      conceded: Math.round((row.conceded / trials) * 100) / 100,
    }))
    .sort((left, right) => right.winPct - left.winPct || right.goals - left.goals);

  const twists: DuelSimulation["twists"] = [];
  if (biggestHome.home > biggestHome.away) {
    twists.push({
      label: "biggest home win",
      detail: `${biggestHome.home}–${biggestHome.away}`,
      pct: pct(biggestHome.count),
      kind: "rout",
    });
  }
  if (biggestAway.away > biggestAway.home) {
    twists.push({
      label: "biggest away win",
      detail: `${biggestAway.home}–${biggestAway.away}`,
      pct: pct(biggestAway.count),
      kind: stronger === "home" ? "upset" : "rout",
    });
  }
  twists.push({
    label: "highest scoring",
    detail: `${highest.home}–${highest.away}`,
    pct: pct(highest.count),
    kind: "goalfest",
  });
  twists.push({
    label: stronger === "home" ? "away win" : "home win",
    detail: stronger === "home" ? away.name : home.name,
    pct: pct(upsetWins),
    kind: "upset",
  });
  const noScore = scorelines.get("0-0") ?? 0;
  if (noScore) {
    twists.push({ label: "goalless", detail: "0–0", pct: pct(noScore), kind: "draw" });
  }

  const note =
    trials < 200
      ? `Only ${trials} matches played — enough to watch, not enough to trust a percentage.`
      : `Every scoreline above came out of ${trials.toLocaleString()} matches played possession by possession.`;

  return {
    trials,
    seed,
    board,
    outcome: {
      home: pct(homeWins),
      draw: pct(draws),
      away: pct(awayWins),
      mostLikely: ordered[0] ?? null,
      homeGoals: Math.round((homeGoalsTotal / trials) * 100) / 100,
      awayGoals: Math.round((awayGoalsTotal / trials) * 100) / 100,
      totalGoals: Math.round(((homeGoalsTotal + awayGoalsTotal) / trials) * 100) / 100,
      btts: pct(btts),
      over25: pct(over25),
      cleanSheetHome: pct(cleanSheetHome),
      cleanSheetAway: pct(cleanSheetAway),
    },
    scorelines: ordered.slice(0, 24),
    twists,
    players,
    sample,
    note,
  };
}

function drawLane(random: () => number, weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = random() * total;
  for (const [index, weight] of weights.entries()) {
    target -= weight;
    if (target <= 0) return index;
  }
  return Math.floor(weights.length / 2);
}

/** The chance the attacking number beats the defending one. */
function winP(attack: number, defence: number): number {
  return logistic((attack - defence) / DUEL_SCALE);
}

/**
 * The chance a step of the possession survives, at its own base rate.
 *
 * The base is the even-match rate, so a contest between equals comes out at
 * the base rather than at base-times-a-half: the odds of the two men's numbers
 * move it up or down from there.
 */
function chainP(base: number, attack: number, defence: number): number {
  // A man who wins 58% of his duels does not thereby double his side's chances:
  // a possession has three men to beat, so the edge each of them carries into
  // one step is a fraction of his duel edge. Without that the same advantage
  // compounds three times and a half-decent winger turns into a rout.
  return logistic(Math.log(base / (1 - base)) + ((attack - defence) * 0.5) / DUEL_SCALE);
}

/**
 * How the ball is shared.
 *
 * From the two sides' own recent matches when the feed has possession for both,
 * and even when it does not. Nothing about the fixture's price or expectation
 * goes in.
 */
function possessionShare(home: SimTeamProfile, away: SimTeamProfile): number {
  const left = home.style.possession;
  const right = away.style.possession;
  if (typeof left === "number" && typeof right === "number" && left > 0 && right > 0) {
    return clamp(left / (left + right), 0.34, 0.66);
  }
  return 0.5;
}

export const DUEL_LANES = LANES;
