import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

// MatchBall only needs a canvas for its texture; the physics are plain maths.
const ctx2d = new Proxy(
  {},
  {
    get: (_t, key) => {
      if (key === "canvas") return { width: 1, height: 1 };
      if (key === "createLinearGradient" || key === "createRadialGradient") {
        return () => ({ addColorStop() {} });
      }
      return () => {};
    },
    set: () => true,
  },
);
const fakeCanvas = { width: 1, height: 1, getContext: () => ctx2d };
globalThis.document = { createElement: () => fakeCanvas, createElementNS: () => fakeCanvas };

const { Match } = await import("../src/sim3d/sim/match.js");
const { MatchBall } = await import("../src/sim3d/entities/ball.js");

const stubRig = () => ({
  root: { position: new THREE.Vector3(), rotation: { y: 0 } },
  update() {},
  startAction() {},
});

function scenario({ runnerX }) {
  const events = [];
  const match = new Match(null, new MatchBall(), {
    makeRig: stubRig,
    onEvent: (e) => events.push(e),
  });
  match.startMatch();
  const [home, away] = match.teams;

  // Home attacks +x. Park the away back line on the halfway line, with the rest
  // of both teams out of the way so only the line decides offside.
  const park = (a, x, z) => {
    a.pos.set(x, 0, z);
    a.vel.set(0, 0, 0);
  };
  for (const a of away.agents) park(a, a.role === "GK" ? 51 : 10, a.role === "GK" ? 0 : 12);
  away.agents[1].pos.set(10, 0, -8); // second-last opponent, the offside line
  for (const a of home.agents) park(a, -30, 20);

  const passer = home.agents.find((a) => a.role === "CM");
  const runner = home.agents.find((a) => a.role === "ST");
  park(passer, 0, 0);
  park(runner, runnerX, 0);
  match.possessor = passer;
  match.state = "play";

  match.executePass(passer, {
    mate: runner,
    dist: Math.abs(runnerX),
    risk: 0.1,
    space: 8,
    forward: 1,
    goalDist: 40,
    score: 2,
  });
  // The runner gets there first and takes it.
  match.takePossession(runner, 6, match.ball);
  return { match, events, home, away, runner };
}

test("a man beyond the line when the ball is played is flagged offside", () => {
  const { match, events, away, runner } = scenario({ runnerX: 24 });
  const flag = events.find((e) => e.type === "offside");
  assert.ok(flag, "expected an offside event");
  assert.match(flag.text, new RegExp(runner.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(match.state, "restart", "play stops for the free kick");
  assert.equal(match.restartInfo?.type, "freekick");
  assert.equal(match.restartInfo?.teamIdx, away.idx, "the defending side takes it");
  assert.equal(match.possessor, null, "the offside man does not get the ball");
  assert.equal(match.stats[0].offsides, 1);
});

test("the same ball to a man level with the line is legal", () => {
  const { match, events, runner } = scenario({ runnerX: 8 });
  assert.equal(events.some((e) => e.type === "offside"), false, "no flag when onside");
  assert.equal(match.possessor, runner, "the receiver keeps the ball");
  assert.equal(match.stats[0].offsides, 0);
});

test("a throw-in cannot put a man offside", () => {
  const { match, events, home, runner } = scenario({ runnerX: 24 });
  events.length = 0;
  match.possessor = null;
  const taker = home.agents.find((a) => a.role === "RB");
  taker.pos.set(2, 0, 33);
  match.restartKick = true; // the state executeRestart puts the engine in
  match.executePass(taker, { mate: runner, dist: 22, risk: 0.1, space: 8, forward: 1, goalDist: 40, score: 2 });
  match.restartKick = false;
  match.takePossession(runner, 6, match.ball);
  assert.equal(events.some((e) => e.type === "offside"), false);
});

test("defenders hold their line instead of chasing into midfield", () => {
  const match = new Match(null, new MatchBall(), { makeRig: stubRig });
  match.startMatch();
  const [home, away] = match.teams;
  const carrier = home.agents.find((a) => a.role === "CM");
  carrier.pos.set(0, 0, 0);
  match.possessor = carrier;
  match.state = "play";
  for (const d of away.agents.filter((a) => ["CB", "RB", "LB"].includes(a.role))) {
    d.pos.set(-14, 0, d.pos.z);
    d.roleRank = 0; // he is nearest to the ball, so he would be the presser
    const target = match.computeTarget(d);
    assert.ok(
      target.x * away.attackDir > -22,
      `defender stayed near his line, got ${(target.x * away.attackDir).toFixed(1)}m`,
    );
  }
});
