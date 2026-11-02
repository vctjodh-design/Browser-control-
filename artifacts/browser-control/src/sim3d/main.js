import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';
import { createPitch } from './world/pitch.js';
import { createStadium } from './world/stadium.js';
import { TEAMS } from './config.js';
import { labels } from './labels.js';
import { MatchBall } from './entities/ball.js';
import { Match } from './sim/match.js';
import { CameraRig } from './camera.js';
import { HUD } from './ui/hud.js';
import { StadiumAudio } from './audio.js';

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

const match = new Match(scene, ball, {
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
  },
  onGoal: (data) => {
    hud.showGoal(data);
    goalFlash = 1;
  },
  onCard: (card) => {
    hud.showCard(card);
    audio.whistle(1);
  },
});

const hud = new HUD(match);
const camRig = new CameraRig(camera);

hud.bind({
  onCamera: (mode) => camRig.setMode(mode),
  onSpeed: (s) => {
    timeScale = s;
  },
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
const keys = new Set();
const clock = new THREE.Clock();

function startMatch() {
  if (started) return;
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

  accumulator += raw * timeScale;
  let steps = 0;
  while (accumulator >= FIXED && steps < 6) {
    if (humanMode) readInput();
    match.update(FIXED);
    accumulator -= FIXED;
    steps++;
  }
  if (accumulator > FIXED * 6) accumulator = 0;

  stadium.update(raw);
  stadium.crowd.setExcitement(Math.min(1, match.excite + goalFlash * 0.6));
  goalFlash = Math.max(0, goalFlash - raw * 0.22);
  audio.setExcitement(Math.min(1, match.excite + goalFlash * 0.4));

  camRig.update(raw, match, match.human);

  hud.update();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// expose for debugging / casual tinkering
window.__match = match;
window.__scene = scene;
window.__cam = camRig;
window.__three = THREE;

console.log('stadium seats filled:', stadium.seats);
animate();
