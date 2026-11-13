#!/bin/sh
# Replit runs one port; this starts one process on it.
#
# The API already serves the built React app from the same origin (see
# artifacts/api-server/src/app.ts), so the preview only has to reach PORT. The
# two-server development setup — Vite on 3000, the API on 5000 — leaves nothing
# listening on the port Replit proxies to, and Vite refuses to start at all
# unless both PORT and BASE_PATH are set, which throws before anything binds.
# That combination is what a "Live preview unavailable" panel looks like.
set -e

cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
BASE_PATH="${BASE_PATH:-/}"
NODE_ENV=production
WEB_DIST="$PWD/artifacts/browser-control/dist/public"
export PORT BASE_PATH NODE_ENV WEB_DIST

echo "building web app for $BASE_PATH on port $PORT"
pnpm --filter @workspace/browser-control build

echo "building api"
pnpm --filter @workspace/api-server build

echo "serving api + web on port $PORT"
exec node artifacts/api-server/dist/index.mjs
