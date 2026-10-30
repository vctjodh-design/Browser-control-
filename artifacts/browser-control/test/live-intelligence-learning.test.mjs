import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLiveLearningState,
  finalizeLiveLearningFixture,
  loadLiveLearningState,
  recordLiveLearningObservation,
  saveLiveLearningState,
} from '../src/lib/live-intelligence-learning.ts';

function observation(overrides = {}) {
  return {
    fixtureId: 44,
    signature: '10:0:0:events-a',
    observedAt: '2026-10-30T12:10:00.000Z',
    minute: 10,
    homeScore: 0,
    awayScore: 0,
    homeExpectedGoals: 0.2,
    awayExpectedGoals: 0.15,
    homeFeatures: [1, 0.9, 0, 0, 0, 0.2, 0.1, 0],
    awayFeatures: [1, 0.9, 0, 0, 0, -0.2, -0.1, 0],
    ...overrides,
  };
}

test('records each incident snapshot once and replaces a repeated snapshot', () => {
  const initial = emptyLiveLearningState();
  const first = recordLiveLearningObservation(initial, observation());
  assert.equal(first.fixtures[0].observations.length, 1);
  assert.equal(recordLiveLearningObservation(first, observation()), first);

  const revised = recordLiveLearningObservation(first, observation({
    homeExpectedGoals: 0.3,
  }));
  assert.equal(revised.fixtures[0].observations.length, 1);
  assert.equal(revised.fixtures[0].observations[0].homeExpectedGoals, 0.3);
});

test('trains from the completed score and cannot train the same fixture twice', () => {
  const pending = recordLiveLearningObservation(emptyLiveLearningState(), observation());
  const learned = finalizeLiveLearningFixture(pending, 44, 2, 1);

  assert.ok(learned);
  assert.equal(learned.completedMatches, 1);
  assert.ok(learned.weights.home[0] > 0);
  assert.ok(learned.weights.away[0] > 0);
  assert.equal(learned.fixtures.length, 0);
  assert.equal(finalizeLiveLearningFixture(learned, 44, 2, 1), null);
});

test('does not learn from a final score that contradicts an observed score', () => {
  const pending = recordLiveLearningObservation(emptyLiveLearningState(), observation({
    minute: 75,
    homeScore: 2,
    awayScore: 1,
  }));
  assert.equal(finalizeLiveLearningFixture(pending, 44, 1, 1), null);
});

test('persists snapshots and learned weights in browser storage', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    },
  });
  try {
    const pending = recordLiveLearningObservation(emptyLiveLearningState(), observation());
    saveLiveLearningState(pending);
    const restored = loadLiveLearningState();
    assert.equal(restored.fixtures.length, 1);
    assert.equal(restored.fixtures[0].observations.length, 1);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      delete globalThis.window;
    }
  }
});
