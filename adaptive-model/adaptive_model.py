#!/usr/bin/env python3
"""
MY ADAPTIVE FOOTBALL PREDICTION MODEL — "the match fights back".

A match is not 90 identical minutes. It is six 15-minute phases, and after
every phase both teams change: the score tells them what to do, the clock
tells them how urgently, tired legs change what they can do, and a team that
just scored comes out taller for the next fifteen minutes.

Static models (Poisson, Elo, fixed duel rates) assume the 1st minute and the
85th minute are the same game. They are not. A side leading 1-0 at 70' stops
playing the game it played at 0-0; a side chasing pushes men forward and gets
hit on the counter. That adaptation is where most "surprise" results come
from — and it is predictable in structure, even when the outcome is not.

What the model does, per match:
  1. Starts from team strength (recent scoring / conceding, shrunk to the
     league average) + the league's home edge. If a market baseline (expected
     goals per side) is supplied, that sets the level instead.
  2. Gives each team a "night factor" drawn from its own volatility: steady
     teams cluster near their level, volatile teams produce brilliant or
     awful nights. This is the underperform / as-expected / overperform axis.
  3. Plays six phases. After each phase the score state rewrites both teams'
     intent (protect a lead / chase a deficit / chase a winner late), recent
     goals add momentum, and fatigue opens the game up late.
  4. Draws goals per phase from a Gamma-Poisson mix (overdispersed: real
     football has fatter tails than Poisson), sums the phases, and repeats
     for thousands of trials.

Everything adapts to the opponent and the score. Nothing is a fixed draw
around an average.

Usage:
  python3 adaptive_model.py --backtest   # walk-forward test on 662 real matches
  python3 adaptive_model.py --demo       # Anderlecht v Salzburg + Milan v Ferencvaros
  python3 adaptive_model.py --backtest --trials 300 --max-eval 400
"""

import argparse
import math
import random
import os
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

# ----------------------------------------------------------------------------
# Small probability toolkit (stdlib only)
# ----------------------------------------------------------------------------

def poisson_draw(mean, rng):
    """Knuth sampler; phase means are small so this is fast."""
    if mean <= 0:
        return 0
    if mean > 12:  # gaussian approx for safety; never hit in practice
        return max(0, int(rng.gauss(mean, math.sqrt(mean)) + 0.5))
    lam = math.exp(-mean)
    k = 0
    p = 1.0
    while True:
        k += 1
        p *= rng.random()
        if p <= lam:
            return k - 1


def gamma_draw(shape, scale, rng):
    """Marsaglia-Tsang for shape >= 1, boost for shape < 1. Mean = shape*scale."""
    if shape <= 0 or scale <= 0:
        return 1.0
    if shape < 1.0:
        # Gamma(a) = Gamma(a+1) * U^(1/a)
        return gamma_draw(shape + 1.0, scale, rng) * (rng.random() ** (1.0 / shape))
    d = shape - 1.0 / 3.0
    c = 1.0 / math.sqrt(9.0 * d)
    while True:
        x = rng.gauss(0, 1)
        v = (1.0 + c * x) ** 3
        if v <= 0:
            continue
        u = rng.random()
        if u < 1 - 0.0331 * (x ** 4):
            return scale * d * v
        if math.log(u) < 0.5 * x * x + d * (1 - v + math.log(v)):
            return scale * d * v


def poisson_pmf(mean, kmax=10):
    out = [math.exp(-mean)]
    for k in range(1, kmax + 1):
        out.append(out[-1] * mean / k)
    return out


def static_1x2(xg_h, xg_a, kmax=10):
    ph = poisson_pmf(xg_h, kmax)
    pa = poisson_pmf(xg_a, kmax)
    p_h = p_d = p_a = 0.0
    for i, a in enumerate(ph):
        for j, b in enumerate(pa):
            p = a * b
            if i > j:
                p_h += p
            elif i == j:
                p_d += p
            else:
                p_a += p
    return p_h, p_d, p_a


# ----------------------------------------------------------------------------
# The adaptive match
# ----------------------------------------------------------------------------

# Goals are not spread evenly: ~12% in the first 15', rising to ~21% late.
PHASE_WEIGHTS = [0.12, 0.15, 0.16, 0.17, 0.19, 0.21]

# How teams rewrite their intent by score state (minute-gated).
# (own_attack_mult, own_concede_mult) i.e. how much they score / concede.
STATE_TABLE = {
    "leading_protect": (0.88, 0.90),   # ahead after 60': sit in, concede less
    "leading_hold": (0.95, 0.96),      # ahead before 60': slight caution
    "trailing_chase": (1.16, 1.12),    # behind after 60': throw men forward, exposed
    "trailing_early": (1.06, 1.04),    # behind before 60': push, mildly open
    "drawing_late": (1.10, 1.06),      # level after 75': both chase a winner
    "settling": (0.90, 0.92),          # first 15': cagey, finding shape
}


def simulate_match(xg_h, xg_a, vol_h, vol_a, tempo_mult=1.0, trials=2000, seed=7):
    """Play `trials` matches in six adaptive phases. Returns outcome dict."""
    rng = random.Random(seed)
    w_home = w_draw = w_away = 0
    gh_tot = ga_tot = 0.0
    scorelines = defaultdict(int)
    btts = over25 = 0
    comeback_wins = 0  # won after trailing at any phase boundary

    for _ in range(trials):
        # --- the night each team is having (Gamma mean 1, variance = vol) ---
        fh = gamma_draw(1.0 / vol_h, vol_h, rng) if vol_h > 0 else 1.0
        fa = gamma_draw(1.0 / vol_a, vol_a, rng) if vol_a > 0 else 1.0

        gh = ga = 0
        mom_h = mom_a = 1.0  # momentum multipliers, decay each phase
        trailed_h = trailed_a = False

        for p in range(6):
            minute = p * 15
            w = PHASE_WEIGHTS[p]

            # --- score state rewrites intent ---
            diff = gh - ga  # from home perspective
            if p == 0:
                ah, dh = STATE_TABLE["settling"]
                aa, da = STATE_TABLE["settling"]
            elif diff > 0 and minute >= 60:
                ah, dh = STATE_TABLE["leading_protect"]
                aa, da = STATE_TABLE["trailing_chase"]
            elif diff < 0 and minute >= 60:
                aa, da = STATE_TABLE["leading_protect"]
                ah, dh = STATE_TABLE["trailing_chase"]
            elif diff > 0:
                ah, dh = STATE_TABLE["leading_hold"]
                aa, da = STATE_TABLE["trailing_early"]
            elif diff < 0:
                aa, da = STATE_TABLE["leading_hold"]
                ah, dh = STATE_TABLE["trailing_early"]
            elif minute >= 75:
                ah, dh = STATE_TABLE["drawing_late"]
                aa, da = STATE_TABLE["drawing_late"]
            else:
                ah = dh = aa = da = 1.0

            # --- fatigue opens the game late; tired legs, bigger gaps ---
            fatigue = 1.0 + 0.10 * max(0, (minute - 60) / 30.0)

            mh = xg_h * w * fh * ah * mom_h * tempo_mult * fatigue
            ma = xg_a * w * fa * aa * mom_a * tempo_mult * fatigue
            # each side's defending scales the OPPONENT's rate: when you sit
            # in (da < 1) their phase mean falls; when you chase (da > 1) it rises.
            mh *= da
            ma *= dh

            kh = poisson_draw(mh, rng)
            ka = poisson_draw(ma, rng)

            # --- momentum: scoring lifts the next phase, conceding sinks it ---
            if kh > ka:
                mom_h, mom_a = min(1.15, mom_h + 0.04 * kh), max(0.90, mom_a - 0.02 * kh)
            elif ka > kh:
                mom_a, mom_h = min(1.15, mom_a + 0.04 * ka), max(0.90, mom_h - 0.02 * ka)
            else:
                mom_h += (1.0 - mom_h) * 0.5
                mom_a += (1.0 - mom_a) * 0.5

            gh += kh
            ga += ka
            if gh < ga:
                trailed_h = True
            if ga < gh:
                trailed_a = True

        gh_tot += gh
        ga_tot += ga
        scorelines[(gh, ga)] += 1
        if gh > 0 and ga > 0:
            btts += 1
        if gh + ga > 2.5:
            over25 += 1
        if gh > ga:
            w_home += 1
            if trailed_h:
                comeback_wins += 1
        elif gh == ga:
            w_draw += 1
        else:
            w_away += 1
            if trailed_a:
                comeback_wins += 1

    n = trials
    top = sorted(scorelines.items(), key=lambda kv: -kv[1])[:8]
    return {
        "home": w_home / n,
        "draw": w_draw / n,
        "away": w_away / n,
        "homeGoals": gh_tot / n,
        "awayGoals": ga_tot / n,
        "btts": btts / n,
        "over25": over25 / n,
        "comeback": comeback_wins / n,
        "scorelines": [(h, a, c / n) for (h, a), c in top],
        "trials": n,
    }


# ----------------------------------------------------------------------------
# Strength estimation from history (prior matches only — no leakage)
# ----------------------------------------------------------------------------

def team_rates(prior, league_h, league_a, k=4.0):
    """Shrunk scoring/conceding rates + volatility from a team's prior games."""
    g_bar = max(0.2, (league_h + league_a) / 2.0)
    if not prior:
        return {"gf": g_bar, "ga": g_bar, "vol": 0.10, "tempo": 1.0, "n": 0}
    gf = sum(g for g, _ in prior) / len(prior)
    ga = sum(g for _, g in prior) / len(prior)
    gf_s = (len(prior) * gf + k * g_bar) / (len(prior) + k)
    ga_s = (len(prior) * ga + k * g_bar) / (len(prior) + k)
    # volatility: variance of goals scored above Poisson, mapped to Gamma var
    mean = max(0.3, gf)
    var = sum((g - gf) ** 2 for g, _ in prior) / len(prior)
    excess = max(0.0, (var - mean) / (mean * mean + 1e-6))
    vol = min(0.45, 0.07 + 0.5 * excess)
    tempo = (gf_s + ga_s) / (2 * g_bar)
    tempo = min(1.25, max(0.80, 0.55 + 0.45 * tempo))
    return {"gf": gf_s, "ga": ga_s, "vol": vol, "tempo": tempo, "n": len(prior)}


def base_xg(home, away, lg_h, lg_a):
    g_bar = max(0.2, (lg_h + lg_a) / 2.0)
    xh = lg_h * (home["gf"] / g_bar) * (away["ga"] / g_bar)
    xa = lg_a * (away["gf"] / g_bar) * (home["ga"] / g_bar)
    return (min(4.5, max(0.15, xh)), min(4.0, max(0.10, xa)))


# ----------------------------------------------------------------------------
# Data + walk-forward backtest
# ----------------------------------------------------------------------------

# The archive lives next to the app that produces it, so the default resolves
# from this file rather than from wherever the script happens to be run.
DB = os.environ.get(
    "PROCESSED_MATCH_DB_PATH",
    str(
        Path(__file__).resolve().parent.parent
        / "artifacts/api-server/data/processed-matches.sqlite"
    ),
)


def load_matches(db_path=DB):
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    teams = {r["team_key"]: r["name"] for r in con.execute("select * from fair_ai_teams")}
    rows = list(
        con.execute(
            "select fixture_id, match_date, competition, home_team_key, away_team_key,"
            " home_score, away_score from fair_ai_matches order by match_date"
        )
    )
    out = []
    for r in rows:
        if r["home_score"] is None or r["away_score"] is None:
            continue
        out.append(
            {
                "id": r["fixture_id"],
                "date": r["match_date"],
                "comp": r["competition"],
                "home": teams.get(r["home_team_key"], r["home_team_key"]),
                "away": teams.get(r["away_team_key"], r["away_team_key"]),
                "hg": r["home_score"],
                "ag": r["away_score"],
            }
        )
    return out


def logloss(p):
    return -math.log(max(1e-9, p))


def evaluate(db_path=DB, trials=300, max_eval=None, min_prior=4, verbose=True):
    matches = load_matches(db_path)
    history = defaultdict(list)  # team -> [(gf, ga)] oldest first
    league_h_goals = []
    league_a_goals = []

    results = {"n": 0, "static": {"ll": 0, "brier": 0, "rps": 0},
               "adaptive": {"ll": 0, "brier": 0, "rps": 0}}
    evaluated = []

    for m in matches:
        lg_h = sum(league_h_goals) / len(league_h_goals) if len(league_h_goals) >= 20 else 1.45
        lg_a = sum(league_a_goals) / len(league_a_goals) if len(league_a_goals) >= 20 else 1.15

        hp = history[m["home"]][-10:]
        ap = history[m["away"]][-10:]
        if len(hp) >= min_prior and len(ap) >= min_prior:
            hr = team_rates(hp, lg_h, lg_a)
            ar = team_rates(ap, lg_h, lg_a)
            xh, xa = base_xg(hr, ar, lg_h, lg_a)

            sh, sd, sa = static_1x2(xh, xa)
            tempo = (hr["tempo"] + ar["tempo"]) / 2.0
            adapt = simulate_match(xh, xa, hr["vol"], ar["vol"],
                                   tempo_mult=tempo, trials=trials,
                                   seed=1000 + m["id"] % 100000)

            actual = "home" if m["hg"] > m["ag"] else ("draw" if m["hg"] == m["ag"] else "away")
            for label, probs in (("static", (sh, sd, sa)),
                                 ("adaptive", (adapt["home"], adapt["draw"], adapt["away"]))):
                p = {"home": probs[0], "draw": probs[1], "away": probs[2]}[actual]
                results[label]["ll"] += logloss(p)
                probs_v = [probs[0], probs[1], probs[2]]
                actual_v = [1 if actual == k else 0 for k in ("home", "draw", "away")]
                results[label]["brier"] += sum((a - b) ** 2 for a, b in zip(probs_v, actual_v)) / 3
                # RPS for ordered home > draw > away
                cum_p, cum_a, rps = 0, 0, 0
                for pv, av in zip(probs_v, actual_v):
                    cum_p += pv
                    cum_a += av
                    rps += (cum_p - cum_a) ** 2
                results[label]["rps"] += rps / 2
            results["n"] += 1
            evaluated.append((m, xh, xa, (sh, sd, sa), adapt))
            if max_eval and results["n"] >= max_eval:
                break

        history[m["home"]].append((m["hg"], m["ag"]))
        history[m["away"]].append((m["ag"], m["hg"]))
        league_h_goals.append(m["hg"])
        league_a_goals.append(m["ag"])

    n = max(1, results["n"])
    summary = {
        "matches": results["n"],
        "static": {k: results["static"][k] / n for k in ("ll", "brier", "rps")},
        "adaptive": {k: results["adaptive"][k] / n for k in ("ll", "brier", "rps")},
    }
    if verbose:
        print(f"\nWalk-forward backtest: {n} matches (prior games only, no leakage)")
        for label in ("static", "adaptive"):
            s = summary[label]
            print(f"  {label:8s} logloss {s['ll']:.4f}  brier {s['brier']:.4f}  RPS {s['rps']:.4f}")
        for k in ("ll", "brier", "rps"):
            d = summary["static"][k] - summary["adaptive"][k]
            print(f"  adaptive minus static {k}: {d:+.4f} ({'better' if d > 0 else 'worse'})")
    return summary, evaluated


# ----------------------------------------------------------------------------
# Demo on the two live fixtures
# ----------------------------------------------------------------------------

def demo(trials=5000):
    print("\n=== MY MODEL: the match fights back ===\n")
    fixtures = [
        {"name": "RSC Anderlecht v Red Bull Salzburg", "xh": 1.72, "xa": 1.16,
         "vh": 0.10, "va": 0.22, "tempo": 1.02},
        {"name": "AC Milan v Ferencvaros", "xh": 2.25, "xa": 0.75,
         "vh": 0.16, "va": 0.13, "tempo": 1.0},
    ]
    for f in fixtures:
        print(f"--- {f['name']}  (baseline {f['xh']:.2f} - {f['xa']:.2f}) ---")
        base = simulate_match(f["xh"], f["xa"], f["vh"], f["va"],
                              tempo_mult=f["tempo"], trials=trials, seed=7)
        sh, sd, sa = static_1x2(f["xh"], f["xa"])
        print(f"  static Poisson : H {sh:.1%}  D {sd:.1%}  A {sa:.1%}")
        print(f"  adaptive       : H {base['home']:.1%}  D {base['draw']:.1%}  A {base['away']:.1%}")
        print(f"  played goals   : {base['homeGoals']:.2f} - {base['awayGoals']:.2f}"
              f"  BTTS {base['btts']:.1%}  over 2.5 {base['over25']:.1%}"
              f"  comebacks {base['comeback']:.1%}")
        top = ", ".join(f"{h}-{a} {p:.1%}" for h, a, p in base["scorelines"][:5])
        print(f"  scorelines     : {top}")
        # the nights: each side above / below its own volatility
        for side, direction in (("home", "under"), ("home", "over"),
                                ("away", "under"), ("away", "over")):
            vh = f["vh"] * (0.2 if (side == "home" and direction == "under") else 1.0)
            va = f["va"] * (0.2 if (side == "away" and direction == "under") else 1.0)
            xh = f["xh"] * (1.35 if (side == "home" and direction == "over") else
                            (0.65 if (side == "home" and direction == "under") else 1.0))
            xa = f["xa"] * (1.35 if (side == "away" and direction == "over") else
                            (0.65 if (side == "away" and direction == "under") else 1.0))
            r = simulate_match(xh, xa, f["vh"], f["va"], f["tempo"], trials=800, seed=99)
            tag = f"{side} {direction}"
            print(f"    {tag:12s} H {r['home']:.1%} D {r['draw']:.1%} A {r['away']:.1%}"
                  f"  most {r['scorelines'][0][0]}-{r['scorelines'][0][1]}")
        print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backtest", action="store_true")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--trials", type=int, default=300)
    ap.add_argument("--max-eval", type=int, default=None)
    ap.add_argument("--db", type=str, default=DB)
    args = ap.parse_args()
    if not args.backtest and not args.demo:
        args.demo = True
    if args.demo:
        demo()
    if args.backtest:
        evaluate(db_path=args.db, trials=args.trials, max_eval=args.max_eval)


if __name__ == "__main__":
    main()
