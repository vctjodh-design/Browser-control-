import json
import math
import sys
import traceback

import numpy as np


GRID = 6  # 0..4 goals each side, then 5+
XI = 0.0035  # time decay per day: a match a year old counts about a third as much
REGULARISATION = 8.0  # keeps teams with a handful of matches from running away


def emit(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n")
    sys.stdout.flush()


def poisson_pmf(lam, limit):
    values = [math.exp(-lam) * lam ** k / math.factorial(k) for k in range(limit)]
    tail = max(0.0, 1.0 - sum(values))
    return values[:-1] + [values[-1] + tail]


def tau(x, y, lam, mu, rho):
    if x == 0 and y == 0:
        return 1.0 - lam * mu * rho
    if x == 0 and y == 1:
        return 1.0 + lam * rho
    if x == 1 and y == 0:
        return 1.0 + mu * rho
    if x == 1 and y == 1:
        return 1.0 - rho
    return 1.0


def fit_glm(home_index, away_index, home_goals, away_goals, weights, team_count):
    """
    Weighted Poisson regression with log-linear attack, defence and one shared home term.
    The negative log-likelihood is convex in these parameters, so L-BFGS with the exact
    gradient lands on the same answer every time, and the ridge term keeps sparse teams
    honest instead of letting a single 4-0 decide their rating.
    """
    from scipy.optimize import minimize

    def objective(parameters):
        attack = parameters[:team_count]
        defence = parameters[team_count:2 * team_count]
        home_term = parameters[-1]

        lam_home = np.exp(np.clip(attack[home_index] + defence[away_index] + home_term, -6, 3))
        lam_away = np.exp(np.clip(attack[away_index] + defence[home_index], -6, 3))
        log_likelihood = float(np.sum(
            weights * (home_goals * np.log(lam_home + 1e-12) - lam_home)
        ) + np.sum(
            weights * (away_goals * np.log(lam_away + 1e-12) - lam_away)
        ))
        penalty = REGULARISATION * float(np.sum(attack ** 2) + np.sum(defence ** 2))

        home_residual = weights * (home_goals - lam_home)
        away_residual = weights * (away_goals - lam_away)
        grad_attack = np.zeros(team_count)
        grad_defence = np.zeros(team_count)
        np.add.at(grad_attack, home_index, home_residual)
        np.add.at(grad_attack, away_index, away_residual)
        np.add.at(grad_defence, away_index, home_residual)
        np.add.at(grad_defence, home_index, away_residual)
        grad_attack -= 2.0 * REGULARISATION * attack
        grad_defence -= 2.0 * REGULARISATION * defence
        grad_home = float(np.sum(home_residual))

        gradient = np.concatenate([grad_attack, grad_defence, [grad_home]])
        return -log_likelihood + penalty, -gradient

    start = np.concatenate([
        np.zeros(team_count),
        np.zeros(team_count),
        [math.log(1.15)],
    ])
    bounds = [(-3.0, 3.0)] * (2 * team_count) + [(-2.0, 2.0)]
    fitted = minimize(
        objective,
        start,
        jac=True,
        method="L-BFGS-B",
        bounds=bounds,
        options={"maxiter": 600, "ftol": 1e-10},
    )
    parameters = fitted.x
    attack = np.exp(parameters[:team_count])
    defence = np.exp(parameters[team_count:2 * team_count])
    return attack, defence, float(math.exp(parameters[-1])), int(fitted.nit)


def fit(matches, as_of, home_team, away_team):
    if not matches:
        raise ValueError("The archive holds no completed matches to fit.")
    teams = sorted({match["home"] for match in matches} | {match["away"] for match in matches})
    if home_team not in teams or away_team not in teams:
        raise ValueError("One of these teams has no completed matches in the archive.")
    index = {name: position for position, name in enumerate(teams)}
    team_count = len(teams)
    as_of_day = np.datetime64(as_of)

    days = np.array([
        max(0.0, float((as_of_day - np.datetime64(match["date"])).astype(int)))
        for match in matches
    ])
    weights = np.exp(-XI * days)
    home_index = np.array([index[match["home"]] for match in matches])
    away_index = np.array([index[match["away"]] for match in matches])
    home_goals = np.array([match["homeScore"] for match in matches], dtype=np.float64)
    away_goals = np.array([match["awayScore"] for match in matches], dtype=np.float64)

    attack, defence, home_advantage, iterations = fit_glm(
        home_index,
        away_index,
        home_goals,
        away_goals,
        weights,
        team_count,
    )

    lam_home = float(attack[index[home_team]] * defence[index[away_team]] * home_advantage)
    lam_away = float(attack[index[away_team]] * defence[index[home_team]])
    lam_home = min(6.0, max(0.15, lam_home))
    lam_away = min(6.0, max(0.15, lam_away))

    # rho only touches the four lowest scorelines; searching it against those matches is
    # cheaper and steadier than putting it inside the outer optimiser.
    all_lam_home = np.exp(np.clip(
        np.log(attack[home_index]) + np.log(defence[away_index]) + math.log(home_advantage),
        -6,
        3,
    ))
    all_lam_away = np.exp(np.clip(
        np.log(attack[away_index]) + np.log(defence[home_index]),
        -6,
        3,
    ))
    x = np.minimum(home_goals, 1)
    y = np.minimum(away_goals, 1)
    low = (home_goals <= 1) & (away_goals <= 1)
    best_rho = 0.0
    best_likelihood = -math.inf
    for candidate in np.linspace(-0.12, 0.12, 49):
        factor = np.ones(len(matches))
        factor[(x == 0) & (y == 0)] = 1.0 - all_lam_home[(x == 0) & (y == 0)] * all_lam_away[(x == 0) & (y == 0)] * candidate
        factor[(x == 0) & (y == 1)] = 1.0 + all_lam_home[(x == 0) & (y == 1)] * candidate
        factor[(x == 1) & (y == 0)] = 1.0 + all_lam_away[(x == 1) & (y == 0)] * candidate
        factor[(x == 1) & (y == 1)] = 1.0 - candidate
        likelihood = float(np.sum(weights[low] * np.log(np.maximum(factor[low], 1e-6))))
        if likelihood > best_likelihood:
            best_likelihood = likelihood
            best_rho = float(candidate)

    home_pmf = poisson_pmf(lam_home, GRID)
    away_pmf = poisson_pmf(lam_away, GRID)
    matrix = [[0.0] * GRID for _ in range(GRID)]
    for home in range(GRID):
        for away in range(GRID):
            matrix[home][away] = max(1e-9, tau(home, away, lam_home, lam_away, best_rho)) * home_pmf[home] * away_pmf[away]
    total = sum(sum(row) for row in matrix)
    matrix = [[cell / total for cell in row] for row in matrix]

    result_home = sum(matrix[h][a] for h in range(GRID) for a in range(GRID) if h > a)
    draw = sum(matrix[i][i] for i in range(GRID))
    result_away = sum(matrix[h][a] for h in range(GRID) for a in range(GRID) if h < a)
    btts_yes = sum(matrix[h][a] for h in range(1, GRID) for a in range(1, GRID))
    over25 = sum(
        matrix[h][a] for h in range(GRID) for a in range(GRID) if h + a >= 3
    )
    over35 = sum(
        matrix[h][a] for h in range(GRID) for a in range(GRID) if h + a >= 4
    )

    scorelines = []
    for home in range(GRID):
        for away in range(GRID):
            scorelines.append({
                "scoreline": ("5+" if home == 5 else str(home)) + "-" + ("5+" if away == 5 else str(away)),
                "probability": float(matrix[home][away]),
            })
    scorelines.sort(key=lambda item: item["probability"], reverse=True)

    return {
        "homeTeam": home_team,
        "awayTeam": away_team,
        "asOf": as_of,
        "matchesUsed": len(matches),
        "teamsFitted": team_count,
        "iterations": iterations,
        "homeAttack": float(attack[index[home_team]]),
        "homeDefence": float(defence[index[home_team]]),
        "awayAttack": float(attack[index[away_team]]),
        "awayDefence": float(defence[index[away_team]]),
        "homeAdvantage": float(home_advantage),
        "rho": best_rho,
        "homeExpectedGoals": lam_home,
        "awayExpectedGoals": lam_away,
        "result": {"home": result_home, "draw": draw, "away": result_away},
        "bothTeamsToScore": {"yes": btts_yes, "no": 1.0 - btts_yes},
        "overUnder25": {"over": over25, "under": 1.0 - over25},
        "overUnder35": {"over": over35, "under": 1.0 - over35},
        "scorelineTop": scorelines[:10],
        "scorelineGrid": matrix,
    }


def main():
    try:
        request = json.load(sys.stdin)
        if request.get("mode") != "fit":
            raise ValueError("Unknown Dixon-Coles worker operation.")
        result = fit(
            request["matches"],
            request["asOf"],
            request["homeTeam"],
            request["awayTeam"],
        )
        emit({"type": "result", "result": result})
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit({"type": "error", "error": str(error)[:500]})
        sys.exit(1)


if __name__ == "__main__":
    main()
