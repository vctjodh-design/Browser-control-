import * as THREE from 'three';
import { createCrowd } from './crowd.js';
import { makeAdTexture, makeGlowTexture } from './textures.js';

const A = 63; // semi axis along the length
const B = 45; // semi axis along the width
const N = 3.1; // superellipse exponent -> rounded rectangle bowl

const _p = { x: 0, z: 0 };
function ringPoint(theta, offset, out = _p) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const ex = 2 / N;
  const px = A * Math.sign(c) * Math.pow(Math.abs(c), ex);
  const pz = B * Math.sign(s) * Math.pow(Math.abs(s), ex);
  const eps = 0.002;
  const c2 = Math.cos(theta + eps);
  const s2 = Math.sin(theta + eps);
  const qx = A * Math.sign(c2) * Math.pow(Math.abs(c2), ex);
  const qz = B * Math.sign(s2) * Math.pow(Math.abs(s2), ex);
  let tx = qx - px;
  let tz = qz - pz;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  let nx = tz;
  let nz = -tx;
  if (nx * px + nz * pz < 0) {
    nx = -nx;
    nz = -nz;
  }
  out.x = px + nx * offset;
  out.z = pz + nz * offset;
  return out;
}

function perimeter(offset, segs = 160) {
  let len = 0;
  let px = 0;
  let pz = 0;
  const p = { x: 0, z: 0 };
  for (let i = 0; i <= segs; i++) {
    ringPoint((i / segs) * Math.PI * 2, offset, p);
    if (i > 0) len += Math.hypot(p.x - px, p.z - pz);
    px = p.x;
    pz = p.z;
  }
  return len;
}

/** Sweep a 2D profile {offset, y} around the bowl ring. */
function sweepProfile(profile, segs = 200) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const p = { x: 0, z: 0 };
  const rings = profile.length;

  // cumulative arc length for u
  for (let k = 0; k <= segs; k++) {
    const th = (k / segs) * Math.PI * 2;
    for (let j = 0; j < rings; j++) {
      ringPoint(th, profile[j].o, p);
      positions.push(p.x, profile[j].y, p.z);
      uvs.push(k / segs, j / (rings - 1));
    }
  }
  for (let k = 0; k < segs; k++) {
    for (let j = 0; j < rings - 1; j++) {
      const a = k * rings + j;
      const b = a + rings;
      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildBowl(ledText) {
  const group = new THREE.Group();
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f38,
    roughness: 0.94,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });

  const tiers = [
    { start: 0, base: 2.3, rows: 22, rise: 0.36, depth: 0.8 },
    { start: 21.4, base: 16.2, rows: 20, rise: 0.42, depth: 0.82 },
  ];

  const seats = [];

  for (const t of tiers) {
    const profile = [{ o: t.start, y: 0 }, { o: t.start, y: t.base }];
    let o = t.start;
    let y = t.base;
    for (let i = 0; i < t.rows; i++) {
      profile.push({ o, y });
      profile.push({ o: o + t.depth, y });
      y += t.rise;
      profile.push({ o: o + t.depth, y });
      o += t.depth;
    }
    // small back wall at the top of the tier
    profile.push({ o: o + 0.3, y: y + 0.9 });

    const geo = sweepProfile(profile, 220);
    const mesh = new THREE.Mesh(geo, concreteMat);
    mesh.receiveShadow = true;
    group.add(mesh);

    // seats
    const spacing = 0.76;
    const filled = 0.9;
    for (let i = 0; i < t.rows; i++) {
      const rowY = t.base + i * t.rise;
      const off = t.start + i * t.depth + t.depth * 0.55;
      const per = perimeter(off, 120);
      const n = Math.floor(per / spacing);
      for (let k = 0; k < n; k++) {
        if (Math.random() > filled) continue;
        const th = ((k + 0.5) / n) * Math.PI * 2;
        const p = ringPoint(th, off, { x: 0, z: 0 });
        const yaw = Math.atan2(-p.x, -p.z);
        const away = p.x < -34;
        seats.push({ x: p.x, y: rowY, z: p.z, yaw, away });
      }
    }
  }

  // roof canopy over the upper tier
  const roofProfile = [
    { o: 38.5, y: 29.6 },
    { o: 44, y: 33.4 },
    { o: 58, y: 34.6 },
    { o: 58, y: 32.4 },
    { o: 43, y: 31.2 },
  ];
  const roofGeo = sweepProfile(roofProfile, 200);
  const roof = new THREE.Mesh(
    roofGeo,
    new THREE.MeshStandardMaterial({
      color: 0x161a21,
      roughness: 0.86,
      metalness: 0.25,
      side: THREE.DoubleSide,
    })
  );
  group.add(roof);

  // LED advertising ring
  const ledTex = makeAdTexture(
    ledText || 'JUNCTION STADIUM  ·  NORTHGATE  ·  RIVERMOUTH  ·  LIVE  ',
  );
  ledTex.repeat.set(22, 1);
  const ledProfile = [
    { o: -3.4, y: 0.12 },
    { o: -3.4, y: 1.08 },
  ];
  const ledGeo = sweepProfile(ledProfile, 180);
  const led = new THREE.Mesh(
    ledGeo,
    new THREE.MeshBasicMaterial({ map: ledTex, side: THREE.DoubleSide, toneMapped: false })
  );
  group.add(led);

  return { group, seats, ledTex };
}

function buildSky() {
  const geo = new THREE.SphereGeometry(600, 32, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x05070f) },
      mid: { value: new THREE.Color(0x0d1730) },
      bottom: { value: new THREE.Color(0x1b2436) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 c = mix(bottom, mid, smoothstep(-0.1, 0.25, h));
        c = mix(c, top, smoothstep(0.25, 0.85, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  return sky;
}

function buildFloodlights() {
  const group = new THREE.Group();
  const positions = [];
  const glowTex = makeGlowTexture();
  const steel = new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.7, metalness: 0.6 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0, toneMapped: false });
  const corners = [
    [A + 21, B + 20],
    [-(A + 21), B + 20],
    [A + 21, -(B + 20)],
    [-(A + 21), -(B + 20)],
  ];

  for (const [x, z] of corners) {
    const h = 42;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.1, h, 8), steel);
    mast.position.set(x, h / 2, z);
    group.add(mast);

    const rig = new THREE.Group();
    rig.position.set(x, h, z);
    rig.lookAt(0, 0, 0);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(9, 4.4, 0.6), steel);
    rig.add(frame);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const lamp = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.5), lampMat);
        lamp.position.set(-3.2 + i * 2.15, -0.9 + j * 1.9, 0.34);
        rig.add(lamp);
      }
    }
    group.add(rig);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.55,
      })
    );
    glow.scale.set(26, 26, 1);
    glow.position.set(x, h, z);
    group.add(glow);

    positions.push(new THREE.Vector3(x, h, z));
  }
  return { group, positions };
}

export function createStadium({ ledText } = {}) {
  const group = new THREE.Group();

  const sky = buildSky();
  group.add(sky);

  const bowl = buildBowl(ledText);
  group.add(bowl.group);

  const crowd = createCrowd(bowl.seats);
  group.add(crowd.mesh);

  const flood = buildFloodlights();
  group.add(flood.group);

  // corner gap filler walls so the bowl reads as a closed volume
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1c2028, roughness: 0.95 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.2, 20, 1.2), wallMat);
      w.position.set(sx * (A + 10), 10, sz * (B + 10));
      group.add(w);
    }
  }

  return {
    group,
    crowd,
    seats: bowl.seats.length,
    ledTex: bowl.ledTex,
    floodlightPositions: flood.positions,
    update(dt) {
      crowd.update(dt);
      bowl.ledTex.offset.x = (bowl.ledTex.offset.x + dt * 0.03) % 1;
    },
  };
}
