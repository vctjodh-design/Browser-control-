import assert from "node:assert/strict";
import test from "node:test";
import { excludeFixtureRows } from "../src/lib/kickoffscore-fixture-selection.ts";

test("excludes the reviewed fixture before any match details are requested", () => {
  const rows = [
    { fixture: { id: 901 }, goals: { home: 3, away: 1 } },
    { fixture: { id: 900 }, goals: { home: 2, away: 0 } },
    { _id: "899", fixture: { date: "2026-10-01" } },
  ];

  assert.deepEqual(
    excludeFixtureRows(rows, [900, 901]),
    [{ _id: "899", fixture: { date: "2026-10-01" } }],
  );
});

test("keeps all fixture rows when no fixture is being excluded", () => {
  const rows = [{ fixture: { id: 901 } }];

  assert.equal(excludeFixtureRows(rows, []).length, 1);
});
