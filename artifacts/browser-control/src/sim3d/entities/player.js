import * as THREE from 'three';
import { makeShirtTexture } from '../world/textures.js';

const SKIN_TONES = [0xf1c9a5, 0xe0ac82, 0xc98b5f, 0xa86a43, 0x8a5231, 0x6b3d23, 0xf7d7bc, 0xbd7f57];
const HAIR_COLORS = [0x14100e, 0x241a13, 0x3b2a1c, 0x5a4028, 0x8a6a3d, 0x0d0c0c, 0x2c2620];
const BOOT_COLORS = [0x0c0d10, 0x0c0d10, 0x0c0d10, 0xf2f4f7, 0xe8ecf2, 0x1a52ff, 0xff2d3d, 0xd8dde6];

const matCache = new Map();
function mat(key, make) {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
}

function skinMaterial(color) {
  return mat('skin' + color, () =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.0 })
  );
}

function fabricMaterial(color, sheen = 0.5) {
  return mat('fab' + color + sheen, () => {
    const m = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.78,
      metalness: 0.0,
      sheen,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color(0xffffff),
    });
    m.side = THREE.FrontSide;
    return m;
  });
}

/** Smooth tapered limb with rounded caps. Built hanging downward from y=0. */
function limbGeometry(len, rTop, rBot, radial = 12) {
  const pts = [];
  const capSteps = 4;
  for (let i = 0; i <= capSteps; i++) {
    const a = (i / capSteps) * Math.PI * 0.5;
    pts.push(new THREE.Vector2(Math.sin(a) * rTop, -rTop + Math.cos(a) * rTop));
  }
  const shaftTop = -rTop;
  const shaftBot = -len + rBot;
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    const r = rTop + (rBot - rTop) * t;
    pts.push(new THREE.Vector2(r, shaftTop + (shaftBot - shaftTop) * t));
  }
  for (let i = 1; i <= capSteps; i++) {
    const a = (i / capSteps) * Math.PI * 0.5;
    pts.push(new THREE.Vector2(Math.cos(a) * rBot, shaftBot - Math.sin(a) * rBot));
  }
  return new THREE.LatheGeometry(pts, radial);
}

function torsoGeometry() {
  const profile = [
    [0.142, 0.0],
    [0.138, 0.07],
    [0.144, 0.16],
    [0.162, 0.27],
    [0.182, 0.38],
    [0.186, 0.45],
    [0.163, 0.51],
    [0.098, 0.55],
    [0.06, 0.572],
    [0.044, 0.58],
  ];
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.scale(1.02, 1, 0.66);
  return geo;
}

function shortsGeometry() {
  const pts = [
    [0.0, 0.0],
    [0.132, 0.004],
    [0.166, 0.05],
    [0.174, 0.13],
    [0.17, 0.19],
    [0.15, 0.215],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.scale(1, 1, 0.8);
  return geo;
}

function bootGeometry() {
  // footprint drawn in x (width) / y (heel -0.08 .. toe +0.17)
  const shape = new THREE.Shape();
  shape.moveTo(-0.046, -0.082);
  shape.lineTo(0.046, -0.082);
  shape.lineTo(0.05, 0.03);
  shape.quadraticCurveTo(0.048, 0.125, 0.014, 0.168);
  shape.lineTo(-0.042, 0.168);
  shape.quadraticCurveTo(-0.066, 0.055, -0.046, -0.082);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.072,
    bevelEnabled: true,
    bevelSize: 0.01,
    bevelThickness: 0.01,
    bevelSegments: 2,
    curveSegments: 5,
  });
  geo.rotateX(-Math.PI / 2); // length now runs down -z
  geo.rotateY(Math.PI); // toe points forward (+z)
  geo.translate(0, 0.014, 0);
  return geo;
}

export class PlayerRig {
  constructor(cfg) {
    this.cfg = cfg;
    const skin = skinMaterial(cfg.skin);
    const shirtMat = fabricMaterial(cfg.shirt);
    const shortMat = fabricMaterial(cfg.shorts, 0.35);
    const sockMat = fabricMaterial(cfg.socks, 0.3);
    const bootMat = mat('boot' + cfg.boot, () =>
      new THREE.MeshStandardMaterial({ color: cfg.boot, roughness: 0.42, metalness: 0.15 })
    );
    const hairMat = mat('hair' + cfg.hairColor, () =>
      new THREE.MeshStandardMaterial({ color: cfg.hairColor, roughness: 0.85 })
    );

    const root = new THREE.Group();
    this.root = root;

    const pelvis = new THREE.Group();
    pelvis.position.y = 0.95;
    root.add(pelvis);
    this.pelvis = pelvis;

    // shorts over hips
    const shorts = new THREE.Mesh(shortsGeometry(), shortMat);
    shorts.position.y = 0.06;
    shorts.castShadow = true;
    pelvis.add(shorts);

    const spine = new THREE.Group();
    pelvis.add(spine);
    this.spine = spine;

    const torso = new THREE.Mesh(torsoGeometry(), shirtMat);
    torso.castShadow = true;
    torso.position.y = 0.02;
    spine.add(torso);

    // squad number shell on the back
    if (cfg.number) {
      const arc = 1.85;
      const shellGeo = new THREE.CylinderGeometry(0.2, 0.192, 0.36, 16, 1, true, Math.PI - arc / 2, arc);
      shellGeo.scale(1.02, 1, 0.66);
      const tex = makeShirtTexture(cfg.number, cfg.name || '', cfg.shirt, cfg.textColor || '#ffffff');
      const shellMat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.3,
        roughness: 0.8,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const shell = new THREE.Mesh(shellGeo, shellMat);
      shell.position.y = 0.38;
      spine.add(shell);
    }

    // collar
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.062, 0.016, 6, 14),
      mat('collar' + cfg.trim, () => new THREE.MeshStandardMaterial({ color: cfg.trim, roughness: 0.8 }))
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.575;
    collar.scale.z = 0.8;
    spine.add(collar);

    // neck + head
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.05, 0.075, 10), skin);
    neck.position.y = 0.6;
    neck.castShadow = true;
    spine.add(neck);

    const headPivot = new THREE.Group();
    headPivot.position.y = 0.63;
    spine.add(headPivot);
    this.headPivot = headPivot;

    const headGeo = new THREE.SphereGeometry(0.105, 16, 16);
    headGeo.scale(0.94, 1.12, 1.0);
    const head = new THREE.Mesh(headGeo, skin);
    head.position.y = 0.11;
    head.castShadow = true;
    headPivot.add(head);

    // eyes + nose + ears
    const darkEye = mat('eye', () =>
      new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.35 })
    );
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 8, 8), darkEye);
      eye.position.set(s * 0.034, 0.125, 0.093);
      headPivot.add(eye);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), skin);
      ear.scale.set(0.5, 1, 0.85);
      ear.position.set(s * 0.098, 0.11, -0.002);
      headPivot.add(ear);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 8), skin);
    nose.scale.set(0.8, 1, 1.3);
    nose.position.set(0, 0.098, 0.104);
    headPivot.add(nose);

    // hair
    if (cfg.hairStyle !== 'bald') {
      const hairGeo = new THREE.SphereGeometry(0.108, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
      hairGeo.scale(0.98, cfg.hairStyle === 'curly' ? 1.12 : 1.0, 1.02);
      const hair = new THREE.Mesh(hairGeo, hairMat);
      hair.position.set(0, 0.117, -0.004);
      hair.rotation.x = -0.18;
      headPivot.add(hair);
    }

    // ---------------- arms ----------------
    const armGeo = limbGeometry(0.29, 0.05, 0.039, 10);
    const foreGeo = limbGeometry(0.27, 0.042, 0.03, 10);
    const sleeveGeo = limbGeometry(0.16, 0.075, 0.062, 10);
    const handGeo = new THREE.SphereGeometry(0.036, 8, 8);
    const deltoidGeo = new THREE.SphereGeometry(0.072, 12, 10);
    deltoidGeo.scale(1, 0.95, 0.92);

    this.arms = {};
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'L' : 'R';
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.198, 0.462, 0);
      spine.add(shoulder);

      const deltoid = new THREE.Mesh(deltoidGeo, shirtMat);
      deltoid.castShadow = true;
      deltoid.position.y = -0.012;
      shoulder.add(deltoid);

      const upper = new THREE.Mesh(armGeo, skin);
      upper.castShadow = true;
      shoulder.add(upper);

      const sleeve = new THREE.Mesh(sleeveGeo, shirtMat);
      sleeve.castShadow = true;
      shoulder.add(sleeve);

      const elbow = new THREE.Group();
      elbow.position.y = -0.29;
      shoulder.add(elbow);

      const fore = new THREE.Mesh(foreGeo, skin);
      fore.castShadow = true;
      elbow.add(fore);

      const hand = new THREE.Mesh(handGeo, skin);
      hand.scale.set(0.8, 1.15, 1.4);
      hand.position.y = -0.275;
      elbow.add(hand);

      this.arms[key] = { shoulder, elbow };
    }

    // ---------------- legs ----------------
    const thighGeo = limbGeometry(0.45, 0.093, 0.062, 10);
    const shinGeo = limbGeometry(0.42, 0.062, 0.038, 10);
    const shortLegGeo = limbGeometry(0.3, 0.122, 0.105, 10);
    const bootGeo = bootGeometry();

    this.legs = {};
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'L' : 'R';
      const hip = new THREE.Group();
      hip.position.set(side * 0.095, -0.02, 0);
      pelvis.add(hip);

      const thigh = new THREE.Mesh(thighGeo, skin);
      thigh.castShadow = true;
      hip.add(thigh);

      const shortLeg = new THREE.Mesh(shortLegGeo, shortMat);
      shortLeg.castShadow = true;
      hip.add(shortLeg);

      const knee = new THREE.Group();
      knee.position.y = -0.45;
      hip.add(knee);

      const shin = new THREE.Mesh(shinGeo, sockMat);
      shin.castShadow = true;
      knee.add(shin);

      // sock turnover
      const hasBand = true;
      if (hasBand) {
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(0.063, 0.06, 0.05, 10),
          mat('trim' + cfg.trim, () => new THREE.MeshStandardMaterial({ color: cfg.trim, roughness: 0.8 }))
        );
        band.position.y = -0.045;
        knee.add(band);
      }

      const ankle = new THREE.Group();
      ankle.position.y = -0.42;
      knee.add(ankle);

      const boot = new THREE.Mesh(bootGeo, bootMat);
      boot.scale.set(1, 1, 1);
      boot.position.y = -0.076;
      boot.castShadow = true;
      ankle.add(boot);

      this.legs[key] = { hip, knee, ankle };
    }

    // scale whole body
    const h = cfg.height || 1.82;
    const w = cfg.build || 1;
    root.scale.set(w, h / 1.825, w);

    this.height = h;
    this.phase = Math.random() * Math.PI * 2;
    this.gait = 0;
    this.action = null;
    this.actionWeight = 0;
    this.shadowCast = [];
    root.traverse((o) => {
      if (o.isMesh) this.shadowCast.push(o);
    });
  }

  startAction(type, dur) {
    this.action = { type, t: 0, dur };
  }

  /**
   * @param {object} s { speed, forward, turn, celebrate, keeperDive, ballY }
   */
  update(dt, s) {
    const speed = s.speed || 0;
    const moving = Math.min(1, speed / 1.2);
    const sprint = Math.min(1, Math.max(0, (speed - 3.4) / 4.5));

    // stride phase (keep the cycle natural across jog -> sprint)
    const strideLen = 1.15 + speed * 0.13;
    const stepsPerSec = speed > 0.15 ? speed / strideLen : 0;
    this.phase += stepsPerSec * Math.PI * dt;
    const p = this.phase;

    const amp = 0.30 + 0.42 * Math.min(1, speed / 6.5);
    const leanBase = 0.02 + 0.18 * Math.min(1, speed / 8);
    const bob = 0.018 * moving + 0.026 * Math.sin(2 * p) * moving;

    // ---------- legs ----------
    // hip: + = leg behind, - = leg in front. Knee peaks during mid-swing.
    const hipL = Math.sin(p) * amp;
    const hipR = Math.sin(p + Math.PI) * amp;
    const flexAmp = 1.1 + 0.55 * sprint;
    const kneeL = 0.2 + flexAmp * Math.pow(Math.max(0, -Math.cos(p)), 1.3);
    const kneeR = 0.2 + flexAmp * Math.pow(Math.max(0, -Math.cos(p + Math.PI)), 1.3);

    this.legs.L.hip.rotation.x = hipL * moving;
    this.legs.R.hip.rotation.x = hipR * moving;
    this.legs.L.knee.rotation.x = kneeL * moving + 0.06;
    this.legs.R.knee.rotation.x = kneeR * moving + 0.06;

    // ankle: toe up as the foot reaches forward, toe down at push-off
    this.legs.L.ankle.rotation.x = hipL * 0.5 * moving;
    this.legs.R.ankle.rotation.x = hipR * 0.5 * moving;

    // slight abduction so legs don't clip
    this.legs.L.hip.rotation.z = -0.035;
    this.legs.R.hip.rotation.z = 0.035;

    // ---------- upper body ----------
    const fatigue = s.stamina === undefined ? 0 : Math.max(0, Math.min(1, 1 - s.stamina));
    this.spine.rotation.x = -leanBase - sprint * 0.09 - fatigue * 0.05;
    this.spine.rotation.y = Math.sin(p) * 0.09 * moving;
    this.spine.rotation.z = Math.sin(p * 2) * 0.02 * moving;
    this.pelvis.rotation.y = -Math.sin(p) * 0.11 * moving;
    this.pelvis.rotation.z = -Math.sin(p * 2) * 0.015 * moving;

    // arms swing opposite to legs
    const armAmp = (0.5 + 0.55 * Math.min(1, speed / 6.5)) * (1 - fatigue * 0.3);
    this.arms.L.shoulder.rotation.x = -hipL * armAmp + 0.04;
    this.arms.R.shoulder.rotation.x = -hipR * armAmp + 0.04;
    this.arms.L.shoulder.rotation.z = 0.12 + 0.1 * moving;
    this.arms.R.shoulder.rotation.z = -0.12 - 0.1 * moving;
    const elbowAmp = 0.5 + 0.9 * Math.min(1, speed / 7);
    this.arms.L.elbow.rotation.x = -(elbowAmp + 0.3 * Math.sin(p) + 0.15 * moving);
    this.arms.R.elbow.rotation.x = -(elbowAmp + 0.3 * Math.sin(p + Math.PI) + 0.15 * moving);

    // ---------- head: track the ball a bit ----------
    if (s.lookAt) {
      const targetYaw = Math.max(-0.7, Math.min(0.7, s.lookAt.yaw || 0));
      const targetPitch = Math.max(-0.35, Math.min(0.35, s.lookAt.pitch || 0));
      this.headPivot.rotation.y += (targetYaw - this.headPivot.rotation.y) * Math.min(1, dt * 6);
      this.headPivot.rotation.x += (targetPitch - this.headPivot.rotation.x) * Math.min(1, dt * 6);
    } else {
      this.headPivot.rotation.y *= 0.98;
      this.headPivot.rotation.x *= 0.98;
    }

    // ---------- root transform ----------
    this.root.position.y = bob;
    this.root.rotation.z = 0;

    // analytic ground clamp: keep the lower boot from sinking into the turf
    const L1 = 0.45 * this.root.scale.y;
    const L2 = 0.42 * this.root.scale.y;
    const footY = (hipAngle, kneeAngle) => {
      const a = hipAngle;
      const b = hipAngle + kneeAngle;
      // sign convention: +x rotation swings the foot toward -z, y drops with cos
      return -(L1 * Math.cos(a) + L2 * Math.cos(b)) - 0.02;
    };
    const yL = footY(this.legs.L.hip.rotation.x, this.legs.L.knee.rotation.x);
    const yR = footY(this.legs.R.hip.rotation.x, this.legs.R.knee.rotation.x);
    const lowest = Math.min(yL, yR);
    if (lowest < -0.95) this.root.position.y += Math.min(0.12, -0.95 - lowest);

    // ---------- action overlays ----------
    if (this.action) {
      this.action.t += dt;
      const t = Math.min(1, this.action.t / this.action.dur);
      this.applyAction(this.action.type, t, dt);
      if (t >= 1) this.action = null;
    }

    // ---------- celebration ----------
    if (s.celebrate > 0.01) {
      const c = s.celebrate;
      this.arms.L.shoulder.rotation.x = THREE.MathUtils.lerp(this.arms.L.shoulder.rotation.x, -2.6, c);
      this.arms.R.shoulder.rotation.x = THREE.MathUtils.lerp(this.arms.R.shoulder.rotation.x, -2.6, c);
      this.arms.L.shoulder.rotation.z = THREE.MathUtils.lerp(this.arms.L.shoulder.rotation.z, 0.45, c);
      this.arms.R.shoulder.rotation.z = THREE.MathUtils.lerp(this.arms.R.shoulder.rotation.z, -0.45, c);
      this.arms.L.elbow.rotation.x = THREE.MathUtils.lerp(this.arms.L.elbow.rotation.x, -0.25, c);
      this.arms.R.elbow.rotation.x = THREE.MathUtils.lerp(this.arms.R.elbow.rotation.x, -0.25, c);
      this.spine.rotation.x = THREE.MathUtils.lerp(this.spine.rotation.x, 0.12, c);
      this.root.position.y += Math.sin(performance.now() * 0.012) * 0.05 * c;
    }

    // keeper dive
    if (s.dive) {
      const d = s.dive;
      this.root.position.x = d.dir * 0.9 * d.t;
      this.root.position.y = 0.35 + 0.75 * Math.sin(Math.min(1, d.t) * Math.PI) - d.t * 0.35;
      this.root.rotation.z = -d.dir * 1.35 * Math.min(1, d.t * 1.4);
      this.arms.L.shoulder.rotation.x = -2.2;
      this.arms.R.shoulder.rotation.x = -2.2;
      this.legs.L.knee.rotation.x = 0.25;
      this.legs.R.knee.rotation.x = 0.35;
    }
  }

  applyAction(type, t, dt) {
    const ease = (a, b, x) => a + (b - a) * x;
    if (type === 'kick' || type === 'pass' || type === 'shot') {
      let hip;
      let knee;
      let torso;
      const power = type === 'shot' ? 1.15 : type === 'pass' ? 0.75 : 1;
      if (t < 0.34) {
        const k = t / 0.34;
        hip = ease(0, 0.85 * power, Math.sin(k * Math.PI * 0.5));
        knee = ease(0.1, 1.6 * power, k);
        torso = ease(0, -0.18, k);
      } else if (t < 0.55) {
        const k = (t - 0.34) / 0.21;
        hip = ease(0.85 * power, -0.85 * power, k);
        knee = ease(1.6 * power, 0.12, k);
        torso = ease(-0.18, 0.22, k);
      } else {
        const k = (t - 0.55) / 0.45;
        hip = ease(-0.85 * power, 0, k);
        knee = ease(0.12, 0.1, k);
        torso = ease(0.22, 0, k);
      }
      this.legs.R.hip.rotation.x = hip;
      this.legs.R.knee.rotation.x = knee;
      this.legs.R.ankle.rotation.x = -hip * 0.4;
      this.spine.rotation.x += torso;
      // arms counterbalance
      this.arms.L.shoulder.rotation.x = -0.9 - 0.5 * Math.sin(t * Math.PI);
      this.arms.R.shoulder.rotation.x = 0.55 * Math.sin(t * Math.PI);
      this.arms.L.shoulder.rotation.z = 0.6;
      // plant foot
      this.legs.L.knee.rotation.x = 0.12 + 0.25 * Math.sin(t * Math.PI);
      this.legs.L.hip.rotation.x = -0.15;
    }

    if (type === 'tackle') {
      const slide = Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.5);
      this.root.rotation.z = 0.45 * slide;
      this.root.position.y = -0.55 * slide;
      this.legs.R.hip.rotation.x = -1.15 * slide;
      this.legs.R.knee.rotation.x = 0.15;
      this.legs.L.hip.rotation.x = -0.55 * slide;
      this.legs.L.knee.rotation.x = 1.4 * slide;
      this.arms.L.shoulder.rotation.z = 1.1;
      this.spine.rotation.x = 0.25 * slide;
    }

    if (type === 'header') {
      const k = Math.sin(Math.min(1, t * 1.2) * Math.PI);
      this.spine.rotation.x = -0.35 * k;
      this.headPivot.rotation.x = -0.4 * k;
      this.root.position.y += 0.28 * k;
      this.arms.L.shoulder.rotation.x = -1.4 * k;
      this.arms.R.shoulder.rotation.x = -1.4 * k;
      this.legs.L.knee.rotation.x = 0.3 * k;
      this.legs.R.knee.rotation.x = 0.3 * k;
    }

    // arms up, appealing to the referee after a foul
    if (type === 'appeal') {
      const k = Math.sin(Math.min(1, t) * Math.PI);
      this.arms.L.shoulder.rotation.x = -2.5 * k;
      this.arms.R.shoulder.rotation.x = -2.5 * k;
      this.arms.L.shoulder.rotation.z = 0.55 * k;
      this.arms.R.shoulder.rotation.z = -0.55 * k;
      this.arms.L.elbow.rotation.x = -0.5 * k;
      this.arms.R.elbow.rotation.x = -0.5 * k;
      this.spine.rotation.x = -0.12 * k;
      this.headPivot.rotation.x = -0.1 * k;
    }

    if (type === 'throw') {
      const k = Math.sin(Math.min(1, t) * Math.PI);
      this.arms.R.shoulder.rotation.x = -2.4 * k;
      this.arms.L.shoulder.rotation.x = -2.0 * k;
      this.arms.R.elbow.rotation.x = -1.0 * k;
      this.arms.L.elbow.rotation.x = -0.9 * k;
      this.spine.rotation.x = -0.25 * k;
    }
  }
}

export function randomLook() {
  return {
    skin: SKIN_TONES[(Math.random() * SKIN_TONES.length) | 0],
    hairColor: HAIR_COLORS[(Math.random() * HAIR_COLORS.length) | 0],
    hairStyle: ['short', 'short', 'curly', 'buzz', 'bald'][(Math.random() * 5) | 0],
    boot: BOOT_COLORS[(Math.random() * BOOT_COLORS.length) | 0],
  };
}
