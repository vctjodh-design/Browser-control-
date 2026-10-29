import assert from "node:assert/strict";
import test from "node:test";
import { buildForensicsMarketPicks } from "../src/lib/forensics-market-picks.ts";

function forensics(overrides = {}) {
  const home = {
    teamName: "North",
    matchesAnalyzed: 5,
    results: { wins: 3, draws: 1, losses: 1 },
    bttsMatches: 4,
    over25Matches: 4,
    averageGoalsFor: 1.8,
    averageGoalsAgainst: 1.2,
    ...overrides.home,
  };
  const away = {
    teamName: "South",
    matchesAnalyzed: 5,
    results: { wins: 1, draws: 1, losses: 3 },
    bttsMatches: 2,
    over25Matches: 2,
    averageGoalsFor: 1.2,
    averageGoalsAgainst: 1.8,
    ...overrides.away,
  };
  return {
    home,
    away,
    assessment: {
      resultLean: "home",
      scoringLean: "open_btts",
      ...overrides.assessment,
    },
  };
}

test("market picks use forensic samples and assessment without simulation inputs", () => {
  const picks = buildForensicsMarketPicks(forensics());

  assert.deepEqual(picks.map(({ title }) => title), [
    "1X2",
    "BTTS",
    "Goals · 2.5",
    "Correct score",
  ]);
  assert.equal(picks[0].pick, "North win");
  assert.equal(picks[1].pick, "Yes");
  assert.equal(picks[1].historicalFrequency, 0.6);
  assert.equal(picks[2].pick, "Over 2.5");
  assert.equal(picks[3].pick, "2–1");
  assert.equal(picks[0].confidence, "Moderate");
  assert.equal(picks[1].confidence, "Moderate");
  assert.equal(picks[3].confidence, "Low");
  assert.match(picks[0].confidenceReason, /6\/10 analyzed team matches/);
  assert.match(picks[3].confidenceReason, /rounded averages/);
  assert.match(picks[1].details, /historical frequency/);
});

test("the Forensics assessment breaks an even goal-market sample tie", () => {
  const picks = buildForensicsMarketPicks(forensics({
    home: { bttsMatches: 2, over25Matches: 2 },
    away: { bttsMatches: 3, over25Matches: 3 },
    assessment: { resultLean: "no_clear_edge", scoringLean: "tight" },
  }));

  assert.equal(picks[1].historicalFrequency, 0.5);
  assert.equal(picks[1].pick, "No");
  assert.equal(picks[1].confidence, "Low");
  assert.equal(picks[2].pick, "Under 2.5");
  assert.match(picks[2].details, /break the sample tie/);
});

test("insufficient forensic samples produce no unsupported market picks", () => {
  const picks = buildForensicsMarketPicks(forensics({
    home: {
      matchesAnalyzed: 0,
      results: { wins: 0, draws: 0, losses: 0 },
      bttsMatches: 0,
      over25Matches: 0,
      averageGoalsFor: null,
      averageGoalsAgainst: null,
    },
    away: {
      matchesAnalyzed: 0,
      results: { wins: 0, draws: 0, losses: 0 },
      bttsMatches: 0,
      over25Matches: 0,
      averageGoalsFor: null,
      averageGoalsAgainst: null,
    },
    assessment: { resultLean: "no_clear_edge", scoringLean: "unavailable" },
  }));

  assert.equal(picks[0].pick, "No clear pick");
  assert.equal(picks[1].pick, "No clear pick");
  assert.equal(picks[1].historicalFrequency, undefined);
  assert.equal(picks[2].pick, "No clear pick");
  assert.equal(picks[3].pick, "Unavailable");
  assert.equal(picks[1].confidence, "Not rated");
  assert.equal(picks[3].confidence, "Not rated");
});

test("high confidence requires near-complete coverage and strong sample agreement", () => {
  const picks = buildForensicsMarketPicks(forensics({
    home: { bttsMatches: 5, over25Matches: 5 },
    away: { bttsMatches: 4, over25Matches: 4 },
  }));

  assert.equal(picks[1].confidence, "High");
  assert.match(picks[1].confidenceReason, /9\/10 analyzed team matches/);
});
