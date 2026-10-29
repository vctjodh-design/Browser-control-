---
name: FAIR AI target
description: The user's interaction-first target for football simulation and the data boundary that must remain explicit.
---

The user is building an interaction-first football simulator: start from the odds-translation scoreline and goals baseline, then explain how player roles, tactical systems, opponent strength, chance quality, and score phase support or contradict it. Keep the market baseline visible beside the FAIR AI adjustment and identify the evidence and coverage behind changes. Do not claim an exact proprietary FAIR AI replica unless that is verified. The current match-result models are not the FAIR reinforcement-learning simulator.

The five-match Tactical Root-Cause review is a separate, retrospective tool. Keep its observed outcomes and aggregate match statistics out of simulation inputs; report patterns as counts and do not assert causal mechanisms that aggregate data cannot verify.

The simulation must fetch the selected teams' latest completed match records directly from KickoffScore before each run. If fresh source data is unavailable, stop rather than silently using stale archive records.

The current pre-match simulation may use standings only when both teams have snapshots with valid, non-future observation timestamps no more than 30 days old. Normalize rank, points per game, goal difference, and recent league form into small bounded heuristic adjustments; do not use these snapshots in historical training. The source observation time is not guaranteed to be the table's effective date.

Use the complete available odds scoreline distribution as an explicit forecast prior, not merely as a shot-volume input. Keep FAIR AI's action simulation distinct, combine the two transparently, and let FAIR AI influence grow only with relevant evidence coverage. Show source gaps. 365Scores replay evidence must be matched by fixture date, teams, and score; commentary and shot-origin data do not establish continuous player tracking. xGOT−xG is only a placement-quality proxy, not measured miss distance.

**Why:** The user’s technical audit directs us not to overclaim an exact proprietary replication. The current archive also does not provide tracked pitch coordinates or action trajectories as model inputs.

**Why:** The user approved adding standings and form to the current simulation, while requiring timestamp safeguards.

**Why:** The user emphasized that explanations must follow the chain from role/tactical interactions to chances, execution, and outcomes. In-match behavior needs time-dependent evidence; a synthetic score-aware rule must not be presented as observed mentality or adaptability.

**Why:** The user requested a purely post-match forensic tool and rejected feeding recent tactical trends into predictions. The available archive lacks the positional evidence needed to prove tactical causes.

**How to apply:** Treat player, coach, team, and match sources as inputs to the intended simulator. Refresh selected teams directly from KickoffScore before simulation and fail explicitly if that refresh cannot complete. Apply standings only to current pre-match simulation when both snapshots pass the freshness checks; never use them for historical training without verified as-of timestamps. Keep the five-match forensic review separate from prediction and simulation inputs. Show each interaction and its source coverage. Label tactical and score-state heuristics as proxies; keep finishing, keeper, and sample uncertainty visible. A generated pitch grid and EVA-style delta are acceptable only as clearly labeled simulation proxies; never present them as observed tracking, measured xT/EVA, or a trained RL policy. Verify source coverage and identifiers, and keep unavailable inputs visible.
