# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server` — Express API behind `/api` (fixtures, match details, replay, models).
- `artifacts/browser-control` — the React app (fixtures, match centre, browser console).
- `artifacts/browser-control/sim.html` + `src/sim3d/` — the stadium match simulation embedded in the match page; it reads the fixture's teams, kit colours and venue from query parameters.
- `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` — OpenAPI contract and its generated client.
- `lib/db` — Drizzle schema and pool.

## Match simulation

Opening a fixture (`/matches/:id`) shows the fixture overview and then a live 3D
match: `sim.html` runs the simulation in an iframe so the game keeps its own HUD
and styles. It is a self-contained engine (utility-driven agents, fatigue,
tactics, fouls and cards, set pieces) under `src/sim3d/`; the host page only
supplies the two clubs, their colours and the venue.

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
