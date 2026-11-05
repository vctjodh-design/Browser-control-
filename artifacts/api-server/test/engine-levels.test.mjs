// The engine's skill scale is steep: on its own, two levels between two
// elevens already turns a match into a rout, and six or seven makes it 6-0 or
// worse. These tests hold the mapping that feeds it to the market's view of
// the fixture, so a side that leads its own league is never fielded as if it
// were stronger than a mid-table club from a bigger one.
import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenFootballSpec, profileSignature } from "../src/lib/open-football-replay.ts";

function lineup(name, impact) {
  return Array.from({ length: 11 }, (_, index) => ({
    name: `${name} ${index + 1}`,
    role: index === 0 ? "GK" : "CM",
    number: index + 1,
    impact,
  }));
}

function team(name, edge, impact) {
  return {
    side: name,
    teamId: 1,
    name,
    short: name.slice(0, 3),
    record: { form: "WWWWW" },
    recent: [],
    style: {},
    formation: "4-4-2",
    formationSource: "listed",
    formationConfidence: 1,
    table: { edge },
    lineup: lineup(name, impact),
    bench: [],
    slots: [],
  };
}

function profile({ homeEdge, awayEdge, homeGoals, awayGoals, homeImpact = 0.7, awayImpact = 0.7 }) {
  return {
    fixtureId: 1,
    observedAt: new Date().toISOString(),
    formGames: 15,
    detailGames: 15,
    teams: [team("Home", homeEdge, homeImpact), team("Away", awayEdge, awayImpact)],
    expectations:
      homeGoals === null
        ? null
        : { source: "odds", totalGoals: homeGoals + awayGoals, homeGoals, awayGoals },
    issues: [],
  };
}

const levels = (spec) => [
  spec.home.players.map((player) => player.level),
  spec.away.players.map((player) => player.level),
];
const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;

test("the prices, not the league table, decide which eleven is stronger", () => {
  // Leading the Czech league does not make a side better than a mid-table
  // Serie A club, but the table said exactly that and the engine played
  // Ferencvaros off the park at Milan.
  const spec = buildOpenFootballSpec(
    profile({ homeEdge: -0.36, awayEdge: 1, homeGoals: 2.24, awayGoals: 0.75 }),
    13,
  );
  const [home, away] = levels(spec);
  assert.ok(mean(home) > mean(away), `expected the home side to be stronger, got ${mean(home)} v ${mean(away)}`);
});

test("a heavy mismatch stays a few levels, not a rout's worth", () => {
  const spec = buildOpenFootballSpec(
    profile({ homeEdge: -1, awayEdge: 0.95, homeGoals: 0.58, awayGoals: 2.18 }),
    13,
  );
  const [home, away] = levels(spec);
  const gap = Math.abs(mean(away) - mean(home));
  assert.ok(gap <= 3, `a 1.6-goal favourite arrived as a ${gap.toFixed(1)}-level gap`);
  assert.ok(mean(away) > mean(home), "the favourite must still be the better side");
});

test("a single star is worth about a level inside his own eleven", () => {
  const spec = buildOpenFootballSpec(
    profile({ homeEdge: 0, awayEdge: 0, homeGoals: 1.4, awayGoals: 1.4, homeImpact: 0.95, awayImpact: 0.4 }),
    13,
  );
  const [home, away] = levels(spec);
  assert.ok(Math.max(...home) - Math.min(...away) <= 3, "individual standing must not outweigh the team's");
  assert.ok(home[0] > away[0], "the star should be above the modest player");
});

test("without prices the table still gives a gentle gap inside the engine's own scale", () => {
  const spec = buildOpenFootballSpec(profile({ homeEdge: -1, awayEdge: 1, homeGoals: null, awayGoals: null }), 13);
  const [home, away] = levels(spec);
  for (const level of [...home, ...away]) {
    assert.ok(Number.isInteger(level) && level >= 1 && level <= 20, `level ${level} is off the engine's scale`);
  }
  assert.ok(mean(away) - mean(home) <= 3);
});

test("the recording signature changes when a level does, so a retuned match is replayed", () => {
  const market = profile({ homeEdge: -1, awayEdge: 1, homeGoals: 1.4, awayGoals: 1.4 });
  const table = profile({ homeEdge: -1, awayEdge: 1, homeGoals: null, awayGoals: null });
  assert.notEqual(profileSignature(market), profileSignature(table));
});
