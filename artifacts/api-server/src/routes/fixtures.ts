import { Router, type IRouter } from "express";
import {
  GetFootballFixturesQueryParams,
  GetFootballFixturesResponse,
} from "@workspace/api-zod";
import { getKickoffScoreFixtures } from "../lib/kickoffscore-fixtures";

const router: IRouter = Router();

function parseDateQuery(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    !GetFootballFixturesQueryParams.safeParse({ date }).success
  ) {
    return null;
  }

  return value;
}

router.get("/football/fixtures", async (req, res): Promise<void> => {
  const date = parseDateQuery(req.query.date);
  if (!date) {
    res.status(400).json({ error: "Choose a valid date in YYYY-MM-DD format." });
    return;
  }

  try {
    const page = await getKickoffScoreFixtures(date);
    const validated = GetFootballFixturesResponse.parse(page);
    res.json({ ...validated, date });
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Could not load fixtures from KickoffScore",
    );
    res.status(502).json({
      error: "KickoffScore fixtures could not be loaded right now. Please try again.",
    });
  }
});

export default router;
