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
const { PITCH } = await import("../src/sim3d/config.js");

const GOAL_X = PITCH.halfLength;
const GOAL_HALF_WIDTH = PITCH.goalWidth / 2;

const stubRig = () => ({
  root: { position: new THREE.Vector3(), rotation: { y: 0 } },
  update() {},
  startAction() {},
});

/**
 * A ball flying at the away goal from `distance` metres out, with the keeper on
 * his line at `keeperZ`. Nobody else is anywhere near it, so whatever happens
 * is the keeper's doing.
 */
function fireShot({ distance = 8, z = 0.8, keeperZ = 0, speed = 30, steps = 120, stopWhen }) {
  const match = new Match(null, new MatchBall(), { makeRig: stubRig });
  match.startMatch();
  const [home, away] = match.teams;
  const keeper = away.agents.find((a) => a.role === "GK");
  const shooter = home.agents.find((a) => a.role === "ST");

  for (const a of match.agents) {
    a.pos.set(0, 0, a === keeper ? keeperZ : 30);
    a.vel.set(0, 0, 0);
  }
  keeper.pos.set(GOAL_X - 1.5, 0, keeperZ);
  shooter.pos.set(GOAL_X - distance, 0, z);
  // The taker has just struck it: executeShot puts him on a cooldown, and
  // without one he simply controls his own shot off the boot.
  shooter.kickCooldown = 0.5;
  shooter.actionTimer = 0.22;

  match.state = "play";
  match.possessor = null;
  match.ball.pos.set(GOAL_X - distance, 0.11, z);
  match.ball.vel.set(speed, 0, 0);
  match.ball.lastTouch = shooter;
  match.ball.lastTouchTeam = 0;
  match.ball.attemptLive = true;

  let saveAttempts = 0;
  const realStops = match.keeperStops.bind(match);
  match.keeperStops = (k) => {
    saveAttempts += 1;
    return realStops(k);
  };

  // Where the ball was the first time the keeper had it: at the line is a save,
  // metres out is the in-flight vacuum this test exists to catch.
  let keeperClaimAt = null;
  for (let step = 0; step < steps; step += 1) {
    match.update(1 / 60);
    if (keeperClaimAt === null && match.possessor === keeper) keeperClaimAt = match.ball.pos.x;
    if (match.state !== "play" || match.score[0] > 0) break;
    if (stopWhen?.(match)) break;
  }

  return { match, keeper, shooter, saveAttempts, keeperClaimAt };
}

test("a ball aimed inside the frame is recognised as a shot on goal", () => {
  const { match, keeper } = fireShot({ distance: 20, z: 2, keeperZ: 0, steps: 0 });
  assert.equal(match.ballOnGoal(keeper), true, "straight at the goal, inside the frame");
  // Same keeper, but the ball is travelling away from his goal.
  match.ball.vel.set(-20, 0, 0);
  assert.equal(match.ballOnGoal(keeper), false, "a ball leaving the box is not a shot on goal");
});

test("one shot is one save attempt and one shot on target", () => {
  const { match, saveAttempts } = fireShot({ distance: 9, z: 0.5, keeperZ: 0, speed: 30 });
  assert.ok(
    saveAttempts <= 1,
    `the keeper got ${saveAttempts} rolls at the same shot; a save must be decided once`,
  );
  assert.equal(match.stats[0].shots, 0, "the shot was fired by hand, not by the engine");
  assert.ok(match.stats[0].onTarget <= 1, `on target counted ${match.stats[0].onTarget} times for one ball`);
});

test("the keeper does not gather a goal-bound shot in flight", () => {
  const { match, keeper, keeperClaimAt } = fireShot({ distance: 12, z: 1.2, keeperZ: 0, speed: 32 });
  assert.ok(
    keeperClaimAt === null || keeperClaimAt > GOAL_X - 0.6,
    `the keeper gathered the ball at x=${keeperClaimAt === null ? "never" : keeperClaimAt.toFixed(1)}, ` +
      `which is ${keeperClaimAt === null ? 0 : (GOAL_X - keeperClaimAt).toFixed(1)}m in front of his line`,
  );
  assert.ok(Number.isFinite(keeper.pos.x), "keeper state stayed valid");
});

test("placement decides it: a ball into the far corner beats the keeper more often", () => {
  let nearGoals = 0;
  let farGoals = 0;
  const rounds = 60;
  for (let index = 0; index < rounds; index += 1) {
    if (fireShot({ distance: 10, z: 0.2, keeperZ: 0, speed: 30 }).match.score[0] > 0) nearGoals += 1;
    if (
      fireShot({ distance: 10, z: GOAL_HALF_WIDTH - 0.5, keeperZ: -2, speed: 30 }).match.score[0] > 0
    ) {
      farGoals += 1;
    }
  }
  assert.ok(
    farGoals > nearGoals,
    `expected the far corner to beat the keeper more often (near ${nearGoals}, far ${farGoals})`,
  );
  assert.ok(farGoals < rounds, "even a good chance is not a certain goal");
});
