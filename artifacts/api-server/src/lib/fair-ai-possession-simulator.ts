import type {
  FootballFairAiActionEvidence,
  FootballFairAiActionTeamEvidence,
  FootballFairAiOddsBaseline,
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
type GameStateKey = keyof FootballFairAiSimulation["matchupAnalysis"]["home"]["gameStateResponse"];
type GameStateSample = FootballFairAiSimulation["matchupAnalysis"]["home"]["gameStateResponse"]["level"];
type MatchupTeamAnalysis = FootballFairAiSimulation["matchupAnalysis"]["home"];
type MatchHalf = "first" | "second";

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
  finishingAdjustmentTotal: number;
  keeperConversionFactorTotal: number;
  shotQualityEvents: number;
  shotXgSources: Record<ShotXgSource, number>;
  estimatedValueAdded: number;
  gameStates: Record<GameStateKey, { possessions: number; shots: number; goals: number }>;
  cells: MutableCell[];
};

type CurrentGameState = {
  key: GameStateKey;
  minute: number;
  trailingLate: boolean;
  protectingLeadLate: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function emptyActionTeamEvidence(): FootballFairAiActionTeamEvidence {
  return {
    matchesAnalyzed: 0,
    matchesUnavailable: 0,
    commentaryEvents: 0,
    goals: 0,
    substitutions: 0,
    cards: 0,
    shots: 0,
    firstHalfShots: 0,
    secondHalfShots: 0,
    shotsOnTarget: 0,
    shotsOffTarget: 0,
    averageXgPerShot: null,
    averageXgotPerShot: null,
    averageXgotMinusXg: null,
    averageShotX: null,
    players: [],
    keyEvents: [],
  };
}

function emptyActionEvidence(): FootballFairAiActionEvidence {
  return {
    source: "365Scores commentary and shot feed",
    home: emptyActionTeamEvidence(),
    away: emptyActionTeamEvidence(),
    note: "No matched 365Scores recent-match shot reports were supplied.",
  };
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
    finishingAdjustmentTotal: 0,
    keeperConversionFactorTotal: 0,
    shotQualityEvents: 0,
    shotXgSources: {
      playerProfile: 0,
      "365Scores": 0,
      teamStatistics: 0,
      recentResults: 0,
      neutralPrior: 0,
    },
    estimatedValueAdded: 0,
    gameStates: {
      leading: { possessions: 0, shots: 0, goals: 0 },
      level: { possessions: 0, shots: 0, goals: 0 },
      trailing: { possessions: 0, shots: 0, goals: 0 },
    },
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

function possessionShare(
  home: FootballFairAiTeam,
  away: FootballFairAiTeam,
  half?: MatchHalf,
): number {
  const homePossession = half === "first"
    ? home.teamStats?.firstHalfPossessionPct ?? home.teamStats?.possessionPct
    : half === "second"
      ? home.teamStats?.secondHalfPossessionPct ?? home.teamStats?.possessionPct
      : home.teamStats?.possessionPct;
  const awayPossession = half === "first"
    ? away.teamStats?.firstHalfPossessionPct ?? away.teamStats?.possessionPct
    : half === "second"
      ? away.teamStats?.secondHalfPossessionPct ?? away.teamStats?.possessionPct
      : away.teamStats?.possessionPct;
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

function expectedShotBudget(
  attacking: FootballFairAiTeam,
  defending: FootballFairAiTeam,
  half?: MatchHalf,
): number {
  const halfShots = half === "first"
    ? attacking.teamStats?.firstHalfShotsPerMatch
    : half === "second"
      ? attacking.teamStats?.secondHalfShotsPerMatch
      : null;
  if (halfShots !== null && halfShots !== undefined && halfShots > 0) {
    return clamp(halfShots, 1, 22);
  }
  const suppliedShots = attacking.teamStats?.shotsPerMatch;
  if (suppliedShots !== null && suppliedShots !== undefined && suppliedShots > 0) {
    return clamp(half ? suppliedShots / 2 : suppliedShots, 1, half ? 17.5 : 35);
  }
  const recentScoreRate = recentScoreRateEstimate(attacking, defending);
  if (recentScoreRate === null) return half ? 5.75 : 11.5;
  const sampleCount = Math.max(0, attacking.recentMatchCount);
  const reliability = clamp(sampleCount / (sampleCount + 10), 0, 0.55);
  const fullMatchBudget = clamp(11.5 + (recentScoreRate - 1.35) * 3 * reliability, 6, 18);
  return half ? fullMatchBudget / 2 : fullMatchBudget;
}

function marketShotBudgetScale(
  team: FootballFairAiTeam,
  opponent: FootballFairAiTeam,
  oddsExpectedGoals: number | undefined,
): number {
  if (oddsExpectedGoals === undefined || oddsExpectedGoals <= 0) return 1;
  const ownGoalRate = team.teamStats?.expectedGoalsFor ??
    (team.recentMatchCount > 0 ? team.avgGoalsFor : null);
  const opponentConcededRate = opponent.teamStats?.expectedGoalsAgainst ??
    (opponent.recentMatchCount > 0 ? opponent.avgGoalsAgainst : null);
  const availableRates = [ownGoalRate, opponentConcededRate]
    .filter((value): value is number => value !== null && value !== undefined && value > 0);
  const archiveProjection = average(availableRates);
  if (archiveProjection === null || archiveProjection <= 0) return 1;
  return clamp(Math.pow(oddsExpectedGoals / archiveProjection, 0.62), 0.68, 1.42);
}

function actionPhaseShotScale(
  evidence: FootballFairAiActionTeamEvidence,
  half: MatchHalf,
): number {
  const totalShots = evidence.firstHalfShots + evidence.secondHalfShots;
  if (evidence.matchesAnalyzed === 0 || totalShots < 6) return 1;
  const observedShare = (half === "first" ? evidence.firstHalfShots : evidence.secondHalfShots) /
    totalShots;
  return clamp(1 + (observedShare - 0.5) * 0.24, 0.88, 1.12);
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

function hasObservedPressureEvidence(team: FootballFairAiTeam): boolean {
  if (team.teamStats?.defensiveActionsPerMatch != null) return true;
  return availablePlayers(team).some(
    (player) => player.tacklesPer90 > 0 || player.interceptionsPer90 > 0,
  );
}

function buildupVsPressAdjustment(
  attacking: FootballFairAiTeam,
  defending: FootballFairAiTeam,
  defendingStandingsStrength: number,
): number {
  const pressure = defensivePressure(defending, defendingStandingsStrength);
  const disruption = -(pressure - 7) * 0.002;
  const longBallCompletion = attacking.teamStats?.longBallCompletionPct;
  const longBallEscape = longBallCompletion == null
    ? 0
    : Math.max(0, pressure - 7) *
      Math.max(0, longBallCompletion - 50) * 0.00012;
  return clamp(disruption + longBallEscape, -0.06, 0.05);
}

function gameStateFor(
  goalsFor: number,
  goalsAgainst: number,
  minute: number,
): CurrentGameState {
  const key: GameStateKey = goalsFor > goalsAgainst
    ? "leading"
    : goalsFor < goalsAgainst
      ? "trailing"
      : "level";
  return {
    key,
    minute,
    trailingLate: key === "trailing" && minute >= 65,
    protectingLeadLate: key === "leading" && minute >= 65,
  };
}

function chooseAction(
  team: FootballFairAiTeam,
  x: number,
  plannedShot: boolean,
  actionIndex: number,
  gameState: CurrentGameState,
): SimAction {
  if (plannedShot) {
    const baseShotThreshold = x >= 9 ? 0.86 : x >= 7 ? 0.66 : x >= 5 ? 0.4 : 0.08;
    const urgency = gameState.trailingLate
      ? 1.55
      : gameState.key === "trailing"
        ? 1.18
        : gameState.protectingLeadLate
          ? 0.78
          : 1;
    const shotThreshold = clamp(baseShotThreshold * urgency, 0, 0.98);
    if (
      (actionIndex === MAX_ACTIONS_PER_POSSESSION - 1 && x >= 4) ||
      Math.random() < shotThreshold
    ) {
      return "shot";
    }
  }
  const carryPreference = clamp(
    0.24 + formationProgression(team) * 1.5 +
      ((team.teamStats?.boxTouchesPerMatch ?? 18) - 18) * 0.001 +
      (gameState.key === "trailing" ? 0.025 : 0) +
      (gameState.protectingLeadLate ? 0.02 : 0),
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
  gameState: CurrentGameState,
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
  const matchupAdjustment = buildupVsPressAdjustment(
    team,
    opponent,
    opponentStandingsStrength,
  );
  const gameStateRisk = gameState.trailingLate
    ? -0.025
    : gameState.key === "trailing"
      ? -0.01
      : gameState.protectingLeadLate
        ? 0.01
        : 0;
  const cardDisciplinePenalty =
    (team.teamStats?.redCardsPerMatch ?? 0) * 0.018 +
    (team.teamStats?.yellowCardsPerMatch ?? 0) * 0.001;
  const longBallBonus = longBallSkill === null || longBallSkill === undefined
    ? 0
    : (longBallSkill - 50) * 0.0002;
  return clamp(
    playerAccuracy + progressionSkill + coachEdge + fatigue + longBallBonus +
      teamStandingsStrength * 0.012 -
      cardDisciplinePenalty + matchupAdjustment + gameStateRisk,
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
  gameState: CurrentGameState,
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
      coachEdge - cardDisciplinePenalty + teamStandingsStrength * 0.012 +
      (gameState.trailingLate ? -0.02 : gameState.protectingLeadLate ? 0.015 : 0),
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
  actionEvidence: FootballFairAiActionTeamEvidence,
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
  const expectedShots = expectedShotBudget(team, opponent);
  const recentResultsBase = recentScoreRate === null
    ? null
    : recentScoreRate / expectedShots;
  const archivedBase = playerBase ?? teamBase ?? recentResultsBase ?? 0.105;
  const observed365Base = actionEvidence.shots >= 4
    ? actionEvidence.averageXgPerShot
    : null;
  const source: ShotXgSource = observed365Base !== null
    ? "365Scores"
    : playerBase !== null
    ? "playerProfile"
    : teamBase !== null
      ? "teamStatistics"
      : recentResultsBase !== null
        ? "recentResults"
        : "neutralPrior";
  const observed365Weight = observed365Base === null
    ? 0
    : clamp(actionEvidence.shots / (actionEvidence.shots + 16), 0.12, 0.42);
  const base = clamp(
    archivedBase * (1 - observed365Weight) +
      (observed365Base ?? archivedBase) * observed365Weight,
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
  const placementReliability = actionEvidence.shots >= 4
    ? clamp(actionEvidence.shots / (actionEvidence.shots + 12), 0.15, 0.62)
    : 0;
  const placementFactor = actionEvidence.averageXgotMinusXg === null
    ? 1
    : clamp(
        1 + actionEvidence.averageXgotMinusXg * placementReliability * 0.38,
        0.9,
        1.1,
      );
  return {
    value: clamp(
      base * locationFactor * insideBoxFactor * bigChanceFactor *
        missedChanceFactor * ratingFactor * defensiveFactor * placementFactor +
        (attackingStandingsStrength - defendingStandingsStrength) * 0.012,
      0.015,
      0.48,
    ),
    source,
  };
}

function wilsonInterval(
  successes: number,
  trials: number,
): { lower: number; upper: number } {
  if (trials <= 0) return { lower: 0, upper: 1 };
  const z = 1.96;
  const probability = successes / trials;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trials;
  const center = (probability + zSquared / (2 * trials)) / denominator;
  const margin = z * Math.sqrt(
    probability * (1 - probability) / trials +
      zSquared / (4 * trials * trials),
  ) / denominator;
  return {
    lower: clamp(center - margin, 0, 1),
    upper: clamp(center + margin, 0, 1),
  };
}

function inputAuditForTeam(
  team: FootballFairAiTeam,
  counters: TeamCounter,
  actionEvidence: FootballFairAiActionTeamEvidence,
): FootballFairAiSimulation["inputAudit"]["home"] {
  const players = team.players ?? [];
  const detailedMatchStatSamples = team.teamStats?.matchStatSampleCount ?? 0;
  const goalkeeperProfiles = players.filter(isGoalkeeper).length;
  const warnings: string[] = [];
  if (team.recentMatchCount === 0) {
    warnings.push("No recent completed score records are available.");
  }
  if (detailedMatchStatSamples === 0) {
    warnings.push("No detailed team match-stat samples are available.");
  }
  if (players.length === 0) {
    warnings.push("No archived player profiles are available; player-level rates use no source evidence.");
  } else {
    warnings.push("Archived player profiles are not a confirmed lineup for the simulated fixture.");
  }
  if (goalkeeperProfiles === 0) {
    warnings.push("No archived goalkeeper profile is available; keeper quality is neutral.");
  }
  if (counters.shotXgSources.recentResults > 0) {
    warnings.push("Some shot xG proxies use recent goals-for and opponent goals-against divided by the expected shot budget.");
  }
  if (counters.shotXgSources.neutralPrior > 0) {
    warnings.push("Some shot xG proxies use the neutral 0.105-per-shot prior.");
  }
  if (actionEvidence.matchesAnalyzed > 0) {
    warnings.push(
      `Recent 365Scores reports contributed ${actionEvidence.shots} shot events across ${actionEvidence.matchesAnalyzed} matched matches; their xGOT−xG effect is a bounded placement proxy.`,
    );
  } else {
    warnings.push("No matched 365Scores recent-match shot reports were available for this team.");
  }
  const coverage = detailedMatchStatSamples >= 5 && players.length >= 11
    ? "broad"
    : detailedMatchStatSamples >= 2 || players.length >= 5
      ? "partial"
      : "limited";
  return {
    recentMatches: team.recentMatchCount,
    detailedMatchStatSamples,
    archivePlayerProfiles: players.length,
    goalkeeperProfiles,
    shotXgSources: { ...counters.shotXgSources },
    coverage,
    warnings,
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

function gameStateSample(
  sample: TeamCounter["gameStates"][GameStateKey],
): GameStateSample {
  return {
    possessions: sample.possessions,
    shots: sample.shots,
    goals: sample.goals,
    shotsPer100Possessions: sample.possessions
      ? sample.shots / sample.possessions * 100
      : 0,
  };
}

function matchupTeamAnalysis(
  team: FootballFairAiTeam,
  opponent: FootballFairAiTeam,
  teamCounter: TeamCounter,
  iterations: number,
  opponentStandingsStrength: number,
): MatchupTeamAnalysis {
  const archivedPlayers = team.players ?? [];
  const players = availablePlayers(team);
  const playerPassEvidence = players.some(
    (player) => player.passCompletionPct !== null && player.passCompletionPct !== undefined,
  );
  const teamPassEvidence = team.teamStats?.passCompletionPct !== null &&
    team.teamStats?.passCompletionPct !== undefined;
  const pressureEvidence = hasObservedPressureEvidence(opponent);
  const buildupEvidence = playerPassEvidence || teamPassEvidence ||
    team.teamStats?.longBallCompletionPct != null;
  const evidenceQuality = buildupEvidence && pressureEvidence
    ? "proxy"
    : buildupEvidence || pressureEvidence
      ? "limited"
      : "missing";
  const stats = team.teamStats;
  const passesObserved = playerPassEvidence || teamPassEvidence;
  const passCompletionEvidencePct = passesObserved
    ? teamPassAccuracy(team) * 100
    : null;
  const opponentPressureProxy = defensivePressure(
    opponent,
    opponentStandingsStrength,
  );
  const shotsPerMatch = teamCounter.shots / iterations;
  const expectedGoalsPerMatch = teamCounter.expectedGoals / iterations;
  const playerGroups = {
    forwards: players.filter(isForward).length,
    midfielders: players.filter(isMidfielder).length,
    defenders: players.filter(isDefender).length,
    goalkeepers: players.filter(isGoalkeeper).length,
  };
  const stateSamples = teamCounter.gameStates;
  return {
    tacticalInteraction: {
      formation: team.formation,
      passCompletionEvidencePct,
      longBallCompletionEvidencePct: stats?.longBallCompletionPct ?? null,
      opponentPressureProxy,
      buildupVsPressAdjustmentPct: buildupVsPressAdjustment(
        team,
        opponent,
        opponentStandingsStrength,
      ) * 100,
      evidenceQuality,
    },
    playerRoleCoverage: {
      archivedProfiles: archivedPlayers.length,
      profilesUsed: players.length,
      archivedStarters: archivedPlayers.filter((player) => player.starter).length,
      ...playerGroups,
    },
    chanceAndExecution: {
      shotsPerMatch,
      expectedGoalsPerMatch,
      simulatedGoalsPerMatch: teamCounter.goals / iterations,
      expectedGoalsPerShot: teamCounter.shots
        ? teamCounter.expectedGoals / teamCounter.shots
        : 0,
      averageFinishingAdjustment: teamCounter.shotQualityEvents
        ? teamCounter.finishingAdjustmentTotal / teamCounter.shotQualityEvents
        : 1,
      opposingKeeperConversionFactor: teamCounter.shotQualityEvents
        ? teamCounter.keeperConversionFactorTotal / teamCounter.shotQualityEvents
        : 1,
    },
    gameStateResponse: {
      leading: gameStateSample(stateSamples.leading),
      level: gameStateSample(stateSamples.level),
      trailing: gameStateSample(stateSamples.trailing),
    },
  };
}

function fairAiForecastWeight(
  home: FootballFairAiTeam,
  away: FootballFairAiTeam,
  actionEvidence: FootballFairAiActionEvidence,
): number {
  const recentCoverage = clamp(
    (home.recentMatchCount + away.recentMatchCount) / 10,
    0,
    1,
  );
  const statCoverage = clamp(
    ((home.teamStats?.matchStatSampleCount ?? 0) +
      (away.teamStats?.matchStatSampleCount ?? 0)) / 10,
    0,
    1,
  );
  const playerCoverage = clamp(
    ((home.players?.length ?? 0) + (away.players?.length ?? 0)) / 22,
    0,
    1,
  );
  const reportCoverage = clamp(
    (actionEvidence.home.matchesAnalyzed + actionEvidence.away.matchesAnalyzed) / 4,
    0,
    1,
  );
  const shotCoverage = clamp(
    (actionEvidence.home.shots + actionEvidence.away.shots) / 24,
    0,
    1,
  );
  const evidenceStrength =
    recentCoverage * 0.2 +
    statCoverage * 0.25 +
    playerCoverage * 0.15 +
    reportCoverage * 0.25 +
    shotCoverage * 0.15;
  return clamp(0.4 + evidenceStrength * 0.35, 0.4, 0.75);
}

function blendedScorelines(
  simulated: { homeGoals: number; awayGoals: number; count: number }[],
  iterations: number,
  oddsBaseline: FootballFairAiOddsBaseline | undefined,
  fairAiWeight: number,
): {
  scorelines: { homeGoals: number; awayGoals: number; count: number; probability: number }[];
  oddsWeight: number;
  fairAiWeight: number;
} {
  const simulatedProbabilities = new Map<string, number>();
  for (const scoreline of simulated) {
    simulatedProbabilities.set(
      `${scoreline.homeGoals}-${scoreline.awayGoals}`,
      scoreline.count / iterations,
    );
  }
  const baselineProbabilities = new Map<string, number>();
  let baselineMass = 0;
  for (const scoreline of oddsBaseline?.scorelineDistribution ?? []) {
    if (
      !Number.isInteger(scoreline.homeGoals) ||
      !Number.isInteger(scoreline.awayGoals) ||
      !Number.isFinite(scoreline.probability) ||
      scoreline.probability < 0
    ) {
      continue;
    }
    const key = `${scoreline.homeGoals}-${scoreline.awayGoals}`;
    baselineProbabilities.set(
      key,
      (baselineProbabilities.get(key) ?? 0) + scoreline.probability,
    );
    baselineMass += scoreline.probability;
  }

  if (baselineMass <= 0) {
    return {
      scorelines: simulated.map((scoreline) => ({
        ...scoreline,
        probability: scoreline.count / iterations,
      })),
      oddsWeight: 0,
      fairAiWeight: 1,
    };
  }

  const oddsWeight = 1 - fairAiWeight;
  const keys = new Set([
    ...simulatedProbabilities.keys(),
    ...baselineProbabilities.keys(),
  ]);
  const blended = [...keys].map((key) => {
    const [homeGoals, awayGoals] = key.split("-").map(Number);
    const probability =
      oddsWeight * (baselineProbabilities.get(key) ?? 0) / baselineMass +
      fairAiWeight * (simulatedProbabilities.get(key) ?? 0);
    return { homeGoals, awayGoals, probability, count: 0 };
  });
  const totalProbability = blended.reduce(
    (sum, scoreline) => sum + scoreline.probability,
    0,
  );
  if (totalProbability <= 0) {
    return {
      scorelines: simulated.map((scoreline) => ({
        ...scoreline,
        probability: scoreline.count / iterations,
      })),
      oddsWeight: 0,
      fairAiWeight: 1,
    };
  }
  for (const scoreline of blended) {
    scoreline.probability /= totalProbability;
  }

  const roundedCounts = blended.map((scoreline) => {
    const exactCount = scoreline.probability * iterations;
    return { scoreline, count: Math.floor(exactCount), remainder: exactCount % 1 };
  });
  let remaining = iterations - roundedCounts.reduce((sum, row) => sum + row.count, 0);
  for (const row of [...roundedCounts].sort((left, right) => right.remainder - left.remainder)) {
    if (remaining <= 0) break;
    row.count += 1;
    remaining -= 1;
  }

  return {
    scorelines: roundedCounts
      .map(({ scoreline, count }) => ({ ...scoreline, count }))
      .sort((left, right) => right.probability - left.probability),
    oddsWeight,
    fairAiWeight,
  };
}

export function runFairAiPossessionSimulation(
  home: FootballFairAiTeam,
  away: FootballFairAiTeam,
  requestedIterations: number,
  context: {
    oddsBaseline?: FootballFairAiOddsBaseline;
    actionEvidence: FootballFairAiActionEvidence;
  } = { actionEvidence: emptyActionEvidence() },
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
  const homeActionEvidence = context.actionEvidence.home;
  const awayActionEvidence = context.actionEvidence.away;
  const homeMarketScale = marketShotBudgetScale(
    home,
    away,
    context.oddsBaseline?.expectedHomeGoals,
  );
  const awayMarketScale = marketShotBudgetScale(
    away,
    home,
    context.oddsBaseline?.expectedAwayGoals,
  );
  const samples: SimulatedPossession[] = [];
  const sampledByTeam = new Map<string, number>([[home.teamKey, 0], [away.teamKey, 0]]);
  const possessionResolutions = {
    goals: 0,
    nonGoalShots: 0,
    turnovers: 0,
    actionLimitRetentions: 0,
  };
  const sampleMatchAudit: SampleMatchAudit = {
    homeGoals: 0,
    awayGoals: 0,
    shots: 0,
    goals: 0,
    nonGoalShots: 0,
    turnovers: 0,
    actionLimitRetentions: 0,
    scorelineReconciled: false,
  };
  let dangerousAreaEntries = 0;
  let shotsOnTarget = 0;
  let totalPossessionNumber = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const shotBudgets = new Map<string, { first: number; second: number }>([
      [
        home.teamKey,
        {
          first: samplePoisson(
            expectedShotBudget(home, away, "first") *
              homeMarketScale *
              actionPhaseShotScale(homeActionEvidence, "first"),
          ),
          second: samplePoisson(
            expectedShotBudget(home, away, "second") *
              homeMarketScale *
              actionPhaseShotScale(homeActionEvidence, "second"),
          ),
        },
      ],
      [
        away.teamKey,
        {
          first: samplePoisson(
            expectedShotBudget(away, home, "first") *
              awayMarketScale *
              actionPhaseShotScale(awayActionEvidence, "first"),
          ),
          second: samplePoisson(
            expectedShotBudget(away, home, "second") *
              awayMarketScale *
              actionPhaseShotScale(awayActionEvidence, "second"),
          ),
        },
      ],
    ]);
    let homeGoals = 0;
    let awayGoals = 0;

    for (let index = 0; index < POSSESSIONS_PER_MATCH; index += 1) {
      const half: MatchHalf = index < POSSESSIONS_PER_MATCH / 2 ? "first" : "second";
      const halfHomeShare = possessionShare(home, away, half);
      const attacking = Math.random() * 100 < halfHomeShare ? home : away;
      const defending = attacking.teamKey === home.teamKey ? away : home;
      const minute = 1 + Math.floor((index / POSSESSIONS_PER_MATCH) * 90);
      const attackingGoals = attacking.teamKey === home.teamKey ? homeGoals : awayGoals;
      const defendingGoals = attacking.teamKey === home.teamKey ? awayGoals : homeGoals;
      const gameState = gameStateFor(attackingGoals, defendingGoals, minute);
      const attackingStandingsStrength = standingsStrengths.get(attacking.teamKey) ?? 0;
      const defendingStandingsStrength = standingsStrengths.get(defending.teamKey) ?? 0;
      const attackingTotals = totals.get(attacking.teamKey);
      const defendingTotals = totals.get(defending.teamKey);
      if (!attackingTotals || !defendingTotals) continue;
      attackingTotals.possessions += 1;
      attackingTotals.gameStates[gameState.key].possessions += 1;
      totalPossessionNumber += 1;
      const halfEnd = half === "first" ? POSSESSIONS_PER_MATCH / 2 : POSSESSIONS_PER_MATCH;
      const remainingPossessions = halfEnd - index;
      const expectedRemainingTeamPossessions = remainingPossessions *
        (attacking.teamKey === home.teamKey ? halfHomeShare : 100 - halfHomeShare) / 100;
      const shotBudget = shotBudgets.get(attacking.teamKey)?.[half] ?? 0;
      const shotUrgency = gameState.trailingLate
        ? 1.45
        : gameState.key === "trailing"
          ? 1.12
          : gameState.protectingLeadLate
            ? 0.82
            : 1;
      const plannedShot = Math.random() <
        clamp(
          shotBudget / Math.max(1, expectedRemainingTeamPossessions) * shotUrgency,
          0,
          1,
        );
      let x = 1 + randomInteger(3);
      let y = 1 + randomInteger(GRID_ROWS - 2);
      const sampleThisPossession = iteration === 0 &&
        (sampledByTeam.get(attacking.teamKey) ?? 0) < 2;
      const actionLog: SimulatedAction[] = [];
      let possessionValueAdded = 0;
      let possessionOutcome: SimPossessionOutcome = "retained";
      let goalScorer: Player | null = null;
      let lastCreator: Player | null = null;

      for (let actionIndex = 0; actionIndex < MAX_ACTIONS_PER_POSSESSION; actionIndex += 1) {
        const action = chooseAction(attacking, x, plannedShot, actionIndex, gameState);
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
          const currentShotBudget = shotBudgets.get(attacking.teamKey);
          if (currentShotBudget) {
            currentShotBudget[half] = Math.max(0, currentShotBudget[half] - 1);
          }
          attackingTotals.shots += 1;
          attackingTotals.gameStates[gameState.key].shots += 1;
          if (iteration === 0) sampleMatchAudit.shots += 1;
          if (actorCredit) actorCredit.simulatedShots += 1;
          const shotEstimate = shotExpectedGoals(
            attacking,
            defending,
            actor,
            x,
            y,
            attackingStandingsStrength,
            defendingStandingsStrength,
            attacking.teamKey === home.teamKey
              ? homeActionEvidence
              : awayActionEvidence,
          );
          const shotXg = shotEstimate.value;
          attackingTotals.shotXgSources[shotEstimate.source] += 1;
          attackingTotals.expectedGoals += shotXg;
          const finishingAdjustment = finishingMultiplier(attacking, actor);
          const keeperFactor = goalkeeperConversionFactor(defending);
          attackingTotals.finishingAdjustmentTotal += finishingAdjustment;
          attackingTotals.keeperConversionFactorTotal += keeperFactor;
          attackingTotals.shotQualityEvents += 1;
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
          const goalProbability = clamp(
            shotXg *
              finishingAdjustment *
              keeperFactor,
            0.005,
            0.65,
          );
          if (xgRoll < goalProbability) {
            outcome = "goal";
            shotsOnTarget += 1;
            valueAfter = 1;
            possessionOutcome = "goal";
            attackingTotals.goals += 1;
            attackingTotals.gameStates[gameState.key].goals += 1;
            if (iteration === 0) sampleMatchAudit.goals += 1;
            if (attacking.teamKey === home.teamKey) homeGoals += 1;
            else awayGoals += 1;
            goalScorer = actor;
            if (actorCredit) actorCredit.simulatedGoals += 1;
          } else if (xgRoll < Math.max(accuracy, goalProbability)) {
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
                gameState,
              )
            : carryCompletionProbability(
                attacking,
                defending,
                actor,
                attackingStandingsStrength,
                defendingStandingsStrength,
                gameState,
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

      if (possessionOutcome === "goal") {
        possessionResolutions.goals += 1;
      } else if (possessionOutcome === "shot") {
        possessionResolutions.nonGoalShots += 1;
        if (iteration === 0) sampleMatchAudit.nonGoalShots += 1;
      } else if (possessionOutcome === "turnover") {
        possessionResolutions.turnovers += 1;
        if (iteration === 0) sampleMatchAudit.turnovers += 1;
      } else {
        possessionResolutions.actionLimitRetentions += 1;
        if (iteration === 0) sampleMatchAudit.actionLimitRetentions += 1;
      }

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
    if (iteration === 0) {
      sampleMatchAudit.homeGoals = homeGoals;
      sampleMatchAudit.awayGoals = awayGoals;
      sampleMatchAudit.scorelineReconciled =
        sampleMatchAudit.goals === homeGoals + awayGoals &&
        sampleMatchAudit.shots ===
          sampleMatchAudit.goals + sampleMatchAudit.nonGoalShots &&
        sampleMatchAudit.goals + sampleMatchAudit.nonGoalShots +
          sampleMatchAudit.turnovers + sampleMatchAudit.actionLimitRetentions ===
          POSSESSIONS_PER_MATCH;
    }
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
    possessionResolutions,
  };
  const resolvedPossessionCount = possessionResolutions.goals +
    possessionResolutions.nonGoalShots + possessionResolutions.turnovers +
    possessionResolutions.actionLimitRetentions;
  const outcomeCount = outcomes.home + outcomes.draw + outcomes.away;
  const scorelineEntries = [...scorelines.values()];
  const scorelineCount = scorelineEntries.reduce(
    (sum, scoreline) => sum + scoreline.count,
    0,
  );
  const scorelineGoals = scorelineEntries.reduce(
    (sum, scoreline) =>
      sum + (scoreline.homeGoals + scoreline.awayGoals) * scoreline.count,
    0,
  );
  const reconstructedOutcomes = scorelineEntries.reduce(
    (counts, scoreline) => {
      if (scoreline.homeGoals > scoreline.awayGoals) counts.home += scoreline.count;
      else if (scoreline.homeGoals === scoreline.awayGoals) counts.draw += scoreline.count;
      else counts.away += scoreline.count;
      return counts;
    },
    { home: 0, draw: 0, away: 0 },
  );
  const hasOddsScorelineBaseline = Boolean(
    context.oddsBaseline?.scorelineDistribution.length,
  );
  const requestedFairAiWeight = fairAiForecastWeight(
    home,
    away,
    context.actionEvidence,
  );
  const forecast = blendedScorelines(
    scorelineEntries,
    iterations,
    hasOddsScorelineBaseline ? context.oddsBaseline : undefined,
    requestedFairAiWeight,
  );
  const forecastOutcomes = forecast.scorelines.reduce(
    (counts, scoreline) => {
      if (scoreline.homeGoals > scoreline.awayGoals) counts.home += scoreline.count;
      else if (scoreline.homeGoals === scoreline.awayGoals) counts.draw += scoreline.count;
      else counts.away += scoreline.count;
      return counts;
    },
    { home: 0, draw: 0, away: 0 },
  );
  const forecastProbabilities = forecast.scorelines.reduce(
    (probabilities, scoreline) => {
      if (scoreline.homeGoals > scoreline.awayGoals) probabilities.home += scoreline.probability;
      else if (scoreline.homeGoals === scoreline.awayGoals) probabilities.draw += scoreline.probability;
      else probabilities.away += scoreline.probability;
      return probabilities;
    },
    { home: 0, draw: 0, away: 0 },
  );
  const forecastBttsYesProbability = forecast.scorelines.reduce(
    (sum, scoreline) =>
      sum + (scoreline.homeGoals > 0 && scoreline.awayGoals > 0
        ? scoreline.probability
        : 0),
    0,
  );
  const forecastExpectedHomeGoals = forecast.scorelines.reduce(
    (sum, scoreline) => sum + scoreline.homeGoals * scoreline.probability,
    0,
  );
  const forecastExpectedAwayGoals = forecast.scorelines.reduce(
    (sum, scoreline) => sum + scoreline.awayGoals * scoreline.probability,
    0,
  );
  const bttsYesCount = Math.round(forecastBttsYesProbability * iterations);
  const goalMarkets = {
    bttsYesCount,
    bttsNoCount: iterations - bttsYesCount,
    bttsYesProbability: forecastBttsYesProbability,
    bttsNoProbability: 1 - forecastBttsYesProbability,
    totals: [1.5, 2.5, 3.5].map((line) => {
      const overProbability = forecast.scorelines.reduce(
        (sum, scoreline) =>
          sum + (scoreline.homeGoals + scoreline.awayGoals > line
            ? scoreline.probability
            : 0),
        0,
      );
      const overCount = Math.round(overProbability * iterations);
      return {
        line,
        overCount,
        underCount: iterations - overCount,
        overProbability,
        underProbability: 1 - overProbability,
      };
    }),
  };
  const scorelineDistribution = forecast.scorelines;
  const shotSourceCount = Object.values(homeTotals.shotXgSources)
    .reduce((sum, count) => sum + count, 0) +
    Object.values(awayTotals.shotXgSources)
      .reduce((sum, count) => sum + count, 0);
  const inputAudit = {
    home: inputAuditForTeam(home, homeTotals, homeActionEvidence),
    away: inputAuditForTeam(away, awayTotals, awayActionEvidence),
  };
  const uncertainty = {
    samplingMethod: "95% Wilson score interval; captures Monte Carlo sampling variability only.",
    homeWin: wilsonInterval(outcomes.home, iterations),
    draw: wilsonInterval(outcomes.draw, iterations),
    awayWin: wilsonInterval(outcomes.away, iterations),
    modelStatus: "not-quantified" as const,
    modelNotes: [
      "Model error and predictive calibration have not been quantified against chronological held-out matches.",
      "A larger iteration count narrows simulation sampling intervals but does not reduce error from missing inputs or model assumptions.",
      "When an odds baseline is supplied, final scoreline probabilities blend the normalized market distribution and the FAIR AI event simulation at the reported weights; these intervals describe the raw FAIR AI run only.",
    ],
  };
  if (
    resolvedPossessionCount !== diagnostics.possessions ||
    outcomeCount !== iterations ||
    scorelineCount !== iterations ||
    diagnostics.shots !== possessionResolutions.goals + possessionResolutions.nonGoalShots ||
    diagnostics.turnovers !== possessionResolutions.turnovers ||
    diagnostics.goals !== possessionResolutions.goals ||
    diagnostics.goals !== scorelineGoals ||
    reconstructedOutcomes.home !== outcomes.home ||
    reconstructedOutcomes.draw !== outcomes.draw ||
    reconstructedOutcomes.away !== outcomes.away ||
    shotSourceCount !== diagnostics.shots ||
    goalMarkets.bttsYesCount + goalMarkets.bttsNoCount !== iterations ||
    goalMarkets.totals.some((market) => market.overCount + market.underCount !== iterations) ||
    !sampleMatchAudit.scorelineReconciled ||
    diagnostics.shotsOnTarget > diagnostics.shots ||
    diagnostics.goals > diagnostics.shotsOnTarget ||
    diagnostics.dangerousAreaEntries > diagnostics.actions
  ) {
    throw new Error("Simulation counters failed consistency checks.");
  }
  const averageHomeGoals = forecastExpectedHomeGoals;
  const averageAwayGoals = forecastExpectedAwayGoals;
  const averageHomeXg = homeTotals.expectedGoals / iterations;
  const averageAwayXg = awayTotals.expectedGoals / iterations;
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
    expectedHomeXg: averageHomeXg,
    expectedAwayXg: averageAwayXg,
    outcomes: forecastOutcomes,
    probabilities: {
      home: forecastProbabilities.home,
      draw: forecastProbabilities.draw,
      away: forecastProbabilities.away,
    },
    diagnostics,
    goalMarkets,
    scorelineDistribution,
    inputAudit,
    uncertainty,
    sampleMatchAudit,
    standingsContext: {
      adjustmentsApplied,
      home: homeStandings,
      away: awayStandings,
    },
    ...(context.oddsBaseline ? { oddsBaseline: context.oddsBaseline } : {}),
    forecastBlend: {
      oddsWeight: forecast.oddsWeight,
      fairAiWeight: forecast.fairAiWeight,
      method: forecast.oddsWeight > 0
        ? "Final scoreline probabilities are a normalized weighted blend of the odds-implied distribution and the FAIR AI event simulation. The FAIR AI share increases with recent match, player, team-stat, and 365Scores shot coverage."
        : "No valid odds scoreline distribution was supplied; the forecast uses the FAIR AI event simulation only.",
    },
    actionEvidence: context.actionEvidence,
    matchupAnalysis: {
      home: matchupTeamAnalysis(
        home,
        away,
        homeTotals,
        iterations,
        standingsStrengths.get(away.teamKey) ?? 0,
      ),
      away: matchupTeamAnalysis(
        away,
        home,
        awayTotals,
        iterations,
        standingsStrengths.get(home.teamKey) ?? 0,
      ),
      evidenceNote: "Tactical effects are bounded proxies from archived formations, passing, long-ball and defensive-action rates. Score-state responses are generated by a simple synthetic policy, not learned from observed substitutions or player tracking. Archived starters are not confirmed future lineups; finishing and keeper adjustments are noisy source estimates, not validated skill ratings.",
    },
    topScorelines: scorelineDistribution
      .slice(0, 6)
      .map((scoreline) => ({ ...scoreline })),
    playerContributions: contributions,
    possessionModel: {
      gridColumns: GRID_COLUMNS,
      gridRows: GRID_ROWS,
      coordinateBasis: "Model-generated attack-direction grid; x=0 is a team's own end and x=100 is the opponent's end. No source tracking coordinates are available.",
      home: possessionSummary(home, homeShare, homeTotals, iterations),
      away: possessionSummary(away, awayShare, awayTotals, iterations),
      sampledPossessions: samples,
    },
    method: `Possession-by-possession Monte Carlo over ${iterations.toLocaleString()} simulated matches. When full-time odds are available, their complete scoreline distribution is the initial forecast baseline and their expected goals calibrate simulated shot volume against the teams' recent archive rates. The final scoreline probabilities blend that normalized market distribution with the FAIR AI event simulation; the reported weights rise with the coverage of recent matches, player profiles, team statistics, and 365Scores shot reports. Fresh 365Scores commentary and shot records can adjust phase shot volume, shot xG, and shot-placement conversion within bounded limits. Possession paths and diagnostics remain the raw event simulation. Remaining xG proxies prefer player xG/shot, then 365Scores shot xG, then team xG/shot, recent scores, and finally a neutral 0.105-per-shot prior. Finishing and keeper factors adjust goal conversion separately from xG. Pass completion changes through a bounded buildup-versus-pressing proxy, and action risk responds to simulated score state. When both teams have fresh standings snapshots, normalized rank, points-per-game, goal difference and form add small bounded execution and shot-quality adjustments.`,
    limitations: [
      "Player roles and action profiles are aggregated from recent archived lineups and match statistics; the latest observed starting XI is not a confirmed future lineup.",
      "Tactical compatibility is represented by bounded proxies from archived passing, long-ball, defensive-action, and formation data. The archive does not establish pressing triggers, defensive-line height, width/space exploitation, or event-level tactical changes.",
      "Leading, level, and trailing shot rates come from this simulation's own score-aware rules. They are not evidence of observed psychological behavior, substitutions, or proven in-match adaptability.",
      "Finishing and goalkeeper effects are shrunk proxies from small archived samples when available. Goals relative to xG are noisy; shot placement and pressure-specific finishing data are unavailable.",
      "Recent score records can inform a clearly labeled shot-xG proxy when detailed statistics are absent; this is not observed or validated xG and does not replace missing match-stat samples.",
      "365Scores evidence covers at most the two latest completed reports per selected team in each run. It is source-reported commentary and shot data, not continuous ball/player tracking; reports that cannot be matched are excluded and counted as unavailable.",
      "Odds-derived expected goals calibrate shot volume before the possession simulation; this is not a trained market-to-model posterior, and market quote timestamps are not verified.",
      "When odds are supplied, the final result probabilities blend market and FAIR AI scoreline distributions. Outcome and scoreline counts are run-equivalent counts for that blend; possession diagnostics and uncertainty intervals describe the raw FAIR AI simulation.",
      "The confidence intervals report Monte Carlo sampling variability only. Predictive model error is not quantified, and chronological held-out validation has not been completed.",
      "The 12 × 8 pitch path, action locations, and estimated value-added deltas are generated from tactical roles and aggregate rates. They are model proxies, not observed coordinates, measured spatial xT/EVA, or a trained reinforcement-learning policy.",
      "Player age, height, preferred foot, contract, market value, full season histories, club average age/squad value/founding year, and manager biography are not part of these archived fixture records and are not inferred.",
      "Standings adjustments use snapshots observed no more than 30 days before the simulation and reject future-dated or invalid timestamps. The observation time is when the source snapshot was fetched, not a guaranteed effective date; standings are not used in historical training, and comparisons across different leagues are approximate.",
      "Results are experimental and are not betting advice.",
    ],
  };
}
