#!/usr/bin/env bash
# Bring the preview back after the VM is archived: dependencies, API, web app,
# keepalive. Safe to run repeatedly — anything already listening is left alone.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p /tmp/logs
# Detached children inherit this shell's fds, so never leave them on the caller's
# pipe — a `| tail` would otherwise wait forever for servers that never exit.
exec >>/tmp/logs/dev-up.log 2>&1

export PATH="$HOME/tools/node_modules/.bin:$PATH"
if ! command -v pnpm >/dev/null 2>&1; then
  echo "installing pnpm into $HOME/tools"
  mkdir -p "$HOME/tools" && (cd "$HOME/tools" && npm i pnpm@10 --no-audit --no-fund >/dev/null 2>&1)
  export PATH="$HOME/tools/node_modules/.bin:$PATH"
fi

listening() { ss -lptnH "sport = :$1" 2>/dev/null | grep -q LISTEN; }

if [ ! -d node_modules ]; then
  echo "installing workspace dependencies from the lockfile"
  pnpm install --frozen-lockfile >/tmp/logs/install.log 2>&1 || {
    echo "install failed, see /tmp/logs/install.log"; exit 1; }
fi

if ! listening 5000; then
  if [ ! -f artifacts/api-server/dist/index.mjs ]; then
    echo "building the API"
    pnpm --filter @workspace/api-server run build >/tmp/logs/api-build.log 2>&1 || {
      echo "API build failed, see /tmp/logs/api-build.log"; exit 1; }
  fi
  echo "starting the API on :5000"
  (cd artifacts/api-server && PORT=5000 setsid nohup node --enable-source-maps dist/index.mjs \
    >/tmp/logs/api.log 2>&1 </dev/null &)
fi

if ! listening 3000; then
  echo "starting the web app on :3000"
  (PORT=3000 BASE_PATH=/ API_PROXY_TARGET=http://127.0.0.1:5000 CI=1 setsid nohup \
    pnpm --filter @workspace/browser-control run dev >/tmp/logs/web.log 2>&1 </dev/null &)
fi

for _ in $(seq 1 40); do
  if curl -s -m 2 -o /dev/null http://127.0.0.1:3000/ && \
     curl -s -m 2 -o /dev/null http://127.0.0.1:5000/api/football/fair-ai/data; then
    break
  fi
  sleep 2
done

curl -s -m 5 -o /dev/null -w "app %{http_code} · " http://127.0.0.1:3000/ || true
curl -s -m 5 -o /dev/null -w "api %{http_code}\n" http://127.0.0.1:5000/api/football/fair-ai/data || true

if ! pgrep -f "node scripts/keepalive.mjs" >/dev/null 2>&1; then
  echo "starting keepalive"
  setsid nohup node scripts/keepalive.mjs >/tmp/logs/keepalive.log 2>&1 </dev/null &
fi
