import test from "node:test";
import assert from "node:assert/strict";
import { parseTeamFixtures } from "../src/lib/team-fixtures-parse.ts";

function row({ id, date, status = "FT", home = "San Marino", away = "Finland", goals = [0, 2], country = "World", competition = "UEFA Nations League" }) {
  return {
    _id: id,
    fixture: { id, date: `${date}T19:45:00.000Z`, status: { short: status, long: status === "FT" ? "Match Finished" : "Not Started" } },
    goals: { home: goals[0], away: goals[1] },
    league: { country, name: competition },
    teams: { home: { id: 1115, name: home }, away: { id: 1100, name: away } },
  };
}

test("a team's own fixture list becomes its window", () => {
  const payload = [
    row({ id: 1, date: "2026-11-12" }),
    row({ id: 2, date: "2026-10-20" }),
    row({ id: 3, date: "2026-09-01" }),
  ];
  const rows = parseTeamFixtures(payload, "2026-11-15", 50);
  assert.deepEqual(rows.map((match) => match.fixtureId), [1, 2, 3]);
  assert.equal(rows[0].homeTeam, "San Marino");
  assert.equal(rows[0].awayTeam, "Finland");
  assert.equal(rows[0].homeScore, 0);
  assert.equal(rows[0].awayScore, 2);
  assert.equal(rows[0].matchDate, "2026-11-12");
  assert.equal(rows[0].competition, "World: UEFA Nations League");
});

test("the window only holds what finished before the kickoff", () => {
  const payload = [
    // The match being called, and one after it: neither is evidence for it.
    row({ id: 9, date: "2026-11-15" }),
    row({ id: 10, date: "2026-11-20" }),
    // A fixture that has not been played yet.
    row({ id: 11, date: "2026-11-10", status: "NS", goals: [null, null] }),
    row({ id: 12, date: "2026-11-01" }),
  ];
  const rows = parseTeamFixtures(payload, "2026-11-15", 50);
  assert.deepEqual(rows.map((match) => match.fixtureId), [12]);
});

test("the newest fifty are kept when the feed lists more", () => {
  // Eighty matches, three days apart, the newest on 20 December.
  const day = (index) =>
    new Date(Date.UTC(2026, 11, 20) - index * 3 * 86_400_000).toISOString().slice(0, 10);
  const payload = Array.from({ length: 80 }, (_, index) => row({ id: index + 1, date: day(index) }));
  const rows = parseTeamFixtures(payload, "2026-12-31", 50);
  assert.equal(rows.length, 50);
  // Newest first, and the oldest thirty of the eighty are the ones dropped.
  assert.equal(rows[0].matchDate, day(0));
  assert.equal(rows[49].matchDate, day(49));
});

test("a row without a score or a team is dropped rather than guessed", () => {
  const payload = [
    row({ id: 1, date: "2026-10-01", goals: [null, 1] }),
    { _id: 2, fixture: { id: 2, date: "2026-10-02T00:00:00.000Z", status: { short: "FT" } }, goals: { home: 1, away: 0 }, teams: { home: { name: "" }, away: { name: "Finland" } } },
    row({ id: 3, date: "2026-10-03" }),
  ];
  const rows = parseTeamFixtures(payload, "2026-11-15", 50);
  assert.deepEqual(rows.map((match) => match.fixtureId), [3]);
});

test("a payload that is not a list says nothing instead of throwing", () => {
  assert.deepEqual(parseTeamFixtures(null, "2026-11-15", 50), []);
  assert.deepEqual(parseTeamFixtures({ error: "rate limited" }, "2026-11-15", 50), []);
});
