import { Router, type IRouter, type Request, type Response } from "express";
import { gzipSync } from "node:zlib";
import {
  DeleteAllFootballProcessedMatchesResponse,
  DeleteAllFootballTesterMatchesResponse,
  GetFootballProcessingForDateQueryParams,
  GetFootballProcessingForDateResponse,
  GetFootballTesterProcessingForDateQueryParams,
  GetFootballTesterProcessingForDateResponse,
  GetFootballProcessedMatchPayloadQueryParams,
  GetFootballProcessedMatchPayloadResponse,
  GetFootballProcessedMatchParams,
  GetFootballProcessedMatchResponse,
  GetFootballProcessedMatchesQueryParams,
  GetFootballProcessedMatchesResponse,
  GetFootballTesterMatchParams,
  GetFootballTesterMatchResponse,
  GetFootballTesterMatchesQueryParams,
  GetFootballTesterMatchesResponse,
  GetFootballTesterMatchPayloadQueryParams,
  GetFootballTesterMatchPayloadResponse,
  GetFootballProcessingJobParams,
  GetFootballProcessingJobResponse,
  StartFootballBulkProcessingBody,
  StartFootballBulkProcessingResponse,
  StartFootballTesterProcessingBody,
  StartFootballTesterProcessingResponse,
  type FootballProcessedMatchSummary,
  type FootballTesterMatchSummary,
  type FootballProcessingJob,
  type FootballProcessingJobStatus,
} from "@workspace/api-zod";
import {
  getKickoffScoreLeagueGoalAverage,
  getKickoffScoreMatchDetails,
} from "../lib/kickoffscore-match-details";
import { getKickoffScoreMatchLastFive } from "../lib/kickoffscore-last-five";
import { getKickoffScoreMatchTmp } from "../lib/kickoffscore-match-tmp";
import {
  deleteAllProcessedMatches,
  deleteAllTesterMatches,
  findAnyActiveProcessingJob,
  createProcessingJob,
  findActiveProcessingJob,
  getLatestProcessingJob,
  getProcessedMatchPayload,
  getProcessedMatchSummary,
  getProcessingJob,
  getTesterMatchPayload,
  getTesterMatchSummary,
  listTesterMatches,
  listProcessedMatches,
  saveProcessedMatch,
  saveTesterMatch,
  updateProcessingJob,
} from "../lib/processed-match-store";
import { getKickoffScoreFixtures } from "../lib/kickoffscore-fixtures";
import { UpstreamRateLimitError } from "../lib/upstream-rate-limit";
import { logger } from "../lib/logger";

const router: IRouter = Router();
type Fixture = Awaited<ReturnType<typeof getKickoffScoreFixtures>>["fixtures"][number];

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function fixtureIdFromUrl(value: string): number | null {
  try {
    const url = new URL(value);
    if (url.hostname !== "kickoffscore.com") return null;
    const match = url.pathname.match(/\/match\/[^/]+\/(\d+)\/?$/);
    const id = match ? Number(match[1]) : Number.NaN;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function uniqueFixtures(fixtures: Fixture[]): Fixture[] {
  const seen = new Set<string>();
  return fixtures.filter((fixture) => {
    const fixtureId = fixtureIdFromUrl(fixture.matchUrl);
    const key = fixtureId === null ? `url:${fixture.matchUrl}` : `id:${fixtureId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFinal(fixture: Fixture): boolean {
  return fixture.homeScore !== null &&
    fixture.awayScore !== null &&
    !/\b(not started|scheduled|postponed|cancelled|canceled|suspended|abandoned|in play|live|half[ -]?time|in progress)\b/i.test(fixture.status);
}

function outcome(home: number, away: number): NonNullable<FootballProcessedMatchSummary["actualOutcome"]> {
  return home > away ? "home" : home < away ? "away" : "draw";
}

function writeProgress(
  id: string,
  status: FootballProcessingJobStatus,
  counts: { processed: number; saved: number; skipped: number; failed: number },
  error: string | null,
) {
  return updateProcessingJob(id, {
    status,
    processedFixtures: counts.processed,
    savedFixtures: counts.saved,
    skippedFixtures: counts.skipped,
    failedFixtures: counts.failed,
    error,
  });
}

async function runProcessing(
  job: FootballProcessingJob,
  fixtures: Fixture[],
  targetDataset: "archive" | "tester" = "archive",
) {
  const counts = { processed: 0, saved: 0, skipped: 0, failed: 0 };
  const failedMatches: string[] = [];
  let stopMessage: string | null = null;
  writeProgress(job.id, "running", counts, null);

  for (const fixture of fixtures) {
    const fixtureId = fixtureIdFromUrl(fixture.matchUrl);
    if (fixtureId === null || (targetDataset === "archive" && !isFinal(fixture))) {
      counts.processed += 1;
      counts.skipped += 1;
      writeProgress(job.id, "running", counts, `${counts.skipped} fixture(s) skipped: no final score was available.`);
      continue;
    }

    try {
      const [details, lastFive, tmp] = await Promise.all([
        getKickoffScoreMatchDetails(fixtureId),
        getKickoffScoreMatchLastFive(fixtureId),
        getKickoffScoreMatchTmp(fixtureId),
      ]);
      const homeScore = targetDataset === "archive"
        ? details.match.home.score ?? fixture.homeScore
        : null;
      const awayScore = targetDataset === "archive"
        ? details.match.away.score ?? fixture.awayScore
        : null;
      if (targetDataset === "archive" && (homeScore === null || awayScore === null)) {
        counts.processed += 1;
        counts.skipped += 1;
        writeProgress(job.id, "running", counts, `${counts.skipped} fixture(s) skipped: no final score was available.`);
        continue;
      }

      let leagueAverageGoals: number | null = null;
      let leagueAverageMatches: number | null = null;
      let averageSource: FootballProcessedMatchSummary["averageSource"] = "unavailable";
      if (details.match.leagueId !== null && details.match.season !== null) {
        try {
          const average = await getKickoffScoreLeagueGoalAverage(
            details.match.leagueId,
            details.match.season,
          );
          leagueAverageGoals = average.goalsPerMatch;
          leagueAverageMatches = average.matchesCount;
          if (leagueAverageGoals !== null) averageSource = "season-standings-at-processing-time";
        } catch (error) {
          logger.warn(
            { fixtureId, errorName: error instanceof Error ? error.name : "UnknownError" },
            "League goal average was unavailable while archiving a match",
          );
          if (error instanceof UpstreamRateLimitError) {
            stopMessage = `KickoffScore asked us to pause requests. Wait ${error.retryAfterSeconds} seconds before restarting; processing stopped after ${counts.processed} of ${fixtures.length} fixtures.`;
          }
        }
      }

      const issueCount =
        details.issues.length +
        lastFive.issues.length +
        tmp.issues.length +
        (leagueAverageGoals === null ? 1 : 0);
      const matchDate = details.match.date instanceof Date
        ? details.match.date
        : new Date(String(details.match.date));
      const completeness = issueCount === 0 ? "complete" as const : "partial" as const;
      const commonSummary = {
        fixtureId,
        date: matchDate,
        competition: details.match.competition || fixture.competition,
        leagueId: details.match.leagueId,
        season: details.match.season,
        homeTeamName: details.match.home.name || fixture.homeTeam,
        awayTeamName: details.match.away.name || fixture.awayTeam,
        leagueAverageGoals,
        leagueAverageMatches,
        averageSource,
        completeness,
        issueCount,
        processedAt: new Date(),
      };
      if (targetDataset === "archive") {
        const summary: FootballProcessedMatchSummary = {
          ...commonSummary,
          homeScore: homeScore as number,
          awayScore: awayScore as number,
          actualOutcome: outcome(homeScore as number, awayScore as number),
          totalGoals: (homeScore as number) + (awayScore as number),
        };
        saveProcessedMatch(job.date.toISOString().slice(0, 10), summary, { details, lastFive, tmp });
      } else {
        const summary: FootballTesterMatchSummary = commonSummary;
        const prematch = {
          fixtureId,
          match: {
            date: matchDate.toISOString(),
            competition: details.match.competition || fixture.competition,
            leagueId: details.match.leagueId,
            season: details.match.season,
            home: {
              id: details.match.home.id,
              name: details.match.home.name || fixture.homeTeam,
            },
            away: {
              id: details.match.away.id,
              name: details.match.away.name || fixture.awayTeam,
            },
          },
          latestAvailableStandings: details.standings,
          leagueAverageGoals,
          leagueAverageMatches,
          averageSource,
          issues: {
            details: details.issues,
            lastFive: lastFive.issues,
            tmp: tmp.issues,
          },
        };
        saveTesterMatch(job.date.toISOString().slice(0, 10), summary, {
          prematch,
          lastFive,
          tmp,
        });
      }
      counts.saved += 1;
    } catch (error) {
      counts.failed += 1;
      failedMatches.push(`${fixture.homeTeam} vs ${fixture.awayTeam}`);
      logger.warn(
        { jobId: job.id, fixtureId, errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not process a KickoffScore match",
      );
      if (error instanceof UpstreamRateLimitError) {
        stopMessage = `KickoffScore asked us to pause requests. Wait ${error.retryAfterSeconds} seconds before restarting; processing stopped after ${counts.processed} of ${fixtures.length} fixtures.`;
      }
    }

    counts.processed += 1;
    const progressError = stopMessage ??
      (counts.failed
        ? `${counts.failed} match(es) failed to load all analysis data${failedMatches.length ? `: ${failedMatches.slice(0, 3).join("; ")}` : ""}.`
        : counts.skipped
          ? `${counts.skipped} fixture(s) skipped: no final score was available.`
          : null);
    writeProgress(job.id, "running", counts, progressError);
    if (stopMessage) break;
  }

  const notAttempted = fixtures.length - counts.processed;
  const status: FootballProcessingJobStatus =
    counts.failed === 0 && counts.skipped === 0 && notAttempted === 0
      ? "completed"
      : counts.saved > 0
        ? "partial"
        : "failed";
  const error = stopMessage ??
    (counts.failed
      ? `${counts.failed} match(es) failed to load all analysis data${failedMatches.length ? `: ${failedMatches.slice(0, 3).join("; ")}` : ""}.`
      : counts.skipped
        ? `${counts.skipped} fixture(s) skipped: no final score was available.`
        : notAttempted
          ? `Processing ended before ${notAttempted} fixture(s) could be attempted.`
          : null);
  writeProgress(job.id, status, counts, error);
}

router.get("/football/processings", (req, res): void => {
  const rawDate = req.query.date;
  const date = typeof rawDate === "string" ? validDate(rawDate) : null;
  const parsed = GetFootballProcessingForDateQueryParams.safeParse({
    date: date ? new Date(`${date}T00:00:00.000Z`) : null,
  });
  if (!date || !parsed.success) {
    res.status(400).json({ error: "Choose a valid match date." });
    return;
  }
  res.json(
    GetFootballProcessingForDateResponse.parse({
      job: getLatestProcessingJob(date),
    }),
  );
});

router.get("/football/tester-processings", (req, res): void => {
  const rawDate = req.query.date;
  const date = typeof rawDate === "string" ? validDate(rawDate) : null;
  const parsed = GetFootballTesterProcessingForDateQueryParams.safeParse({
    date: date ? new Date(`${date}T00:00:00.000Z`) : null,
  });
  if (!date || !parsed.success) {
    res.status(400).json({ error: "Choose a valid match date." });
    return;
  }
  res.json(
    GetFootballTesterProcessingForDateResponse.parse({
      job: getLatestProcessingJob(date, "tester"),
    }),
  );
});

router.post("/football/processings", async (req, res): Promise<void> => {
  const input = StartFootballBulkProcessingBody.safeParse(req.body);
  const date = validDate(req.body?.date);
  if (!input.success || !date || date >= new Date().toISOString().slice(0, 10)) {
    res.status(400).json({ error: "Choose a valid date earlier than today." });
    return;
  }

  const active = findActiveProcessingJob(date);
  if (active) {
    res.status(202).json(StartFootballBulkProcessingResponse.parse(active));
    return;
  }

  try {
    const page = await getKickoffScoreFixtures(date);
    const fixtures = uniqueFixtures(page.fixtures);
    const activeAfterFetch = findActiveProcessingJob(date);
    if (activeAfterFetch) {
      res.status(202).json(StartFootballBulkProcessingResponse.parse(activeAfterFetch));
      return;
    }
    const job = createProcessingJob(date, fixtures.length);
    res.status(202).json(StartFootballBulkProcessingResponse.parse(job));
    setImmediate(() => {
      void runProcessing(job, fixtures).catch((error: unknown) => {
        logger.error(
          { jobId: job.id, errorName: error instanceof Error ? error.name : "UnknownError" },
          "Bulk match processing job failed",
        );
        const current = getProcessingJob(job.id);
        if (current) {
          writeProgress(job.id, "failed", {
            processed: current.processedFixtures,
            saved: current.savedFixtures,
            skipped: current.skippedFixtures,
            failed: current.failedFixtures,
          }, "Processing stopped unexpectedly. Previously saved matches remain available.");
        }
      });
    });
  } catch (error) {
    if (error instanceof UpstreamRateLimitError) {
      res.set("Retry-After", String(error.retryAfterSeconds)).status(429).json({
        error: `KickoffScore is rate limiting requests. Wait ${error.retryAfterSeconds} seconds and try again.`,
      });
      return;
    }
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Could not load fixtures for bulk processing",
    );
    res.status(502).json({ error: "KickoffScore fixtures could not be loaded right now. Please try again." });
  }
});

router.post("/football/tester-processings", async (req, res): Promise<void> => {
  const input = StartFootballTesterProcessingBody.safeParse(req.body);
  const date = validDate(req.body?.date);
  if (!input.success || !date || date >= new Date().toISOString().slice(0, 10)) {
    res.status(400).json({ error: "Choose a valid date earlier than today." });
    return;
  }

  const active = findActiveProcessingJob(date, "tester");
  if (active) {
    res.status(202).json(StartFootballTesterProcessingResponse.parse(active));
    return;
  }

  try {
    const page = await getKickoffScoreFixtures(date);
    const fixtures = uniqueFixtures(page.fixtures);
    const activeAfterFetch = findActiveProcessingJob(date, "tester");
    if (activeAfterFetch) {
      res.status(202).json(StartFootballTesterProcessingResponse.parse(activeAfterFetch));
      return;
    }
    const job = createProcessingJob(date, fixtures.length, "tester");
    res.status(202).json(StartFootballTesterProcessingResponse.parse(job));
    setImmediate(() => {
      void runProcessing(job, fixtures, "tester").catch((error: unknown) => {
        logger.error(
          { jobId: job.id, errorName: error instanceof Error ? error.name : "UnknownError" },
          "Pre-match tester processing job failed",
        );
        const current = getProcessingJob(job.id);
        if (current) {
          writeProgress(job.id, "failed", {
            processed: current.processedFixtures,
            saved: current.savedFixtures,
            skipped: current.skippedFixtures,
            failed: current.failedFixtures,
          }, "Processing stopped unexpectedly. Previously saved tester records remain available.");
        }
      });
    });
  } catch (error) {
    if (error instanceof UpstreamRateLimitError) {
      res.set("Retry-After", String(error.retryAfterSeconds)).status(429).json({
        error: `KickoffScore is rate limiting requests. Wait ${error.retryAfterSeconds} seconds and try again.`,
      });
      return;
    }
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Could not load fixtures for tester processing",
    );
    res.status(502).json({ error: "KickoffScore fixtures could not be loaded right now. Please try again." });
  }
});

router.get("/football/processings/:jobId", (req, res): void => {
  const params = GetFootballProcessingJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose a valid processing job." });
    return;
  }
  const job = getProcessingJob(params.data.jobId);
  if (!job) {
    res.status(404).json({ error: "Processing job was not found." });
    return;
  }
  res.json(GetFootballProcessingJobResponse.parse(job));
});

router.get("/football/processed-matches", (req, res): void => {
  const rawDate = req.query.date;
  const date = rawDate === undefined
    ? undefined
    : typeof rawDate === "string"
      ? validDate(rawDate)
      : null;
  const parsed = GetFootballProcessedMatchesQueryParams.safeParse({
    ...(date ? { date: new Date(`${date}T00:00:00.000Z`) } : {}),
    limit: req.query.limit ?? 100,
    offset: req.query.offset ?? 0,
  });
  if (!parsed.success || (rawDate !== undefined && date === null)) {
    res.status(400).json({ error: "Use a valid date, a limit from 1 to 500, and a non-negative offset." });
    return;
  }
  const result = listProcessedMatches({
    date: date ?? undefined,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });
  res.json(GetFootballProcessedMatchesResponse.parse({
    ...result,
    date: date ? new Date(`${date}T00:00:00.000Z`) : null,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  }));
});

router.get("/football/tester-matches", (req, res): void => {
  const rawDate = req.query.date;
  const date = rawDate === undefined
    ? undefined
    : typeof rawDate === "string"
      ? validDate(rawDate)
      : null;
  const parsed = GetFootballTesterMatchesQueryParams.safeParse({
    ...(date ? { date: new Date(`${date}T00:00:00.000Z`) } : {}),
    limit: req.query.limit ?? 100,
    offset: req.query.offset ?? 0,
  });
  if (!parsed.success || (rawDate !== undefined && date === null)) {
    res.status(400).json({ error: "Use a valid date, a limit from 1 to 500, and a non-negative offset." });
    return;
  }
  const result = listTesterMatches({
    date: date ?? undefined,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });
  res.json(GetFootballTesterMatchesResponse.parse({
    ...result,
    date: date ? new Date(`${date}T00:00:00.000Z`) : null,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  }));
});

router.delete("/football/processed-matches", (_req, res): void => {
  const activeJob = findAnyActiveProcessingJob("archive");
  if (activeJob) {
    res.status(409).json({
      error: `Wait for the ${activeJob.date.toISOString().slice(0, 10)} import to finish before clearing the archive.`,
    });
    return;
  }
  res.json(
    DeleteAllFootballProcessedMatchesResponse.parse({
      deletedCount: deleteAllProcessedMatches(),
    }),
  );
});

router.delete("/football/tester-matches", (_req, res): void => {
  const activeJob = findAnyActiveProcessingJob("tester");
  if (activeJob) {
    res.status(409).json({
      error: `Wait for the ${activeJob.date.toISOString().slice(0, 10)} tester job to finish before clearing tester records.`,
    });
    return;
  }
  res.json(
    DeleteAllFootballTesterMatchesResponse.parse({
      deletedCount: deleteAllTesterMatches(),
    }),
  );
});

router.get("/football/processed-match-payload", (req, res): void => {
  const params = GetFootballProcessedMatchPayloadQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: "Choose a valid match ID and payload section." });
    return;
  }
  const payload = getProcessedMatchPayload(
    params.data.fixtureId,
    params.data.section,
  );
  if (payload === null) {
    res.status(404).json({ error: "Saved match was not found." });
    return;
  }
  const response = GetFootballProcessedMatchPayloadResponse.parse({
    fixtureId: params.data.fixtureId,
    section: params.data.section,
    payload,
  });
  const serialized = JSON.stringify(response);
  if (req.acceptsEncodings("gzip")) {
    const compressed = gzipSync(serialized);
    res
      .status(200)
      .type("application/json")
      .set("Content-Encoding", "gzip")
      .vary("Accept-Encoding")
      .set("Content-Length", String(compressed.byteLength))
      .end(compressed);
    return;
  }
  res.json(response);
});

router.get("/football/tester-match-payload", (req, res): void => {
  const params = GetFootballTesterMatchPayloadQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: "Choose a valid match ID and payload section." });
    return;
  }
  const payload = getTesterMatchPayload(
    params.data.fixtureId,
    params.data.section,
  );
  if (payload === null) {
    res.status(404).json({ error: "Tester record was not found." });
    return;
  }
  const response = GetFootballTesterMatchPayloadResponse.parse({
    fixtureId: params.data.fixtureId,
    section: params.data.section,
    payload,
  });
  const serialized = JSON.stringify(response);
  if (req.acceptsEncodings("gzip")) {
    const compressed = gzipSync(serialized);
    res
      .status(200)
      .type("application/json")
      .set("Content-Encoding", "gzip")
      .vary("Accept-Encoding")
      .set("Content-Length", String(compressed.byteLength))
      .end(compressed);
    return;
  }
  res.json(response);
});

router.get("/football/processed-matches/:fixtureId", (req, res): void => {
  const params = GetFootballProcessedMatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose a valid match ID." });
    return;
  }
  const match = getProcessedMatchSummary(params.data.fixtureId);
  if (!match) {
    res.status(404).json({ error: "Saved match was not found." });
    return;
  }
  res.json(GetFootballProcessedMatchResponse.parse(match));
});

router.get("/football/tester-matches/:fixtureId", (req, res): void => {
  const params = GetFootballTesterMatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose a valid match ID." });
    return;
  }
  const match = getTesterMatchSummary(params.data.fixtureId);
  if (!match) {
    res.status(404).json({ error: "Tester record was not found." });
    return;
  }
  res.json(GetFootballTesterMatchResponse.parse(match));
});

export default router;
