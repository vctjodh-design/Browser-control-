import * as THREE from 'three';
import { PITCH } from '../config.js';

const R = 0.112;
const G = -9.81;

function makeBallTexture() {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f6f7f4';
  ctx.fillRect(0, 0, W, H);

  // panel seams
  ctx.strokeStyle = 'rgba(120,124,132,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    const x = (i / 7) * W;
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 40, H * 0.33, x - 40, H * 0.66, x, H);
    ctx.stroke();
  }

  function pent(cx, cy, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.92;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#15181d';
    ctx.fill();
  }

  const spots = [
    [40, 60, 26, 0.2],
    [140, 200, 24, 0.9],
    [230, 70, 27, 1.6],
    [320, 195, 25, 0.4],
    [410, 65, 26, 2.1],
    [490, 190, 24, 1.1],
    [95, 130, 18, 1.4],
    [275, 145, 17, 0.7],
    [455, 128, 18, 2.4],
  ];
  for (const s of spots) pent(...s);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class MatchBall {
  constructor() {
    const geo = new THREE.SphereGeometry(R, 24, 18);
    const mat = new THREE.MeshStandardMaterial({
      map: makeBallTexture(),
      roughness: 0.42,
      metalness: 0.03,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.position.set(0, R, 0);

    this.pos = new THREE.Vector3(0, R, 0);
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.held = false;
    this.lastTouch = null;
    this.lastTouchTeam = null;
    this.radius = R;
    this.rotation = new THREE.Euler();
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, R, z);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.held = false;
    this.mesh.position.copy(this.pos);
  }

  kick(dir, power, lift = 0.16, spin = 0) {
    this.held = false;
    const d = dir.clone().normalize();
    this.vel.set(d.x * power, power * lift, d.z * power);
    // topspin / backspin on the z-ish axis for curve
    this.spin.set(-d.z * spin, 0, d.x * spin);
  }

  update(dt) {
    if (this.held) {
      this.mesh.position.copy(this.pos);
      return;
    }
    const steps = Math.max(1, Math.ceil(dt / 0.012));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.integrate(h);

    // visual rolling / tumbling
    const speed = this.vel.length();
    if (speed > 0.05) {
      const axis = new THREE.Vector3(this.vel.z, 0, -this.vel.x).normalize();
      const spinRate = this.vel.length() / R;
      this.mesh.rotateOnWorldAxis(axis, spinRate * dt * 0.55);
    }
    this.mesh.position.copy(this.pos);
  }

  integrate(h) {
    // gravity + quadratic air drag
    this.vel.y += G * h;
    const speed = this.vel.length();
    if (speed > 0.01) {
      const drag = 0.0018 * speed * speed;
      this.vel.addScaledVector(this.vel.clone().normalize(), -drag * h);
      // Magnus effect (curve)
      const magnus = new THREE.Vector3().crossVectors(this.spin, this.vel).multiplyScalar(0.00055);
      this.vel.addScaledVector(magnus, h);
    }
    this.pos.addScaledVector(this.vel, h);

    // ground
    if (this.pos.y < R) {
      this.pos.y = R;
      if (this.vel.y < -0.4) {
        this.vel.y = -this.vel.y * 0.48;
        this.vel.x *= 0.82;
        this.vel.z *= 0.82;
      } else {
        this.vel.y = 0;
        // rolling friction: a rolling ball loses roughly a fifth of its speed
        // per second on grass, so passes carry and long shots reach the goal
        const f = Math.exp(-0.3 * h);
        this.vel.x *= f;
        this.vel.z *= f;
      }
      this.spin.multiplyScalar(0.9);
    }

    this.checkFrames();
  }

  checkFrames() {
    // goal posts + crossbar collisions
    for (const side of [-1, 1]) {
      const gx = side * PITCH.halfLength;
      const halfG = PITCH.goalWidth / 2;
      for (const gz of [-halfG, halfG]) {
        const dx = this.pos.x - gx;
        const dz = this.pos.z - gz;
        const d = Math.hypot(dx, dz);
        const minD = R + 0.062;
        if (d < minD && this.pos.y < PITCH.goalHeight + 0.1) {
          const nx = dx / (d || 1);
          const nz = dz / (d || 1);
          this.pos.x = gx + nx * minD;
          this.pos.z = gz + nz * minD;
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) {
            this.vel.x -= 1.6 * vn * nx;
            this.vel.z -= 1.6 * vn * nz;
            this.vel.multiplyScalar(0.72);
          }
        }
      }
      // crossbar
      if (
        Math.abs(this.pos.x - gx) < R + 0.062 &&
        Math.abs(this.pos.z) < halfG + 0.1 &&
        Math.abs(this.pos.y - PITCH.goalHeight) < R + 0.062
      ) {
        this.pos.y = PITCH.goalHeight + (this.pos.y > PITCH.goalHeight ? R + 0.062 : -R - 0.062);
        this.vel.y *= -0.55;
        this.vel.x *= 0.7;
      }
    }
  }
}
