import assert from "node:assert/strict";
import test from "node:test";
import { build365ScoresForensicsFallback } from "../src/lib/365scores-forensics-fallback.ts";

test("365Scores forensic fallback maps match data onto KickoffScore team IDs", () => {
  const details = {
    match: {
      home: { id: 1010, name: "Home FC" },
      away: { id: 2020, name: "Away FC" },
    },
  };
  const game = {
    homeCompetitor: {
      id: 11,
      lineups: {
        formation: "4-3-3",
        members: [{
          id: 111,
          statusText: "Starting",
          ranking: 7.8,
          position: { name: "Forward" },
          stats: [{ name: "Minutes", value: 90 }],
        }],
      },
    },
    awayCompetitor: {
      id: 22,
      lineups: {
        formation: "4-4-2",
        members: [{
          id: 222,
          statusText: "Starting",
          ranking: 6.9,
          position: { name: "Defender" },
          stats: [{ name: "Minutes", value: 90 }],
        }],
      },
    },
    members: [
      { id: 111, name: "Home Striker", competitorId: 11, jerseyNumber: 9 },
      { id: 222, name: "Away Defender", competitorId: 22, jerseyNumber: 4 },
    ],
    events: [{
      gameTime: 35,
      gameTimeDisplay: "35'",
      playerId: 111,
      eventType: { name: "Goal" },
    }],
  };

  const fallback = build365ScoresForensicsFallback(
    game,
    details,
    {
      statistics: [
        { name: "Total shots", value: 7, competitorId: 11 },
        { name: "Total shots", value: 3, competitorId: 22 },
      ],
    },
    { statistics: [{ name: "Total shots", value: 4, competitorId: 11 }] },
    { statistics: [{ name: "Total shots", value: 3, competitorId: 11 }] },
    [{
      minute: "35",
      kind: "goal",
      title: "Goal by Home Striker",
      detail: "",
      sourceOrder: 0,
    }],
  );

  assert.deepEqual(
    fallback.statistics.map((team) => team.teamId).sort((a, b) => a - b),
    [1010, 2020],
  );
  assert.ok(fallback.statistics[0].statistics.some((stat) =>
    stat.label.startsWith("1st half"),
  ));
  assert.equal(fallback.events[0].teamId, 1010);
  assert.match(fallback.events[0].comments, /Home Striker/);
  assert.equal(fallback.lineups[0].teamId, 1010);
  assert.equal(fallback.lineups[0].formation, "4-3-3");
  assert.equal(fallback.players[0].players[0].rating, "7.8");
});
