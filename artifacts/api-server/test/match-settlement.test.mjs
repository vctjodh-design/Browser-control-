// The odds simulation parses each selection once and then settles a hundred
// thousand matches against it. These tests pin the compiled settlement to the
// reading a watched match uses, so the two cannot drift apart.
import assert from "node:assert/strict";
import test from "node:test";
import { compileSettlement, settleSelection } from "../src/lib/match-settlement.ts";

function match(overrides) {
  const home = overrides.home ?? 2;
  const away = overrides.away ?? 1;
  const halfHome = overrides.halfHome ?? 1;
  const halfAway = overrides.halfAway ?? 0;
  return {
    home: { goals: home, corners: overrides.homeCorners ?? 6, cards: 1, shotsOnTarget: 5 },
    away: { goals: away, corners: overrides.awayCorners ?? 4, cards: 2, shotsOnTarget: 3 },
    goals: [],
    halfTime: { home: halfHome, away: halfAway },
    secondHalf: { home: home - halfHome, away: away - halfAway },
    firstGoal: overrides.firstGoal ?? (home + away > 0 ? "home" : "none"),
    players: overrides.players ?? [],
  };
}

test("compiled totals agree with the watched-match settlement", () => {
  const summary = match({ home: 2, away: 1 });
  for (const selection of ["Over 2.5", "Under 2.5", "Over 3", "Under 3", "Over 3.25", "Under 2.75"]) {
    const compiled = compileSettlement("Goals Over/Under", selection);
    assert.ok(compiled, selection);
    assert.deepEqual(
      { outcome: compiled.outcome(summary), detail: compiled.detail(summary) },
      settleSelection("Goals Over/Under", selection, summary),
      selection,
    );
  }
});

test("a quarter line settles as half stakes", () => {
  const compiled = compileSettlement("Goals Over/Under", "Under 3.25");
  assert.ok(compiled);
  // 3 goals: the 3.0 stake pushes, the 3.5 stake wins.
  assert.equal(compiled.outcome(match({ home: 2, away: 1 })), "half-win");
  // 4 goals: both stakes lose.
  assert.equal(compiled.outcome(match({ home: 3, away: 1 })), "lose");
});

test("period markets read the half they are priced on", () => {
  const summary = match({ home: 3, away: 1, halfHome: 0, halfAway: 0 });
  const firstHalf = compileSettlement("Goals Over/Under First Half", "Over 1.5");
  assert.ok(firstHalf);
  assert.equal(firstHalf.outcome(summary), "lose");
  const secondHalf = compileSettlement("Goals Over/Under - Second Half", "Over 1.5");
  assert.ok(secondHalf);
  assert.equal(secondHalf.outcome(summary), "win");
});

test("player markets settle from the team sheet", () => {
  const summary = match({
    players: [
      { name: "Harry Kane", side: "home", goals: 1, assists: 0, shotsOnTarget: 3 },
      { name: "Bukayo Saka", side: "home", goals: 0, assists: 1, shotsOnTarget: 0 },
    ],
  });
  const scorer = compileSettlement("Anytime Goal Scorer", "Harry Kane");
  assert.ok(scorer);
  assert.equal(scorer.outcome(summary), "win");
  assert.equal(scorer.outcome(match({ players: summary.players.map((p) => ({ ...p, goals: 0 })) })), "lose");

  const shots = compileSettlement("Home Player Shots On Target Total", "Harry Kane - 3");
  assert.ok(shots);
  assert.equal(shots.outcome(summary), "win");
  const involvement = compileSettlement("Player To Score Or Assist", "Bukayo Saka");
  assert.ok(involvement);
  assert.equal(involvement.outcome(summary), "win");
});

test("a selection the engine cannot grade stays untracked", () => {
  assert.equal(compileSettlement("Something New", "Over 1.5"), null);
  assert.equal(compileSettlement("Asian Handicap", "Home 0"), null);
  assert.equal(settleSelection("Something New", "Over 1.5", match({})), null);
});

test("compiling a selection once gives the same answer every match", () => {
  const compiled = compileSettlement("Corners Over Under", "Over 8.5");
  assert.ok(compiled);
  const outcomes = [match({}), match({ homeCorners: 7, awayCorners: 3 }), match({})].map((summary) =>
    compiled.outcome(summary),
  );
  assert.deepEqual(outcomes, ["win", "win", "win"]);
});
