import assert from "node:assert/strict";
import test from "node:test";
import { ageInDays, summarizeDna, weightOf } from "../src/lib/team-dna-math.ts";

// A team's DNA is arithmetic over its own matches, so these pin the arithmetic: the
// averages, the phase split, whether a lead was held, and — most importantly — where
// the goals and the chances disagree. A wrong sign there would make a wasteful side
// read as clinical.

// A null in the overrides means "the feed did not have this", so the defaults use a
// presence check rather than ??, which would quietly refill the hole.
const pick = (overrides, key, fallback) => (key in overrides ? overrides[key] : fallback);

const row = (overrides) => ({
  fixtureId: overrides.fixtureId ?? 1,
  date: overrides.date ?? "2026-10-01",
  competition: "League",
  venue: overrides.venue ?? "home",
  goalsFor: overrides.goalsFor ?? 1,
  goalsAgainst: overrides.goalsAgainst ?? 1,
  xgFor: pick(overrides, "xgFor", 1.2),
  xgAgainst: pick(overrides, "xgAgainst", 1.2),
  shotsFor: pick(overrides, "shotsFor", 10),
  shotsOnTargetFor: pick(overrides, "shotsOnTargetFor", 4),
  bigChancesFor: pick(overrides, "bigChancesFor", 2),
  bigChancesMissedFor: pick(overrides, "bigChancesMissedFor", 1),
  possessionFor: pick(overrides, "possessionFor", 50),
  passAccuracyFor: overrides.passAccuracyFor ?? 80,
  cornersFor: 4,
  foulsFor: 10,
  yellowFor: 2,
  redFor: 0,
  savesFor: 3,
  goalsPreventedFor: null,
  scoredPhases: overrides.scoredPhases ?? [1, 0, 0, 0, 0, 0],
  concededPhases: overrides.concededPhases ?? [0, 0, 1, 0, 0, 0],
  ledAtSomePoint: overrides.ledAtSomePoint ?? false,
  trailedAtSomePoint: overrides.trailedAtSomePoint ?? false,
  rating: overrides.rating ?? 6.8,
  startersKept: overrides.startersKept ?? 0.8,
});

test("averages are per match, and the record is the window's", () => {
  const dna = summarizeDna("FCF", "2026-11-05", [
    row({ fixtureId: 1, goalsFor: 2, goalsAgainst: 0, xgFor: 1.5, xgAgainst: 0.5 }),
    row({ fixtureId: 2, goalsFor: 0, goalsAgainst: 1, xgFor: 1.0, xgAgainst: 1.4, venue: "away" }),
    row({ fixtureId: 3, goalsFor: 3, goalsAgainst: 3, xgFor: 2.0, xgAgainst: 2.5 }),
  ]);
  assert.equal(dna.matches, 3);
  assert.deepEqual(dna.record, { wins: 1, draws: 1, losses: 1, goalsFor: 5, goalsAgainst: 4 });
  const goals = dna.identity.find((trait) => trait.label === "Goals scored");
  assert.equal(goals.value, 1.67);
  const conceded = dna.identity.find((trait) => trait.label === "Goals conceded");
  assert.equal(conceded.value, 1.33);
});

test("finishing is read against the chances, and the sign matters", () => {
  const wasteful = summarizeDna("FCF", "2026-11-05", [
    row({ goalsFor: 0, xgFor: 2.4, fixtureId: 1 }),
    row({ goalsFor: 0, xgFor: 2.0, fixtureId: 2 }),
  ]);
  const finishing = wasteful.identity.find((trait) => trait.label === "Goals vs xG");
  assert.ok(finishing.value < -1.5);
  assert.match(wasteful.verdict.scoring, /more than it scores/i);

  const clinical = summarizeDna("FCF", "2026-11-05", [
    row({ goalsFor: 3, xgFor: 1.2, fixtureId: 1 }),
    row({ goalsFor: 2, xgFor: 1.0, fixtureId: 2 }),
  ]);
  const clinicalFinishing = clinical.identity.find((trait) => trait.label === "Goals vs xG");
  assert.ok(clinicalFinishing.value > 1);
  assert.match(clinical.verdict.scoring, /fall back/i);
});

test("the phase split says when the goals arrive", () => {
  const dna = summarizeDna("FCF", "2026-11-05", [
    row({ scoredPhases: [0, 0, 0, 0, 0, 3], concededPhases: [1, 0, 0, 0, 0, 0], fixtureId: 1 }),
  ]);
  const late = dna.dynamics.find((trait) => trait.label === "Scored after 75′");
  assert.equal(late.value, 100);
  const firstHalf = dna.dynamics.find((trait) => trait.label === "Scored in 1st half");
  assert.equal(firstHalf.value, 0);
  const concededLate = dna.dynamics.find((trait) => trait.label === "Conceded after 75′");
  assert.equal(concededLate.value, 0);
  assert.match(dna.verdict.late, /takes them late/i);
});

test("a lead held and a deficit rescued are counted, not assumed", () => {
  const dna = summarizeDna("FCF", "2026-11-05", [
    row({ ledAtSomePoint: true, goalsFor: 2, goalsAgainst: 0, fixtureId: 1 }),
    row({ ledAtSomePoint: true, goalsFor: 1, goalsAgainst: 2, fixtureId: 2 }),
    row({ trailedAtSomePoint: true, goalsFor: 2, goalsAgainst: 2, fixtureId: 3 }),
    row({ trailedAtSomePoint: true, goalsFor: 0, goalsAgainst: 2, fixtureId: 4 }),
  ]);
  const held = dna.pressure.find((trait) => trait.label === "Held a lead");
  assert.equal(held.value, 50);
  assert.match(held.note, /leads held, weighted/);
  const rescued = dna.pressure.find((trait) => trait.label === "Unbeaten behind");
  assert.equal(rescued.value, 50);
});

test("home and away are kept apart in the scoring line", () => {
  const dna = summarizeDna("FCF", "2026-11-05", [
    row({ venue: "home", goalsFor: 3, goalsAgainst: 0, fixtureId: 1 }),
    row({ venue: "away", goalsFor: 0, goalsAgainst: 2, fixtureId: 2 }),
  ]);
  const split = dna.dynamics.find((trait) => trait.label === "Home / away scoring");
  assert.equal(split.value, 3);
  assert.match(split.note, /3 at home, 0 away/);
});

test("missing numbers are left out rather than counted as zero", () => {
  const dna = summarizeDna("FCF", "2026-11-05", [
    row({ xgFor: null, possessionFor: null, fixtureId: 1 }),
    row({ xgFor: null, possessionFor: null, fixtureId: 2 }),
  ]);
  assert.equal(dna.identity.find((trait) => trait.label === "xG created"), undefined);
  assert.equal(dna.identity.find((trait) => trait.label === "Possession"), undefined);
  assert.match(dna.verdict.scoring, /unmeasured/i);
});

test("an empty window says nothing rather than scoring zero", () => {
  const dna = summarizeDna("Nobody", "2026-11-05", []);
  assert.equal(dna.matches, 0);
  assert.equal(dna.from, null);
  assert.equal(dna.record.goalsFor, 0);
});

test("a match ages: half at ninety days, a tenth after ten months", () => {
  const asOf = "2026-11-05";
  assert.equal(ageInDays("2026-11-05", asOf), 0);
  assert.equal(ageInDays("2026-10-06", asOf), 30);
  assert.equal(weightOf("2026-11-05", asOf), 1);
  // Ninety days back is exactly half.
  assert.equal(weightOf("2026-08-07", asOf), 0.5);
  // Ten months back still counts, but only just.
  assert.ok(weightOf("2026-01-05", asOf) < 0.12 && weightOf("2026-01-05", asOf) >= 0.02);
});

test("recent matches outweigh old ones instead of every match counting the same", () => {
  const asOf = "2026-11-05";
  // Two old matches scoring nothing, one recent match scoring four times.
  const recentForm = summarizeDna("FCF", asOf, [
    row({ date: "2026-11-01", goalsFor: 4, goalsAgainst: 0, fixtureId: 1 }),
    row({ date: "2026-03-01", goalsFor: 0, goalsAgainst: 0, fixtureId: 2 }),
    row({ date: "2026-02-01", goalsFor: 0, goalsAgainst: 0, fixtureId: 3 }),
  ]);
  // Two recent matches scoring nothing, one old match scoring four times.
  const oldForm = summarizeDna("FCF", asOf, [
    row({ date: "2026-11-01", goalsFor: 0, goalsAgainst: 0, fixtureId: 1 }),
    row({ date: "2026-10-25", goalsFor: 0, goalsAgainst: 0, fixtureId: 2 }),
    row({ date: "2026-02-01", goalsFor: 4, goalsAgainst: 0, fixtureId: 3 }),
  ]);
  const recentGoals = recentForm.identity.find((trait) => trait.label === "Goals scored").value;
  const oldGoals = oldForm.identity.find((trait) => trait.label === "Goals scored").value;
  // Both windows have four goals in them; the current side is the one scoring now.
  assert.ok(recentGoals > oldGoals + 1);
  assert.ok(recentGoals > 1.5);
});
