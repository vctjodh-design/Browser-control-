# Deploying

One container serves the whole app: the Express API on `PORT` and the built React
app from the same origin, so the browser's `/api/...` calls need no proxy and no
CORS config. `Dockerfile` builds both halves; `fly.toml` is a working Fly.io
description of it.

## What the host has to provide

| Requirement | Why |
| --- | --- |
| Docker | The image carries Node 24, the workspace packages and the built web app. |
| ~2 GB RAM | Chromium peaks around 500 MB during a scrape, on top of Node and tfjs. 512 MB instances will be killed mid-request. |
| A persistent volume at `/data` | `processed-matches.sqlite` is written by the archive and Forensics features. Without the volume the data is rebuilt after every deploy: slower first requests, nothing corrupt. |
| Always on | The odds board and Forensics drive a real headless Chromium per request; scaling to zero drops in-flight scrapes. |
| Outbound HTTPS | The API reads KickoffScore live; the `data/` SQLite file is gitignored and ships empty. |

Environment (already set in `fly.toml`):

```
PORT=5000
NODE_ENV=production
WEB_DIST=/app/artifacts/browser-control/dist/public
PROCESSED_MATCH_DB_PATH=/data/processed-matches.sqlite
```

There are no API keys to add: the app talks to public KickoffScore endpoints
through its own Chromium. Nothing here is a secret.

## Fly.io

```bash
# once
curl -L https://fly.io/install.sh | sh          # installs flyctl into ~/.fly
fly auth login                                  # or export FLY_API_TOKEN for CI

# name the app in fly.toml first (app = "..."), then:
fly apps create <your-app-name>
fly volumes create data --size 3 --region fra -a <your-app-name>
fly deploy -a <your-app-name>
```

The name in `fly.toml` and the one you pass to `fly` must match. Create the
volume once — a second one is left unattached, and the app keeps using the
first.

After the deploy:

```bash
fly status                       # machine started, health check passing
fly logs                         # "Serving the built web app" + no Chromium errors
curl -s https://<your-app-name>.fly.dev/api/healthz
curl -sI https://<your-app-name>.fly.dev/ | head -1     # 200, text/html
```

Then open a match page and load the Forensics tab — that is the one route that
proves Chromium and the SQLite volume are both working in the container.

## Other hosts

Anything that runs a Dockerfile with a mounted volume works: Render (Web
Service → Docker, add a Disk at `/data`, 2 GB instance), Railway, Koyeb, or a
plain VPS running `docker build -t football . && docker run -p 80:5000 -v
football-data:/data football` behind Caddy or nginx for TLS.

Serverless platforms are not an option: Cloudflare Workers, Vercel and Netlify
cannot run Chromium, `node:sqlite`, or a long-lived Express server.
