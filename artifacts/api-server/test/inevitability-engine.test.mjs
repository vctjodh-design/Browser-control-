import assert from "node:assert/strict";
import test from "node:test";
import { buildInevitability, mostLikelyGoals } from "../src/lib/inevitability-engine.ts";
import { buildDuelBoard, preMatchLevel } from "../src/lib/squad-duel-sim.ts";

// A predicted XI in the shape the profile hands the engine: roles, the incoming
// form rating that sets each man's level, and the slot he stands in (nx up the
// pitch, nz across it).
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
      // A real XI is not eleven identical players: the level of each man has to
      // differ or every contest in a channel comes out the same number.
      averageRating: rating + [0.25, -0.2, 0.1, -0.1, 0.2][index % 5],
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

test("the same fixture resolves to the same verdict, word for word", () => {
  const first = buildInevitability(profile(7.2, 6.7));
  const second = buildInevitability(profile(7.2, 6.7));
  assert.deepEqual(first, second, "a resolved match must not move between calls");
  assert.deepEqual(first.trace, second.trace);
});

test("the scoreline is a real match, not an average", () => {
  const verdict = buildInevitability(profile(7.2, 6.7));
  const total = verdict.verdict.home + verdict.verdict.away;
  assert.ok(Number.isInteger(verdict.verdict.home), "a scoreline is whole goals");
  assert.ok(Number.isInteger(verdict.verdict.away), "a scoreline is whole goals");
  assert.equal(verdict.goals.length, total, "every goal is one possession in the trace");
  assert.equal(
    verdict.scoreline,
    `${verdict.short[0]} ${verdict.verdict.home}–${verdict.verdict.away} ${verdict.short[1]}`,
  );
  // The worth is a mean and the scoreline is one draw from it, so the count is
  // near it rather than equal to it: a side worth 1.26 can score none.
  for (const side of ["home", "away"]) {
    const scored = verdict.verdict[side];
    const worth = verdict.expectedGoals[side];
    assert.ok(Math.abs(scored - worth) <= 3, `${side} goals ${scored} against ${worth}`);
  }
  // One shared draw split by worth: the stronger side is never told it lost.
  assert.ok(
    verdict.verdict.home === verdict.verdict.away ||
      (verdict.verdict.home > verdict.verdict.away) ===
        (verdict.expectedGoals.home > verdict.expectedGoals.away),
    `${verdict.scoreline} against worth ${verdict.expectedGoals.home}/${verdict.expectedGoals.away}`,
  );
  // The goals are read in the order they were played.
  for (let index = 1; index < verdict.goals.length; index += 1) {
    assert.ok(verdict.goals[index].minute >= verdict.goals[index - 1].minute, "goals arrive in order");
  }
});

test("the lynchpin is one contest between two different men", () => {
  const verdict = buildInevitability(profile(7.2, 6.7));
  const link = verdict.lynchpin;
  assert.ok(link.attacker && link.defender);
  assert.notEqual(link.attacker, link.defender);
  assert.ok(link.share > 0 && link.share < 1, `share ${link.share}`);
  assert.ok(link.forcedAdaptation > 0, "the ranking number has to be positive");
  assert.ok(link.response.length > 40, "the verdict has to say what answering it costs");
  assert.ok(verdict.killCondition.includes(link.attacker), "the verdict names its own kill-condition");
});

test("the channel's cascade runs from possessions to goals", () => {
  const { cascade } = buildInevitability(profile(7.4, 6.6));
  assert.equal(cascade.length, 5);
  const [possessions, carries, entries, shots, goals] = cascade;
  assert.equal(possessions.unit, "possessions");
  assert.ok(possessions.value > 0);
  assert.ok(carries.value <= possessions.value, "a side cannot retain more carries than it starts");
  assert.ok(entries.value <= carries.value, "entries cannot exceed carries");
  assert.ok(shots.value <= entries.value + 0.2, "shots cannot exceed entries");
  assert.ok(goals.value <= shots.value + 0.05, "goals cannot exceed shots");
});

test("the trace reads as a script", () => {
  const { trace } = buildInevitability(profile(7.2, 6.7));
  assert.ok(trace[0].startsWith("Kick-off — "));
  assert.ok(trace[trace.length - 1].startsWith("Full time — "));
  assert.ok(trace.some((line) => line.startsWith("Lynchpin — ")));
  assert.ok(trace.some((line) => line.startsWith("Cover — ")));
  assert.ok(trace.some((line) => line.startsWith("Opens — ")));
});

test("the confidence is the gap between the two sides' own worth", () => {
  const verdict = buildInevitability(profile(7.6, 6.4));
  const { confidence } = verdict;
  assert.ok(["firm", "leaning", "knife-edge"].includes(confidence.tier), confidence.tier);
  assert.equal(
    confidence.separation,
    Math.round(Math.abs(verdict.expectedGoals.home - verdict.expectedGoals.away) * 100) / 100,
  );
  assert.ok(confidence.label.length > 3, "the confidence is labelled for a reader");
  assert.ok(confidence.text.includes(confidence.separation.toFixed(2)), "the text states the separation");
  assert.ok(verdict.trace.some((line) => line.startsWith("Call — ")), "the trace carries the call");
});

test("a wider pair of elevens is called with more confidence than a narrow one", () => {
  const wide = buildInevitability(profile(7.9, 6.1)).confidence;
  const close = buildInevitability(profile(7.0, 6.9)).confidence;
  assert.ok(
    wide.separation > close.separation,
    `${wide.separation} should exceed ${close.separation}`,
  );
  assert.notEqual(wide.tier, "knife-edge");
});

test("a played fixture is not rated on the match it is resolving", () => {
  // The feed hands a forecast two kinds of rating: what a man has been worth
  // over his recent matches, and what he was given in this one. The second is
  // the result arriving before the forecast. A fixture whose own match ratings
  // are rewritten must resolve to exactly the same verdict.
  const honest = buildInevitability(profile(7.2, 6.7));
  const leaked = profile(7.2, 6.7);
  for (const team of leaked.teams) {
    for (const player of team.lineup) {
      player.form = { ...player.form, rating: 9.9, level: 1.6 };
      player.formRating = 9.9;
    }
  }
  const next = buildInevitability(leaked);
  assert.equal(next.scoreline, honest.scoreline);
  assert.deepEqual(next.expectedGoals, honest.expectedGoals);
  assert.equal(next.confidence.tier, honest.confidence.tier);
});

test("two sides with different records do not resolve to the same board", () => {
  // The flat-board failure: when every man is rated the same, every contest is
  // the home edge and every fixture ends 1-1 or 2-1. A whole rating point
  // between the elevens has to show up as different contests.
  const board = buildDuelBoard(profile(7.6, 6.5), { level: preMatchLevel });
  const edges = [...board.lanes, ...board.midfield].map((row) => row.edge);
  assert.ok(edges.some((edge) => Math.abs(edge) > 0.5), `edges ${edges.join(",")}`);
  assert.ok(new Set(edges).size > 3, "contests must differ from one another");
});

test("the scoreline is the likeliest reading of the worth, not a draw from the id", () => {
  // This used to be the opposite test: two fixtures with identical elevens were
  // expected to end differently, because the total was drawn from a hash of the
  // fixture id so that every fixture did not end 1-1. Against 52 completed
  // matches that hash was the single biggest source of error — it hit the exact
  // score once, where the likeliest reading of the same estimates hit it seven
  // times — so the residue is retired and the guarantee is now determinism.
  const scorelines = new Set();
  for (let fixtureId = 1; fixtureId <= 16; fixtureId += 1) {
    const next = profile(7.2, 6.7);
    next.fixtureId = fixtureId;
    scorelines.add(buildInevitability(next).scoreline.replace(/[A-Z]{3}/g, ""));
  }
  assert.equal(scorelines.size, 1, "the same elevens resolve to the same match, whatever the id");

  // And the count itself is the mode of the side's own goal worth.
  const verdict = buildInevitability(profile(7.2, 6.7));
  assert.equal(verdict.verdict.home, mostLikelyGoals(verdict.expectedGoals.home));
  assert.equal(verdict.verdict.away, mostLikelyGoals(verdict.expectedGoals.away));
});

test("the likeliest reading is monotone in the worth and never passes the cap", () => {
  let previous = -1;
  for (let worth = 0; worth <= 6; worth += 0.05) {
    const goals = mostLikelyGoals(worth);
    assert.ok(goals >= previous, `${goals} goals at a worth of ${worth.toFixed(2)} fell below ${previous}`);
    assert.ok(goals <= 5, `${goals} goals at a worth of ${worth.toFixed(2)} passed the cap`);
    previous = goals;
  }
  assert.equal(mostLikelyGoals(0), 0, "a side worth nothing is read at nothing");
  assert.equal(mostLikelyGoals(6), 5, "a side worth six goals is still read at five");
});

test("a level reading is a draw only while the board leaves the sides level", () => {
  // Rounding two worths to whole goals hides the gap between them, so a level
  // reading is broken by the stronger side taking one more goal — but only when
  // the gap is a quarter of a goal or more. The rule is stated in the verdict, so
  // it is checked here against every rating pair rather than one fixture.
  let broken = 0;
  let held = 0;
  for (const homeRating of [8.2, 7.8, 7.5, 7.2, 6.9, 6.6]) {
    for (const awayRating of [8.2, 7.8, 7.5, 7.2, 6.9, 6.6]) {
      const verdict = buildInevitability(profile(homeRating, awayRating));
      const homeWorth = verdict.expectedGoals.home;
      const awayWorth = verdict.expectedGoals.away;
      const gap = homeWorth - awayWorth;
      const levelModes = mostLikelyGoals(homeWorth) === mostLikelyGoals(awayWorth);
      if (!levelModes) continue;
      if (Math.abs(gap) < 0.25) {
        held += 1;
        assert.equal(
          verdict.verdict.home,
          verdict.verdict.away,
          `${homeRating}v${awayRating} are ${gap.toFixed(2)} apart and should draw`,
        );
        continue;
      }
      broken += 1;
      const lead = verdict.verdict.home - verdict.verdict.away;
      assert.equal(Math.abs(lead), 1, `a broken tie is a one-goal margin, got ${lead}`);
      assert.equal(
        Math.sign(lead),
        Math.sign(gap),
        `the side worth more must lead: worth ${homeWorth} v ${awayWorth}`,
      );
      assert.equal(verdict.verdict.winner, gap > 0 ? "home" : "away");
    }
  }
  assert.ok(broken > 0, "no level reading was broken in this sample");
  assert.ok(held > 0, "no level reading was held in this sample");
});

test("a sheet is only called where the scoreline has a zero", () => {
  // The sheet chip and the scoreline can no longer disagree: a clean sheet is
  // claimed exactly when the other side is read at nothing.
  for (const [homeRating, awayRating] of [[7.9, 6.1], [7.0, 6.9], [6.4, 7.8], [7.2, 6.7]]) {
    const verdict = buildInevitability(profile(homeRating, awayRating));
    const { home, away } = verdict.verdict;
    const readOff = away === 0 && home > 0 ? "home" : home === 0 && away > 0 ? "away" : null;
    assert.equal(verdict.shutout.side, readOff, `${verdict.scoreline} but the sheet said ${verdict.shutout.side}`);
    assert.equal(verdict.shutout.clean, readOff !== null);
  }
});

test("goals are placed through the match, not all at the death", () => {
  const verdict = buildInevitability(profile(7.6, 6.6));
  assert.ok(verdict.goals.length > 0, "this fixture should score");
  const last = Math.max(...verdict.goals.map((goal) => goal.minute));
  assert.ok(last < 93, `the last goal landed on ${last}'`);
});

test("the stronger eleven is the stronger side of the verdict", () => {
  const verdict = buildInevitability(profile(7.7, 6.2));
  assert.ok(
    verdict.expectedGoals.home > verdict.expectedGoals.away,
    `expected ${verdict.expectedGoals.home} v ${verdict.expectedGoals.away}`,
  );
  assert.equal(verdict.verdict.winner, "home");
});
