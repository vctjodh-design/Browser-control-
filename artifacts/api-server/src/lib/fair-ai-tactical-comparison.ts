import type {
  FootballFairAiTacticalForensics,
  FootballFairAiTacticalMatchupAssessment,
  FootballFairAiTacticalMatchupFactor,
  FootballFairAiTacticalTeamProfile,
} from "@workspace/api-zod";

type TeamProfile = FootballFairAiTacticalForensics["home"];
type Edge = FootballFairAiTacticalMatchupFactor["edge"];

type MetricPair = {
  label: string;
  home: number | null;
  away: number | null;
  homeSamples: number;
  awaySamples: number;
  higherIsBetter: boolean;
  tolerance: number;
  minimumSamples?: number;
};

function format(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value)
    ? "unavailable"
    : value.toFixed(digits);
}

function direction(pair: MetricPair): Edge {
  const minimumSamples = pair.minimumSamples ?? 2;
  if (
    pair.home === null ||
    pair.away === null ||
    pair.homeSamples < minimumSamples ||
    pair.awaySamples < minimumSamples
  ) {
    return "unavailable";
  }
  const difference = pair.home - pair.away;
  if (Math.abs(difference) <= pair.tolerance) return "balanced";
  const homeIsBetter = pair.higherIsBetter
    ? difference > 0
    : difference < 0;
  return homeIsBetter ? "home" : "away";
}

function combinedEdge(edges: Edge[]): Edge {
  const home = edges.filter((edge) => edge === "home").length;
  const away = edges.filter((edge) => edge === "away").length;
  if (!home && !away && edges.every((edge) => edge === "unavailable")) {
    return "unavailable";
  }
  if (home === away) return "balanced";
  return home > away ? "home" : "away";
}

function metricLines(profile: TeamProfile, pairs: MetricPair[], team: "home" | "away"): string {
  if (!pairs.length) return "No paired metrics were available.";
  return pairs.map((pair) => {
    const result = direction(pair);
    const value = pair[team];
    const samples = pair[`${team}Samples`];
    const baseline = profile.matchesExpected;
    return `${pair.label}: ${format(value)} (${samples}/${baseline} samples; ${result === "unavailable" ? "not comparable" : "compared"})`;
  }).join("; ");
}

function factor(
  area: string,
  summary: string,
  home: TeamProfile,
  away: TeamProfile,
  pairs: MetricPair[],
): FootballFairAiTacticalMatchupFactor {
  const available = pairs.map(direction).filter((edge) => edge !== "unavailable");
  const edge = combinedEdge(pairs.map(direction));
  const homeCount = available.filter((value) => value === "home").length;
  const awayCount = available.filter((value) => value === "away").length;
  const comparison = available.length
    ? `Available metrics lean ${edge === "balanced" ? "even" : edge} (${homeCount}-${awayCount}); ${summary}`
    : `Insufficient paired coverage; ${summary}`;
  return {
    area,
    edge,
    summary: comparison,
    homeEvidence: metricLines(home, pairs, "home"),
    awayEvidence: metricLines(away, pairs, "away"),
  };
}

function teamMetric(
  label: string,
  home: TeamProfile,
  away: TeamProfile,
  homeValue: number | null,
  awayValue: number | null,
  homeSamples: number,
  awaySamples: number,
  higherIsBetter: boolean,
  tolerance: number,
  minimumSamples = 2,
): MetricPair {
  return {
    label,
    home: homeValue,
    away: awayValue,
    homeSamples,
    awaySamples,
    higherIsBetter,
    tolerance,
    minimumSamples,
  };
}

function pointsPerMatch(profile: TeamProfile): number | null {
  if (!profile.matchesAnalyzed) return null;
  return (
    profile.results.wins * 3 + profile.results.draws
  ) / profile.matchesAnalyzed;
}

function goalDifferencePerMatch(profile: TeamProfile): number | null {
  if (!profile.matchesAnalyzed) return null;
  return (
    (profile.averageGoalsFor ?? 0) - (profile.averageGoalsAgainst ?? 0)
  );
}

function formationFactor(
  home: TeamProfile,
  away: TeamProfile,
): FootballFairAiTacticalMatchupFactor {
  const homeShape = home.formationSummaries[0];
  const awayShape = away.formationSummaries[0];
  const homeSamples = homeShape?.matches ?? 0;
  const awaySamples = awayShape?.matches ?? 0;
  const pairs = homeShape && awayShape
    ? [
        teamMetric(
          "Points per match in most-used formation",
          home,
          away,
          homeShape.pointsPerMatch,
          awayShape.pointsPerMatch,
          homeSamples,
          awaySamples,
          true,
          0.2,
          2,
        ),
      ]
    : [];
  const homeDescription = homeShape
    ? `${homeShape.formation}, ${homeShape.matches} matches, ${format(homeShape.pointsPerMatch)} points/match`
    : "formation performance unavailable";
  const awayDescription = awayShape
    ? `${awayShape.formation}, ${awayShape.matches} matches, ${format(awayShape.pointsPerMatch)} points/match`
    : "formation performance unavailable";
  const comparison = factor(
    "Formation performance",
    "a formation's record does not prove that the shape caused those results",
    home,
    away,
    pairs,
  );
  comparison.homeEvidence = homeDescription;
  comparison.awayEvidence = awayDescription;
  return comparison;
}

function goalEnvironment(
  home: TeamProfile,
  away: TeamProfile,
): FootballFairAiTacticalMatchupAssessment["scoringLean"] {
  const metrics = [
    home.averageGoalsFor,
    home.averageGoalsAgainst,
    away.averageGoalsFor,
    away.averageGoalsAgainst,
  ];
  if (metrics.some((value) => value === null)) return "unavailable";
  const expectedTotal = (
    (home.averageGoalsFor ?? 0) +
    (home.averageGoalsAgainst ?? 0) +
    (away.averageGoalsFor ?? 0) +
    (away.averageGoalsAgainst ?? 0)
  ) / 2;
  const homeBtts = home.matchesAnalyzed
    ? home.bttsMatches / home.matchesAnalyzed
    : null;
  const awayBtts = away.matchesAnalyzed
    ? away.bttsMatches / away.matchesAnalyzed
    : null;
  if (
    expectedTotal >= 2.8 &&
    homeBtts !== null &&
    awayBtts !== null &&
    homeBtts >= 0.5 &&
    awayBtts >= 0.5
  ) {
    return "open_btts";
  }
  if (expectedTotal >= 2.8) return "open_goals";
  if (
    expectedTotal <= 2.2 &&
    homeBtts !== null &&
    awayBtts !== null &&
    homeBtts < 0.5 &&
    awayBtts < 0.5
  ) {
    return "tight";
  }
  return "mixed";
}

function directionalFactorCount(factors: FootballFairAiTacticalMatchupFactor[]): number {
  return factors.filter((item) => item.edge === "home" || item.edge === "away").length;
}

export function buildFairAiTacticalMatchupAssessment(
  home: TeamProfile,
  away: TeamProfile,
): FootballFairAiTacticalMatchupAssessment {
  const form = factor(
    "Recent form",
    "points and goal difference are included, but neither is used alone",
    home,
    away,
    [
      teamMetric(
        "Points per match",
        home,
        away,
        pointsPerMatch(home),
        pointsPerMatch(away),
        home.matchesAnalyzed,
        away.matchesAnalyzed,
        true,
        0.2,
      ),
      teamMetric(
        "Goal difference per match",
        home,
        away,
        goalDifferencePerMatch(home),
        goalDifferencePerMatch(away),
        home.matchesAnalyzed,
        away.matchesAnalyzed,
        true,
        0.25,
      ),
    ],
  );
  const chanceCreation = factor(
    "Chance creation",
    "xG, big chances, shots on target, and total shots are compared where both samples report them",
    home,
    away,
    [
      teamMetric(
        "Expected goals for",
        home,
        away,
        home.averageExpectedGoalsFor,
        away.averageExpectedGoalsFor,
        home.expectedGoalsMatchCount,
        away.expectedGoalsMatchCount,
        true,
        0.15,
      ),
      teamMetric(
        "Big chances for",
        home,
        away,
        home.averageBigChancesFor,
        away.averageBigChancesFor,
        home.bigChancesMatchCount,
        away.bigChancesMatchCount,
        true,
        0.2,
      ),
      teamMetric(
        "Shots on target",
        home,
        away,
        home.averageShotsOnTargetFor,
        away.averageShotsOnTargetFor,
        home.statisticMatchCount,
        away.statisticMatchCount,
        true,
        0.4,
      ),
      teamMetric(
        "Total shots",
        home,
        away,
        home.averageShotsFor,
        away.averageShotsFor,
        home.statisticMatchCount,
        away.statisticMatchCount,
        true,
        0.8,
      ),
    ],
  );
  const buildUp = factor(
    "Build-up indicators",
    "completion and progression indicators describe execution, not overloads or tactical confidence",
    home,
    away,
    [
      teamMetric(
        "Pass completion",
        home,
        away,
        home.averagePassCompletionPct,
        away.averagePassCompletionPct,
        home.buildupMatchCount,
        away.buildupMatchCount,
        true,
        1.5,
      ),
      teamMetric(
        "Final-third pass completion",
        home,
        away,
        home.averageFinalThirdPassCompletionPct,
        away.averageFinalThirdPassCompletionPct,
        home.buildupMatchCount,
        away.buildupMatchCount,
        true,
        2,
      ),
      teamMetric(
        "Long-ball completion",
        home,
        away,
        home.averageLongBallCompletionPct,
        away.averageLongBallCompletionPct,
        home.buildupMatchCount,
        away.buildupMatchCount,
        true,
        2,
      ),
    ],
  );
  const defending = factor(
    "Defensive resistance",
    "lower expected goals, shots, and shots on target conceded are the stronger indicators",
    home,
    away,
    [
      teamMetric(
        "Expected goals against",
        home,
        away,
        home.averageExpectedGoalsAgainst,
        away.averageExpectedGoalsAgainst,
        home.expectedGoalsMatchCount,
        away.expectedGoalsMatchCount,
        false,
        0.15,
      ),
      teamMetric(
        "Goals against",
        home,
        away,
        home.averageGoalsAgainst,
        away.averageGoalsAgainst,
        home.matchesAnalyzed,
        away.matchesAnalyzed,
        false,
        0.2,
      ),
      teamMetric(
        "Shots on target conceded",
        home,
        away,
        home.averageShotsOnTargetAgainst,
        away.averageShotsOnTargetAgainst,
        home.statisticMatchCount,
        away.statisticMatchCount,
        false,
        0.4,
      ),
      teamMetric(
        "Total shots conceded",
        home,
        away,
        home.averageShotsAgainst,
        away.averageShotsAgainst,
        home.statisticMatchCount,
        away.statisticMatchCount,
        false,
        0.8,
      ),
    ],
  );
  const formation = formationFactor(home, away);
  const timeline = factor(
    "Game-state response",
    "uses goal chronology only in matches where event goal counts match the final score",
    home,
    away,
    [
      teamMetric(
        "Goals scored after conceding per complete timeline",
        home,
        away,
        home.completeGoalTimelines
          ? home.goalsAfterConceding / home.completeGoalTimelines
          : null,
        away.completeGoalTimelines
          ? away.goalsAfterConceding / away.completeGoalTimelines
          : null,
        home.completeGoalTimelines,
        away.completeGoalTimelines,
        true,
        0.1,
      ),
      teamMetric(
        "Late-goal balance per complete timeline",
        home,
        away,
        home.completeGoalTimelines
          ? (home.lateGoalsFor - home.lateGoalsAgainst) / home.completeGoalTimelines
          : null,
        away.completeGoalTimelines
          ? (away.lateGoalsFor - away.lateGoalsAgainst) / away.completeGoalTimelines
          : null,
        home.completeGoalTimelines,
        away.completeGoalTimelines,
        true,
        0.1,
      ),
    ],
  );
  const playerImpact = factor(
    "Player impact",
    "player ratings are only compared when each team has at least two rated matches",
    home,
    away,
    [
      teamMetric(
        "Average player rating",
        home,
        away,
        home.averagePlayerRating,
        away.averagePlayerRating,
        home.playerRatingMatchCount,
        away.playerRatingMatchCount,
        true,
        0.12,
      ),
    ],
  );
  const factors = [
    form,
    chanceCreation,
    buildUp,
    defending,
    formation,
    timeline,
    playerImpact,
  ];
  const homeEdges = factors.filter((item) => item.edge === "home").length;
  const awayEdges = factors.filter((item) => item.edge === "away").length;
  const knownFactors = factors.filter((item) => item.edge !== "unavailable").length;
  const edgeMargin = homeEdges - awayEdges;
  const sharedSample = Math.min(home.matchesAnalyzed, away.matchesAnalyzed);
  let resultLean: FootballFairAiTacticalMatchupAssessment["resultLean"] =
    "no_clear_edge";
  if (sharedSample >= 3 && knownFactors >= 4 && edgeMargin >= 2) {
    resultLean = "home";
  } else if (sharedSample >= 3 && knownFactors >= 4 && edgeMargin <= -2) {
    resultLean = "away";
  } else {
    const homeDrawRate = home.matchesAnalyzed
      ? home.results.draws / home.matchesAnalyzed
      : 0;
    const awayDrawRate = away.matchesAnalyzed
      ? away.results.draws / away.matchesAnalyzed
      : 0;
    if (
      sharedSample >= 3 &&
      knownFactors >= 4 &&
      Math.abs(edgeMargin) <= 1 &&
      homeDrawRate >= 0.2 &&
      awayDrawRate >= 0.2
    ) {
      resultLean = "draw";
    }
  }

  const confidence: FootballFairAiTacticalMatchupAssessment["confidence"] =
    sharedSample < 3 || knownFactors < 4
      ? "limited"
      : knownFactors >= 6 && Math.abs(edgeMargin) >= 3
        ? "moderate"
        : "low";
  const scoringLean = goalEnvironment(home, away);
  const outcomeText = resultLean === "home"
    ? `${home.teamName} has the clearer evidence edge`
    : resultLean === "away"
      ? `${away.teamName} has the clearer evidence edge`
      : resultLean === "draw"
        ? "A draw is a live scenario because the evidence is close and both samples include regular draws"
        : "There is no strong result edge from the available evidence";
  const scoringText = scoringLean === "open_btts"
    ? "Both recent samples support an open, BTTS-leaning game"
    : scoringLean === "open_goals"
      ? "The combined scoring history leans toward an open game"
      : scoringLean === "tight"
        ? "Both samples lean toward a tighter, lower-scoring game"
        : scoringLean === "mixed"
          ? "The recent goal patterns are mixed"
          : "There is not enough scoring data for a goal-environment lean";

  return {
    resultLean,
    confidence,
    scoringLean,
    summary: `${outcomeText}. ${scoringText}. This is a qualitative comparison across up to ten recent matches per team, covering form, chance creation, build-up indicators, defending, formation results, game-state events, and player ratings; it is not a probability.`,
    factors,
  };
}
