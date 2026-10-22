---
name: FAIR AI target
description: The user's target direction for football decision-quality modeling and the data boundary that must remain explicit.
---

The user is building a 100% replica of FAIR AI: player-level football decision evaluation using spatial threat, action outcomes, player profiles, and pre-match simulation. The current match-result models are not the FAIR reinforcement-learning simulator.

The simulation must fetch the selected teams' latest completed match records directly from KickoffScore before each run. If fresh source data is unavailable, stop rather than silently using stale archive records.

**Why:** The user explicitly stated the goal is a 100% FAIR AI replica and reported that the simulation was not getting fresh website details. The current archive also does not provide tracked pitch coordinates or action trajectories as model inputs.

**How to apply:** Treat player, coach, team, and match sources as inputs to the intended replica. Refresh selected teams directly from KickoffScore before simulation and fail explicitly if that refresh cannot complete. A generated pitch grid and EVA-style delta are acceptable only as clearly labeled simulation proxies; never present them as observed tracking, measured xT/EVA, or a trained RL policy. Verify source coverage and identifiers, and keep unavailable inputs visible.
