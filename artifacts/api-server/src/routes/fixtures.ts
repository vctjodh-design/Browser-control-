import { Router, type IRouter, type Response } from "express";
import {
  GetFootballMatchDetailsParams,
  GetFootballMatchDetailsResponse,
  GetFootballMatchTmpParams,
  GetFootballMatchTmpResponse,
  GetFootballFixturesQueryParams,
  GetFootballFixturesResponse,
} from "@workspace/api-zod";
import {
  getKickoffScoreMatchDetails,
  KickoffScoreMatchNotFoundError,
} from "../lib/kickoffscore-match-details";
import { getKickoffScoreMatchTmp } from "../lib/kickoffscore-match-tmp";
import { getKickoffScoreFixtures } from "../lib/kickoffscore-fixtures";
import { UpstreamRateLimitError } from "../lib/upstream-rate-limit";

const router: IRouter = Router();

function sendUpstreamRateLimit(
  res: Response,
  error: unknown,
): boolean {
  if (!(error instanceof UpstreamRateLimitError)) return false;
  res.set("Retry-After", String(error.retryAfterSeconds)).status(429).json({
    error: `The data source is rate limiting requests. Please wait ${error.retryAfterSeconds} seconds before trying again.`,
  });
  return true;
}

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
    if (sendUpstreamRateLimit(res, error)) return;
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Could not load fixtures from KickoffScore",
    );
    res.status(502).json({
      error: "KickoffScore fixtures could not be loaded right now. Please try again.",
    });
  }
});

router.get(
  "/football/matches/:fixtureId/details",
  async (req, res): Promise<void> => {
    const params = GetFootballMatchDetailsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    try {
      const details = await getKickoffScoreMatchDetails(
        params.data.fixtureId,
      );
      res.json(GetFootballMatchDetailsResponse.parse(details));
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }

      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not load match details from KickoffScore",
      );
      res.status(502).json({
        error:
          "KickoffScore match details could not be loaded right now. Please try again.",
      });
    }
  },
);

router.get(
  "/football/matches/:fixtureId/tmp",
  async (req, res): Promise<void> => {
    const params = GetFootballMatchTmpParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    try {
      const context = await getKickoffScoreMatchTmp(params.data.fixtureId);
      res.json(GetFootballMatchTmpResponse.parse(context));
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }

      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not load historical TMP context from KickoffScore",
      );
      res.status(502).json({
        error:
          "Historical match expectations could not be loaded right now. Please try again.",
      });
    }
  },
);

export default router;
