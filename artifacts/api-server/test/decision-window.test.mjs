import assert from "node:assert/strict";
import test from "node:test";
import { dnaVoteOf, holdsAt } from "../src/lib/decision-tree.ts";
import { stressGoals } from "../src/lib/team-dna-math.ts";

// The fifty-match window is allowed into the decision only twice, and both are
// pinned here: it may move the settled worth when it is deep enough and disagrees
// enough to matter, and it may never do so on a thin window. The "even if" test is
// the same call asked again at a scoreline the window says is a normal bad day.

const side = (overrides = {}) => ({
  team: "FCF",
  matches: 20,
  reached: 20,
  scoredAtHome: 1.8,
  scoredAway: 1.2,
  concededAtHome: 0.8,
  concededAway: 1.4,
  p80: 2,
  ...overrides,
});

test("a deep window that disagrees moves the settled worth, keeping the separation", () => {
  const dna = {
    home: side({ scoredAtHome: 0.9, concededAtHome: 1.1 }),
    away: side({ scoredAway: 0.8, concededAway: 0.7 }),
  };
  // Board says 2.40 goals; the window pairs to (0.9 + 0.7)/2 + (0.8 + 1.1)/2 = 1.75.
  const vote = dnaVoteOf(dna, 1.40, 1.00);
  assert.equal(vote.active, true);
  assert.ok(vote.home < 1.4 && vote.away < 1.0);
  // Same proportion between the sides: 1.40 : 1.00 stays 1.40 : 1.00.
  assert.ok(Math.abs(vote.home / vote.away - 1.4) < 0.05);
  assert.match(vote.note, /price 1\.75 goals against the board's 2\.4/);
});

test("a window that agrees leaves the board alone", () => {
  const dna = {
    home: side({ scoredAtHome: 1.4, concededAtHome: 1.0 }),
    away: side({ scoredAway: 1.0, concededAway: 1.4 }),
  };
  const vote = dnaVoteOf(dna, 1.40, 1.00);
  assert.equal(vote.active, false);
  assert.equal(vote.home, 1.4);
  assert.equal(vote.away, 1.0);
  assert.match(vote.note, /within a rounding/i);
});

test("a thin window informs the card but cannot move it", () => {
  const dna = {
    home: side({ matches: 4, scoredAtHome: 0.2, concededAtHome: 2.5 }),
    away: side({ matches: 5, scoredAway: 0.1, concededAway: 0.2 }),
  };
  const vote = dnaVoteOf(dna, 1.40, 1.00);
  assert.equal(vote.active, false);
  assert.equal(vote.home, 1.4);
  assert.match(vote.note, /only 4 of the last fifty/i);
});

test("no window at all is said out loud, not filled in", () => {
  const vote = dnaVoteOf(null, 1.4, 1.0);
  assert.equal(vote.active, false);
  assert.match(vote.note, /board stands unopposed/i);
});

test("the even-if test judges the call at the stress scoreline", () => {
  // Three goals total: Under 2.5 turns over, Over 2.5 holds.
  assert.equal(holdsAt("over-2.5", "Under 2.5", "home", 2, 1), false);
  assert.equal(holdsAt("over-2.5", "Over 2.5", "home", 2, 1), true);
  // Both sides scoring at the stress case is what kills a clean sheet.
  assert.equal(holdsAt("clean-home", "Yes", "home", 2, 1), false);
  assert.equal(holdsAt("btts", "No", "home", 1, 0), true);
  // A favourite two goals better covers −1; one goal does not.
  assert.equal(holdsAt("handicap", "Favourite −1", "home", 3, 1), true);
  assert.equal(holdsAt("handicap", "Favourite −1", "home", 2, 1), false);
  // The result family is the scoreline itself.
  assert.equal(holdsAt("result", "Home win", "home", 1, 1), false);
  assert.equal(holdsAt("double-chance", "Home or draw (1X)", "home", 1, 1), true);
  assert.equal(holdsAt("team-total-home", "Over 1.5", "home", 2, 0), true);
  assert.equal(holdsAt("team-total-home", "Over 1.5", "home", 1, 3), false);
});

test("the stress case is the 80th percentile, not the average", () => {
  // Ten matches, one of them a four: the average is low but a good day is not.
  const goals = [0, 0, 1, 1, 1, 2, 2, 2, 3, 4];
  assert.equal(stressGoals(goals), 2);
  assert.equal(stressGoals([]), null);
  assert.equal(stressGoals([1]), 1);

  // A four from last season does not set the bad afternoon in November: with the
  // old match weighted to almost nothing, the stress case falls to the recent run.
  const weights = [0.05, 1, 1, 1];
  assert.equal(stressGoals([4, 0, 1, 1], weights), 1);
});
