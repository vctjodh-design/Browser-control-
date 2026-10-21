import { Router, type IRouter } from "express";
import {
  GetFootballModelTrainingDashboardResponse,
  GetFootballModelTrainingRunParams,
  GetFootballModelTrainingRunResponse,
  StartFootballModelTrainingBody,
  StartFootballModelTrainingResponse,
} from "@workspace/api-zod";
import {
  createModelTrainingRun,
  findActiveModelTrainingRun,
  getModelTrainingRun,
  listModelTrainingMatches,
  listModelTrainingRuns,
  updateModelTrainingRun,
} from "../lib/processed-match-store";
import {
  countVerifiedOddsFixtures,
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
    }, JSON.stringify(result.weights));
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

router.get("/football/model-training", (_req, res): void => {
  const matches = listModelTrainingMatches();
  res.json(GetFootballModelTrainingDashboardResponse.parse(trainingDatasetSummary(matches)));
});

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

export default router;
