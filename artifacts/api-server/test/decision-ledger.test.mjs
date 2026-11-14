import assert from "node:assert/strict";
import test from "node:test";
import { judgeCall } from "../src/lib/decision-ledger.ts";

// The ledger only means anything if a call is judged by what it said. These pin
// each market to its own scoreline: a clean sheet is a clean sheet, a handicap is
// the margin, and a line the book cannot read is left unmarked rather than counted
// as a win.

const call = (id, text) => ({ id, call: text });

test("the result family is judged on the final score", () => {
  assert.equal(judgeCall(call("result", "Home win"), 2, 1), true);
  assert.equal(judgeCall(call("result", "Home win"), 1, 1), false);
  assert.equal(judgeCall(call("result", "Draw"), 1, 1), true);
  assert.equal(judgeCall(call("result", "Away win"), 0, 3), true);
  assert.equal(judgeCall(call("double-chance", "Home or draw (1X)"), 1, 1), true);
  assert.equal(judgeCall(call("double-chance", "Home or draw (1X)"), 0, 1), false);
  assert.equal(judgeCall(call("double-chance", "Away or draw (X2)"), 2, 2), true);
  assert.equal(judgeCall(call("draw-no-bet", "Home"), 2, 0), true);
  assert.equal(judgeCall(call("draw-no-bet", "Home"), 1, 1), false);
});

test("the handicap is judged on the favourite's margin, not on the scoreline alone", () => {
  assert.equal(judgeCall(call("handicap", "Favourite −1"), 2, 0, "home"), true);
  assert.equal(judgeCall(call("handicap", "Favourite −1"), 1, 0, "home"), false);
  assert.equal(judgeCall(call("handicap", "Underdog +1"), 1, 0, "home"), true);
  assert.equal(judgeCall(call("handicap", "Underdog +1"), 3, 0, "home"), false);
  assert.equal(judgeCall(call("handicap", "Favourite −1"), 0, 2, "away"), true);
  // A level board gives no side the goal, so there is nothing to judge.
  assert.equal(judgeCall(call("handicap", "Favourite −1"), 2, 0, null), null);
});

test("win to nil needs both the win and the sheet", () => {
  assert.equal(judgeCall(call("win-to-nil", "Home to win to nil"), 1, 0), true);
  assert.equal(judgeCall(call("win-to-nil", "Home to win to nil"), 2, 1), false);
  assert.equal(judgeCall(call("win-to-nil", "No"), 2, 1), true);
  assert.equal(judgeCall(call("win-to-nil", "No"), 0, 1), false);
});

test("the goals lines settle on the total, every line at once", () => {
  assert.equal(judgeCall(call("over-1.5", "Over 1.5"), 1, 1), true);
  assert.equal(judgeCall(call("over-1.5", "Under 1.5"), 1, 0), true);
  assert.equal(judgeCall(call("over-2.5", "Under 2.5"), 1, 1), true);
  assert.equal(judgeCall(call("over-2.5", "Under 2.5"), 2, 1), false);
  assert.equal(judgeCall(call("over-3.5", "Over 3.5"), 2, 2), true);
  assert.equal(judgeCall(call("over-3.5", "Under 3.5"), 2, 1), true);
});

test("both teams to score and the sheets are judged on the scoreline", () => {
  assert.equal(judgeCall(call("btts", "Yes"), 1, 1), true);
  assert.equal(judgeCall(call("btts", "No"), 1, 0), true);
  assert.equal(judgeCall(call("clean-home", "Yes"), 2, 0), true);
  assert.equal(judgeCall(call("clean-home", "Yes"), 2, 1), false);
  assert.equal(judgeCall(call("clean-away", "No"), 3, 1), true);
  assert.equal(judgeCall(call("clean-away", "Yes"), 0, 1), true);
});

test("a team total is that team's goals, and an exact score is exact", () => {
  assert.equal(judgeCall(call("team-total-home", "Over 1.5"), 2, 0), true);
  assert.equal(judgeCall(call("team-total-home", "Over 1.5"), 1, 3), false);
  assert.equal(judgeCall(call("team-total-away", "Under 1.5"), 1, 1), true);
  assert.equal(judgeCall(call("team-total-away", "Under 1.5"), 1, 2), false);
  assert.equal(judgeCall(call("correct-score", "1–0"), 1, 0), true);
  assert.equal(judgeCall(call("correct-score", "1–0"), 1, 1), false);
});

test("a line the book cannot read is left unmarked", () => {
  assert.equal(judgeCall(call("handicap", "No line — no winner to give a goal to"), 1, 0, "home"), null);
  assert.equal(judgeCall(call("result", "Nobody"), 1, 0), null);
  assert.equal(judgeCall(call("correct-score", "no score"), 1, 0), null);
  assert.equal(judgeCall(call("unknown-market", "Home"), 1, 0), null);
});
