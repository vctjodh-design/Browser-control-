// Headless audit of the 3D match engine: runs a full ninety minutes with no
// renderer and reports what the football actually looked like — passes,
// backwards passes, keeper involvement, where the ball spent its time and how
// many bodies were in the box. Used to tune the AI instead of eyeballing it.
//
//   node scripts/sim-audit.mjs [seconds] [label]
//
// A stub canvas keeps the ball's real physics (textures are the only part of
// MatchBall that needs a DOM); rigs are stubbed since nothing is drawn.

// Seeded RNG: the engine is stochastic, so two runs of the same build differ by
// several passes. A fixed seed makes an audit comparable with the next one.
const seedArg = Number(process.argv[4] ?? 1);
let seed = seedArg * 2654435761;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const ctx2d = new Proxy(
  {},
  {
    get: (_t, key) => {
      if (key === 'canvas') return { width: 1, height: 1 };
      if (key === 'createLinearGradient' || key === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      return () => {};
    },
    set: () => true,
  },
);
const fakeCanvas = { width: 1, height: 1, getContext: () => ctx2d };
globalThis.document = { createElement: () => fakeCanvas, createElementNS: () => fakeCanvas };

const THREE = await import('three');
const { Match } = await import('../src/sim3d/sim/match.js');
const { MatchBall } = await import('../src/sim3d/entities/ball.js');
const { PITCH } = await import('../src/sim3d/config.js');

let offsides = [0, 0];
const stubRig = () => ({
  root: { position: new THREE.Vector3(), rotation: { y: 0 } },
  update() {},
  startAction() {},
  setPose() {},
});

const SIM_SECONDS = Number(process.argv[2] ?? 420); // wall-clock seconds of the match
const LABEL = process.argv[3] ?? 'audit';
const STEP = 1 / 30;

const ball = new MatchBall();
const match = new Match(null, ball, {
  makeRig: stubRig,
  onEvent: (e) => {
    if (e.type === 'offside') offsides[e.team === 0 ? 1 : 0] += 1; // the side it was given against
  },
});
match.startMatch();

const audit = {
  passes: [0, 0],
  passesCompleted: [0, 0],
  backward: [0, 0],
  sideways: [0, 0],
  keeperPasses: [0, 0],
  keeperTouches: [0, 0],
  thirdTime: [
    [0, 0, 0],
    [0, 0, 0],
  ],
  boxFrames: [0, 0],
  playersInBox: [0, 0],
  ownBoxPasses: [0, 0],
  longBalls: [0, 0],
  boxEntries: [0, 0],
  held: [0, 0],
  loose: 0,
  spells: [0, 0],
  passDist: [0, 0],
  lineFrames: 0,
  lineSum: 0,
  lineOut: 0,
  outcomes: { intended: 0, teammate: 0, opponent: 0, dead: 0 },
  timeline: [],
};
let openPass = null;
const closePass = (kind) => {
  if (!openPass) return;
  audit.outcomes[kind]++;
  openPass = null;
};
let lastHolder = null;

// One entry every five minutes: where the ball lived, how many attackers were
// already in the final third, and how often it got into the box.
const bucket = () => ({ frames: 0, x: 0, finalThird: [0, 0], box: [0, 0], entries: [0, 0] });
let current = bucket();
let bucketEnd = 5 * 60;
let wasInBox = [false, false];

const thirdOf = (team, x) => {
  const dir = match.teams[team].attackDir;
  const nx = (x * dir + PITCH.halfLength) / PITCH.length;
  return nx < 1 / 3 ? 0 : nx < 2 / 3 ? 1 : 2;
};

// Wrap the two methods that define what a pass was, without touching the engine.
const realPass = match.executePass.bind(match);
match.executePass = (a, choice, extra = {}) => {
  const team = match.teams[a.teamIdx];
  const from = a.pos.clone();
  const wasKeeper = a.role === 'GK';
  realPass(a, choice, extra);
  if (!choice) return;
  const t = a.teamIdx;
  audit.passes[t]++;
  if (wasKeeper) audit.keeperPasses[t]++;
  const dx = choice.mate.pos.x - from.x;
  const forward = dx * team.attackDir;
  const dist = Math.hypot(dx, choice.mate.pos.z - from.z);
  if (forward < -2) audit.backward[t]++;
  else if (Math.abs(forward) < 2.4) audit.sideways[t]++;
  if (dist > 30) audit.longBalls[t]++;
  audit.passDist[t] += dist;
  if (thirdOf(t, from.x) === 0) audit.ownBoxPasses[t]++;
  closePass('dead'); // a new pass supersedes any unresolved one
  openPass = { from: a, to: choice.mate, team: t };
};

const realRestart = match.setRestart.bind(match);
match.setRestart = (...args) => {
  closePass('dead');
  return realRestart(...args);
};

const realTake = match.takePossession.bind(match);
match.takePossession = (a, speed, b) => {
  if (openPass) {
    if (openPass.to === a) closePass('intended');
    else if (openPass.team === a.teamIdx) closePass('teammate');
    else closePass('opponent');
  }
  realTake(a, speed, b);
  if (a.role === 'GK') audit.keeperTouches[a.teamIdx]++;
};

let steps = 0;
while (match.state !== 'fulltime' && steps * STEP < SIM_SECONDS) {
  match.update(STEP);
  steps++;
  const holder = match.possessor;
  if (match.state === 'play' && holder) {
    audit.thirdTime[holder.teamIdx][thirdOf(holder.teamIdx, holder.pos.x)] += STEP;
  }
  // Back-line discipline: where the four defenders sit while the other side
  // has the ball, and whether one of them has wandered into the opponent half.
  if (match.state === 'play' && holder) {
    const defTeam = match.teams[1 - holder.teamIdx];
    const defenders = defTeam.agents.filter((a) => ['CB', 'RB', 'LB'].includes(a.role));
    if (defenders.length) {
      audit.lineFrames++;
      let sum = 0;
      let out = 0;
      for (const d of defenders) {
        const p = d.pos.x * defTeam.attackDir;
        sum += p;
        if (p > 0) out++;
      }
      audit.lineSum += sum / defenders.length;
      if (out) audit.lineOut++;
    }
  }

  if (match.state === 'play') {
    if (holder) audit.held[holder.teamIdx] += STEP;
    else audit.loose += STEP;
    if (holder && holder !== lastHolder && lastHolder?.teamIdx !== holder.teamIdx) audit.spells[holder.teamIdx]++;
    lastHolder = holder;
  }

  for (const t of [0, 1]) {
    let inBox = 0;
    let finalThird = 0;
    for (const a of match.teams[t].agents) {
      if (a.sentOff) continue;
      if (thirdOf(t, a.pos.x) === 2) finalThird++;
      if (a === match.possessor) continue;
      if (match.inOppBox(a.pos.x, a.pos.z, match.teams[t])) inBox++;
    }
    audit.playersInBox[t] += inBox;
    if (inBox >= 3) audit.boxFrames[t]++;
    current.finalThird[t] += finalThird;
    current.box[t] += inBox;

    const nowIn = match.inOppBox(ball.pos.x, ball.pos.z, match.teams[t]);
    if (nowIn && !wasInBox[t]) {
      audit.boxEntries[t]++;
      current.entries[t]++;
    }
    wasInBox[t] = nowIn;
  }
  current.frames++;
  current.x += (ball.pos.x / PITCH.halfLength) * 0.5 + 0.5;

  if (match.clock >= bucketEnd) {
    audit.timeline.push({ minute: Math.round(bucketEnd / 60), ...current });
    current = bucket();
    bucketEnd += 5 * 60;
  }
}
if (current.frames) audit.timeline.push({ minute: Math.round(match.clock / 60), ...current });

for (const t of [0, 1]) {
  audit.passesCompleted[t] = match.stats[t].passesCompleted;
}

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const per = (n, d) => (d ? (n / d).toFixed(2) : '0.00');
const thirdTotal = (t) => audit.thirdTime[t].reduce((a, b) => a + b, 0) || 1;
const minutes = match.clock / 60;

console.log(`\n=== ${LABEL} — ${minutes.toFixed(1)} minutes, seed ${seedArg}, state ${match.state}`);
console.log(
  `score ${match.score[0]}-${match.score[1]}  possession ${match.possessionPct.join('/')}` +
    `  shots ${match.shots.join('/')}  offsides ${offsides.join('/')}`,
);
for (const t of [0, 1]) {
  const name = match.teams[t].name.padEnd(12).slice(0, 12);
  const touched = audit.passes[t] || 1;
  console.log(
    `${name} passes ${String(audit.passes[t]).padStart(3)} done ${pct(audit.passesCompleted[t], touched)}%` +
      `  back ${pct(audit.backward[t], touched)}%  side ${pct(audit.sideways[t], touched)}%` +
      `  long ${audit.longBalls[t]}  keeper passes ${audit.keeperPasses[t]} touches ${audit.keeperTouches[t]}`,
  );
  console.log(
    `${' '.repeat(12)} thirds own/mid/final ${pct(audit.thirdTime[t][0], thirdTotal(t))}/${pct(
      audit.thirdTime[t][1],
      thirdTotal(t),
    )}/${pct(audit.thirdTime[t][2], thirdTotal(t))}%` +
      `  passes from own third ${pct(audit.ownBoxPasses[t], touched)}%` +
      `  crowded box ${pct(audit.boxFrames[t], steps)}% of frames, ${per(audit.playersInBox[t], steps)} bodies` +
      `  box entries ${audit.boxEntries[t]}`,
  );
  const spells = audit.spells[t] || 1;
  console.log(
    `${' '.repeat(12)} on the ball ${(audit.held[t] / 60).toFixed(1)}min, ${spells} spells, ` +
      `${(audit.passes[t] / spells).toFixed(1)} passes/spell, mean ${(audit.passDist[t] / touched).toFixed(1)}m` +
      `, loose ${(audit.loose / 60).toFixed(1)}min`,
  );
}

console.log(
  `\nback line out of position: mean height ${(audit.lineSum / (audit.lineFrames || 1)).toFixed(1)}m` +
    ` (0 = halfway), in the opponent half ${pct(audit.lineOut, audit.lineFrames)}% of frames`,
);

const out = audit.outcomes;
const passes = audit.passes[0] + audit.passes[1] || 1;
console.log(
  `\npass outcomes: intended ${pct(out.intended, passes)}%  teammate ${pct(out.teammate, passes)}%` +
    `  opponent ${pct(out.opponent, passes)}%  dead ${pct(out.dead, passes)}%`,
);

console.log('\n  min  ball.x  finalThird(0/1)  inBox(0/1)  entries(0/1)');
for (const row of audit.timeline) {
  console.log(
    `  ${String(row.minute).padStart(3)}  ${(row.x / row.frames).toFixed(2)}       ` +
      `${per(row.finalThird[0], row.frames)}/${per(row.finalThird[1], row.frames)}` +
      `          ${per(row.box[0], row.frames)}/${per(row.box[1], row.frames)}` +
      `      ${row.entries[0]}/${row.entries[1]}`,
  );
}
