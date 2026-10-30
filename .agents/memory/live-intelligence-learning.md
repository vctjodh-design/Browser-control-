---
name: Live intelligence learning
description: Scope and safety rules for the live forecast's self-calibration.
---

The initial learning model is per-browser. It records compact live forecast snapshots and incident features, then updates bounded scoring corrections only after the match-center source confirms the final score. Do not treat browser storage as a shared or production-durable model.

**Why:** The app has no authenticated model owner, so a shared endpoint could be poisoned by untrusted forecast submissions. Local calibration avoids mixing users while still learning from the matches they view.

**How to apply:** Keep the learning scope clear in the UI. If shared or cross-device training is requested, use verified server-side match outcomes, add abuse controls, and choose storage that survives production restarts before changing this boundary.
