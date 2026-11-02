import * as THREE from 'three';
import { PITCH } from './config.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'broadcast';
    this.pos = new THREE.Vector3(0, 26, -60);
    this.look = new THREE.Vector3(0, 0, 0);
    this.shakeT = 0;
    this.cinematicAngle = 0;
    this.targetPos = new THREE.Vector3();
    this.targetLook = new THREE.Vector3();
    this.fov = 40;
    this.camera.fov = 40;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode) {
    this.mode = mode;
  }

  update(dt, match, focusPlayer) {
    const ball = match.ball.pos;
    const mode = match.state === 'warmup' ? 'cinematic' : this.mode;
    let damping = 3.4;
    let lookDamping = 4.4;
    let fovTarget = 40;

    if (mode === 'cinematic') {
      this.cinematicAngle += dt * 0.055;
      const a = this.cinematicAngle;
      const r = 78;
      this.targetPos.set(Math.cos(a) * r, 30 + Math.sin(a * 0.7) * 6, Math.sin(a) * (r * 0.72) - 8);
      this.targetLook.set(0, 4, 0);
      damping = 1.1;
      lookDamping = 1.4;
      fovTarget = 46;
    } else if (mode === 'broadcast') {
      const bx = ball.x;
      const bz = ball.z;
      this.targetPos.set(bx * 0.62, 13.2 + Math.abs(bz) * 0.02, -49 - Math.abs(bx) * 0.02);
      this.targetLook.set(bx * 0.86 + 1.0, 1.25, bz * 0.5);
      damping = 3.1;
      fovTarget = 29.5;
    } else if (mode === 'tactical') {
      this.targetPos.set(ball.x * 0.3, 56, -26);
      this.targetLook.set(ball.x * 0.55, 0, ball.z * 0.45);
      damping = 2.2;
      lookDamping = 2.6;
      fovTarget = 46;
    } else if (mode === 'behind') {
      const goalSide = ball.x > 0 ? 1 : -1;
      this.targetPos.set(goalSide * (PITCH.halfLength + 17), 15, clamp(ball.z * 0.25, -9, 9));
      this.targetLook.set(ball.x * 0.72, 1.2, ball.z * 0.7);
      damping = 2.6;
      fovTarget = 42;
    } else if (mode === 'player') {
      const p = focusPlayer || match.human;
      if (p) {
        const fx = Math.sin(p.facing);
        const fz = Math.cos(p.facing);
        this.targetPos.set(p.pos.x - fx * 8.5, 4.1, p.pos.z - fz * 8.5);
        this.targetLook.set(p.pos.x + fx * 9, 1.5, p.pos.z + fz * 9);
        damping = 4.2;
        lookDamping = 5.2;
        fovTarget = 52;
      }
    }

    const k = 1 - Math.exp(-dt * damping);
    const kl = 1 - Math.exp(-dt * lookDamping);
    this.pos.lerp(this.targetPos, k);
    this.look.lerp(this.targetLook, kl);

    // very subtle handheld drift so the shot feels like a real broadcast
    this.shakeT += dt;
    const sx = Math.sin(this.shakeT * 0.7) * 0.045 + Math.sin(this.shakeT * 2.3) * 0.012;
    const sy = Math.cos(this.shakeT * 0.53) * 0.03;

    this.camera.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
    this.camera.lookAt(this.look);
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 2);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
