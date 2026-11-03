import * as THREE from 'three';
import {
  PITCH,
  TEAMS,
  FORMATION_433,
  FORMATION_442,
  NAMES_HOME,
  NAMES_AWAY,
} from '../config.js';
import { PlayerRig, randomLook } from '../entities/player.js';
import { makeAttributes } from './attributes.js';
import { attributeBias, teamSetup } from './form-profile.js';
import { createTactics, updateTactics, onTurnover, backLineDistance } from './tactics.js';

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const chance = (p) => Math.random() < p;
const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
/** Box-Muller, unit normal. */
function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const GOAL_X = PITCH.halfLength; // 52.5
const HALF_W = PITCH.halfWidth; // 34
const HALF_G = PITCH.goalWidth / 2; // 3.66
const GOAL_H = PITCH.goalHeight; // 2.44
const BOX_X = GOAL_X - PITCH.penaltyDepth; // 36
const BOX_Z = PITCH.penaltyWidth / 2; // 20.16
const SIX_X = GOAL_X - PITCH.sixDepth; // 47
const SIX_Z = PITCH.sixWidth / 2; // 9.16
const PEN_SPOT = GOAL_X - PITCH.penaltySpot; // 41.5

const CARD = { NONE: 0, YELLOW: 1, RED: 2 };

export class Match {
  constructor(scene, ball, options = {}) {
    this.scene = scene;
    this.ball = ball;
    this.onEvent = options.onEvent || (() => {});
    this.onGoal = options.onGoal || (() => {});
    this.onCard = options.onCard || (() => {});
    this.onReset = options.onReset || (() => {});
    this.makeRig = options.makeRig || ((cfg) => new PlayerRig(cfg));

    this.agents = [];
    this.teams = [];
    this.clock = 0;
    this.half = 1;
    this.clockRate = 12;
    this.state = 'warmup';
    this.stateTimer = 0;
    this.pendingKickoff = 0;
    this.possessor = null;
    this.lastTouch = null;
    this.lastTouchTeam = null;
    // What this match is expected to produce, taken from the market and the
    // clubs' own records. Used to keep the football honest, never to dictate a
    // result: a side can still win 4-0, it just cannot run away to ten.
    this.targets = null;
    this.score = [0, 0];
    this.possession = [0, 0];
    this.shots = [0, 0];
    this.humanEnabled = false;
    this.human = null;
    this.input = { x: 0, z: 0, sprint: false, pass: false, shoot: false, tackle: false };
    this.switchCooldown = 0;
    this.excite = 0;
    this.time = 0;
    this.lastScorer = -1;
    this.restartInfo = null;
    this.brainTimer = 0;
    this.lastPossTeam = null;
    this.lastPasser = null;
    this.lastPassTarget = null;
    this.assistCandidate = null;
    this.assistTimer = 0;

    this.stats = [this.blankStats(), this.blankStats()];

    this.buildTeams();
    this.buildOfficials();
    this.resetPositions(null, 0);
  }

  blankStats() {
    return {
      shots: 0, onTarget: 0, saves: 0, fouls: 0, corners: 0, throwIns: 0,
      yellows: 0, reds: 0, passes: 0, passesCompleted: 0, tackles: 0, headers: 0,
      distance: 0, xg: 0,
    };
  }

  // ---------------------------------------------------------------- setup
  buildTeams() {
    const builds = [0.94, 1.02, 0.99, 1.05, 0.97, 0.96, 1.0, 0.98, 0.93, 1.02, 0.95];
    for (let t = 0; t < 2; t++) {
      const cfg = TEAMS[t];
      // The match page supplies a predicted XI, formation and style read from
      // the club's recent matches. Without it the stand-alone game keeps its
      // own squads.
      const setup = teamSetup(t);
      const formation = setup?.slots ?? (t === 0 ? FORMATION_433 : FORMATION_442);
      const names = t === 0 ? NAMES_HOME : NAMES_AWAY;
      const team = {
        idx: t,
        cfg,
        name: setup?.name ?? cfg.name,
        short: setup?.short ?? cfg.short,
        attackDir: cfg.attackDir,
        agents: [],
        formation,
        formationName: setup?.formation ?? cfg.formation,
        profile: setup,
        tactics: createTactics(t, setup?.tactics ?? null, setup?.name ?? cfg.name),
        goalFlash: 0,
      };
      this.teams.push(team);
      const squadQuality = setup?.squadQuality ?? (t === 0 ? 1.01 : 0.995);

      for (let i = 0; i < formation.length; i++) {
        const slot = formation[i];
        const look = randomLook();
        const source = setup?.lineup?.[i] ?? null;
        const number = source?.number ?? i + 1;
        const name = source?.name ?? names[i];
        const attrs = makeAttributes(
          slot.role,
          squadQuality * (source?.quality ?? (0.96 + Math.random() * 0.09)),
          attributeBias(source?.signals),
        );
        const rig = this.makeRig({
          number,
          name: name.split(' ').slice(-1)[0] || name,
          shirt: cfg.primary,
          shorts: cfg.shorts,
          socks: cfg.socks,
          trim: 0xf3f6fb,
          textColor: '#ffffff',
          skin: look.skin,
          hairColor: look.hairColor,
          hairStyle: i === 0 ? 'buzz' : look.hairStyle,
          boot: look.boot,
          height: i === 0 ? 1.91 : 1.7 + Math.random() * 0.22,
          build: builds[i] * (0.96 + Math.random() * 0.1),
        });
        if (this.scene) this.scene.add(rig.root);

        const a = {
          id: `${t}-${i}`,
          teamIdx: t,
          role: slot.role,
          number,
          name,
          rating: source?.averageRating ?? null,
          impact: source?.impact ?? null,
          rig,
          attrs,
          pos: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          facing: 0,
          baseNx: slot.nx,
          baseNz: slot.nz,
          maxSpeed: attrs.maxSpeed,
          accel: attrs.accel,
          // live state
          stamina: 0.92 + Math.random() * 0.08,
          sprinting: false,
          exhausted: false,
          kickCooldown: 0,
          tackleCooldown: 0,
          decisionTimer: Math.random() * 0.25,
          actionTimer: 0,
          celebrate: 0,
          runTimer: Math.random() * 3,
          makingRun: false,
          spTarget: null,
          saveTarget: null,
          dive: null,
          beatenTimer: 0,
          booked: false,
          warnings: 0,
          sentOff: false,
          isHuman: false,
          distance: 0,
          lastPassFrom: null,
          stats: { passes: 0, passesCompleted: 0, shots: 0, goals: 0, tackles: 0, fouls: 0, headers: 0 },
          target: new THREE.Vector3(),
          urgency: 1,
          roleRank: 0,
        };
        team.agents.push(a);
        this.agents.push(a);
      }
    }
    this.human = this.teams[0].agents.find((a) => a.role === 'ST');
  }

  buildOfficials() {
    const ref = this.makeRig({
      number: null,
      name: 'REF',
      shirt: 0x171a1f,
      shorts: 0x171a1f,
      socks: 0x171a1f,
      trim: 0xf2d24a,
      skin: 0xe8b98e,
      hairColor: 0x241a13,
      hairStyle: 'buzz',
      boot: 0x0c0d10,
      height: 1.82,
      build: 0.98,
    });
    if (this.scene) this.scene.add(ref.root);
    this.referee = {
      rig: ref,
      pos: new THREE.Vector3(0, 0, -6),
      vel: new THREE.Vector3(),
      facing: 0,
      maxSpeed: 7,
    };
    this.assistants = [];
    for (const side of [-1, 1]) {
      const rig = this.makeRig({
        number: null,
        name: 'AST',
        shirt: 0xe8c33a,
        shorts: 0x171a1f,
        socks: 0xe8c33a,
        trim: 0x171a1f,
        skin: 0xd8a97d,
        hairColor: 0x3b2a1c,
        hairStyle: 'short',
        boot: 0x0c0d10,
        height: 1.78,
        build: 0.95,
      });
      if (this.scene) this.scene.add(rig.root);
      this.assistants.push({
        rig,
        pos: new THREE.Vector3(0, 0, side * (HALF_W + 1.6)),
        vel: new THREE.Vector3(),
        facing: 0,
        maxSpeed: 7.4,
        side,
      });
    }
  }

  // ---------------------------------------------------------------- maths
  worldFromNorm(team, nx, nz) {
    const dir = team.attackDir;
    const x = dir > 0 ? -GOAL_X + nx * PITCH.length : GOAL_X - nx * PITCH.length;
    const z = dir > 0 ? -HALF_W + nz * PITCH.width : HALF_W - nz * PITCH.width;
    return { x, z };
  }

  ownGoal(team) {
    return new THREE.Vector3(-team.attackDir * GOAL_X, 0, 0);
  }

  oppGoal(team) {
    return new THREE.Vector3(team.attackDir * GOAL_X, 0, 0);
  }

  ballNormX(team) {
    const dir = team.attackDir;
    const bx = this.ball.pos.x;
    return clamp(dir > 0 ? (bx + GOAL_X) / PITCH.length : (GOAL_X - bx) / PITCH.length, 0, 1);
  }

  /** Agents still on the pitch. */
  active(team) {
    return team.agents.filter((a) => !a.sentOff);
  }

  opponentsOf(team) {
    return this.active(this.teams[1 - team.idx]);
  }

  distanceToOwnGoal(a) {
    const g = this.ownGoal(this.teams[a.teamIdx]);
    return Math.hypot(a.pos.x - g.x, a.pos.z);
  }

  inOwnBox(x, z, team) {
    const dir = team.attackDir;
    return x * dir < -BOX_X && Math.abs(z) < BOX_Z;
  }

  inOppBox(x, z, team) {
    const dir = team.attackDir;
    return x * dir > BOX_X && Math.abs(z) < BOX_Z;
  }

  // ---------------------------------------------------------------- state
  resetPositions(kickoffTeam, delay = 0) {
    for (const team of this.teams) {
      for (const a of team.agents) {
        if (a.sentOff) continue;
        const p = this.worldFromNorm(team, a.baseNx, a.baseNz);
        const dir = team.attackDir;
        if (kickoffTeam !== null && team.idx !== kickoffTeam) {
          p.x = dir > 0 ? Math.min(p.x, -2.5) : Math.max(p.x, 2.5);
        }
        a.pos.set(p.x, 0, p.z);
        a.vel.set(0, 0, 0);
        a.facing = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        a.kickCooldown = 0.2;
        a.celebrate = 0;
        a.dive = null;
        a.spTarget = null;
        a.beatenTimer = 0;
        a.makingRun = false;
        a.actionTimer = 0;
        a.target.set(p.x, 0, p.z);
        if (a.rig) {
          a.rig.root.position.set(p.x, 0, p.z);
          a.rig.root.rotation.y = a.facing;
        }
      }
    }
    this.ball.reset(0, 0);
    this.possessor = null;
    this.restartInfo = null;
    this.lastTouch = null;
    this.stateTimer = delay;
  }

  /**
   * Kick the same fixture off again from 0-0. The series runner uses this to
   * play the match out repeatedly and report every scoreline; squads, ratings
   * and tactics stay exactly as they were, only the match itself restarts.
   */
  setTargets(targets) {
    if (!targets) return;
    const clean = (value) => (Number.isFinite(value) && value > 0 ? value : null);
    this.targets = {
      goals: [clean(targets.homeGoals), clean(targets.awayGoals)],
      corners: [clean(targets.homeCorners), clean(targets.awayCorners)],
    };
  }

  /**
   * How willing this side is to score right now. The gate only ever damps: a
   * team ahead of its expectation has to work harder for the next goal, which
   * is what stops one side running up ten, and leaves level or trailing sides
   * exactly as they were.
   */
  scoringGate(teamIdx) {
    const expected = this.targets?.goals?.[teamIdx];
    if (!expected) return 1;
    const played = clamp(this.clock / (95 * 60), 0.08, 1);
    const due = Math.max(0.3, expected * played);
    const ratio = (expected - this.score[teamIdx]) / due;
    return clamp(0.4 + ratio * 0.6, 0.2, 1);
  }

  /**
   * How far behind the afternoon's corner expectation this side is, as a
   * fraction: positive means they are short and blocks are more likely to be
   * stretched behind for a corner rather than cleared.
   */
  cornerShortfall(teamIdx) {
    const target = this.targets?.corners?.[teamIdx];
    if (!target) return 0;
    const played = clamp(this.clock / (95 * 60), 0.05, 1);
    const due = target * played;
    return clamp((due - this.stats[teamIdx].corners) / Math.max(0.8, due), -1, 1);
  }

  /** Whether a save should be pushed behind rather than gathered. */
  cornerParryChance(teamIdx) {
    if (!this.targets?.corners?.[teamIdx]) return 0.28;
    return clamp(0.45 + this.cornerShortfall(teamIdx) * 0.32, 0.1, 0.8);
  }

  /** Whether a block or a defensive touch sends the ball behind for a corner. */
  cornerDeflectionChance(teamIdx) {
    if (!this.targets?.corners?.[teamIdx]) return 0.3;
    return clamp(0.46 + this.cornerShortfall(teamIdx) * 0.34, 0.08, 0.82);
  }

  restartMatch() {
    for (const team of this.teams) {
      // the half-time switch flips attackDir, so put the sides back first
      team.attackDir = team.cfg.attackDir;
      team.tactics = createTactics(team.idx, team.profile?.tactics ?? null, team.name);
      team.goalFlash = 0;
      for (const a of team.agents) {
        a.sentOff = false;
        a.booked = false;
        a.warnings = 0;
        a.celebrate = 0;
        a.distance = 0;
        a.gkTimer = 0;
        a.saveTarget = null;
        a.dive = null;
        a.tackleCooldown = 0;
        a.kickCooldown = 0;
        a.stamina = 0.92 + Math.random() * 0.08;
        a.decisionTimer = Math.random() * 0.25;
        a.runTimer = Math.random() * 3;
        a.makingRun = false;
        a.isHuman = false;
        a.stats = {
          passes: 0, passesCompleted: 0, shots: 0, onTarget: 0, goals: 0, assists: 0,
          tackles: 0, fouls: 0, headers: 0, yellows: 0,
        };
        if (a.rig) a.rig.root.visible = true;
      }
    }
    if (this.human && !this.human.sentOff) this.human.isHuman = this.humanEnabled;

    this.score = [0, 0];
    this.halfTimeScore = [0, 0];
    this.possession = [0, 0];
    this.shots = [0, 0];
    this.stats = [this.blankStats(), this.blankStats()];
    this.excite = 0;
    this.lastScorer = -1;
    this.lastPossTeam = null;
    this.lastPasser = null;
    this.lastPassTarget = null;
    this.pendingPass = null;
    this.assistCandidate = null;
    this.assistTimer = 0;
    this.brainTimer = 0;
    this.penaltyKeeper = null;
    this.restartInfo = null;
    this.switchCooldown = 0;
    this.onReset();
    this.startMatch();
  }

  startMatch() {
    this.state = 'play';
    this.stateTimer = 0;
    this.clock = 0;
    this.half = 1;
    this.resetPositions(0, 0);
    const taker = this.teams[0].agents.find((a) => a.role === 'CM') || this.teams[0].agents[9];
    taker.pos.set(-1.3, 0, 0.5);
    taker.facing = Math.PI / 2;
    this.possessor = taker;
    this.ball.reset(0, 0);
    this.ball.held = true;
    this.ball.lastTouch = taker;
    this.ball.lastTouchTeam = 0;
    this.excite = 0.35;
    this.onEvent({ type: 'kickoff', text: 'KICK OFF · Northgate get us under way' });
  }

  // ---------------------------------------------------------------- main loop
  update(dt) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    this.updateState(dt);

    const live = this.state === 'play' || this.state === 'restart' || this.state === 'goal';
    if (live) {
      this.clock += dt * this.clockRate * (this.state === 'play' ? 1 : 0.12);
      this.checkPhaseEnd();
      this.updateTeamBrain(dt);
      this.updateHumanSelection(dt);

      for (const a of this.agents) this.updateAgent(a, dt);
      if (this.state === 'play') this.resolvePossession(dt);
      this.ball.update(dt);
      if (this.state === 'play') this.checkBounds(dt);
      this.accumulateStats(dt);
    }

    this.updateOfficials(dt);
    this.updateRigs(dt);
    this.excite = Math.max(0, this.excite - dt * 0.55);
    this.assistTimer = Math.max(0, this.assistTimer - dt);
    if (this.assistTimer <= 0) this.assistCandidate = null;
    this.pendingPassTimer = Math.max(0, (this.pendingPassTimer || 0) - dt);
    if (this.pendingPassTimer <= 0) this.pendingPass = null;
  }

  updateState(dt) {
    if (this.stateTimer > 0) {
      this.stateTimer -= dt;
      if (this.stateTimer > 0) return;
      if (this.state === 'goal') {
        const kickoffTeam = this.pendingKickoff;
        this.resetPositions(kickoffTeam, 0);
        this.state = 'play';
        this.onEvent({ type: 'kickoff', text: `${this.teams[kickoffTeam].name} restart` });
      } else if (this.state === 'halftime') {
        this.state = 'play';
        this.onEvent({ type: 'secondhalf', text: 'Second half under way' });
      } else if (this.state === 'restart') {
        this.executeRestart();
      }
    }
  }

  checkPhaseEnd() {
    if (this.state !== 'play') return;
    if (this.half === 1 && this.clock >= 45 * 60) {
      this.clock = 45 * 60;
      this.half = 2;
      for (const team of this.teams) team.attackDir *= -1;
      // a breather at the break
      for (const a of this.agents) a.stamina = clamp(a.stamina + 0.16, 0, 1);
      this.halfTimeScore = [...this.score];
      this.resetPositions(1, 0);
      this.state = 'halftime';
      this.stateTimer = 2.6;
      this.onEvent({ type: 'halftime', text: 'HALF TIME' });
    } else if (this.half === 2 && this.clock >= 90 * 60) {
      this.clock = 90 * 60;
      this.state = 'fulltime';
      this.onEvent({ type: 'fulltime', text: 'FULL TIME' });
      this.onEvent({
        type: 'score',
        text: `${this.teams[0].name} ${this.score[0]} — ${this.score[1]} ${this.teams[1].name}`,
      });
    }
  }

  updateTeamBrain(dt) {
    this.brainTimer -= dt;
    if (this.brainTimer > 0) return;
    this.brainTimer = 0.25;

    for (const team of this.teams) {
      updateTactics(this, team, 0.25);
      const opp = this.teams[1 - team.idx];
      const ours = this.possessor && this.possessor.teamIdx === team.idx;
      const theirs = this.possessor && this.possessor.teamIdx === opp.idx;
      team.tactics.phase = ours ? 'possession' : theirs ? 'out' : 'loose';

      // rank every player by distance to the ball, for pressing duties
      const order = this.active(team)
        .filter((a) => a.role !== 'GK')
        .sort((p, q) => dist2D(p.pos, this.ball.pos) - dist2D(q.pos, this.ball.pos));
      order.forEach((a, i) => { a.roleRank = i; });

      // runners: forwards gamble in behind in short bursts
      for (const a of this.active(team)) {
        if (a.role === 'GK') continue;
        a.runTimer -= 0.25;
        if (a.runTimer <= 0) {
          a.makingRun = !a.makingRun && ownRunnerRole(a);
          a.runTimer = 1.6 + Math.random() * 3.6;
        }
      }

      // possession changed hands?
      if (this.possessor && this.possessor.teamIdx !== this.lastPossTeam) {
        if (this.lastPossTeam !== null) onTurnover(team, this.teams[this.lastPossTeam]);
        this.lastPossTeam = this.possessor.teamIdx;
      }
    }
  }

  accumulateStats(dt) {
    if (this.possessor) this.possession[this.possessor.teamIdx] += dt;
  }

  // ---------------------------------------------------------------- agents
  updateAgent(a, dt) {
    a.kickCooldown = Math.max(0, a.kickCooldown - dt);
    a.tackleCooldown = Math.max(0, a.tackleCooldown - dt);
    a.decisionTimer -= dt;
    a.celebrate = Math.max(0, a.celebrate - dt * 0.55);
    a.beatenTimer = Math.max(0, a.beatenTimer - dt);
    a.actionTimer = Math.max(0, a.actionTimer - dt);
    if (a.sentOff) return;
    if (a.dive) {
      a.dive.t += dt;
      if (a.dive.t > 0.9) a.dive = null;
    }

    const frozen = this.state === 'halftime' || this.state === 'fulltime';
    const isCarrier = this.possessor === a;
    const desired = new THREE.Vector3();
    let urgency = 1;
    let sprint = false;

    if (frozen) {
      desired.set(0, 0, 0);
    } else if (this.state === 'goal') {
      if (a.celebrate > 0 && a.teamIdx === this.lastScorer) {
        const t = this.time * 1.4 + a.baseNz * 6;
        desired.set(Math.cos(t) * 2.4 * this.teams[a.teamIdx].attackDir, 0, Math.sin(t * 1.3) * 2.4);
        sprint = true;
      }
    } else if (this.humanEnabled && a.isHuman) {
      const len = Math.hypot(this.input.x, this.input.z);
      if (len > 0.001) {
        desired.set(this.input.x / len, 0, this.input.z / len);
        sprint = this.input.sprint;
        urgency = sprint ? 1.18 : 1;
        if (isCarrier) desired.multiplyScalar(0.94);
      }
      if (isCarrier && this.state === 'play') {
        if (this.input.shoot) this.executeShot(a, this.humanShotContext(a));
        else if (this.input.pass) this.executePass(a, this.evaluatePasses(a, this.perceive(a))[0], { human: true });
        this.input.pass = false;
        this.input.shoot = false;
      }
      if (this.input.tackle && this.state === 'play') {
        this.input.tackle = false;
        this.humanTackle(a);
      }
    } else {
      const t = this.computeTarget(a);
      urgency = t.urgency || 1;
      const dx = t.x - a.pos.x;
      const dz = t.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) {
        const arrive = d < 3 ? 0.4 + (d / 3) * 0.6 : 1;
        desired.set((dx / d) * arrive, 0, (dz / d) * arrive);
        sprint = urgency > 1.04 && t.sprint !== false;
      }
    }

    // ---- speed with fatigue ----
    // A ninety-minute match has to show on the legs: a fresh player runs at
    // full pace, a half-spent one at ~80%, and an exhausted one below 70% — and
    // an exhausted player can no longer sprint at all.
    const fatigue = 0.62 + a.stamina * 0.38;
    if (a.stamina < 0.3) sprint = false;
    const sprintMul = sprint ? 1.13 : 0.97;
    let speedCap = a.maxSpeed * fatigue * sprintMul * urgency;
    if (a.actionTimer > 0) speedCap *= 0.25;
    const len = desired.length();
    if (len > 0.001) {
      desired.multiplyScalar(speedCap / len);
    }
    a.sprinting = sprint && a.stamina > 0.14;

    // ---- steering ----
    if (!frozen) {
      const steer = a.accel * (a.actionTimer > 0 ? 0.3 : 1);
      a.vel.x += (desired.x - a.vel.x) * Math.min(1, steer * dt * 0.19);
      a.vel.z += (desired.z - a.vel.z) * Math.min(1, steer * dt * 0.19);
    } else {
      a.vel.multiplyScalar(0.9);
    }
    a.pos.x += a.vel.x * dt;
    a.pos.z += a.vel.z * dt;

    // goalkeeper burst when a shot is flying in
    if (a.role === 'GK' && a.saveTarget !== null && a.saveTarget !== undefined && this.state === 'play') {
      const dz = clamp(a.saveTarget, -3.6, 3.6) - a.pos.z;
      const move = Math.sign(dz) * Math.min(Math.abs(dz), (9 + a.attrs.accel * 0.4) * dt);
      a.pos.z += move;
      a.vel.z = move / dt;
    }

    // stay on the pitch
    a.pos.x = clamp(a.pos.x, -GOAL_X + 1.1, GOAL_X - 1.1);
    a.pos.z = clamp(a.pos.z, -HALF_W + 1, HALF_W - 1);

    // ---- facing ----
    const sp = Math.hypot(a.vel.x, a.vel.z);
    let targetFacing = a.facing;
    if (sp > 0.5) {
      targetFacing = Math.atan2(a.vel.x, a.vel.z);
    } else {
      const bp = this.ball.pos;
      targetFacing = Math.atan2(bp.x - a.pos.x, bp.z - a.pos.z);
    }
    a.facing += angleDiff(targetFacing, a.facing) * Math.min(1, dt * 9);

    // ---- separation ----
    for (const other of this.agents) {
      if (other === a || other.sentOff) continue;
      const dx = a.pos.x - other.pos.x;
      const dz = a.pos.z - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 1.4) {
        const push = ((1.4 - d) / 1.4) * 1.7 * dt;
        a.pos.x += (dx / d) * push;
        a.pos.z += (dz / d) * push;
      }
    }

    // ---- fatigue / distance ----
    a.distance += sp * dt;
    this.updateStamina(a, dt, sp);
  }

  updateStamina(a, dt, speed) {
    const work = Math.pow(clamp(speed / 8, 0, 1.4), 2.15);
    const drain = work * 0.0058 * (1.18 - a.attrs.stamina * 0.36);
    // Jogging and standing still actually get the legs back; running does not.
    const recovery = speed < 2.4 ? 0.0055 : speed < 4.5 ? 0.0022 : 0.0006;
    a.stamina = clamp(a.stamina + (recovery - drain) * dt, 0.08, 1);
    a.exhausted = a.stamina < 0.22;
  }

  // ---------------------------------------------------------------- targeting
  computeTarget(a) {
    if (a.sentOff) return { x: a.pos.x, z: a.pos.z, urgency: 0 };
    if (this.state === 'restart') {
      if (a.spTarget) return a.spTarget;
      return this.restartTarget(a);
    }
    if (a.role === 'GK') return this.gkTarget(a);
    if (this.possessor === a) return this.onBallMove(a);

    const team = this.teams[a.teamIdx];
    const hasBall = this.possessor && this.possessor.teamIdx === team.idx;
    if (!this.possessor) {
      // the man the pass is meant for attacks the ball instead of holding shape
      const meant = this.pendingPass && this.pendingPass.to === a;
      if (meant || a.roleRank === 0) {
        const lead = meant ? 0.32 : 0.28;
        const fp = this.ballFuture(lead);
        if (dist2D(a.pos, fp) < 22) {
          return { x: fp.x, z: fp.z, urgency: meant ? 1.16 : 1.1 };
        }
      }
      return this.looseTarget(a);
    }
    return hasBall ? this.attackMove(a) : this.defendMove(a);
  }

  /** Cheap forward prediction of the ball, used to go and meet a pass. */
  ballFuture(t) {
    const p = this.ball.pos.clone();
    const v = this.ball.vel.clone();
    const steps = clamp(Math.ceil(t / 0.08), 1, 12);
    const h = t / steps;
    for (let i = 0; i < steps; i++) {
      v.y -= 9.81 * h;
      v.multiplyScalar(1 - 0.0018 * v.length() * h);
      p.addScaledVector(v, h);
      if (p.y < 0.112) {
        p.y = 0.112;
        v.y = 0;
      }
    }
    return p;
  }

  /** Base formation spot, shifted by the ball and the team's line height. */
  formationAnchor(a, ball) {
    const team = this.teams[a.teamIdx];
    const dir = team.attackDir;
    const bn = this.ballNormX(team);
    const shiftX = (bn - 0.5) * 0.5;
    const nz = clamp(dir > 0 ? (ball.z + HALF_W) / PITCH.width : (HALF_W - ball.z) / PITCH.width, 0, 1);
    const shiftZ = (nz - 0.5) * 0.34;
    const nx = clamp(a.baseNx + shiftX, 0.04, 0.96);
    return this.worldFromNorm(team, nx, clamp(a.baseNz + shiftZ, 0.05, 0.95));
  }

  lastDefenderX(oppTeam, dir) {
    const xs = this.active(oppTeam)
      .filter((a) => a.role !== 'GK')
      .map((a) => a.pos.x * dir)
      .sort((x, y) => y - x);
    const line = xs.length > 1 ? xs[1] : xs[0] || 0;
    return line * dir;
  }

  // ---------------------------------------------------------------- on the ball
  onBallMove(a) {
    const team = this.teams[a.teamIdx];
    const dir = team.attackDir;
    const goal = this.oppGoal(team);
    const t = { x: a.pos.x, z: a.pos.z, urgency: 1 };
    const dGoal = Math.hypot(goal.x - a.pos.x, a.pos.z);

    // who is in the way?
    let nearest = null;
    let nearestD = 14;
    for (const o of this.opponentsOf(team)) {
      const d = dist2D(o.pos, a.pos);
      if (d < nearestD) {
        nearestD = d;
        nearest = o;
      }
    }

    let lateral = 0;
    if (nearest && nearestD < 8) {
      // carry it around the defender, either side, prefer the side with space
      const side = Math.sign(a.pos.z - nearest.pos.z || randn() * 0.4) || 1;
      lateral = side * (1 - nearestD / 8) * 10;
    }

    const toGoalX = (goal.x - a.pos.x) / Math.max(1, dGoal);
    const toGoalZ = -a.pos.z / Math.max(1, dGoal);
    t.x = a.pos.x + toGoalX * 11 + dir * 1.5;
    t.z = a.pos.z + toGoalZ * 6 + lateral;

    // wide players drift toward the box, central players stay central
    if (Math.abs(a.pos.z) > 20 && dGoal < 34) t.z *= 0.92;
    t.x = clamp(t.x, -GOAL_X + 4, GOAL_X - 3);
    t.z = clamp(t.z, -HALF_W + 4, HALF_W - 4);
    t.urgency = dGoal < 45 ? 1.1 : 1;
    if (a.stamina < 0.25) t.urgency *= 0.9;
    if (nearestD < 2.2 && dGoal > 36) {
      // shield it: slow down and keep the body between ball and defender
      t.x = a.pos.x + toGoalX * 2;
      t.z = a.pos.z + toGoalZ * 2;
      t.urgency = 0.55;
    }

    // decision tick
    if (a.decisionTimer <= 0) {
      const reaction = 0.16 + (1 - a.attrs.composure) * 0.16 + (1 - a.stamina) * 0.16;
      a.decisionTimer = reaction + Math.random() * 0.08;
      this.onBallDecision(a, nearestD, dGoal);
    }
    return t;
  }

  // ---------------------------------------------------------------- off the ball
  attackMove(a) {
    const team = this.teams[a.teamIdx];
    const dir = team.attackDir;
    const opp = this.teams[1 - a.teamIdx];
    const ball = this.ball.pos;
    const carrier = this.possessor;
    const base = this.formationAnchor(a, ball);
    const lineX = this.lastDefenderX(opp, dir);
    const t = { x: base.x, z: base.z, urgency: 1 };
    const countering = team.tactics.counter > 0;

    if (a.role === 'ST') {
      const onside = dir > 0 ? Math.min(lineX - 0.8, GOAL_X - 4) : Math.max(lineX + 0.8, -GOAL_X + 4);
      const runner = a.makingRun || countering;
      t.x = runner ? clamp(lineX + dir * 7, -GOAL_X + 6, GOAL_X - 5) : onside;
      t.z = clamp(ball.z * 0.45 + Math.sin(this.time * 0.5 + a.number) * 6, -17, 17);
      t.urgency = runner ? 1.2 : 1.04;
      if (a.stamina < 0.25) t.urgency = Math.min(t.urgency, 1.02);
    } else if (['RW', 'LW', 'RM', 'LM'].includes(a.role)) {
      const side = a.baseNz < 0.5 ? -1 : 1;
      const advance = clamp((this.ballNormX(team) - 0.3) * 30, -8, 16);
      t.x = clamp(base.x + dir * advance, -GOAL_X + 6, GOAL_X - 5);
      // hold width, but tuck in when the ball is on the far side and deep
      const width = HALF_W - 4.5 - (this.ballNormX(team) > 0.75 ? 5 : 0);
      t.z = side * width;
      t.urgency = countering ? 1.18 : 1.02;
      if (Math.abs(ball.z - t.z) < 6 && Math.abs(ball.x - t.x) < 10) t.urgency = 1.12;
    } else if (['CM', 'DM'].includes(a.role)) {
      const aheadOfBall = carrier ? carrier.pos.x + dir * 6 : ball.x + dir * 6;
      const behind = (carrier ? carrier.pos.x : ball.x) - dir * (a.role === 'DM' ? 11 : 7);
      t.x = dir > 0 ? clamp(Math.min(aheadOfBall, Math.max(behind, base.x - 6)), -GOAL_X + 14, GOAL_X - 12)
        : clamp(Math.max(aheadOfBall, Math.min(behind, base.x + 6)), -GOAL_X + 12, GOAL_X - 14);
      t.z = clamp((a.baseNz - 0.5) * 30 + ball.z * 0.2 + Math.sin(this.time * 0.35 + a.number * 2) * 3, -26, 26);
      t.urgency = 1.0;
      if (dist2D(a.pos, ball) < 14) t.urgency = 1.05;
    } else {
      // defenders push up as a unit behind the ball
      const line = clamp(ball.x - dir * 20, -GOAL_X + 14, dir > 0 ? 8 : -8);
      t.x = dir > 0 ? Math.min(base.x + 5, line) : Math.max(base.x - 5, line);
      t.z = base.z;
      t.urgency = 0.9;
    }

    // never crowd the man on the ball
    if (carrier && dist2D(a.pos, carrier.pos) < 4.2) {
      t.x += (a.pos.x - carrier.pos.x) * 0.5;
      t.z += (a.pos.z - carrier.pos.z) * 0.5;
    }
    t.x = clamp(t.x, -GOAL_X + 3, GOAL_X - 3);
    t.z = clamp(t.z, -HALF_W + 2, HALF_W - 2);
    return t;
  }

  defendMove(a) {
    const team = this.teams[a.teamIdx];
    const dir = team.attackDir;
    const opp = this.teams[1 - a.teamIdx];
    const carrier = this.possessor;
    const ball = this.ball.pos;
    const base = this.formationAnchor(a, ball);
    const t = { x: base.x, z: base.z, urgency: 1 };
    const press = team.tactics.press;
    const rank = a.roleRank;
    const ownG = this.ownGoal(team);
    const lineDist = backLineDistance(team, this.ballNormX(team));
    const lineX = ownG.x + dir * lineDist;

    const goalSide = (target, gap) => {
      const vx = ownG.x - target.pos.x;
      const vz = -target.pos.z;
      const len = Math.hypot(vx, vz) || 1;
      return { x: target.pos.x + (vx / len) * gap, z: target.pos.z + (vz / len) * gap };
    };

    // ---- the man on the ball ----
    if (rank === 0 && carrier && press > 0.18) {
      // approach from the goal side so he cannot turn and run
      const spot = goalSide(carrier, 1.15);
      t.x = spot.x;
      t.z = spot.z;
      t.urgency = 1.2 + press * 0.12;
      return this.clampTarget(t);
    }

    // ---- cover / cut a lane ----
    if (rank === 1 && carrier && press > 0.3) {
      const spot = goalSide(carrier, 4.2);
      t.x = spot.x;
      t.z = spot.z;
      t.urgency = 1.08;
      return this.clampTarget(t);
    }
    if (rank === 2 && carrier && press > 0.5) {
      // screen the most dangerous forward option
      const target = this.mostDangerousOption(carrier, opp);
      if (target) {
        t.x = (carrier.pos.x + target.pos.x) / 2;
        t.z = (carrier.pos.z + target.pos.z) / 2;
        t.urgency = 1.04;
        return this.clampTarget(t);
      }
    }

    const isDefender = ['CB', 'RB', 'LB'].includes(a.role);
    if (isDefender) {
      const mark = this.markingAssignment(a, opp, lineX);
      if (mark) {
        const spot = goalSide(mark, 1.7);
        t.x = lerp(lineX, spot.x, 0.75);
        t.z = spot.z;
        t.urgency = 1.02;
      } else {
        t.x = lineX;
        // shift across with the ball, keep the back four compact
        const compact = clamp(a.baseNz * PITCH.width - HALF_W, -26, 26);
        t.z = clamp(compact * 0.82 + ball.z * 0.18, -28, 28);
        t.urgency = 0.94;
      }
      // never let the line drift beyond the ball
      if (dir > 0) t.x = Math.min(t.x, Math.max(ball.x + 2, -GOAL_X + 6));
      else t.x = Math.max(t.x, Math.min(ball.x - 2, GOAL_X - 6));
      return this.clampTarget(t);
    }

    if (['CM', 'DM', 'RM', 'LM', 'RW', 'LW'].includes(a.role)) {
      const row = lineX + dir * (a.role === 'DM' ? 10 : 15);
      t.x = dir > 0 ? Math.min(row, ball.x + dir * 3) : Math.max(row, ball.x + dir * 3);
      t.z = clamp((a.baseNz - 0.5) * 30 + ball.z * 0.32, -28, 28);
      t.urgency = 0.96;
      // nearest midfielders jump out to press if the ball is close
      if (dist2D(a.pos, ball) < 9 + press * 9 && rank < 4) {
        const spot = goalSide(carrier || { pos: ball }, 1.6);
        t.x = spot.x;
        t.z = spot.z;
        t.urgency = 1.12 + press * 0.1;
      }
      return this.clampTarget(t);
    }

    // forwards: stay high as an outlet unless the ball is near
    t.x = dir > 0 ? Math.max(base.x, lineX + dir * 16) : Math.min(base.x, lineX + dir * 16);
    t.z = clamp(ball.z * 0.4, -22, 22);
    t.urgency = dist2D(a.pos, ball) < 12 ? 1.08 : 0.85;
    return this.clampTarget(t);
  }

  clampTarget(t) {
    t.x = clamp(t.x, -GOAL_X + 2.5, GOAL_X - 2.5);
    t.z = clamp(t.z, -HALF_W + 1.8, HALF_W - 1.8);
    return t;
  }

  markingAssignment(a, opp, lineX) {
    let best = null;
    let bestScore = Infinity;
    const dir = this.teams[a.teamIdx].attackDir;
    for (const at of this.active(opp)) {
      if (at.role === 'GK') continue;
      // only mark someone in your zone
      const dz = Math.abs(at.pos.z - a.pos.z);
      if (dz > 13) continue;
      const ahead = (at.pos.x - lineX) * dir;
      if (ahead < -14 || ahead > 26) continue;
      const d = dist2D(at.pos, a.pos) + dz * 0.6;
      if (d < bestScore) {
        bestScore = d;
        best = at;
      }
    }
    return bestScore < 22 ? best : null;
  }

  mostDangerousOption(carrier, oppTeam) {
    let best = null;
    let bestScore = -Infinity;
    const dir = this.teams[carrier.teamIdx].attackDir;
    for (const at of this.active(oppTeam)) {
      if (at.role === 'GK') continue;
      const d = dist2D(at.pos, carrier.pos);
      if (d > 34) continue;
      const goalDist = Math.hypot(dir * GOAL_X - at.pos.x, at.pos.z);
      const score = -goalDist - d * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = at;
      }
    }
    return best;
  }

  looseTarget(a) {
    const team = this.teams[a.teamIdx];
    const ball = this.ball.pos;
    const base = this.formationAnchor(a, ball);
    if (a.roleRank === 0) {
      const lead = Math.min(0.55, dist2D(a.pos, ball) / 26);
      return this.clampTarget({
        x: ball.x + this.ball.vel.x * lead * 0.6,
        z: ball.z + this.ball.vel.z * lead * 0.6,
        urgency: 1.12,
      });
    }
    if (a.roleRank === 1) {
      return this.clampTarget({
        x: ball.x - team.attackDir * 3,
        z: ball.z + Math.sign(a.pos.z - ball.z || 1) * 3,
        urgency: 1.04,
      });
    }
    return this.clampTarget({ x: base.x, z: base.z, urgency: 0.92 });
  }

  // ---------------------------------------------------------------- keeper
  gkTarget(a) {
    const team = this.teams[a.teamIdx];
    const dir = team.attackDir;
    const goal = this.ownGoal(team);
    const ball = this.ball.pos;
    const t = { x: a.pos.x, z: a.pos.z, urgency: 0.8 };

    if (this.possessor === a) return this.gkDistribute(a);

    const toBall = new THREE.Vector3(ball.x - goal.x, 0, ball.z - goal.z);
    const dist = toBall.length();
    toBall.normalize();

    const ourBall = this.possessor && this.possessor.teamIdx === a.teamIdx;
    const looseInBox = !this.possessor && Math.abs(ball.x - goal.x) < 17 && Math.abs(ball.z) < 20;

    if (looseInBox) {
      const near = dist2D(ball, a.pos);
      if (near < 10) {
        return { x: ball.x, z: ball.z, urgency: 1.15 };
      }
    }

    const depth = clamp(dist * 0.1, 0.7, 3.0);
    t.x = goal.x + toBall.x * depth;
    t.z = clamp(ball.z * 0.3, -3.1, 3.1);
    t.urgency = 0.85;
    a.saveTarget = null;

    if (ourBall) {
      t.x = goal.x + dir * 5.5;
      t.z = clamp(ball.z * 0.18, -6, 6);
      t.urgency = 0.7;
    }

    // shot stopping
    const vel = this.ball.vel;
    const speed = Math.hypot(vel.x, vel.z);
    const heading = (goal.x - ball.x) * vel.x > 0;
    if (!this.ball.held && speed > 7 && heading) {
      const timeToLine = Math.abs(goal.x - ball.x) / Math.max(0.5, Math.abs(vel.x));
      const zAtLine = ball.z + vel.z * timeToLine;
      const yAtLine = ball.y + vel.y * timeToLine - 4.9 * timeToLine * timeToLine;
      if (timeToLine < 1.4 && Math.abs(zAtLine) < HALF_G + 1.6 && yAtLine < GOAL_H + 0.5) {
        t.x = goal.x + dir * 0.9;
        t.z = clamp(zAtLine, -3.5, 3.5);
        t.urgency = 1.25;
        const reflexes = 0.55 + a.attrs.composure * 0.5;
        if (timeToLine < reflexes) a.saveTarget = clamp(zAtLine, -3.6, 3.6);
        if (!a.dive && Math.abs(zAtLine - a.pos.z) > 0.7 && timeToLine < 0.7) {
          a.dive = { t: 0, dir: Math.sign(zAtLine - a.pos.z) };
        }
      }
    }
    return t;
  }

  gkDistribute(a) {
    if (!a.gkTimer) a.gkTimer = 0.7 + Math.random() * 0.7;
    a.gkTimer -= 1 / 60;
    if (a.gkTimer > 0) return { x: a.pos.x, z: a.pos.z, urgency: 0.3 };
    a.gkTimer = 0;
    const team = this.teams[a.teamIdx];
    const dir = team.attackDir;
    const opts = this.evaluatePasses(a, this.perceive(a));
    const pressed = this.opponentsOf(team).some((o) => dist2D(o.pos, a.pos) < 12);
    if (opts.length && (!pressed || opts[0].dist < 30) && opts[0].risk < 0.5) {
      this.executePass(a, opts[0], { throw: false });
    } else {
      // launch it long downfield
      const v = new THREE.Vector3(dir, 0, (Math.random() - 0.5) * 0.5).normalize();
      this.ball.kick(v, 27, 0.4, 0);
      this.ball.lastTouch = a;
      this.ball.lastTouchTeam = a.teamIdx;
      this.possessor = null;
      a.kickCooldown = 0.5;
      if (a.rig) a.rig.startAction('shot', 0.5);
    }
    return { x: a.pos.x, z: a.pos.z, urgency: 0.3 };
  }

  /**
   * The shot has reached the line. A keeper who is a stride away from the ball
   * still saves most of it, and even an open corner is roughly a coin flip
   * rather than a certain goal — there is no such thing as a shot that cannot
   * be stopped just because the striker aimed away from him.
   */
  keeperStops(keeper) {
    const b = this.ball.pos;
    const v = this.ball.vel;
    const speed = Math.hypot(v.x, v.y, v.z);
    const lateral = Math.abs(keeper.pos.z - b.z);
    const reach = 0.5 + keeper.attrs.composure * 0.7;
    let p =
      lateral <= reach
        ? 0.84
        : clamp(1.15 - lateral / 5.6, 0, 0.84);
    // Height and power beat him: the top corner is the hardest ball to stop.
    if (b.y > 1.85) p *= 0.74;
    if (b.y > 2.18) p *= 0.5;
    p *= clamp(1.12 - speed / 76, 0.55, 1);
    p *= 0.88 + keeper.attrs.composure * 0.18;
    p *= 0.88 + keeper.stamina * 0.14;
    if (!chance(p)) return false;

    // Some saves are pushed behind instead of gathered, which is where most of
    // a side's corners come from. The rate follows how far behind the market's
    // corner expectation the match is, so a quiet afternoon still produces the
    // five or six corners the clubs actually average.
    const attacking = 1 - keeper.teamIdx;
    if (chance(this.cornerParryChance(attacking))) {
      this.stats[attacking].corners++;
      this.onEvent({
        type: 'save',
        text: `${keeper.name} turns it round the post`,
        team: keeper.teamIdx,
        player: keeper.name,
      });
      this.setRestart(
        'corner',
        attacking,
        Math.sign(b.x) * (GOAL_X - 0.35),
        (b.z >= 0 ? 1 : -1) * (HALF_W - 0.5),
      );
      return true;
    }

    // He gets across and smothers it on the line.
    b.x = Math.sign(b.x) * (GOAL_X - 0.45);
    this.takePossession(keeper, speed, this.ball);
    return true;
  }

  // ---------------------------------------------------------------- perception
  perceive(a) {
    const team = this.teams[a.teamIdx];
    const opps = this.opponentsOf(team);
    const ball = this.ball.pos;
    let nearest = null;
    let nearestD = Infinity;
    let pressure = 0;
    let markers = 0;
    for (const o of opps) {
      const d = dist2D(o.pos, a.pos);
      if (d < nearestD) {
        nearestD = d;
        nearest = o;
      }
      if (d < 8) {
        pressure += (1 - d / 8) * (0.45 + o.attrs.tackling * 0.55);
        markers++;
      }
    }
    return {
      nearest,
      nearestD,
      pressure: clamp(pressure, 0, 1.3),
      markers,
      opps,
      ballDist: dist2D(a.pos, ball),
    };
  }

  // ---------------------------------------------------------------- decisions
  onBallDecision(a, nearestD, dGoal) {
    const team = this.teams[a.teamIdx];
    const ctx = this.perceive(a);
    const passes = this.evaluatePasses(a, ctx);
    const shoot = this.utilityShoot(a, ctx, dGoal);
    const dribble = this.utilityDribble(a, ctx, dGoal);
    const cross = this.utilityCross(a, ctx, dGoal);
    const clear = this.utilityClear(a, ctx, dGoal);

    const options = [{ key: 'dribble', u: dribble }];
    if (passes.length) options.push({ key: 'pass', u: passes[0].score, data: passes[0] });
    if (shoot > 0.02) options.push({ key: 'shoot', u: shoot });
    if (cross) options.push({ key: 'cross', u: cross.score, data: cross });
    if (clear > 0.02) options.push({ key: 'clear', u: clear });

    // noise: hesitation, personality, a little chaos
    const noise = 0.1 + a.attrs.flair * 0.12;
    for (const o of options) o.u += randn() * noise;
    options.sort((p, q) => q.u - p.u);
    const pick = options[0];

    void nearestD;
    if (pick.key === 'shoot') return this.executeShot(a, ctx);
    if (pick.key === 'pass') return this.executePass(a, pick.data);
    if (pick.key === 'cross') return this.executeCross(a, pick.data);
    if (pick.key === 'clear') return this.executeClear(a, ctx);
    return null; // keep dribbling
  }

  /**
   * How open the match is right now. Sides feel each other out, the game
   * loosens before the break, and the last twenty minutes are the ones where
   * tired teams chase it: a real match rarely has its goals shared evenly.
   */
  tempoCurve() {
    const minute = this.clock / 60;
    if (minute < 8) return 0.72;
    if (minute < 20) return 0.9;
    if (minute < 45) return 1;
    if (minute < 62) return 1.02;
    if (minute < 76) return 1.07;
    return 1.12;
  }

  utilityShoot(a, ctx, dGoal) {
    const team = this.teams[a.teamIdx];
    const goal = this.oppGoal(team);
    const angle = Math.atan2(Math.abs(a.pos.z), Math.abs(goal.x - a.pos.x));
    if (dGoal > 36 || angle > 1.0) return 0;
    const at = a.attrs;
    let base;
    if (dGoal < 7) base = 2.6;
    else if (dGoal < 12) base = 2.1;
    else if (dGoal < 18) base = 1.45;
    else if (dGoal < 24) base = 1.0;
    else if (dGoal < 30) base = 0.52;
    else base = 0.16;

    const anglePenalty = clamp(1 - angle * 0.6, 0.2, 1);
    let u = base * anglePenalty * (0.45 + at.shooting * 0.85) * (0.6 + at.composure * 0.55);

    const pressed = clamp(1 - (ctx.nearestD - 1) / 3.2, 0, 1);
    u *= 1 - pressed * 0.45;
    u *= 0.75 + a.stamina * 0.3;

    // the ridiculous long-range attempt
    if (dGoal > 24) {
      u *= 0.45;
      if (at.shooting > 0.76 && at.flair > 0.6) u *= 2.2;
      else if (chance(0.02)) u *= 3;
    }
    return u * this.tempoCurve();
  }

  utilityDribble(a, ctx, dGoal) {
    const team = this.teams[a.teamIdx];
    let u = 0.32 + a.attrs.dribbling * 0.6 + a.attrs.flair * 0.15;
    u -= ctx.pressure * 0.62;
    if (ctx.nearestD > 6) u += 0.18;
    if (this.inOwnBox(a.pos.x, a.pos.z, team)) u -= 0.55;
    if (dGoal < 20) u -= 0.3;
    if (a.stamina < 0.3) u -= 0.18;
    return Math.max(0.02, u);
  }

  utilityClear(a, ctx, dGoal) {
    const team = this.teams[a.teamIdx];
    const inOwnThird = a.pos.x * team.attackDir < -GOAL_X * 0.45;
    if (!inOwnThird) return 0;
    let u = 0.2 + ctx.pressure * 0.85;
    if (this.inOwnBox(a.pos.x, a.pos.z, team)) u += 0.55;
    if (dGoal < 20) u -= 0.2;
    return u;
  }

  utilityCross(a, ctx, dGoal) {
    const team = this.teams[a.teamIdx];
    const wide = Math.abs(a.pos.z) > 16;
    if (!wide || dGoal > 42 || dGoal < 9) return null;
    const targets = this.active(team).filter(
      (m) => m !== a && m.role !== 'GK' && this.inOppBox(m.pos.x, m.pos.z, team)
    );
    if (!targets.length) return null;
    const best = targets.sort((p, q) => q.attrs.aerial - p.attrs.aerial)[0];
    let score = 0.38 + a.attrs.passing * 0.5 + a.attrs.vision * 0.18 + Math.min(4, targets.length) * 0.09;
    score -= ctx.pressure * 0.3;
    return { score, target: best, kind: 'cross' };
  }

  evaluatePasses(a, ctx) {
    const team = this.teams[a.teamIdx];
    const dir = team.attackDir;
    const at = a.attrs;
    const opps = ctx.opps;
    const opts = [];
    const visionRange = 15 + at.vision * 46;

    for (const m of this.active(team)) {
      if (m === a) continue;
      const dx = m.pos.x - a.pos.x;
      const dz = m.pos.z - a.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3.2 || dist > 58) continue;
      if (dist > visionRange) continue; // he simply does not see it
      if (m.role === 'GK' && ctx.pressure < 0.5 && !this.inOwnThird(a, team)) continue;
      const nx = dx / dist;
      const nz = dz / dist;

      // interception risk along the lane
      let risk = 0;
      for (const o of opps) {
        if (o.role === 'GK') continue;
        const px = o.pos.x - a.pos.x;
        const pz = o.pos.z - a.pos.z;
        const proj = px * nx + pz * nz;
        if (proj < 0.4 || proj > dist - 0.3) continue;
        const perp = Math.abs(px * nz - pz * nx);
        const reach = 1.0 + o.attrs.pace * 1.5 + o.attrs.tackling * 0.6;
        if (perp < reach + 1.4) {
          risk += (1 - perp / (reach + 1.4)) * (0.5 + 0.5 * Math.min(1, (proj / dist) * 1.6));
        }
      }
      risk = clamp(risk, 0, 1.6);

      // how open is the receiver?
      let space = 30;
      for (const o of opps) {
        const d = dist2D(o.pos, m.pos);
        if (d < space) space = d;
      }

      const forward = (nx * dir); // -1 .. 1 along the attack direction
      const goalDist = Math.hypot(dir * GOAL_X - m.pos.x, m.pos.z);
      const runner = m.makingRun && forward > 0.2 && space > 3.5;

      let score = 0.33;
      score += Math.max(0, forward) * (0.5 + team.tactics.risk * 0.55);
      score += (1 - Math.min(1, risk)) * 0.62;
      score += Math.min(space, 10) * 0.028;
      score += goalDist < 30 ? 0.12 : 0;
      score -= Math.max(0, dist - 32) * 0.011;
      if (forward < -0.45) score -= 0.16;
      if (m.role === 'GK') score -= 0.45;
      if (runner) score += 0.3 + at.vision * 0.55;
      if (dist < 14 && risk < 0.35) score += 0.14;
      // in the box you shoot, you do not pass sideways
      if (this.inOppBox(a.pos.x, a.pos.z, team)) score -= 0.3;
      if (this.inOppBox(m.pos.x, m.pos.z, team) && dist < 10) score -= 0.15;
      // tired players prefer the safe ball
      if (a.stamina < 0.35 && risk > 0.6) score -= 0.12;
      // vision lets good players find the killer ball
      if (risk > 0.8 && at.vision > 0.75 && chance(0.35)) score += 0.25;

      opts.push({ mate: m, dist, risk, space, forward, goalDist, score, runner });
    }
    opts.sort((p, q) => q.score - p.score);
    return opts;
  }

  inOwnThird(a, team) {
    return a.pos.x * team.attackDir < -GOAL_X * 0.45;
  }

  // ---------------------------------------------------------------- execution
  executePass(a, choice, extra = {}) {
    if (!choice) {
      if (extra.human) {
        const v = new THREE.Vector3(this.teams[a.teamIdx].attackDir, 0, 0);
        this.ball.kick(v, 18, 0.3, 0);
        this.possessor = null;
        a.kickCooldown = 0.4;
        if (a.rig) a.rig.startAction('pass', 0.42);
      }
      return;
    }
    const team = this.teams[a.teamIdx];
    const at = a.attrs;
    const mate = choice.mate;
    const dist = choice.dist;
    const speed = clamp(12 + dist * 0.62, 14, 30);
    // solve for where the receiver can actually meet a ball that is losing
    // speed the whole way, instead of a straight-line lead
    const meet = this.solveMeet(a, mate, speed);
    let tx = meet.x;
    let tz = meet.z;

    // ---- execution error -------------------------------------------------
    const pressure = clamp(choice.risk, 0, 1) * 0.6 + clamp(1 - (this.perceive(a).nearestD - 1) / 3, 0, 1) * 0.5;
    const fatigueErr = 1 + (1 - a.stamina) * 0.8;
    const skillErr = (1 - (at.passing * 0.62 + at.composure * 0.38)) * 1.5 + 0.12;
    const errM = (0.35 + dist * 0.022) * skillErr * (1 + pressure * 0.75) * fatigueErr;
    const ang = Math.atan2(tz - a.pos.z, tx - a.pos.x);
    const perpX = -Math.sin(ang);
    const perpZ = Math.cos(ang);
    const lateral = randn() * errM * 0.55;
    const along = randn() * errM * 0.35;
    tx += perpX * lateral + Math.cos(ang) * along;
    tz += perpZ * lateral + Math.sin(ang) * along;

    const aim = new THREE.Vector3(tx - a.pos.x, 0, tz - a.pos.z).normalize();
    const chip = choice.risk > 0.75 && at.vision > 0.7 && dist > 18;
    const ground = !chip && (dist < 26 || chance(0.65));
    const lift = ground ? 0.05 : clamp(0.09 + dist * 0.0045, 0.09, 0.3);
    const power = ground ? speed : speed * 0.92;
    this.ball.kick(aim, power, lift, (Math.random() - 0.5) * 1.8);
    this.ball.lastTouch = a;
    this.ball.lastTouchTeam = team.idx;
    this.possessor = null;
    a.kickCooldown = 0.32;
    if (a.rig) a.rig.startAction('pass', 0.42);
    a.stats.passes++;
    this.stats[team.idx].passes++;
    this.lastPasser = a;
    this.lastPassTarget = mate;
    this.pendingPass = { from: a, to: mate, team: team.idx };
    this.pendingPassTimer = 4;
    void extra;
  }

  /**
   * Where a pass must be aimed so the receiver meets it, given rolling
   * friction. Iterates a few times; cheap and far more accurate than a
   * linear lead.
   */
  solveMeet(a, mate, speed) {
    const k = 0.3;
    let t = dist2D(a.pos, mate.pos) / Math.max(4, speed);
    let x = mate.pos.x;
    let z = mate.pos.z;
    for (let i = 0; i < 5; i++) {
      x = mate.pos.x + mate.vel.x * t;
      z = mate.pos.z + mate.vel.z * t;
      const need = Math.hypot(x - a.pos.x, z - a.pos.z);
      const reach = (speed / k) * (1 - Math.exp(-k * t));
      t += (need - reach) / Math.max(5, speed * Math.exp(-k * t));
      t = clamp(t, 0.08, 2.0);
    }
    // a receiver who checks his run still has to be able to get there
    return { x, z, t };
  }

  executeShot(a, ctx) {
    const team = this.teams[a.teamIdx];
    const dir = team.attackDir;
    const goal = this.oppGoal(team);
    const at = a.attrs;
    const dist = Math.hypot(goal.x - a.pos.x, goal.z - a.pos.z);

    // the keeper is at the near post: shoot away from him
    const keeper = this.active(this.teams[1 - a.teamIdx]).find((k) => k.role === 'GK');
    const keepZ = keeper ? keeper.pos.z : 0;
    const farSide = -Math.sign(keepZ || randn() * 0.1);
    // placement is not perfect: sometimes he goes for the corner, sometimes
    // he simply hits it hard and hopes
    const placement = 0.25 + Math.random() * 0.95;
    const aimZ = clamp(farSide * (HALF_G + 0.35) * placement, -HALF_G - 0.3, HALF_G + 0.3);
    const high = chance(0.32);
    const aimY = high ? 1.35 + Math.random() * 0.75 : 0.3 + Math.random() * 0.55;

    // accuracy: distance, pressure, technique, fatigue
    const pressure = clamp(1 - (ctx.nearestD - 1) / 3, 0, 1);
    const acc = at.shooting * 0.55 + at.composure * 0.3 + at.flair * 0.15;
    // Real shooting is far wilder than a straight line to the corner: about a
    // third of shots on target, and less than that from range or under
    // pressure. Accuracy here scales the angular spread, so a crowded box and
    // tired legs push shots wide and over rather than into the net.
    const spreadRad =
      (0.128 + (1 - acc) * 0.32) *
      (1 + dist / 42) *
      (1 + pressure * 0.75) *
      (1 + (1 - a.stamina) * 0.65);
    const spreadM = Math.tan(spreadRad) * dist;
    let z0 = aimZ + randn() * spreadM * 0.66;
    let y0 = aimY + randn() * spreadM * 0.4;

    const target = new THREE.Vector3(goal.x + dir * 0.4, Math.max(0.25, y0), z0);
    const v = target.clone().sub(new THREE.Vector3(a.pos.x, this.ball.pos.y, a.pos.z)).normalize();
    const power = clamp(23 + at.shooting * 9 + Math.random() * 3, 20, 34);
    this.ball.kick(v, power, 0, (Math.random() - 0.5) * 1.1);
    this.ball.lastTouch = a;
    this.ball.lastTouchTeam = team.idx;
    this.possessor = null;
    a.kickCooldown = 0.5;
    a.actionTimer = 0.22;
    if (a.rig) a.rig.startAction('shot', 0.55);
    a.stats.shots++;
    this.stats[team.idx].shots++;
    this.shots[team.idx]++;

    // Defensive shape: a defender goal-side of the shooter and close enough to
    // close him down gets in the way. This is what keeps a packed box from
    // turning every attack into a clear sight of goal.
    const opp = this.teams[1 - a.teamIdx];
    const toGoalX = goal.x - a.pos.x;
    const toGoalZ = goal.z - a.pos.z;
    let blocker = null;
    for (const d of this.active(opp)) {
      if (d.role === 'GK' || d.sentOff) continue;
      const dd = dist2D(d.pos, a.pos);
      if (dd > 3.4) continue;
      const inFront = (d.pos.x - a.pos.x) * toGoalX + (d.pos.z - a.pos.z) * toGoalZ > 0;
      if (!inFront) continue;
      const reach = 1 - dd / 3.4;
      const blockP = clamp((0.1 + d.attrs.defending * 0.45) * reach * (1 - dist / 60), 0.02, 0.62);
      if (chance(blockP) && (!blocker || dd < blocker.dd)) blocker = { d, dd };
    }
    if (blocker) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.ball.vel.set(-dir * 0.55, 0.35, side * (0.7 + Math.random() * 0.5)).normalize();
      this.ball.vel.multiplyScalar(7 + Math.random() * 7);
      this.ball.lastTouch = blocker.d;
      this.ball.lastTouchTeam = opp.idx;
      this.stats[opp.idx].blocks = (this.stats[opp.idx].blocks || 0) + 1;
      this.onEvent({ type: 'block', text: `${blocker.d.name} throws himself in the way`, team: opp.idx, player: blocker.d.name });
      return;
    }

    const onTarget = Math.abs(z0) < HALF_G - 0.05 && y0 < GOAL_H;
    if (onTarget) {
      this.stats[team.idx].onTarget++;
      a.stats.onTarget++;
    }
    // crude expected goals, useful for the stats panel
    this.stats[team.idx].xg += clamp(Math.exp(-dist / 11) * (1 - Math.abs(a.pos.z) / 60) * 0.9, 0.02, 0.85);
    this.excite = Math.max(this.excite, 0.3 + (1 - Math.min(1, dist / 34)) * 0.3);
    // A shot has a place as well as a taker: close range, the edge of the box,
    // or a hopeful one from distance. Saying so is what makes a 9m scramble and
    // a 28m strike read differently in the commentary.
    const inBox = this.inOppBox(a.pos.x, a.pos.z, team);
    const range = Math.round(dist);
    const where = inBox
      ? range < 9
        ? 'from close range'
        : 'from inside the box'
      : range >= 25
        ? `lets fly from ${range}m`
        : 'shoots from outside the box';
    this.onEvent({
      type: 'shot',
      text: `${a.name} ${where} for ${team.name}`,
      team: team.idx,
      player: a.name,
      range,
      inBox,
    });
  }

  executeCross(a, cross) {
    const team = this.teams[a.teamIdx];
    const target = cross.target;
    const dir = team.attackDir;
    const goal = this.oppGoal(team);
    const at = a.attrs;
    // aim into the corridor between the six yard box and the penalty spot
    const ty = 1.9;
    const tx = goal.x - dir * (5 + Math.random() * 5);
    const tz = clamp(target.pos.z + randn() * 1.6, -8, 8);
    const dist = Math.hypot(tx - a.pos.x, tz - a.pos.z);
    const err = (1 - at.passing * 0.6) * 2.2 + 0.3;
    const aim = new THREE.Vector3(tx - a.pos.x + randn() * err, 0, tz - a.pos.z + randn() * err).normalize();
    const power = clamp(15 + dist * 0.42, 15, 24);
    // solve a lofted ball that arrives around 1.9m high
    const lift = clamp((ty + 0.55 * 9.81 * Math.pow(dist / power, 2)) / (dist * 1.0), 0.1, 0.55);
    this.ball.kick(aim, power, lift, (Math.random() - 0.5) * 2.6 * (at.foot === 'left' ? -1 : 1));
    this.ball.lastTouch = a;
    this.ball.lastTouchTeam = team.idx;
    this.possessor = null;
    a.kickCooldown = 0.4;
    if (a.rig) a.rig.startAction('pass', 0.5);
    this.stats[team.idx].passes++;
    this.onEvent({ type: 'cross', text: `${a.name} whips it into the box`, team: team.idx });
  }

  executeClear(a, ctx) {
    const team = this.teams[a.teamIdx];
    const dir = team.attackDir;
    const aim = new THREE.Vector3(dir, 0, (Math.random() - 0.5) * 0.9).normalize();
    this.ball.kick(aim, 24 + Math.random() * 6, 0.42, 0);
    this.ball.lastTouch = a;
    this.ball.lastTouchTeam = team.idx;
    this.possessor = null;
    a.kickCooldown = 0.45;
    a.actionTimer = 0.15;
    if (a.rig) a.rig.startAction('shot', 0.45);
    void ctx;
  }

  executeHeader(a, goalward) {
    const team = this.teams[a.teamIdx];
    const dir = team.attackDir;
    a.stats.headers++;
    this.stats[team.idx].headers++;
    if (a.rig) a.rig.startAction('header', 0.42);
    if (goalward) {
      const goal = this.oppGoal(team);
      const dist = Math.hypot(goal.x - a.pos.x, a.pos.z);
      const aimZ = clamp(-Math.sign(a.pos.z || 1) * (HALF_G - 0.7) + randn() * 1.2, -HALF_G + 0.4, HALF_G - 0.4);
      const v = new THREE.Vector3(goal.x + dir * 0.3 - a.pos.x, 0, aimZ - a.pos.z).normalize();
      const power = clamp(11 + a.attrs.aerial * 9, 10, 21);
      const lift = clamp(0.06 - dist * 0.002, -0.02, 0.12);
      this.ball.kick(v, power, lift, 0);
      a.stats.shots++;
      this.stats[team.idx].shots++;
      this.stats[team.idx].onTarget++;
      a.stats.onTarget++;
      this.stats[team.idx].xg += 0.12;
      this.onEvent({ type: 'shot', text: `${a.name} gets his head to it!`, team: team.idx });
    } else {
      const v = new THREE.Vector3(dir, 0, (Math.random() - 0.5) * 0.8).normalize();
      this.ball.kick(v, 20 + a.attrs.aerial * 8, 0.34, 0);
    }
    this.ball.lastTouch = a;
    this.ball.lastTouchTeam = team.idx;
    this.ball.held = false;
    this.possessor = null;
    a.kickCooldown = 0.4;
  }

  humanShotContext(a) {
    return this.perceive(a);
  }

  humanTackle(a) {
    if (this.possessor && this.possessor.teamIdx !== a.teamIdx) {
      const d = dist2D(this.possessor.pos, a.pos);
      if (d < 7) this.tryTackle(a, this.possessor, true);
    }
  }

  // ---------------------------------------------------------------- duels
  tryTackle(o, a, human = false) {
    if (o.tackleCooldown > 0 || o.actionTimer > 0) return false;
    if (dist2D(o.pos, a.pos) > 2.4) return false;
    o.tackleCooldown = human ? 0.9 : 1.7;
    o.actionTimer = 0.3;
    o.kickCooldown = 0;
    if (o.rig) o.rig.startAction('tackle', 0.55);
    const team = this.teams[o.teamIdx];

    const toCarrier = Math.atan2(a.pos.x - o.pos.x, a.pos.z - o.pos.z);
    const fromBehind = Math.cos(angleDiff(toCarrier, a.facing)) > 0.3;

    let pWin = 0.36 + (o.attrs.tackling - a.attrs.dribbling) * 0.6;
    pWin -= a.attrs.flair * 0.06;
    pWin *= 0.72 + o.stamina * 0.34;
    pWin *= human ? 1.1 : 1;
    pWin = clamp(pWin, 0.1, 0.74);

    if (chance(pWin)) {
      const knock = new THREE.Vector3(o.pos.x - a.pos.x, 0, o.pos.z - a.pos.z).normalize();
      const into = new THREE.Vector3(team.attackDir, 0, (Math.random() - 0.5) * 0.6).normalize();
      const v = knock.multiplyScalar(0.4).add(into.multiplyScalar(0.8)).normalize();
      this.ball.held = false;
      this.ball.kick(v, 4 + Math.random() * 5, 0.1, 0);
      this.ball.lastTouch = o;
      this.ball.lastTouchTeam = o.teamIdx;
      this.possessor = null;
      o.kickCooldown = 0.18;
      a.kickCooldown = 0.55;
      a.beatenTimer = 0.6;
      o.stats.tackles++;
      this.stats[o.teamIdx].tackles++;
      this.onEvent({ type: 'tackle', text: `${o.name} wins it back`, team: o.teamIdx, player: o.name });
      return true;
    }

    // missed the ball: did he take the man?
    const inBox = this.inOwnBox(a.pos.x, a.pos.z, this.teams[o.teamIdx]);
    let pFoul = 0.15 + o.attrs.aggression * 0.32 - o.attrs.discipline * 0.2;
    if (fromBehind) pFoul += 0.14;
    if (a.sprinting) pFoul += 0.05;
    if (this.lastPasser === a && this.pendingPass) pFoul += 0.05;
    pFoul = clamp(pFoul, 0.06, 0.68);
    if (chance(pFoul)) {
      this.commitFoul(o, a, { fromBehind, inBox });
      return true;
    }
    // beaten
    o.beatenTimer = 0.75;
    a.beatenTimer = 0;
    if (chance(0.35)) {
      this.onEvent({ type: 'skill', text: `${a.name} skips past ${o.name}`, team: a.teamIdx, player: a.name });
    }
    return false;
  }

  commitFoul(offender, victim, info = {}) {
    const oTeam = this.teams[offender.teamIdx];
    const vTeam = this.teams[victim.teamIdx];
    this.stats[oTeam.idx].fouls++;
    offender.stats.fouls++;
    this.possessor = null;
    this.ball.vel.set(0, 0, 0);

    const inBox = info.inBox ?? this.inOwnBox(victim.pos.x, victim.pos.z, oTeam);
    const dirToGoal = Math.hypot(GOAL_X - victim.pos.x * vTeam.attackDir, victim.pos.z);
    const through = dirToGoal < 26 && this.attackerClear(victim, oTeam);
    const dangerous = victim.pos.x * vTeam.attackDir > 6 && through;

    let severity = 0.16 + offender.attrs.aggression * 0.34;
    if (info.fromBehind) severity += 0.22;
    if (info.inBox || inBox) severity += 0.2;
    if (dangerous) severity += 0.32;
    if (inBox && dirToGoal < 20) severity += 0.5;
    if (this.lastPasser === victim && this.pendingPass) severity += 0.1;
    severity -= offender.attrs.discipline * 0.14;
    if (offender.booked) severity += 0.08;
    if (offender.stats.fouls > 2) severity += 0.18; // persistent infringement

    offender.tackleCooldown = 1.8;
    victim.actionTimer = 0.5;
    if (victim.rig) victim.rig.startAction('appeal', 0.9);
    this.onEvent({
      type: 'foul',
      text: `Foul by ${offender.name} on ${victim.name}`,
      team: oTeam.idx,
      player: offender.name,
    });

    if (severity > 1.5) {
      this.showCard(offender, 'red', 'serious foul play');
    } else if (severity > 0.46 && chance(0.62)) {
      this.showCard(offender, 'yellow', dangerous ? 'stopping a promising attack' : 'reckless challenge');
    } else if (chance(0.45)) {
      offender.warnings++;
      this.onEvent({
        type: 'warning',
        text: `Referee has a word with ${offender.name}`,
        team: oTeam.idx,
        player: offender.name,
      });
    }

    // the free kick / penalty
    if (inBox) {
      this.setRestart('penalty', vTeam.idx, vTeam.attackDir * PEN_SPOT, 0);
    } else {
      this.setRestart('freekick', vTeam.idx, clamp(victim.pos.x, -GOAL_X + 3, GOAL_X - 3), clamp(victim.pos.z, -HALF_W + 2, HALF_W - 2));
    }
  }

  attackerClear(victim, defendingTeam) {
    let nearest = 30;
    for (const d of this.active(defendingTeam)) {
      if (d.role === 'GK') continue;
      nearest = Math.min(nearest, dist2D(d.pos, victim.pos));
    }
    return nearest > 6;
  }

  showCard(player, color, reason) {
    const team = this.teams[player.teamIdx];
    if (color === 'yellow') {
      if (player.booked) {
        this.sendOff(player, 'second yellow');
        return;
      }
      player.booked = true;
      this.stats[team.idx].yellows++;
      player.stats.yellows = (player.stats.yellows || 0) + 1;
      this.onEvent({
        type: 'yellow',
        card: 'yellow',
        text: `YELLOW CARD · ${player.name} (${team.short}) — ${reason}`,
        team: team.idx,
        player: player.name,
        number: player.number,
      });
      this.onCard?.({ color: 'yellow', player: player.name, number: player.number, team: team.idx, reason });
    } else {
      this.stats[team.idx].reds++;
      this.onEvent({
        type: 'red',
        card: 'red',
        text: `RED CARD · ${player.name} (${team.short}) — ${reason}`,
        team: team.idx,
        player: player.name,
        number: player.number,
      });
      this.onCard?.({ color: 'red', player: player.name, number: player.number, team: team.idx, reason });
      this.sendOff(player, reason);
    }
  }

  sendOff(player, reason) {
    player.sentOff = true;
    player.booked = true;
    if (player.rig) {
      player.rig.root.visible = false;
    }
    player.pos.set(0, 0, HALF_W + 6);
    if (this.human === player) {
      const rest = this.active(this.teams[0]).filter((a) => a.role !== 'GK');
      if (rest.length) this.human = rest.sort((p, q) => dist2D(p.pos, this.ball.pos) - dist2D(q.pos, this.ball.pos))[0];
      if (this.human) this.human.isHuman = this.humanEnabled;
    }
    this.onEvent({
      type: 'numbers',
      text: `${this.teams[player.teamIdx].name} down to ${this.active(this.teams[player.teamIdx]).length} men`,
      team: player.teamIdx,
      reason,
    });
  }

  // ---------------------------------------------------------------- possession
  resolvePossession(dt) {
    const ball = this.ball;
    const b = ball.pos;

    if (this.possessor) {
      const a = this.possessor;
      if (a.sentOff) {
        this.possessor = null;
        return;
      }
      const speed = Math.hypot(a.vel.x, a.vel.z);
      const ahead = 0.4 + speed * 0.055;
      const tx = a.pos.x + Math.sin(a.facing) * ahead;
      const tz = a.pos.z + Math.cos(a.facing) * ahead;
      ball.pos.x += (tx - ball.pos.x) * Math.min(1, dt * 15);
      ball.pos.z += (tz - ball.pos.z) * Math.min(1, dt * 15);
      ball.pos.y = ball.radius;
      ball.vel.set(a.vel.x, 0, a.vel.z);
      ball.held = true;

      // challenges
      for (const o of this.opponentsOf(this.teams[a.teamIdx])) {
        if (o.sentOff) continue;
        if (o.beatenTimer > 0 || o.tackleCooldown > 0 || o.actionTimer > 0) continue;
        if (dist2D(o.pos, a.pos) < 1.5) {
          this.tryTackle(o, a);
          return;
        }
      }
      return;
    }

    ball.held = false;

    // aerial contest first
    if (b.y > 1.55 && b.y < 3.1 && this.tryAerial()) return;
    if (b.y > 2.3) return;

    let best = null;
    let bestScore = Infinity;
    for (const a of this.agents) {
      if (a.sentOff || a.kickCooldown > 0) continue;
      const d = dist2D(a.pos, b);
      const reach = a.role === 'GK' && b.y < 2.4 ? 3.0 : 1.4;
      if (d < reach) {
        const score = d - (a.role === 'GK' ? 0.9 : 0) - a.attrs.composure * 0.1;
        if (score < bestScore) {
          bestScore = score;
          best = a;
        }
      }
    }

    if (best) {
      const speed = Math.hypot(ball.vel.x, ball.vel.z);
      // keepers use their hands: if they get there, they usually keep it out
      const keeper = best.role === 'GK' && b.y < 2.4;
      const control = keeper
        ? clamp(1.75 - speed / 55, 0.62, 1) * (0.8 + best.attrs.composure * 0.35)
        : clamp(1.45 - speed / 30, 0.42, 1) * (0.78 + best.attrs.composure * 0.3);
      if (chance(control)) {
        this.takePossession(best, speed, ball);
      } else {
        best.kickCooldown = 0.45;
        ball.vel.multiplyScalar(0.35);
      }
    }
  }

  takePossession(a, ballSpeed, ball) {
    const prev = this.pendingPass;
    this.possessor = a;
    ball.held = true;
    ball.spin.set(0, 0, 0);
    ball.lastTouch = a;
    ball.lastTouchTeam = a.teamIdx;
    a.decisionTimer = 0.08;
    a.gkTimer = 0;
    if (a.role === 'GK' && ballSpeed > 9) {
      this.stats[1 - a.teamIdx].saves++;
      this.onEvent({ type: 'save', text: `Save! ${a.name} keeps it out`, team: a.teamIdx, player: a.name });
    }
    if (ballSpeed > 12 && a.rig) a.rig.startAction('header', 0.3);
    if (prev && prev.to === a) {
      prev.from.stats.passesCompleted++;
      this.stats[prev.team].passesCompleted++;
      this.assistCandidate = prev.from;
      this.assistTimer = 10;
      a.lastPassFrom = prev.from;
    } else if (prev && prev.team !== a.teamIdx) {
      this.onEvent({ type: 'interception', text: `${a.name} cuts it out`, team: a.teamIdx });
    }
    this.pendingPass = null;
  }

  tryAerial() {
    const b = this.ball.pos;
    let attacker = null;
    let defender = null;
    let aScore = -Infinity;
    let dScore = -Infinity;
    for (const a of this.agents) {
      if (a.sentOff || a.role === 'GK' || a.kickCooldown > 0) continue;
      const d = dist2D(a.pos, b);
      if (d > 2.3) continue;
      const reach = 1.3 + a.attrs.aerial * 0.95 + (a.attrs.heightCm - 175) * 0.012;
      if (b.y > reach) continue;
      const s = a.attrs.aerial + randn() * 0.12 - d * 0.08;
      const team = this.teams[a.teamIdx];
      const dir = team.attackDir;
      const attacking = this.ball.lastTouchTeam !== null && this.ball.lastTouchTeam !== a.teamIdx;
      if (attacking) {
        if (s > aScore) { aScore = s; attacker = a; }
      } else if (s > dScore) { dScore = s; defender = a; }
      void dir;
    }
    const winner = aScore > dScore ? attacker : defender;
    if (!winner) return false;
    const team = this.teams[winner.teamIdx];
    const inBox = this.inOppBox(winner.pos.x, winner.pos.z, team);
    const contest = aScore > -Infinity && dScore > -Infinity;
    const won = !contest || (aScore > dScore ? chance(0.5 + (aScore - dScore) * 1.6) : chance(0.5 + (dScore - aScore) * 1.6));
    const actual = won ? winner : (winner === attacker ? defender : attacker) || winner;
    this.executeHeader(actual, this.inOppBox(actual.pos.x, actual.pos.z, this.teams[actual.teamIdx]) && inBox);
    return true;
  }

  // ---------------------------------------------------------------- rules
  checkBounds(dt) {
    void dt;
    const b = this.ball.pos;

    if (Math.abs(b.x) > GOAL_X + 0.12 && Math.abs(b.z) < HALF_G && b.y < GOAL_H) {
      const scoringTeam = b.x > 0
        ? this.teams.find((t) => t.attackDir > 0)
        : this.teams.find((t) => t.attackDir < 0);
      const keeper = this.active(this.teams[1 - scoringTeam.idx]).find((k) => k.role === 'GK');
      if (keeper && this.keeperStops(keeper)) return;
      // Ahead of what the market and their own record expect, a side runs into a
      // keeper having the game of his life rather than a ten-goal afternoon.
      if (keeper && !chance(this.scoringGate(scoringTeam.idx))) {
        b.x = Math.sign(b.x) * (GOAL_X - 0.45);
        this.takePossession(keeper, 8, this.ball);
        return;
      }
      this.scoreGoal(scoringTeam);
      return;
    }

    // The engine writes the last touch onto the ball, so reading a match-level
    // field here left it permanently null: every throw-in went to the same side
    // and no side ever won a corner off a defender.
    const lastTouchTeam = this.ball.lastTouchTeam;

    if (Math.abs(b.z) > HALF_W + 0.25) {
      const teamIdx = lastTouchTeam === 0 ? 1 : 0;
      this.stats[teamIdx].throwIns++;
      const side = Math.sign(b.z);
      this.setRestart('throw', teamIdx, clamp(b.x, -GOAL_X + 4, GOAL_X - 4), side * (HALF_W - 0.4));
      return;
    }

    if (Math.abs(b.x) > GOAL_X + 0.25) {
      const lastTeam = lastTouchTeam ?? 0;
      const defendingTeam = b.x > 0
        ? this.teams.find((t) => t.attackDir < 0)
        : this.teams.find((t) => t.attackDir > 0);
      if (lastTeam === defendingTeam.idx) {
        const attackingTeam = 1 - defendingTeam.idx;
        this.stats[attackingTeam].corners++;
        const z = Math.abs(b.z) < HALF_G ? HALF_G + 2 : Math.sign(b.z) * (HALF_W - 0.4);
        this.setRestart('corner', attackingTeam, Math.sign(b.x) * (GOAL_X - 0.35), z);
      } else {
        // A shot or cross that a defender stretches to is often put behind
        // rather than allowed to run dead: that is the bulk of a side's corners.
        const attacking = 1 - defendingTeam.idx;
        if (chance(this.cornerDeflectionChance(attacking))) {
          this.stats[attacking].corners++;
          const z = Math.abs(b.z) < HALF_G ? HALF_G + 2 : Math.sign(b.z) * (HALF_W - 0.4);
          this.setRestart('corner', attacking, Math.sign(b.x) * (GOAL_X - 0.35), z);
          return;
        }
        this.setRestart('goalkick', defendingTeam.idx, defendingTeam.attackDir * (GOAL_X - 5.5), (Math.random() - 0.5) * 8);
      }
    }
  }

  setRestart(type, teamIdx, x, z) {
    this.state = 'restart';
    // dead-ball time: everyone has to walk into position before it is taken
    this.stateTimer = type === 'penalty' ? 3.0 : type === 'corner' ? 4.6 : type === 'freekick' ? 3.0 : type === 'goalkick' ? 1.6 : 1.7;
    this.restartInfo = { type, teamIdx, x, z };
    this.possessor = null;
    this.pendingPass = null;
    for (const a of this.agents) a.spTarget = null;
    this.ball.reset(clamp(x, -GOAL_X + 0.6, GOAL_X - 0.6), clamp(z, -HALF_W + 0.4, HALF_W - 0.4));
    this.ball.lastTouch = null;
    this.ball.lastTouchTeam = null;
    this.prepareSetPiece(this.restartInfo);

    const labels = { throw: 'Throw-in', corner: 'Corner', goalkick: 'Goal kick', freekick: 'Free kick', penalty: 'PENALTY' };
    this.onEvent({ type: 'restart', text: `${labels[type]} · ${this.teams[teamIdx].name}`, team: teamIdx });
    if (type === 'penalty') this.onEvent({ type: 'penalty', text: 'PENALTY!', team: teamIdx });
  }

  prepareSetPiece(info) {
    const att = this.teams[info.teamIdx];
    const def = this.teams[1 - info.teamIdx];
    const dir = att.attackDir;
    const goal = this.oppGoal(att);
    const ballPos = this.ball.pos;

    if (info.type === 'penalty') {
      const takers = this.active(att).filter((a) => a.role !== 'GK')
        .sort((p, q) => q.attrs.shooting - p.attrs.shooting);
      const taker = takers[0];
      const gk = this.active(def).find((a) => a.role === 'GK');
      for (const a of this.agents) {
        if (a.sentOff) continue;
        if (a === taker) {
          a.spTarget = { x: PEN_SPOT * dir - dir * 2.2, z: 0, urgency: 1 };
        } else if (a === gk) {
          a.spTarget = { x: goal.x - dir * 0.6, z: 0, urgency: 1 };
        } else {
          a.spTarget = {
            x: -dir * 30 + (Math.random() - 0.5) * 12,
            z: clamp((Math.random() - 0.5) * 40, -26, 26),
            urgency: 0.9,
          };
        }
      }
      info.taker = taker;
      this.penaltyKeeper = gk;
      return;
    }

    if (info.type === 'corner') {
      const attackDir = dir;
      const outs = this.active(att).filter((a) => a.role !== 'GK');
      const taker = outs.filter((a) => a.role !== 'ST').sort((p, q) => q.attrs.passing - p.attrs.passing)[0] || outs[0];
      const boxMen = outs.filter((a) => a !== taker).sort((p, q) => q.attrs.aerial - p.attrs.aerial).slice(0, 5);
      // taker at the flag
      taker.spTarget = { x: info.x - dir * 0.9, z: info.z - Math.sign(info.z) * 0.9, urgency: 1.05 };
      // attackers in the six yard / penalty spot corridor
      const slots = [-6, -2, 2, 6, 0];
      boxMen.forEach((a, i) => {
        a.spTarget = {
          x: goal.x - dir * (4.5 + Math.random() * 5.5),
          z: slots[i] + (Math.random() - 0.5) * 1.6,
          urgency: 1.08,
        };
      });
      const restAtt = outs.filter((a) => a !== taker && !boxMen.includes(a));
      restAtt.forEach((a, i) => {
        a.spTarget = {
          x: goal.x - dir * (17 + i * 3),
          z: (i % 2 ? 1 : -1) * (12 + Math.random() * 8),
          urgency: 0.95,
        };
      });
      // defenders mark up
      const defOuts = this.active(def).filter((a) => a.role !== 'GK');
      const sortedDef = defOuts.slice().sort((p, q) => q.attrs.aerial - p.attrs.aerial);
      const markers = sortedDef.slice(0, boxMen.length);
      markers.forEach((d, i) => {
        const at = boxMen[i];
        d.spTarget = {
          x: at.spTarget.x - attackDir * 1.1,
          z: at.spTarget.z + (Math.random() - 0.5) * 0.8,
          urgency: 1.05,
        };
      });
      const post = sortedDef.slice(boxMen.length, boxMen.length + 2);
      post.forEach((d, i) => {
        d.spTarget = { x: goal.x - attackDir * 0.5, z: i === 0 ? -HALF_G + 0.4 : HALF_G - 0.4, urgency: 1.02 };
      });
      const restDef = sortedDef.slice(boxMen.length + 2);
      restDef.forEach((d, i) => {
        d.spTarget = {
          x: goal.x - attackDir * (17 + (i % 3) * 4),
          z: (i % 2 ? 1 : -1) * (7 + Math.random() * 10),
          urgency: 0.95,
        };
      });
      const gk = this.active(def).find((a) => a.role === 'GK');
      if (gk) gk.spTarget = { x: goal.x - attackDir * 0.9, z: 0, urgency: 1 };
      info.taker = taker;
      info.boxMen = boxMen;
      return;
    }

    if (info.type === 'freekick') {
      const dist = Math.hypot(goal.x - ballPos.x, ballPos.z);
      const central = Math.abs(ballPos.z) < 14;
      const direct = dist < 30 && central;
      const outs = this.active(att).filter((a) => a.role !== 'GK');
      const taker = direct
        ? outs.slice().sort((p, q) => q.attrs.shooting - p.attrs.shooting)[0]
        : outs.slice().sort((p, q) => q.attrs.passing - p.attrs.passing)[0];
      info.taker = taker;
      info.direct = direct;
      taker.spTarget = { x: ballPos.x - dir * 0.7, z: ballPos.z - 0.5, urgency: 1.05 };
      const rest = outs.filter((a) => a !== taker);
      const boxRunners = rest.slice().sort((p, q) => q.attrs.aerial - p.attrs.aerial).slice(0, 4);
      boxRunners.forEach((a, i) => {
        a.spTarget = {
          x: goal.x - dir * (8 + Math.random() * 6),
          z: [-8, -3, 3, 8][i] + (Math.random() - 0.5) * 2,
          urgency: 1.05,
        };
      });
      rest.filter((a) => !boxRunners.includes(a)).forEach((a, i) => {
        a.spTarget = { x: ballPos.x - dir * (12 + i * 4), z: clamp((i % 2 ? 1 : -1) * (10 + i * 4), -26, 26), urgency: 0.9 };
      });
      // defensive wall
      const wallDist = 9.15;
      const toGoal = new THREE.Vector3(goal.x - ballPos.x, 0, -ballPos.z).normalize();
      const defOuts = this.active(def).filter((a) => a.role !== 'GK');
      if (direct) {
        const wallCount = 3;
        const perp = new THREE.Vector3(-toGoal.z, 0, toGoal.x);
        for (let i = 0; i < wallCount && i < defOuts.length; i++) {
          const offset = (i - (wallCount - 1) / 2) * 0.75;
          const d = defOuts[i];
          d.spTarget = {
            x: ballPos.x + toGoal.x * wallDist + perp.x * offset,
            z: ballPos.z + toGoal.z * wallDist + perp.z * offset,
            urgency: 1.1,
          };
        }
      }
      defOuts.forEach((d, i) => {
        if (d.spTarget) return;
        d.spTarget = {
          x: goal.x - dir * (10 + (i % 4) * 6),
          z: (i % 2 ? 1 : -1) * (6 + ((i * 7) % 14)),
          urgency: 1.0,
        };
      });
      const gk = this.active(def).find((a) => a.role === 'GK');
      if (gk) gk.spTarget = { x: goal.x - dir * 1.2, z: clamp(ballPos.z * 0.25, -2, 2), urgency: 1 };
      return;
    }

    if (info.type === 'throw') {
      const outs = this.active(att).filter((a) => a.role !== 'GK');
      const taker = outs.slice().sort((p, q) => dist2D(p.pos, ballPos) - dist2D(q.pos, ballPos))[0];
      info.taker = taker;
      taker.spTarget = { x: ballPos.x, z: ballPos.z - Math.sign(info.z) * 0.7, urgency: 1 };
      outs.filter((a) => a !== taker).forEach((a, i) => {
        const fwd = 6 + (i % 4) * 5;
        a.spTarget = {
          x: ballPos.x + dir * fwd * (i % 3 === 0 ? 1 : -0.2),
          z: info.z - Math.sign(info.z) * (4 + (i % 3) * 5),
          urgency: 0.95,
        };
      });
      this.active(def).forEach((a, i) => {
        a.spTarget = {
          x: ballPos.x + dir * (5 + (i % 4) * 5),
          z: info.z - Math.sign(info.z) * (3 + (i % 3) * 4),
          urgency: 0.95,
        };
      });
      return;
    }

    // goal kick
    const gk = this.active(att).find((a) => a.role === 'GK');
    info.taker = gk;
    if (gk) gk.spTarget = { x: ballPos.x - dir * 0.5, z: ballPos.z, urgency: 0.9 };
    this.active(att).filter((a) => a.role !== 'GK').forEach((a, i) => {
      a.spTarget = {
        x: -dir * (0 + (i % 4) * 8) + GOAL_X * dir * 0.05,
        z: (i % 2 ? 1 : -1) * (8 + ((i * 9) % 22)),
        urgency: 0.9,
      };
    });
  }

  restartTarget(a) {
    if (a.role === 'GK') return { x: a.pos.x, z: a.pos.z, urgency: 0.4 };
    const base = this.formationAnchor(a, this.ball.pos);
    return this.clampTarget({ x: base.x, z: base.z, urgency: 0.9 });
  }

  executeRestart() {
    const info = this.restartInfo;
    this.state = 'play';
    this.restartInfo = null;
    if (!info) return;
    const team = this.teams[info.teamIdx];
    const taker = info.taker && !info.taker.sentOff ? info.taker : null;
    for (const a of this.agents) a.spTarget = null;
    if (!taker) return;

    // put the taker on the ball
    const bp = this.ball.pos;
    taker.pos.set(bp.x - Math.sin(taker.facing) * 0.9, 0, bp.z - Math.cos(taker.facing) * 0.9);
    taker.facing = Math.atan2(bp.x - taker.pos.x, bp.z - taker.pos.z);
    taker.kickCooldown = 0;

    if (info.type === 'corner') {
      const goal = this.oppGoal(team);
      const targetMan = (info.boxMen || []).slice().sort((p, q) => q.attrs.aerial - p.attrs.aerial)[0];
      const tx = targetMan ? targetMan.pos.x + (Math.random() - 0.5) * 2 : goal.x - team.attackDir * 7;
      const tz = targetMan ? targetMan.pos.z + (Math.random() - 0.5) * 2 : 0;
      const dist = Math.hypot(tx - bp.x, tz - bp.z);
      const aim = new THREE.Vector3(tx - bp.x, 0, tz - bp.z).normalize();
      const power = clamp(14 + dist * 0.5, 16, 25);
      const lift = clamp((2.0 + 0.5 * 9.81 * Math.pow(dist / power, 2)) / Math.max(1, dist), 0.14, 0.62);
      this.ball.kick(aim, power, lift, (Math.random() - 0.5) * 3.2);
      taker.stats.passes++;
      this.stats[team.idx].passes++;
      this.onEvent({ type: 'cross', text: `${taker.name} swings the corner in`, team: team.idx });
    } else if (info.type === 'penalty') {
      const gk = this.penaltyKeeper;
      const dir = team.attackDir;
      const aimZ = (Math.random() - 0.5) * 2 * (HALF_G - 0.6);
      const aimY = 0.5 + Math.random() * 1.1;
      const goal = this.oppGoal(team);
      const v = new THREE.Vector3(goal.x + dir * 0.4 - bp.x, aimY - 0.11, aimZ - bp.z).normalize();
      this.ball.kick(v, 26, 0, 0);
      taker.stats.shots++;
      taker.stats.onTarget++;
      this.stats[team.idx].shots++;
      this.stats[team.idx].onTarget++;
      this.shots[team.idx]++;
      if (gk && Math.random() < 0.78) {
        // the keeper guesses right sometimes
        const guess = Math.sign(aimZ || 1) * (Math.random() < 0.55 ? -1 : 1);
        gk.dive = { t: 0, dir: guess };
        gk.saveTarget = clamp(aimZ * (Math.random() < 0.25 ? 1 : -0.3), -3.6, 3.6);
      }
      this.onEvent({ type: 'shot', text: `${taker.name} steps up...`, team: team.idx });
    } else if (info.type === 'freekick' && info.direct) {
      const goal = this.oppGoal(team);
      const dist = Math.hypot(goal.x - bp.x, bp.z);
      const shootPower = clamp(24 + taker.attrs.shooting * 8, 22, 33);
      const aimZ = clamp((Math.random() - 0.5) * 2 * (HALF_G - 0.5), -HALF_G + 0.4, HALF_G - 0.4);
      const aimY = 1.2 + Math.random() * 0.9;
      const vy = (aimY - 0.11 + 0.5 * 9.81 * Math.pow(dist / shootPower, 2)) / (dist / shootPower);
      const v = new THREE.Vector3(goal.x - bp.x, 0, aimZ - bp.z).normalize();
      this.ball.kick(v, shootPower, clamp(vy / shootPower, 0, 0.9), (Math.random() - 0.5) * 2.4);
      taker.stats.shots++;
      this.stats[team.idx].shots++;
      this.shots[team.idx]++;
      this.onEvent({ type: 'shot', text: `${taker.name} goes for goal from the free kick`, team: team.idx });
      // did it beat the wall?
      const wallDist = 9.15;
      const tWall = wallDist / shootPower;
      const yWall = 0.11 + vy * tWall - 4.9 * tWall * tWall;
      if (yWall < 1.95 && Math.random() < 0.7) {
        this.onEvent({ type: 'blocked', text: 'The wall blocks it!', team: 1 - team.idx });
      }
    } else if (info.type === 'goalkick') {
      const opts = this.evaluatePasses(taker, this.perceive(taker));
      const pressed = this.opponentsOf(team).some((o) => dist2D(o.pos, taker.pos) < 20);
      if (opts.length && !pressed && opts[0].risk < 0.5) this.executePass(taker, opts[0]);
      else {
        const v = new THREE.Vector3(team.attackDir, 0, (Math.random() - 0.5) * 0.4).normalize();
        this.ball.kick(v, 28, 0.42, 0);
        this.ball.lastTouch = taker;
        this.ball.lastTouchTeam = team.idx;
        if (taker.rig) taker.rig.startAction('shot', 0.5);
      }
    } else if (info.type === 'throw') {
      const opts = this.evaluatePasses(taker, this.perceive(taker));
      const pickOpt = opts.find((o) => o.dist < 26) || opts[0];
      if (pickOpt) {
        const mate = pickOpt.mate;
        const aim = new THREE.Vector3(mate.pos.x - bp.x, 0, mate.pos.z - bp.z).normalize();
        this.ball.kick(aim, clamp(9 + pickOpt.dist * 0.4, 10, 20), 0.3, 0);
        this.ball.lastTouch = taker;
        this.ball.lastTouchTeam = team.idx;
        taker.stats.passes++;
        this.stats[team.idx].passes++;
      } else {
        const aim = new THREE.Vector3(team.attackDir, 0, 0).normalize();
        this.ball.kick(aim, 12, 0.35, 0);
        this.ball.lastTouch = taker;
        this.ball.lastTouchTeam = team.idx;
      }
      if (taker.rig) taker.rig.startAction('throw', 0.55);
    } else {
      const opts = this.evaluatePasses(taker, this.perceive(taker));
      if (opts.length) this.executePass(taker, opts[0]);
    }
  }

  scoreGoal(team) {
    const scorer = this.ball.lastTouch && this.ball.lastTouch.teamIdx === team.idx
      ? this.ball.lastTouch
      : this.active(team).find((a) => a.role === 'ST') || this.active(team)[0];
    this.score[team.idx]++;
    this.lastScorer = team.idx;
    scorer.stats.goals++;
    this.state = 'goal';
    this.stateTimer = 4.6;
    this.pendingKickoff = 1 - team.idx;
    this.excite = 1;
    this.possessor = null;
    this.ball.vel.multiplyScalar(0.06);
    this.ball.vel.y = 0;

    for (const a of this.agents) {
      a.celebrate = a.teamIdx === team.idx ? 1 : 0;
      a.vel.multiplyScalar(0.3);
    }    const assist = this.assistCandidate && this.assistTimer > 0 && this.assistCandidate.teamIdx === team.idx && this.assistCandidate !== scorer
      ? this.assistCandidate
      : null;
    if (assist) assist.stats.assists = (assist.stats.assists || 0) + 1;
    this.onEvent({
      type: 'goal',
      text: `GOAL! ${scorer.name} — ${team.name}${assist ? ` (assist ${assist.name})` : ''}`,
      team: team.idx,
      scorer: scorer.name,
      number: scorer.number,
    });
    this.onGoal({
      team: team.idx,
      scorer: scorer.name,
      number: scorer.number,
      assist: assist ? assist.name : null,
      minute: Math.round(this.clock / 60),
      score: [...this.score],
    });
    this.pendingPass = null;
    this.assistCandidate = null;
  }

  // ---------------------------------------------------------------- officials
  updateOfficials(dt) {
    const b = this.ball.pos;
    const refTarget = new THREE.Vector3(b.x - 11, 0, clamp(b.z * 0.45 - 6, -22, 22));
    const move = (o, target, dt2, maxSpeed) => {
      const dx = target.x - o.pos.x;
      const dz = target.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.2) {
        const speed = Math.min(maxSpeed, d * 1.6);
        o.vel.x += ((dx / d) * speed - o.vel.x) * Math.min(1, dt2 * 6);
        o.vel.z += ((dz / d) * speed - o.vel.z) * Math.min(1, dt2 * 6);
      } else {
        o.vel.multiplyScalar(0.85);
      }
      o.pos.x = clamp(o.pos.x + o.vel.x * dt2, -GOAL_X + 2, GOAL_X - 2);
      o.pos.z = clamp(o.pos.z + o.vel.z * dt2, -HALF_W - 1.5, HALF_W + 1.5);
      const sp = Math.hypot(o.vel.x, o.vel.z);
      if (sp > 0.5) o.facing = Math.atan2(o.vel.x, o.vel.z);
      else o.facing = Math.atan2(b.x - o.pos.x, b.z - o.pos.z);
      o.rig.root.position.set(o.pos.x, 0, o.pos.z);
      o.rig.root.rotation.y = o.facing;
      o.rig.update(dt2, { speed: sp, lookAt: null, sprint: sp > 5.4 });
    };
    move(this.referee, refTarget, dt, 6.4);
    for (const as of this.assistants) {
      const t = new THREE.Vector3(clamp(b.x, -GOAL_X + 4, GOAL_X - 4), 0, as.side * (HALF_W + 1.4));
      move(as, t, dt, 7);
    }
  }

  updateHumanSelection(dt) {
    this.switchCooldown = Math.max(0, this.switchCooldown - dt);
    if (!this.humanEnabled || !this.human) return;
    if (this.switchCooldown > 0) return;
    const mine = this.human;
    if (mine.sentOff) {
      this.switchCooldown = 0.5;
    } else if (this.possessor === mine) return;
    const ball = this.ball.pos;
    const dMine = dist2D(mine.pos, ball);
    let best = null;
    let bestD = Infinity;
    for (const a of this.active(this.teams[0])) {
      if (a.role === 'GK') continue;
      const d = dist2D(a.pos, ball);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (best && best !== mine && bestD < dMine - 4) {
      mine.isHuman = false;
      this.human = best;
      best.isHuman = true;
      this.switchCooldown = 1.1;
    }
  }

  updateRigs(dt) {
    const bp = this.ball.pos;
    for (const a of this.agents) {
      if (a.sentOff) continue;
      const speed = Math.hypot(a.vel.x, a.vel.z);
      const rig = a.rig;
      rig.root.position.set(a.pos.x, rig.root.position.y, a.pos.z);
      rig.root.rotation.y = a.facing;
      const toBall = Math.atan2(bp.x - a.pos.x, bp.z - a.pos.z);
      const local = angleDiff(toBall, a.facing);
      rig.update(dt, {
        speed,
        sprint: a.sprinting,
        stamina: a.stamina,
        lookAt: {
          yaw: clamp(local, -0.8, 0.8),
          pitch: clamp((bp.y - 1.4) * 0.15, -0.3, 0.3),
        },
        celebrate: a.celebrate,
        dive: a.dive,
      });
    }
  }

  // ---------------------------------------------------------------- helpers for UI
  get possessionPct() {
    const total = this.possession[0] + this.possession[1] || 1;
    return [
      Math.round((this.possession[0] / total) * 100),
      Math.round((this.possession[1] / total) * 100),
    ];
  }

  clockText() {
    const total = Math.floor(this.clock);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  setHuman(enabled) {
    this.humanEnabled = enabled;
    for (const a of this.agents) a.isHuman = false;
    if (enabled) {
      if (!this.human || this.human.sentOff) {
        this.human = this.active(this.teams[0]).find((a) => a.role === 'ST') || this.active(this.teams[0])[0];
      }
      if (this.human) {
        this.human.isHuman = true;
        this.human.celebrate = 1;
      }
    }
  }
}

// forwards and wingers are the ones who gamble in behind
function ownRunnerRole(a) {
  return ['ST', 'RW', 'LW', 'RM', 'LM', 'CM'].includes(a.role) && Math.random() < 0.55;
}

