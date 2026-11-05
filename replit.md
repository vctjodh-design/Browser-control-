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
tactics, fouls and cards, set pieces) under `src/sim3d/`.

The simulation is fed by real match data rather than scripted outcomes.
`GET /api/football/matches/:id/sim-profile` (`lib/sim-form-profile.ts`) reads the
last 15 results per club for form, the team statistics and player ratings of the
eight most recent completed fixtures for style and impact, and predicts an XI by
scoring every (formation slot, player) pair from squad grids, appearance
frequency, ratings and recency. Nothing in the profile picks a winner; the game
blends the style with its own baseline, nudges each player's role attributes by
their finishing/creation/retention/defending/duel/discipline/intelligence signals,
and lets the match play out. The profile is cached for three minutes and degrades
to the default squads when the source is thin.

Three descriptive inputs sit on top of that, all bounded so the match is still
played out:

- **League table.** The fixture's own standings row is attached to each club
  (`table.rank/points/edge`). The distance from the league's average points per
  game nudges squad quality by at most ±0.012 and shifts press/line/risk by a few
  hundredths; it never decides the result.
- **Player intelligence.** Each player gets an `intelligence` signal built from
  pass volume and accuracy, key passes and discipline, which the engine maps onto
  vision, composure, marking and discipline. It shows as the green IQ number in
  the predicted XI.
- **Shape.** The archive labels almost every club 4-2-3-1, so when a club's sheets
  all agree the shape is read from the XI instead: midfielders are split into
  holders and players ahead of the ball by their own defensive and creative
  output (`formationSource: "roles"`, badged "roles" in the panel). When the
  sheets do disagree their own label wins.

The match page stashes the profile in session storage for the frame
(`sim-form-profile:<fixtureId>`), so `boot.js` applies it before the engine builds
the squads and a Restart keeps it. The panel shows each club's form run,
formation, table position, points per game and predicted XI under the pitch.

### Batch runs

The panel above the pitch takes a match count (1–50), a speed from 1× to 20× and
a Run/Stop button, and lists every scoreline once the batch finishes. The engine
owns the loop: `main.js` replays the same fixture with unchanged squads and
tactics through `Match.restartMatch()` and posts `sim-series-start`,
`sim-series-round` and `sim-series-done` back to the panel over `postMessage`.
Above 4× the engine stops drawing frames so the match clock, not the GPU, sets
the pace; the pitch shows a progress card instead, and the results list follows
the batch. The panel and frame are same-origin, so messages are matched on
`event.origin` and `event.source`.

### Odds, and settling them against the match

The Odds tab keeps the whole board, not just the best price. `GET
/api/football/matches/:id/odds-board` (`lib/odds-board.ts`) reads the source's
odds endpoint and keeps every bookmaker's price, opening price and previous move
for every selection — around 2,300 quotes across 26 books and 55 markets for a
typical fixture — with the margin-free probability alongside wherever the market
is a closed set of outcomes.

Two things about that feed need correcting before settlement can be trusted, and
both are handled at ingestion:

- **Inverted away handicaps.** The feed writes one side's handicap with the
opposite sign (away `-0.5` is priced like away `+0.5`). The board reads each
side's price ladder instead of trusting the label — in the usual convention a
bigger head start is always more likely — and flips that side's lines when the
curve runs the other way. Each selection carries the corrected `handicapLine`, so
settlement uses the line the price actually means.
- **Odd selection strings.** The same feed mixes `"Over 2.5"`, `"Over 1"`,
`"Player - 2"`, bare player names and `"more 3"` under headings that suggest
something else. Settlement parses each one and falls back to the 1+ line where a
book lists only the player.

Settlement itself (`lib/match-settlement.ts`) covers every market in the board —
1X2 and its halves, double chance, Asian handicaps with quarter lines,
goal/team/corner/card lines with pushes, exact and half scores, HT/FT, BTTS,
clean sheets, draw-no-bet, result-and-total combinations, odd/even, exotic team
markets and player props. Quarter lines split into two half stakes and a push
returns the stake, so a batch reports wins, half-wins, pushes and losses rather
than a single muddy yes/no.

### Thousands of rounds

A watched match costs seconds of CPU, so asking for thousands of replays needs a
model rather than a tick loop. `lib/fast-match-sim.ts` plays the same fixture from
the same inputs the 3D engine uses — each club's goals scored and conceded per
game (shrunk towards the league average), the quality of the predicted XI, its
tactics and league position — and emits the same match record: goals with minutes
and scorers, halves, corners, cards and shots on target per player. No price ever
enters it.

`POST /api/football/matches/:id/odds-simulation` (`lib/odds-simulation.ts`) runs
that engine for the requested number of rounds (up to 100,000), settles every
selection on the board against every round, and returns, per selection, the
simulated probability, the margin-free market probability, the best price and
book, the expected value at that price and the difference between the two.
A full board is about 930 selections across ~50 markets, and settling each one
used to re-parse its market and selection strings on every round — a dozen
regexes per selection per match, which dwarfed the match engine. 1,000 rounds
cost 4.7s and a 100,000-round batch would have taken **7.7 minutes**. Each
selection is now compiled once (`compileSettlement` in `lib/match-settlement.ts`)
into an outcome test that reads only finished numbers, and the watched match
settles through the same compiled code, so the two cannot disagree. Same board,
measured after: 3,000 rounds in 0.27s, 25,000 in 2.0s, **100,000 in 6.6s**. The
run is synchronous, so a six-figure batch does hold the event loop for those
seconds.

The rewrite was checked against the old implementation by capturing 984
selections (every market on a real board plus the branches it does not carry)
against 48 synthetic matches — 47,232 settlements — and diffing the JSON: byte
identical, outcomes and detail strings both. `test/match-settlement.test.mjs`
keeps the compiled path pinned to `settleSelection`.

`POST /api/football/matches/:id/odds-settle` grades the board against one match
record. The match page's own frame posts `sim-match-summary` at full time
(including a 1-round batch, which is the path that skips rendering), the Odds tab
settles against it and shows what each selection would have returned at the best
price. Watching a match and simulating 5,000 are therefore graded by identical
rules.

### Making the match look like football

`GET` nothing here matters if the played match is a basketball score, and for a
while it was: measured headlessly over a dozen matches the engine averaged **6.1
goals**, with 62% of shots on target and no 0-0 at all. Three things were wrong,
and all three were about the defending team rather than the attack:

- **Shots were laser-guided.** The angular spread was far too tight, so almost
every shot from the edge of the box hit the frame. It now scales harder with
range, pressure and fatigue, which is what produces the wide and over-hit shots
that make up most of a real match.
- **Nobody blocked anything.** A defender goal-side of the shooter and inside
3.4m now gets in the way with a chance that rises with his defending attribute
and falls with distance — the packed box behaves like a packed box.
- **An on-target shot was a goal.** The keeper only stopped shots the ball
physically ran into; a shot aimed at the far corner beat him by geometry every
time. He now gets a save chance at the line based on how far he has to travel,
how hard and how high the ball is hit, his reflexes and his legs.

The same twelve-match bench now reads **2.56 goals a match**, 51% of shots on
target, with 0-0, 1-0, 2-0, 1-1 and 3-2 all turning up in proportion — close to
the batch model, so a played match and a simulated one agree. `engine-bench.mjs`
at the repo root replays N matches headlessly and prints the distribution, which
is how these numbers were checked.

### Legs, and thinking before the pass

A match also has to look like ninety minutes rather than a sprint. Each player
carries stamina that drains with the square of his speed and comes back only
when he is jogging, with a top-up at half time. Fatigue used to be cosmetic —
the speed multiplier bottomed out at 0.84 — so everyone ran the full game at
near full pace. It now bottoms out around 0.62, an exhausted player cannot
sprint at all, and tired legs cost real time on the ball (reaction rises by up
to 0.16s), turn a tired midfielder into a sideways passer, spread shots wider
and weaken tackles and saves. The last twenty minutes visibly slow down.

## Forensics reads KickoffScore, not just the import

The Forensics tab used to answer `404 One or both teams do not have imported
match records` on a fresh install, because it bailed out when `fair_ai_teams`
had no row for the selected club — and the import database starts empty. A match
page names its clubs straight from the fixture as `id:<teamId>`, which is already
a KickoffScore ID, so the archive lookup is now only a first try: the ID is read
straight off the team key and the last ten matches are pulled from KickoffScore
before the analysis runs. Saving those matches is a side effect, so the "Source
backed data" counters fill in after the first review.

## Forensics prices every market

The Forensics tab used to end in the same two chips — "No clear result edge" and
"Open scoring lean" — because its four picks were sample rates, and a pick was
withheld ("No clear pick") whenever the points-per-match gap was under 0.35. With
two evenly matched clubs that condition is almost always true, so the review
could not answer the question it exists to answer.

The market board now builds a scoreline matrix instead of tallying wins, draws
and losses. When the match page hands the panel the fixture's odds board, the
matrix is the one already fitted to the bookmaker prices by
`analyzeOddsExpectation` (all 55 markets, normalised); otherwise it falls back to
a Poisson model of each side's scoring and conceding averages, shrunk toward 1.35
goals so a short sample cannot swing it. Every market is then a sum over that
same matrix: 1X2, double chance, draw no bet, BTTS, over/under 1.5/2.5/3.5, goal
parity, each side's 1.5 line, clean sheets, win to nil, home -1 and correct
score — fifteen cards, each with a modelled percentage, the next-best outcome
and a confidence band. A strip above the grid names the strongest pick, and
skipping the coin-flip parity market keeps it honest. Boxes marked `high` are
≥72%, `moderate` ≥58%: a 44.9% home win is correctly labelled Low confidence
even when it is the most likely outcome.

The direction card was also stale. Area winners can tie 3-3 while most
individual metrics point one way, which left every review on "no clear edge"
even with a decisive split underneath. It now counts the metrics as well as the
areas, calls a lean when the metric split is ≥55% and the area margin is at
least one, prints the actual split ("4-5 across 9 measures") and the model goal
total, and shows a **Priced read** line with the 1X2, over/under 2.5 and BTTS
probabilities so the evidence and the prices sit side by side.

## The board prices the afternoon

The live match is now asked to land near what the market and the clubs' own
records say it should. `deriveMatchModel` reads the goal lines, both teams' "to
score" prices, both teams to score, the clean-sheet markets and each side's
corner lines, fits an expectation to them (P(0) = e^-x gives a side's own goal
mean straight from its chance of scoring) and hands the result to the engine as
targets. There is a small strip above the form cards — `sim-market-targets` —
showing exactly those numbers, so the match and the board can be compared
without guessing.

Targets never pick a result. They do two things. A side that is ahead of its own
expectation meets a scoring gate: the next goal gets meaningfully harder, which
is what stops a ten-goal afternoon while leaving an even match untouched. And
blocks and saves now go behind for corners at a rate driven by how far short of
the corner expectation the match is, so a quiet game still produces the five or
six corners the clubs actually average.

That work uncovered a real bug: the engine writes the last touch onto the ball,
but the boundary check read a match-level `lastTouchTeam` that was never
updated. Every out-of-play restart was therefore decided from `null` — throw-ins
all went to one side and **no side ever won a corner**, which is why corners
looked broken and why the home team in particular never got one. Reading the
ball's own last touch fixed the throw-ins, the goal kicks and the corner
trigger.

A match also has a clock in the football sense. Shooting appetite follows a tempo
curve — sides feel each other out for the first eight minutes, the game loosens
before the break, and the last twenty minutes are the ones where tired teams
chase it. Before this, goals arrived almost uniformly and only about one match
in eight reached half time goalless; the bench now reads roughly a third, which
is what a real league does.

Shots also say where they came from. Commentary distinguishes a close-range
scramble from a shot at the edge of the box and from a hopeful one 28m out, and
the shot carries its range with it, so a live match does not read as twenty
identical entries. Measured over the bench, about two thirds of shots come from
inside the box and the rest from outside it.

Nobody decides instantly either: every action waits out a reaction timer of
roughly 0.16–0.40s that lengthens with fatigue and shortens with composure, and
then picks from scored options — space, risk, whether the pass goes forward, how
far the man is from goal, and whether he is making a run. Anything that still
has to be won is won physically: `tryTackle` is a contest weighted by strength,
defending and a tired opponent's drop in balance, blocked shots need a defender
goal-side inside 3.4m, and the rest of the shots simply miss.

### Played against the targets

The engine plays from the squads and their numbers; the fixture's targets (the
market's or the clubs' own) are carried alongside. Each odds-simulation result
now also reports `expectations` and a `comparison` row per metric — total, home
and away goals, over 2.5, both teams score, each clean sheet and corners — with
the played value, the target, the gap and a verdict of `over`, `under` or
`as-expected` (within 0.15 goals, 0.03 of a probability, 0.4 corners). The panel
renders it as **Played against the targets**, so an under is a real disagreement
between the football the squads produce and the price the board is offering, not
a restatement of the odds. A sample 100,000-round run on a 3.14-goal fixture read
2.73 goals played — under — with both clean sheets over, which is the fast
engine's known shape.

The 3D panel gained the same read for the matches it plays: under the series
summary, a `vs targets` strip (home, away and total) with the played average, the
target and the verdict. Tolerance is 0.2 goals per match, because a batch of up
to fifty matches is a small sample.

### The Open Football engine

The pitch can also be filled by a real match engine instead of by this app's own
simulation. [Open Football](https://github.com/ZOXEXIVO/open-football) is a
Football-Manager-scale simulator written in Rust: squads of twenty-two players
with ~49 individual attributes, a state machine per player, ball physics, a
referee, substitutions, and a recording of where everyone was.

`engine/of-replay` is the bridge — a ~500-line crate whose only dependency is
the engine's own `core` crate, pinned to upstream tag `v1.8.183`. It reads one
fixture on stdin (two elevens, a role and a 1–20 level each, a formation, a
seed), plays the match with position recording on, and writes one JSON document:
score, goals with minutes, substitutions, per-side shots/possession, the ball's
flight, and every player's position every 400 ms of match time.

`GET /api/football/matches/:id/open-football-replay?seed=`
(`lib/open-football-replay.ts`) builds that fixture from the same predicted XI
the rest of the app reads — the league-table edge sets the squad's level, each
player's impact moves him within it — spawns the binary, and returns the
recording, gzipped, cached per (fixture, seed). A real board (AEK v Real Madrid,
28 players) is 6.7 MB of JSON, 2.2 MB on the wire, about 6 s of engine time on
8 cores and 16 s including the form profile.

The Live tab's engine button now hands the frame to the engine's **own broadcast
viewer**: the Bevy renderer upstream ships (`src/match`), compiled to WebAssembly
(22 MB, 7 MB gzipped) and fed this fixture's recording. The pitch, the stands,
the mow stripes, the crowd, the ad boards, the kits, the name labels and the
broadcast scoreboard are the GitHub project's own, drawn by its code — not that
movement re-drawn in the house stadium.

The bridge writes that format directly. `--viewer <dir>` plays the fixture and
writes what the viewer reads: the recording cut into five-minute position
chunks, each gzipped; a metadata document (chunk count, chunk length, match
length); and the fixture document — teams, colours, goals, chances,
substitutions, and every man's name, shirt, role and starting place. Almost all
of that the bridge already had; only the chunk shape and the page document are
new. `lib/open-football-viewer.ts` caches one such directory per (fixture, seed)
and serves `GET /api/football/matches/:id/open-football-viewer` — the page —
with its two WebAssembly files and the chunks under the same path, so the frame
is same-origin with the app and needs no cross-origin allowance. A first request
plays the match (~15 s); after that the page and its chunks come off disk.

The engine's own quality switches pass straight through (`?crowd=off`,
`?grain=spare`, `?squad=off`). They are not decoration: the full scene holds
195 MB of GPU assets, and a machine without a real GPU — the cloud preview's
software WebGL included — loses the context mid-match at that size and keeps it
with the crowd off.

The recording still also plays through `src/sim3d/sim/replay.js`
(`?engine=open-football` on the house frame), which interpolates the tracks into
pitch metres and raises the house HUD, camera and audio events. The Live tab no
longer uses it: that was the complaint — the movement was the engine's but the
picture was ours.

Honest limits: the engine's decision RNG draws from OS entropy, so the same seed
does *not* reproduce the same scoreline — `seed` pins the shape of the play, not
the result. Two requests for the same fixture and seed are cached, so the page
and its chunks always agree with each other, but a fresh seed is a fresh match.
A 100k-round study of this engine is therefore not a thing yet; one match is.
And the recording carries no corners, so the corner counter reads zero in engine
mode. The Docker image compiles the crate in a `rust:1.99` stage, copies the
binary to `/app/engine/of-replay/target/release/of_replay`, and carries the
viewer's two gzipped files in `artifacts/api-server/assets/viewer`; that image
has not been built here (no Docker in this sandbox), only the native build.

### Reading the predictions
The simulation's answer sits above the markets: the result it favours, its most
likely scoreline and the nine scorelines that came up most. Every market header
then states the one thing the simulation expects from it — `calls Over 2.5 52%` —
chosen as the line nearest a coin flip rather than the 98% certain under that
would flatter the model; the selection it calls is tagged `pick` inside the
group. The edge against the price stays on the right of the header, so a market
can be read without expanding it.

What the player is actually fed: the last fifteen results, eight of them opened
up for team statistics and team sheets, the resulting per-player shot, pass and
duel output, the predicted XI and the league table. That becomes attribute
nudges, a formation and pressing/line/width/risk/tempo/direct settings — never a
result. What it does **not** read is commentary text, and the recent-results feed
carries no half-time scores, so first-half/second-half form is modelled from the
match clock rather than from each club's own splits. The fixture's own half-time
score is known to the page but only for the match being played.

The market simulation sits **above** the bookmaker board, not under it: fifty-odd
markets of prices push a panel below them out of sight, which is where it used
to live. The replay tab also carries a card linking straight to it, because a
tab that plays one match at a time is not where anyone would look for ten
thousand.

One divergence is deliberate: the model's card rate (~3.9 a match) sits above
what this source's card lines imply (~2.6), so card markets show a systematic
edge. That is the simulation disagreeing with the price, which is the point — the
prices are never used to nudge the football.

## The match thinks in phases, not in rushes

The 3D engine used to attack the same way from kick-off to full time: whoever
had the ball drove at the goal, the nearest four defenders swarmed him, and the
only pass on offer was forward. Every match therefore looked like a charge at
the box with no build-up, no back pass, and a keeper who never touched the ball.

`tactics.js` now publishes a phase — `build` (< 36% of the way up the pitch),
`progress`, `final` — and both the shape and the pass choice read it:

- **Passing.** The keeper is a real option in his own third and the safe outlet
  under pressure; going backwards is normal in build-up instead of a last
  resort; switches of play beat forcing it through the crowded side; long balls
  are penalised past 22m (the mean pass was 23m). Passes are played into the
  space beside the receiver, and through the line when there is grass behind
the last defender.
- **Shape.** The striker holds the halfway line while the side builds, the DM
  drops behind the ball as a pivot with his partner ahead of it, wide men stay
  high as outlets, the back line holds around the halfway instead of retreating
  into its own box, and no more than three bodies occupy the box at once.
- **Duels.** Only the two nearest defenders jump to press, the interception
  corridor is a metre and a half rather than four, and a player gets one touch
  attempt per ball instead of one per frame.

**Offside is enforced.** There was no law at all: a forward could stand in the
box all game. The line is the second-last opponent *including the keeper*, judged
the instant the ball is played (`executePass` snapshots `offsideMen`) and read
when one of those men first touches it — any other touch ends the phase. The
free kick goes the other way from where he was standing. Throw-ins, corners and
goal kicks cannot flag anyone: `executeRestart` marks the kick so `executePass`
skips the snapshot. Attackers now hold the shoulder and time the run
(`keepOnside`, plus a per-run timing error) instead of parking beyond the line,
and pass selection ignores a man who is plainly offside — only a genuine runner
can be found a stride early.

**Players stay in their zones.** A centre-half no longer leaves the back line to
chase a ball in midfield (only the midfield presses when the carrier is more
than 18m ahead of the line), marking assignment is capped to 15m ahead instead
of 26m, a defender's target is clamped to ±7m around the line, and only the
nearest man goes to a loose ball, and only within 18m. `test/sim-offside.test.mjs`
covers the law, the onside case, the throw-in exemption and the defender
holding his line.

Two engine bugs mattered more than any tuning constant: the receiver chased a
fixed look-ahead point while the ball rolled past him (`meetPoint` now solves
for where he can actually arrive), and any player the ball rolled near could
"control" it, so half of all passes ended with the wrong team. Control now
requires the ball to be coming at the player, and one attempt per ball.

### Why scoring was lower than it looked

Six audited matches produced 31 shots and two goals. The audit gained a shot
funnel (`shot outcomes`, `crossings`, `shots reaching the line`) and the answer
was the goalkeeper, three times over:

- **He caught everything in flight.** `resolvePossession` gave the keeper a 3m
  reach and a ~100% control chance, so a 30 m/s shot passing within three metres
  of him was gathered on the way — 19 of 31 shots in one match died in his hands
  before reaching the line, on top of the line save he would have had anyway.
  A goal-bound ball at pace is now left to `keeperStops`; only slow balls (back
  passes, crosses dropping into his zone) are handled in flight.
- **One shot, many save rolls.** A smothered shot kept its 30 m/s velocity, which
  sent it back through the goal line on the next frame, so `keeperStops` rolled
  again — and again. The same passage of play could give him five attempts at
  the same shot, and 24 "stops" for 19 crossings. A saved ball now stops
  travelling, and one shot carries one attempt (`ball.attemptLive`).
- **The on-target board was predicted, not measured.** Shots were counted on
target from the aim before physics, so a board could read 22 on target from 18
  shots. It is now counted where the ball actually meets the frame, once per
  shot, which is also what `keeperStops` is graded on.

With those fixed and the shooting spread widened, eight full audited matches gave
21 goals — 2.6 a match against a real-football 2.7 — from ~20 shots each, with
13% of shots scored. `test/sim-scoring.test.mjs` locks the three behaviours: the
keeper's claim geometry, one shot = one attempt, and no in-flight gathering of a
goal-bound ball.

`scripts/sim-audit.mjs` plays ninety minutes headless (stub canvas, stub rigs)
and reports passes, completion, backward share, keeper involvement, thirds, box
occupancy, shot zones, the shot funnel and offsides with a seeded RNG, so a
change can be measured instead of judged by eye. `node scripts/sim-audit.mjs 420 label 1`.

## One container serves both halves

Hosting this elsewhere means one process, not two: `app.ts` mounts the API on
`/api` and then serves the built React app from `WEB_DIST`, falling back to
`index.html` for anything that is not an `/api/` path (so `/matches/1635669`
reloads instead of 404ing, and `/sim.html`, the iframe page, is served as a real
file). The browser already calls `/api/...` relative to its own origin, so the
same image works in dev behind Vite's proxy and in production behind nothing.
Hashed assets are cached for a year; `index.html` is `no-store`.

`Dockerfile` builds both and `fly.toml` describes the machine: 2 GB, always on,
a volume at `/data`. The SQLite archive is gitignored, so a container starts
empty and fills from KickoffScore — no seed data to ship. `DEPLOY.md` has the
steps and the reasons (2 GB is not padding: Chromium alone peaks near 500 MB).

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `vite.config.ts` throws without `PORT`, so builds and dev both need it:
  `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/browser-control run build`.
- A sandbox archive keeps `/workspace` but drops `node_modules`, the pnpm install
  in `$HOME/tools`, every process and `/tmp`. The preview then answers nothing and
  the editor says "Cloud preview unavailable" — that is the VM, not the app.
  `scripts/dev-up.sh` is the one-command recovery: it reinstalls from the lockfile,
  builds the API only if `dist` is missing, starts API `:5000` and app `:3000`,
  waits for both to answer and starts keepalive. It logs to `/tmp/logs/dev-up.log`
  and is safe to rerun. The preview hostname also changes on each restore, so the
  panel needs a retry/reload afterwards.
- The cloud preview only serves while something is listening on the app port, and
  a sandbox restore kills every process. `scripts/keepalive.mjs` (`pnpm keepalive`)
  polls app and API every 20s, restarts whichever stops answering, and reinstalls
  dependencies from the lockfile when `node_modules` is gone. Start it detached:
  `setsid nohup node scripts/keepalive.mjs > /tmp/logs/keepalive.log 2>&1 &`.
- The API refuses to boot without `PORT` as well; it serves `/api` on whatever
  port it is given (5000 locally, proxied by the app).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
