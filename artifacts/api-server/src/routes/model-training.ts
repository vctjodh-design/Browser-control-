import { Router, type IRouter } from "express";
import {
  GetFootballTesterMatchModelPredictionsParams,
  GetFootballTesterMatchModelPredictionsResponse,
  GetFootballMatchModelPredictionsParams,
  GetFootballMatchModelPredictionsResponse,
  GetFootballModelTrainingDashboardResponse,
  GetFootballModelTrainingRunParams,
  GetFootballModelTrainingRunResponse,
  PredictFootballTesterMatchParams,
  PredictFootballTesterMatchResponse,
  PredictFootballMatchBody,
  PredictFootballMatchParams,
  PredictFootballMatchResponse,
  StartFootballModelTrainingBody,
  StartFootballModelTrainingResponse,
} from "@workspace/api-zod";
import {
  createModelTrainingRun,
  findActiveModelTrainingRun,
  getModelTrainingArtifact,
  getModelTrainingRun,
  getTesterPredictionTarget,
  listModelTrainingMatches,
  listModelPredictionsForFixture,
  listModelTrainingRuns,
  saveModelPrediction,
  type ModelTrainingContext,
  type TesterPredictionTarget,
  updateModelTrainingRun,
} from "../lib/processed-match-store";
import {
  countVerifiedOddsFixtures,
  isModelPredictorArtifact,
  predictArchivedFixture,
  trainArchivedModel,
} from "../lib/model-training-engine";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const MINIMUM_MATCH_COUNT = 30;

function trainingDatasetSummary(matches: ReturnType<typeof listModelTrainingMatches>) {
  const teams = new Set<string>();
  const outcomeCounts = { home: 0, draw: 0, away: 0 };
  for (const match of matches) {
    teams.add(match.homeTeamName.trim().toLocaleLowerCase());
    teams.add(match.awayTeamName.trim().toLocaleLowerCase());
    if (match.homeScore > match.awayScore) outcomeCounts.home += 1;
    else if (match.homeScore === match.awayScore) outcomeCounts.draw += 1;
    else outcomeCounts.away += 1;
  }

  return {
    matchCount: matches.length,
    teamCount: teams.size,
    firstMatchDate: matches[0]?.calendarDate ?? null,
    lastMatchDate: matches.at(-1)?.calendarDate ?? null,
    outcomeCounts,
    verifiedOddsFixtureCount: countVerifiedOddsFixtures(matches),
    runs: listModelTrainingRuns(12),
  };
}

function trainRunInBackground(
  runId: string,
  input: ReturnType<typeof StartFootballModelTrainingBody.parse>,
  matches: ReturnType<typeof listModelTrainingMatches>,
): void {
  const current = getModelTrainingRun(runId);
  if (!current) return;
  updateModelTrainingRun(runId, { ...current, status: "training", error: null });

  void trainArchivedModel(input.modelType, input, matches, (completedEpochs, trainingLoss, validationLoss) => {
    const latest = getModelTrainingRun(runId);
    if (!latest) return;
    updateModelTrainingRun(runId, {
      ...latest,
      status: "training",
      completedEpochs,
      trainingLoss,
      validationLoss,
      error: null,
    });
  }).then((result) => {
    const latest = getModelTrainingRun(runId);
    if (!latest) return;
    updateModelTrainingRun(runId, {
      ...latest,
      status: "completed",
      completedEpochs: input.epochs ?? latest.epochs,
      sampleCount: result.sampleCount,
      trainingSampleCount: result.trainingSampleCount,
      validationSampleCount: result.validationSampleCount,
      verifiedOddsFixtureCount: result.verifiedOddsFixtureCount,
      accuracy: result.accuracy,
      baselineAccuracy: result.baselineAccuracy,
      logLoss: result.logLoss,
      brierScore: result.brierScore,
      confusionMatrix: result.confusionMatrix,
      trainingLoss: result.trainingLoss,
      validationLoss: result.validationLoss,
      error: null,
    }, JSON.stringify(result.predictorArtifact));
  }).catch((error: unknown) => {
    const latest = getModelTrainingRun(runId);
    if (latest) {
      updateModelTrainingRun(runId, {
        ...latest,
        status: "failed",
        error: (error instanceof Error ? error.message : "Model training failed.").slice(0, 500),
      });
    }
    logger.error(
      { runId, errorName: error instanceof Error ? error.name : "UnknownError" },
      "Archived football model training failed",
    );
  });
}

async function generateModelPredictions(
  fixtureId: number,
  target: TesterPredictionTarget,
): Promise<ReturnType<typeof listModelPredictionsForFixture>> {
  const latestByModelType = new Map<
    string,
    ReturnType<typeof listModelTrainingRuns>[number]
  >();
  for (const run of listModelTrainingRuns(50)) {
    if (
      run.status === "completed" &&
      run.hasPredictionArtifact &&
      !latestByModelType.has(run.modelType)
    ) {
      latestByModelType.set(run.modelType, run);
    }
  }
  const runs = [...latestByModelType.values()];
  if (!runs.length) return [];

  const matches = listModelTrainingMatches();
  for (const run of runs) {
    const artifact = getModelTrainingArtifact(run.id);
    if (!isModelPredictorArtifact(artifact)) continue;
    try {
      const forecast = await predictArchivedFixture({
        modelType: run.modelType,
        sequenceLength: run.sequenceLength,
        hiddenUnits: run.hiddenUnits,
        artifact,
        target,
        matches,
      });
      const prediction = PredictFootballMatchResponse.parse({
        fixtureId,
        predictions: [
          {
            fixtureId,
            runId: run.id,
            modelType: run.modelType,
            ...forecast,
            createdAt: new Date(),
          },
        ],
      }).predictions[0];
      saveModelPrediction(prediction);
    } catch (error) {
      logger.warn(
        {
          fixtureId,
          runId: run.id,
          modelType: run.modelType,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Could not score match fixture with a trained model",
      );
    }
  }
  return listModelPredictionsForFixture(fixtureId);
}

function targetFromPredictionContext(
  fixtureId: number,
  input: ReturnType<typeof PredictFootballMatchBody.parse>,
): TesterPredictionTarget {
  const date = new Date(input.matchDate);
  const trainingContext: ModelTrainingContext = {
    homeTeamName: input.homeTeamName,
    awayTeamName: input.awayTeamName,
    homeRecent: input.homeRecent,
    awayRecent: input.awayRecent,
    homeLastFive: input.homeLastFive,
    awayLastFive: input.awayLastFive,
    homeStanding: input.homeStanding,
    awayStanding: input.awayStanding,
    standingTeamCount: input.standingTeamCount,
  };
  return {
    fixtureId,
    calendarDate: date.toISOString().slice(0, 10),
    matchDate: date.toISOString(),
    competition: input.competition,
    season: input.season,
    homeTeamName: input.homeTeamName,
    awayTeamName: input.awayTeamName,
    leagueAverageGoals: input.leagueAverageGoals,
    trainingContext,
    tmpJson: JSON.stringify({ oddsHistory: input.oddsHistory }),
  };
}

router.get("/football/model-training", (_req, res): void => {
  const matches = listModelTrainingMatches();
  res.json(GetFootballModelTrainingDashboardResponse.parse(trainingDatasetSummary(matches)));
});

router.get(
  "/football/matches/:fixtureId/model-predictions",
  (req, res): void => {
    const params = GetFootballMatchModelPredictionsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }
    res.json(
      GetFootballMatchModelPredictionsResponse.parse({
        fixtureId: params.data.fixtureId,
        predictions: listModelPredictionsForFixture(params.data.fixtureId),
      }),
    );
  },
);

router.post(
  "/football/matches/:fixtureId/model-predictions",
  async (req, res): Promise<void> => {
    const params = PredictFootballMatchParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }
    const input = PredictFootballMatchBody.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: input.error.message });
      return;
    }

    const fixtureId = params.data.fixtureId;
    const predictions = await generateModelPredictions(
      fixtureId,
      targetFromPredictionContext(fixtureId, input.data),
    );
    if (!predictions.length) {
      res.status(422).json({
        error: "No compatible completed model runs are available. Train a new model before predicting.",
      });
      return;
    }
    res.json(
      PredictFootballMatchResponse.parse({ fixtureId, predictions }),
    );
  },
);

router.get("/football/model-training/runs/:runId", (req, res): void => {
  const params = GetFootballModelTrainingRunParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose a valid training run." });
    return;
  }
  const run = getModelTrainingRun(params.data.runId);
  if (!run) {
    res.status(404).json({ error: "Training run not found." });
    return;
  }
  res.json(GetFootballModelTrainingRunResponse.parse(run));
});

router.post("/football/model-training/runs", (req, res): void => {
  const input = StartFootballModelTrainingBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: input.error.message });
    return;
  }
  const activeRun = findActiveModelTrainingRun();
  if (activeRun) {
    res.status(409).json({ error: "A model is already training. Wait for it to finish before starting another run." });
    return;
  }

  const matches = listModelTrainingMatches();
  if (matches.length < MINIMUM_MATCH_COUNT) {
    res.status(422).json({
      error: `At least ${MINIMUM_MATCH_COUNT} completed matches are required. The archive currently has ${matches.length}.`,
    });
    return;
  }

  const run = createModelTrainingRun(input.data, matches.length);
  res.status(202).json(StartFootballModelTrainingResponse.parse(run));
  setImmediate(() => trainRunInBackground(run.id, input.data, matches));
});

router.get(
  "/football/tester-matches/:fixtureId/model-predictions",
  (req, res): void => {
    const params = GetFootballTesterMatchModelPredictionsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }
    res.json(
      GetFootballTesterMatchModelPredictionsResponse.parse({
        fixtureId: params.data.fixtureId,
        predictions: listModelPredictionsForFixture(params.data.fixtureId),
      }),
    );
  },
);

router.post(
  "/football/tester-matches/:fixtureId/model-predictions",
  async (req, res): Promise<void> => {
    const params = PredictFootballTesterMatchParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }
    const fixtureId = params.data.fixtureId;
    const target = getTesterPredictionTarget(fixtureId);
    if (!target) {
      res.status(404).json({ error: "Tester record was not found." });
      return;
    }

    const predictions = await generateModelPredictions(fixtureId, target);
    if (!predictions.length) {
      res.status(422).json({
        error: "No compatible trained model could score this fixture. Train a model and try again.",
      });
      return;
    }
    res.json(
      PredictFootballTesterMatchResponse.parse({ fixtureId, predictions }),
    );
  },
);

export default router;
