// A match played by the Open Football engine, replayed on this pitch.
//
// The engine (github.com/ZOXEXIVO/open-football) records where all twenty-two
// players and the ball were, every 400 ms of match time. This class walks that
// recording instead of simulating anything: it exposes the same surface the
// procedural `Match` does — teams, agents, score, stats, clock, update — so the
// stadium, camera, HUD and audio driving it cannot tell the difference.
import * as THREE from 'three';
import { PlayerRig, randomLook } from '../entities/player.js';
import { TEAMS } from '../config.js';
import { makeAttributes } from './attributes.js';
import { sampleAt, toPitch } from './replay-track.js';

/** A 90-minute match at 1x takes about nine minutes of wall clock. */
const CLOCK_RATE = 10;
const HALF_TIME_SECONDS = 45 * 60;

/** Engine roles to the app's own, which is what the attribute curves read. */
const APP_ROLE = {
  Goalkeeper: 'GK',
  DefenderLeft: 'LB',
  DefenderCenterLeft: 'CB',
  DefenderCenterRight: 'CB',
  DefenderRight: 'RB',
  DefensiveMidfielder: 'DM',
  MidfielderLeft: 'LM',
  MidfielderCenterLeft: 'CM',
  MidfielderCenter: 'CM',
  MidfielderCenterRight: 'CM',
  MidfielderRight: 'RM',
  AttackingMidfielderLeft: 'LW',
  AttackingMidfielderCenter: 'CM',
  AttackingMidfielderRight: 'RW',
  Striker: 'ST',
  ForwardCenter: 'ST',
  ForwardLeft: 'LW',
  ForwardRight: 'RW',
};

const BUILD = [0.94, 1.02, 0.99, 1.05, 0.97, 0.96, 1.0, 0.98, 0.93, 1.02, 0.95];

export class MatchReplay {
  constructor(scene, ball, options = {}) {
    this.scene = scene;
    // `ball` — not `ballEntity` — is the name the camera, HUD and audio read off
    // a match; this class answers to both so nothing outside has to care.
    this.ball = ball;
    this.ballEntity = ball;
    this.replay = options.replay;
    this.onEvent = options.onEvent || (() => {});
    this.onGoal = options.onGoal || (() => {});
    this.onCard = options.onCard || (() => {});
    this.onReset = options.onReset || (() => {});
    this.makeRig = options.makeRig || ((cfg) => new PlayerRig(cfg));

    this.state = 'warmup';
    this.clock = 0;
    this.humanEnabled = false;
    this.human = null;
    this.input = { x: 0, z: 0, sprint: false, pass: false, shoot: false, tackle: false };
    this.excite = 0;
    this.score = [0, 0];
    this.halfTimeScore = [0, 0];
    this.targets = null;
    this.halfTimeFired = false;

    this.agents = [];
    this.teams = [];
    this.goals = [];
    this.substitutions = [];
    this.ballTrack = [];
    this.ballCursor = { index: 0 };
    this.ballPosition = new THREE.Vector3();
    this.nextGoal = 0;
    this.nextSub = 0;
    this.durationMs = this.replay?.durationMs || 5_580_000;

    const stats = this.replay?.stats || {};
    const home = stats.home || {};
    const away = stats.away || {};
    this.finalStats = [
      { shots: home.shots ?? 0, onTarget: home.onTarget ?? 0, fouls: 0, corners: 0 },
      { shots: away.shots ?? 0, onTarget: away.onTarget ?? 0, fouls: 0, corners: 0 },
    ];
    this.stats = this.finalStats.map((line) => ({ ...line, shots: 0, onTarget: 0 }));
    const possession = [home.possession ?? 50, away.possession ?? 50];
    this.possessionPct = possession;

    this.build();
  }

  build() {
    const replay = this.replay;
    if (!replay) return;

    this.ballTrack = replay.ball || [];

    // A goal is one entry in the engine's list; its assist is another, so only
    // the goals themselves count towards the score.
    this.goals = (replay.goals || [])
      .filter((goal) => (goal.stat_type ?? 'Goal') === 'Goal' && !goal.is_auto_goal)
      .map((goal) => ({
        time: goal.time,
        playerId: goal.player_id,
        side: Math.floor(goal.player_id / 1000) === 1 ? 0 : 1,
      }))
      .sort((a, b) => a.time - b.time);

    this.substitutions = [...(replay.substitutions || [])].sort((a, b) => a.t - b.t);

    for (let t = 0; t < 2; t += 1) {
      const cfg = TEAMS[t];
      const name = t === 0 ? replay.teams?.home : replay.teams?.away;
      const team = {
        idx: t,
        cfg,
        name: name || cfg.name,
        short: (name || cfg.short).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(),
        attackDir: cfg.attackDir,
        agents: [],
        formationName: '',
        tactics: { label: t === 0 ? 'OPEN FOOTBALL' : 'OPEN FOOTBALL' },
        goalFlash: 0,
      };
      this.teams.push(team);
    }

    const roster = Object.entries(replay.players || {}).map(([id, player]) => ({
      ...player,
      id: Number(id),
    }));

    let starter = [0, 0];
    let bench = [0, 0];
    for (const player of roster) {
      const side = Math.floor(player.id / 1000) === 1 ? 0 : 1;
      const team = this.teams[side];
      const config = team.cfg;
      const look = randomLook();
      const role = APP_ROLE[player.role] ?? 'CM';
      const index = player.sub ? bench[side]++ : starter[side]++;
      const rig = this.makeRig({
        number: player.shirt,
        name: (player.name || '').split(' ').slice(-1)[0] || player.name,
        shirt: config.primary,
        shorts: config.shorts,
        socks: config.socks,
        trim: 0xf3f6fb,
        textColor: '#ffffff',
        skin: look.skin,
        hairColor: look.hairColor,
        hairStyle: role === 'GK' ? 'buzz' : look.hairStyle,
        boot: look.boot,
        height: role === 'GK' ? 1.91 : 1.7 + Math.random() * 0.22,
        build: BUILD[index % BUILD.length] * (0.96 + Math.random() * 0.1),
      });
      rig.root.visible = !player.sub;
      if (this.scene) this.scene.add(rig.root);

      const attrs = makeAttributes(role, 1);
      const agent = {
        id: `${side}-${index}`,
        playerId: player.id,
        teamIdx: side,
        role,
        number: player.shirt,
        name: player.name,
        rig,
        attrs,
        pos: new THREE.Vector3(),
        facing: side === 0 ? Math.PI / 2 : -Math.PI / 2,
        speed: 0,
        onPitch: !player.sub,
        stamina: 0.9,
        booked: false,
        sentOff: false,
        isHuman: false,
        stats: { goals: 0, assists: 0, onTarget: 0 },
        track: replay.tracks?.[player.id] ?? null,
        cursor: { index: 0 },
        lastPos: new THREE.Vector3(),
        hasLast: false,
      };
      team.agents.push(agent);
      this.agents.push(agent);
    }

    this.human = this.teams[0].agents.find((agent) => agent.role === 'ST') || this.teams[0].agents[0];
    if (this.human) this.human.isHuman = false;
    this.placeAt(0);
  }

  clockText() {
    const total = Math.floor(this.clock);
    const minutes = Math.floor(total / 60);
    const seconds = Math.floor(total % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  setTargets(targets) {
    // The match is already played; there is nothing left to steer towards.
    this.targets = targets;
  }

  setHuman(enabled) {
    this.humanEnabled = enabled;
    this.input.enabled = enabled;
  }

  startMatch() {
    this.state = 'play';
    this.excite = 0.35;
  }

  restartMatch() {
    this.clock = 0;
    this.score = [0, 0];
    this.halfTimeScore = [0, 0];
    this.halfTimeFired = false;
    this.nextGoal = 0;
    this.nextSub = 0;
    this.state = 'play';
    this.ballCursor.index = 0;
    this.stats = this.finalStats.map((line) => ({ ...line, shots: 0, onTarget: 0 }));
    for (const agent of this.agents) {
      agent.cursor.index = 0;
      agent.hasLast = false;
      agent.stats = { goals: 0, assists: 0, onTarget: 0 };
    }
    this.placeAt(0);
    this.onReset();
  }

  /** Where everyone stood on the pitch at a moment of the recording. */
  placeAt(milliseconds) {
    for (const agent of this.agents) {
      const sample = sampleAt(agent.track, milliseconds, agent.cursor);
      if (!sample) continue;
      toPitch(sample, agent.pos);
      agent.rig.root.position.set(agent.pos.x, 0, agent.pos.z);
      agent.lastPos.copy(agent.pos);
      agent.hasLast = true;
    }
    const ballSample = sampleAt(this.ballTrack, milliseconds, this.ballCursor);
    if (ballSample) {
      toPitch(ballSample, this.ballPosition);
      this.ballPosition.y = Math.max(0.12, ballSample[3] / 100);
      this.applyBall();
    }
  }

  applyBall() {
    const ball = this.ballEntity;
    if (!ball) return;
    if (ball.pos) ball.pos.copy(this.ballPosition);
    if (ball.mesh) ball.mesh.position.copy(this.ballPosition);
  }

  update(dt) {
    const live = this.state === 'play';
    if (live) {
      this.clock += dt * CLOCK_RATE;
      const milliseconds = Math.min(this.clock * 1000, this.durationMs);

      for (const agent of this.agents) {
        if (!agent.onPitch) continue;
        const sample = sampleAt(agent.track, milliseconds, agent.cursor);
        if (!sample) continue;
        toPitch(sample, agent.pos);
        if (agent.hasLast && dt > 0) {
          const moved = Math.hypot(agent.pos.x - agent.lastPos.x, agent.pos.z - agent.lastPos.z);
          // Gait only: the replay owns the position, so this is what the walk
          // cycle is told, not where anyone ends up.
          agent.speed = Math.min(9, moved / dt);
          if (moved > 0.02) {
            const turn = Math.atan2(agent.pos.x - agent.lastPos.x, agent.pos.z - agent.lastPos.z);
            let delta = turn - agent.facing;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            agent.facing += delta * Math.min(1, dt * 8);
          }
        }
        agent.lastPos.copy(agent.pos);
        agent.hasLast = true;
        agent.rig.root.position.set(agent.pos.x, 0, agent.pos.z);
        agent.rig.root.rotation.y = agent.facing;
        agent.rig.update(dt, { speed: agent.speed, stamina: agent.stamina });
      }

      const ballSample = sampleAt(this.ballTrack, milliseconds, this.ballCursor);
      if (ballSample) {
        toPitch(ballSample, this.ballPosition);
        this.ballPosition.y = Math.max(0.12, ballSample[3] / 100);
        this.applyBall();
      }

      const progress = this.durationMs > 0 ? milliseconds / this.durationMs : 1;
      this.stats = this.finalStats.map((line) => ({
        ...line,
        shots: Math.round(line.shots * progress),
        onTarget: Math.round(line.onTarget * progress),
      }));

      this.fireGoals(milliseconds);
      this.fireSubstitutions(milliseconds);

      if (!this.halfTimeFired && this.clock >= HALF_TIME_SECONDS) {
        this.halfTimeFired = true;
        this.halfTimeScore = [...this.score];
        this.onEvent({ type: 'halftime', minute: 45, text: 'HALF TIME' });
      }

      if (milliseconds >= this.durationMs) {
        this.state = 'fulltime';
        if (!this.halfTimeScore.some(Boolean) && this.score.some(Boolean)) {
          this.halfTimeScore = [...this.score];
        }
        this.onEvent({ type: 'fulltime', text: 'FULL TIME' });
      }
    }

    this.excite = Math.max(0, this.excite - dt * 0.55);
    for (const team of this.teams) team.goalFlash = Math.max(0, team.goalFlash - dt * 1.6);
    if (this.state === 'fulltime') {
      for (const agent of this.agents) {
        agent.speed = 0;
        agent.rig.update(dt, { speed: 0, stamina: agent.stamina });
      }
    }
  }

  fireGoals(milliseconds) {
    while (this.nextGoal < this.goals.length && this.goals[this.nextGoal].time <= milliseconds) {
      const goal = this.goals[this.nextGoal++];
      const agent = this.agents.find((candidate) => candidate.playerId === goal.playerId);
      this.score[goal.side] += 1;
      this.teams[goal.side].goalFlash = 1;
      this.excite = 1;
      if (agent) {
        agent.stats.goals += 1;
        agent.rig.startAction('celebrate', 3);
      }
      const minute = Math.floor(goal.time / 60_000);
      const scorer = agent?.name ?? 'Unknown';
      this.onGoal({
        team: goal.side,
        scorer,
        number: agent?.number ?? 0,
        minute,
        score: [this.score[0], this.score[1]],
      });
      this.onEvent({
        type: 'goal',
        team: goal.side,
        minute,
        text: `GOAL · ${minute}' · ${scorer} ${this.score[0]}–${this.score[1]}`,
      });
    }
  }

  fireSubstitutions(milliseconds) {
    while (this.nextSub < this.substitutions.length && this.substitutions[this.nextSub].t <= milliseconds) {
      const change = this.substitutions[this.nextSub++];
      const off = this.agents.find((agent) => agent.playerId === change.out);
      const on = this.agents.find((agent) => agent.playerId === change.in);
      if (on) {
        on.onPitch = true;
        on.rig.root.visible = true;
        on.hasLast = false;
        on.cursor.index = 0;
      }
      if (off) {
        off.onPitch = false;
        off.rig.root.visible = false;
      }
      const team = Math.floor(change.out / 1000) === 1 ? 0 : 1;
      this.onEvent({
        type: 'sub',
        team,
        minute: Math.floor(change.t / 60_000),
        text: `SUB · ${on?.name ?? ''} on for ${off?.name ?? ''}`,
      });
    }
  }
}
