# The match engine. Open Football (github.com/ZOXEXIVO/open-football) plays a
# fixture in Rust; `engine/of-replay` is the small bridge that reads a team
# sheet on stdin and writes the recording on stdout. Its crate pins the upstream
# tag, so this stage is the only place the engine is compiled.
FROM rust:1.99-bookworm AS engine
WORKDIR /engine
COPY engine/of-replay ./of-replay
RUN cd of-replay && cargo build --release

# One image runs both halves of the app: the Express API and the built React app.
# The API is not a thin proxy — Forensics and the odds board drive a real headless
# Chromium — so the image carries the browser and the shared libraries it needs.
FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production \
    PORT=5000 \
    WEB_DIST=/app/artifacts/browser-control/dist/public \
    PROCESSED_MATCH_DB_PATH=/data/processed-matches.sqlite

RUN corepack enable

WORKDIR /app

# Manifests first so a source edit does not re-run the dependency install.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY scripts ./scripts
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/browser-control/package.json ./artifacts/browser-control/

RUN pnpm install --frozen-lockfile

COPY artifacts ./artifacts

# Chromium plus the apt libraries it needs; --with-deps installs them as root.
RUN pnpm --filter @workspace/api-server exec playwright install --with-deps chromium

RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/browser-control run build \
 && pnpm --filter @workspace/api-server run build

# The SQLite archive lives on a mounted volume, never in the image layer.
RUN mkdir -p /data
VOLUME ["/data"]

# The API spawns this to play a fixture (`OF_REPLAY_BIN`, defaulted below).
COPY --from=engine /engine/of-replay/target/release/of_replay /app/engine/of-replay/target/release/of_replay

EXPOSE 5000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
