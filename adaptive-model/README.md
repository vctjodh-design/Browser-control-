# My adaptive football prediction model — "the match fights back"

Built from scratch, from my own read of how football actually works. Not a
tuned Poisson, not an Elo table, not a duel sim bolted onto a market average.

## The idea, in one paragraph

A football match is not 90 identical minutes. It is six 15-minute phases, and
after every phase both teams change: the score tells them what to do, the
clock tells them how urgently, tired legs change what they can do, and a team
that just scored comes out taller for the next fifteen minutes. Static models
assume the 1st minute and the 85th minute are the same game. They are not. A
side leading 1–0 at 70' stops playing the game it played at 0–0; a side
chasing throws men forward and gets hit on the counter. That adaptation is
where most "surprise" results come from — and its *structure* is predictable
even when the outcome is not.

## What the model does

1. **Starts from strength, not vibes.** Each side's scoring/conceding rates
   from its recent games, shrunk toward the league average (small samples get
   pulled to the mean; big samples speak for themselves). Plus the league's
   home edge. If a market baseline (expected goals per side) is supplied, that
   sets the level instead — the market knows things history doesn't.
2. **Gives each team its own "night".** A Gamma-distributed form factor per
   team per simulated match: steady teams cluster near their level, volatile
   teams (measured from their own history) produce brilliant or awful nights.
   This is the underperform / as-expected / overperform axis, and it falls
   out of the teams — not a dial I turn by hand.
3. **Plays six phases, adapting after each one:**
   - score state rewrites intent (protect a lead after 60', chase a deficit,
     both chase a winner when level late, cagey opening 15'),
   - goals create momentum into the next phase (mean-reverting),
   - fatigue opens the game up late,
   - style/tempo clash scales the whole game (two open teams: more chances;
     two cagey teams: fewer).
4. **Draws goals from a Gamma–Poisson mix** (overdispersed — real football has
   fatter tails than Poisson), sums the phases, repeats for thousands of
   trials. Output: 1X2, expected goals, top scorelines, BTTS, over 2.5,
   comeback probability, and the four "nights" (each side above/below par).

## Files

- `adaptive_model.py` — the whole system: model + walk-forward backtest + demo. Stdlib only.
- `RESULTS.md` — what the backtest on 662 real matches actually showed (honest numbers).

## Run it

```bash
python3 adaptive_model.py --demo                 # two live fixtures, 5,000 trials each
python3 adaptive_model.py --backtest             # walk-forward test, prior games only
python3 adaptive_model.py --backtest --trials 200 --max-eval 400
```

## What I'd do next with more time

Per-team score-state fingerprints (some teams protect leads well, others
collapse — learn it per club, not one global table), red-card states, and
calibration curves per league. The framework already supports all three: they
are new rows in the state table, not a new model.
