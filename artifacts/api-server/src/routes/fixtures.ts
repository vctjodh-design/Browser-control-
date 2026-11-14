import { Router, type IRouter, type Response } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
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
import { applyPlayerForm } from "../lib/player-form-apply";
import { runDuelSimulation } from "../lib/squad-duel-sim";
import { buildInevitability, InevitabilityUnavailableError } from "../lib/inevitability-engine";
import { buildDecisionTree } from "../lib/decision-tree";
import {
  loadFixturePlayerForm,
  PlayerFormUnavailableError,
  readPlayerMatchLog,
  storedWeights,
} from "../lib/player-form";
import {
  OpenFootballUnavailableError,
  playOpenFootballMatch,
  playOpenFootballScores,
} from "../lib/open-football-replay";
import {
  openFootballViewerReady,
  openFootballViewerRecording,
  renderViewerPage,
  viewerScriptPath,
  viewerWasmPath,
} from "../lib/open-football-viewer";
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
/**
 * The profile the engine plays: the predicted elevens with the unavailable
 * players replaced and every player carrying the weights his own matches
 * argue for. The page keeps reading the plain profile, so ratings data being
 * down never blanks the match.
 */
async function engineProfile(fixtureId: number) {
  const profile = await getSimFormProfile(fixtureId);
  const applied = await applyPlayerForm(profile);
  return applied.profile;
}

// Everything the performance feed has on this fixture's players: the rating
// and full stat block of each man, his shot map, his heat map, the weights his
// stored history puts on his skills, and who is out injured or suspended.
router.get(
  "/football/matches/:fixtureId/player-form",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    try {
      const profile = await getSimFormProfile(fixtureId);
      const form = await loadFixturePlayerForm(
        fixtureId,
        profile.teams[0].name,
        profile.teams[1].name,
      );
      res.set("Cache-Control", "private, max-age=600");
      res.json({
        fixtureId,
        source: form.source,
        matchId: form.matchId,
        date: form.date,
        teams: form.teams.map((team) => ({
          name: team.name,
          formation: team.formation,
          unavailable: team.unavailable,
          players: team.players
            .filter((player) => player.starter || player.minutes > 0)
            .map((player) => ({
              playerId: player.playerId,
              name: player.name,
              shirt: player.shirt,
              starter: player.starter,
              rating: player.rating,
              minutes: player.minutes,
              stats: player.stats,
              shots: player.shots,
              heat: player.heat,
              weights: player.weights,
            })),
        })),
      });
    } catch (error) {
      if (error instanceof PlayerFormUnavailableError) {
        res.status(404).json({ error: error.message });
        return;
      }
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not read player performances",
      );
      res.status(502).json({ error: "Player performances could not be read right now." });
    }
  },
);

// Every match the feed has for one player, newest first, with the rating it
// gave him and the weights his history currently puts on his skills.
router.get(
  "/football/players/:playerId/matches",
  async (req, res): Promise<void> => {
    const playerId = Number(req.params.playerId);
    if (!Number.isSafeInteger(playerId) || playerId <= 0) {
      res.status(400).json({ error: "Choose a valid player ID." });
      return;
    }

    try {
      const matches = await readPlayerMatchLog(playerId, 40);
      res.set("Cache-Control", "private, max-age=600");
      res.json({ playerId, matches, weights: storedWeights(playerId) });
    } catch (error) {
      if (error instanceof PlayerFormUnavailableError) {
        res.status(404).json({ error: error.message });
        return;
      }
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not read a player's matches",
      );
      res.status(502).json({ error: "This player's matches could not be read right now." });
    }
  },
);

// A batch of engine matches. The panel asks for a handful at a time and keeps
// the tally itself, so a run of thousands shows its progress as it goes and can
// be stopped between requests.
router.get(
  "/football/matches/:fixtureId/open-football-scores",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    const seedValue = Number(req.query.seed);
    const seed = Number.isFinite(seedValue) && seedValue > 0 ? Math.round(seedValue) : 7;
    const countValue = Number(req.query.count);
    const count = Number.isFinite(countValue) ? Math.max(1, Math.min(32, Math.round(countValue))) : 1;

    try {
      const profile = await engineProfile(fixtureId);
      const startedAt = Date.now();
      const results = await playOpenFootballScores(profile, seed, count);
      res.set("Cache-Control", "no-store");
      res.json({
        results,
        engine: "open-football",
        teams: [results.length ? profile.teams[0].name : "", results.length ? profile.teams[1].name : ""],
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof OpenFootballUnavailableError) {
        req.log.error({ reason: error.message }, "Open Football batch unavailable");
        res.status(503).json({ error: error.message });
        return;
      }
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not play a batch with the Open Football engine",
      );
      res.status(502).json({ error: "The Open Football engine could not play these rounds." });
    }
  },
);

// The fixture played as a chain of individual contests: each channel of the
// pitch pairs a named attacker with a named defender, and the match is the
// sequence of those duels rather than a draw around a goal average. The board
// comes back with the result so the page can show both the reason and the
// consequence — who wins his channel, and what that turns into over 90 minutes.
router.get(
  "/football/matches/:fixtureId/duels",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    const trialsValue = Number(req.query.trials);
    const trials = Number.isFinite(trialsValue) ? Math.max(1, Math.min(20_000, Math.round(trialsValue))) : 2_000;
    const seedValue = Number(req.query.seed);
    const seed = Number.isFinite(seedValue) && seedValue > 0 ? Math.round(seedValue) : 1;

    try {
      const profile = await engineProfile(fixtureId);
      const startedAt = Date.now();
      const result = runDuelSimulation(profile, { trials, seed });
      res.set("Cache-Control", "no-store");
      res.json({
        fixtureId,
        teams: [profile.teams[0].name, profile.teams[1].name],
        short: [profile.teams[0].short, profile.teams[1].short],
        formation: [profile.teams[0].formation, profile.teams[1].formation],
        expectations: profile.expectations,
        elapsedMs: Date.now() - startedAt,
        ...result,
      });
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      req.log.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : undefined,
        },
        "Could not play the duel simulation",
      );
      res.status(502).json({ error: "The player duels could not be played right now." });
    }
  },
);

// The same duel board resolved once instead of sampled two thousand times: one
// match, its goal minutes, and the chain of contests that produced them. The
// duel route answers "what this fixture usually does"; this one answers "what
// this match does", and prints its reasoning so it can be checked after full
// time rather than taken on trust.
router.get(
  "/football/matches/:fixtureId/inevitability",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    try {
      const profile = await engineProfile(fixtureId);
      const startedAt = Date.now();
      const verdict = buildInevitability(profile);
      res.set("Cache-Control", "no-store");
      res.json({ elapsedMs: Date.now() - startedAt, ...verdict });
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof InevitabilityUnavailableError) {
        res.status(422).json({
          error: "This fixture has no contest to resolve. Its squads have no board to read.",
        });
        return;
      }
      req.log.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : undefined,
        },
        "Could not resolve the fixture",
      );
      res.status(502).json({ error: "The fixture could not be resolved right now." });
    }
  },
);

// Settling one fixture costs a real squad read upstream — seconds, not
// milliseconds — and the same fixture is asked for twice in normal use: once by
// the match page's tab, once by the date sweep. Nothing in the answer depends on
// the moment it is asked, so a short memo makes the second ask free and lets a
// half-finished date run be continued without paying for every fixture again.
const DECISION_TTL_MS = 10 * 60_000;
const DECISION_MEMO_LIMIT = 400;
const decisionMemo = new Map<number, { at: number; tree: ReturnType<typeof buildDecisionTree> }>();

function readDecisionMemo(fixtureId: number): ReturnType<typeof buildDecisionTree> | null {
  const hit = decisionMemo.get(fixtureId);
  if (!hit) return null;
  if (Date.now() - hit.at > DECISION_TTL_MS) {
    decisionMemo.delete(fixtureId);
    return null;
  }
  // Re-inserting moves it to the end, so the least recently asked goes first.
  decisionMemo.delete(fixtureId);
  decisionMemo.set(fixtureId, hit);
  return hit.tree;
}

function writeDecisionMemo(fixtureId: number, tree: ReturnType<typeof buildDecisionTree>): void {
  decisionMemo.set(fixtureId, { at: Date.now(), tree });
  while (decisionMemo.size > DECISION_MEMO_LIMIT) {
    const oldest = decisionMemo.keys().next().value;
    if (oldest === undefined) break;
    decisionMemo.delete(oldest);
  }
}

// The combined card: the same board the Inevitability tab reads, settled into
// every market the board supports, then shaded by the form, table, availability
// and market readings the other tabs show separately. One profile read, one
// engine run, so it costs the same as the Inevitability tab and can never
// disagree with it about the scoreline.
router.get(
  "/football/matches/:fixtureId/decision",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    const remembered = readDecisionMemo(fixtureId);
    if (remembered) {
      // The browser may hold it for the same window the server does; the payload
      // is derived from the board and does not change inside it.
      res.set("Cache-Control", "private, max-age=600");
      res.set("X-Decision-Cache", "hit");
      res.json({ elapsedMs: 0, cached: true, ...remembered });
      return;
    }

    try {
      const profile = await engineProfile(fixtureId);
      const startedAt = Date.now();
      const verdict = buildInevitability(profile);
      const tree = buildDecisionTree(profile, verdict);
      writeDecisionMemo(fixtureId, tree);
      res.set("Cache-Control", "private, max-age=600");
      res.set("X-Decision-Cache", "miss");
      res.json({ elapsedMs: Date.now() - startedAt, cached: false, ...tree });
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof InevitabilityUnavailableError) {
        res.status(422).json({
          error: "This fixture has no contest to resolve. Its squads have no board to read.",
        });
        return;
      }
      req.log.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : undefined,
        },
        "Could not settle the decision tree",
      );
      res.status(502).json({ error: "The markets could not be settled right now." });
    }
  },
);

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
      const profile = await engineProfile(fixtureId);
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

// The engine's own broadcast viewer: the Bevy renderer upstream ships,
// compiled to WebAssembly, fed with this fixture's recording. The page, its
// two assets and the position chunks all live under one path, so the frame is
// same-origin with the app and needs no cross-origin allowance.
const viewerBase = (fixtureId: number) =>
  `/api/football/matches/${fixtureId}/open-football-viewer`;

router.get(
  "/football/matches/:fixtureId/open-football-viewer",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }
    if (!openFootballViewerReady()) {
      res.status(503).json({ error: "The Open Football viewer has not been built." });
      return;
    }

    const seedValue = Number(req.query.seed);
    const seed = Number.isFinite(seedValue) && seedValue > 0 ? Math.round(seedValue) : 7;

    try {
      const profile = await engineProfile(fixtureId);
      const recording = await openFootballViewerRecording(profile, seed);
      res.set("Cache-Control", "no-store");
      res.type("html").send(renderViewerPage(recording, viewerBase(fixtureId)));
    } catch (error) {
      if (sendUpstreamRateLimit(res, error)) return;
      if (error instanceof KickoffScoreMatchNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof OpenFootballUnavailableError) {
        req.log.error({ reason: error.message }, "Open Football viewer unavailable");
        res.status(503).json({ error: error.message });
        return;
      }
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not open the fixture in the Open Football viewer",
      );
      res.status(502).json({ error: "The Open Football viewer could not open this match." });
    }
  },
);

router.get(
  "/football/matches/:fixtureId/open-football-viewer/static/:asset",
  async (req, res): Promise<void> => {
    const asset = req.params.asset;
    if (asset !== "match_viewer.js" && asset !== "match_viewer_bg.wasm") {
      res.status(404).json({ error: "No such viewer file." });
      return;
    }
    const file = asset === "match_viewer.js" ? viewerScriptPath() : viewerWasmPath();
    try {
      // Both files are held gzipped here and on disk: 22 MB of Bevy inflates
      // in the browser, and it streams into the wasm compiler from there.
      const body = await readFile(file);
      res.set("Content-Encoding", "gzip");
      res.set("Cache-Control", "private, max-age=86400");
      res.type(asset === "match_viewer.js" ? "text/javascript" : "application/wasm");
      res.send(body);
    } catch (error) {
      req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" });
      res.status(404).json({ error: "No such viewer file." });
    }
  },
);

// The chunk list: how many there are, how long each one runs, and how long the
// match was — the three numbers the viewer needs before it asks for a chunk.
router.get(
  "/football/matches/:fixtureId/open-football-viewer/metadata",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }
    const seedValue = Number(req.query.seed);
    const seed = Number.isFinite(seedValue) && seedValue > 0 ? Math.round(seedValue) : 7;

    try {
      const profile = await engineProfile(fixtureId);
      const recording = await openFootballViewerRecording(profile, seed);
      const body = await readFile(path.join(recording.dir, "metadata.json"));
      res.set("Cache-Control", "private, max-age=3600");
      res.type("application/json").send(body);
    } catch (error) {
      if (error instanceof OpenFootballUnavailableError) {
        res.status(503).json({ error: error.message });
        return;
      }
      res.status(404).json({ error: "This match has no recording yet." });
    }
  },
);

router.get(
  "/football/matches/:fixtureId/open-football-viewer/chunk/:index",
  async (req, res): Promise<void> => {
    const fixtureId = Number(req.params.fixtureId);
    const index = Number(req.params.index);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0 || !Number.isSafeInteger(index)) {
      res.status(400).json({ error: "Choose a valid match ID." });
      return;
    }

    const seedValue = Number(req.query.seed);
    const seed = Number.isFinite(seedValue) && seedValue > 0 ? Math.round(seedValue) : 7;

    try {
      const profile = await engineProfile(fixtureId);
      const recording = await openFootballViewerRecording(profile, seed);
      const body = await readFile(path.join(recording.dir, `chunk_${index}.json.gz`));
      // Written gzipped by the engine, handed over as-is.
      res.set("Content-Encoding", "gzip");
      res.set("Cache-Control", "private, max-age=3600");
      res.type("application/gzip").send(body);
    } catch (error) {
      if (error instanceof OpenFootballUnavailableError) {
        res.status(503).json({ error: error.message });
        return;
      }
      res.status(404).json({ error: "No such chunk in this recording." });
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
