import * as tf from "@tensorflow/tfjs";
import type {
  FootballModelType,
  FootballModelTrainingInput,
} from "@workspace/api-zod";
import type { ModelTrainingMatch } from "./processed-match-store";

const OUTCOME_INDEX = { home: 0, draw: 1, away: 2 } as const;
const TEAM_EVENT_FEATURES = 7;
const SEQUENCE_FEATURES = TEAM_EVENT_FEATURES * 2 + 1;
const GRAPH_NODE_COUNT = 4;

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
  label: number;
  hasPriorVerifiedOdds: boolean;
};

export type TrainingWeights = Array<{ shape: number[]; values: number[] }>;

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
  weights: TrainingWeights;
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
  if (!game) return Array(TEAM_EVENT_FEATURES).fill(0);
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

function sequenceFeatures(
  homeHistory: TeamGame[],
  awayHistory: TeamGame[],
  sequenceLength: number,
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
      ...teamEventFeatures(awayGame),
      (index + 1) / sequenceLength,
    );
  }
  return features;
}

function teamSummary(history: TeamGame[], sequenceLength: number): number[] {
  const recent = history.slice(-sequenceLength);
  if (!recent.length) return Array(TEAM_EVENT_FEATURES).fill(0);
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
  if (!samples.length) return Array(TEAM_EVENT_FEATURES).fill(0);

  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  return Array.from({ length: TEAM_EVENT_FEATURES }, (_, index) =>
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
  const home = teamSummary(homeHistory, sequenceLength);
  const away = teamSummary(awayHistory, sequenceLength);
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
  const nodes = [
    ...home,
    ...away,
    ...homeNeighbors,
    ...awayNeighbors,
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

function labelFor(match: ModelTrainingMatch): number {
  if (match.homeScore > match.awayScore) return OUTCOME_INDEX.home;
  if (match.homeScore === match.awayScore) return OUTCOME_INDEX.draw;
  return OUTCOME_INDEX.away;
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
        sequence: sequenceFeatures(homeHistory, awayHistory, sequenceLength),
        graph: graph.nodes,
        graphAdjacency: graph.adjacency,
        label: labelFor(match),
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

function normalizeRows(
  rows: number[][],
  trainingSampleCount: number,
  featureCount: number,
  sequenceLength?: number,
): number[][] {
  const means = Array(featureCount).fill(0) as number[];
  const squares = Array(featureCount).fill(0) as number[];
  const positionsPerSample = sequenceLength ?? 1;
  const divisor = Math.max(1, trainingSampleCount * positionsPerSample);

  for (let sample = 0; sample < trainingSampleCount; sample += 1) {
    for (let position = 0; position < positionsPerSample; position += 1) {
      for (let feature = 0; feature < featureCount; feature += 1) {
        const value = sequenceLength
          ? rows[sample][position * featureCount + feature]
          : rows[sample][feature];
        means[feature] += value / divisor;
        squares[feature] += value * value / divisor;
      }
    }
  }

  const scales = means.map((mean, index) => Math.sqrt(Math.max(1e-6, squares[index] - mean * mean)));
  return rows.map((row) => {
    const normalized = [...row];
    const positions = sequenceLength ?? 1;
    for (let position = 0; position < positions; position += 1) {
      for (let feature = 0; feature < featureCount; feature += 1) {
        const index = sequenceLength ? position * featureCount + feature : feature;
        normalized[index] = (row[index] - means[feature]) / scales[feature];
      }
    }
    return normalized;
  });
}

function graphConvolutionModel(hiddenUnits: number): tf.LayersModel {
  const nodes = tf.input({
    shape: [GRAPH_NODE_COUNT, TEAM_EVENT_FEATURES],
    name: "team_nodes",
  });
  const adjacency = tf.input({
    shape: [GRAPH_NODE_COUNT, GRAPH_NODE_COUNT],
    name: "match_graph_adjacency",
  });
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
  const hidden = tf.layers
    .dense({ units: hiddenUnits, activation: "relu" })
    .apply(pooled) as tf.SymbolicTensor;
  const output = tf.layers
    .dense({ units: 3, activation: "softmax" })
    .apply(hidden) as tf.SymbolicTensor;
  return tf.model({ inputs: [nodes, adjacency], outputs: output });
}

function attentionModel(sequenceLength: number, hiddenUnits: number): tf.LayersModel {
  const input = tf.input({ shape: [sequenceLength, SEQUENCE_FEATURES] });
  const query = tf.layers.dense({ units: hiddenUnits, useBias: false }).apply(input) as tf.SymbolicTensor;
  const key = tf.layers.dense({ units: hiddenUnits, useBias: false }).apply(input) as tf.SymbolicTensor;
  const value = tf.layers.dense({ units: hiddenUnits }).apply(input) as tf.SymbolicTensor;
  const scores = tf.layers.dot({ axes: [2, 2] }).apply([query, key]) as tf.SymbolicTensor;
  const attention = tf.layers.activation({ activation: "softmax" }).apply(scores) as tf.SymbolicTensor;
  const context = tf.layers.dot({ axes: [2, 1] }).apply([attention, value]) as tf.SymbolicTensor;
  const pooled = tf.layers.globalAveragePooling1d().apply(context) as tf.SymbolicTensor;
  const hidden = tf.layers.dense({ units: hiddenUnits, activation: "relu" }).apply(pooled) as tf.SymbolicTensor;
  const output = tf.layers.dense({ units: 3, activation: "softmax" }).apply(hidden) as tf.SymbolicTensor;
  return tf.model({ inputs: input, outputs: output });
}

function createModel(
  modelType: FootballModelType,
  sequenceLength: number,
  hiddenUnits: number,
): tf.LayersModel {
  if (modelType === "lstm" || modelType === "gru") {
    const model = tf.sequential();
    const recurrentLayer = modelType === "lstm"
      ? tf.layers.lstm({ units: hiddenUnits, inputShape: [sequenceLength, SEQUENCE_FEATURES] })
      : tf.layers.gru({ units: hiddenUnits, inputShape: [sequenceLength, SEQUENCE_FEATURES] });
    model.add(recurrentLayer);
    model.add(tf.layers.dense({ units: 3, activation: "softmax" }));
    return model;
  }
  if (modelType === "transformer") {
    return attentionModel(sequenceLength, hiddenUnits);
  }
  if (modelType === "gnn" || modelType === "dynamic-graph") {
    return graphConvolutionModel(hiddenUnits);
  }
  throw new Error(`Unsupported model type: ${modelType}`);
}

function oneHot(label: number): number[] {
  return [0, 1, 2].map((index) => index === label ? 1 : 0);
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
  const normalizedRows = normalizeRows(
    rawRows,
    trainingSampleCount,
    featureCount,
    sequenceModel ? sequenceLength : graphModel ? GRAPH_NODE_COUNT : undefined,
  );
  const trainRows = normalizedRows.slice(0, trainingSampleCount);
  const validationRows = normalizedRows.slice(trainingSampleCount);
  const trainLabels = examples.slice(0, trainingSampleCount).map((example) => example.label);
  const validationLabels = examples.slice(trainingSampleCount).map((example) => example.label);
  const trainTargets = tf.tensor2d(trainLabels.map(oneHot), [trainingSampleCount, 3]);
  const validationTargets = tf.tensor2d(validationLabels.map(oneHot), [validationSampleCount, 3]);
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

  try {
    model.compile({
      optimizer: tf.train.adam(0.008),
      loss: "categoricalCrossentropy",
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

    const prediction = model.predict(modelValidationInputs) as tf.Tensor;
    const predictionValues = Array.from(await prediction.data());
    prediction.dispose();
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
      weights,
    };
  } finally {
    trainInputs.dispose();
    trainTargets.dispose();
    validationInputs.dispose();
    validationTargets.dispose();
    trainAdjacency?.dispose();
    validationAdjacency?.dispose();
    model.dispose();
  }
}

export function countVerifiedOddsFixtures(matches: ModelTrainingMatch[]): number {
  return parseVerifiedOdds(matches).size;
}
