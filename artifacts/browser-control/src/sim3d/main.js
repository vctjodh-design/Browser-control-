import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';
import { createPitch } from './world/pitch.js';
import { createStadium } from './world/stadium.js';
import { TEAMS } from './config.js';
import { labels } from './labels.js';
import { MatchBall } from './entities/ball.js';
import { Match } from './sim/match.js';
import { MatchReplay } from './sim/replay.js';
import { CameraRig } from './camera.js';
import { HUD } from './ui/hud.js';
import { StadiumAudio } from './audio.js';
import { matchExpectations } from './sim/form-profile.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0c1526, 0.0019);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.25, 900);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0xa9c8ff, 0x152418, 0.5);
scene.add(hemi);
scene.add(new THREE.AmbientLight(0x334466, 0.35));

const key = new THREE.DirectionalLight(0xfff4e4, 3.1);
key.position.set(46, 76, 24);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.camera.left = -64;
key.shadow.camera.right = 64;
key.shadow.camera.top = 44;
key.shadow.camera.bottom = -44;
key.shadow.camera.near = 10;
key.shadow.camera.far = 210;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
scene.add(key.target);

const fill = new THREE.DirectionalLight(0xc6dcff, 1.0);
fill.position.set(-56, 58, -42);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xa8c7ff, 0.62);
rim.position.set(10, 34, 78);
scene.add(rim);

// ---------------------------------------------------------------- world
const pitch = createPitch();
scene.add(pitch.group);

const stadium = createStadium({
  ledText: labels.ledText || `${TEAMS[0].name}  ·  ${TEAMS[1].name}  ·  LIVE  `,
});
scene.add(stadium.group);

const ball = new MatchBall();
scene.add(ball.mesh);

const audio = new StadiumAudio();

const handlers = {
  onEvent: (ev) => {
    hud.addEvent(ev);
    if (ev.type === 'goal') {
      audio.cheer();
    } else if (ev.type === 'shot') {
      audio.ooh();
    } else if (ev.type === 'halftime' || ev.type === 'fulltime') {
      audio.whistle(2);
    } else if (ev.type === 'foul' || ev.type === 'yellow' || ev.type === 'red' || ev.type === 'penalty') {
      audio.whistle(1);
    }
    if (ev.type === 'fulltime') {
      const summary = matchSummary();
      lastSummary = summary;
      postToHost({
        type: 'sim-match-summary',
        summary,
        teams: [match.teams[0].name, match.teams[1].name],
      });
      finishRound(summary);
    }
  },
  onGoal: (data) => {
    hud.showGoal(data);
    goalFlash = 1;
    goalLog.push({
      side: data.team === 0 ? 'home' : 'away',
      minute: data.minute ?? 0,
      scorer: data.scorer,
      assist: data.assist ?? null,
      ownGoal: Boolean(data.ownGoal),
    });
  },
  onCard: (card) => {
    hud.showCard(card);
    audio.whistle(1);
  },
  onReset: () => {
    hud.reset();
    goalLog = [];
  },
};

// Two ways to fill this pitch. By default the house simulation invents the
// match from the squads. With a recording (`?engine=open-football`) the Open
// Football engine has already played it and the pitch only walks through it.
// Everything below — stadium, camera, HUD, audio, the series runner — is the
// same code either way.
const openFootballReplay = window.__openFootballReplay ?? null;
const match = openFootballReplay
  ? new MatchReplay(scene, ball, { replay: openFootballReplay, ...handlers })
  : new Match(scene, ball, handlers);

const hud = new HUD(match);
const camRig = new CameraRig(camera);

hud.bind({
  onCamera: (mode) => camRig.setMode(mode),
  onSpeed: (s) => applySpeed(s),
  onHuman: (on) => {
    humanMode = on;
    match.setHuman(on);
    hud.setHumanMode(on);
    camRig.setMode(on ? 'player' : 'broadcast');
    document.querySelectorAll('[data-cam]').forEach((b) => {
      b.classList.toggle('active', !on && b.dataset.cam === 'broadcast');
    });
  },
  onSound: (on) => audio.setEnabled(on),
  onKickoff: () => startMatch(),
});

// ---------------------------------------------------------------- state
let timeScale = 1;
let humanMode = false;
let started = false;
let goalFlash = 0;
let accumulator = 0;
const FIXED = 1 / 60;
const MAX_SPEED = 20;

// ------------------------------------------------------------ series runner
// The match page can ask for the same fixture to be played out N times and
// every scoreline reported back. Results are emergent: the squads, ratings and
// form never change between rounds, only the match itself is replayed.
const hostWindow = window.parent && window.parent !== window ? window.parent : null;
const series = { active: false, total: 0, done: 0, results: [] };

// Everything the odds board needs to settle a bet after the match: goals with
// minutes and scorers, both halves, corners, cards and shots on target.
let goalLog = [];
let lastSummary = null;

function blankSummaryLine() {
  return { goals: 0, corners: 0, cards: 0, shotsOnTarget: 0 };
}

function matchSummary() {
  const home = blankSummaryLine();
  const away = blankSummaryLine();
  const sides = [home, away];
  for (let t = 0; t < 2; t++) {
    sides[t].goals = match.score[t];
    sides[t].corners = match.stats[t].corners;
    sides[t].cards = match.stats[t].yellows + match.stats[t].reds;
    sides[t].shotsOnTarget = Math.round(match.stats[t].onTarget);
  }
  const half = match.halfTimeScore || [0, 0];
  const players = match.agents
    .filter((agent) => agent.stats)
    .map((agent) => ({
      name: agent.name,
      side: agent.teamIdx === 0 ? 'home' : 'away',
      goals: agent.stats.goals || 0,
      assists: agent.stats.assists || 0,
      shotsOnTarget: agent.stats.onTarget || 0,
    }));

  return {
    home,
    away,
    goals: goalLog.map((goal) => ({ ...goal })),
    halfTime: { home: half[0], away: half[1] },
    secondHalf: { home: match.score[0] - half[0], away: match.score[1] - half[1] },
    firstGoal: goalLog.length ? goalLog[0].side : 'none',
    players,
  };
}

function postToHost(message) {
  if (!hostWindow) return;
  try {
    hostWindow.postMessage({ source: 'match-sim', ...message }, '*');
  } catch {
    // the page around the frame went away mid-run
  }
}

// Past this speed the 3D frame rate, not the match, becomes the bottleneck. A
// batch then stops drawing every frame and the match page shows its progress
// instead, so 20x really is 20x of football rather than 20x of waiting.
const WATCHABLE_SPEED = 4;
let renderEnabled = true;
let forceRender = true;

function applySpeed(value) {
  const speed = Math.min(MAX_SPEED, Math.max(0.25, Number(value) || 1));
  timeScale = speed;
  hud.setSpeed(speed);
  renderEnabled = !series.active || speed <= WATCHABLE_SPEED;
  forceRender = true;
}

function resumeRendering() {
  renderEnabled = true;
  forceRender = true;
}

function startSeries(count, speed) {
  series.total = Math.max(1, Math.min(50, Math.round(Number(count) || 1)));
  series.done = 0;
  series.results = [];
  series.active = true;
  applySpeed(speed);
  if (!started) startMatch();
  else match.restartMatch();
  postToHost({ type: 'sim-series-start', total: series.total, speed: timeScale });
}

function stopSeries() {
  if (!series.active) return;
  series.active = false;
  resumeRendering();
  postToHost({ type: 'sim-series-done', results: series.results, stopped: true });
}

function finishRound(summary) {
  if (!series.active) return;
  forceRender = true;
  series.done += 1;
  const result = {
    summary: summary ?? matchSummary(),
    round: series.done,
    home: match.teams[0].name,
    away: match.teams[1].name,
    homeScore: match.score[0],
    awayScore: match.score[1],
    homeShots: match.stats[0].shots,
    awayShots: match.stats[1].shots,
    homePossession: match.possessionPct[0],
    awayPossession: match.possessionPct[1],
  };
  series.results.push(result);
  postToHost({ type: 'sim-series-round', result, done: series.done, total: series.total });

  if (series.done >= series.total) {
    series.active = false;
    resumeRendering();
    postToHost({ type: 'sim-series-done', results: series.results });
    return;
  }
  // straight into the next round, so a long batch never sits idle
  setTimeout(() => {
    if (series.active) match.restartMatch();
  }, 150);
}

window.addEventListener('message', (event) => {
  if (event.source !== hostWindow) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.target !== 'match-sim') return;
  if (data.type === 'sim-series') startSeries(data.count, data.speed);
  else if (data.type === 'sim-series-stop') stopSeries();
  else if (data.type === 'sim-speed') applySpeed(data.speed);
});
const keys = new Set();
const clock = new THREE.Clock();

function startMatch() {
  if (started) return;
  // The market and the clubs' own scoring numbers travel with the profile, so
  // the match is played to the same expectation the board is priced around.
  const targets = matchExpectations();
  if (targets) match.setTargets(targets);
  started = true;
  hud.hideBanner();
  audio.init();
  audio.resume();
  audio.whistle(1);
  match.startMatch();
  setTimeout(() => audio.whistle(1), 320);
}

// ---------------------------------------------------------------- input
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (k === 'c') {
    const modes = ['broadcast', 'tactical', 'behind', 'player'];
    const next = modes[(modes.indexOf(camRig.mode) + 1) % modes.length];
    camRig.setMode(next);
    document.querySelectorAll('[data-cam]').forEach((b) => {
      b.classList.toggle('active', b.dataset.cam === next);
    });
  }
  if (k === 'enter' && !started) startMatch();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function readInput() {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();

  let x = 0;
  let z = 0;
  if (keys.has('w') || keys.has('arrowup')) z += 1;
  if (keys.has('s') || keys.has('arrowdown')) z -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;

  const dir = new THREE.Vector3().addScaledVector(fwd, z).addScaledVector(right, x);
  match.input.x = dir.x;
  match.input.z = dir.z;
  match.input.sprint = keys.has('shift');
  match.input.pass = keys.has(' ') || keys.has('e');
  match.input.shoot = keys.has('f');
  match.input.tackle = keys.has('x');
}

// ---------------------------------------------------------------- loop
function animate() {
  requestAnimationFrame(animate);
  const raw = Math.min(clock.getDelta(), 0.05);

  // The step budget grows with the speed, and a wall-clock cap keeps a fast
  // batch from blocking the frame. Whatever the frame cannot fit stays in the
  // accumulator for the next one, so the match still reaches full time.
  const stepCap = Math.min(240, Math.max(6, Math.ceil((raw * timeScale) / FIXED) + 2));
  accumulator = Math.min(accumulator + raw * timeScale, FIXED * stepCap);
  let steps = 0;
  const stepStart = performance.now();
  while (accumulator >= FIXED && steps < stepCap) {
    if (humanMode) readInput();
    match.update(FIXED);
    accumulator -= FIXED;
    steps++;
    if ((steps & 7) === 0 && performance.now() - stepStart > 16) break;
  }

  stadium.update(raw);
  stadium.crowd.setExcitement(Math.min(1, match.excite + goalFlash * 0.6));
  goalFlash = Math.max(0, goalFlash - raw * 0.22);
  audio.setExcitement(Math.min(1, match.excite + goalFlash * 0.4));

  camRig.update(raw, match, match.human);

  hud.update();
  if (renderEnabled || forceRender) {
    renderer.render(scene, camera);
    forceRender = false;
  }
}

// The frame this page runs in changes size under it: the panel opens full
// screen around it, a phone's toolbar slides away, the device rotates. Follow
// the page's own box rather than the window the canvas was born with, or the
// pitch stays the size of the old frame and the rest of the screen is black.
const fitToFrame = () => {
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = document.documentElement.clientHeight || window.innerHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  // Both the drawing buffer and the element's own style: the renderer writes
  // an explicit pixel height on the canvas at start-up, and leaving that in
  // place keeps the old, smaller picture inside a frame that has since grown.
  renderer.setSize(width, height);
};

window.addEventListener('resize', fitToFrame);
window.visualViewport?.addEventListener('resize', fitToFrame);
new ResizeObserver(fitToFrame).observe(document.documentElement);
fitToFrame();

// expose for debugging / casual tinkering
window.__match = match;
window.__scene = scene;
window.__cam = camRig;
window.__three = THREE;
window.__series = series;
window.__lastSummary = () => lastSummary;
window.__setSpeed = applySpeed;

postToHost({
  type: 'sim-ready',
  teams: [match.teams[0].name, match.teams[1].name],
});

console.log('stadium seats filled:', stadium.seats);
animate();
