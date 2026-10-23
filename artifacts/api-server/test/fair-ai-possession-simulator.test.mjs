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
      matchStatSampleCount: 5,
    },
    players: [],
  };
}

function sparseTeam(teamKey, name, avgGoalsFor, avgGoalsAgainst) {
  const value = team(teamKey, name, 50);
  value.avgGoalsFor = avgGoalsFor;
  value.avgGoalsAgainst = avgGoalsAgainst;
  value.recentMatchCount = 6;
  value.teamStats = {
    expectedGoalsFor: null,
    expectedGoalsAgainst: null,
    possessionPct: 50,
    shotsPerMatch: null,
    shotsOnTargetPerMatch: null,
    shotsInsideBoxPerMatch: null,
    bigChancesPerMatch: null,
    bigChancesMissedPerMatch: null,
    passCompletionPct: null,
    longBallCompletionPct: null,
    finalThirdPassCompletionPct: null,
    defensiveActionsPerMatch: null,
    redCardsPerMatch: null,
    yellowCardsPerMatch: null,
    matchStatSampleCount: 0,
    coachMatches: 0,
  };
  value.players = [];
  return value;
}

function goalkeeper(savesPer90) {
  return {
    playerKey: `keeper-${savesPer90}`,
    name: "Test Keeper",
    position: "Goalkeeper",
    starter: true,
    appearances: 10,
    ratedAppearances: 10,
    shotsPer90: 0,
    expectedGoalsPer90: 0,
    goalsPer90: 0,
    savesPer90,
    passCompletionPct: 70,
    shotAccuracyPct: null,
    averageRating: 6.5,
    keyPassesPer90: 0,
    duelsWonPct: 50,
    tacklesPer90: 0,
    interceptionsPer90: 0,
  };
}

function simulateWithSeed(home, away, seed, iterations = 1_000) {
  const originalRandom = Math.random;
  try {
    Math.random = seededRandom(seed);
    return runFairAiPossessionSimulation(home, away, iterations);
  } finally {
    Math.random = originalRandom;
  }
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
  const possessionResolutions = diagnostics.possessionResolutions;

  assert.ok(diagnostics.shots > result.iterations, "shots should be generated across the match batch");
  assert.ok(diagnostics.goals > 0, "some shots should reach the score update");
  assert.ok(diagnostics.shotsOnTarget >= diagnostics.goals);
  assert.equal(
    diagnostics.shots,
    possessionResolutions.goals + possessionResolutions.nonGoalShots,
  );
  assert.equal(diagnostics.goals, possessionResolutions.goals);
  assert.equal(diagnostics.turnovers, possessionResolutions.turnovers);
  assert.equal(
    possessionResolutions.goals + possessionResolutions.nonGoalShots +
      possessionResolutions.turnovers + possessionResolutions.actionLimitRetentions,
    diagnostics.possessions,
  );
  assert.equal(
    result.outcomes.home + result.outcomes.draw + result.outcomes.away,
    result.iterations,
  );
  assert.equal(result.expectedHomeXg, result.possessionModel.home.expectedGoalsPerMatch);
  assert.equal(result.expectedAwayXg, result.possessionModel.away.expectedGoalsPerMatch);
  assert.ok(result.expectedHomeGoals >= 0);
  assert.ok(result.expectedAwayGoals >= 0);
  assert.ok(result.expectedHomeXg >= 0);
  assert.ok(result.expectedAwayXg >= 0);
  assert.ok(Math.abs(
    result.probabilities.home + result.probabilities.draw + result.probabilities.away - 1,
  ) < 1e-12);
  assert.equal(result.standingsContext.adjustmentsApplied, false);
  assert.equal(result.standingsContext.home.status, "missing");
  assert.equal(result.sampleMatchAudit.scorelineReconciled, true);
  assert.equal(
    result.goalMarkets.bttsYesCount + result.goalMarkets.bttsNoCount,
    result.iterations,
  );
  assert.equal(
    result.scorelineDistribution.reduce((sum, scoreline) => sum + scoreline.count, 0),
    result.iterations,
  );
  assert.equal(
    result.inputAudit.home.shotXgSources.teamStatistics +
      result.inputAudit.home.shotXgSources.playerProfile +
      result.inputAudit.home.shotXgSources.recentResults +
      result.inputAudit.home.shotXgSources.neutralPrior +
      result.inputAudit.away.shotXgSources.teamStatistics +
      result.inputAudit.away.shotXgSources.playerProfile +
      result.inputAudit.away.shotXgSources.recentResults +
      result.inputAudit.away.shotXgSources.neutralPrior,
    diagnostics.shots,
  );
});

test("recent score fallback differentiates teams when detailed statistics are missing", () => {
  const home = sparseTeam("home", "Everton U21", 1.17, 0.83);
  const away = sparseTeam("away", "Wolves U21", 0.67, 2.33);
  const actual = simulateWithSeed(home, away, 0xFA1701);
  const neutralHome = sparseTeam("neutral-home", "Home", 1.3, 1.3);
  const neutralAway = sparseTeam("neutral-away", "Away", 1.3, 1.3);
  const neutral = simulateWithSeed(neutralHome, neutralAway, 0xFA1701);

  assert.equal(actual.inputAudit.home.detailedMatchStatSamples, 0);
  assert.equal(actual.inputAudit.home.archivePlayerProfiles, 0);
  assert.equal(actual.inputAudit.home.coverage, "limited");
  assert.ok(actual.inputAudit.home.warnings.some((warning) => warning.includes("No detailed team match-stat")));
  assert.ok(actual.inputAudit.home.shotXgSources.recentResults > 0);
  assert.equal(actual.inputAudit.home.shotXgSources.neutralPrior, 0);
  assert.ok(actual.expectedHomeXg > actual.expectedAwayXg);
  assert.ok(actual.probabilities.home > actual.probabilities.away);
  assert.notEqual(actual.expectedHomeXg, neutral.expectedHomeXg);
  assert.notEqual(actual.expectedAwayXg, neutral.expectedAwayXg);
  assert.equal(actual.uncertainty.modelStatus, "not-quantified");
});

test("independent attack and defensive-weakness changes alter shot output", () => {
  const baseHome = sparseTeam("home", "Home", 1.2, 1.1);
  const baseAway = sparseTeam("away", "Away", 1.1, 1.2);
  const baseline = simulateWithSeed(baseHome, baseAway, 0xA77AC1);

  const strongerHome = sparseTeam("home", "Home", 2.6, 1.1);
  const strongerAttack = simulateWithSeed(
    strongerHome,
    sparseTeam("away", "Away", 1.1, 1.2),
    0xA77AC1,
  );
  assert.ok(strongerAttack.expectedHomeXg > baseline.expectedHomeXg);
  assert.ok(strongerAttack.probabilities.home > baseline.probabilities.home);

  const weakerDefense = simulateWithSeed(
    sparseTeam("home", "Home", 1.2, 1.1),
    sparseTeam("away", "Away", 1.1, 3.0),
    0xA77AC1,
  );
  assert.ok(weakerDefense.expectedHomeXg > baseline.expectedHomeXg);
  assert.ok(weakerDefense.probabilities.home > baseline.probabilities.home);
});

test("finishing quality changes simulated goals separately from shot xG", () => {
  const lowFinishingHome = team("home", "Home", 50);
  lowFinishingHome.recentMatchCount = 8;
  lowFinishingHome.avgGoalsFor = 1.1;
  lowFinishingHome.teamStats.matchStatSampleCount = 8;
  lowFinishingHome.teamStats.expectedGoalsFor = 1.5;
  const highFinishingHome = team("home", "Home", 50);
  highFinishingHome.recentMatchCount = 8;
  highFinishingHome.avgGoalsFor = 2.1;
  highFinishingHome.teamStats.matchStatSampleCount = 8;
  highFinishingHome.teamStats.expectedGoalsFor = 1.5;
  const low = simulateWithSeed(
    lowFinishingHome,
    team("away", "Away", 50),
    0xF1A15,
  );
  const high = simulateWithSeed(
    highFinishingHome,
    team("away", "Away", 50),
    0xF1A15,
  );

  assert.equal(high.expectedHomeXg, low.expectedHomeXg);
  assert.ok(high.expectedHomeGoals > low.expectedHomeGoals);
  assert.ok(high.probabilities.home > low.probabilities.home);
});

test("goalkeeper saves reduce goals without rewriting shot xG", () => {
  const home = team("home", "Home", 50);
  const awayWithWeakKeeper = team("away", "Away", 50);
  const awayWithStrongKeeper = team("away", "Away", 50);
  awayWithWeakKeeper.players = [goalkeeper(0)];
  awayWithStrongKeeper.players = [goalkeeper(5)];

  const weakKeeperResult = simulateWithSeed(home, awayWithWeakKeeper, 0x6A0A1);
  const strongKeeperResult = simulateWithSeed(
    team("home", "Home", 50),
    awayWithStrongKeeper,
    0x6A0A1,
  );

  assert.equal(strongKeeperResult.expectedHomeXg, weakKeeperResult.expectedHomeXg);
  assert.ok(strongKeeperResult.expectedHomeGoals < weakKeeperResult.expectedHomeGoals);
  assert.ok(strongKeeperResult.probabilities.home < weakKeeperResult.probabilities.home);
});

test("possession-style inputs change the possession distribution", () => {
  const balanced = simulateWithSeed(
    team("home", "Home", 50),
    team("away", "Away", 50),
    0x905E5510,
  );
  const possessionHome = simulateWithSeed(
    team("home", "Home", 65),
    team("away", "Away", 35),
    0x905E5510,
  );

  assert.equal(balanced.possessionModel.home.possessionSharePct, 50);
  assert.equal(possessionHome.possessionModel.home.possessionSharePct, 65);
  assert.notEqual(
    possessionHome.possessionModel.home.possessionsPerMatch,
    balanced.possessionModel.home.possessionsPerMatch,
  );
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
