---
name: FAIR AI target
description: The user's interaction-first target for football simulation and the data boundary that must remain explicit.
---

The user is building an interaction-first football simulator: start from the odds-translation scoreline and goals baseline, then explain how player roles, tactical systems, opponent strength, chance quality, and score phase support or contradict it. Keep the market baseline visible beside the FAIR AI adjustment and identify the evidence and coverage behind changes. Do not claim an exact proprietary FAIR AI replica unless that is verified. The current match-result models are not the FAIR reinforcement-learning simulator.

The five-match Tactical Root-Cause review is separate from simulation. Preserve match-by-match events/comments, full and half statistics, formations, lineups, and player evidence. It may give a qualitative, evidence-backed matchup and goal-environment lean, but no calibrated probabilities; never feed forensic summaries into simulation or claim unobserved tactical causes.

The Forensics tab shows 1X2, BTTS, Over/Under 2.5, and a sample-based correct-score pick. Derive these directly from the two teams' forensic match samples and the Forensics assessment; do not call or depend on the separate FAIR AI simulator. Label sample frequencies as historical small-sample descriptions, not calibrated forecasts or real-world probabilities.

Show a separate confidence label for each Forensics pick. Base it on the available sample coverage and how consistently the sampled outcomes support the pick; label it as evidence confidence, not a probability or proven accuracy estimate. Keep exact-score confidence low when it is inferred only from rounded average goals.

**Why:** The user wants each prediction to communicate how much confidence the evidence supports.

**How to apply:** Show the confidence tier and the sample count/reason beside each market pick, and state that the tier is not calibrated.

When Forensics is opened from a fixture, exclude that fixture ID from both teams' recent-five samples even if it is completed. Filter it out before requesting individual match details, then use the next older eligible completed match to fill the five-match sample.

**Why:** The user explicitly says the match being analyzed must not be among its own five forensic examples.

**How to apply:** Pass the viewed fixture ID from the match page through the Forensics request. Keep standalone team comparisons unchanged when no target fixture exists.

**Why:** The user corrected the Forensics flow: market picks belong to the forensic samples and assessment, not the separate FAIR AI simulator.

**How to apply:** Build the Forensics picks only after fresh forensic retrieval succeeds. Keep the separate simulator connected only to its own simulation interface. Show the evidence counts and avoid probability claims.

The simulation must fetch the selected teams' latest completed match records directly from KickoffScore before each run. If fresh source data is unavailable, stop rather than silently using stale archive records.

The current pre-match simulation may use standings only when both teams have snapshots with valid, non-future observation timestamps no more than 30 days old. Normalize rank, points per game, goal difference, and recent league form into small bounded heuristic adjustments; do not use these snapshots in historical training. The source observation time is not guaranteed to be the table's effective date.

Use the complete available odds scoreline distribution as an explicit forecast prior, not merely as a shot-volume input. Keep FAIR AI's action simulation distinct, combine the two transparently, and let FAIR AI influence grow only with relevant evidence coverage. Show source gaps. 365Scores replay evidence must be matched by fixture date, teams, and score; commentary and shot-origin data do not establish continuous player tracking. xGOT−xG is only a placement-quality proxy, not measured miss distance.

**Why:** The user’s technical audit directs us not to overclaim an exact proprietary replication. The current archive also does not provide tracked pitch coordinates or action trajectories as model inputs.

**Why:** The user approved adding standings and form to the current simulation, while requiring timestamp safeguards.

**Why:** The user emphasized that explanations must follow the chain from role/tactical interactions to chances, execution, and outcomes. In-match behavior needs time-dependent evidence; a synthetic score-aware rule must not be presented as observed mentality or adaptability.

**Why:** The user first requested a retrospective forensic review without predictions, then clarified that it should compare teams contextually and state what is more likely. The archive lacks positional evidence needed to prove many tactical causes.

**How to apply:** Treat player, coach, team, and match sources as inputs to the intended simulator. Refresh selected teams directly from KickoffScore before simulation and fail explicitly if that refresh cannot complete. Apply standings only to current pre-match simulation when both snapshots pass the freshness checks; never use them for historical training without verified as-of timestamps. Keep forensic analysis separate from simulator inputs; retain match-level timeline/comments, full and half stats, formations, lineups, and player ratings, then show a qualitative matchup lean across distinct evidence areas with coverage and uncertainty. Do not show calibrated probabilities or claim tracking-based causes without tracking data. Label tactical and score-state heuristics as proxies; keep finishing, keeper, and sample uncertainty visible. A generated pitch grid and EVA-style delta are acceptable only as clearly labeled simulation proxies; never present them as observed tracking, measured xT/EVA, or a trained RL policy. Verify source coverage and identifiers, and keep unavailable inputs visible.
