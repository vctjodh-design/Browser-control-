import { Router, type IRouter } from "express";
import {
  GetFootballFairAiDataResponse,
  StartFootballFairAiDataIngestionResponse,
} from "@workspace/api-zod";
import {
  getFairAiDataSummary,
  startFairAiDataIngestion,
} from "../lib/fair-ai-data-store";

const router: IRouter = Router();

router.get("/football/fair-ai/data", (_req, res): void => {
  res.json(GetFootballFairAiDataResponse.parse(getFairAiDataSummary()));
});

router.post("/football/fair-ai/data/ingest", (_req, res): void => {
  res
    .status(202)
    .json(StartFootballFairAiDataIngestionResponse.parse(startFairAiDataIngestion()));
});

export default router;
