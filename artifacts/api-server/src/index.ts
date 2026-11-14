import app from "./app";
import { backfillStatus, resumeBackfill } from "./lib/backfill";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // A backfill left with work in it picks up where it stopped: the queue is in
  // SQLite, so a restart costs the fixture in flight and nothing else.
  resumeBackfill();
  const backfill = backfillStatus();
  if (backfill.queued > 0) {
    logger.info({ queued: backfill.queued, done: backfill.done }, "Continuing the decision backfill");
  }
});
