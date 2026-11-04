// A replay must drive the same surface the simulated match does — the camera
// reads `match.ball.pos`, the HUD reads score and the clock, main.js calls
// update. This builds a small recording and plays it start to finish with a
// stand-in for the player rigs, which is enough to catch a joystick-shaped hole
// in the class without a browser.
import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MatchReplay } from "../src/sim3d/sim/replay.js";

const STEP = 400;
const MINUTES = 90;
const SAMPLES = (MINUTES * 60 * 1000) / STEP;

/** Twenty-two players and a ball, drifting across the pitch. */
function recording() {
  const players = {};
  const tracks = {};
  for (let i = 0; i < 22; i += 1) {
    const id = (i < 11 ? 1000 : 2000) + i + 1;
    players[id] = { name: `Player ${id}`, role: i % 11 === 0 ? "Goalkeeper" : "MidfielderCenter", shirt: (i % 11) + 1 };
    tracks[id] = Array.from({ length: SAMPLES }, (_, n) => [
      n * STEP,
      ((i * 130 + n * 3) % 8200) + 100,
      ((i * 90 + n * 2) % 5300) + 100,
      0,
    ]);
  }
  const ball = Array.from({ length: SAMPLES }, (_, n) => [n * STEP, 1000 + ((n * 7) % 6000), 2700, 0]);
  return {
    engine: "open-football",
    durationMs: MINUTES * 60 * 1000,
    pitch: { width: 840, height: 545 },
    stats: { home: { shots: 12, onTarget: 5, passes: 400, possession: 55 }, away: { shots: 9, onTarget: 3, passes: 300, possession: 45 } },
    score: { home: 1, away: 1 },
    teams: { home: "AEK Athens", away: "Real Madrid" },
    players,
    substitutions: [{ in: 2012, out: 2002, t: 60 * 60 * 1000, team: 2 }],
    goals: [
      { stat_type: "Goal", time: 20 * 60 * 1000, player_id: 1009, is_auto_goal: false },
      { stat_type: "Assist", time: 20 * 60 * 1000, player_id: 1010, is_auto_goal: false },
      { stat_type: "Goal", time: 70 * 60 * 1000, player_id: 2009, is_auto_goal: false },
    ],
    ball,
    tracks,
    sampleEveryMs: STEP,
  };
}

/** A rig with only the members the replay touches. */
function stubRig() {
  return {
    root: new THREE.Group(),
    update() {},
    startAction() {},
  };
}

function play(replay, { seconds = MINUTES * 60 } = {}) {
  const ball = { pos: new THREE.Vector3(), mesh: new THREE.Mesh() };
  const events = [];
  const goals = [];
  const match = new MatchReplay(null, ball, {
    replay,
    makeRig: stubRig,
    onEvent: (event) => events.push(event),
    onGoal: (goal) => goals.push(goal),
  });
  match.startMatch();
  const dt = 1 / 20;
  for (let elapsed = 0; elapsed < seconds && match.state !== "fulltime"; elapsed += dt) {
    match.update(dt);
  }
  return { match, events, goals, ball };
}

test("the recording becomes two elevens on the pitch, with a ball the camera can read", () => {
  const { match, ball } = play(recording(), { seconds: 0 });
  assert.equal(match.agents.length, 22);
  assert.equal(match.teams.length, 2);
  assert.equal(match.teams[0].name, "AEK Athens");
  assert.equal(match.teams[1].name, "Real Madrid");
  // The camera reads match.ball.pos every frame; it has to exist before kick-off.
  assert.ok(match.ball.pos, "match.ball.pos exists");
  assert.ok(Number.isFinite(ball.pos.x));
  assert.equal(match.state, "play");
  assert.equal(match.clockText(), "00:00");
});

test("playing it raises the engine's goals, at its minutes, to its scoreline", () => {
  const { match, goals, events } = play(recording());
  assert.equal(match.state, "fulltime");
  assert.deepEqual([...match.score], [1, 1]);
  assert.deepEqual(goals.map((goal) => goal.minute), [20, 70]);
  assert.deepEqual(goals[0].score, [1, 0]);
  assert.deepEqual(goals[1].score, [1, 1]);
  // An assist is not a goal: the scoreline counts three entries as two goals.
  assert.equal(events.filter((event) => event.type === "goal").length, 2);
  assert.equal(events.filter((event) => event.type === "halftime").length, 1);
  assert.equal(events.filter((event) => event.type === "fulltime").length, 1);
});

test("players stay on the pitch and move as the recording says", () => {
  const { match } = play(recording(), { seconds: 30 });
  for (const agent of match.agents) {
    assert.ok(agent.pos.x >= -52.5 && agent.pos.x <= 52.5, `${agent.name} x ${agent.pos.x}`);
    assert.ok(agent.pos.z >= -34 && agent.pos.z <= 34, `${agent.name} z ${agent.pos.z}`);
    assert.ok(agent.speed >= 0 && agent.speed <= 9, `${agent.name} speed ${agent.speed}`);
  }
  const moved = match.agents.filter((agent) => Math.abs(agent.pos.x - agent.lastPos.x) < 100);
  assert.equal(moved.length, 22);
});

test("the clock runs to the recording's end, and the stats land on its totals", () => {
  const { match } = play(recording());
  assert.ok(match.clock >= MINUTES * 60, `clock ${match.clock}`);
  assert.equal(match.stats[0].shots, 12);
  assert.equal(match.stats[1].shots, 9);
  assert.equal(match.stats[0].onTarget, 5);
  assert.deepEqual([...match.possessionPct], [55, 45]);
});

test("restarting rewinds the same match to kick-off", () => {
  const { match } = play(recording());
  match.restartMatch();
  assert.equal(match.state, "play");
  assert.equal(match.clock, 0);
  assert.deepEqual([...match.score], [0, 0]);
  assert.equal(match.stats[0].shots, 0);
  // And it can be played again, goals and all.
  const again = play(recording());
  assert.deepEqual([...again.match.score], [1, 1]);
});
