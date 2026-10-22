import { Router, type IRouter } from "express";
import {
  GetFootballFairAiDataResponse,
  GetFootballFairAiTeamsQueryParams,
  GetFootballFairAiTeamsResponse,
  RunFootballFairAiSimulationBody,
  RunFootballFairAiSimulationResponse,
  StartFootballFairAiDataIngestionResponse,
} from "@workspace/api-zod";
import {
  getFairAiDataSummary,
  getFairAiTeams,
  runFairAiArchiveSimulation,
  startFairAiDataIngestion,
} from "../lib/fair-ai-data-store";
import { UpstreamRateLimitError } from "../lib/upstream-rate-limit";

const router: IRouter = Router();

router.get("/football/fair-ai/data", (_req, res): void => {
  res.json(GetFootballFairAiDataResponse.parse(getFairAiDataSummary()));
});

router.get("/football/fair-ai/teams", (req, res): void => {
  const parsed = GetFootballFairAiTeamsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(GetFootballFairAiTeamsResponse.parse(getFairAiTeams(parsed.data.search)));
});

router.post("/football/fair-ai/simulate", async (req, res): Promise<void> => {
  const parsed = RunFootballFairAiSimulationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.homeTeamKey === parsed.data.awayTeamKey) {
    res.status(400).json({ error: "Choose two different teams for the simulation." });
    return;
  }
  try {
    const simulation = await runFairAiArchiveSimulation(parsed.data);
    if (!simulation) {
      res.status(404).json({ error: "One or both teams do not have imported match records." });
      return;
    }
    res.json(RunFootballFairAiSimulationResponse.parse(simulation));
  } catch (error) {
    if (error instanceof UpstreamRateLimitError) {
      res.set("Retry-After", String(error.retryAfterSeconds)).status(429).json({
        error: `KickoffScore is rate limiting requests. Please wait ${error.retryAfterSeconds} seconds before trying again.`,
      });
      return;
    }
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Could not refresh FAIR AI simulation data from KickoffScore",
    );
    res.status(502).json({
      error: error instanceof Error
        ? error.message
        : "KickoffScore's latest match details could not be loaded. The simulation was not run with stale data.",
    });
  }
});

router.post("/football/fair-ai/data/ingest", (_req, res): void => {
  res
    .status(202)
    .json(StartFootballFairAiDataIngestionResponse.parse(startFairAiDataIngestion()));
});

export default router;
