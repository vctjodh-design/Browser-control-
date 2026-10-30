import {
  LIVE_LEARNING_FEATURE_COUNT,
  type LiveLearningWeights,
} from './live-match-intelligence.ts';

const STORAGE_KEY = 'browser-control.live-intelligence-learning.v1';
const MAX_FIXTURES = 60;
const MAX_OBSERVATIONS_PER_FIXTURE = 48;
const MAX_TRAINED_FIXTURE_IDS = 200;
const LEARNING_RATE = 0.04;
const MAX_WEIGHT = 0.35;

export const LIVE_LEARNING_UPDATED_EVENT = 'live-intelligence-learning-updated';

export interface LiveLearningObservation {
  fixtureId: number;
  signature: string;
  observedAt: string;
  minute: number;
  homeScore: number;
  awayScore: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  homeFeatures: number[];
  awayFeatures: number[];
}

interface PendingFixture {
  fixtureId: number;
  updatedAt: string;
  observations: LiveLearningObservation[];
}

export interface LiveLearningState {
  version: 1;
  completedMatches: number;
  trainedFixtureIds: number[];
  weights: LiveLearningWeights;
  fixtures: PendingFixture[];
}

function zeroWeights() {
  return Array.from({ length: LIVE_LEARNING_FEATURE_COUNT }, () => 0);
}

export function emptyLiveLearningState(): LiveLearningState {
  return {
    version: 1,
    completedMatches: 0,
    trainedFixtureIds: [],
    weights: { home: zeroWeights(), away: zeroWeights() },
    fixtures: [],
  };
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeWeights(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: LIVE_LEARNING_FEATURE_COUNT }, (_, index) =>
    Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, finiteNumber(source[index]))),
  );
}

function normalizeFeatures(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: LIVE_LEARNING_FEATURE_COUNT }, (_, index) =>
    Math.max(-1, Math.min(1, finiteNumber(source[index]))),
  );
}

function isObservation(value: unknown): value is LiveLearningObservation {
  if (!value || typeof value !== 'object') return false;
  const observation = value as Partial<LiveLearningObservation>;
  return Number.isSafeInteger(observation.fixtureId) &&
    typeof observation.signature === 'string' &&
    typeof observation.observedAt === 'string' &&
    typeof observation.minute === 'number' &&
    typeof observation.homeScore === 'number' &&
    typeof observation.awayScore === 'number' &&
    typeof observation.homeExpectedGoals === 'number' &&
    typeof observation.awayExpectedGoals === 'number' &&
    Array.isArray(observation.homeFeatures) &&
    Array.isArray(observation.awayFeatures);
}

function normalizeState(value: unknown): LiveLearningState {
  if (!value || typeof value !== 'object') return emptyLiveLearningState();
  const candidate = value as Partial<LiveLearningState>;
  if (candidate.version !== 1) return emptyLiveLearningState();
  const weights = candidate.weights as Partial<LiveLearningWeights> | undefined;
  const fixtures = Array.isArray(candidate.fixtures)
    ? candidate.fixtures.flatMap((fixture) => {
      if (!fixture || !Number.isSafeInteger(fixture.fixtureId) || !Array.isArray(fixture.observations)) return [];
      const observations = fixture.observations
        .filter(isObservation)
        .map((observation) => ({
          ...observation,
          homeFeatures: normalizeFeatures(observation.homeFeatures),
          awayFeatures: normalizeFeatures(observation.awayFeatures),
        }))
        .slice(-MAX_OBSERVATIONS_PER_FIXTURE);
      return observations.length
        ? [{ fixtureId: fixture.fixtureId, updatedAt: String(fixture.updatedAt ?? ''), observations }]
        : [];
    }).slice(-MAX_FIXTURES)
    : [];
  return {
    version: 1,
    completedMatches: Math.max(0, Math.floor(finiteNumber(candidate.completedMatches))),
    trainedFixtureIds: Array.isArray(candidate.trainedFixtureIds)
      ? candidate.trainedFixtureIds.filter(Number.isSafeInteger).slice(-MAX_TRAINED_FIXTURE_IDS)
      : [],
    weights: {
      home: normalizeWeights(weights?.home),
      away: normalizeWeights(weights?.away),
    },
    fixtures,
  };
}

export function loadLiveLearningState(): LiveLearningState {
  const storage = browserStorage();
  if (!storage) return emptyLiveLearningState();
  try {
    const saved = storage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : emptyLiveLearningState();
  } catch {
    return emptyLiveLearningState();
  }
}

export function saveLiveLearningState(state: LiveLearningState): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
  } catch {
    // Learning is optional; forecasting remains available when storage is disabled or full.
  }
}

export function hasPendingLiveLearningFixture(fixtureId: number): boolean {
  return loadLiveLearningState().fixtures.some((fixture) => fixture.fixtureId === fixtureId);
}

export function recordLiveLearningObservation(
  state: LiveLearningState,
  observation: LiveLearningObservation,
): LiveLearningState {
  if (state.trainedFixtureIds.includes(observation.fixtureId)) return state;
  const fixtures = state.fixtures.map((fixture) => ({
    ...fixture,
    observations: [...fixture.observations],
  }));
  const fixtureIndex = fixtures.findIndex((fixture) => fixture.fixtureId === observation.fixtureId);
  const now = observation.observedAt || new Date().toISOString();
  if (fixtureIndex < 0) {
    fixtures.push({
      fixtureId: observation.fixtureId,
      updatedAt: now,
      observations: [observation],
    });
  } else {
    const fixture = fixtures[fixtureIndex];
    const existingIndex = fixture.observations.findIndex((item) => item.signature === observation.signature);
    if (existingIndex >= 0) {
      if (JSON.stringify(fixture.observations[existingIndex]) === JSON.stringify(observation)) {
        return state;
      }
      fixture.observations[existingIndex] = observation;
    } else {
      fixture.observations.push(observation);
    }
    fixture.observations = fixture.observations.slice(-MAX_OBSERVATIONS_PER_FIXTURE);
    fixture.updatedAt = now;
  }
  return {
    ...state,
    fixtures: fixtures
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(-MAX_FIXTURES),
  };
}

function dot(weights: number[], features: number[]) {
  return features.reduce((sum, feature, index) => sum + feature * (weights[index] ?? 0), 0);
}

function learnFromObservation(
  weights: number[],
  baseExpectedGoals: number,
  actualGoals: number,
  features: number[],
  sampleWeight: number,
) {
  const correction = Math.max(-0.5, Math.min(0.5, dot(weights, features)));
  const forecastGoals = Math.max(0.01, baseExpectedGoals * Math.exp(correction));
  const residual = Math.max(-4, Math.min(4, actualGoals - forecastGoals));
  return weights.map((weight, index) =>
    Math.max(-MAX_WEIGHT, Math.min(
      MAX_WEIGHT,
      weight + LEARNING_RATE * sampleWeight * residual * (features[index] ?? 0),
    )),
  );
}

export function finalizeLiveLearningFixture(
  state: LiveLearningState,
  fixtureId: number,
  finalHomeScore: number,
  finalAwayScore: number,
): LiveLearningState | null {
  if (
    !Number.isSafeInteger(fixtureId) ||
    !Number.isFinite(finalHomeScore) ||
    !Number.isFinite(finalAwayScore) ||
    state.trainedFixtureIds.includes(fixtureId)
  ) {
    return null;
  }
  const fixture = state.fixtures.find((candidate) => candidate.fixtureId === fixtureId);
  if (!fixture) return null;
  const observations = fixture.observations.filter((observation) =>
    finalHomeScore >= observation.homeScore &&
    finalAwayScore >= observation.awayScore,
  );
  if (!observations.length) return null;
  const sampleWeight = 1 / observations.length;
  let homeWeights = [...state.weights.home];
  let awayWeights = [...state.weights.away];
  for (const observation of observations) {
    homeWeights = learnFromObservation(
      homeWeights,
      observation.homeExpectedGoals,
      finalHomeScore - observation.homeScore,
      observation.homeFeatures,
      sampleWeight,
    );
    awayWeights = learnFromObservation(
      awayWeights,
      observation.awayExpectedGoals,
      finalAwayScore - observation.awayScore,
      observation.awayFeatures,
      sampleWeight,
    );
  }
  return {
    ...state,
    completedMatches: state.completedMatches + 1,
    trainedFixtureIds: [...state.trainedFixtureIds, fixtureId].slice(-MAX_TRAINED_FIXTURE_IDS),
    weights: { home: homeWeights, away: awayWeights },
    fixtures: state.fixtures.filter((candidate) => candidate.fixtureId !== fixtureId),
  };
}
