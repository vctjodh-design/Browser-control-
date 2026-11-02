import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PITCH } from '../config.js';
import { makePitchTexture, makeGrassNormal } from './textures.js';

const L = PITCH.halfLength;
const W = PITCH.halfWidth;

function buildMarkings() {
  const geos = [];
  const Y = 0.02;
  const LW = 0.12;

  function seg(x1, z1, x2, z2, width = LW) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const g = new THREE.PlaneGeometry(len, width);
    g.rotateX(-Math.PI / 2);
    g.rotateY(-Math.atan2(dz, dx));
    g.translate((x1 + x2) / 2, Y, (z1 + z2) / 2);
    geos.push(g);
  }

  function rect(cx, cz, w, l) {
    const x1 = cx - w / 2;
    const x2 = cx + w / 2;
    const z1 = cz - l / 2;
    const z2 = cz + l / 2;
    seg(x1, z1, x2, z1);
    seg(x2, z1, x2, z2);
    seg(x2, z2, x1, z2);
    seg(x1, z2, x1, z1);
  }

  function arc(cx, cz, r, a0, a1, steps = 48) {
    for (let i = 0; i < steps; i++) {
      const t0 = a0 + ((a1 - a0) * i) / steps;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
      seg(cx + Math.cos(t0) * r, cz + Math.sin(t0) * r, cx + Math.cos(t1) * r, cz + Math.sin(t1) * r);
    }
  }

  // touchlines + goal lines
  seg(-L, -W, L, -W);
  seg(-L, W, L, W);
  seg(-L, -W, -L, W);
  seg(L, -W, L, W);

  // halfway line + centre circle + spot
  seg(0, -W, 0, W);
  arc(0, 0, PITCH.centerCircle, 0, Math.PI * 2, 96);
  const spot = new THREE.CircleGeometry(0.11, 20);
  spot.rotateX(-Math.PI / 2);
  spot.translate(0, Y, 0);
  geos.push(spot);

  for (const side of [-1, 1]) {
    const gx = side * L;
    const boxX = gx - side * PITCH.penaltyDepth;
    // penalty area
    rect(gx - side * (PITCH.penaltyDepth / 2), 0, PITCH.penaltyDepth, PITCH.penaltyWidth);
    // six yard box
    rect(gx - side * (PITCH.sixDepth / 2), 0, PITCH.sixDepth, PITCH.sixWidth);
    // penalty spot
    const ps = new THREE.CircleGeometry(0.11, 20);
    ps.rotateX(-Math.PI / 2);
    ps.translate(gx - side * PITCH.penaltySpot, Y, 0);
    geos.push(ps);
    // penalty arc (only the part outside the box)
    const spotX = gx - side * PITCH.penaltySpot;
    const ratio = Math.min(0.999, (PITCH.penaltyDepth - PITCH.penaltySpot) / PITCH.centerCircle);
    const spread = Math.acos(ratio);
    const mid = side > 0 ? Math.PI : 0;
    arc(spotX, 0, PITCH.centerCircle, mid - spread, mid + spread, 40);
    // goal line paint between posts stays part of goal line already
    void boxX;
  }

  // corner arcs
  const corners = [
    [-L, -W, 0, Math.PI / 2],
    [L, -W, Math.PI / 2, Math.PI],
    [L, W, Math.PI, Math.PI * 1.5],
    [-L, W, Math.PI * 1.5, Math.PI * 2],
  ];
  for (const [cx, cz, a0, a1] of corners) arc(cx, cz, PITCH.cornerRadius, a0, a1, 12);

  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

function buildGoal(side) {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({
    color: 0xf2f5fa,
    roughness: 0.35,
    metalness: 0.35,
  });
  const R = 0.062;
  const H = PITCH.goalHeight;
  const halfG = PITCH.goalWidth / 2;
  const depth = PITCH.goalDepth;
  const gx = side * L;

  const post1 = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 12), postMat);
  post1.position.set(gx, H / 2, -halfG);
  const post2 = post1.clone();
  post2.position.z = halfG;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(R, R, PITCH.goalWidth, 12), postMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(gx, H, 0);

  // rear support frame
  const backX = gx + side * depth;
  const postMat2 = postMat.clone();
  postMat2.color.set(0xdfe6ef);
  postMat2.roughness = 0.55;
  const rp1 = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.6, R * 0.6, H * 0.72, 10), postMat2);
  rp1.position.set(backX, (H * 0.72) / 2, -halfG);
  const rp2 = rp1.clone();
  rp2.position.z = halfG;
  const rbar = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.6, R * 0.6, PITCH.goalWidth, 10), postMat2);
  rbar.rotation.x = Math.PI / 2;
  rbar.position.set(backX, H * 0.72, 0);

  for (const m of [post1, post2, bar, rp1, rp2, rbar]) {
    m.castShadow = true;
    group.add(m);
  }

  // ---- net ----
  const pts = [];
  const step = 0.19;
  const steps = 10;
  const topBack = H * 0.72;
  // back panel
  for (let z = -halfG; z <= halfG + 1e-6; z += step) pts.push(backX, 0, z, backX, topBack, z);
  for (let y = 0; y <= topBack + 1e-6; y += step * 1.1) pts.push(backX, y, -halfG, backX, y, halfG);
  // side panels
  for (const z of [-halfG, halfG]) {
    for (let x = Math.min(gx, backX); x <= Math.max(gx, backX) + 1e-6; x += step) {
      const t = (x - gx) / (backX - gx || 1);
      pts.push(x, 0, z, x, H - t * (H - topBack), z);
    }
  }
  // roof panel
  for (let z = -halfG; z <= halfG + 1e-6; z += step) pts.push(gx, H, z, backX, topBack, z);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(gx + (backX - gx) * t, H - t * (H - topBack), -halfG, gx + (backX - gx) * t, H - t * (H - topBack), halfG);
  }

  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const net = new THREE.LineSegments(
    netGeo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })
  );
  group.add(net);

  // faint mesh sheet so the net reads as a surface from distance
  const sheetMat = new THREE.MeshBasicMaterial({
    color: 0xdfe8f5,
    transparent: true,
    opacity: 0.045,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const backSheet = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.goalWidth, topBack), sheetMat);
  backSheet.position.set(backX, topBack / 2, 0);
  backSheet.rotation.y = Math.PI / 2;
  group.add(backSheet);

  return group;
}

export function createPitch() {
  const group = new THREE.Group();

  // dark surround so nothing shows sky through the turf
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 190),
    new THREE.MeshStandardMaterial({ color: 0x1b3a22, roughness: 1 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.03;
  apron.receiveShadow = true;
  group.add(apron);

  const pitchTex = makePitchTexture();
  const grassNormal = makeGrassNormal();
  grassNormal.repeat.set(46, 30);
  grassNormal.needsUpdate = true;

  const grassMat = new THREE.MeshStandardMaterial({
    map: pitchTex,
    normalMap: grassNormal,
    normalScale: new THREE.Vector2(0.12, 0.12),
    roughness: 0.94,
    metalness: 0.0,
    color: 0xd4e0c8,
  });

  const turf = new THREE.Mesh(new THREE.PlaneGeometry(L * 2, W * 2), grassMat);
  turf.rotation.x = -Math.PI / 2;
  turf.receiveShadow = true;
  group.add(turf);

  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf6f8f2,
    roughness: 0.72,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const markings = new THREE.Mesh(buildMarkings(), lineMat);
  markings.receiveShadow = true;
  group.add(markings);

  group.add(buildGoal(1));
  group.add(buildGoal(-1));

  // corner flags
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xf7d94a, roughness: 0.8, side: THREE.DoubleSide });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xe8edf5, roughness: 0.5 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.55, 8), poleMat);
      pole.position.set(sx * L, 0.775, sz * W);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), flagMat);
      flag.position.set(sx * L + 0.21 * -sx, 1.35, sz * W);
      flag.rotation.y = Math.PI / 2;
      group.add(pole, flag);
    }
  }

  return { group, grassMat };
}
