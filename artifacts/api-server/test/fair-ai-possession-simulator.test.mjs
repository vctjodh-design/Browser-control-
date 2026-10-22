import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateStandingsPerformance,
  runFairAiPossessionSimulation,
} from "../src/lib/fair-ai-possession-simulator.ts";

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
  assert.equal(result.standingsContext.adjustmentsApplied, false);
  assert.equal(result.standingsContext.home.status, "missing");
});

test("standings strength uses fresh inputs and excludes stale, future, or invalid snapshots", () => {
  const asOf = Date.parse("2026-10-22T12:00:00.000Z");
  const strong = team("strong", "Strong", 54);
  Object.assign(strong.teamStats, {
    leagueId: 1,
    leagueSeason: 2026,
    leagueRank: 1,
    leaguePlayed: 9,
    leaguePoints: 25,
    goalDifference: 17,
    leagueForm: "WWDWW",
    leagueTeamCount: 12,
    leagueStandingObservedAt: new Date(asOf - 2 * 86_400_000).toISOString(),
  });
  const weak = team("weak", "Weak", 46);
  Object.assign(weak.teamStats, {
    leagueId: 1,
    leagueSeason: 2026,
    leagueRank: 12,
    leaguePlayed: 9,
    leaguePoints: 3,
    goalDifference: -14,
    leagueForm: "LLLDL",
    leagueTeamCount: 12,
    leagueStandingObservedAt: new Date(asOf - 2 * 86_400_000).toISOString(),
  });

  const strongSignal = evaluateStandingsPerformance(strong, asOf);
  const weakSignal = evaluateStandingsPerformance(weak, asOf);
  assert.equal(strongSignal.status, "applied");
  assert.ok(strongSignal.strengthScore > weakSignal.strengthScore);

  const stale = team("stale", "Stale", 50);
  Object.assign(stale.teamStats, {
    leaguePlayed: 9,
    leaguePoints: 18,
    leagueStandingObservedAt: new Date(asOf - 31 * 86_400_000).toISOString(),
  });
  assert.equal(evaluateStandingsPerformance(stale, asOf).status, "stale");
  assert.equal(evaluateStandingsPerformance(stale, asOf).strengthScore, null);

  const future = team("future", "Future", 50);
  Object.assign(future.teamStats, {
    leaguePlayed: 9,
    leaguePoints: 18,
    leagueStandingObservedAt: new Date(asOf + 60_000).toISOString(),
  });
  assert.equal(evaluateStandingsPerformance(future, asOf).status, "future");
  assert.equal(evaluateStandingsPerformance(future, asOf).strengthScore, null);

  const invalid = team("invalid", "Invalid", 50);
  Object.assign(invalid.teamStats, { leagueStandingObservedAt: "not-a-timestamp" });
  assert.equal(evaluateStandingsPerformance(invalid, asOf).status, "invalid");
});

test("simulation reports when both teams have valid standings adjustments", () => {
  const home = team("home-standing", "Celtic", 54);
  Object.assign(home.teamStats, {
    leagueId: 1,
    leagueSeason: 2026,
    leagueRank: 1,
    leaguePlayed: 9,
    leaguePoints: 25,
    goalDifference: 17,
    leagueForm: "WWDWW",
    leagueTeamCount: 12,
    leagueStandingObservedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  });
  const away = team("away-standing", "Celta Vigo", 46);
  Object.assign(away.teamStats, {
    leagueId: 2,
    leagueSeason: 2026,
    leagueRank: 8,
    leaguePlayed: 10,
    leaguePoints: 11,
    goalDifference: -2,
    leagueForm: "LDWLD",
    leagueTeamCount: 20,
    leagueStandingObservedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  });

  const baselineHome = team("home-neutral", "Celtic", 54);
  const baselineAway = team("away-neutral", "Celta Vigo", 46);
  const originalRandom = Math.random;
  let baseline;
  let result;
  try {
    Math.random = seededRandom(0x51A7D1);
    baseline = runFairAiPossessionSimulation(baselineHome, baselineAway, 1_000);
    Math.random = seededRandom(0x51A7D1);
    result = runFairAiPossessionSimulation(home, away, 1_000);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(result.standingsContext.adjustmentsApplied, true);
  assert.equal(result.standingsContext.home.status, "applied");
  assert.equal(result.standingsContext.away.status, "applied");
  assert.ok(
    result.standingsContext.home.strengthScore >
      result.standingsContext.away.strengthScore,
  );
  assert.notDeepEqual(result.outcomes, baseline.outcomes);
  assert.notEqual(result.expectedHomeGoals, baseline.expectedHomeGoals);
});
