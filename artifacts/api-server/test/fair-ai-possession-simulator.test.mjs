import assert from "node:assert/strict";
import test from "node:test";
import { runFairAiPossessionSimulation } from "../src/lib/fair-ai-possession-simulator.ts";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function team(teamKey, name, possessionPct) {
  return {
    teamKey,
    name,
    matchCount: 5,
    recentMatchCount: 5,
    avgGoalsFor: 1.8,
    avgGoalsAgainst: 1.1,
    avgPlayerRating: 6.8,
    formation: "4-3-3",
    teamStats: {
      expectedGoalsFor: 2.2,
      expectedGoalsAgainst: 1.1,
      possessionPct,
      shotsPerMatch: 14,
      shotsOnTargetPerMatch: 6,
      passesPerMatch: 350,
      shotsInsideBoxPerMatch: 8,
      boxTouchesPerMatch: 20,
      bigChancesPerMatch: 3,
      bigChancesMissedPerMatch: 1,
      passCompletionPct: 82,
      longBallCompletionPct: 66,
      finalThirdPassCompletionPct: 78,
      duelWinPct: 51,
      defensiveActionsPerMatch: 75,
      recoveriesPerMatch: 50,
      redCardsPerMatch: 0,
      yellowCardsPerMatch: 1,
      coachMatches: 0,
      coachWinPct: null,
      daysSinceLastMatch: 6,
    },
    players: [],
  };
}

test("each simulated match gets a shot budget and shot-to-goal counters reconcile", () => {
  const originalRandom = Math.random;
  Math.random = seededRandom(0xFA17A1);
  let result;
  try {
    result = runFairAiPossessionSimulation(
      team("home", "Celtic", 54),
      team("away", "Celta Vigo", 46),
      1_000,
    );
  } finally {
    Math.random = originalRandom;
  }

  const diagnostics = result.diagnostics;
  const terminalStates = diagnostics.terminalStates;

  assert.ok(diagnostics.shots > result.iterations, "shots should be generated across the match batch");
  assert.ok(diagnostics.goals > 0, "some shots should reach the score update");
  assert.ok(diagnostics.shotsOnTarget >= diagnostics.goals);
  assert.equal(diagnostics.shots, terminalStates.goals + terminalStates.shots);
  assert.equal(diagnostics.goals, terminalStates.goals);
  assert.equal(diagnostics.turnovers, terminalStates.turnovers);
  assert.equal(
    terminalStates.goals + terminalStates.shots + terminalStates.turnovers + terminalStates.retained,
    diagnostics.possessions,
  );
  assert.equal(
    result.outcomes.home + result.outcomes.draw + result.outcomes.away,
    result.iterations,
  );
  assert.equal(result.expectedHomeGoals, result.possessionModel.home.expectedGoalsPerMatch);
  assert.equal(result.expectedAwayGoals, result.possessionModel.away.expectedGoalsPerMatch);
  assert.ok(result.expectedHomeGoals >= 0);
  assert.ok(result.expectedAwayGoals >= 0);
  assert.ok(Math.abs(
    result.probabilities.home + result.probabilities.draw + result.probabilities.away - 1,
  ) < 1e-12);
});
