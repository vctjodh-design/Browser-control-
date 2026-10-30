import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeLiveMatch,
  buildLiveLearningFeatures,
  LIVE_SIMULATION_RUNS,
} from '../src/lib/live-match-intelligence.ts';

function liveAction(overrides = {}) {
  return {
    sourceMatchUrl: 'https://www.365scores.com/football/match/example-1-2-3#id=123',
    gameId: 123,
    competition: 'Test League',
    status: 'Second Half',
    elapsedMinute: 70,
    homeTeam: 'Harbor FC',
    awayTeam: 'Valley United',
    homeScore: 1,
    awayScore: 0,
    observedAt: '2026-10-30T12:00:00.000Z',
    events: [],
    shotEvents: [
      { minute: '62', teamSide: 'home', playerName: 'A. Player', outcome: 'Saved', bodyPart: 'Foot', xg: '0.35', xgot: '0.18', x: 54, y: 48, sourceOrder: 1 },
      { minute: '67', teamSide: 'home', playerName: 'B. Player', outcome: 'Missed', bodyPart: 'Foot', xg: '0.12', xgot: null, x: 51, y: 52, sourceOrder: 2 },
      { minute: '68', teamSide: 'away', playerName: 'C. Player', outcome: 'Saved', bodyPart: 'Head', xg: '0.20', xgot: '0.14', x: 62, y: 45, sourceOrder: 3 },
    ],
    formationPlayers: [],
    ...overrides,
  };
}

function matchCenter(overrides = {}) {
  return {
    sourceUrl: 'https://kickoffscore.example/match/123',
    match: {
      fixtureId: 123,
      home: { id: 1, name: 'Harbor FC', score: 1 },
      away: { id: 2, name: 'Valley United', score: 0 },
      status: 'Second Half',
    },
    elapsedMinute: 70,
    observedAt: '2026-10-30T12:00:00.000Z',
    statistics: [],
    events: [],
    lineups: [],
    players: [],
    issues: [],
    ...overrides,
  };
}

test('waits for a validated 365Scores snapshot before analyzing', () => {
  assert.equal(analyzeLiveMatch({}).status, 'waiting');
});

test('keeps the source score as the base for all 10,000 simulations', () => {
  const result = analyzeLiveMatch({
    liveAction: liveAction({
      shotEvents: liveAction().shotEvents.filter((shot) => shot.teamSide === 'home'),
    }),
    matchCenter: matchCenter(),
    now: new Date('2026-10-30T12:00:30.000Z'),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.home.score, 1);
  assert.equal(result.away.score, 0);
  assert.equal(result.away.scoringRateBasis, 'neutral-prior');
  assert.ok(result.away.projectedGoalsRemaining > 0);
  assert.equal(result.simulation.runs, LIVE_SIMULATION_RUNS);
  assert.equal(result.simulation.topScorelines.reduce((sum, row) => sum + row.runs, 0) <= LIVE_SIMULATION_RUNS, true);
  assert.ok(result.simulation.topScorelines.every((row) => row.homeScore >= 1 && row.awayScore >= 0));
  assert.ok(result.matchDynamics.imbalanceIndex >= 0 && result.matchDynamics.imbalanceIndex <= 100);
  assert.ok(result.matchDynamics.outcomeEntropy >= 0 && result.matchDynamics.outcomeEntropy <= 100);
  assert.equal(result.matchDynamics.outcomeEntropy, result.simulation.scorelineEntropy);
  assert.equal(result.observedAgeSeconds, 30);
});

test('returns stable scenarios for an unchanged live snapshot', () => {
  const input = {
    liveAction: liveAction(),
    matchCenter: matchCenter(),
    now: new Date('2026-10-30T12:00:30.000Z'),
  };

  assert.deepEqual(analyzeLiveMatch(input).simulation, analyzeLiveMatch(input).simulation);
});

test('marks a completed fixture as not live instead of forecasting it', () => {
  const result = analyzeLiveMatch({
    liveAction: liveAction({ status: 'Full Time', elapsedMinute: 90 }),
    matchCenter: matchCenter(),
  });
  assert.equal(result.status, 'not-live');
  assert.equal(result.simulation, null);
});

test('uses an explicit shot-volume proxy only when xG is unavailable', () => {
  const result = analyzeLiveMatch({
    liveAction: liveAction({
      shotEvents: [
        { minute: '65', teamSide: 'home', playerName: null, outcome: 'Saved', bodyPart: null, xg: null, xgot: null, x: null, y: null, sourceOrder: 1 },
        { minute: '67', teamSide: 'away', playerName: null, outcome: 'Missed', bodyPart: null, xg: null, xgot: null, x: null, y: null, sourceOrder: 2 },
      ],
    }),
    matchCenter: matchCenter({
      statistics: [
        { teamId: 1, teamName: 'Harbor FC', statistics: [{ label: 'Shots on target', value: 1 }, { label: 'Total shots', value: 1 }] },
        { teamId: 2, teamName: 'Valley United', statistics: [{ label: 'Shots on target', value: 0 }, { label: 'Total shots', value: 1 }] },
      ],
    }),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.signalCoverage.xg, false);
  assert.ok(result.home.projectedGoalsRemaining >= 0);
  assert.ok(result.confidence.reasons.some((reason) => /lacks source xg/i.test(reason)));
  assert.equal(result.home.scoringRateBasis, 'shot-volume-proxy');
});

test('xGOT and team-attributed red cards affect the live state indices', () => {
  const baseAction = liveAction({
    shotEvents: [
      { minute: '62', teamSide: 'home', playerName: null, outcome: 'Saved', bodyPart: null, xg: '0.2', xgot: '0.05', x: 50, y: 50, sourceOrder: 1 },
      { minute: '67', teamSide: 'away', playerName: null, outcome: 'Saved', bodyPart: null, xg: '0.2', xgot: '0.05', x: 50, y: 50, sourceOrder: 2 },
    ],
  });
  const highXgotAction = liveAction({
    ...baseAction,
    shotEvents: baseAction.shotEvents.map((shot) => ({ ...shot, xgot: '0.8' })),
  });
  const baseline = analyzeLiveMatch({
    liveAction: baseAction,
    matchCenter: matchCenter(),
  });
  const betterPlacement = analyzeLiveMatch({
    liveAction: highXgotAction,
    matchCenter: matchCenter(),
  });
  assert.ok(betterPlacement.home.kineticIntensity > baseline.home.kineticIntensity);

  const withRedCard = analyzeLiveMatch({
    liveAction: baseAction,
    matchCenter: matchCenter({
      events: [{
        minute: 63,
        extraMinute: null,
        teamId: 1,
        teamName: 'Harbor FC',
        player: 'A. Player',
        playerId: 10,
        assist: null,
        assistId: null,
        type: 'Card',
        detail: 'Red card',
        comments: null,
      }],
    }),
  });
  assert.equal(withRedCard.home.redCards, 1);
  assert.ok(withRedCard.home.resistanceDecay > baseline.home.resistanceDecay);
});

test('forecasts a live 0–0 at 10 minutes instead of freezing at the current score', () => {
  const result = analyzeLiveMatch({
    liveAction: liveAction({
      status: 'First Half',
      elapsedMinute: 10,
      homeScore: 0,
      awayScore: 0,
      shotEvents: [],
    }),
    matchCenter: matchCenter({
      match: {
        fixtureId: 123,
        home: { id: 1, name: 'Harbor FC', score: 0 },
        away: { id: 2, name: 'Valley United', score: 0 },
        status: 'First Half',
      },
      elapsedMinute: 10,
    }),
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.home.score, 0);
  assert.equal(result.away.score, 0);
  assert.ok(result.simulation.topScorelines[0].homeScore + result.simulation.topScorelines[0].awayScore > 0);
  assert.ok(result.confidence.reasons.some((reason) => /general scoring baseline/i.test(reason)));
});

test('sums only reported shot xG values instead of spreading them across missing shots', () => {
  const result = analyzeLiveMatch({
    liveAction: liveAction({
      shotEvents: [
        { minute: '62', teamSide: 'home', playerName: null, outcome: 'Saved', bodyPart: null, xg: '0.3', xgot: null, x: null, y: null, sourceOrder: 1 },
        { minute: '67', teamSide: 'home', playerName: null, outcome: 'Missed', bodyPart: null, xg: null, xgot: null, x: null, y: null, sourceOrder: 2 },
      ],
    }),
    matchCenter: matchCenter(),
  });
  assert.equal(result.home.xg, 0.3);
});

test('applies learned calibration weights to remaining-goal estimates', () => {
  const input = {
    liveAction: liveAction(),
    matchCenter: matchCenter(),
  };
  const baseline = analyzeLiveMatch(input);
  const calibrated = analyzeLiveMatch({
    ...input,
    calibrationWeights: { home: [0.1], away: [0] },
    completedMatches: 4,
  });
  assert.ok(calibrated.home.projectedGoalsRemaining > baseline.home.projectedGoalsRemaining);
  assert.equal(calibrated.away.projectedGoalsRemaining, baseline.away.projectedGoalsRemaining);
  assert.equal(calibrated.home.calibrationMultiplier, Math.exp(0.1));
  assert.ok(calibrated.confidence.reasons.some((reason) => /4 completed matches/i.test(reason)));
});

test('learning features reflect recent goals and red-card incidents', () => {
  const state = analyzeLiveMatch({
    liveAction: liveAction(),
    matchCenter: matchCenter({
      events: [
        {
          minute: 63,
          extraMinute: null,
          teamId: 1,
          teamName: 'Harbor FC',
          player: 'A. Player',
          playerId: 10,
          assist: null,
          assistId: null,
          type: 'Goal',
          detail: 'Goal',
          comments: null,
        },
        {
          minute: 68,
          extraMinute: null,
          teamId: 2,
          teamName: 'Valley United',
          player: 'B. Player',
          playerId: 11,
          assist: null,
          assistId: null,
          type: 'Card',
          detail: 'Red card',
          comments: null,
        },
        {
          minute: 69,
          extraMinute: null,
          teamId: 2,
          teamName: 'Valley United',
          player: 'C. Player',
          playerId: 12,
          assist: null,
          assistId: null,
          type: 'Card',
          detail: 'Yellow card',
          comments: null,
        },
      ],
    }),
  });
  const homeFeatures = buildLiveLearningFeatures(state.home, state.away, matchCenter({
    events: [
      { minute: 63, extraMinute: null, teamId: 1, teamName: 'Harbor FC', player: null, playerId: null, assist: null, assistId: null, type: 'Goal', detail: 'Goal', comments: null },
      { minute: 68, extraMinute: null, teamId: 2, teamName: 'Valley United', player: null, playerId: null, assist: null, assistId: null, type: 'Card', detail: 'Red card', comments: null },
      { minute: 69, extraMinute: null, teamId: 2, teamName: 'Valley United', player: null, playerId: null, assist: null, assistId: null, type: 'Card', detail: 'Yellow card', comments: null },
    ],
  }), 70);
  assert.equal(homeFeatures[3], 0.5);
  assert.equal(homeFeatures[4], 0.5);
  assert.equal(homeFeatures[9], 1 / 3);
});

test('rejects a 365Scores source whose teams do not match the fixture', () => {
  const result = analyzeLiveMatch({
    liveAction: liveAction({ awayTeam: 'Different Club' }),
    matchCenter: matchCenter(),
  });
  assert.equal(result.status, 'insufficient-data');
  assert.match(result.message, /teams do not match/i);
  assert.equal(result.simulation, null);
});
