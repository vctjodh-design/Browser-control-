import assert from "node:assert/strict";
import test from "node:test";
import { nameSimilarity, weightsFromPerformances } from "../src/lib/player-form.ts";

function performance(overrides = {}) {
  return {
    playerId: 1,
    matchId: 100,
    teamId: 10,
    teamName: "Test FC",
    name: "Test Player",
    date: "2026-11-01T17:45:00.000Z",
    minutes: 90,
    rating: 7,
    stats: {},
    shots: [],
    heat: [],
    ...overrides,
  };
}

test("name matching joins a surname to a full name, and an accent to no accent", () => {
  assert.ok(nameSimilarity("Aurélien Tchouaméni", "Tchouaméni") >= 0.82);
  assert.ok(nameSimilarity("Kylian Mbappé", "Mbappe") >= 0.9);
  assert.ok(nameSimilarity("Archie Brown", "Brown") >= 0.82);
  assert.ok(nameSimilarity("Archie Brown", "Mason Greenwood") < 0.5);
});

test("a striker's goals and shots raise finishing, not the keeper's skills", () => {
  const weights = weightsFromPerformances([
    performance({ stats: { goals: 2, ShotsOnTarget: 4, expected_goals_on_target_variant: 1.6 } }),
    performance({ matchId: 101, stats: { goals: 1, ShotsOnTarget: 3, expected_goals_on_target_variant: 0.9 } }),
  ]);
  assert.ok(weights.skills.finishing > 0, "finishing should rise");
  assert.equal(weights.skills.reflexes, undefined, "an outfielder gets no keeper weights");
  assert.ok(weights.games >= 1);
});

test("a keeper's saves raise reflexes and never mark him down for tackles", () => {
  const weights = weightsFromPerformances([
    performance({ stats: { saves: 6, goals_conceded: 1, saves_inside_box: 4, goals_prevented: 1.4 } }),
    performance({ matchId: 102, stats: { saves: 5, goals_conceded: 2, saves_inside_box: 3, goals_prevented: 0.6 } }),
  ]);
  assert.ok(weights.skills.reflexes > 0, "reflexes should rise");
  assert.equal(weights.skills.marking, undefined, "a keeper gets no marking weight");
});

test("weights are added across matches, not averaged, and stay inside their cap", () => {
  const one = weightsFromPerformances([performance({ stats: { goals: 1 } })]);
  const two = weightsFromPerformances([
    performance({ stats: { goals: 1 } }),
    performance({ matchId: 103, stats: { goals: 1 } }),
  ]);
  assert.ok(two.skills.finishing > one.skills.finishing, "two scoring matches weigh more than one");

  const many = weightsFromPerformances(
    Array.from({ length: 20 }, (_, index) =>
      performance({
        matchId: 200 + index,
        date: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
        rating: 9.5,
        stats: { goals: 4, shots_inside_box: 9, expected_goals: 3.5, accurate_passes: 60, accurate_passes_total: 65 },
      }),
    ),
  );
  for (const [skill, value] of Object.entries(many.skills)) {
    assert.ok(Math.abs(value) <= 2.2, `${skill} must stay inside the cap, got ${value}`);
  }
});

test("a cameo is not a performance: under 20 minutes carries no weight", () => {
  const weights = weightsFromPerformances([performance({ minutes: 8, rating: 4 }), performance({ matchId: 105, minutes: 5, rating: 4 })]);
  assert.equal(weights.games, 0);
  assert.deepEqual(weights.skills, {});
});
