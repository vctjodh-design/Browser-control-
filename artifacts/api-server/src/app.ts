import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// One container serves both halves: the API above and the built SPA below, so the
// browser talks to the same origin it was loaded from and no proxy is needed.
const webDist = [
  process.env["WEB_DIST"],
  resolve(process.cwd(), "artifacts/browser-control/dist/public"),
  resolve(process.cwd(), "../browser-control/dist/public"),
].find((candidate) => candidate && existsSync(join(candidate, "index.html")));

if (webDist) {
  app.use(
    express.static(webDist, {
      index: "index.html",
      setHeaders(res, filePath) {
        // Hashed asset names are safe to cache; the shell must always be rechecked.
        res.setHeader(
          "Cache-Control",
          basename(filePath) === "index.html"
            ? "no-store"
            : "public, max-age=31536000, immutable",
        );
      },
    }),
  );
  app.get(/^\/(?!api\/)/, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(join(webDist, "index.html"));
  });
  logger.info({ webDist }, "Serving the built web app");
} else {
  logger.info({ webDist }, "No web build found, serving the API only");
}

export default app;
