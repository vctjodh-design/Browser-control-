import type { FootballFairAiTacticalForensics } from "@workspace/api-client-react";

type ForensicsMarketSource = Pick<
  FootballFairAiTacticalForensics,
  "home" | "away" | "assessment"
>;

export type ForensicsMarketPick = {
  title: string;
  pick: string;
  details: string;
  historicalFrequency?: number;
  confidence: "Low" | "Moderate" | "High" | "Not rated";
  confidenceReason: string;
};

const EXPECTED_TEAM_MATCHES = 5;

function average(values: Array<number | null>): number | null {
  const available = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  return available.length
    ? available.reduce((total, value) => total + value, 0) / available.length
    : null;
}

function sampleRate(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

function rateDetail(label: string, count: number, total: number): string {
  const rate = sampleRate(count, total);
  return rate === null
    ? `${label}: no matches analyzed`
    : `${label}: ${count}/${total} sampled matches · ${(rate * 100).toFixed(1)}% historical frequency`;
}

function sampleConfidence(
  pick: string,
  total: number,
  supportingCount?: number,
): Pick<ForensicsMarketPick, "confidence" | "confidenceReason"> {
  if (
    pick === "No clear pick" ||
    pick === "Unavailable" ||
    total <= 0 ||
    supportingCount === undefined
  ) {
    return {
      confidence: "Not rated",
      confidenceReason: "There is not enough evidence to rate a specific pick.",
    };
  }

  const support = Math.max(0, Math.min(total, supportingCount));
  const expectedTotal = EXPECTED_TEAM_MATCHES * 2;
  const coverageIsLimited = total < expectedTotal * 0.6;
  const supportRate = support / total;

  if (total >= expectedTotal * 0.9 && supportRate >= 0.85) {
    return {
      confidence: "High",
      confidenceReason: `Strong sample support: ${support}/${total} analyzed team matches support this pick.`,
    };
  }
  if (!coverageIsLimited && supportRate >= 0.6) {
    return {
      confidence: "Moderate",
      confidenceReason: `${support}/${total} analyzed team matches support this pick.`,
    };
  }

  return {
    confidence: "Low",
    confidenceReason: coverageIsLimited
      ? `Limited sample coverage: ${total}/${expectedTotal} expected team matches analyzed; ${support}/${total} support this pick.`
      : `Limited sample agreement: ${support}/${total} analyzed team matches support this pick.`,
  };
}

function resultPick(source: ForensicsMarketSource): ForensicsMarketPick {
  const { home, away, assessment } = source;
  const homePoints = sampleRate(
    home.results.wins * 3 + home.results.draws,
    home.matchesAnalyzed,
  );
  const awayPoints = sampleRate(
    away.results.wins * 3 + away.results.draws,
    away.matchesAnalyzed,
  );
  let pick = "No clear pick";

  if (assessment.resultLean === "home") pick = `${home.teamName} win`;
  else if (assessment.resultLean === "away") pick = `${away.teamName} win`;
  else if (assessment.resultLean === "draw") pick = "Draw";
  else if (
    homePoints !== null &&
    awayPoints !== null &&
    home.matchesAnalyzed >= 2 &&
    away.matchesAnalyzed >= 2
  ) {
    const difference = homePoints - awayPoints;
    if (difference >= 0.35) pick = `${home.teamName} win`;
    else if (difference <= -0.35) pick = `${away.teamName} win`;
    else if (
      Math.abs(difference) <= 0.25 &&
      home.results.draws / home.matchesAnalyzed >= 0.2 &&
      away.results.draws / away.matchesAnalyzed >= 0.2
    ) {
      pick = "Draw";
    }
  }

  const formatPoints = (points: number | null) =>
    points === null ? "unavailable" : `${points.toFixed(2)} pts/match`;
  const supportingCount = pick === `${home.teamName} win`
    ? home.results.wins + away.results.losses
    : pick === `${away.teamName} win`
      ? home.results.losses + away.results.wins
      : pick === "Draw"
        ? home.results.draws + away.results.draws
        : undefined;
  return {
    title: "1X2",
    pick,
    details: `Forensics assessment: ${assessment.resultLean.replaceAll("_", " ")}. ${home.teamName}: ${home.results.wins}-${home.results.draws}-${home.results.losses} (${home.matchesAnalyzed} matches, ${formatPoints(homePoints)}); ${away.teamName}: ${away.results.wins}-${away.results.draws}-${away.results.losses} (${away.matchesAnalyzed} matches, ${formatPoints(awayPoints)}).`,
    ...sampleConfidence(pick, home.matchesAnalyzed + away.matchesAnalyzed, supportingCount),
  };
}

function binarySamplePick({
  title,
  yesLabel,
  noLabel,
  yesCount,
  total,
  assessmentLean,
  yesAssessmentLeans,
  noAssessmentLeans,
}: {
  title: string;
  yesLabel: string;
  noLabel: string;
  yesCount: number;
  total: number;
  assessmentLean: string;
  yesAssessmentLeans: string[];
  noAssessmentLeans: string[];
}): ForensicsMarketPick {
  const rate = sampleRate(yesCount, total);
  let pick = "No clear pick";
  if (rate !== null && rate > 0.5) pick = yesLabel;
  else if (rate !== null && rate < 0.5) pick = noLabel;
  else if (rate === 0.5 && yesAssessmentLeans.includes(assessmentLean)) {
    pick = yesLabel;
  } else if (rate === 0.5 && noAssessmentLeans.includes(assessmentLean)) {
    pick = noLabel;
  }

  const supportingCount = pick === "No clear pick"
    ? undefined
    : pick === yesLabel
      ? yesCount
      : total - yesCount;

  return {
    title,
    pick,
    details: `${rateDetail(yesLabel, yesCount, total)}. Forensics assessment: ${assessmentLean.replaceAll("_", " ")}${rate === 0.5 ? " (used only to break the sample tie)" : ""}.`,
    historicalFrequency: rate ?? undefined,
    ...sampleConfidence(pick, total, supportingCount),
  };
}

function correctScorePick(source: ForensicsMarketSource): ForensicsMarketPick {
  const { home, away } = source;
  const homeGoals = average([
    home.averageGoalsFor,
    away.averageGoalsAgainst,
  ]);
  const awayGoals = average([
    away.averageGoalsFor,
    home.averageGoalsAgainst,
  ]);
  if (
    homeGoals === null ||
    awayGoals === null ||
    home.matchesAnalyzed === 0 ||
    away.matchesAnalyzed === 0
  ) {
    return {
      title: "Correct score",
      pick: "Unavailable",
      details: "Both teams need analyzed score samples to form a sample-based scoreline.",
      ...sampleConfidence("Unavailable", 0),
    };
  }

  const homePick = Math.max(0, Math.min(6, Math.round(homeGoals)));
  const awayPick = Math.max(0, Math.min(6, Math.round(awayGoals)));
  return {
    title: "Correct score",
    pick: `${homePick}–${awayPick}`,
    details: `Rounded sample means: ${home.teamName} ${homeGoals.toFixed(2)} goals, ${away.teamName} ${awayGoals.toFixed(2)} goals, combining each team's scoring and opposing goals-conceded averages.`,
    confidence: "Low",
    confidenceReason: "Exact scoreline is extrapolated from rounded averages; no exact-score frequency is used.",
  };
}

export function buildForensicsMarketPicks(
  source: ForensicsMarketSource,
): ForensicsMarketPick[] {
  const totalMatches =
    source.home.matchesAnalyzed + source.away.matchesAnalyzed;
  const bttsMatches =
    source.home.bttsMatches + source.away.bttsMatches;
  const over25Matches =
    source.home.over25Matches + source.away.over25Matches;
  const scoringLean = source.assessment.scoringLean;

  return [
    resultPick(source),
    binarySamplePick({
      title: "BTTS",
      yesLabel: "Yes",
      noLabel: "No",
      yesCount: bttsMatches,
      total: totalMatches,
      assessmentLean: scoringLean,
      yesAssessmentLeans: ["open_btts"],
      noAssessmentLeans: ["tight"],
    }),
    binarySamplePick({
      title: "Goals · 2.5",
      yesLabel: "Over 2.5",
      noLabel: "Under 2.5",
      yesCount: over25Matches,
      total: totalMatches,
      assessmentLean: scoringLean,
      yesAssessmentLeans: ["open_btts", "open_goals"],
      noAssessmentLeans: ["tight"],
    }),
    correctScorePick(source),
  ];
}
