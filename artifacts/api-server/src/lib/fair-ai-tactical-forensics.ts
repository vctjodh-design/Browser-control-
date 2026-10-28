import type { FootballFairAiTacticalForensics } from "@workspace/api-zod";

type TacticalSnapshot = {
  fixtureId: number;
  details: {
    match: {
      home: {
        id: number;
        name: string;
        score: number;
        halfTimeScore: number | null;
      };
      away: {
        id: number;
        name: string;
        score: number;
        halfTimeScore: number | null;
      };
    };
    statistics: Array<{
      teamId: number | null;
      teamName: string;
      statistics: Array<{ label: string; value: string | number | null }>;
    }>;
    lineups: Array<{
      teamId: number | null;
      teamName: string;
      formation: string | null;
    }>;
  };
};

type TeamSample = {
  matchesExpected: number;
  matchesAnalyzed: number;
  wins: number;
  draws: number;
  losses: number;
  bttsMatches: number;
  over25Matches: number;
  over35Matches: number;
  goalsFor: Array<number | null>;
  goalsAgainst: Array<number | null>;
  firstHalfGoalsFor: number[];
  secondHalfGoalsFor: number[];
  firstHalfShots: number[];
  secondHalfShots: number[];
  possession: number[];
  shotsFor: number[];
  shotsAgainst: number[];
  shotsOnTargetFor: number[];
  shotsOnTargetAgainst: number[];
  passCompletion: number[];
  longBallCompletion: number[];
  finalThirdPassCompletion: number[];
  defensiveActions: number[];
  recoveries: number[];
  statisticMatchCount: number;
  phaseShotMatchCount: number;
  buildupMatchCount: number;
  defensiveActivityMatchCount: number;
  formationSamples: number;
  formations: Set<string>;
};

function cleanName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function metricNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/,/g, ".").replace(/%/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (value): value is number => value !== null && value !== undefined && Number.isFinite(value),
  );
  return valid.length
    ? valid.reduce((total, value) => total + value, 0) / valid.length
    : null;
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function statValue(
  rows: TacticalSnapshot["details"]["statistics"][number]["statistics"],
  aliases: string[],
  period: "full" | "first" | "second" = "full",
): number | null {
  const normalizedAliases = aliases.map((alias) => cleanName(alias));
  for (const row of rows) {
    const [prefix = "", ...parts] = row.label.split("·").map((part) => part.trim());
    const label = cleanName(parts.at(-1) ?? row.label);
    const normalizedPrefix = cleanName(prefix);
    const periodMatches = period === "full"
      ? normalizedPrefix.includes("full")
      : period === "first"
        ? normalizedPrefix.includes("1st") || normalizedPrefix.includes("first")
        : normalizedPrefix.includes("2nd") || normalizedPrefix.includes("second");
    if (!periodMatches) continue;
    if (normalizedAliases.some((alias) => label === alias || label.includes(alias))) {
      return metricNumber(row.value);
    }
  }
  return null;
}

function percentageOrRatio(
  rows: TacticalSnapshot["details"]["statistics"][number]["statistics"],
  directAliases: string[],
  accurateAliases: string[],
  totalAliases: string[],
): number | null {
  const direct = statValue(rows, directAliases);
  if (direct !== null) return direct;
  const accurate = statValue(rows, accurateAliases);
  const total = statValue(rows, totalAliases);
  return accurate !== null && total !== null && total > 0
    ? accurate / total * 100
    : null;
}

function newSample(matchesExpected: number): TeamSample {
  return {
    matchesExpected,
    matchesAnalyzed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    bttsMatches: 0,
    over25Matches: 0,
    over35Matches: 0,
    goalsFor: [],
    goalsAgainst: [],
    firstHalfGoalsFor: [],
    secondHalfGoalsFor: [],
    firstHalfShots: [],
    secondHalfShots: [],
    possession: [],
    shotsFor: [],
    shotsAgainst: [],
    shotsOnTargetFor: [],
    shotsOnTargetAgainst: [],
    passCompletion: [],
    longBallCompletion: [],
    finalThirdPassCompletion: [],
    defensiveActions: [],
    recoveries: [],
    statisticMatchCount: 0,
    phaseShotMatchCount: 0,
    buildupMatchCount: 0,
    defensiveActivityMatchCount: 0,
    formationSamples: 0,
    formations: new Set<string>(),
  };
}

function collectTeamSample(
  teamId: number,
  expectedFixtureIds: number[],
  snapshotsByFixture: Map<number, TacticalSnapshot>,
): TeamSample {
  const sample = newSample(expectedFixtureIds.length);
  for (const fixtureId of expectedFixtureIds) {
    const snapshot = snapshotsByFixture.get(fixtureId);
    if (!snapshot) continue;
    const { match } = snapshot.details;
    const ownIsHome = match.home.id === teamId;
    if (!ownIsHome && match.away.id !== teamId) continue;

    const own = ownIsHome ? match.home : match.away;
    const opponent = ownIsHome ? match.away : match.home;
    sample.matchesAnalyzed += 1;
    sample.goalsFor.push(own.score);
    sample.goalsAgainst.push(opponent.score);
    if (own.score > opponent.score) sample.wins += 1;
    else if (own.score === opponent.score) sample.draws += 1;
    else sample.losses += 1;
    if (own.score > 0 && opponent.score > 0) sample.bttsMatches += 1;
    if (own.score + opponent.score > 2) sample.over25Matches += 1;
    if (own.score + opponent.score > 3) sample.over35Matches += 1;

    if (own.halfTimeScore !== null) {
      sample.firstHalfGoalsFor.push(own.halfTimeScore);
      sample.secondHalfGoalsFor.push(own.score - own.halfTimeScore);
    }

    const ownTeamStats = snapshot.details.statistics.find(
      (entry) => entry.teamId === teamId ||
        cleanName(entry.teamName) === cleanName(own.name),
    )?.statistics ?? [];
    const opponentTeamStats = snapshot.details.statistics.find(
      (entry) => entry.teamId === opponent.id ||
        cleanName(entry.teamName) === cleanName(opponent.name),
    )?.statistics ?? [];
    if (ownTeamStats.length) sample.statisticMatchCount += 1;

    const possession = statValue(ownTeamStats, ["ball possession", "possession"]);
    const shotsFor = statValue(ownTeamStats, ["total shots", "total shots"]);
    const shotsAgainst = statValue(opponentTeamStats, ["total shots", "total shots"]);
    const shotsOnTargetFor = statValue(ownTeamStats, ["shots on goal", "shots on target"]);
    const shotsOnTargetAgainst = statValue(opponentTeamStats, ["shots on goal", "shots on target"]);
    const firstHalfShots = statValue(ownTeamStats, ["total shots", "total shots"], "first");
    const secondHalfShots = statValue(ownTeamStats, ["total shots", "total shots"], "second");
    if (possession !== null) sample.possession.push(possession);
    if (shotsFor !== null) sample.shotsFor.push(shotsFor);
    if (shotsAgainst !== null) sample.shotsAgainst.push(shotsAgainst);
    if (shotsOnTargetFor !== null) sample.shotsOnTargetFor.push(shotsOnTargetFor);
    if (shotsOnTargetAgainst !== null) sample.shotsOnTargetAgainst.push(shotsOnTargetAgainst);
    if (firstHalfShots !== null && secondHalfShots !== null) {
      sample.phaseShotMatchCount += 1;
      sample.firstHalfShots.push(firstHalfShots);
      sample.secondHalfShots.push(secondHalfShots);
    }

    const passCompletion = percentageOrRatio(
      ownTeamStats,
      ["passes %", "pass accuracy", "passes percentage"],
      ["passes accurate", "accurate passes"],
      ["total passes", "passes"],
    );
    const longBallCompletion = percentageOrRatio(
      ownTeamStats,
      ["accurate long balls %", "long balls %", "long ball accuracy"],
      ["accurate long balls"],
      ["total long balls", "long balls"],
    );
    const finalThirdPassCompletion = percentageOrRatio(
      ownTeamStats,
      ["passes in final third %", "final third passes %"],
      ["accurate passes in final third", "accurate final third passes"],
      ["passes in final third", "final third passes"],
    );
    if (passCompletion !== null) sample.passCompletion.push(passCompletion);
    if (longBallCompletion !== null) sample.longBallCompletion.push(longBallCompletion);
    if (finalThirdPassCompletion !== null) {
      sample.finalThirdPassCompletion.push(finalThirdPassCompletion);
    }
    if (passCompletion !== null || longBallCompletion !== null || finalThirdPassCompletion !== null) {
      sample.buildupMatchCount += 1;
    }

    const tackles = statValue(ownTeamStats, ["total tackles", "tackles"]);
    const interceptions = statValue(ownTeamStats, ["interceptions"]);
    const recoveries = statValue(ownTeamStats, ["recoveries"]);
    if (tackles !== null || interceptions !== null) {
      sample.defensiveActions.push((tackles ?? 0) + (interceptions ?? 0));
    }
    if (recoveries !== null) sample.recoveries.push(recoveries);
    if (tackles !== null || interceptions !== null || recoveries !== null) {
      sample.defensiveActivityMatchCount += 1;
    }

    const lineup = snapshot.details.lineups.find(
      (entry) => entry.teamId === teamId ||
        cleanName(entry.teamName) === cleanName(own.name),
    );
    if (lineup) {
      sample.formationSamples += 1;
      if (lineup.formation) sample.formations.add(lineup.formation);
    }
  }
  return sample;
}

function adjustmentFor(
  sample: TeamSample,
  opponent: TeamSample,
): FootballFairAiTacticalForensics["home"]["adjustment"] {
  const latestPhaseShotsAvailable = sample.phaseShotMatchCount >= 3;
  const firstHalfShots = latestPhaseShotsAvailable
    ? average(sample.firstHalfShots)
    : null;
  const secondHalfShots = latestPhaseShotsAvailable
    ? average(sample.secondHalfShots)
    : null;
  const totalPhaseShots = (firstHalfShots ?? 0) + (secondHalfShots ?? 0);
  const firstHalfShare = totalPhaseShots > 0
    ? (firstHalfShots ?? 0) / totalPhaseShots
    : null;
  const secondHalfShare = totalPhaseShots > 0
    ? (secondHalfShots ?? 0) / totalPhaseShots
    : null;
  const secondHalfShotScale = secondHalfShare === null
    ? 1
    : Math.min(1.08, Math.max(0.92, 1 + (secondHalfShare - 0.5) * 0.24));
  const firstHalfShotScale = firstHalfShare === null
    ? 1
    : Math.min(1.08, Math.max(0.92, 1 + (firstHalfShare - 0.5) * 0.24));

  const opponentShotsFaced = average(opponent.shotsAgainst);
  const opponentGoalsConceded = average(opponent.goalsAgainst);
  const attackVsDefenseXgScale =
    opponent.matchesAnalyzed >= 3 &&
    (opponentShotsFaced !== null || opponentGoalsConceded !== null)
      ? Math.min(
          1.08,
          Math.max(
            0.92,
            1 +
              ((opponentShotsFaced ?? 11) - 11) * 0.003 +
              ((opponentGoalsConceded ?? 1.35) - 1.35) * 0.025,
          ),
        )
      : 1;

  const attackPassCompletion = average(sample.passCompletion);
  const attackLongBallCompletion = average(sample.longBallCompletion);
  const opposingDefensiveActivity = average(opponent.defensiveActions);
  const buildupAdjustment = sample.buildupMatchCount >= 3 &&
      opponent.defensiveActivityMatchCount >= 3
    ? Math.min(
        0.02,
        Math.max(
          -0.02,
          ((attackPassCompletion ?? 80) - 80) * 0.00018 +
            ((attackLongBallCompletion ?? 50) - 50) * 0.00012 -
            ((opposingDefensiveActivity ?? 90) - 90) * 0.000035,
        ),
      )
    : 0;

  return {
    firstHalfShotScale,
    secondHalfShotScale,
    attackVsDefenseXgScale,
    buildupVsDefensePassAdjustmentPct: Math.round(buildupAdjustment * 100 * 100) / 100,
  };
}

function teamProfile(
  teamName: string,
  sample: TeamSample,
  opponent: TeamSample,
): FootballFairAiTacticalForensics["home"] {
  return {
    teamName,
    matchesExpected: sample.matchesExpected,
    matchesAnalyzed: sample.matchesAnalyzed,
    results: { wins: sample.wins, draws: sample.draws, losses: sample.losses },
    bttsMatches: sample.bttsMatches,
    over25Matches: sample.over25Matches,
    over35Matches: sample.over35Matches,
    averageGoalsFor: rounded(average(sample.goalsFor)),
    averageGoalsAgainst: rounded(average(sample.goalsAgainst)),
    firstHalfGoalsFor: rounded(average(sample.firstHalfGoalsFor)),
    secondHalfGoalsFor: rounded(average(sample.secondHalfGoalsFor)),
    averagePossessionPct: rounded(average(sample.possession)),
    averageShotsFor: rounded(average(sample.shotsFor)),
    averageShotsAgainst: rounded(average(sample.shotsAgainst)),
    averageShotsOnTargetFor: rounded(average(sample.shotsOnTargetFor)),
    averageShotsOnTargetAgainst: rounded(average(sample.shotsOnTargetAgainst)),
    averagePassCompletionPct: rounded(average(sample.passCompletion)),
    averageLongBallCompletionPct: rounded(average(sample.longBallCompletion)),
    averageFinalThirdPassCompletionPct: rounded(average(sample.finalThirdPassCompletion)),
    averageDefensiveActions: rounded(average(sample.defensiveActions)),
    averageRecoveries: rounded(average(sample.recoveries)),
    statisticMatchCount: sample.statisticMatchCount,
    phaseShotMatchCount: sample.phaseShotMatchCount,
    buildupMatchCount: sample.buildupMatchCount,
    defensiveActivityMatchCount: sample.defensiveActivityMatchCount,
    formationSamples: sample.formationSamples,
    observedFormations: [...sample.formations],
    adjustment: adjustmentFor(sample, opponent),
  };
}

export function buildFairAiTacticalForensics(
  snapshots: TacticalSnapshot[],
  recentFixtureIdsByTeam: Record<number, number[]>,
  homeTeamId: number,
  awayTeamId: number,
  homeTeamName: string,
  awayTeamName: string,
): FootballFairAiTacticalForensics {
  const snapshotsByFixture = new Map(
    snapshots.map((snapshot) => [snapshot.fixtureId, snapshot]),
  );
  const homeSample = collectTeamSample(
    homeTeamId,
    (recentFixtureIdsByTeam[homeTeamId] ?? []).slice(0, 5),
    snapshotsByFixture,
  );
  const awaySample = collectTeamSample(
    awayTeamId,
    (recentFixtureIdsByTeam[awayTeamId] ?? []).slice(0, 5),
    snapshotsByFixture,
  );

  return {
    source: "Fresh KickoffScore scores, full/half statistics, and lineups from up to five completed matches per team.",
    home: teamProfile(homeTeamName, homeSample, awaySample),
    away: teamProfile(awayTeamName, awaySample, homeSample),
    opponentRecentStrengthStatus: "unavailable",
    matchupNote: "Five-match result, goal, phase, buildup, and defensive-activity evidence is compared across both teams. Bounded shot-phase, build-up-versus-defensive-activity, and opposing-shot-exposure adjustments are passed into the raw FAIR AI simulation before the odds/FAIR AI blend.",
    limitations: [
      "The source does not provide these historical opponents' own as-of-match five-game strength records, so opponent recent strength is unavailable rather than guessed.",
      "Aggregate match statistics do not prove pressing triggers, high-line behavior, overloads, rest-defense shape, counterattacks, tactical confidence, or managerial adaptations.",
      "Scores and BTTS/goal-line frequencies describe this small historical sample; they are not probabilities for the upcoming fixture.",
      "Half-specific shot adjustments require half-period shot data in at least three matches and are shrunk and bounded. Other tactical adjustments are similarly bounded proxies.",
      "Observed formations describe historical lineups, not the confirmed lineup or formation for the upcoming match.",
    ],
  };
}
