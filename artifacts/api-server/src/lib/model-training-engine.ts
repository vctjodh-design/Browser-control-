import * as tf from "@tensorflow/tfjs";
import type {
  FootballModelType,
  FootballModelTrainingInput,
} from "@workspace/api-zod";
import type {
  ModelTrainingMatch,
  ModelTrainingContext,
  TesterPredictionTarget,
} from "./processed-match-store";

const OUTCOME_INDEX = { home: 0, draw: 1, away: 2 } as const;
const BASE_TEAM_EVENT_FEATURES = 7;
const MATCH_CONTEXT_FEATURES = 9;
const TEAM_EVENT_FEATURES = BASE_TEAM_EVENT_FEATURES + MATCH_CONTEXT_FEATURES;
const SEQUENCE_FEATURES = TEAM_EVENT_FEATURES * 2 + 1;
const GRAPH_NODE_COUNT = 4;
const SCORE_BUCKET_COUNT = 6;

const MARKET_HEADS = [
  { name: "result", classes: 3 },
  { name: "bothTeamsToScore", classes: 2 },
  { name: "overUnder25", classes: 2 },
  { name: "overUnder35", classes: 2 },
  { name: "correctScore", classes: SCORE_BUCKET_COUNT * SCORE_BUCKET_COUNT },
] as const;

type MarketHeadName = (typeof MARKET_HEADS)[number]["name"];

type VerifiedOdds = {
  home: number;
  draw: number;
  away: number;
};

type TeamGame = {
  fixtureId: number;
  calendarDate: string;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheet: number;
  odds: VerifiedOdds | null;
  expectedPoints: number | null;
};

type NeighborEdge = { opponent: string; calendarDate: string };

type TrainingExample = {
  sequence: number[];
  graph: number[];
  graphAdjacency: number[];
  labels: Record<MarketHeadName, number>;
  hasPriorVerifiedOdds: boolean;
};

export type TrainingWeights = Array<{ shape: number[]; values: number[] }>;
export type ModelPredictorArtifact = {
  version: 2;
  weights: TrainingWeights;
  normalization: {
    means: number[];
    scales: number[];
    positionsPerSample: number;
  };
};

export type ModelTrainingResult = {
  sampleCount: number;
  trainingSampleCount: number;
  validationSampleCount: number;
  verifiedOddsFixtureCount: number;
  accuracy: number;
  baselineAccuracy: number;
  logLoss: number;
  brierScore: number;
  confusionMatrix: number[][];
  trainingLoss: number[];
  validationLoss: number[];
  predictorArtifact: ModelPredictorArtifact;
};

export type ArchivedModelPrediction = {
  result: { home: number; draw: number; away: number };
  bothTeamsToScore: { yes: number; no: number };
  overUnder25: { over: number; under: number };
  overUnder35: { over: number; under: number };
  correctScoreTop: Array<{ scoreline: string; probability: number }>;
  historyMatchCount: number;
  verifiedOddsHistoryCount: number;
};

type EpochProgress = (
  completedEpochs: number,
  trainingLoss: number[],
  validationLoss: number[],
) => void;

function normalizeTeamName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseVerifiedOdds(matches: ModelTrainingMatch[]): Map<number, VerifiedOdds> {
  const byFixture = new Map<number, VerifiedOdds[]>();
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match.tmpJson) as {
        oddsHistory?: Array<{
          fixtureId?: number;
          homeProbability?: number | null;
          drawProbability?: number | null;
          awayProbability?: number | null;
          verifiedBookmakerCount?: number;
          quoteSource?: string;
        }>;
      };
      for (const quote of parsed.oddsHistory ?? []) {
        const probabilities = [
          quote.homeProbability,
          quote.drawProbability,
          quote.awayProbability,
        ];
        if (
          !Number.isSafeInteger(quote.fixtureId) ||
          quote.quoteSource !== "verified" ||
          !quote.verifiedBookmakerCount ||
          probabilities.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)
        ) {
          continue;
        }
        const [home, draw, away] = probabilities as number[];
        const total = home + draw + away;
        if (total < 0.98 || total > 1.02) continue;
        const list = byFixture.get(quote.fixtureId as number) ?? [];
        list.push({ home: home / total, draw: draw / total, away: away / total });
        byFixture.set(quote.fixtureId as number, list);
      }
    } catch {
      // Older or incomplete payloads remain usable as score-only history.
    }
  }

  const result = new Map<number, VerifiedOdds>();
  for (const [fixtureId, quotes] of byFixture) {
    const count = quotes.length;
    result.set(fixtureId, {
      home: quotes.reduce((sum, quote) => sum + quote.home, 0) / count,
      draw: quotes.reduce((sum, quote) => sum + quote.draw, 0) / count,
      away: quotes.reduce((sum, quote) => sum + quote.away, 0) / count,
    });
  }
  return result;
}

function buildTeamGame(
  match: ModelTrainingMatch,
  teamName: string,
  oddsByFixture: Map<number, VerifiedOdds>,
): TeamGame {
  const isHome = normalizeTeamName(match.homeTeamName) === normalizeTeamName(teamName);
  const goalsFor = isHome ? match.homeScore : match.awayScore;
  const goalsAgainst = isHome ? match.awayScore : match.homeScore;
  const odds = oddsByFixture.get(match.fixtureId) ?? null;
  const winProbability = odds ? (isHome ? odds.home : odds.away) : null;
  const expectedPoints = odds && winProbability !== null
    ? (3 * winProbability + odds.draw) / 3
    : null;

  return {
    fixtureId: match.fixtureId,
    calendarDate: match.calendarDate,
    points: goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0,
    goalsFor,
    goalsAgainst,
    cleanSheet: goalsAgainst === 0 ? 1 : 0,
    odds,
    expectedPoints,
  };
}

function teamEventFeatures(game: TeamGame | null): number[] {
  if (!game) return Array(BASE_TEAM_EVENT_FEATURES).fill(0);
  return [
    game.points / 3,
    Math.min(game.goalsFor, 5) / 5,
    Math.min(game.goalsAgainst, 5) / 5,
    game.cleanSheet,
    game.expectedPoints ?? 0,
    game.odds?.draw ?? 0,
    game.odds ? 1 : 0,
  ];
}

function modelContextMatches(
  context: ModelTrainingContext,
  side: "home" | "away",
  targetDate: string,
  limit: number,
) {
  const targetTeamName =
    side === "home" ? context.homeTeamName : context.awayTeamName;
  const recent = side === "home" ? context.homeRecent : context.awayRecent;
  const cutoff = Date.parse(targetDate);
  const seen = new Set<number>();
  return recent
    .filter((match) => {
      const date = Date.parse(match.date);
      if (
        !Number.isFinite(date) ||
        !Number.isFinite(cutoff) ||
        date >= cutoff ||
        match.fixtureId === 0 ||
        seen.has(match.fixtureId)
      ) {
        return false;
      }
      seen.add(match.fixtureId);
      return match.homeScore !== null && match.awayScore !== null;
    })
    .sort((first, second) => Date.parse(second.date) - Date.parse(first.date))
    .slice(0, limit)
    .map((match) => {
      const isHome =
        normalizeTeamName(match.homeTeamName) === normalizeTeamName(targetTeamName);
      const goalsFor = isHome ? match.homeScore! : match.awayScore!;
      const goalsAgainst = isHome ? match.awayScore! : match.homeScore!;
      return {
        goalsFor,
        goalsAgainst,
        points: goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0,
      };
    });
}

function matchContextFeatures(
  match: ModelTrainingMatch,
  side: "home" | "away",
): number[] {
  const recent = modelContextMatches(match.trainingContext, side, match.matchDate, 15);
  const lastFiveRaw = side === "home"
    ? match.trainingContext.homeLastFive
    : match.trainingContext.awayLastFive;
  const targetName = side === "home"
    ? match.trainingContext.homeTeamName
    : match.trainingContext.awayTeamName;
  const cutoff = Date.parse(match.matchDate);
  const lastFive = lastFiveRaw
    .filter((item) => {
      const date = Date.parse(item.date);
      return (
        Number.isFinite(date) &&
        Number.isFinite(cutoff) &&
        date < cutoff &&
        item.homeScore !== null &&
        item.awayScore !== null
      );
    })
    .slice(0, 5)
    .map((item) => {
      const isHome =
        targetName === null ||
        normalizeTeamName(item.homeTeamName) === normalizeTeamName(targetName);
      return {
        goalsFor: isHome ? item.homeScore! : item.awayScore!,
        goalsAgainst: isHome ? item.awayScore! : item.homeScore!,
      };
    });
  const totalGoalsFor = recent.reduce((sum, item) => sum + item.goalsFor, 0);
  const totalGoalsAgainst = recent.reduce((sum, item) => sum + item.goalsAgainst, 0);
  const wins = recent.filter((item) => item.points === 3).length;
  const draws = recent.filter((item) => item.points === 1).length;
  const losses = recent.filter((item) => item.points === 0).length;
  const overallTmp =
    100 + 18 * wins + 8 * draws - 6 * losses + 4 * (totalGoalsFor - totalGoalsAgainst);
  const averageFor = recent.length ? totalGoalsFor / recent.length : 0;
  const averageAgainst = recent.length ? totalGoalsAgainst / recent.length : 0;
  const standing = side === "home"
    ? match.trainingContext.homeStanding
    : match.trainingContext.awayStanding;
  const standingGames = standing?.played ?? 0;
  const lastFiveGoalsFor = lastFive.reduce((sum, item) => sum + item.goalsFor, 0);
  const lastFiveGoalsAgainst = lastFive.reduce((sum, item) => sum + item.goalsAgainst, 0);

  return [
    recent.length ? overallTmp / 100 : 0,
    recent.length ? (100 + 4 * averageFor - 100) / 100 : 0,
    recent.length ? (100 - 4 * averageAgainst - 100) / 100 : 0,
    lastFive.length ? lastFiveGoalsFor / lastFive.length / 5 : 0,
    lastFive.length ? lastFiveGoalsAgainst / lastFive.length / 5 : 0,
    standing && match.trainingContext.standingTeamCount
      ? standing.rank / match.trainingContext.standingTeamCount
      : 0,
    standingGames ? standing!.points / standingGames / 3 : 0,
    standingGames ? standing!.goalDifference / standingGames / 5 : 0,
    match.leagueAverageGoals === null ? 0 : match.leagueAverageGoals / 5,
  ];
}

function sequenceFeatures(
  homeHistory: TeamGame[],
  awayHistory: TeamGame[],
  sequenceLength: number,
  match: ModelTrainingMatch,
): number[] {
  const home = homeHistory.slice(-sequenceLength);
  const away = awayHistory.slice(-sequenceLength);
  const homePadding = sequenceLength - home.length;
  const awayPadding = sequenceLength - away.length;
  const features: number[] = [];

  for (let index = 0; index < sequenceLength; index += 1) {
    const homeGame = index < homePadding ? null : home[index - homePadding];
    const awayGame = index < awayPadding ? null : away[index - awayPadding];
    features.push(
      ...teamEventFeatures(homeGame),
      ...(index === sequenceLength - 1
        ? matchContextFeatures(match, "home")
        : Array(MATCH_CONTEXT_FEATURES).fill(0)),
      ...teamEventFeatures(awayGame),
      ...(index === sequenceLength - 1
        ? matchContextFeatures(match, "away")
        : Array(MATCH_CONTEXT_FEATURES).fill(0)),
      (index + 1) / sequenceLength,
    );
  }
  return features;
}

function teamSummary(history: TeamGame[], sequenceLength: number): number[] {
  const recent = history.slice(-sequenceLength);
  if (!recent.length) return Array(BASE_TEAM_EVENT_FEATURES).fill(0);
  const oddsGames = recent.filter((game) => game.odds && game.expectedPoints !== null);
  return [
    recent.reduce((sum, game) => sum + game.points / 3, 0) / recent.length,
    recent.reduce((sum, game) => sum + Math.min(game.goalsFor, 5) / 5, 0) / recent.length,
    recent.reduce((sum, game) => sum + Math.min(game.goalsAgainst, 5) / 5, 0) / recent.length,
    recent.reduce((sum, game) => sum + game.cleanSheet, 0) / recent.length,
    oddsGames.length
      ? oddsGames.reduce((sum, game) => sum + (game.expectedPoints ?? 0), 0) / oddsGames.length
      : 0,
    oddsGames.length
      ? oddsGames.reduce((sum, game) => sum + (game.odds?.draw ?? 0), 0) / oddsGames.length
      : 0,
    oddsGames.length / recent.length,
  ];
}

function neighborSummary(
  nodeKey: string,
  scopeEdges: Map<string, NeighborEdge[]>,
  histories: Map<string, TeamGame[]>,
  targetDate: string,
  sequenceLength: number,
  dynamic: boolean,
): number[] {
  const edges = scopeEdges.get(nodeKey) ?? [];
  const latestByOpponent = new Map<string, string>();
  for (const edge of edges) {
    if (edge.calendarDate >= targetDate) continue;
    const previous = latestByOpponent.get(edge.opponent);
    if (!previous || edge.calendarDate > previous) {
      latestByOpponent.set(edge.opponent, edge.calendarDate);
    }
  }
  if (!latestByOpponent.size) return Array(TEAM_EVENT_FEATURES).fill(0);

  const samples: Array<{ values: number[]; weight: number }> = [];
  const targetTime = Date.parse(`${targetDate}T00:00:00.000Z`);
  for (const [opponent, edgeDate] of latestByOpponent) {
    const history = histories.get(opponent) ?? [];
    if (!history.length) continue;
    const ageDays = Math.max(0, (targetTime - Date.parse(`${edgeDate}T00:00:00.000Z`)) / 86_400_000);
    const weight = dynamic ? Math.exp(-ageDays / 180) : 1;
    samples.push({ values: teamSummary(history, sequenceLength), weight });
  }
  if (!samples.length) return Array(BASE_TEAM_EVENT_FEATURES).fill(0);

  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  return Array.from({ length: BASE_TEAM_EVENT_FEATURES }, (_, index) =>
    samples.reduce((sum, sample) => sum + sample.values[index] * sample.weight, 0) / totalWeight,
  );
}

function neighborEdgeWeight(
  nodeKey: string,
  scopeEdges: Map<string, NeighborEdge[]>,
  targetDate: string,
  dynamic: boolean,
): number {
  let latestDate: string | null = null;
  for (const edge of scopeEdges.get(nodeKey) ?? []) {
    if (edge.calendarDate >= targetDate) continue;
    if (!latestDate || edge.calendarDate > latestDate) latestDate = edge.calendarDate;
  }
  if (!latestDate) return 0;
  if (!dynamic) return 1;
  const ageDays = Math.max(
    0,
    (Date.parse(`${targetDate}T00:00:00.000Z`) -
      Date.parse(`${latestDate}T00:00:00.000Z`)) /
      86_400_000,
  );
  return Math.exp(-ageDays / 180);
}

function graphFeatures(
  match: ModelTrainingMatch,
  homeHistory: TeamGame[],
  awayHistory: TeamGame[],
  histories: Map<string, TeamGame[]>,
  scopeEdges: Map<string, NeighborEdge[]>,
  sequenceLength: number,
  dynamic: boolean,
): { nodes: number[]; adjacency: number[] } {
  const homeNodeKey = `${match.competition.toLocaleLowerCase()}|${match.season ?? "unknown"}|${normalizeTeamName(match.homeTeamName)}`;
  const awayNodeKey = `${match.competition.toLocaleLowerCase()}|${match.season ?? "unknown"}|${normalizeTeamName(match.awayTeamName)}`;
  const home = [
    ...teamSummary(homeHistory, sequenceLength),
    ...matchContextFeatures(match, "home"),
  ];
  const away = [
    ...teamSummary(awayHistory, sequenceLength),
    ...matchContextFeatures(match, "away"),
  ];
  const homeNeighbors = neighborSummary(
    homeNodeKey,
    scopeEdges,
    histories,
    match.calendarDate,
    sequenceLength,
    dynamic,
  );
  const awayNeighbors = neighborSummary(
    awayNodeKey,
    scopeEdges,
    histories,
    match.calendarDate,
    sequenceLength,
    dynamic,
  );
  const emptyContext = Array(MATCH_CONTEXT_FEATURES).fill(0);
  const nodes = [
    ...home,
    ...away,
    ...homeNeighbors,
    ...emptyContext,
    ...awayNeighbors,
    ...emptyContext,
  ];
  const adjacency: number[][] = Array.from(
    { length: GRAPH_NODE_COUNT },
    (_, row) => Array.from({ length: GRAPH_NODE_COUNT }, (_, column) =>
      row === column ? 1 : 0,
    ),
  );
  adjacency[0][1] = 1;
  adjacency[1][0] = 1;
  const homeNeighborWeight = neighborEdgeWeight(
    homeNodeKey,
    scopeEdges,
    match.calendarDate,
    dynamic,
  );
  const awayNeighborWeight = neighborEdgeWeight(
    awayNodeKey,
    scopeEdges,
    match.calendarDate,
    dynamic,
  );
  adjacency[0][2] = homeNeighborWeight;
  adjacency[2][0] = homeNeighborWeight;
  adjacency[1][3] = awayNeighborWeight;
  adjacency[3][1] = awayNeighborWeight;
  for (const row of adjacency) {
    const degree = row.reduce((sum, weight) => sum + weight, 0);
    for (let index = 0; index < row.length; index += 1) {
      row[index] /= degree;
    }
  }
  return { nodes, adjacency: adjacency.flat() };
}

function labelsFor(match: ModelTrainingMatch): Record<MarketHeadName, number> {
  const totalGoals = match.homeScore + match.awayScore;
  return {
    result: match.homeScore > match.awayScore
      ? OUTCOME_INDEX.home
      : match.homeScore === match.awayScore
        ? OUTCOME_INDEX.draw
        : OUTCOME_INDEX.away,
    bothTeamsToScore: match.homeScore > 0 && match.awayScore > 0 ? 1 : 0,
    overUnder25: totalGoals >= 3 ? 1 : 0,
    overUnder35: totalGoals >= 4 ? 1 : 0,
    correctScore:
      Math.min(SCORE_BUCKET_COUNT - 1, match.homeScore) * SCORE_BUCKET_COUNT +
      Math.min(SCORE_BUCKET_COUNT - 1, match.awayScore),
  };
}

function buildTrainingExamples(
  matches: ModelTrainingMatch[],
  modelType: FootballModelType,
  sequenceLength: number,
): TrainingExample[] {
  const oddsByFixture = parseVerifiedOdds(matches);
  const histories = new Map<string, TeamGame[]>();
  const scopeEdges = new Map<string, NeighborEdge[]>();
  const examples: TrainingExample[] = [];

  for (let start = 0; start < matches.length;) {
    const date = matches[start].calendarDate;
    let end = start + 1;
    while (end < matches.length && matches[end].calendarDate === date) end += 1;
    const dayMatches = matches.slice(start, end);

    for (const match of dayMatches) {
      const homeKey = normalizeTeamName(match.homeTeamName);
      const awayKey = normalizeTeamName(match.awayTeamName);
      const homeHistory = histories.get(homeKey) ?? [];
      const awayHistory = histories.get(awayKey) ?? [];
      const oddsInPriorForm = [...homeHistory, ...awayHistory]
        .some((game) => game.odds !== null);
      const graph = graphFeatures(
        match,
        homeHistory,
        awayHistory,
        histories,
        scopeEdges,
        sequenceLength,
        modelType === "dynamic-graph",
      );
      examples.push({
        sequence: sequenceFeatures(homeHistory, awayHistory, sequenceLength, match),
        graph: graph.nodes,
        graphAdjacency: graph.adjacency,
        labels: labelsFor(match),
        hasPriorVerifiedOdds: oddsInPriorForm,
      });
    }

    for (const match of dayMatches) {
      const homeKey = normalizeTeamName(match.homeTeamName);
      const awayKey = normalizeTeamName(match.awayTeamName);
      const homeHistory = histories.get(homeKey) ?? [];
      const awayHistory = histories.get(awayKey) ?? [];
      homeHistory.push(buildTeamGame(match, match.homeTeamName, oddsByFixture));
      awayHistory.push(buildTeamGame(match, match.awayTeamName, oddsByFixture));
      histories.set(homeKey, homeHistory);
      histories.set(awayKey, awayHistory);

      const scope = `${match.competition.toLocaleLowerCase()}|${match.season ?? "unknown"}`;
      const homeNodeKey = `${scope}|${homeKey}`;
      const awayNodeKey = `${scope}|${awayKey}`;
      const homeEdges = scopeEdges.get(homeNodeKey) ?? [];
      const awayEdges = scopeEdges.get(awayNodeKey) ?? [];
      homeEdges.push({ opponent: awayKey, calendarDate: match.calendarDate });
      awayEdges.push({ opponent: homeKey, calendarDate: match.calendarDate });
      scopeEdges.set(homeNodeKey, homeEdges);
      scopeEdges.set(awayNodeKey, awayEdges);
    }
    start = end;
  }

  return examples;
}

function fitNormalization(
  rows: number[][],
  trainingSampleCount: number,
  featureCount: number,
  positionsPerSample: number,
): ModelPredictorArtifact["normalization"] {
  const means = Array(featureCount).fill(0) as number[];
  const squares = Array(featureCount).fill(0) as number[];
  const divisor = Math.max(1, trainingSampleCount * positionsPerSample);

  for (let sample = 0; sample < trainingSampleCount; sample += 1) {
    for (let position = 0; position < positionsPerSample; position += 1) {
      for (let feature = 0; feature < featureCount; feature += 1) {
        const value = rows[sample][position * featureCount + feature];
        means[feature] += value / divisor;
        squares[feature] += value * value / divisor;
      }
    }
  }

  const scales = means.map((mean, index) => Math.sqrt(Math.max(1e-6, squares[index] - mean * mean)));
  return { means, scales, positionsPerSample };
}

function normalizeRows(
  rows: number[][],
  normalization: ModelPredictorArtifact["normalization"],
): number[][] {
  const featureCount = normalization.means.length;
  return rows.map((row) => {
    const normalized = [...row];
    for (let position = 0; position < normalization.positionsPerSample; position += 1) {
      for (let feature = 0; feature < featureCount; feature += 1) {
        const index = position * featureCount + feature;
        normalized[index] =
          (row[index] - normalization.means[feature]) /
          normalization.scales[feature];
      }
    }
    return normalized;
  });
}

function graphConvolutionFeatures(
  nodes: tf.SymbolicTensor,
  adjacency: tf.SymbolicTensor,
  hiddenUnits: number,
): tf.SymbolicTensor {
  const firstMessages = tf.layers.dot({ axes: [2, 1] }).apply([
    adjacency,
    nodes,
  ]) as tf.SymbolicTensor;
  const firstSelf = tf.layers
    .dense({ units: hiddenUnits, activation: "relu" })
    .apply(nodes) as tf.SymbolicTensor;
  const firstNeighbor = tf.layers
    .dense({ units: hiddenUnits, activation: "relu", useBias: false })
    .apply(firstMessages) as tf.SymbolicTensor;
  const firstUpdate = tf.layers
    .add()
    .apply([firstSelf, firstNeighbor]) as tf.SymbolicTensor;

  const secondMessages = tf.layers.dot({ axes: [2, 1] }).apply([
    adjacency,
    firstUpdate,
  ]) as tf.SymbolicTensor;
  const secondSelf = tf.layers
    .dense({ units: hiddenUnits, activation: "relu" })
    .apply(firstUpdate) as tf.SymbolicTensor;
  const secondNeighbor = tf.layers
    .dense({ units: hiddenUnits, activation: "relu", useBias: false })
    .apply(secondMessages) as tf.SymbolicTensor;
  const secondUpdate = tf.layers
    .add()
    .apply([secondSelf, secondNeighbor]) as tf.SymbolicTensor;
  const pooled = tf.layers
    .globalAveragePooling1d()
    .apply(secondUpdate) as tf.SymbolicTensor;
  return tf.layers
    .dense({ units: hiddenUnits, activation: "relu" })
    .apply(pooled) as tf.SymbolicTensor;
}

function attentionFeatures(
  input: tf.SymbolicTensor,
  hiddenUnits: number,
): tf.SymbolicTensor {
  const query = tf.layers.dense({ units: hiddenUnits, useBias: false }).apply(input) as tf.SymbolicTensor;
  const key = tf.layers.dense({ units: hiddenUnits, useBias: false }).apply(input) as tf.SymbolicTensor;
  const value = tf.layers.dense({ units: hiddenUnits }).apply(input) as tf.SymbolicTensor;
  const scores = tf.layers.dot({ axes: [2, 2] }).apply([query, key]) as tf.SymbolicTensor;
  const attention = tf.layers.activation({ activation: "softmax" }).apply(scores) as tf.SymbolicTensor;
  const context = tf.layers.dot({ axes: [2, 1] }).apply([attention, value]) as tf.SymbolicTensor;
  const pooled = tf.layers.globalAveragePooling1d().apply(context) as tf.SymbolicTensor;
  return tf.layers.dense({ units: hiddenUnits, activation: "relu" }).apply(pooled) as tf.SymbolicTensor;
}

function marketOutputs(representation: tf.SymbolicTensor): tf.SymbolicTensor[] {
  return MARKET_HEADS.map(({ name, classes }) =>
    tf.layers
      .dense({ units: classes, activation: "softmax", name })
      .apply(representation) as tf.SymbolicTensor,
  );
}

function createModel(
  modelType: FootballModelType,
  sequenceLength: number,
  hiddenUnits: number,
): tf.LayersModel {
  if (modelType === "lstm" || modelType === "gru") {
    const input = tf.input({ shape: [sequenceLength, SEQUENCE_FEATURES] });
    const recurrent = modelType === "lstm"
      ? tf.layers.lstm({ units: hiddenUnits }).apply(input) as tf.SymbolicTensor
      : tf.layers.gru({ units: hiddenUnits }).apply(input) as tf.SymbolicTensor;
    const representation = tf.layers
      .dense({ units: hiddenUnits, activation: "relu" })
      .apply(recurrent) as tf.SymbolicTensor;
    return tf.model({ inputs: input, outputs: marketOutputs(representation) });
  }
  if (modelType === "transformer") {
    const input = tf.input({ shape: [sequenceLength, SEQUENCE_FEATURES] });
    const representation = attentionFeatures(input, hiddenUnits);
    return tf.model({ inputs: input, outputs: marketOutputs(representation) });
  }
  if (modelType === "gnn" || modelType === "dynamic-graph") {
    const nodes = tf.input({
      shape: [GRAPH_NODE_COUNT, TEAM_EVENT_FEATURES],
      name: "team_nodes",
    });
    const adjacency = tf.input({
      shape: [GRAPH_NODE_COUNT, GRAPH_NODE_COUNT],
      name: "match_graph_adjacency",
    });
    const representation = graphConvolutionFeatures(nodes, adjacency, hiddenUnits);
    return tf.model({
      inputs: [nodes, adjacency],
      outputs: marketOutputs(representation),
    });
  }
  throw new Error(`Unsupported model type: ${modelType}`);
}

function oneHot(label: number, classes: number): number[] {
  return Array.from({ length: classes }, (_, index) => index === label ? 1 : 0);
}

function metricsFor(
  probabilities: number[][],
  actualLabels: number[],
  trainingLabels: number[],
) {
  const confusionMatrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let correct = 0;
  let logLoss = 0;
  let brierScore = 0;
  for (let index = 0; index < actualLabels.length; index += 1) {
    const actual = actualLabels[index];
    const predicted = probabilities[index].indexOf(Math.max(...probabilities[index]));
    confusionMatrix[actual][predicted] += 1;
    if (actual === predicted) correct += 1;
    logLoss -= Math.log(Math.max(1e-7, probabilities[index][actual]));
    for (let classIndex = 0; classIndex < 3; classIndex += 1) {
      const error = probabilities[index][classIndex] - (actual === classIndex ? 1 : 0);
      brierScore += error * error;
    }
  }
  const trainClassCounts = [0, 0, 0];
  for (const label of trainingLabels) trainClassCounts[label] += 1;
  const majorityLabel = trainClassCounts.indexOf(Math.max(...trainClassCounts));
  return {
    accuracy: correct / actualLabels.length,
    baselineAccuracy:
      actualLabels.filter((label) => label === majorityLabel).length /
      actualLabels.length,
    logLoss: logLoss / actualLabels.length,
    brierScore: brierScore / actualLabels.length,
    confusionMatrix,
  };
}

export async function trainArchivedModel(
  modelType: FootballModelType,
  input: FootballModelTrainingInput,
  matches: ModelTrainingMatch[],
  onEpoch: EpochProgress,
): Promise<ModelTrainingResult> {
  await tf.setBackend("cpu");
  await tf.ready();
  const sequenceLength = input.sequenceLength ?? 10;
  const hiddenUnits = input.hiddenUnits ?? 16;
  const epochs = input.epochs ?? 24;
  const examples = buildTrainingExamples(matches, modelType, sequenceLength);
  if (examples.length < 30) {
    throw new Error("At least 30 completed archive matches are needed to train and evaluate a model.");
  }

  const trainingSampleCount = Math.floor(examples.length * 0.8);
  const validationSampleCount = examples.length - trainingSampleCount;
  const sequenceModel = modelType === "lstm" || modelType === "gru" || modelType === "transformer";
  const graphModel = modelType === "gnn" || modelType === "dynamic-graph";
  const featureCount = sequenceModel ? SEQUENCE_FEATURES : TEAM_EVENT_FEATURES;
  const rawRows = examples.map((example) => sequenceModel ? example.sequence : example.graph);
  const normalization = fitNormalization(
    rawRows,
    trainingSampleCount,
    featureCount,
    sequenceModel ? sequenceLength : graphModel ? GRAPH_NODE_COUNT : 1,
  );
  const normalizedRows = normalizeRows(rawRows, normalization);
  const trainRows = normalizedRows.slice(0, trainingSampleCount);
  const validationRows = normalizedRows.slice(trainingSampleCount);
  const trainLabels = examples
    .slice(0, trainingSampleCount)
    .map((example) => example.labels.result);
  const validationLabels = examples
    .slice(trainingSampleCount)
    .map((example) => example.labels.result);
  const createTargets = (start: number, count: number) =>
    MARKET_HEADS.map(({ name, classes }) =>
      tf.tensor2d(
        examples
          .slice(start, start + count)
          .map((example) => oneHot(example.labels[name], classes)),
        [count, classes],
      ),
    );
  const trainTargets = createTargets(0, trainingSampleCount);
  const validationTargets = createTargets(trainingSampleCount, validationSampleCount);
  const inputSteps = sequenceModel ? sequenceLength : GRAPH_NODE_COUNT;
  const inputFeatures = sequenceModel ? SEQUENCE_FEATURES : TEAM_EVENT_FEATURES;
  const trainInputs = tf.tensor3d(
    trainRows.flat(),
    [trainingSampleCount, inputSteps, inputFeatures],
  );
  const validationInputs = tf.tensor3d(
    validationRows.flat(),
    [validationSampleCount, inputSteps, inputFeatures],
  );
  const trainAdjacency = graphModel
    ? tf.tensor3d(
      examples
        .slice(0, trainingSampleCount)
        .flatMap((example) => example.graphAdjacency),
      [trainingSampleCount, GRAPH_NODE_COUNT, GRAPH_NODE_COUNT],
    )
    : undefined;
  const validationAdjacency = graphModel
    ? tf.tensor3d(
      examples
        .slice(trainingSampleCount)
        .flatMap((example) => example.graphAdjacency),
      [validationSampleCount, GRAPH_NODE_COUNT, GRAPH_NODE_COUNT],
    )
    : undefined;
  const modelTrainInputs = graphModel
    ? [trainInputs, trainAdjacency as tf.Tensor3D]
    : trainInputs;
  const modelValidationInputs = graphModel
    ? [validationInputs, validationAdjacency as tf.Tensor3D]
    : validationInputs;
  const model = createModel(modelType, sequenceLength, hiddenUnits);
  const trainingLoss: number[] = [];
  const validationLoss: number[] = [];
  let predictionTensors: tf.Tensor[] = [];

  try {
    model.compile({
      optimizer: tf.train.adam(0.008),
      loss: MARKET_HEADS.map(() => "categoricalCrossentropy"),
    });
    await model.fit(modelTrainInputs, trainTargets, {
      epochs,
      batchSize: Math.min(32, trainingSampleCount),
      shuffle: false,
      validationData: [modelValidationInputs, validationTargets],
      verbose: 0,
      callbacks: [{
        onEpochEnd: async (epoch: number, logs?: { [key: string]: number }) => {
          if (typeof logs?.loss === "number") trainingLoss.push(logs.loss);
          if (typeof logs?.val_loss === "number") validationLoss.push(logs.val_loss);
          onEpoch(epoch + 1, [...trainingLoss], [...validationLoss]);
        },
      }],
    });

    predictionTensors = model.predict(modelValidationInputs) as tf.Tensor[];
    const predictionValues = Array.from(await predictionTensors[0].data());
    const probabilityRows = Array.from({ length: validationSampleCount }, (_, index) =>
      predictionValues.slice(index * 3, index * 3 + 3),
    );
    const metrics = metricsFor(probabilityRows, validationLabels, trainLabels);
    const weights: TrainingWeights = model.getWeights().map((weight) => ({
      shape: [...weight.shape],
      values: Array.from(weight.dataSync()),
    }));

    return {
      sampleCount: examples.length,
      trainingSampleCount,
      validationSampleCount,
      verifiedOddsFixtureCount: examples.filter((example) => example.hasPriorVerifiedOdds).length,
      ...metrics,
      trainingLoss,
      validationLoss,
      predictorArtifact: {
        version: 2,
        weights,
        normalization,
      },
    };
  } finally {
    predictionTensors.forEach((tensor) => tensor.dispose());
    trainInputs.dispose();
    trainTargets.forEach((tensor) => tensor.dispose());
    validationInputs.dispose();
    validationTargets.forEach((tensor) => tensor.dispose());
    trainAdjacency?.dispose();
    validationAdjacency?.dispose();
    model.dispose();
  }
}

export function isModelPredictorArtifact(
  value: unknown,
): value is ModelPredictorArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Partial<ModelPredictorArtifact>;
  return artifact.version === 2 &&
    Array.isArray(artifact.weights) &&
    artifact.weights.every((weight) =>
      Array.isArray(weight.shape) &&
      Array.isArray(weight.values) &&
      weight.shape.every((dimension) => Number.isSafeInteger(dimension) && dimension > 0) &&
      weight.values.every((weightValue) => Number.isFinite(weightValue)),
    ) &&
    !!artifact.normalization &&
    Array.isArray(artifact.normalization.means) &&
    Array.isArray(artifact.normalization.scales) &&
    artifact.normalization.means.length > 0 &&
    artifact.normalization.means.length === artifact.normalization.scales.length &&
    artifact.normalization.means.every(Number.isFinite) &&
    artifact.normalization.scales.every((scale) => Number.isFinite(scale) && scale > 0) &&
    Number.isSafeInteger(artifact.normalization.positionsPerSample) &&
    artifact.normalization.positionsPerSample > 0;
}

export async function predictArchivedFixture(input: {
  modelType: FootballModelType;
  sequenceLength: number;
  hiddenUnits: number;
  artifact: unknown;
  target: TesterPredictionTarget;
  matches: ModelTrainingMatch[];
}): Promise<ArchivedModelPrediction> {
  if (!isModelPredictorArtifact(input.artifact)) {
    throw new Error("This run has no compatible prediction artifact. Train a new model run before predicting.");
  }
  await tf.setBackend("cpu");
  await tf.ready();
  const artifact = input.artifact;
  const historyMatches = input.matches.filter(
    (match) =>
      match.fixtureId !== input.target.fixtureId &&
      match.calendarDate < input.target.calendarDate,
  );
  const targetMatch: ModelTrainingMatch = {
    ...input.target,
    homeScore: 0,
    awayScore: 0,
    leagueAverageGoals: input.target.leagueAverageGoals ?? null,
    trainingContext: input.target.trainingContext ?? {
      homeTeamName: input.target.homeTeamName,
      awayTeamName: input.target.awayTeamName,
      homeRecent: [],
      awayRecent: [],
      homeLastFive: [],
      awayLastFive: [],
      homeStanding: null,
      awayStanding: null,
      standingTeamCount: 0,
    },
    tmpJson: input.target.tmpJson ?? '{"oddsHistory":[]}',
  };
  const examples = buildTrainingExamples(
    [...historyMatches, targetMatch],
    input.modelType,
    input.sequenceLength,
  );
  const example = examples.at(-1);
  if (!example) {
    throw new Error("The tester fixture does not contain enough information to build model inputs.");
  }

  const sequenceModel =
    input.modelType === "lstm" ||
    input.modelType === "gru" ||
    input.modelType === "transformer";
  const graphModel =
    input.modelType === "gnn" || input.modelType === "dynamic-graph";
  const featureCount = sequenceModel ? SEQUENCE_FEATURES : TEAM_EVENT_FEATURES;
  const expectedPositions = sequenceModel ? input.sequenceLength : GRAPH_NODE_COUNT;
  if (
    artifact.normalization.means.length !== featureCount ||
    artifact.normalization.positionsPerSample !== expectedPositions
  ) {
    throw new Error("The saved feature normalization does not match this model architecture.");
  }
  const rawFeatures = sequenceModel ? example.sequence : example.graph;
  const normalizedFeatures = normalizeRows([rawFeatures], artifact.normalization)[0];
  const inputSteps = sequenceModel ? input.sequenceLength : GRAPH_NODE_COUNT;
  const inputFeatureCount = sequenceModel ? SEQUENCE_FEATURES : TEAM_EVENT_FEATURES;
  const featuresTensor = tf.tensor3d(
    normalizedFeatures,
    [1, inputSteps, inputFeatureCount],
  );
  const adjacencyTensor = graphModel
    ? tf.tensor3d(example.graphAdjacency, [1, GRAPH_NODE_COUNT, GRAPH_NODE_COUNT])
    : null;
  const weightTensors = artifact.weights.map((weight) =>
    tf.tensor(weight.values, weight.shape, "float32"),
  );
  const model = createModel(
    input.modelType,
    input.sequenceLength,
    input.hiddenUnits,
  );
  let predictionTensors: tf.Tensor[] = [];

  try {
    model.setWeights(weightTensors);
    const modelInputs = graphModel
      ? [featuresTensor, adjacencyTensor as tf.Tensor3D]
      : featuresTensor;
    predictionTensors = model.predict(modelInputs) as tf.Tensor[];
    const outputValues = await Promise.all(
      predictionTensors.map(async (tensor) => Array.from(await tensor.data())),
    );
    const correctScores = outputValues[4]
      .map((probability, index) => {
        const homeGoals = Math.floor(index / SCORE_BUCKET_COUNT);
        const awayGoals = index % SCORE_BUCKET_COUNT;
        const formatGoals = (goals: number) => goals === 5 ? "5+" : String(goals);
        return {
          scoreline: `${formatGoals(homeGoals)}-${formatGoals(awayGoals)}`,
          probability,
        };
      })
      .sort((first, second) => second.probability - first.probability)
      .slice(0, 5);

    return {
      result: {
        home: outputValues[0][0],
        draw: outputValues[0][1],
        away: outputValues[0][2],
      },
      bothTeamsToScore: {
        no: outputValues[1][0],
        yes: outputValues[1][1],
      },
      overUnder25: {
        under: outputValues[2][0],
        over: outputValues[2][1],
      },
      overUnder35: {
        under: outputValues[3][0],
        over: outputValues[3][1],
      },
      correctScoreTop: correctScores,
      historyMatchCount: historyMatches.length,
      verifiedOddsHistoryCount: parseVerifiedOdds(historyMatches).size,
    };
  } finally {
    predictionTensors.forEach((tensor) => tensor.dispose());
    weightTensors.forEach((tensor) => tensor.dispose());
    featuresTensor.dispose();
    adjacencyTensor?.dispose();
    model.dispose();
  }
}

export function countVerifiedOddsFixtures(matches: ModelTrainingMatch[]): number {
  return parseVerifiedOdds(matches).size;
}
