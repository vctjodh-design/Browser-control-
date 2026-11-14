// The final decision tree: one board read, then every market settled from it.
//
// The other tabs answer one question each — the duels tab prices the contests,
// the table tab says where the clubs sit, the form tab says what they have done
// lately, the injury list says who is missing, the odds tab says what the market
// thinks. This module reads all of them together and settles the markets, so
// the reader gets one answer per line instead of six panels to average by eye.
//
// Two rules keep the combination honest.
//
// The board decides. The two goal worths are the only numbers that can name a
// winner or a total; form, table, availability and the market board can only
// move how firmly the tree holds the call, never what the call is. A rule that
// let last month's results overrule tonight's eleven would be the model arguing
// with itself.
//
// No prices, no percentages. Each line is settled at its own crossing point —
// the worth at which the line stops being a losing call at even money — so a
// call is a comparison, not a probability. Those crossings are the Poisson
// medians, printed in the constants below and derivable by anyone who wants to
// check them.

import type { InevitabilityVerdict } from "./inevitability-engine";
import type { SimFormProfile } from "./sim-form-profile";

export type Side = "home" | "away";

/** How firmly the tree holds a call. Not a probability, and never printed as one. */
export type DecisionTier = "firm" | "leaning" | "knife-edge";

/**
 * The worth at which each line becomes an even call.
 *
 * A side worth w scores none with weight e^-w, one with w·e^-w, and so on, so
 * the whole-goal count is a Poisson reading of its worth. The line where a
 * market stops being a losing call at level stakes is where the count is as
 * likely above the line as at or below it — the median:
 *
 *   none vs any      e^-w = 1/2                     → w ≈ 0.693
 *   two or more      1 + w = e^w                    → w ≈ 1.678
 *   three or more    1 + w + w²/2 = e^w             → w ≈ 2.674
 *   four or more     1 + w + w²/2 + w³/6 = e^w      → w ≈ 3.672
 *
 * Those are the four numbers the whole tab turns on.
 */
const ONE_GOAL = 0.693;
const TWO_GOALS = 1.678;
const THREE_GOALS = 2.674;
const FOUR_GOALS = 3.672;

/**
 * The worth gap a one-goal handicap needs before the favourite covers it.
 *
 * A side worth a goal more than its opponent wins by one on the likeliest read;
 * covering −1 needs the reading to be two clear, so the gap has to be worth more
 * than a single goal on its own.
 */
const HANDICAP_GAP = 0.85;

const TIER_ORDER: DecisionTier[] = ["knife-edge", "leaning", "firm"];

/** Move a tier one step, never past either end. */
export function shiftTier(tier: DecisionTier, by: number): DecisionTier {
  const index = TIER_ORDER.indexOf(tier);
  const next = Math.min(TIER_ORDER.length - 1, Math.max(0, index + by));
  return TIER_ORDER[next];
}

const TIER_LABEL: Record<DecisionTier, string> = {
  firm: "Firm",
  leaning: "Leaning",
  "knife-edge": "Knife-edge",
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function other(side: Side): Side {
  return side === "home" ? "away" : "home";
}

function rateOf(tally: number, games: number): number | null {
  return Number.isFinite(tally) && Number.isFinite(games) && games > 0 ? tally / games : null;
}

/**
 * What the two worths settle on their own.
 *
 * Pure, so the crossings can be checked line by line without building a whole
 * fixture: give it two worths and it returns every call the board supports.
 */
export type BoardFacts = {
  homeWorth: number;
  awayWorth: number;
  /** The whole-goal counts the scoreline was read at. */
  homeGoals: number;
  awayGoals: number;
};

export type BoardCalls = {
  winner: Side | "draw";
  /** Goals between the two worths, signed from home to away. */
  gap: number;
  total: number;
  result: string;
  doubleChance: string;
  drawNoBet: string;
  handicap: string;
  winToNil: string;
  overOneAndHalf: string;
  overTwoAndHalf: string;
  overThreeAndHalf: string;
  bothTeamsScore: string;
  homeCleanSheet: string;
  awayCleanSheet: string;
  homeTeamTotal: string;
  awayTeamTotal: string;
  correctScore: string;
  /** The side read at nothing on the scoreline, if either. */
  sheetSide: Side | null;
};

export function settleFromBoard(facts: BoardFacts): BoardCalls {
  const { homeWorth: home, awayWorth: away, homeGoals, awayGoals } = facts;
  const gap = home - away;
  const total = home + away;
  const winner: Side | "draw" = home > away ? "home" : away > home ? "away" : "draw";

  // A side worth more than a quarter of a goal is worth more than a draw; the
  // engine's own tie-break has already put that winner on the scoreline, so the
  // result call follows the scoreline rather than re-deciding it here.
  const result =
    homeGoals > awayGoals ? "Home win" : awayGoals > homeGoals ? "Away win" : "Draw";
  const winnerOnScore: Side | "draw" =
    homeGoals > awayGoals ? "home" : awayGoals > homeGoals ? "away" : "draw";

  const doubleChance =
    winnerOnScore === "home"
      ? "Home or draw (1X)"
      : winnerOnScore === "away"
        ? "Away or draw (X2)"
        : home >= away
          ? "Home or draw (1X)"
          : "Away or draw (X2)";

  const drawNoBet =
    winnerOnScore === "home"
      ? "Home"
      : winnerOnScore === "away"
        ? "Away"
        : "No side — a draw is the reading";

  // The favourite has to be worth a goal more than the opponent *and* worth two
  // goals itself before a one-goal handicap stops being a losing line: a 1–0
  // reading covers nothing.
  const favourite: Side | null = winner === "draw" ? null : winner;
  const favouriteWorth = favourite === "home" ? home : favourite === "away" ? away : 0;
  const handicap =
    favourite && Math.abs(gap) >= HANDICAP_GAP && favouriteWorth >= TWO_GOALS
      ? "Favourite −1"
      : favourite
        ? "Underdog +1"
        : "No line — no winner to give a goal to";

  // A sheet is a read of the scoreline, so win-to-nil is only available when the
  // winner also kept one.
  const winToNil =
    winnerOnScore === "home" && awayGoals === 0
      ? "Home to win to nil"
      : winnerOnScore === "away" && homeGoals === 0
        ? "Away to win to nil"
        : "No";

  return {
    winner,
    gap,
    total: round2(total),
    result,
    doubleChance,
    drawNoBet,
    handicap,
    winToNil,
    overOneAndHalf: total >= TWO_GOALS ? "Over 1.5" : "Under 1.5",
    overTwoAndHalf: total >= THREE_GOALS ? "Over 2.5" : "Under 2.5",
    overThreeAndHalf: total >= FOUR_GOALS ? "Over 3.5" : "Under 3.5",
    // The sheet and both-teams-to-score belong to the scoreline, not to a
    // threshold beside it. Reading them off a crossing let a card say "1–0" and
    // "no clean sheet" in the same breath, because an opponent worth 0.79 is a
    // hair above the crossing while the scoreline still gives it nothing. The
    // crossing is kept as the check on how firmly the sheet is held, not as a
    // second opinion on whether it happened.
    bothTeamsScore: homeGoals > 0 && awayGoals > 0 ? "Yes" : "No",
    homeCleanSheet: awayGoals === 0 ? "Yes" : "No",
    awayCleanSheet: homeGoals === 0 ? "Yes" : "No",
    homeTeamTotal: home >= TWO_GOALS ? "Over 1.5" : "Under 1.5",
    awayTeamTotal: away >= TWO_GOALS ? "Over 1.5" : "Under 1.5",
    correctScore: `${homeGoals}–${awayGoals}`,
    sheetSide:
      awayGoals === 0 && homeGoals > 0 ? "home" : homeGoals === 0 && awayGoals > 0 ? "away" : null,
  };
}

/** One rung of the tree: the question, what it read, and the branch it took. */
export type DecisionNode = {
  id: string;
  /** 0 is the root; each step down is one question deeper. */
  depth: number;
  branch: "board" | "result" | "goals" | "scoring" | "record" | "availability";
  question: string;
  reads: string;
  answer: string;
  /** Market ids this node settled. Empty when the node only shaded conviction. */
  settles: string[];
};

export type DecisionMarket = {
  id: string;
  group: "Result" | "Goals" | "Both sides" | "Score";
  label: string;
  call: string;
  tier: DecisionTier;
  tierLabel: string;
  /** The node that settled this line. */
  node: string;
  reads: string;
  why: string;
  /** What the market board says, when it prices this line at all. Null when it does not. */
  agrees: boolean | null;
};

export type DecisionWithheld = {
  label: string;
  reason: string;
};

export type DecisionTree = {
  fixtureId: number;
  teams: [string, string];
  short: [string, string];
  scoreline: string;
  worth: { home: number; away: number };
  separation: number;
  total: number;
  nodes: DecisionNode[];
  markets: DecisionMarket[];
  withheld: DecisionWithheld[];
  /** The path, one line per node, in reading order. */
  trace: string[];
  /** Where the market board came from, when there was one to compare against. */
  referenceSource: string | null;
  note: string;
};

/**
 * Whether the season record backs the board's winner.
 *
 * Read as venue form — what the called winner takes from its own ground against
 * what the opponent takes on the road — because that is the only split in the
 * record that is the same match the board is pricing. The table edge is the
 * season-long version of the same question and is used when a venue figure is
 * missing.
 */
function recordReading(
  profile: SimFormProfile,
  winner: Side | "draw",
): { agrees: boolean | null; reads: string } {
  const home = profile.teams[0];
  const away = profile.teams[1];
  const homeVenue = home.record.homePointsPerGame;
  const awayVenue = away.record.awayPointsPerGame;

  if (winner === "draw") {
    return {
      agrees: null,
      reads: `${home.short} take ${homeVenue === null ? "no" : homeVenue.toFixed(2)} points a game at home; ${away.short} take ${
        awayVenue === null ? "no" : awayVenue.toFixed(2)
      } on the road.`,
    };
  }

  const venueGap =
    homeVenue !== null && awayVenue !== null ? (winner === "home" ? homeVenue - awayVenue : awayVenue - homeVenue) : null;
  const edgeGap =
    home.table && away.table ? (winner === "home" ? home.table.edge - away.table.edge : away.table.edge - home.table.edge) : null;
  const reading = venueGap ?? edgeGap;
  const line = `${home.short} take ${homeVenue === null ? "—" : homeVenue.toFixed(2)} points a game at home, ${away.short} take ${
    awayVenue === null ? "—" : awayVenue.toFixed(2)
  } on the road; table edge ${home.table ? home.table.edge.toFixed(2) : "—"} against ${
    away.table ? away.table.edge.toFixed(2) : "—"
  }.`;

  // A fifth of a point a game is the smallest difference worth reading; below it
  // the record is silent rather than agreeing or disagreeing.
  return { agrees: reading === null ? null : reading >= 0.2 ? true : reading <= -0.2 ? false : null, reads: line };
}

/**
 * Who is missing, and whether it lands on the side the board favours.
 *
 * Only used to shade the call: the eleven the board read is the eleven that
 * turns out, and an absent player is already priced through the lineup the
 * profile carries. This is a check on how settled that eleven is, not a rewrite.
 */
function availabilityReading(
  profile: SimFormProfile,
  winner: Side | "draw",
): { shift: number; reads: string } {
  const homeOut = profile.teams[0].unavailable?.length ?? 0;
  const awayOut = profile.teams[1].unavailable?.length ?? 0;
  const reads = `${profile.teams[0].short} list ${homeOut} unavailable, ${profile.teams[1].short} list ${awayOut}.`;
  if (winner === "draw") return { shift: 0, reads };
  const winnerOut = winner === "home" ? homeOut : awayOut;
  const opponentOut = winner === "home" ? awayOut : homeOut;
  const difference = opponentOut - winnerOut;
  // Two men is the smallest gap that says anything about a squad's week.
  return { shift: difference >= 2 ? 1 : difference <= -2 ? -1 : 0, reads };
}

/**
 * Whether the board's total is the sort of total these two sides play.
 *
 * A board total of 3.4 in a division where neither side has been in a three-goal
 * game is a reading worth holding more loosely. Measured across the two sides'
 * own scoring rates, so it cannot be one team's outlier month.
 */
function totalReading(
  profile: SimFormProfile,
  boardTotal: number,
): { shift: number; reads: string } {
  const [home, away] = profile.teams;
  const seasonTotal = home.record.goalsForPerGame + away.record.goalsForPerGame;
  const reads = `The two sides score ${home.record.goalsForPerGame.toFixed(2)} and ${away.record.goalsForPerGame.toFixed(
    2,
  )} a game, ${seasonTotal.toFixed(2)} between them, against a board total of ${boardTotal.toFixed(2)}.`;
  if (!Number.isFinite(seasonTotal) || seasonTotal <= 0) return { shift: 0, reads };
  const gap = Math.abs(seasonTotal - boardTotal);
  // Within a third of a goal the season agrees; more than a goal apart it does
  // not, and the line is held one step more loosely.
  return { shift: gap <= 0.35 ? 1 : gap >= 1 ? -1 : 0, reads };
}

/**
 * Whether the defence the board reads as keeping a sheet actually keeps them.
 *
 * This is the one place a combined reading can withhold a line instead of
 * shading it. A side picked to be held to nothing that has scored in every one
 * of its recent games is a call the season is arguing with, and the honest move
 * is to leave the sheet market off the card rather than call it and hope.
 */
function sheetReading(
  profile: SimFormProfile,
  side: Side,
): { shift: number; withhold: boolean; reads: string } {
  const defence = profile.teams[side === "home" ? 0 : 1];
  const attack = profile.teams[side === "home" ? 1 : 0];
  const keeperRate = rateOf(defence.record.cleanSheets ?? 0, defence.record.games);
  const scoringRate = rateOf(attack.record.failedToScore ?? 0, attack.record.games);
  const reads = `${defence.short} keep ${defence.record.cleanSheets ?? 0} sheets in ${defence.record.games} games; ${attack.short} fail to score in ${
    attack.record.failedToScore ?? 0
  } of them and average ${attack.record.goalsForPerGame.toFixed(2)} a game.`;
  if (keeperRate === null || scoringRate === null) return { shift: 0, withhold: false, reads };
  // Scores in nine games out of ten and averages over a goal: the sheet is a
  // reading the season does not support.
  const withhold = scoringRate <= 0.1 && attack.record.goalsForPerGame >= 1.2;
  const shift = withhold ? 0 : keeperRate >= 0.3 ? 1 : keeperRate === 0 ? -1 : 0;
  return { shift, withhold, reads };
}

/** What the market board says about a line, when it prices it at all. */
export function marketAgreement(
  profile: SimFormProfile,
  id: string,
  facts: BoardFacts & { calls: BoardCalls },
): boolean | null {
  const reference = profile.expectations;
  if (!reference) return null;
  const { calls } = facts;
  const over = (value: number | null | undefined) => (value === null || value === undefined ? null : value > 0.5);
  switch (id) {
    case "result": {
      const gap = reference.homeGoals - reference.awayGoals;
      if (!Number.isFinite(gap) || gap === 0) return calls.result === "Draw";
      return calls.result === (gap > 0 ? "Home win" : "Away win");
    }
    case "over-2.5": {
      const read = over(reference.over25);
      return read === null ? null : read === (calls.overTwoAndHalf === "Over 2.5");
    }
    case "btts": {
      const read = over(reference.bothTeamsScore);
      return read === null ? null : read === (calls.bothTeamsScore === "Yes");
    }
    case "clean-home": {
      const read = over(reference.homeCleanSheet);
      return read === null ? null : read === (calls.homeCleanSheet === "Yes");
    }
    case "clean-away": {
      const read = over(reference.awayCleanSheet);
      return read === null ? null : read === (calls.awayCleanSheet === "Yes");
    }
    default:
      return null;
  }
}

/**
 * Build the tree for one fixture.
 *
 * `profile` supplies the combined readings (record, table, availability, market
 * reference) and `verdict` supplies the board: the two worths, the scoreline and
 * the separation the other tabs already show. Nothing here re-runs the engine.
 */
export function buildDecisionTree(
  profile: SimFormProfile,
  verdict: InevitabilityVerdict,
): DecisionTree {
  const [home, away] = profile.teams;
  const homeWorth = round2(verdict.expectedGoals.home);
  const awayWorth = round2(verdict.expectedGoals.away);
  const facts: BoardFacts = {
    homeWorth,
    awayWorth,
    homeGoals: verdict.verdict.home,
    awayGoals: verdict.verdict.away,
  };
  const calls = settleFromBoard(facts);
  const baseTier = verdict.confidence.tier;
  const separation = round2(Math.abs(calls.gap));
  const winner = calls.winner;

  const record = recordReading(profile, winner);
  const availability = availabilityReading(profile, winner);
  const goals = totalReading(profile, calls.total);
  const sheetOfSide = calls.sheetSide ? sheetReading(profile, calls.sheetSide) : null;

  // The result family takes the board's own conviction, then moves one step for
  // the two readings that are about the same eleven: the venue record and who is
  // missing. They cannot move it more than one step apiece, and neither can turn
  // the call around.
  const resultShift = (record.agrees === true ? 1 : record.agrees === false ? -1 : 0) + availability.shift;
  const resultTier = shiftTier(baseTier, Math.max(-1, Math.min(1, resultShift)));

  // The goals family answers one question — is the board's total the sort of
  // total these two sides play — so it moves at most one step.
  const goalsTier = shiftTier(baseTier, goals.shift);

  // The scoring family is one reading checked three ways, and then the check is
  // spent twice in opposite directions: a sheet is backed by an opponent worth
  // less than the one-goal crossing and by a defence that keeps sheets, and is
  // argued with by an opponent that scores in nearly every game. Each check is
  // worth a point, and the sheet markets move on the total while both-teams-to-
  // score moves the other way — a fixture whose sheet is doubtful is one where
  // both scoring is likely.
  const sheetCheck = (() => {
    if (!sheetOfSide || !calls.sheetSide) return 0;
    const opponentWorth = calls.sheetSide === "home" ? awayWorth : homeWorth;
    const crossing = opponentWorth <= ONE_GOAL ? 1 : -1;
    const keeper = sheetOfSide.withhold ? -2 : sheetOfSide.shift > 0 ? 1 : sheetOfSide.shift < 0 ? -1 : 0;
    return crossing + keeper;
  })();
  const sheetTier = shiftTier(baseTier, sheetCheck >= 2 ? 1 : sheetCheck <= -1 ? -1 : 0);
  // With no sheet on the scoreline, both teams have scored and the total is the
  // only evidence left about how many goals the fixture holds.
  const bttsTier = calls.sheetSide
    ? shiftTier(baseTier, sheetCheck <= -1 ? 1 : sheetCheck >= 2 ? -1 : 0)
    : goalsTier;

  const gapLine = `${home.short} are worth ${homeWorth.toFixed(2)} goals here, ${away.short} ${awayWorth.toFixed(
    2,
  )} — ${separation.toFixed(2)} between them.`;

  // The scoring branch reads the scoreline first and the crossing second, so a
  // card can never say "1–0" and "no clean sheet" in the same breath.
  const sheetKeeper = calls.sheetSide === "home" ? home.short : calls.sheetSide === "away" ? away.short : null;
  const sheetOpponent = calls.sheetSide === "home" ? away.short : calls.sheetSide === "away" ? home.short : null;
  const sheetOpponentWorth = calls.sheetSide === "home" ? awayWorth : homeWorth;
  const scoringAnswer = sheetKeeper
    ? `${sheetKeeper} are given nothing on the scoreline, so ${sheetOpponent} keep the sheet. ${sheetOpponent} are worth ${sheetOpponentWorth.toFixed(
        2,
      )}, ${sheetOpponentWorth <= ONE_GOAL ? "below" : "above"} the ${ONE_GOAL.toFixed(
        3,
      )} crossing, which is the check on how firmly that sheet is held.`
    : "The scoreline gives both sides a goal, so both teams score and neither sheet is claimed.";

  const nodes: DecisionNode[] = [
    {
      id: "board",
      depth: 0,
      branch: "board",
      question: "Is there a board to read?",
      reads: gapLine,
      answer: `Yes: the fixture resolves to ${verdict.scoreline}. Every line below is settled from this one read, not from a second opinion.`,
      settles: ["correct-score"],
    },
    {
      id: "result",
      depth: 1,
      branch: "result",
      question: "How far apart are the two sides worth?",
      reads: `${gapLine} The engine reads the separation as ${verdict.confidence.tier}.`,
      answer:
        calls.result === "Draw"
          ? `Level within ${separation.toFixed(2)} goals, so the draw stands and no side is given a handicap.`
          : `${calls.result.toLowerCase() === "home win" ? home.short : away.short} are worth more, so the result, the double chance and the handicap all point that way.`,
      settles: ["result", "double-chance", "draw-no-bet", "handicap", "win-to-nil"],
    },
    {
      id: "record",
      depth: 2,
      branch: "record",
      question: "Does the season record back the side the board favours?",
      reads: record.reads,
      answer:
        record.agrees === null
          ? "The record is silent — no venue figure or table edge separates them — so the call stands at the board's own conviction."
          : record.agrees
            ? "It agrees: the same side takes more from its own ground, so the result holds one step firmer."
            : "It disagrees: the venue record points the other way, so the result is held one step more loosely. The call does not change.",
      settles: [],
    },
    {
      id: "availability",
      depth: 2,
      branch: "availability",
      question: "Who is missing?",
      reads: availability.reads,
      answer:
        availability.shift === 0
          ? "Neither list is heavy enough to change how settled the favoured eleven is."
          : availability.shift > 0
            ? "The favoured side is the settled one, so the result holds a step firmer."
            : "The favoured side is the one missing men, so the result is held a step more loosely.",
      settles: [],
    },
    {
      id: "goals",
      depth: 1,
      branch: "goals",
      question: "Where does the board's total sit against the goal lines?",
      reads: `Total ${calls.total.toFixed(2)} goals. The lines cross at ${TWO_GOALS.toFixed(
        3,
      )} (1.5), ${THREE_GOALS.toFixed(3)} (2.5) and ${FOUR_GOALS.toFixed(3)} (3.5).`,
      answer: `${calls.overOneAndHalf}, ${calls.overTwoAndHalf} and ${calls.overThreeAndHalf}.`,
      settles: ["over-1.5", "over-2.5", "over-3.5"],
    },
    {
      id: "season-total",
      depth: 2,
      branch: "goals",
      question: "Is that total the sort of total they play?",
      reads: goals.reads,
      answer:
        goals.shift > 0
          ? "It is: the season total and the board total are within a third of a goal, so the goal lines hold firmer."
          : goals.shift < 0
            ? "It is not: the two scoring rates are more than a goal away from the board total, so the goal lines are held more loosely."
            : "Partly: the season sits between the two, so the goal lines keep the board's own conviction.",
      settles: [],
    },
    {
      id: "scoring",
      depth: 1,
      branch: "scoring",
      question: "Does each side's own worth clear the one-goal crossing?",
      reads: `One goal is worth ${ONE_GOAL.toFixed(3)}; ${home.short} are ${homeWorth >= ONE_GOAL ? "above" : "below"} it at ${homeWorth.toFixed(
        2,
      )}, ${away.short} ${awayWorth >= ONE_GOAL ? "above" : "below"} it at ${awayWorth.toFixed(2)}. Two goals is worth ${TWO_GOALS.toFixed(
        3,
      )}; ${home.short} are ${homeWorth >= TWO_GOALS ? "above" : "below"} it.`,
      answer: scoringAnswer,
      settles: ["btts", "clean-home", "clean-away", "team-total-home", "team-total-away"],
    },
  ];

  if (sheetOfSide && calls.sheetSide) {
    nodes.push({
      id: "sheet-record",
      depth: 2,
      branch: "scoring",
      question: "Does the side read at nothing actually fail to score?",
      reads: sheetOfSide.reads,
      answer: sheetOfSide.withhold
        ? "It does not — the opponent scores in nearly every game — so the clean-sheet and win-to-nil lines are left off the card rather than called."
        : sheetOfSide.shift > 0
          ? "It does: the defence keeps sheets at a rate the season backs, so the sheet holds firmer."
          : sheetOfSide.shift < 0
            ? "It has kept none lately, so the sheet is held more loosely. The call does not change."
            : "The rate neither backs nor contradicts the board, so the sheet keeps the board's own conviction.",
      settles: [],
    });
  }

  const withheld: DecisionWithheld[] = [];
  const sheetWithheld = Boolean(
    sheetOfSide?.withhold && calls.sheetSide,
  );

  if (sheetWithheld) {
    const attack = profile.teams[calls.sheetSide === "home" ? 1 : 0];
    withheld.push({
      label: "Clean sheet",
      reason: `${attack.short} have failed to score in ${attack.record.failedToScore} of ${attack.record.games} games and average ${attack.record.goalsForPerGame.toFixed(
        2,
      )} a game, so the season argues with a sheet even though the board reads one.`,
    });
    withheld.push({
      label: "Win to nil",
      reason: "It needs the same sheet, and that sheet is the line being withheld.",
    });
  }

  const marketOf = (
    id: string,
    group: DecisionMarket["group"],
    label: string,
    call: string,
    tier: DecisionTier,
    node: string,
    reads: string,
    why: string,
  ): DecisionMarket => ({
    id,
    group,
    label,
    call,
    tier,
    tierLabel: TIER_LABEL[tier],
    node,
    reads,
    why,
    agrees: marketAgreement(profile, id, { ...facts, calls }),
  });

  const markets: DecisionMarket[] = [
    marketOf(
      "result",
      "Result",
      "Match result",
      calls.result,
      resultTier,
      "result",
      gapLine,
      calls.result === "Draw"
        ? "The two worths are inside the gap that breaks a level reading."
        : "The stronger side is worth more than a draw and the scoreline gives it the win.",
    ),
    marketOf(
      "double-chance",
      "Result",
      "Double chance",
      calls.doubleChance,
      resultTier,
      "result",
      `Called winner: ${calls.result}.`,
      "Covers the called result and the draw; it is the same reading with one outcome taken out.",
    ),
    marketOf(
      "draw-no-bet",
      "Result",
      "Draw no bet",
      calls.drawNoBet,
      resultTier,
      "result",
      `Called winner: ${calls.result}.`,
      calls.result === "Draw"
        ? "The tree reads a draw, so a draw-no-bet stake is one it would expect back."
        : "The same side as the result, with the draw taken out of the risk.",
    ),
    marketOf(
      "handicap",
      "Result",
      "Handicap (−1)",
      calls.handicap,
      shiftTier(resultTier, -1),
      "result",
      `${gapLine} The favourite is worth ${Math.max(homeWorth, awayWorth).toFixed(2)} goals.`,
      "A one-goal handicap needs the favourite to be worth two goals itself and a goal more than the opponent, or the reading covers nothing.",
    ),
    ...(sheetWithheld
      ? []
      : [
          marketOf(
            "win-to-nil",
            "Result",
            "Win to nil",
            calls.winToNil,
            sheetTier,
            "scoring",
            verdict.shutout.basis,
            calls.winToNil === "No"
              ? "The scoreline gives both sides a goal, so no side wins to nil."
              : "The winner keeps the sheet the board reads, so the win comes with it.",
          ),
        ]),
    marketOf(
      "over-1.5",
      "Goals",
      "Total goals 1.5",
      calls.overOneAndHalf,
      goalsTier,
      "goals",
      `Total ${calls.total.toFixed(2)} against a 1.678 crossing.`,
      "Two goals is the even line: below 1.678 goals the board's total sits under it.",
    ),
    marketOf(
      "over-2.5",
      "Goals",
      "Total goals 2.5",
      calls.overTwoAndHalf,
      goalsTier,
      "goals",
      `Total ${calls.total.toFixed(2)} against a 2.674 crossing.`,
      "Three goals is the even line: the total has to reach 2.674 for over to be the call.",
    ),
    marketOf(
      "over-3.5",
      "Goals",
      "Total goals 3.5",
      calls.overThreeAndHalf,
      goalsTier,
      "goals",
      `Total ${calls.total.toFixed(2)} against a 3.672 crossing.`,
      "Four goals is the even line: only a total at 3.672 or above makes over the call.",
    ),
    marketOf(
      "btts",
      "Both sides",
      "Both teams to score",
      calls.bothTeamsScore,
      bttsTier,
      "scoring",
      `Scoreline ${calls.correctScore}: ${home.short} are worth ${homeWorth.toFixed(2)}, ${away.short} ${awayWorth.toFixed(
        2,
      )}, against a ${ONE_GOAL.toFixed(3)} crossing.`,
      "Both scoring is read off the scoreline; the crossing only says how likely that reading is to survive a single afternoon.",
    ),
    ...(sheetWithheld
      ? []
      : [
          marketOf(
            "clean-home",
            "Both sides",
            `${home.short} clean sheet`,
            calls.homeCleanSheet,
            sheetTier,
            "scoring",
            `Scoreline gives ${away.short} ${facts.awayGoals}; they are worth ${awayWorth.toFixed(2)} against a ${ONE_GOAL.toFixed(
              3,
            )} crossing.`,
            "The sheet is read off the scoreline, and the crossing is the check on how firmly it is held.",
          ),
          marketOf(
            "clean-away",
            "Both sides",
            `${away.short} clean sheet`,
            calls.awayCleanSheet,
            sheetTier,
            "scoring",
            `Scoreline gives ${home.short} ${facts.homeGoals}; they are worth ${homeWorth.toFixed(2)} against a ${ONE_GOAL.toFixed(
              3,
            )} crossing.`,
            "The sheet is read off the scoreline, and the crossing is the check on how firmly it is held.",
          ),
        ]),
    marketOf(
      "team-total-home",
      "Both sides",
      `${home.short} team total 1.5`,
      calls.homeTeamTotal,
      goalsTier,
      "scoring",
      `${home.short} worth ${homeWorth.toFixed(2)} against a 1.678 crossing.`,
      "A side needs to be worth 1.678 goals for two goals to be its likelier reading.",
    ),
    marketOf(
      "team-total-away",
      "Both sides",
      `${away.short} team total 1.5`,
      calls.awayTeamTotal,
      goalsTier,
      "scoring",
      `${away.short} worth ${awayWorth.toFixed(2)} against a 1.678 crossing.`,
      "A side needs to be worth 1.678 goals for two goals to be its likelier reading.",
    ),
    marketOf(
      "correct-score",
      "Score",
      "Correct score",
      calls.correctScore,
      baseTier,
      "board",
      verdict.scoreline,
      "Each side is read at the whole-goal count its own worth puts the most weight on, capped at five.",
    ),
  ];

  // Lines the board cannot settle. Listed rather than quietly dropped: a reader
  // counting the card should see why these are not on it.
  withheld.push(
    {
      label: "Half-time result and half-time goals",
      reason: "The board resolves the match once; it has no half-time reading to settle these from.",
    },
    {
      label: "Total goals odd/even",
      reason: "The parity of a mode is not a reading: the total is a crossing, and crossings do not carry parity.",
    },
    {
      label: "First goalscorer",
      reason: "The goals are placed inside the walk, but not at a man the board can price to open the scoring.",
    },
    {
      label: "Corners and cards",
      reason: "The style records carry corner and card rates, but there is no model behind them here, so no line is called.",
    },
  );

  const trace = [
    `Board: ${home.short} ${homeWorth.toFixed(2)} – ${away.short} ${awayWorth.toFixed(2)} (${separation.toFixed(2)} apart, ${verdict.confidence.tier}).`,
    `Scoreline: ${verdict.scoreline}.`,
    ...nodes
      .filter((node) => node.settles.length > 0 || node.id === "record" || node.id === "availability" || node.id === "season-total" || node.id === "sheet-record")
      .map((node) => `${node.question} → ${node.answer}`),
    `Settled ${markets.length} lines; withheld ${withheld.length}.`,
  ];

  return {
    fixtureId: profile.fixtureId,
    teams: [home.name, away.name],
    short: [home.short, away.short],
    scoreline: verdict.scoreline,
    worth: { home: homeWorth, away: awayWorth },
    separation,
    total: calls.total,
    nodes,
    markets,
    withheld,
    trace,
    referenceSource: profile.expectations?.source ?? null,
    note:
      "The board settles every line; form, table, availability and the market board only move how firmly it is held. No line on this card is a price, and none of them is a percentage.",
  };
}
