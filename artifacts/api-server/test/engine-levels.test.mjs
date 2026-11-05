// The engine's skill scale is steep: two levels between two elevens already
// turns a match into a rout. These tests hold the mapping that feeds it to
// what has been *measured* about each player — his ratings, his standing in his
// own squad, his run of form — and not to prices or a league table, so the
// match's result is something the players do rather than something the app
// decided in advance.
import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenFootballSpec, profileSignature } from "../src/lib/open-football-replay.ts";

function lineup(name, { rating = null, impact = 0.7, level = 0 } = {}) {
  return Array.from({ length: 11 }, (_, index) => ({
    name: `${name} ${index + 1}`,
    role: index === 0 ? "GK" : "CM",
    number: index + 1,
    impact,
    form: rating === null && level === 0 ? undefined : { skills: {}, level, rating },
  }));
}

function team(name, options) {
  return {
    side: name.toLowerCase(),
    teamId: name.length,
    name,
    short: name.slice(0, 3),
    record: { form: "WWWWW" },
    recent: [],
    style: {},
    formation: "4-4-2",
    formationSource: "listed",
    formationConfidence: 1,
    table: { edge: 0 },
    lineup: lineup(name, options),
    bench: [],
    slots: [],
  };
}

function profile(home, away) {
  return {
    fixtureId: 1,
    observedAt: new Date().toISOString(),
    formGames: 15,
    detailGames: 15,
    teams: [team("Home", home), team("Away", away)],
    // Present and deliberately ignored: the prices must not decide the match.
    expectations: { source: "odds", totalGoals: 2.7, homeGoals: 0.5, awayGoals: 2.2 },
    issues: [],
  };
}

const levels = (spec) => [spec.home.players.map((p) => p.level), spec.away.players.map((p) => p.level)];
const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;

test("both sides start level when nothing has been measured about either", () => {
  const [home, away] = levels(buildOpenFootballSpec(profile({}, {}), 13));
  assert.deepEqual(new Set([...home, ...away]), new Set([12]));
});

test("the prices do not move a single level", () => {
  const priced = profile({ rating: 7.3 }, { rating: 6.6 });
  const unpriced = { ...priced, expectations: { source: "odds", totalGoals: 2.2, homeGoals: 2.6, awayGoals: 0.4 } };
  assert.deepEqual(levels(buildOpenFootballSpec(priced, 13)), levels(buildOpenFootballSpec(unpriced, 13)));
});

test("a side whose players have been rated better is the better side", () => {
  const [home, away] = levels(buildOpenFootballSpec(profile({ rating: 7.35 }, { rating: 6.55 }), 13));
  assert.ok(mean(home) > mean(away), `expected the better-rated side to be stronger, got ${mean(home)} v ${mean(away)}`);
});

test("a rating gap is compressed, so the engine is never handed a rout", () => {
  const [home, away] = levels(
    buildOpenFootballSpec(profile({ rating: 8.4, impact: 0.98, level: 1.6 }, { rating: 5.6, impact: 0.05, level: -1.6 }), 13),
  );
  const gap = Math.abs(mean(home) - mean(away));
  assert.ok(gap <= 4, `a huge rating gap arrived as a ${gap.toFixed(1)}-level gap`);
});

test("every level stays inside the engine's own scale, whatever the data says", () => {
  const [home, away] = levels(
    buildOpenFootballSpec(profile({ rating: 9.9, impact: 4, level: 9 }, { rating: 1.1, impact: -3, level: -9 }), 13),
  );
  for (const level of [...home, ...away]) {
    assert.ok(Number.isInteger(level) && level >= 5 && level <= 19, `level ${level} is off the engine's scale`);
  }
});

test("the recording signature changes when a level does, so a retuned match is replayed", () => {
  assert.notEqual(
    profileSignature(profile({ rating: 7.3 }, { rating: 6.6 })),
    profileSignature(profile({ rating: 6.6 }, { rating: 6.6 })),
  );
});
