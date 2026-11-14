import assert from "node:assert/strict";
import test from "node:test";
import { matchesBefore, normalizeTeamName, summarizeTeamShape } from "../src/lib/team-shape.ts";

// A team's shape is only worth reading if it can see nothing but the past. These
// pin the two things that would quietly ruin it: a window that reaches the fixture
// being predicted, and a home/away split that counts a match on the wrong side.

const match = (date, homeTeam, awayTeam, homeScore, awayScore) => ({
  date,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
});

const history = [
  match("2026-10-01", "FCF", "Toulouse", 3, 0),
  match("2026-10-08", "Lyon", "FCF", 1, 1),
  match("2026-10-15", "FCF", "Paris", 0, 2),
  match("2026-10-22", "Nice", "FCF", 2, 4),
  match("2026-10-29", "FCF", "Reims", 2, 2),
  // The match being predicted: nothing before this date may include it.
  match("2026-11-05", "FCF", "Toulouse", 9, 9),
];

test("names differing in accents, dots and spacing are one team", () => {
  assert.equal(normalizeTeamName("FCF"), "fcf");
  assert.equal(normalizeTeamName("  Saint-Étienne "), "saint etienne");
  assert.equal(normalizeTeamName("Saint Etienne"), normalizeTeamName("Saint-Étienne"));
});

test("club-form words are spelling, but women's and youth sides are not", () => {
  assert.equal(normalizeTeamName("Liverpool FC"), normalizeTeamName("Liverpool"));
  assert.equal(normalizeTeamName("AC Milan"), "milan");
  assert.notEqual(normalizeTeamName("Liverpool W"), normalizeTeamName("Liverpool"));
  assert.notEqual(normalizeTeamName("Bournemouth U21"), normalizeTeamName("Bournemouth"));
});

test("a window never sees the fixture being predicted", () => {
  const before = matchesBefore("FCF", "2026-11-05", history);
  assert.equal(before.length, 5);
  assert.ok(before.every((row) => row.date < "2026-11-05"));
  assert.equal(before[0].date, "2026-10-29");
});

test("goals for and against are read from the right end of the scoreline", () => {
  const shape = summarizeTeamShape("FCF", "2026-11-05", history, [10]);
  const window = shape.windows[0];
  // 3+1+0+4+2 scored, 0+1+2+2+2 conceded.
  assert.equal(window.played, 5);
  assert.equal(window.goalsFor, 10);
  assert.equal(window.goalsAgainst, 7);
  assert.equal(window.wins, 2);
  assert.equal(window.draws, 2);
  assert.equal(window.losses, 1);
});

test("home and away scoring is split by venue, not by result", () => {
  const shape = summarizeTeamShape("FCF", "2026-11-05", history, [10]);
  const window = shape.windows[0];
  // Home matches: 3, 0, 2 scored in three games. Away: 1, 4 in two.
  assert.equal(window.homePerGameFor, 1.67);
  assert.equal(window.awayPerGameFor, 2.5);
});

test("every window stops at its own depth", () => {
  const shape = summarizeTeamShape("FCF", "2026-11-05", history, [2, 4, 10]);
  assert.deepEqual(
    shape.windows.map((row) => row.played),
    [2, 4, 5],
  );
  assert.equal(shape.windows[0].window, 2);
  assert.equal(shape.windows[2].window, 10);
});

test("volatility and trend stay silent until there is enough of a sample", () => {
  const thin = summarizeTeamShape("FCF", "2026-10-09", history);
  assert.equal(thin.volatility, null);
  assert.equal(thin.trend, null);

  const grown = [...history];
  for (let index = 0; index < 12; index += 1) {
    const day = String(10 + index).padStart(2, "0");
    grown.push(match(`2026-09-${day}`, "FCF", "Somebody", 0, 3));
  }
  const shape = summarizeTeamShape("FCF", "2026-11-05", grown);
  // Recent form (1.2 a game) against the long run (under a goal a game) is a real
  // gap, and the trend is read off points rather than goals.
  assert.ok(shape.volatility !== null && shape.volatility > 0);
  assert.ok(shape.trend === "rising" || shape.trend === "falling" || shape.trend === "steady");
});

test("a team with no history gets zeroes rather than a guess", () => {
  const shape = summarizeTeamShape("Nobody", "2026-11-05", history);
  assert.equal(shape.windows[0].played, 0);
  assert.equal(shape.windows[0].perGameFor, 0);
  assert.equal(shape.volatility, null);
});
