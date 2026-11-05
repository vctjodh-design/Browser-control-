import assert from "node:assert/strict";
import test from "node:test";
import { buildDuelBoard, runDuelSimulation } from "../src/lib/squad-duel-sim.ts";

// A predicted XI in the shape the profile hands the simulation: roles, the
// incoming form rating that sets each man's level, and the slot he stands in
// (nx up the pitch, nz across it).
function side(name, rating) {
  const roles = ["GK", "LB", "CB", "CB", "RB", "CM", "CM", "LW", "ST", "RW", "ST"];
  const across = [0.5, 0.13, 0.38, 0.62, 0.87, 0.35, 0.65, 0.13, 0.5, 0.87, 0.5];
  const up = [0.04, 0.26, 0.19, 0.19, 0.26, 0.45, 0.45, 0.63, 0.73, 0.63, 0.73];
  return {
    side: name === "Home" ? "home" : "away",
    teamId: 1,
    name,
    short: name.slice(0, 3).toUpperCase(),
    record: {},
    recent: [],
    style: { possession: 50, longBallShare: 0.2, crosses: 20 },
    formation: "4-3-3",
    formationSource: "team-sheets",
    formationConfidence: 1,
    table: null,
    lineup: roles.map((role, index) => ({
      id: index + 1,
      name: `${name} ${role} ${index}`,
      number: index + 1,
      position: role,
      role,
      grid: null,
      starts: 10,
      appearances: 10,
      averageMinutes: 90,
      averageRating: rating,
      ratingTrend: 0,
      goals: 0,
      assists: 0,
      shots: 0,
      shotsOnTarget: 0,
      passAccuracy: null,
      keyPasses: 0,
      tackles: 0,
      interceptions: 0,
      duelsWon: 0,
      dribblesCompleted: 0,
      fouls: 0,
      yellowCards: 0,
      redCards: 0,
      saves: null,
      impact: 0.5,
      quality: 1,
      signals: {},
      matchRatings: [],
      form: { skills: {}, level: 0, games: 0, rating, trend: null, notes: [] },
      formRating: rating,
      formMinutes: 90,
      formGames: 5,
    })),
    bench: [],
    slots: roles.map((role, index) => ({ role, nx: up[index], nz: across[index] })),
    lineupSample: 3,
    squadQuality: 1,
    tactics: { press: 0.5, line: 0.5, width: 0.5, risk: 0.5, tempo: 0.5, direct: 0.5 },
  };
}

function profile(homeRating, awayRating) {
  return {
    fixtureId: 1,
    observedAt: new Date(0).toISOString(),
    formGames: 10,
    detailGames: 5,
    teams: [side("Home", homeRating), side("Away", awayRating)],
    expectations: null,
    issues: [],
  };
}

test("the duel board pairs named men in every channel", () => {
  const board = buildDuelBoard(profile(7.1, 6.5));
  assert.ok(board.lanes.length >= 8, "expected a pairing for most channels");
  for (const row of board.lanes) {
    assert.ok(row.attacker.name && row.defender.name);
    assert.notEqual(row.attacker.name, row.defender.name, "a man cannot duel himself");
    assert.ok(row.winPct > 0 && row.winPct < 100);
  }
  assert.ok(board.strength.home > board.strength.away, "the better-rated eleven should read stronger");
});

test("a seed replays the same match", () => {
  const first = runDuelSimulation(profile(7.1, 6.8), { trials: 2000, seed: 42 });
  const second = runDuelSimulation(profile(7.1, 6.8), { trials: 2000, seed: 42 });
  assert.deepEqual(first.outcome, second.outcome);
  assert.deepEqual(first.scorelines, second.scorelines);
});

test("every match ends in a home win, a draw or an away win", () => {
  const run = runDuelSimulation(profile(6.9, 6.9), { trials: 3000, seed: 7 });
  const total = run.outcome.home + run.outcome.draw + run.outcome.away;
  assert.ok(Math.abs(total - 100) < 0.4, `shares should add to 100, got ${total}`);
  assert.equal(
    run.scorelines.reduce((sum, line) => sum + line.count, 0) > 0,
    true,
    "scorelines should be counted",
  );
  // A match played from these elevens has to produce football scores, not a
  // single scoreline every time.
  assert.ok(run.scorelines.length >= 6, "expected a spread of scorelines");
});

test("the stronger eleven wins more of the trials", () => {
  const run = runDuelSimulation(profile(7.6, 6.2), { trials: 3000, seed: 3 });
  assert.ok(run.outcome.home > run.outcome.away, "the better side should win more often");
  assert.ok(run.outcome.homeGoals > run.outcome.awayGoals, "and score more goals");
});

test("the played matches land on the goals the market set", () => {
  const anchored = profile(6.9, 6.9);
  anchored.expectations = {
    source: "odds",
    totalGoals: 3.4,
    homeGoals: 2.4,
    awayGoals: 1.0,
    over25: 0.6,
    bothTeamsScore: 0.55,
    homeCleanSheet: 0.2,
    awayCleanSheet: 0.3,
    homeCorners: 5,
    awayCorners: 4,
  };
  const run = runDuelSimulation(anchored, { trials: 2500, seed: 11 });
  assert.ok(Math.abs(run.outcome.homeGoals - 2.4) < 0.35, `home goals ${run.outcome.homeGoals}`);
  assert.ok(Math.abs(run.outcome.awayGoals - 1.0) < 0.3, `away goals ${run.outcome.awayGoals}`);
  assert.ok(run.anchored && run.anchored.driftPct < 12, `drift ${run.anchored?.driftPct}`);
  assert.ok(run.outcome.home > run.outcome.away, "a 2.4 v 1.0 fixture should favour the home side");
  // The anchor is a property of the fixture, not of the seed the page used.
  const other = runDuelSimulation(anchored, { trials: 2500, seed: 99 });
  assert.deepEqual(other.anchored?.chanceScale, run.anchored?.chanceScale);
});

test("each side can be played a level above or below its own form", () => {
  const run = runDuelSimulation(profile(6.9, 6.9), { trials: 1500, seed: 5 });
  assert.equal(run.scenarios.length, 5);
  const expected = run.scenarios.find((row) => row.direction === "expected");
  assert.equal(expected?.outcome.home, run.outcome.home);
  assert.equal(run.scenarios[0].id, "expected");
  for (const side of ["home", "away"]) {
    const under = run.scenarios.find((row) => row.side === side && row.direction === "under");
    const over = run.scenarios.find((row) => row.side === side && row.direction === "over");
    assert.ok(under && over);
    assert.ok(under.shift < 0 && over.shift > 0, "a good night should be a positive shift");
    // Below par has to hurt that side and help the other one.
    const swing = (row) => (side === "home" ? row.swing.home : row.swing.away);
    assert.ok(swing(over) > swing(under), `${side}: over ${swing(over)} should beat under ${swing(under)}`);
    assert.ok(under.pivot && over.pivot, "a changed band should name the contest that moves");
  }
});
