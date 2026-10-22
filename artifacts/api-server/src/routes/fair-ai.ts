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

router.post("/football/fair-ai/simulate", (req, res): void => {
  const parsed = RunFootballFairAiSimulationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.homeTeamKey === parsed.data.awayTeamKey) {
    res.status(400).json({ error: "Choose two different teams for the simulation." });
    return;
  }
  const simulation = runFairAiArchiveSimulation(parsed.data);
  if (!simulation) {
    res.status(404).json({ error: "One or both teams do not have imported match records." });
    return;
  }
  res.json(RunFootballFairAiSimulationResponse.parse(simulation));
});

router.post("/football/fair-ai/data/ingest", (_req, res): void => {
  res
    .status(202)
    .json(StartFootballFairAiDataIngestionResponse.parse(startFairAiDataIngestion()));
});

export default router;
