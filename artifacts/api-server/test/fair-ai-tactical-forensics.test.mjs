import assert from "node:assert/strict";
import test from "node:test";
import { buildFairAiTacticalForensics } from "../src/lib/fair-ai-tactical-forensics.ts";

function statistics(teamId, teamName, values) {
  return {
    teamId,
    teamName,
    statistics: [
      ["Total Shots", values.shots],
      ["Shots on Target", values.shotsOnTarget],
      ["Expected Goals", values.xg],
      ["Big Chances", values.bigChances],
      ["Ball Possession", values.possession],
      ["Passes %", values.passCompletion],
      ["Accurate Long Balls %", values.longBallCompletion],
      ["Passes in Final Third %", values.finalThirdPassCompletion],
      ["Total Tackles", values.tackles],
      ["Interceptions", values.interceptions],
      ["Recoveries", values.recoveries],
    ].map(([label, value]) => ({ label: `Full match · ${label}`, value })),
  };
}

function matchSnapshot({
  fixtureId,
  ownId,
  ownName,
  opponentId,
  opponentName,
  goalsFor,
  goalsAgainst,
  ownStats,
  opponentStats,
  ownFormation,
  rating,
  ownScoresAfterConceding = false,
}) {
  const goals = [];
  for (let index = 0; index < goalsFor; index += 1) {
    goals.push({
      minute: ownScoresAfterConceding ? 80 + index : 15 + index * 20,
      extraMinute: null,
      teamId: ownId,
      teamName: ownName,
      player: `${ownName} scorer`,
      playerId: null,
      assist: null,
      assistId: null,
      type: "Goal",
      detail: "Normal Goal",
      comments: index === 0 ? "Source commentary: finish after a move." : null,
    });
  }
  for (let index = 0; index < goalsAgainst; index += 1) {
    goals.push({
      minute: ownScoresAfterConceding
        ? 20 + index
        : goalsFor ? 80 + index : 20 + index * 20,
      extraMinute: null,
      teamId: opponentId,
      teamName: opponentName,
      player: `${opponentName} scorer`,
      playerId: null,
      assist: null,
      assistId: null,
      type: "Goal",
      detail: "Normal Goal",
      comments: null,
    });
  }
  goals.sort((left, right) => left.minute - right.minute);
  const ownPlayer = {
    id: ownId * 100,
    name: `${ownName} standout`,
    photo: null,
    number: 10,
    position: "AM",
    rating: String(rating),
    statistics: [
      { label: "Player · goals", value: goalsFor },
      { label: "Player · assists", value: 1 },
    ],
  };

  return {
    fixtureId,
    details: {
      match: {
        date: "2026-10-01T18:00:00.000Z",
        competition: "Test League",
        home: {
          id: ownId,
          name: ownName,
          score: goalsFor,
          halfTimeScore: Math.min(goalsFor, 1),
        },
        away: {
          id: opponentId,
          name: opponentName,
          score: goalsAgainst,
          halfTimeScore: Math.min(goalsAgainst, 1),
        },
      },
      statistics: [
        statistics(ownId, ownName, ownStats),
        statistics(opponentId, opponentName, opponentStats),
      ],
      events: goals,
      lineups: [
        {
          teamId: ownId,
          teamName: ownName,
          formation: ownFormation,
          coach: "Test coach",
          coachId: null,
          starters: [{ id: ownPlayer.id, name: ownPlayer.name, number: 10, position: "AM", grid: null }],
          substitutes: [],
        },
        {
          teamId: opponentId,
          teamName: opponentName,
          formation: "4-2-3-1",
          coach: "Opposing coach",
          coachId: null,
          starters: [],
          substitutes: [],
        },
      ],
      players: [
        { teamId: ownId, teamName: ownName, players: [ownPlayer] },
        { teamId: opponentId, teamName: opponentName, players: [] },
      ],
    },
  };
}

test("forensics keeps per-match timeline, comments, stats, lineups and player impact", () => {
  const snapshot = matchSnapshot({
    fixtureId: 100,
    ownId: 1,
    ownName: "Atlas",
    opponentId: 10,
    opponentName: "Rovers",
    goalsFor: 1,
    goalsAgainst: 1,
    ownStats: {
      shots: 16,
      shotsOnTarget: 8,
      xg: 2.1,
      bigChances: 4,
      possession: 60,
      passCompletion: 88,
      longBallCompletion: 67,
      finalThirdPassCompletion: 85,
      tackles: 10,
      interceptions: 8,
      recoveries: 52,
    },
    opponentStats: {
      shots: 5,
      shotsOnTarget: 2,
      xg: 0.7,
      bigChances: 1,
      possession: 40,
      passCompletion: 70,
      longBallCompletion: 45,
      finalThirdPassCompletion: 55,
      tackles: 18,
      interceptions: 12,
      recoveries: 40,
    },
    ownFormation: "4-3-3",
    rating: 7.4,
  });
  const result = buildFairAiTacticalForensics(
    [snapshot],
    { 1: [100], 2: [] },
    1,
    2,
    "Atlas",
    "Tide",
  );
  const match = result.home.recentMatches[0];

  assert.equal(match.events.length, 2);
  assert.match(match.timelineSummary, /source comments/);
  assert.equal(match.timelineHasFullGoalRecord, true);
  assert.equal(match.teamStatistics.length, 2);
  assert.equal(match.teamStatistics[0].statistics.length, 11);
  assert.equal(match.lineups[0].formation, "4-3-3");
  assert.equal(match.playerHighlights[0].name, "Atlas standout");
  assert.equal(match.playerHighlights[0].averageRating, 7.4);
  assert.equal(match.expectedGoalsFor, 2.1);
});

test("matchup lean weighs multiple evidence areas rather than win count alone", () => {
  const snapshots = [];
  const atlasFixtures = [];
  const tideFixtures = [];
  const atlasResults = Array.from({ length: 10 }, (_, index) =>
    index < 8 ? [1, 1] : [0, 1],
  );
  const tideResults = Array.from({ length: 10 }, (_, index) =>
    index < 8 ? [3, 0] : [0, 1],
  );

  atlasResults.forEach(([forGoals, againstGoals], index) => {
    const id = 200 + index;
    atlasFixtures.push(id);
    snapshots.push(matchSnapshot({
      fixtureId: id,
      ownId: 1,
      ownName: "Atlas",
      opponentId: 10 + index,
      opponentName: `Rovers ${index}`,
      goalsFor: forGoals,
      goalsAgainst: againstGoals,
      ownStats: {
        shots: 16,
        shotsOnTarget: 8,
        xg: 2.1,
        bigChances: 4,
        possession: 60,
        passCompletion: 88,
        longBallCompletion: 67,
        finalThirdPassCompletion: 85,
        tackles: 10,
        interceptions: 8,
        recoveries: 52,
      },
      opponentStats: {
        shots: 5,
        shotsOnTarget: 2,
        xg: 0.7,
        bigChances: 1,
        possession: 40,
        passCompletion: 70,
        longBallCompletion: 45,
        finalThirdPassCompletion: 55,
        tackles: 18,
        interceptions: 12,
        recoveries: 40,
      },
      ownFormation: "4-3-3",
      rating: 7.4,
      ownScoresAfterConceding: true,
    }));
  });
  tideResults.forEach(([forGoals, againstGoals], index) => {
    const id = 300 + index;
    tideFixtures.push(id);
    snapshots.push(matchSnapshot({
      fixtureId: id,
      ownId: 2,
      ownName: "Tide",
      opponentId: 20 + index,
      opponentName: `United ${index}`,
      goalsFor: forGoals,
      goalsAgainst: againstGoals,
      ownStats: {
        shots: 8,
        shotsOnTarget: 3,
        xg: 1.0,
        bigChances: 1,
        possession: 43,
        passCompletion: 71,
        longBallCompletion: 48,
        finalThirdPassCompletion: 58,
        tackles: 18,
        interceptions: 12,
        recoveries: 40,
      },
      opponentStats: {
        shots: 14,
        shotsOnTarget: 6,
        xg: 1.3,
        bigChances: 2,
        possession: 57,
        passCompletion: 80,
        longBallCompletion: 60,
        finalThirdPassCompletion: 75,
        tackles: 10,
        interceptions: 8,
        recoveries: 52,
      },
      ownFormation: "4-2-3-1",
      rating: 6.8,
    }));
  });

  const result = buildFairAiTacticalForensics(
    snapshots,
    { 1: atlasFixtures, 2: tideFixtures },
    1,
    2,
    "Atlas",
    "Tide",
  );

  assert.equal(result.home.matchesExpected, 10);
  assert.equal(result.home.matchesAnalyzed, 10);
  assert.equal(result.away.matchesExpected, 10);
  assert.equal(result.away.matchesAnalyzed, 10);
  assert.deepEqual(result.home.results, { wins: 0, draws: 8, losses: 2 });
  assert.deepEqual(result.away.results, { wins: 8, draws: 0, losses: 2 });
  assert.equal(result.assessment.resultLean, "home");
  assert.equal(result.assessment.factors.length, 7);
  assert.equal(result.home.formationSummaries[0].formation, "4-3-3");
  assert.equal(result.home.eventTimelineMatches, 10);
  assert.equal(result.home.completeGoalTimelines, 10);
  assert.match(result.assessment.summary, /up to ten recent matches per team/);
  assert.match(result.source, /up to ten completed matches per team/);
});
