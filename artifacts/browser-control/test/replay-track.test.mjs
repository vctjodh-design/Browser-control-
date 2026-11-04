// The Open Football replay is a list of samples, so where a player is drawn
// comes entirely from this interpolation. Getting it wrong looks like players
// teleporting once every sample period.
import assert from "node:assert/strict";
import test from "node:test";
import { sampleAt, toPitch } from "../src/sim3d/sim/replay-track.js";

const track = [
  [0, 0, 0, 0],
  [400, 800, 0, 0],
  [800, 1600, 545, 100],
];

test("a sample exactly on a timestamp is returned as recorded", () => {
  const cursor = { index: 0 };
  const sample = sampleAt(track, 400, cursor);
  assert.equal(sample[1], 800);
  assert.equal(sample[2], 0);
});

test("a moment between samples is interpolated, not snapped", () => {
  const cursor = { index: 0 };
  const halfway = sampleAt(track, 200, cursor);
  assert.equal(halfway[1], 400);
  const threeQuarters = sampleAt(track, 600, cursor);
  assert.equal(threeQuarters[1], 1200);
  assert.equal(threeQuarters[2], 272.5);
  assert.equal(threeQuarters[3], 50);
});

test("the cursor walks forward without rescanning, and seeks backwards", () => {
  const cursor = { index: 0 };
  sampleAt(track, 700, cursor);
  assert.equal(cursor.index, 1);
  // A seek back has to find the window that contains the moment, not the one
  // it had reached: 300 ms sits between the first two samples.
  const backwards = sampleAt(track, 300, cursor);
  assert.equal(cursor.index, 0);
  assert.equal(backwards[1], 600);
  assert.equal(sampleAt(track, 0, cursor)[1], 0);
});

test("past the last sample the last position holds", () => {
  const cursor = { index: 0 };
  const end = sampleAt(track, 99_000, cursor);
  assert.equal(end[1], 1600);
  assert.equal(end[2], 545);
});

test("an empty or missing track is not a crash", () => {
  assert.equal(sampleAt([], 100, { index: 0 }), null);
  assert.equal(sampleAt(null, 100, { index: 0 }), null);
});

test("engine grid units become pitch metres centred on the halfway line", () => {
  const out = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
  // 4200 cm = 42 m on the x grid, 2725 cm = 27.25 m on the y grid.
  toPitch([0, 4200, 2725, 0], out);
  assert.equal(out.x, 42 - 52.5);
  assert.equal(out.z, 27.25 - 34);
  assert.equal(out.y, 0);
});
