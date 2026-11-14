import assert from "node:assert/strict";
import test from "node:test";
import { marketAgreement, settleFromBoard, shiftTier } from "../src/lib/decision-tree.ts";

// The decision tree settles every market at a crossing point, so the crossings
// are the model. These tests pin them: a tenth of a goal either side of the line
// has to flip the call, and nothing else in the facts may move it.

function facts(homeWorth, awayWorth, homeGoals, awayGoals) {
  return { homeWorth, awayWorth, homeGoals, awayGoals };
}

test("the goal lines flip at the Poisson medians, not at round numbers", () => {
  // 1.5 sits at a 1.678 total: two goals is the even read, one is not.
  assert.equal(settleFromBoard(facts(0.95, 0.8, 1, 1)).overOneAndHalf, "Over 1.5");
  assert.equal(settleFromBoard(facts(0.8, 0.8, 1, 1)).overOneAndHalf, "Under 1.5");

  // 2.5 sits at 2.674: a 2.6 total is still an under, a 2.8 total an over.
  assert.equal(settleFromBoard(facts(1.3, 1.3, 1, 1)).overTwoAndHalf, "Under 2.5");
  assert.equal(settleFromBoard(facts(1.4, 1.4, 1, 1)).overTwoAndHalf, "Over 2.5");

  // 3.5 sits at 3.672.
  assert.equal(settleFromBoard(facts(1.8, 1.8, 2, 2)).overThreeAndHalf, "Under 3.5");
  assert.equal(settleFromBoard(facts(1.9, 1.9, 2, 2)).overThreeAndHalf, "Over 3.5");
});

test("both teams to score is read off the scoreline", () => {
  assert.equal(settleFromBoard(facts(1.4, 0.7, 1, 1)).bothTeamsScore, "Yes");
  assert.equal(settleFromBoard(facts(1.4, 1.2, 2, 0)).bothTeamsScore, "No");
});

test("a clean sheet belongs to the scoreline, not to the crossing beside it", () => {
  // 0.79 is a hair above the 0.693 crossing, so a threshold would refuse the
  // sheet; the scoreline still gives the opponent nothing, and the card follows
  // the scoreline so it can never contradict its own correct-score call.
  assert.equal(settleFromBoard(facts(1.9, 0.79, 2, 0)).homeCleanSheet, "Yes");
  assert.equal(settleFromBoard(facts(1.9, 0.6, 2, 1)).homeCleanSheet, "No");
  assert.equal(settleFromBoard(facts(0.6, 1.6, 0, 2)).awayCleanSheet, "Yes");
});

test("win to nil needs both the win and the sheet", () => {
  assert.equal(settleFromBoard(facts(1.9, 0.6, 2, 0)).winToNil, "Home to win to nil");
  assert.equal(settleFromBoard(facts(1.9, 1.2, 3, 1)).winToNil, "No");
});

test("the handicap needs a goal of separation and two goals of favourite", () => {
  // Covered: a goal and a half between them, the favourite worth two.
  assert.equal(settleFromBoard(facts(2.1, 0.6, 2, 0)).handicap, "Favourite −1");
  // Not covered: separation is there, the favourite is not worth two goals.
  assert.equal(settleFromBoard(facts(1.5, 0.55, 1, 0)).handicap, "Underdog +1");
  // A level board has nobody to give the goal to.
  assert.equal(settleFromBoard(facts(1.2, 1.2, 1, 1)).handicap.includes("No line"), true);
});

test("a level read settles the result as a draw and the double chance on the stronger worth", () => {
  const level = settleFromBoard(facts(1.3, 1.3, 1, 1));
  assert.equal(level.result, "Draw");
  assert.equal(level.drawNoBet.includes("draw"), true);
  const lean = settleFromBoard(facts(1.34, 1.06, 2, 1));
  assert.equal(lean.result, "Home win");
  assert.equal(lean.doubleChance, "Home or draw (1X)");
});

test("the same facts always settle the same card", () => {
  const first = settleFromBoard(facts(1.62, 1.21, 2, 1));
  const second = settleFromBoard(facts(1.62, 1.21, 2, 1));
  assert.deepEqual(first, second);
});

// The sheet markets are the one place the board and the card can be talking about
// different sides, so the pairing is pinned here: a home clean sheet is compared
// with the board's home clean sheet, and nothing else. Read from the wrong column
// every sheet line in the app reports the opposite agreement it should.
const boardWithSheets = (homeCleanSheet, awayCleanSheet) => ({
  expectations: {
    source: "odds",
    totalGoals: 2.4,
    homeGoals: 1.5,
    awayGoals: 0.9,
    over25: 0.45,
    bothTeamsScore: 0.5,
    homeCleanSheet,
    awayCleanSheet,
    homeCorners: 5,
    awayCorners: 4,
  },
});

test("a clean sheet is compared with the board's reading of the same side", () => {
  // 1–0: the home side keeps the sheet and the away side does not.
  const calls = settleFromBoard(facts(1.6, 0.8, 1, 0));
  assert.equal(calls.homeCleanSheet, "Yes");
  assert.equal(calls.awayCleanSheet, "No");

  // A board that agrees with both: home likely to keep one, away unlikely.
  const agreeing = boardWithSheets(0.62, 0.33);
  assert.equal(marketAgreement(agreeing, "clean-home", { calls }), true);
  assert.equal(marketAgreement(agreeing, "clean-away", { calls }), true);

  // The same board with the two columns swapped must now disagree on both; if the
  // pairing were crossed, this is the case that would still read as agreement.
  const crossed = boardWithSheets(0.33, 0.62);
  assert.equal(marketAgreement(crossed, "clean-home", { calls }), false);
  assert.equal(marketAgreement(crossed, "clean-away", { calls }), false);
});

test("a board with no sheet prices is not an agreement either way", () => {
  const calls = settleFromBoard(facts(1.6, 0.8, 1, 0));
  const unspoken = boardWithSheets(null, null);
  assert.equal(marketAgreement(unspoken, "clean-home", { calls }), null);
  assert.equal(marketAgreement(unspoken, "clean-away", { calls }), null);
});

test("a tier moves at most to either end of the ladder", () => {
  assert.equal(shiftTier("leaning", 1), "firm");
  assert.equal(shiftTier("leaning", -1), "knife-edge");
  assert.equal(shiftTier("firm", 4), "firm");
  assert.equal(shiftTier("knife-edge", -4), "knife-edge");
  assert.equal(shiftTier("firm", 0), "firm");
});
