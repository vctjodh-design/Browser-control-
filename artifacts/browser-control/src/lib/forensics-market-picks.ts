import type { FootballFairAiTacticalForensics } from "@workspace/api-client-react";
import type { OddsExpectationReport } from "@/lib/odds-expectation";

type ForensicsMarketSource = Pick<
  FootballFairAiTacticalForensics,
  "home" | "away" | "assessment"
>;
type TeamProfile = ForensicsMarketSource["home"];

export type ForensicsMarketGroup = "Result" | "Goals" | "Team" | "Score";

export type ForensicsMarketPick = {
  title: string;
  pick: string;
  details: string;
  probability: number | null;
  alternative: string | null;
  confidence: "Low" | "Moderate" | "High" | "Not rated";
  confidenceReason: string;
  historicalFrequency?: number;
  basis: "odds" | "form";
  group: ForensicsMarketGroup;
};

const GOAL_CAP = 10;
const FORM_PRIOR = 1.35;
const FORM_PRIOR_WEIGHT = 4;

/** scoreline probability grid indexed [homeGoals][awayGoals] */
type Grid = number[][];

function percentage(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${(value * 100).toFixed(digits)}%`;
}

function normalizeGrid(grid: Grid): Grid | null {
  let total = 0;
  const cleaned = grid.map((row) =>
    row.map((value) => {
      const next = Number.isFinite(value) && value > 0 ? value : 0;
      total += next;
      return next;
    }),
  );
  if (!(total > 0)) return null;
  return cleaned.map((row) => row.map((value) => value / total));
}

function poissonGrid(homeLambda: number, awayLambda: number): Grid {
  const build = (lambda: number) => {
    const values: number[] = [Math.exp(-lambda)];
    for (let goals = 1; goals <= GOAL_CAP; goals += 1) {
      values.push((values[goals - 1] * lambda) / goals);
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    return values.map((value) => value / total);
  };
  const home = build(homeLambda);
  const away = build(awayLambda);
  return home.map((homeProbability) => away.map((awayProbability) => homeProbability * awayProbability));
}

function shrinkToPrior(value: number, samples: number): number {
  const weight = Math.max(0, samples);
  return (value * weight + FORM_PRIOR * FORM_PRIOR_WEIGHT) / (weight + FORM_PRIOR_WEIGHT);
}

function sampleRate(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

function formGrid(home: TeamProfile, away: TeamProfile): Grid | null {
  const samples = Math.min(home.matchesAnalyzed, away.matchesAnalyzed);
  if (samples < 2) return null;
  if (
    home.averageGoalsFor === null ||
    home.averageGoalsAgainst === null ||
    away.averageGoalsFor === null ||
    away.averageGoalsAgainst === null
  ) {
    return null;
  }
  const homeLambda = shrinkToPrior(
    (home.averageGoalsFor + away.averageGoalsAgainst) / 2,
    samples,
  );
  const awayLambda = shrinkToPrior(
    (away.averageGoalsFor + home.averageGoalsAgainst) / 2,
    samples,
  );
  return poissonGrid(homeLambda, awayLambda);
}

function oddsGrid(odds: OddsExpectationReport): Grid | null {
  const grid: Grid = Array.from({ length: GOAL_CAP + 1 }, () =>
    Array.from({ length: GOAL_CAP + 1 }, () => 0),
  );
  let seen = false;
  for (const cell of odds.scorelineDistribution) {
    if (cell.homeGoals > GOAL_CAP || cell.awayGoals > GOAL_CAP) continue;
    grid[cell.homeGoals][cell.awayGoals] = cell.probability;
    if (cell.probability > 0) seen = true;
  }
  return seen ? normalizeGrid(grid) : null;
}

function probabilityWhere(grid: Grid, predicate: (home: number, away: number) => boolean): number {
  let total = 0;
  grid.forEach((row, home) =>
    row.forEach((probability, away) => {
      if (predicate(home, away)) total += probability;
    }),
  );
  return total;
}

type Candidate = { label: string; probability: number };

function best(candidates: Candidate[]): Candidate {
  return candidates.reduce((leader, candidate) =>
    candidate.probability > leader.probability ? candidate : leader,
  );
}

function confidenceFor(
  probability: number | null,
  options: { basis: "odds" | "form"; coverageIsLimited: boolean; isExactScore?: boolean },
): ForensicsMarketPick["confidence"] {
  if (probability === null) return "Not rated";
  if (options.isExactScore) return "Low";
  if (options.coverageIsLimited) return probability >= 0.8 ? "Moderate" : "Low";
  if (probability >= 0.72) return "High";
  if (probability >= 0.58) return "Moderate";
  return "Low";
}

function confidenceReason(
  pick: ForensicsMarketPick,
  options: {
    basis: "odds" | "form";
    odds?: OddsExpectationReport | null;
    homeSamples: number;
    awaySamples: number;
    coverageIsLimited: boolean;
    formRate?: { label: string; rate: number | null };
  },
): string {
  const price = pick.probability === null ? "not modelled" : percentage(pick.probability);
  const source = options.basis === "odds" && options.odds
    ? `Odds-implied: ${price} across ${options.odds.marketSourceCount} markets.`
    : `Form model: ${price} from ${options.homeSamples} + ${options.awaySamples} matches.`;
  const agreement = options.formRate && options.formRate.rate !== null
    ? ` Form agrees: ${options.formRate.label} in ${percentage(options.formRate.rate)} of sampled matches.`
    : "";
  const coverageLine = options.coverageIsLimited ? " Thin sample coverage caps confidence." : "";
  return `${source}${agreement}${coverageLine}`;
}

function card(args: {
  title: string;
  group: ForensicsMarketGroup;
  pick: string;
  probability: number | null;
  alternative: Candidate | null;
  details: string;
  basis: "odds" | "form";
  odds?: OddsExpectationReport | null;
  source: ForensicsMarketSource;
  isExactScore?: boolean;
  formRate?: { label: string; rate: number | null };
  historicalFrequency?: number;
}): ForensicsMarketPick {
  const coverageIsLimited = args.basis === "form" &&
    Math.min(args.source.home.matchesAnalyzed, args.source.away.matchesAnalyzed) < 6;
  const base: ForensicsMarketPick = {
    title: args.title,
    pick: args.pick,
    details: args.details,
    probability: args.probability,
    alternative: args.alternative
      ? `${args.alternative.label} ${percentage(args.alternative.probability)}`
      : null,
    confidence: confidenceFor(args.probability, {
      basis: args.basis,
      coverageIsLimited,
      isExactScore: args.isExactScore,
    }),
    confidenceReason: "",
    historicalFrequency: args.historicalFrequency,
    basis: args.basis,
    group: args.group,
  };
  return {
    ...base,
    confidenceReason: confidenceReason(base, {
      basis: args.basis,
      odds: args.odds,
      homeSamples: args.source.home.matchesAnalyzed,
      awaySamples: args.source.away.matchesAnalyzed,
      coverageIsLimited,
      formRate: args.formRate,
    }),
  };
}

function others(candidates: Candidate[], leader: Candidate): Candidate | null {
  const rest = candidates.filter((candidate) => candidate.label !== leader.label);
  return rest.length ? best(rest) : null;
}

export function buildForensicsMarketPicks(
  source: ForensicsMarketSource,
  odds?: OddsExpectationReport | null,
): ForensicsMarketPick[] {
  const home = source.home;
  const away = source.away;
  const gridFromOdds = odds ? oddsGrid(odds) : null;
  const grid = gridFromOdds ?? formGrid(home, away);
  if (!grid) return [];
  const basis: "odds" | "form" = gridFromOdds ? "odds" : "form";

  const homeName = home.teamName;
  const awayName = away.teamName;
  const totalMatches = home.matchesAnalyzed + away.matchesAnalyzed;
  const shared = {
    basis,
    odds: gridFromOdds ? odds : null,
    source,
  };

  const homeWin = probabilityWhere(grid, (h, a) => h > a);
  const draw = probabilityWhere(grid, (h, a) => h === a);
  const awayWin = probabilityWhere(grid, (h, a) => h < a);
  const resultOptions: Candidate[] = [
    { label: `${homeName} win`, probability: homeWin },
    { label: "Draw", probability: draw },
    { label: `${awayName} win`, probability: awayWin },
  ];
  const resultLeader = best(resultOptions);

  const doubleChanceOptions: Candidate[] = [
    { label: `${homeName} or draw`, probability: homeWin + draw },
    { label: `Draw or ${awayName}`, probability: draw + awayWin },
    { label: `${homeName} or ${awayName}`, probability: homeWin + awayWin },
  ];
  const doubleChanceLeader = best(doubleChanceOptions);

  const awayWithheld = homeWin + awayWin;
  const dnbOptions: Candidate[] = [
    {
      label: `${homeName} (draw no bet)`,
      probability: awayWithheld > 0 ? homeWin / awayWithheld : 0.5,
    },
    {
      label: `${awayName} (draw no bet)`,
      probability: awayWithheld > 0 ? awayWin / awayWithheld : 0.5,
    },
  ];
  const dnbLeader = best(dnbOptions);

  const bttsYes = probabilityWhere(grid, (h, a) => h > 0 && a > 0);
  const bttsOptions: Candidate[] = [
    { label: "Yes", probability: bttsYes },
    { label: "No", probability: 1 - bttsYes },
  ];
  const bttsLeader = best(bttsOptions);
  const bttsRate = sampleRate(home.bttsMatches + away.bttsMatches, totalMatches);

  const overUnder = (line: number): { leader: Candidate; alternative: Candidate; over: number; rate: number | null; matches: number } => {
    const over = probabilityWhere(grid, (h, a) => h + a > line);
    const options: Candidate[] = [
      { label: `Over ${line.toFixed(1)}`, probability: over },
      { label: `Under ${line.toFixed(1)}`, probability: 1 - over },
    ];
    const leader = best(options);
    const alternative = options.find((option) => option.label !== leader.label) ?? options[0];
    const matches = line === 2.5
      ? home.over25Matches + away.over25Matches
      : line === 3.5
        ? home.over35Matches + away.over35Matches
        : null;
    return {
      leader,
      alternative,
      over,
      rate: matches === null ? null : sampleRate(matches, totalMatches),
      matches: matches ?? 0,
    };
  };

  const homeOver15 = probabilityWhere(grid, (h) => h > 1.5);
  const awayOver15 = probabilityWhere(grid, (_h, a) => a > 1.5);
  const homeCleanSheet = probabilityWhere(grid, (_h, a) => a === 0);
  const awayCleanSheet = probabilityWhere(grid, (h) => h === 0);
  const homeWinToNil = probabilityWhere(grid, (h, a) => h > a && a === 0);
  const awayWinToNil = probabilityWhere(grid, (h, a) => a > h && h === 0);
  const homeMinusOne = probabilityWhere(grid, (h, a) => h - a >= 2);
  const oddTotal = probabilityWhere(grid, (h, a) => (h + a) % 2 === 1);

  const scorelineCells: { home: number; away: number; probability: number }[] = [];
  grid.forEach((row, homeGoals) =>
    row.forEach((probability, awayGoals) => {
      if (homeGoals >= GOAL_CAP || awayGoals >= GOAL_CAP) return;
      scorelineCells.push({ home: homeGoals, away: awayGoals, probability });
    }),
  );
  scorelineCells.sort((left, right) => right.probability - left.probability);
  const topScores = scorelineCells.slice(0, 3);

  const line15 = overUnder(1.5);
  const line25 = overUnder(2.5);
  const line35 = overUnder(3.5);

  const cards: ForensicsMarketPick[] = [
    card({
      title: "1X2 · match result",
      group: "Result",
      pick: resultLeader.label,
      probability: resultLeader.probability,
      alternative: others(resultOptions, resultLeader),
      details: `${homeName} ${percentage(homeWin)} · draw ${percentage(draw)} · ${awayName} ${percentage(awayWin)}.`,
      ...shared,
    }),
    card({
      title: "Double chance",
      group: "Result",
      pick: doubleChanceLeader.label,
      probability: doubleChanceLeader.probability,
      alternative: others(doubleChanceOptions, doubleChanceLeader),
      details: doubleChanceOptions
        .map((option) => `${option.label} ${percentage(option.probability)}`)
        .join(" · "),
      ...shared,
    }),
    card({
      title: "Draw no bet",
      group: "Result",
      pick: dnbLeader.label,
      probability: dnbLeader.probability,
      alternative: others(dnbOptions, dnbLeader),
      details: `Draws removed: ${homeName} ${percentage(dnbOptions[0].probability)} vs ${awayName} ${percentage(dnbOptions[1].probability)}.`,
      ...shared,
    }),
    card({
      title: "Both teams to score",
      group: "Goals",
      pick: bttsLeader.label,
      probability: bttsLeader.probability,
      alternative: others(bttsOptions, bttsLeader),
      details: `Yes ${percentage(bttsYes)} · no ${percentage(1 - bttsYes)}.`,
      formRate: { label: "both teams scored", rate: bttsRate },
      historicalFrequency: bttsRate ?? undefined,
      ...shared,
    }),
    card({
      title: "Goals · 1.5",
      group: "Goals",
      pick: line15.leader.label,
      probability: line15.leader.probability,
      alternative: line15.alternative,
      details: `Over ${percentage(line15.over)} · under ${percentage(1 - line15.over)}.`,
      ...shared,
    }),
    card({
      title: "Goals · 2.5",
      group: "Goals",
      pick: line25.leader.label,
      probability: line25.leader.probability,
      alternative: line25.alternative,
      details: `Over ${percentage(line25.over)} · under ${percentage(1 - line25.over)}.`,
      formRate: { label: "over 2.5 goals", rate: line25.rate },
      historicalFrequency: line25.rate ?? undefined,
      ...shared,
    }),
    card({
      title: "Goals · 3.5",
      group: "Goals",
      pick: line35.leader.label,
      probability: line35.leader.probability,
      alternative: line35.alternative,
      details: `Over ${percentage(line35.over)} · under ${percentage(1 - line35.over)}.`,
      formRate: { label: "over 3.5 goals", rate: line35.rate },
      historicalFrequency: line35.rate ?? undefined,
      ...shared,
    }),
    card({
      title: "Total goals · odd/even",
      group: "Goals",
      pick: oddTotal >= 0.5 ? "Odd" : "Even",
      probability: oddTotal >= 0.5 ? oddTotal : 1 - oddTotal,
      alternative: {
        label: oddTotal >= 0.5 ? "Even" : "Odd",
        probability: oddTotal >= 0.5 ? 1 - oddTotal : oddTotal,
      },
      details: `Odd ${percentage(oddTotal)} · even ${percentage(1 - oddTotal)}.`,
      ...shared,
    }),
    card({
      title: `${homeName} goals · 1.5`,
      group: "Team",
      pick: homeOver15 >= 0.5 ? "Over 1.5" : "Under 1.5",
      probability: homeOver15 >= 0.5 ? homeOver15 : 1 - homeOver15,
      alternative: {
        label: homeOver15 >= 0.5 ? "Under 1.5" : "Over 1.5",
        probability: homeOver15 >= 0.5 ? 1 - homeOver15 : homeOver15,
      },
      details: `Over 1.5 ${percentage(homeOver15)} · under 1.5 ${percentage(1 - homeOver15)}.`,
      ...shared,
    }),
    card({
      title: `${awayName} goals · 1.5`,
      group: "Team",
      pick: awayOver15 >= 0.5 ? "Over 1.5" : "Under 1.5",
      probability: awayOver15 >= 0.5 ? awayOver15 : 1 - awayOver15,
      alternative: {
        label: awayOver15 >= 0.5 ? "Under 1.5" : "Over 1.5",
        probability: awayOver15 >= 0.5 ? 1 - awayOver15 : awayOver15,
      },
      details: `Over 1.5 ${percentage(awayOver15)} · under 1.5 ${percentage(1 - awayOver15)}.`,
      ...shared,
    }),
    card({
      title: `Clean sheet · ${homeName}`,
      group: "Team",
      pick: homeCleanSheet >= 0.5 ? "Yes" : "No",
      probability: homeCleanSheet >= 0.5 ? homeCleanSheet : 1 - homeCleanSheet,
      alternative: {
        label: homeCleanSheet >= 0.5 ? "No" : "Yes",
        probability: homeCleanSheet >= 0.5 ? 1 - homeCleanSheet : homeCleanSheet,
      },
      details: `Yes ${percentage(homeCleanSheet)} · no ${percentage(1 - homeCleanSheet)}.`,
      ...shared,
    }),
    card({
      title: `Clean sheet · ${awayName}`,
      group: "Team",
      pick: awayCleanSheet >= 0.5 ? "Yes" : "No",
      probability: awayCleanSheet >= 0.5 ? awayCleanSheet : 1 - awayCleanSheet,
      alternative: {
        label: awayCleanSheet >= 0.5 ? "No" : "Yes",
        probability: awayCleanSheet >= 0.5 ? 1 - awayCleanSheet : awayCleanSheet,
      },
      details: `Yes ${percentage(awayCleanSheet)} · no ${percentage(1 - awayCleanSheet)}.`,
      ...shared,
    }),
    card({
      title: "Win to nil",
      group: "Result",
      pick: homeWinToNil >= awayWinToNil ? `${homeName} to nil` : `${awayName} to nil`,
      probability: Math.max(homeWinToNil, awayWinToNil),
      alternative: {
        label: homeWinToNil >= awayWinToNil ? `${awayName} to nil` : `${homeName} to nil`,
        probability: Math.min(homeWinToNil, awayWinToNil),
      },
      details: `${homeName} ${percentage(homeWinToNil)} · ${awayName} ${percentage(awayWinToNil)}.`,
      ...shared,
    }),
    card({
      title: `Handicap · ${homeName} -1`,
      group: "Team",
      pick: homeMinusOne >= 0.5 ? `${homeName} -1` : `${awayName} +1`,
      probability: homeMinusOne >= 0.5 ? homeMinusOne : 1 - homeMinusOne,
      alternative: {
        label: homeMinusOne >= 0.5 ? `${awayName} +1` : `${homeName} -1`,
        probability: homeMinusOne >= 0.5 ? 1 - homeMinusOne : homeMinusOne,
      },
      details: `${homeName} by 2+ ${percentage(homeMinusOne)} · otherwise ${percentage(1 - homeMinusOne)}.`,
      ...shared,
    }),
    card({
      title: "Correct score",
      group: "Score",
      pick: `${topScores[0].home}–${topScores[0].away}`,
      probability: topScores[0].probability,
      alternative: {
        label: `${topScores[1].home}–${topScores[1].away}`,
        probability: topScores[1].probability,
      },
      details: `Most likely scorelines: ${topScores
        .map((score) => `${score.home}-${score.away} ${percentage(score.probability)}`)
        .join(" · ")}.`,
      isExactScore: true,
      ...shared,
    }),
  ];

  return cards;
}

/** Highest-probability market outside exact scorelines; the "strongest pick" strip. */
export function strongestForensicsPick(
  picks: ForensicsMarketPick[],
): ForensicsMarketPick | null {
  const comparable = picks.filter(
    (pick) =>
      pick.group !== "Score" &&
      pick.title !== "Total goals · odd/even" &&
      pick.probability !== null,
  );
  // A 51/49 coin-flip market is not a pick, so prefer a real edge first.
  const decisive = comparable.filter((pick) => (pick.probability ?? 0) >= 0.6);
  const candidates = decisive.length ? decisive : comparable;
  if (!candidates.length) return null;
  return candidates.reduce((leader, pick) =>
    (pick.probability ?? 0) > (leader.probability ?? 0) ? pick : leader,
  );
}

