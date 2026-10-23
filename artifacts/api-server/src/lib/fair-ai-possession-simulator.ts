import type {
  FootballFairAiSimulation,
  FootballFairAiTeam,
} from "@workspace/api-zod";

const GRID_COLUMNS = 12;
const GRID_ROWS = 8;
const POSSESSIONS_PER_MATCH = 140;
const MAX_ACTIONS_PER_POSSESSION = 7;
const PLAYER_SAMPLE_LIMIT = 22;
const DANGEROUS_AREA_START_X = 8;
const MAX_STANDINGS_SNAPSHOT_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

type Player = NonNullable<FootballFairAiTeam["players"]>[number];
type PossessionModel = FootballFairAiSimulation["possessionModel"];
type PossessionTeam = PossessionModel["home"];
type SimulatedPossession = PossessionModel["sampledPossessions"][number];
type SimulatedAction = SimulatedPossession["actions"][number];
type PlayerContribution = FootballFairAiSimulation["playerContributions"][number];
type SimAction = SimulatedAction["action"];
type SimActionOutcome = SimulatedAction["outcome"];
type SimPossessionOutcome = SimulatedPossession["outcome"];
type StandingsEvaluation = FootballFairAiSimulation["standingsContext"]["home"];
type ShotXgSource = keyof FootballFairAiSimulation["inputAudit"]["home"]["shotXgSources"];
type SampleMatchAudit = FootballFairAiSimulation["sampleMatchAudit"];

type MutableCell = {
  touches: number;
  passes: number;
  carries: number;
  shots: number;
  turnovers: number;
  estimatedValueAdded: number;
};

type PlayerCounter = {
  playerKey: string;
  teamName: string;
  playerName: string;
  simulatedGoals: number;
  simulatedAssists: number;
  simulatedPasses: number;
  simulatedCarries: number;
  simulatedShots: number;
  simulatedDefensiveActions: number;
  estimatedValueAdded: number;
};

type TeamCounter = {
  possessions: number;
  actions: number;
  passes: number;
  carries: number;
  shots: number;
  turnovers: number;
  goals: number;
  expectedGoals: number;
  shotXgSources: Record<ShotXgSource, number>;
  estimatedValueAdded: number;
  cells: MutableCell[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function evaluateStandingsPerformance(
  team: FootballFairAiTeam,
  asOfMs = Date.now(),
): StandingsEvaluation {
  const stats = team.teamStats;
  const observedAt = stats?.leagueStandingObservedAt ?? null;
  const evaluation: StandingsEvaluation = {
    status: "missing",
    observedAt,
    leagueId: stats?.leagueId ?? null,
    season: stats?.leagueSeason ?? null,
    rank: stats?.leagueRank ?? null,
    played: stats?.leaguePlayed ?? null,
    points: stats?.leaguePoints ?? null,
    goalDifference: stats?.goalDifference ?? null,
    form: stats?.leagueForm ?? null,
    teamCount: stats?.leagueTeamCount ?? 0,
    strengthScore: null,
  };
  if (!observedAt) return evaluation;

  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) return { ...evaluation, status: "invalid" };
  if (observedAtMs > asOfMs) return { ...evaluation, status: "future" };
  if (asOfMs - observedAtMs > MAX_STANDINGS_SNAPSHOT_AGE_MS) {
    return { ...evaluation, status: "stale" };
  }

  const weightedScores: Array<{ score: number; weight: number }> = [];
  const include = (score: number | null, weight: number) => {
    if (score !== null && Number.isFinite(score)) weightedScores.push({ score, weight });
  };
  if (
    stats?.leagueRank !== null &&
    stats?.leagueRank !== undefined &&
    stats.leagueTeamCount > 1 &&
    stats.leagueRank >= 1 &&
    stats.leagueRank <= stats.leagueTeamCount
  ) {
    include(
      1 - 2 * (stats.leagueRank - 1) / (stats.leagueTeamCount - 1),
      0.25,
    );
  }
  if (
    stats?.leaguePoints !== null &&
    stats?.leaguePoints !== undefined &&
    stats.leaguePlayed !== null &&
    stats.leaguePlayed !== undefined &&
    stats.leaguePlayed > 0
  ) {
    include(
      clamp((stats.leaguePoints / (stats.leaguePlayed * 3)) * 2 - 1, -1, 1),
      0.35,
    );
  }
  if (
    stats?.goalDifference !== null &&
    stats?.goalDifference !== undefined &&
    stats.leaguePlayed !== null &&
    stats.leaguePlayed !== undefined &&
    stats.leaguePlayed > 0
  ) {
    include(
      clamp(stats.goalDifference / (stats.leaguePlayed * 1.5), -1, 1),
      0.2,
    );
  }
  const formResults = stats?.leagueForm?.match(/[WDL]/gi)?.slice(-5) ?? [];
  if (formResults.length) {
    const formScore = formResults.reduce(
      (sum, result) => sum + (result.toUpperCase() === "W" ? 1 : result.toUpperCase() === "L" ? -1 : 0),
      0,
    ) / formResults.length;
    include(formScore, 0.2);
  }
  const totalWeight = weightedScores.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return { ...evaluation, status: "insufficient" };

  const strengthScore = weightedScores.reduce(
    (sum, item) => sum + item.score * item.weight,
    0,
  ) / totalWeight;
  return { ...evaluation, status: "applied", strengthScore: clamp(strengthScore, -1, 1) };
}

function randomInteger(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function samplePoisson(lambda: number): number {
  const threshold = Math.exp(-lambda);
  let product = 1;
  let events = 0;
  do {
    events += 1;
    product *= Math.random();
  } while (product > threshold);
  return events - 1;
}

function average(values: Array<number | null | undefined>): number | null {
  const usable = values.filter(
    (value): value is number => value !== null && value !== undefined && Number.isFinite(value),
  );
  return usable.length
    ? usable.reduce((total, value) => total + value, 0) / usable.length
    : null;
}

function isForward(player: Player): boolean {
  return /\b(forward|striker|attack|fw|f)\b/i.test(player.position ?? "");
}

function isMidfielder(player: Player): boolean {
  return /\b(midfielder|midfield|mf|mid|m)\b/i.test(player.position ?? "");
}

function isDefender(player: Player): boolean {
  return /\b(defender|defence|defense|back|df|d)\b/i.test(player.position ?? "");
}

function isGoalkeeper(player: Player): boolean {
  return /\b(goalkeeper|keeper|gk|g)\b/i.test(player.position ?? "");
}

function availablePlayers(team: FootballFairAiTeam): Player[] {
  const players = (team.players ?? []).slice(0, PLAYER_SAMPLE_LIMIT);
  const starters = players.filter((player) => player.starter);
  return starters.length ? starters : players;
}

function playerRoleWeight(player: Player, action: SimAction, x: number): number {
  const forward = isForward(player);
  const midfielder = isMidfielder(player);
  const defender = isDefender(player);
  const keeper = isGoalkeeper(player);
  const ratingFactor = clamp((player.averageRating ?? 6.5) / 6.5, 0.72, 1.28);

  if (action === "shot") {
    const positionFactor = forward ? 2.5 : midfielder ? 1.25 : defender ? 0.28 : keeper ? 0.02 : 0.55;
    return positionFactor * ratingFactor *
      (0.04 + player.expectedGoalsPer90 * 1.2 + player.goalsPer90 * 0.55 + player.shotsPer90 * 0.12);
  }
  if (action === "pass") {
    const positionFactor = keeper ? 0.2 : forward ? (x > 7 ? 1.1 : 0.45) : midfielder ? 1.5 : defender ? 1.15 : 0.8;
    return positionFactor * ratingFactor *
      (0.2 + (player.passCompletionPct ?? 78) / 100 + player.keyPassesPer90 * 0.035);
  }
  const positionFactor = keeper ? 0.02 : forward ? 1.05 : midfielder ? 1.25 : defender ? 0.9 : 0.7;
  return positionFactor * ratingFactor * (0.25 + (player.duelsWonPct ?? 50) / 100);
}

function choosePlayer(
  team: FootballFairAiTeam,
  action: SimAction,
  x: number,
  excludePlayerKey?: string,
): Player | null {
  const players = availablePlayers(team).filter(
    (player) => player.playerKey !== excludePlayerKey,
  );
  if (!players.length) return null;
  const weighted = players.map((player) => ({
    player,
    weight: Math.max(0.001, playerRoleWeight(player, action, x)),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let target = Math.random() * total;
  for (const item of weighted) {
    target -= item.weight;
    if (target <= 0) return item.player;
  }
  return weighted.at(-1)?.player ?? null;
}

function positionValue(x: number, y: number): number {
  const progress = clamp(x / (GRID_COLUMNS - 1), 0, 1);
  const centrality = 1 - Math.abs(y - (GRID_ROWS - 1) / 2) / ((GRID_ROWS - 1) / 2);
  return 0.002 + 0.235 * progress ** 3.1 * (0.58 + centrality * 0.42);
}

function gridCoordinate(value: number, size: number): number {
  return clamp((value / (size - 1)) * 100, 0, 100);
}

function teamCounters(): TeamCounter {
  return {
    possessions: 0,
    actions: 0,
    passes: 0,
    carries: 0,
    shots: 0,
    turnovers: 0,
    goals: 0,
    expectedGoals: 0,
    shotXgSources: {
      playerProfile: 0,
      teamStatistics: 0,
      recentResults: 0,
      neutralPrior: 0,
    },
    estimatedValueAdded: 0,
    cells: Array.from({ length: GRID_COLUMNS * GRID_ROWS }, () => ({
      touches: 0,
      passes: 0,
      carries: 0,
      shots: 0,
      turnovers: 0,
      estimatedValueAdded: 0,
    })),
  };
}

function cellAt(counters: TeamCounter, x: number, y: number): MutableCell {
  const safeX = clamp(x, 0, GRID_COLUMNS - 1);
  const safeY = clamp(y, 0, GRID_ROWS - 1);
  return counters.cells[safeY * GRID_COLUMNS + safeX];
}

function playerCounter(
  counters: Map<string, PlayerCounter>,
  team: FootballFairAiTeam,
  player: Player | null,
): PlayerCounter | null {
  if (!player) return null;
  const key = `${team.teamKey}:${player.playerKey}`;
  const current = counters.get(key) ?? {
    playerKey: player.playerKey,
    teamName: team.name,
    playerName: player.name,
    simulatedGoals: 0,
    simulatedAssists: 0,
    simulatedPasses: 0,
    simulatedCarries: 0,
    simulatedShots: 0,
    simulatedDefensiveActions: 0,
    estimatedValueAdded: 0,
  };
  counters.set(key, current);
  return current;
}

function averageRating(team: FootballFairAiTeam): number {
  const players = availablePlayers(team);
  return average(players.map((player) => player.averageRating)) ??
    team.avgPlayerRating ??
    6.5;
}

function formationProgression(team: FootballFairAiTeam): number {
  const lines = (team.formation ?? "").match(/\d+/g)?.map(Number) ?? [];
  if (lines.length < 3) return 0;
  const midfielders = lines.slice(1, -1).reduce((sum, value) => sum + value, 0);
  return clamp((midfielders - 4) * 0.009, -0.018, 0.027);
}

function teamPassAccuracy(team: FootballFairAiTeam): number {
  const playerAverage = average(
    availablePlayers(team).map((player) => player.passCompletionPct),
  );
  const supplied = playerAverage ?? team.teamStats?.passCompletionPct;
  return clamp((supplied ?? 78) / 100, 0.55, 0.97);
}

function possessionShare(home: FootballFairAiTeam, away: FootballFairAiTeam): number {
  const homePossession = home.teamStats?.possessionPct;
  const awayPossession = away.teamStats?.possessionPct;
  const estimate =
    homePossession !== null && homePossession !== undefined &&
    awayPossession !== null && awayPossession !== undefined
      ? (homePossession + (100 - awayPossession)) / 2
      : homePossession ?? (awayPossession !== null && awayPossession !== undefined
        ? 100 - awayPossession
        : 50);
  return clamp(estimate, 25, 75);
}

function recentScoreRateEstimate(
  attacking: FootballFairAiTeam,
  defending: FootballFairAiTeam,
): number | null {
  const signals: number[] = [];
  if (attacking.recentMatchCount > 0 && Number.isFinite(attacking.avgGoalsFor)) {
    signals.push(Math.max(0, attacking.avgGoalsFor));
  }
  if (defending.recentMatchCount > 0 && Number.isFinite(defending.avgGoalsAgainst)) {
    signals.push(Math.max(0, defending.avgGoalsAgainst));
  }
  return average(signals);
}

function finishingMultiplier(
  team: FootballFairAiTeam,
  player: Player | null,
): number {
  if (player && player.expectedGoalsPer90 > 0 && player.goalsPer90 >= 0) {
    const appearances = Math.max(0, player.ratedAppearances || player.appearances);
    const reliability = clamp(appearances / (appearances + 8), 0, 0.75);
    const observedRatio = clamp(
      player.goalsPer90 / player.expectedGoalsPer90,
      0.65,
      1.35,
    );
    return 1 + (observedRatio - 1) * reliability;
  }

  const stats = team.teamStats;
  if (
    stats?.expectedGoalsFor !== null &&
    stats?.expectedGoalsFor !== undefined &&
    stats.expectedGoalsFor > 0 &&
    team.recentMatchCount > 0 &&
    stats.matchStatSampleCount > 0
  ) {
    const reliability = clamp(
      stats.matchStatSampleCount / (stats.matchStatSampleCount + 8),
      0,
      0.75,
    );
    const observedRatio = clamp(
      team.avgGoalsFor / stats.expectedGoalsFor,
      0.65,
      1.35,
    );
    return 1 + (observedRatio - 1) * reliability;
  }
  return 1;
}

function goalkeeperConversionFactor(team: FootballFairAiTeam): number {
  if (!availablePlayers(team).some(isGoalkeeper)) return 1;
  return clamp(1 + (0.59 - keeperSaveRate(team)) * 0.75, 0.78, 1.18);
}

function defensivePressure(
  team: FootballFairAiTeam,
  standingsStrength: number,
): number {
  const stats = team.teamStats;
  const playerActivity = average(
    availablePlayers(team)
      .filter((player) => isDefender(player) || isMidfielder(player))
      .map((player) => player.tacklesPer90 + player.interceptionsPer90),
  );
  const teamActivity = stats?.defensiveActionsPerMatch;
  return clamp(
    (playerActivity ?? 4) * 0.55 + (teamActivity ?? 90) * 0.01 +
      standingsStrength * 0.25,
    3,
    14,
  );
}

function keeperSaveRate(team: FootballFairAiTeam): number {
  const keeper = availablePlayers(team).find(isGoalkeeper);
  if (!keeper) return 0.59;
  return keeper.savesPer90 > 0
    ? clamp(0.59 + (keeper.savesPer90 - 2.8) * 0.035, 0.35, 0.78)
    : 0.59;
}

function chooseAction(
  team: FootballFairAiTeam,
  x: number,
  plannedShot: boolean,
  actionIndex: number,
): SimAction {
  if (plannedShot) {
    const shotThreshold = x >= 9 ? 0.86 : x >= 7 ? 0.66 : x >= 5 ? 0.4 : 0.08;
    if (
      (actionIndex === MAX_ACTIONS_PER_POSSESSION - 1 && x >= 4) ||
      Math.random() < shotThreshold
    ) {
      return "shot";
    }
  }
  const carryPreference = clamp(
    0.24 + formationProgression(team) * 1.5 +
      ((team.teamStats?.boxTouchesPerMatch ?? 18) - 18) * 0.001,
    0.12,
    0.38,
  );
  return Math.random() < carryPreference ? "carry" : "pass";
}

function passCompletionProbability(
  team: FootballFairAiTeam,
  opponent: FootballFairAiTeam,
  player: Player | null,
  x: number,
  teamStandingsStrength: number,
  opponentStandingsStrength: number,
): number {
  const playerAccuracy = player?.passCompletionPct === null || player?.passCompletionPct === undefined
    ? teamPassAccuracy(team)
    : player.passCompletionPct / 100;
  const finalThirdCompletion = team.teamStats?.finalThirdPassCompletionPct;
  const progressionSkill = x >= 7 && finalThirdCompletion !== null && finalThirdCompletion !== undefined
    ? (finalThirdCompletion - 70) * 0.0012
    : 0;
  const longBallSkill = team.teamStats?.longBallCompletionPct;
  const coachEdge = (team.teamStats?.coachMatches ?? 0) >= 10 &&
      team.teamStats?.coachWinPct !== null && team.teamStats?.coachWinPct !== undefined
    ? (team.teamStats.coachWinPct - 50) * 0.00025
    : 0;
  const fatigue = team.teamStats?.daysSinceLastMatch !== null && team.teamStats?.daysSinceLastMatch !== undefined
    ? clamp((team.teamStats.daysSinceLastMatch - 3) * 0.0008, -0.01, 0.008)
    : 0;
  const opponentPressure = defensivePressure(opponent, opponentStandingsStrength);
  const pressurePenalty = (opponentPressure - 7) * 0.002;
  const cardDisciplinePenalty =
    (team.teamStats?.redCardsPerMatch ?? 0) * 0.018 +
    (team.teamStats?.yellowCardsPerMatch ?? 0) * 0.001;
  const longBallBonus = longBallSkill === null || longBallSkill === undefined
    ? 0
    : (longBallSkill - 50) * 0.0002;
  return clamp(
    playerAccuracy + progressionSkill + coachEdge + fatigue + longBallBonus +
      teamStandingsStrength * 0.012 -
      pressurePenalty - cardDisciplinePenalty,
    0.54,
    0.97,
  );
}

function carryCompletionProbability(
  team: FootballFairAiTeam,
  opponent: FootballFairAiTeam,
  player: Player | null,
  teamStandingsStrength: number,
  opponentStandingsStrength: number,
): number {
  const duels = player?.duelsWonPct ?? average(
    availablePlayers(team).map((candidate) => candidate.duelsWonPct),
  ) ?? 50;
  const opponentPressure = defensivePressure(opponent, opponentStandingsStrength);
  const coachEdge = (team.teamStats?.coachMatches ?? 0) >= 10 &&
      team.teamStats?.coachWinPct !== null && team.teamStats?.coachWinPct !== undefined
    ? (team.teamStats.coachWinPct - 50) * 0.00015
    : 0;
  const cardDisciplinePenalty =
    (team.teamStats?.redCardsPerMatch ?? 0) * 0.02 +
    (team.teamStats?.yellowCardsPerMatch ?? 0) * 0.001;
  return clamp(
    0.69 + (duels - 50) * 0.002 - (opponentPressure - 7) * 0.004 +
      coachEdge - cardDisciplinePenalty + teamStandingsStrength * 0.012,
    0.48,
    0.9,
  );
}

function shotExpectedGoals(
  team: FootballFairAiTeam,
  opponent: FootballFairAiTeam,
  player: Player | null,
  x: number,
  y: number,
  attackingStandingsStrength: number,
  defendingStandingsStrength: number,
): { value: number; source: ShotXgSource } {
  const playerBase = player && player.shotsPer90 > 0 && player.expectedGoalsPer90 > 0
    ? player.expectedGoalsPer90 / player.shotsPer90
    : null;
  const teamBase = team.teamStats?.expectedGoalsFor !== null &&
      team.teamStats?.expectedGoalsFor !== undefined &&
      (team.teamStats?.shotsPerMatch ?? 0) > 0
    ? team.teamStats.expectedGoalsFor / (team.teamStats.shotsPerMatch ?? 1)
    : null;
  const recentScoreRate = recentScoreRateEstimate(team, opponent);
  const expectedShots = clamp(team.teamStats?.shotsPerMatch ?? 11.5, 2, 35);
  const recentResultsBase = recentScoreRate === null
    ? null
    : recentScoreRate / expectedShots;
  const source: ShotXgSource = playerBase !== null
    ? "playerProfile"
    : teamBase !== null
      ? "teamStatistics"
      : recentResultsBase !== null
        ? "recentResults"
        : "neutralPrior";
  const base = clamp(
    playerBase ?? teamBase ?? recentResultsBase ?? 0.105,
    0.035,
    0.36,
  );
  const locationFactor = 0.72 + (positionValue(x, y) / 0.235) * 0.43;
  const insideBox = team.teamStats?.shotsInsideBoxPerMatch;
  const shotCount = team.teamStats?.shotsPerMatch;
  const insideBoxFactor = insideBox !== null && insideBox !== undefined &&
      shotCount !== null && shotCount !== undefined && shotCount > 0
    ? clamp(0.9 + (insideBox / shotCount - 0.55) * 0.22, 0.86, 1.08)
    : 1;
  const bigChanceFactor = team.teamStats?.bigChancesPerMatch == null
    ? 1
    : clamp(0.94 + (team.teamStats.bigChancesPerMatch - 2) * 0.025, 0.84, 1.16);
  const bigChancesMissed = team.teamStats?.bigChancesMissedPerMatch;
  const bigChances = team.teamStats?.bigChancesPerMatch;
  const missedChanceFactor =
    bigChancesMissed !== null && bigChancesMissed !== undefined &&
    bigChances !== null && bigChances !== undefined &&
    bigChancesMissed + bigChances > 0
      ? clamp(1 - (bigChancesMissed / (bigChancesMissed + bigChances)) * 0.06, 0.94, 1)
      : 1;
  const ratingFactor = player?.averageRating == null
    ? 1
    : clamp(1 + (player.averageRating - 6.5) * 0.028, 0.88, 1.12);
  const opponentGoalsAllowed =
    opponent.teamStats?.expectedGoalsAgainst ??
    (opponent.recentMatchCount > 0 ? opponent.avgGoalsAgainst : null);
  const defensiveFactor = source === "recentResults" || opponentGoalsAllowed === null
    ? 1
    : clamp(1 + (opponentGoalsAllowed - 1.35) * 0.045, 0.88, 1.12);
  return {
    value: clamp(
      base * locationFactor * insideBoxFactor * bigChanceFactor *
        missedChanceFactor * ratingFactor * defensiveFactor +
        (attackingStandingsStrength - defendingStandingsStrength) * 0.012,
      0.015,
      0.48,
    ),
    source,
  };
}

function chooseReceiver(
  team: FootballFairAiTeam,
  actor: Player | null,
  x: number,
): Player | null {
  return choosePlayer(team, "pass", x, actor?.playerKey);
}

function chooseDefender(team: FootballFairAiTeam, x: number): Player | null {
  const defenders = availablePlayers(team).filter(
    (player) => isDefender(player) || isMidfielder(player),
  );
  return choosePlayer(
    { ...team, players: defenders.length ? defenders : team.players },
    "carry",
    x,
  );
}

function credit(
  playerCounters: Map<string, PlayerCounter>,
  team: FootballFairAiTeam,
  player: Player | null,
): PlayerCounter | null {
  return playerCounter(playerCounters, team, player);
}

function incrementCell(
  counters: TeamCounter,
  x: number,
  y: number,
  action: SimAction,
  valueAdded: number,
  turnover: boolean,
): void {
  const cell = cellAt(counters, x, y);
  cell.touches += 1;
  if (action === "pass") cell.passes += 1;
  if (action === "carry") cell.carries += 1;
  if (action === "shot") cell.shots += 1;
  if (turnover) cell.turnovers += 1;
  cell.estimatedValueAdded += valueAdded;
}

function newAction(
  action: SimAction,
  actor: Player | null,
  target: Player | null,
  minute: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  outcome: SimActionOutcome,
  valueBefore: number,
  valueAfter: number,
): SimulatedAction {
  return {
    action,
    actorName: actor?.name ?? "Player profile unavailable",
    targetName: target?.name ?? null,
    minute,
    startX: gridCoordinate(startX, GRID_COLUMNS),
    startY: gridCoordinate(startY, GRID_ROWS),
    endX: gridCoordinate(endX, GRID_COLUMNS),
    endY: gridCoordinate(endY, GRID_ROWS),
    outcome,
    valueBefore,
    valueAfter,
    estimatedValueAdded: valueAfter - valueBefore,
  };
}

function possessionSummary(
  team: FootballFairAiTeam,
  possessionSharePct: number,
  counters: TeamCounter,
  iterations: number,
): PossessionTeam {
  const perMatch = (value: number) => value / iterations;
  return {
    teamKey: team.teamKey,
    teamName: team.name,
    possessionSharePct,
    possessionsPerMatch: perMatch(counters.possessions),
    actionsPerMatch: perMatch(counters.actions),
    averageActionsPerPossession: counters.possessions
      ? counters.actions / counters.possessions
      : 0,
    passesPerMatch: perMatch(counters.passes),
    carriesPerMatch: perMatch(counters.carries),
    shotsPerMatch: perMatch(counters.shots),
    turnoversPerMatch: perMatch(counters.turnovers),
    expectedGoalsPerMatch: perMatch(counters.expectedGoals),
    estimatedValueAddedPer90: perMatch(counters.estimatedValueAdded),
    gridCells: counters.cells.map((cell, index) => ({
      x: index % GRID_COLUMNS,
      y: Math.floor(index / GRID_COLUMNS),
      touches: perMatch(cell.touches),
      passes: perMatch(cell.passes),
      carries: perMatch(cell.carries),
      shots: perMatch(cell.shots),
      turnovers: perMatch(cell.turnovers),
      estimatedValueAdded: perMatch(cell.estimatedValueAdded),
    })),
  };
}

export function runFairAiPossessionSimulation(
  home: FootballFairAiTeam,
  away: FootballFairAiTeam,
  requestedIterations: number,
): FootballFairAiSimulation {
  const iterations = clamp(Math.floor(requestedIterations), 1_000, 50_000);
  const homeShare = possessionShare(home, away);
  const awayShare = 100 - homeShare;
  const totals = new Map<string, TeamCounter>([
    [home.teamKey, teamCounters()],
    [away.teamKey, teamCounters()],
  ]);
  const playerTotals = new Map<string, PlayerCounter>();
  const scorelines = new Map<string, { homeGoals: number; awayGoals: number; count: number }>();
  const outcomes = { home: 0, draw: 0, away: 0 };
  const homeStandings = evaluateStandingsPerformance(home);
  const awayStandings = evaluateStandingsPerformance(away);
  const adjustmentsApplied =
    homeStandings.status === "applied" && awayStandings.status === "applied";
  const standingsStrengths = new Map<string, number>([
    [home.teamKey, adjustmentsApplied ? homeStandings.strengthScore ?? 0 : 0],
    [away.teamKey, adjustmentsApplied ? awayStandings.strengthScore ?? 0 : 0],
  ]);
  const samples: SimulatedPossession[] = [];
  const sampledByTeam = new Map<string, number>([[home.teamKey, 0], [away.teamKey, 0]]);
  const terminalStates: TerminalStateCounters = {
    goals: 0,
    shots: 0,
    turnovers: 0,
    retained: 0,
  };
  let dangerousAreaEntries = 0;
  let shotsOnTarget = 0;
  let totalPossessionNumber = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const shotBudgets = new Map<string, number>([
      [
        home.teamKey,
        samplePoisson(clamp(home.teamStats?.shotsPerMatch ?? 11.5, 2, 35)),
      ],
      [
        away.teamKey,
        samplePoisson(clamp(away.teamStats?.shotsPerMatch ?? 11.5, 2, 35)),
      ],
    ]);
    let homeGoals = 0;
    let awayGoals = 0;

    for (let index = 0; index < POSSESSIONS_PER_MATCH; index += 1) {
      const attacking = Math.random() * 100 < homeShare ? home : away;
      const defending = attacking.teamKey === home.teamKey ? away : home;
      const attackingStandingsStrength = standingsStrengths.get(attacking.teamKey) ?? 0;
      const defendingStandingsStrength = standingsStrengths.get(defending.teamKey) ?? 0;
      const attackingTotals = totals.get(attacking.teamKey);
      const defendingTotals = totals.get(defending.teamKey);
      if (!attackingTotals || !defendingTotals) continue;
      attackingTotals.possessions += 1;
      totalPossessionNumber += 1;
       const remainingPossessions = POSSESSIONS_PER_MATCH - index;
       const expectedRemainingTeamPossessions = remainingPossessions *
         (attacking.teamKey === home.teamKey ? homeShare : awayShare) / 100;
       const shotBudget = shotBudgets.get(attacking.teamKey) ?? 0;
       const plannedShot = Math.random() <
         clamp(shotBudget / Math.max(1, expectedRemainingTeamPossessions), 0, 1);
      let x = 1 + randomInteger(3);
      let y = 1 + randomInteger(GRID_ROWS - 2);
      const minute = 1 + Math.floor((index / POSSESSIONS_PER_MATCH) * 90);
      const sampleThisPossession = iteration === 0 &&
        (sampledByTeam.get(attacking.teamKey) ?? 0) < 2;
      const actionLog: SimulatedAction[] = [];
      let possessionValueAdded = 0;
      let possessionOutcome: SimPossessionOutcome = "retained";
      let goalScorer: Player | null = null;
      let lastCreator: Player | null = null;

      for (let actionIndex = 0; actionIndex < MAX_ACTIONS_PER_POSSESSION; actionIndex += 1) {
         const action = chooseAction(attacking, x, plannedShot, actionIndex);
        const actor = choosePlayer(attacking, action, x);
        const actorCredit = credit(playerTotals, attacking, actor);
        if (action === "pass") {
          attackingTotals.passes += 1;
          if (actorCredit) actorCredit.simulatedPasses += 1;
        } else if (action === "carry") {
          attackingTotals.carries += 1;
          if (actorCredit) actorCredit.simulatedCarries += 1;
        }
        const startX = x;
        const startY = y;
        const valueBefore = positionValue(startX, startY);
        let endX = startX;
        let endY = startY;
        let target: Player | null = null;
        let outcome: SimActionOutcome;
        let valueAfter = 0;
        let turnover = false;

        if (action === "shot") {
           shotBudgets.set(attacking.teamKey, Math.max(0, shotBudget - 1));
          attackingTotals.shots += 1;
          if (actorCredit) actorCredit.simulatedShots += 1;
          const shotXg = shotExpectedGoals(
            attacking,
            defending,
            actor,
            x,
            y,
            attackingStandingsStrength,
            defendingStandingsStrength,
          );
          attackingTotals.expectedGoals += shotXg;
          const xgRoll = Math.random();
          const accuracy = actor?.shotAccuracyPct == null
            ? (attacking.teamStats?.shotsPerMatch ?? 0) > 0 &&
                (attacking.teamStats?.shotsOnTargetPerMatch ?? 0) > 0
              ? clamp(
                  (attacking.teamStats?.shotsOnTargetPerMatch ?? 0) /
                    (attacking.teamStats?.shotsPerMatch ?? 1),
                  0.18,
                  0.78,
                )
              : 0.39
            : clamp(actor.shotAccuracyPct / 100, 0.18, 0.78);
          if (xgRoll < shotXg) {
            outcome = "goal";
            shotsOnTarget += 1;
            valueAfter = 1;
            possessionOutcome = "goal";
            attackingTotals.goals += 1;
            if (attacking.teamKey === home.teamKey) homeGoals += 1;
            else awayGoals += 1;
            goalScorer = actor;
            if (actorCredit) actorCredit.simulatedGoals += 1;
          } else if (xgRoll < accuracy) {
            outcome = "saved";
            shotsOnTarget += 1;
            valueAfter = 0;
            possessionOutcome = "shot";
          } else if (Math.random() < 0.22) {
            outcome = "blocked";
            possessionOutcome = "shot";
          } else {
            outcome = "missed";
            possessionOutcome = "shot";
          }
          endX = GRID_COLUMNS - 1;
          valueAfter = outcome === "goal" ? 1 : 0;
        } else {
          const successProbability = action === "pass"
            ? passCompletionProbability(
                attacking,
                defending,
                actor,
                x,
                attackingStandingsStrength,
                defendingStandingsStrength,
              )
            : carryCompletionProbability(
                attacking,
                defending,
                actor,
                attackingStandingsStrength,
                defendingStandingsStrength,
              );
          const successful = Math.random() < successProbability;
          if (successful) {
            const advancement = action === "pass"
              ? (Math.random() < 0.24 ? 3 : Math.random() < 0.56 ? 2 : 1)
              : (Math.random() < 0.22 ? 2 : 1);
            endX = Math.min(GRID_COLUMNS - 1, x + advancement);
            const widthDrift = Math.random() < 0.28 ? (Math.random() < 0.5 ? -1 : 1) : 0;
            endY = clamp(
              y + widthDrift + (action === "carry" && Math.random() < 0.35 ? (y < 4 ? 1 : -1) : 0),
              0,
              GRID_ROWS - 1,
            );
            x = endX;
            y = endY;
            valueAfter = positionValue(endX, endY);
            outcome = "complete";
            if (action === "pass") {
              target = chooseReceiver(attacking, actor, endX);
              lastCreator = actor;
            } else {
              // Carries are counted as attempts above, including failed carries.
            }
            if (actionIndex === MAX_ACTIONS_PER_POSSESSION - 1) {
              possessionOutcome = "retained";
            }
          } else {
            outcome = "intercepted";
            turnover = true;
            possessionOutcome = "turnover";
            attackingTotals.turnovers += 1;
            const defender = chooseDefender(defending, startX);
            const defenderCredit = credit(playerTotals, defending, defender);
            if (defenderCredit) defenderCredit.simulatedDefensiveActions += 1;
            endX = Math.max(0, startX - 1);
            valueAfter = 0;
          }
        }

        if (
          action !== "shot" &&
          !turnover &&
          startX < DANGEROUS_AREA_START_X &&
          endX >= DANGEROUS_AREA_START_X
        ) {
          dangerousAreaEntries += 1;
        }

        const loggedAction = newAction(
          action,
          actor,
          target,
          minute,
          startX,
          startY,
          endX,
          endY,
          outcome,
          valueBefore,
          valueAfter,
        );
        const valueAdded = loggedAction.estimatedValueAdded;
        possessionValueAdded += valueAdded;
        attackingTotals.estimatedValueAdded += valueAdded;
        attackingTotals.actions += 1;
        incrementCell(attackingTotals, startX, startY, action, valueAdded, turnover);
        if (actorCredit) actorCredit.estimatedValueAdded += valueAdded;
        if (sampleThisPossession) actionLog.push(loggedAction);
        if (action === "shot" || turnover) break;
      }

      if (possessionOutcome === "goal") terminalStates.goals += 1;
      else if (possessionOutcome === "shot") terminalStates.shots += 1;
      else if (possessionOutcome === "turnover") terminalStates.turnovers += 1;
      else terminalStates.retained += 1;

      if (goalScorer && lastCreator && goalScorer.playerKey !== lastCreator.playerKey &&
          Math.random() < 0.68) {
        const creatorCredit = credit(playerTotals, attacking, lastCreator);
        if (creatorCredit) creatorCredit.simulatedAssists += 1;
      }
      if (sampleThisPossession) {
        samples.push({
          possessionNumber: totalPossessionNumber,
          teamName: attacking.name,
          minute,
          outcome: possessionOutcome,
          estimatedValueAdded: possessionValueAdded,
          actions: actionLog,
        });
        sampledByTeam.set(attacking.teamKey, (sampledByTeam.get(attacking.teamKey) ?? 0) + 1);
      }
    }

    if (homeGoals > awayGoals) outcomes.home += 1;
    else if (homeGoals === awayGoals) outcomes.draw += 1;
    else outcomes.away += 1;
    const key = `${homeGoals}-${awayGoals}`;
    const scoreline = scorelines.get(key);
    if (scoreline) scoreline.count += 1;
    else scorelines.set(key, { homeGoals, awayGoals, count: 1 });
  }

  const homeTotals = totals.get(home.teamKey) ?? teamCounters();
  const awayTotals = totals.get(away.teamKey) ?? teamCounters();
  const diagnostics = {
    possessions: totalPossessionNumber,
    actions: homeTotals.actions + awayTotals.actions,
    dangerousAreaEntries,
    turnovers: homeTotals.turnovers + awayTotals.turnovers,
    shots: homeTotals.shots + awayTotals.shots,
    shotsOnTarget,
    goals: homeTotals.goals + awayTotals.goals,
    terminalStates,
  };
  const terminalCount = terminalStates.goals + terminalStates.shots +
    terminalStates.turnovers + terminalStates.retained;
  const outcomeCount = outcomes.home + outcomes.draw + outcomes.away;
  const scorelineCount = [...scorelines.values()].reduce(
    (sum, scoreline) => sum + scoreline.count,
    0,
  );
  const scorelineGoals = [...scorelines.values()].reduce(
    (sum, scoreline) =>
      sum + (scoreline.homeGoals + scoreline.awayGoals) * scoreline.count,
    0,
  );
  if (
    terminalCount !== diagnostics.possessions ||
    outcomeCount !== iterations ||
    scorelineCount !== iterations ||
    diagnostics.shots !== terminalStates.goals + terminalStates.shots ||
    diagnostics.turnovers !== terminalStates.turnovers ||
    diagnostics.goals !== terminalStates.goals ||
    diagnostics.goals !== scorelineGoals ||
    diagnostics.shotsOnTarget > diagnostics.shots ||
    diagnostics.goals > diagnostics.shotsOnTarget ||
    diagnostics.dangerousAreaEntries > diagnostics.actions
  ) {
    throw new Error("Simulation counters failed consistency checks.");
  }
  const averageHomeGoals = homeTotals.expectedGoals / iterations;
  const averageAwayGoals = awayTotals.expectedGoals / iterations;
  const contributions: PlayerContribution[] = [...playerTotals.values()]
    .map((player) => ({
      ...player,
      contributionScore: (
        player.simulatedGoals + player.simulatedAssists * 0.7 +
        player.estimatedValueAdded * 0.3
      ) / iterations,
      estimatedValueAdded: player.estimatedValueAdded / iterations,
    }))
    .sort((left, right) => right.contributionScore - left.contributionScore)
    .slice(0, 20);

  return {
    iterations,
    home,
    away,
    expectedHomeGoals: averageHomeGoals,
    expectedAwayGoals: averageAwayGoals,
    outcomes,
    probabilities: {
      home: outcomes.home / iterations,
      draw: outcomes.draw / iterations,
      away: outcomes.away / iterations,
    },
    diagnostics,
    standingsContext: {
      adjustmentsApplied,
      home: homeStandings,
      away: awayStandings,
    },
    topScorelines: [...scorelines.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, 6)
      .map((scoreline) => ({
        ...scoreline,
        probability: scoreline.count / iterations,
      })),
    playerContributions: contributions,
    possessionModel: {
      gridColumns: GRID_COLUMNS,
      gridRows: GRID_ROWS,
      coordinateBasis: "Model-generated attack-direction grid; x=0 is a team's own end and x=100 is the opponent's end. No source tracking coordinates are available.",
      home: possessionSummary(home, homeShare, homeTotals, iterations),
      away: possessionSummary(away, awayShare, awayTotals, iterations),
      sampledPossessions: samples,
    },
    method: `Possession-by-possession Monte Carlo over ${iterations.toLocaleString()} simulated matches. Player rates, recent formations, match xG/shot/possession metrics, big-chance outcomes, card trends, defensive actions and available coach records shape action selection and outcomes. When both teams have fresh standings snapshots, normalized rank, points-per-game, goal difference and form add small bounded execution and shot-quality adjustments.`,
    limitations: [
      "Player roles and action profiles are aggregated from recent archived lineups and match statistics; the latest observed starting XI is not a confirmed future lineup.",
      "The 12 × 8 pitch path, action locations, and estimated value-added deltas are generated from tactical roles and aggregate rates. They are model proxies, not observed coordinates, measured spatial xT/EVA, or a trained reinforcement-learning policy.",
      "Player age, height, preferred foot, contract, market value, full season histories, club average age/squad value/founding year, and manager biography are not part of these archived fixture records and are not inferred.",
      "Standings adjustments use snapshots observed no more than 30 days before the simulation and reject future-dated or invalid timestamps. The observation time is when the source snapshot was fetched, not a guaranteed effective date; standings are not used in historical training, and comparisons across different leagues are approximate.",
      "Results are experimental and are not betting advice.",
    ],
  };
}
