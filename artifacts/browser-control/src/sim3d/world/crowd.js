import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function fanGeometry() {
  const torso = new THREE.BoxGeometry(0.36, 0.56, 0.22, 1, 2, 1);
  torso.translate(0, 0.62, 0);
  // taper the shoulders a touch
  const pos = torso.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.8) {
      pos.setX(i, pos.getX(i) * 0.9);
      pos.setZ(i, pos.getZ(i) * 0.9);
    }
  }
  torso.computeVertexNormals();

  const head = new THREE.SphereGeometry(0.115, 6, 4);
  head.translate(0, 1.03, 0);

  const legs = new THREE.BoxGeometry(0.3, 0.36, 0.2);
  legs.translate(0, 0.18, 0);

  const merged = mergeGeometries([legs, torso, head], false);
  return merged;
}

const SHIRT_PALETTE_HOME = [
  0xb3102a, 0x9e0f22, 0xc0152e, 0xb9c2cc, 0x242b38, 0x1a2230, 0x6d0d18, 0x9c7a2c, 0x2a3550, 0x3d4450,
  0x8f8f96, 0x1d2330,
];
const SHIRT_PALETTE_AWAY = [
  0x1a46b8, 0x17409f, 0x2152cf, 0xb9c2cc, 0x0e1626, 0x3360d8, 0x6d7890, 0x1a2230,
];

export function createCrowd(seats) {
  const count = seats.length;
  const geo = fanGeometry();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
  });

  const uniforms = {
    uTime: { value: 0 },
    uExcite: { value: 0 },
  };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uExcite = uniforms.uExcite;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aPhase;
         uniform float uTime;
         uniform float uExcite;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float ph = aPhase;
         float sway = sin(uTime * (1.4 + ph * 0.5) + ph * 20.0);
         float upper = smoothstep(0.35, 1.1, transformed.y);
         float amt = (0.012 + uExcite * 0.14) * upper;
         transformed.y += sway * amt;
         transformed.x += sin(uTime * 0.9 + ph * 7.0) * uExcite * 0.07 * upper;
         transformed.z += cos(uTime * 0.6 + ph * 3.0) * uExcite * 0.04 * upper;`
      );
  };
  mat.userData.uniforms = uniforms;

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.frustumCulled = false;

  const phases = new Float32Array(count);
  const color = new THREE.Color();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const s = seats[i];
    e.set(0, s.yaw + (Math.random() - 0.5) * 0.5, 0);
    q.setFromEuler(e);
    const scale = 0.9 + Math.random() * 0.2;
    // mix of seated and standing supporters
    const seated = Math.random() < 0.55;
    v.set(s.x, s.y - (seated ? 0.12 : 0), s.z);
    sc.set(scale, scale * (seated ? 0.68 + Math.random() * 0.1 : 0.96 + Math.random() * 0.16), scale);
    m.compose(v, q, sc);
    mesh.setMatrixAt(i, m);
    phases[i] = Math.random() * Math.PI * 2;

    const palette = s.away ? SHIRT_PALETTE_AWAY : SHIRT_PALETTE_HOME;
    const base = palette[(Math.random() * palette.length) | 0];
    color.setHex(base);
    color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
    // stands sit in shade compared with the pitch
    color.multiplyScalar(0.62 + Math.random() * 0.22);
    mesh.setColorAt(i, color);
  }
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  let excite = 0;
  let target = 0;

  return {
    mesh,
    setExcitement(value) {
      target = value;
    },
    update(dt) {
      excite += (target - excite) * Math.min(1, dt * 2.4);
      uniforms.uTime.value += dt;
      uniforms.uExcite.value = 0.06 + excite;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
