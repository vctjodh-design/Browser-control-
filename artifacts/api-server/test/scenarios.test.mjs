import test from "node:test";
import assert from "node:assert/strict";
import { buildScenarios, readSide } from "../src/lib/scenario-math.ts";

function match({
  goalsFor = 1,
  goalsAgainst = 1,
  xgFor = 1.4,
  xgAgainst = 1.3,
  led = false,
  trailed = false,
  concededPhases = [0, 0, 0, 0, 0, 0],
  scoredPhases = [0, 0, 0, 0, 0, 0],
  opponentXgFor = 1.3,
  opponentXgAgainst = 1.3,
  opponentBigChances = 2,
} = {}) {
  return {
    date: "2026-10-01",
    venue: "home",
    goalsFor,
    goalsAgainst,
    xgFor,
    xgAgainst,
    shotsFor: 12,
    shotsOnTargetFor: 4,
    bigChancesFor: 2,
    savesFor: 3,
    scoredPhases,
    concededPhases,
    ledAtSomePoint: led,
    trailedAtSomePoint: trailed,
    opponentXgFor,
    opponentXgAgainst,
    opponentBigChances,
  };
}

const short = (team) => team.slice(0, 3).toUpperCase();

test("what if the other side scores first: the comeback and the lead are both counted", () => {
  // Strong side: conceded first four times and came back to win three.
  const strong = [
    match({ goalsFor: 2, goalsAgainst: 1, trailed: true }),
    match({ goalsFor: 3, goalsAgainst: 1, trailed: true }),
    match({ goalsFor: 2, goalsAgainst: 1, trailed: true }),
    match({ goalsFor: 0, goalsAgainst: 1, trailed: true }),
    ...Array.from({ length: 8 }, () => match({ goalsFor: 2, goalsAgainst: 0 })),
  ];
  // Weak side: led six times and dropped four of them.
  const weak = [
    ...Array.from({ length: 4 }, () => match({ goalsFor: 1, goalsAgainst: 2, led: true })),
    ...Array.from({ length: 2 }, () => match({ goalsFor: 2, goalsAgainst: 0, led: true })),
    ...Array.from({ length: 6 }, () => match({ goalsFor: 0, goalsAgainst: 2 })),
  ];

  const read = buildScenarios({
    home: { team: "Finland", short: short("Finland"), matches: strong },
    away: { team: "San Marino", short: short("San Marino"), matches: weak },
    call: { winner: "home", line: "FIN 2–1 SAN" },
  });

  const scoreFirst = read.whatIf.find((scenario) => scenario.id === "score-first");
  assert.match(scoreFirst.question, /What if SAN scores first/);
  assert.match(scoreFirst.evidence[0], /conceded first in 4 matches: 3 won/);
  assert.match(scoreFirst.answer, /comeback route is real/);
});

test("a two-goal lead at the break is read from the first-half timeline, not guessed", () => {
  const behind = Array.from({ length: 9 }, () =>
    match({ goalsFor: 1, goalsAgainst: 3, concededPhases: [1, 1, 0, 0, 0, 1] }),
  );
  const ahead = Array.from({ length: 9 }, () => match({ goalsFor: 2, goalsAgainst: 0, concededPhases: [0, 0, 0, 0, 0, 0] }));
  const read = buildScenarios({
    home: { team: "Finland", short: "FIN", matches: behind },
    away: { team: "San Marino", short: "SAN", matches: ahead },
    call: { winner: "home", line: "FIN 2–0 SAN" },
  });
  const twoDown = read.whatIf.find((scenario) => scenario.id === "two-down");
  assert.match(twoDown.evidence[0], /two goals down at half-time in 9 of 9/);
  // The side that goes behind came back in none of those nine, and the answer must
  // count the state, not the side's overall comeback record.
  assert.match(twoDown.answer, /taken something from 0 of them/);
  assert.equal(twoDown.depth, "read");
});

test("defence is adjusted for the opponent it actually faced", () => {
  // Concedes 1.5 xG against opponents who normally create 3.0: it is holding up.
  const stingy = Array.from({ length: 10 }, () => match({ xgAgainst: 1.5, opponentXgFor: 3.0, goalsAgainst: 1 }));
  // Concedes 1.5 xG against opponents who normally create 0.75: it is leaking.
  const leaky = Array.from({ length: 10 }, () => match({ xgAgainst: 1.5, opponentXgFor: 0.75, goalsAgainst: 1 }));
  const stingyRead = readSide("Stingy", stingy);
  const leakyRead = readSide("Leaky", leaky);
  assert.equal(stingyRead.adjustedXga, 0.5);
  assert.equal(leakyRead.adjustedXga, 2);
});

test("late concessions are a share of everything conceded, not a raw count", () => {
  const fades = Array.from({ length: 10 }, () =>
    match({ concededPhases: [0, 0, 0, 0, 0, 2] }),
  );
  const read = readSide("Fades", fades);
  assert.equal(read.lateConcededShare, 1);
});

test("the block question says what event data cannot see instead of pretending", () => {
  const side = Array.from({ length: 10 }, () => match({}));
  const read = buildScenarios({
    home: { team: "Finland", short: "FIN", matches: side },
    away: { team: "San Marino", short: "SAN", matches: side },
    call: { winner: "home", line: "FIN 1–0 SAN" },
  });
  const block = read.whatIf.find((scenario) => scenario.id === "deep-block");
  assert.match(block.answer, /cannot see is the shape of a block/);
  assert.match(block.answer, /tracking data/);
});

test("a thin window refuses to answer rather than inventing one", () => {
  const thin = Array.from({ length: 4 }, () => match({}));
  const read = buildScenarios({
    home: { team: "Finland", short: "FIN", matches: thin },
    away: { team: "San Marino", short: "SAN", matches: thin },
    call: { winner: "home", line: "FIN 1–0 SAN" },
  });
  assert.equal(read.whatIf[0].depth, "thin");
  assert.match(read.whatIf[0].answer, /too few to answer this/);
  assert.match(read.evenIf.statement, /cannot be judged yet/);
});

test("every resistance line carries the sample it came from", () => {
  const side = [
    ...Array.from({ length: 6 }, () => match({ led: true, goalsFor: 2, goalsAgainst: 0, xgAgainst: 0.9 })),
    ...Array.from({ length: 3 }, () => match({ led: true, goalsFor: 1, goalsAgainst: 1, xgAgainst: 1.2 })),
  ];
  const read = buildScenarios({
    home: { team: "Finland", short: "FIN", matches: side },
    away: { team: "San Marino", short: "SAN", matches: side },
    call: { winner: "home", line: "FIN 2–0 SAN" },
  });
  const held = read.evenIf.resistance.find((line) => line.label === "Leads held");
  assert.equal(held.value, 0.67);
  const leading = read.evenIf.resistance.find((line) => line.label === "xG conceded while leading");
  assert.equal(leading.value, 1);
  assert.match(leading.reading, /9 matches led/);
});

test("the structure names a mechanism, and only when one is measured", () => {
  const breaksLate = Array.from({ length: 10 }, () =>
    match({ goalsFor: 1, goalsAgainst: 1, concededPhases: [0, 0, 0, 0, 0, 2] }),
  );
  const read = buildScenarios({
    home: { team: "Finland", short: "FIN", matches: breaksLate },
    away: { team: "San Marino", short: "SAN", matches: breaksLate },
    call: { winner: "home", line: "FIN 1–1 SAN" },
  });
  assert.equal(read.structure.mechanism, "the last fifteen minutes");

  const solid = Array.from({ length: 10 }, () => match({ xgAgainst: 0.6, opponentXgFor: 1.3, opponentBigChances: 0.6 }));
  const clean = buildScenarios({
    home: { team: "Finland", short: "FIN", matches: solid },
    away: { team: "San Marino", short: "SAN", matches: solid },
    call: { winner: "home", line: "FIN 1–0 SAN" },
  });
  assert.equal(clean.structure, null);
});
