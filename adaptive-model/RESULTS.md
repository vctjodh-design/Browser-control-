# Backtest results — honest numbers, no cherry-picking

Protocol: every match in chronological order; team strengths estimated from
**prior matches only** (no future leakage); league averages from prior matches
only; static baseline = independent Poisson from the same base xG (so the test
measures the *adaptation*, not the ratings).

Data: `processed-matches.sqlite` → 662 real matches with scores.

## Test A — both teams have 4+ prior games (49 matches, well-estimated strengths)

| model    | log loss | Brier | RPS    |
|----------|----------|-------|--------|
| static   | 1.1382   | 0.2335| 0.2457 |
| adaptive | 1.1211   | 0.2294| 0.2402 |
| edge     | +0.0171  | +0.0041 | +0.0055 — adaptive better on all three |

## Test B — both teams have 2+ prior games (109 matches, noisier strengths)

| model    | log loss | Brier | RPS    |
|----------|----------|-------|--------|
| static   | 1.0727   | 0.2173| 0.2248 |
| adaptive | 1.0791   | 0.2179| 0.2243 |
| edge     | −0.0064  | −0.0006 | +0.0005 — effectively tied |

## My read

- The adaptation is real but small: with well-estimated teams it wins on all
  three proper scoring rules; with noisy inputs it ties. That is exactly what
  you'd expect — adaptation refines a good read, it can't rescue a bad one.
- I am **not** claiming to beat bookmaker odds. No public model with this
  data does, and anyone who tells you otherwise without a walk-forward test is
  selling something. What this model adds over a static Poisson is structure:
  comebacks (~8–10% of matches), late-winner effects, and team-specific
  volatility nights — the things static averages smear away.
- Weaknesses: 49–109 evaluated matches is a small sample; team styles come
  from goals only (no shots/possession inputs yet); one global score-state
  table for all teams.

Reproduce: `python3 adaptive_model.py --backtest --trials 200`
(uses `browser-control/artifacts/api-server/data/processed-matches.sqlite`).
