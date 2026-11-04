import { Router, type IRouter, type Response } from "express";
import { gzipSync } from "node:zlib";
import {
  GetFootballMatchDetailsParams,
  GetFootballMatchDetailsResponse,
  GetFootballMatchCenterParams,
  GetFootballMatchCenterResponse,
  GetFootballMatchReplayParams,
  GetFootballMatchReplayResponse,
  GetFootballMatchLastFiveParams,
  GetFootballMatchLastFiveResponse,
  GetFootballMatchTmpParams,
  GetFootballMatchTmpResponse,
  GetFootballFixturesQueryParams,
  GetFootballFixturesResponse,
  GetFootballLiveActionQueryParams,
  GetFootballLiveActionResponse,
} from "@workspace/api-zod";
import {
  getKickoffScoreMatchDetails,
  KickoffScoreMatchNotFoundError,
} from "../lib/kickoffscore-match-details";
import { getKickoffScoreMatchTmp } from "../lib/kickoffscore-match-tmp";
import {
  getKickoffScoreMatchCenter,
  getKickoffScoreMatchLastFive,
} from "../lib/kickoffscore-last-five";
import { getKickoffScoreFixtures } from "../lib/kickoffscore-fixtures";
import { getSimFormProfile } from "../lib/sim-form-profile";
import {
  OpenFootballUnavailableError,
  playOpenFootballMatch,
} from "../lib/open-football-replay";
import { getOddsBoard } from "../lib/odds-board";
import { simulateOddsBoard } from "../lib/odds-simulation";
import { settleBoard } from "../lib/odds-settlement";
import type { SimMatchSummary } from "../lib/match-settlement";
import { UpstreamRateLimitError } from "../lib/upstream-rate-limit";
import {
  get365ScoresMatchReplay,
  get365ScoresLiveAction,
  LiveActionSourceUrlError,
  MatchReplayNotFoundError,
  MatchReplaySourceError,
} from "../lib/365scores-match-replay";

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
  "/football/matches/:fixtureId/replay",
  async (req, res): Promise<void> => {
    const params = GetFootballMatchReplayParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    try {
      const details = await getKickoffScoreMatchDetails(
        params.data.fixtureId,
      );
      const isComplete =
        /\b(finished|full time|ft|ended|complete|after extra time|penalties)\b/i.test(
          details.match.status,
        );
      const isLive =
        /\b(live|in play|in progress|first half|second half|1st half|2nd half|1h|2h|half[ -]?time|halftime)\b/i.test(
          details.match.status,
        );
      if (!isComplete && !isLive && details.match.date.getTime() > Date.now()) {
        res.status(400).json({
          error: "The shot feed is available after the match has started.",
        });
        return;
      }

      const replay = await get365ScoresMatchReplay(details);
      res.json(GetFootballMatchReplayResponse.parse(replay));
    } catch (error) {
      if (error instanceof MatchReplayNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof MatchReplaySourceError) {
        req.log.warn(
          { errorName: error.name },
          "365Scores match replay data could not be collected",
        );
        res.status(502).json({ error: error.message });
        return;
      }
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }

      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not build the source match shot feed",
      );
      res.status(502).json({
        error: "The match replay could not be built right now. Please try again.",
      });
    }
  },
);

router.get(
  "/football/365scores/live-action",
  async (req, res): Promise<void> => {
    const query = GetFootballLiveActionQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({
        error: "Enter a valid 365Scores football match link.",
      });
      return;
    }

    try {
      const liveAction = await get365ScoresLiveAction(query.data.sourceUrl);
      res.json(GetFootballLiveActionResponse.parse(liveAction));
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof LiveActionSourceUrlError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof MatchReplaySourceError) {
        req.log.warn(
          { errorName: error.name },
          "365Scores live action data could not be collected",
        );
        res.status(502).json({ error: error.message });
        return;
      }

      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not build the 365Scores live action snapshot",
      );
      res.status(502).json({
        error: "365Scores live action data could not be read right now.",
      });
    }
  },
);

router.get(
  "/football/matches/:fixtureId/match-center",
  async (req, res): Promise<void> => {
    const params = GetFootballMatchCenterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    try {
      const matchCenter = await getKickoffScoreMatchCenter(
        params.data.fixtureId,
      );
      res.json(GetFootballMatchCenterResponse.parse(matchCenter));
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }

      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not load live match center data from KickoffScore",
      );
      res.status(502).json({
        error:
          "Live score and player details could not be loaded right now. Please try again.",
      });
    }
  },
);

router.get(
  "/football/matches/:fixtureId/last-five",
  async (req, res): Promise<void> => {
    const params = GetFootballMatchLastFiveParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    try {
      const lastFive = await getKickoffScoreMatchLastFive(
        params.data.fixtureId,
      );
      res.json(GetFootballMatchLastFiveResponse.parse(lastFive));
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }

      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not load last-five match data from KickoffScore",
      );
      res.status(502).json({
        error:
          "Last-five match data could not be loaded right now. Please try again.",
      });
    }
  },
);

router.get(
  "/football/matches/:fixtureId/sim-profile",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    const readCount = (value: unknown): number | undefined => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
    };

    try {
      const profile = await getSimFormProfile(fixtureId, {
        formGames: readCount(req.query.formGames),
        detailGames: readCount(req.query.detailGames),
      });
      res.json(profile);
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }

      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not build the simulation form profile",
      );
      res.status(502).json({
        error: "Form and lineups could not be read right now. Please try again.",
      });
    }
  },
);

router.get(
  "/football/matches/:fixtureId/odds-board",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    try {
      const board = await getOddsBoard(fixtureId);
      res.json(board);
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not build the odds board",
      );
      res.status(502).json({ error: "Odds could not be read right now. Please try again." });
    }
  },
);

// One match, played by the Open Football engine instead of the app's own
// simulation. The recording is what the pitch replays; the scores are the
// engine's, not a restatement of the odds.
router.get(
  "/football/matches/:fixtureId/open-football-replay",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    const seedValue = Number(req.query.seed);
    const seed = Number.isFinite(seedValue) && seedValue > 0 ? Math.round(seedValue) : 7;

    try {
      const profile = await getSimFormProfile(fixtureId);
      const replay = await playOpenFootballMatch(profile, seed);
      // A played match never changes for the same seed, so the browser and any
      // proxy can hold it: a replay is megabytes of samples. Gzipped by hand
      // rather than by a middleware — it is one document, sent once, and the
      // browser decompresses it for free.
      res.set("Cache-Control", "private, max-age=3600");
      const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
      if (acceptsGzip) {
        res.set("Content-Encoding", "gzip");
        res.type("application/json").send(gzipSync(Buffer.from(JSON.stringify(replay))));
      } else {
        res.json(replay);
      }
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof OpenFootballUnavailableError) {
        req.log.error({ reason: error.message }, "Open Football replay unavailable");
        res.status(503).json({ error: error.message });
        return;
      }

      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not play the fixture with the Open Football engine",
      );
      res.status(502).json({
        error: "The Open Football engine could not play this match right now.",
      });
    }
  },
);

router.post(
  "/football/matches/:fixtureId/odds-simulation",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    const body = (req.body ?? {}) as { rounds?: unknown; seed?: unknown; goalsPerMatch?: unknown };
    const rounds = Number(body.rounds);
    if (!Number.isFinite(rounds) || rounds < 1) {
      res.status(400).json({ error: "Choose how many rounds to run (1 or more)." });
      return;
    }
    const seedValue = Number(body.seed);
    const goalsValue = Number(body.goalsPerMatch);

    try {
      const [profile, board] = await Promise.all([
        getSimFormProfile(fixtureId),
        getOddsBoard(fixtureId),
      ]);

      const result = simulateOddsBoard(board, profile, {
        rounds,
        seed: Number.isFinite(seedValue) && seedValue > 0 ? seedValue : undefined,
        goalsPerMatch:
          Number.isFinite(goalsValue) && goalsValue > 0 && goalsValue < 8
            ? goalsValue
            : undefined,
      });
      res.json(result);
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not run the odds simulation",
      );
      res.status(502).json({
        error: "The odds simulation could not run right now. Please try again.",
      });
    }
  },
);

router.post(
  "/football/matches/:fixtureId/odds-settle",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    const body = (req.body ?? {}) as { summary?: unknown };
    const summary = body.summary as SimMatchSummary | undefined;
    if (!summary || typeof summary !== "object" || !summary.home || !summary.away) {
      res.status(400).json({ error: "Send the played match summary to settle against." });
      return;
    }

    try {
      const board = await getOddsBoard(fixtureId);
      res.json(settleBoard(board, summary));
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not settle the odds board",
      );
      res.status(502).json({
        error: "The market settlement could not run right now. Please try again.",
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
