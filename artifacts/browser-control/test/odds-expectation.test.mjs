import assert from "node:assert/strict";
import test from "node:test";
import { analyzeOddsExpectation } from "../src/lib/odds-expectation.ts";

function market(marketId, name, category, selections) {
  return {
    marketId,
    name,
    category,
    selections: selections.map(([selection, odd]) => ({
      selection,
      odd,
      bookmaker: "Book A",
      bookmakerCount: 1,
    })),
  };
}

function completeScores() {
  return market(
    "scores",
    "Exact Score",
    "goals",
    Array.from({ length: 121 }, (_, index) => [
      `${Math.floor(index / 11)}:${index % 11}`,
      index === 12 ? 6 : index === 11 ? 8 : 40,
    ]),
  );
}

test("combines result, BTTS, goal lines, and correct scores into one score distribution", () => {
  const markets = [
    market("result", "Standard 1X2", "1x2", [["1", 2.6], ["X", 3.1], ["2", 2.75]]),
    market("btts", "Both Teams Score", "goals", [["BTS", 1.83], ["OTS", 1.83]]),
    market("totals", "Goals Over/Under", "goals", [
      ["Over 1.5", 1.36], ["Under 1.5", 3.0],
      ["Over 3.5", 3.75], ["Under 3.5", 1.25],
    ]),
    market("total-2-5", "Goals Over/Under 2.5", "goals", [["Ovr", 2.15], ["Und", 1.67]]),
    market("result-btts", "Results/Both Teams Score", "goals", [
      ["Home/No", 11], ["Home/Yes", 10], ["Draw/No", 5],
      ["Draw/Yes", 6], ["Away/No", 12], ["Away/Yes", 11],
    ]),
    completeScores(),
  ];

  const report = analyzeOddsExpectation(markets, "Home FC", "Away FC");
  assert.ok(report);
  assert.equal(report.scoreMarketSeeded, true);
  assert.equal(report.marketSourceCount, 6);
  assert.ok(report.signalCount >= 6);
  assert.ok(Math.abs(report.result.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-8);
  assert.ok(Math.abs(report.btts.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-8);
  assert.deepEqual(report.totals.map((line) => line.line), [1.5, 2.5, 3.5]);
  assert.equal(report.topScores.length, 5);
  assert.ok(report.fitErrorPoints >= 0);
});

test("fits a score grid when no complete correct-score market is available", () => {
  const report = analyzeOddsExpectation([
    market("result", "Match Winner", "1x2", [["Home", 2.4], ["Draw", 3.2], ["Away", 3.1]]),
    market("btts", "Both Teams To Score", "goals", [["Yes", 1.9], ["No", 1.9]]),
    market("totals", "Goals Over/Under", "goals", [
      ["Over 2.5", 2.1], ["Under 2.5", 1.7],
      ["Over 3.5", 3.5], ["Under 3.5", 1.28],
    ]),
    market("home-goals", "Total - Home", "goals", [["Over 0.5", 1.4], ["Under 0.5", 3.0]]),
  ], "Home FC", "Away FC");

  assert.ok(report);
  assert.equal(report.scoreMarketSeeded, false);
  assert.ok(report.expectedHomeGoals > 0);
  assert.ok(report.expectedAwayGoals > 0);
  assert.ok(report.topScores.length > 0);
});

test("does not use half-time or unrelated markets as full-time score evidence", () => {
  const report = analyzeOddsExpectation([
    market("half-result", "First Half Winner", "first-half", [["Home", 2.4], ["Draw", 3.2], ["Away", 3.1]]),
    market("corners", "Corners Over Under", "other", [["Over 9.5", 1.9], ["Under 9.5", 1.9]]),
  ], "Home FC", "Away FC");

  assert.equal(report, null);
});
