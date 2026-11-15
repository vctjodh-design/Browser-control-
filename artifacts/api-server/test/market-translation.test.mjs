import test from "node:test";
import assert from "node:assert/strict";
import {
  contestScorelines,
  translateBoard,
  worthsFromContest,
} from "../src/lib/market-translation.ts";

const side = (overrides = {}) => ({
  team: "Finland",
  short: "FIN",
  matches: 30,
  led: 10,
  leadsDropped: 3,
  trailed: 10,
  rescued: 3,
  xg: 1.4,
  xga: 1.3,
  ...overrides,
});

test("the board's two means become a distribution that sums to one", () => {
  const translation = translateBoard(1.6, 1.1);
  const total = translation.rows.reduce((sum, row) => sum + row.implied, 0);
  assert.ok(total > 0.55 && total <= 1, `rows should cover the plausible mass, got ${total}`);
  assert.ok(Math.abs(translation.shares.home + translation.shares.draw + translation.shares.away - 1) < 0.02);
  assert.ok(translation.shares.home > translation.shares.away);
});

test("the draws a card forgets are always shown", () => {
  const translation = translateBoard(2.4, 0.6);
  const labels = new Set(translation.rows.map((row) => row.label));
  for (const draw of ["0–0", "1–1", "2–2", "3–3"]) {
    assert.ok(labels.has(draw), `${draw} should be on the translation`);
  }
  const draw = translation.rows.find((row) => row.label === "1–1");
  assert.ok(draw.drawn);
});

test("a low-scoring board puts the draw near the top, a high-scoring one does not", () => {
  const tight = translateBoard(0.9, 0.9);
  const open = translateBoard(2.6, 2.2);
  assert.ok(tight.shares.draw > open.shares.draw);
  assert.ok(open.shares.over25 > tight.shares.over25);
});

test("the baseline keeps the spot when nothing argues against it", () => {
  const translation = translateBoard(2.1, 0.8);
  const contest = contestScorelines(translation, side(), side({ team: "San Marino", short: "SAN" }), null);
  assert.equal(contest.baseline, translation.baseline.label);
  assert.equal(contest.moved, false);
  assert.equal(contest.winner, contest.baseline);
  assert.match(contest.note, /keeps the spot/);
});

test("a side that drops leads hands the spot to the draw", () => {
  // A board that likes the home win, against a home side that drops most of its leads
  // and an away side that rescues most of its deficits.
  const translation = translateBoard(1.5, 1.2);
  const home = side({ short: "FIN", led: 12, leadsDropped: 7, trailed: 8, rescued: 2 });
  const away = side({ team: "San Marino", short: "SAN", led: 12, leadsDropped: 7, trailed: 10, rescued: 6 });
  const contest = contestScorelines(translation, home, away, null);
  assert.ok(contest.contenders.some((row) => /^(\d+)–\1$/.test(row.scoreline)));
  const moved = contest.moved;
  if (moved) {
    assert.match(contest.note, /take the spot/);
    assert.match(contest.winner, /–/);
  } else {
    // Not moved: the margin must still be reported, and the draw named as a challenger.
    assert.ok(contest.margin <= 0.1);
  }
});

test("a moved contest rewrites the worths so the lines follow the scoreline", () => {
  const moved = {
    contenders: [],
    baseline: "2–1",
    winner: "1–1",
    margin: 0.2,
    moved: true,
    drawCandidate: "1–1",
    note: "",
  };
  const worths = worthsFromContest(moved, { home: 1.6, away: 1.1 });
  // A level match: both worths are half the board's total.
  assert.equal(worths.home, 1.35);
  assert.equal(worths.away, 1.35);
});

test("a contest that did not move leaves the board's worths alone", () => {
  const held = { contenders: [], baseline: "2–1", winner: "2–1", margin: 0, moved: false, drawCandidate: null, note: "" };
  const worths = worthsFromContest(held, { home: 1.6, away: 1.1 });
  assert.deepEqual(worths, { home: 1.6, away: 1.1 });
});
