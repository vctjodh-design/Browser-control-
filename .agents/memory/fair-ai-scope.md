---
name: FAIR AI target
description: The user's target direction for football decision-quality modeling and the data boundary that must remain explicit.
---

The user is building a FAIR-inspired football decision-quality simulator with player-level evaluation. Do not claim an exact proprietary FAIR AI replica unless that is verified. The current match-result models are not the FAIR reinforcement-learning simulator.

The simulation must fetch the selected teams' latest completed match records directly from KickoffScore before each run. If fresh source data is unavailable, stop rather than silently using stale archive records.

**Why:** The user’s technical audit directs us not to overclaim an exact proprietary replication. The current archive also does not provide tracked pitch coordinates or action trajectories as model inputs.

**How to apply:** Treat player, coach, team, and match sources as inputs to the intended replica. Refresh selected teams directly from KickoffScore before simulation and fail explicitly if that refresh cannot complete. A generated pitch grid and EVA-style delta are acceptable only as clearly labeled simulation proxies; never present them as observed tracking, measured xT/EVA, or a trained RL policy. Verify source coverage and identifiers, and keep unavailable inputs visible.
