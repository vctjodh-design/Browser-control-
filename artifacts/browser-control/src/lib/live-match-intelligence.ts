import type {
  FootballLastFiveEvent,
  FootballLiveAction,
  FootballMatchCenter,
  FootballMatchReplayShotEvent,
} from '@workspace/api-client-react';

export const LIVE_SIMULATION_RUNS = 10_000;

type TeamSide = 'home' | 'away';
type SourceStat = { label: string; value: string | number | null };

export interface LiveTeamSignals {
  side: TeamSide;
  name: string;
  score: number;
  xg: number | null;
  xgot: number | null;
  shots: number;
  shotsOnTarget: number | null;
  coordinateShots: number;
  centralShots: number;
  centralShotShare: number | null;
  averageRating: number | null;
  ratedPlayers: number;
  redCards: number;
  injurySignals: number;
  substitutions: number;
  kineticIntensity: number | null;
  attackingRatePerMinute: number;
  scoringRateBasis: 'observed-xg' | 'shot-volume-proxy' | 'neutral-prior';
  resistanceDecay: number | null;
  projectedGoalsRemaining: number | null;
  shotEvents: FootballMatchReplayShotEvent[];
}

export interface LiveScenario {
  homeScore: number;
  awayScore: number;
  runs: number;
  share: number;
}

export interface LiveMatchDynamics {
  state: 'home-pressure' | 'away-pressure' | 'balanced' | 'high-entropy';
  homePressure: number;
  awayPressure: number;
  imbalanceIndex: number;
  outcomeEntropy: number;
  reading: string;
}

export interface LiveMatchIntelligence {
  status: 'waiting' | 'not-live' | 'insufficient-data' | 'ready';
  message: string | null;
  home: LiveTeamSignals | null;
  away: LiveTeamSignals | null;
  elapsedMinute: number | null;
  remainingMinutes: number | null;
  observedAt: string | null;
  observedAgeSeconds: number | null;
  simulation: {
    runs: number;
    homeWinShare: number;
    drawShare: number;
    awayWinShare: number;
    scorelineEntropy: number;
    topScorelines: LiveScenario[];
  } | null;
  matchDynamics: LiveMatchDynamics | null;
  confidence: {
    level: 'low' | 'medium';
    label: string;
    reasons: string[];
  } | null;
  timeline: Array<{
    minute: string;
    title: string;
    detail: string;
    kind: string;
  }>;
  signalCoverage: {
    xg: boolean;
    xgot: boolean;
    shotCoordinates: boolean;
    playerRatings: boolean;
    commentary: boolean;
  };
}

interface LiveMatchIntelligenceInput {
  matchCenter?: FootballMatchCenter | null;
  liveAction?: FootballLiveAction | null;
  now?: Date;
}

interface TeamEventSignals {
  redCards: number;
  injurySignals: number;
  substitutions: number;
}

function normalizedName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function namesMatch(left: string, right: string) {
  const a = normalizedName(left);
  const b = normalizedName(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const match = value.trim().replace(',', '.').match(/^-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function statNumber(rows: SourceStat[], expression: RegExp): number | null {
  const row = rows.find((candidate) => expression.test(candidate.label));
  return row ? parseNumber(row.value) : null;
}

function matchCenterStatsForSide(
  matchCenter: FootballMatchCenter | null | undefined,
  side: TeamSide,
  sourceName: string,
): SourceStat[] {
  if (!matchCenter) return [];
  const fixtureTeam = side === 'home' ? matchCenter.match.home : matchCenter.match.away;
  const group = matchCenter.statistics.find((candidate) =>
    fixtureTeam.id !== null && candidate.teamId === fixtureTeam.id
      ? true
      : namesMatch(candidate.teamName, sourceName),
  );
  return group?.statistics ?? [];
}

function playerRatingsForSide(
  matchCenter: FootballMatchCenter | null | undefined,
  side: TeamSide,
  sourceName: string,
): number[] {
  if (!matchCenter) return [];
  const fixtureTeam = side === 'home' ? matchCenter.match.home : matchCenter.match.away;
  const group = matchCenter.players.find((candidate) =>
    fixtureTeam.id !== null && candidate.teamId === fixtureTeam.id
      ? true
      : namesMatch(candidate.teamName, sourceName),
  );
  return (group?.players ?? []).flatMap((player) => {
    const rating = parseNumber(player.rating);
    return rating !== null && rating >= 0 && rating <= 10 ? [rating] : [];
  });
}

function matchEventSide(
  event: FootballLastFiveEvent,
  matchCenter: FootballMatchCenter | null | undefined,
): TeamSide | null {
  if (!matchCenter) return null;
  if (event.teamId !== null) {
    if (event.teamId === matchCenter.match.home.id) return 'home';
    if (event.teamId === matchCenter.match.away.id) return 'away';
  }
  const name = event.teamName ?? '';
  if (name && namesMatch(name, matchCenter.match.home.name)) return 'home';
  if (name && namesMatch(name, matchCenter.match.away.name)) return 'away';
  return null;
}

function eventSignals(
  matchCenter: FootballMatchCenter | null | undefined,
  elapsedMinute: number,
): Record<TeamSide, TeamEventSignals> {
  const totals: Record<TeamSide, TeamEventSignals> = {
    home: { redCards: 0, injurySignals: 0, substitutions: 0 },
    away: { redCards: 0, injurySignals: 0, substitutions: 0 },
  };
  for (const event of matchCenter?.events ?? []) {
    if (event.minute !== null && event.minute > elapsedMinute) continue;
    const side = matchEventSide(event, matchCenter);
    if (!side) continue;
    const text = [event.type, event.detail, event.comments].filter(Boolean).join(' ');
    if (/\b(red card|sent off|sending off|second yellow)\b/i.test(text)) {
      totals[side].redCards += 1;
    }
    if (/\binjur(?:y|ies|ed)\b/i.test(text)) {
      totals[side].injurySignals += 1;
    }
    if (/\b(substitution|substitute|subbed on|subbed off)\b/i.test(text)) {
      totals[side].substitutions += 1;
    }
  }
  return totals;
}

function parseMinute(value: string): number | null {
  const match = value.match(/^\s*(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  if (!match) return null;
  const minute = Number(match[1]) + Number(match[2] ?? 0);
  return Number.isFinite(minute) ? minute : null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function liveStatus(status: string) {
  return /\b(live|in play|in progress|first half|second half|1st half|2nd half|1h|2h|half[ -]?time|halftime|extra time|extra-time)\b/i.test(status);
}

function unavailable(
  status: LiveMatchIntelligence['status'],
  message: string,
): LiveMatchIntelligence {
  return {
    status,
    message,
    home: null,
    away: null,
    elapsedMinute: null,
    remainingMinutes: null,
    observedAt: null,
    observedAgeSeconds: null,
    simulation: null,
    matchDynamics: null,
    confidence: null,
    timeline: [],
    signalCoverage: {
      xg: false,
      xgot: false,
      shotCoordinates: false,
      playerRatings: false,
      commentary: false,
    },
  };
}

function buildTeamSignals(
  side: TeamSide,
  name: string,
  score: number,
  liveAction: FootballLiveAction,
  matchCenter: FootballMatchCenter | null | undefined,
  eventTotals: Record<TeamSide, TeamEventSignals>,
  elapsedMinute: number,
): LiveTeamSignals {
  const shotEvents = liveAction.shotEvents.filter((shot) => shot.teamSide === side);
  const sourceStats = matchCenterStatsForSide(matchCenter, side, name);
  const xgValues = shotEvents.flatMap((shot) => {
    const value = parseNumber(shot.xg);
    return value !== null && value >= 0 ? [value] : [];
  });
  const xgotValues = shotEvents.flatMap((shot) => {
    const value = parseNumber(shot.xgot);
    return value !== null && value >= 0 ? [value] : [];
  });
  const statsXg = statNumber(sourceStats, /^(?:expected goals|xg)$/i);
  const statsXgot = statNumber(sourceStats, /^(?:expected goals on target|xgot)$/i);
  const eventXg = xgValues.length
    ? xgValues.reduce((sum, value) => sum + value, 0) / xgValues.length * shotEvents.length
    : null;
  const eventXgot = xgotValues.length
    ? xgotValues.reduce((sum, value) => sum + value, 0) / xgotValues.length * shotEvents.length
    : null;
  const xg = eventXg === null
    ? statsXg
    : statsXg === null
      ? eventXg
      : Math.max(eventXg, statsXg);
  const xgot = eventXgot === null
    ? statsXgot
    : statsXgot === null
      ? eventXgot
      : Math.max(eventXgot, statsXgot);
  const statShots = statNumber(sourceStats, /^(?:total shots|shots total|shots)$/i);
  const statShotsOnTarget = statNumber(sourceStats, /(?:shots on target|shots on goal|on target)/i);
  const shots = Math.max(shotEvents.length, statShots ?? 0);
  const shotsOnTarget = statShotsOnTarget === null
    ? null
    : Math.max(0, statShotsOnTarget);
  const coordinateShots = shotEvents.filter((shot) => shot.x !== null && shot.y !== null);
  const centralShots = coordinateShots.filter((shot) =>
    shot.x !== null && shot.y !== null &&
    shot.x >= 35 && shot.x <= 65 &&
    shot.y >= 35 && shot.y <= 65,
  );
  const ratings = playerRatingsForSide(matchCenter, side, name);
  const ratingAverage = mean(ratings);
  const recentWindow = Math.min(15, Math.max(1, elapsedMinute));
  const recentShots = shotEvents.filter((shot) => {
    const minute = parseMinute(shot.minute);
    return minute !== null && minute <= elapsedMinute && elapsedMinute - minute <= recentWindow;
  });
  const recentXgValues = recentShots.flatMap((shot) => {
    const value = parseNumber(shot.xg);
    return value !== null && value >= 0 ? [value] : [];
  });
  const recentXgotValues = recentShots.flatMap((shot) => {
    const value = parseNumber(shot.xgot);
    return value !== null && value >= 0 ? [value] : [];
  });
  const shotProxyRate =
    ((shotsOnTarget ?? 0) * 0.2 + Math.max(0, shots - (shotsOnTarget ?? 0)) * 0.05) /
    Math.max(1, elapsedMinute);
  const scoringRateBasis = xg !== null && xg > 0
    ? 'observed-xg'
    : shots > 0
      ? 'shot-volume-proxy'
      : 'neutral-prior';
  const currentRate = scoringRateBasis === 'observed-xg'
    ? xg! / Math.max(1, elapsedMinute)
    : scoringRateBasis === 'shot-volume-proxy'
      ? shotProxyRate
      : 0.012;
  const recentRate = scoringRateBasis === 'observed-xg' && recentXgValues.length
    ? (
      recentXgValues.reduce((sum, value) => sum + value, 0) /
      recentXgValues.length *
      recentShots.length
    ) / recentWindow
    : currentRate;
  const recentXgotRate = recentXgotValues.length
    ? (
      recentXgotValues.reduce((sum, value) => sum + value, 0) /
      recentXgotValues.length *
      recentShots.length
    ) / recentWindow
    : xgot !== null
      ? xgot / Math.max(1, elapsedMinute)
      : null;
  const recentShotCount = recentShots.length
    ? recentShots.length
    : shots * recentWindow / Math.max(1, elapsedMinute);
  const xgIntensity = clamp((recentRate * 15 / 0.6) * 100, 0, 100);
  const xgotIntensity = recentXgotRate === null
    ? null
    : clamp((recentXgotRate * 15 / 0.6) * 100, 0, 100);
  const shotIntensity = clamp((recentShotCount / recentWindow * 15 / 5) * 100, 0, 100);
  const zoneIntensity = coordinateShots.length
    ? (centralShots.length / coordinateShots.length) * 100
    : null;
  const ratingIntensity = ratingAverage === null
    ? null
    : clamp(((ratingAverage - 5) / 3) * 100, 0, 100);
  const weightedInputs: Array<{ value: number; weight: number }> = [];
  if (xg !== null) weightedInputs.push({ value: xgIntensity, weight: 0.35 });
  if (xgotIntensity !== null) weightedInputs.push({ value: xgotIntensity, weight: 0.15 });
  if (shots > 0) weightedInputs.push({ value: shotIntensity, weight: 0.2 });
  if (zoneIntensity !== null) weightedInputs.push({ value: zoneIntensity, weight: 0.1 });
  if (ratingIntensity !== null) weightedInputs.push({ value: ratingIntensity, weight: 0.2 });
  const totalWeight = weightedInputs.reduce((sum, entry) => sum + entry.weight, 0);
  const kineticIntensity = (xg !== null || shots > 0) && totalWeight
    ? clamp(weightedInputs.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight, 0, 100)
    : null;
  const events = eventTotals[side];
  const expectedGoalsRate = currentRate;

  return {
    side,
    name,
    score,
    xg,
    xgot,
    shots,
    shotsOnTarget,
    coordinateShots: coordinateShots.length,
    centralShots: centralShots.length,
    centralShotShare: coordinateShots.length
      ? centralShots.length / coordinateShots.length
      : null,
    averageRating: ratingAverage,
    ratedPlayers: ratings.length,
    redCards: events.redCards,
    injurySignals: events.injurySignals,
    substitutions: events.substitutions,
    kineticIntensity,
    attackingRatePerMinute: recentRate,
    scoringRateBasis,
    resistanceDecay: null,
    projectedGoalsRemaining: expectedGoalsRate * 0,
    shotEvents,
  };
}

function randomGenerator(seedText: string) {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function poissonSample(lambda: number, random: () => number) {
  const boundedLambda = clamp(lambda, 0, 10);
  if (boundedLambda === 0) return 0;
  const threshold = Math.exp(-boundedLambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= Math.max(Number.MIN_VALUE, random());
  } while (product > threshold && count < 100);
  return count - 1;
}

function share(value: number, runs: number) {
  return Math.round((value / runs) * 1000) / 10;
}

function simulateFinalScores(
  liveAction: FootballLiveAction,
  home: LiveTeamSignals,
  away: LiveTeamSignals,
  remainingMinutes: number,
  elapsedMinute: number,
): NonNullable<LiveMatchIntelligence['simulation']> {
  const homeRate = home.attackingRatePerMinute;
  const awayRate = away.attackingRatePerMinute;
  const homeAttack = 0.85 + (home.kineticIntensity ?? 50) / 333;
  const awayAttack = 0.85 + (away.kineticIntensity ?? 50) / 333;
  const homeAgainstStress = 0.85 + (away.resistanceDecay ?? 50) / 333;
  const awayAgainstStress = 0.85 + (home.resistanceDecay ?? 50) / 333;
  const expectedHome = clamp(homeRate * remainingMinutes * homeAttack * homeAgainstStress, 0, 10);
  const expectedAway = clamp(awayRate * remainingMinutes * awayAttack * awayAgainstStress, 0, 10);
  home.projectedGoalsRemaining = expectedHome;
  away.projectedGoalsRemaining = expectedAway;
  const random = randomGenerator([
    liveAction.gameId,
    liveAction.elapsedMinute,
    liveAction.homeScore,
    liveAction.awayScore,
    home.shots,
    away.shots,
    home.xg,
    away.xg,
  ].join(':'));
  const scores = new Map<string, { homeScore: number; awayScore: number; runs: number }>();
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  for (let run = 0; run < LIVE_SIMULATION_RUNS; run += 1) {
    const finalHome = liveAction.homeScore! + poissonSample(expectedHome, random);
    const finalAway = liveAction.awayScore! + poissonSample(expectedAway, random);
    if (finalHome > finalAway) homeWins += 1;
    else if (finalHome < finalAway) awayWins += 1;
    else draws += 1;
    const key = `${finalHome}-${finalAway}`;
    const existing = scores.get(key);
    if (existing) existing.runs += 1;
    else scores.set(key, { homeScore: finalHome, awayScore: finalAway, runs: 1 });
  }

  const topScorelines = [...scores.values()]
    .sort((left, right) =>
      right.runs - left.runs ||
      left.homeScore + left.awayScore - right.homeScore - right.awayScore ||
      left.homeScore - right.homeScore,
    )
    .slice(0, 3)
    .map((scoreline) => ({ ...scoreline, share: share(scoreline.runs, LIVE_SIMULATION_RUNS) }));
  const scorelineEntropy = scores.size <= 1
    ? 0
    : Math.round(
      (
        [...scores.values()].reduce((entropy, scoreline) => {
          const probability = scoreline.runs / LIVE_SIMULATION_RUNS;
          return entropy - probability * Math.log(probability);
        }, 0) / Math.log(scores.size)
      ) * 1000,
    ) / 10;
  return {
    runs: LIVE_SIMULATION_RUNS,
    homeWinShare: share(homeWins, LIVE_SIMULATION_RUNS),
    drawShare: share(draws, LIVE_SIMULATION_RUNS),
    awayWinShare: share(awayWins, LIVE_SIMULATION_RUNS),
    scorelineEntropy,
    topScorelines,
  };
}

export function analyzeLiveMatch({
  matchCenter,
  liveAction,
  now = new Date(),
}: LiveMatchIntelligenceInput): LiveMatchIntelligence {
  if (!liveAction) {
    return unavailable('waiting', 'Waiting for the validated 365Scores live match feed.');
  }
  if (!matchCenter) {
    return unavailable('waiting', 'Waiting for the fixture team identity before analyzing the live source.');
  }
  if (
    !namesMatch(liveAction.homeTeam, matchCenter.match.home.name) ||
    !namesMatch(liveAction.awayTeam, matchCenter.match.away.name)
  ) {
    return unavailable(
      'insufficient-data',
      'The 365Scores source teams do not match this fixture. No scenario was generated.',
    );
  }
  if (liveAction.homeScore === null || liveAction.awayScore === null) {
    return unavailable('insufficient-data', 'The live source has not returned both current scores yet.');
  }
  const elapsedMinute = liveAction.elapsedMinute ?? matchCenter?.elapsedMinute;
  if (elapsedMinute === null || elapsedMinute === undefined) {
    return unavailable('insufficient-data', 'The live source has not returned the current match minute yet.');
  }
  if (!liveStatus(liveAction.status)) {
    return unavailable('not-live', 'This fixture is no longer in a live match state.');
  }

  const totalMinutes = /\b(extra time|extra-time)\b/i.test(liveAction.status) ? 120 : 90;
  const remainingMinutes = Math.max(0, totalMinutes - elapsedMinute);
  const eventTotals = eventSignals(matchCenter, elapsedMinute);
  const home = buildTeamSignals(
    'home',
    liveAction.homeTeam,
    liveAction.homeScore,
    liveAction,
    matchCenter,
    eventTotals,
    elapsedMinute,
  );
  const away = buildTeamSignals(
    'away',
    liveAction.awayTeam,
    liveAction.awayScore,
    liveAction,
    matchCenter,
    eventTotals,
    elapsedMinute,
  );
  home.resistanceDecay = away.kineticIntensity === null
    ? null
    : clamp(
      away.kineticIntensity * 0.65 +
      home.redCards * 35 +
      home.injurySignals * 14,
      0,
      100,
    );
  away.resistanceDecay = home.kineticIntensity === null
    ? null
    : clamp(
      home.kineticIntensity * 0.65 +
      away.redCards * 35 +
      away.injurySignals * 14,
      0,
      100,
    );
  const hasUsableLiveSignals =
    home.shots > 0 || away.shots > 0 ||
    home.xg !== null || away.xg !== null;
  const observedAt = liveAction.observedAt;
  const age = observedAt ? Math.max(0, Math.floor((now.getTime() - new Date(observedAt).getTime()) / 1000)) : null;
  const timeline = [...liveAction.events]
    .sort((left, right) => {
      const leftMinute = parseMinute(left.minute) ?? -1;
      const rightMinute = parseMinute(right.minute) ?? -1;
      return rightMinute - leftMinute || right.sourceOrder - left.sourceOrder;
    })
    .slice(0, 12)
    .map((event) => ({
      minute: event.minute,
      title: event.title || event.kind || 'Match event',
      detail: event.detail || '',
      kind: event.kind || 'event',
    }));
  const signalCoverage = {
    xg: home.xg !== null && away.xg !== null,
    xgot: home.xgot !== null && away.xgot !== null,
    shotCoordinates: home.coordinateShots + away.coordinateShots > 0,
    playerRatings: home.ratedPlayers + away.ratedPlayers > 0,
    commentary: liveAction.events.length > 0,
  };
  if (!hasUsableLiveSignals) {
    return {
      ...unavailable('insufficient-data', 'Waiting for live shot or xG data before running score scenarios.'),
      home,
      away,
      elapsedMinute,
      remainingMinutes,
      observedAt,
      observedAgeSeconds: age,
      timeline,
      signalCoverage,
    };
  }

  const simulation = simulateFinalScores(liveAction, home, away, remainingMinutes, elapsedMinute);
  const reasons: string[] = [];
  const totalShots = home.shots + away.shots;
  if (!signalCoverage.xg) reasons.push('At least one side lacks source xG; a shot-count proxy or neutral scoring prior is used.');
  if (!signalCoverage.shotCoordinates) reasons.push('Shot locations are unavailable in this snapshot.');
  if (!signalCoverage.playerRatings) reasons.push('No source-reported player ratings were returned.');
  if (!signalCoverage.commentary) reasons.push('No live commentary events were returned.');
  if (age !== null && age > 90) reasons.push('The latest live snapshot is over 90 seconds old.');
  if (totalShots < 6) reasons.push('The match sample is still small.');
  if (!reasons.length) reasons.push('Inputs are broad, but the scenario model is not calibrated against historical outcomes.');
  const coverageScore = [
    signalCoverage.xg,
    signalCoverage.xgot,
    signalCoverage.shotCoordinates,
    signalCoverage.playerRatings,
    signalCoverage.commentary,
  ].filter(Boolean).length;
  const confidenceLevel = totalShots >= 12 && coverageScore >= 4 && (age === null || age <= 90)
    ? 'medium'
    : 'low';
  const homePressure = (home.kineticIntensity ?? 50) - (away.resistanceDecay ?? 50);
  const awayPressure = (away.kineticIntensity ?? 50) - (home.resistanceDecay ?? 50);
  const signedImbalance = homePressure - awayPressure;
  const bothSidesHighlyPressured =
    (home.kineticIntensity ?? 0) >= 60 &&
    (away.kineticIntensity ?? 0) >= 60 &&
    (home.resistanceDecay ?? 0) >= 45 &&
    (away.resistanceDecay ?? 0) >= 45;
  const dynamicsState: LiveMatchDynamics['state'] =
    simulation.scorelineEntropy >= 68 || bothSidesHighlyPressured
      ? 'high-entropy'
      : signedImbalance >= 20
        ? 'home-pressure'
        : signedImbalance <= -20
          ? 'away-pressure'
          : 'balanced';
  const matchDynamics: LiveMatchDynamics = {
    state: dynamicsState,
    homePressure,
    awayPressure,
    imbalanceIndex: clamp(Math.abs(signedImbalance), 0, 100),
    outcomeEntropy: simulation.scorelineEntropy,
    reading: dynamicsState === 'high-entropy'
      ? bothSidesHighlyPressured
        ? 'Both teams show elevated attack and defensive-stress signals.'
        : 'The simulated scoreline distribution is broad and uncertain.'
      : dynamicsState === 'home-pressure'
        ? `${home.name} has the stronger attack-versus-resistance signal.`
        : dynamicsState === 'away-pressure'
          ? `${away.name} has the stronger attack-versus-resistance signal.`
          : 'The current attack-versus-resistance signals are close.',
  };

  return {
    status: 'ready',
    message: null,
    home,
    away,
    elapsedMinute,
    remainingMinutes,
    observedAt,
    observedAgeSeconds: age,
    simulation,
    matchDynamics,
    confidence: {
      level: confidenceLevel,
      label: confidenceLevel === 'medium' ? 'Moderate input coverage' : 'Limited input coverage',
      reasons,
    },
    timeline,
    signalCoverage,
  };
}
