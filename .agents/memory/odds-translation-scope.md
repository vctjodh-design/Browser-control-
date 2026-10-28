---
name: Odds translation scope
description: Product expectations for translating football odds into a match-level bookmaker read.
---

The odds tab should synthesize a match-level expectation from complete full-time 1X2, BTTS, goal-total, correct-score, and relevant combined markets, while still displaying every returned market and selection. Keep markets that do not directly constrain full-time scores visible, but do not present them as score evidence.

**Why:** The user expects one combined read covering likely result, BTTS, goal totals, and correct-score candidates, not only separate explanations of each price.

**How to apply:** When extending the odds tab, use only complete, full-time score-related market partitions in the score distribution. Keep all raw odds inspectable and label the combined read as bookmaker-implied, not a guaranteed match prediction.
