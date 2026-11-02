import * as THREE from 'three';

function noise2(x, y) {
  // cheap value noise
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/** Main pitch surface: mown stripes, wear, subtle colour variation. */
export function makePitchTexture() {
  const W = 1024;
  const H = 664;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2b6432';
  ctx.fillRect(0, 0, W, H);

  // mowing stripes running along the length of the pitch
  const bands = 18;
  const bandH = H / bands;
  for (let i = 0; i < bands; i++) {
    const light = i % 2 === 0;
    ctx.fillStyle = light ? 'rgba(132, 198, 118, 0.10)' : 'rgba(6, 34, 12, 0.11)';
    ctx.fillRect(0, i * bandH, W, bandH + 1);
  }

  // fine grass grain
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const g = (noise2(x * 1.7, y * 1.7) - 0.5) * 22 + (Math.random() - 0.5) * 16;
      const blotch = Math.sin(x * 0.014) * Math.cos(y * 0.02) * 9;
      d[i] = Math.max(0, Math.min(255, d[i] + g * 0.55 + blotch));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + g + blotch * 1.5));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + g * 0.4 + blotch * 0.4));
    }
  }
  ctx.putImageData(img, 0, 0);

  // goalmouth + centre wear
  const wear = (cx, cy, r, alpha) => {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(88, 78, 48, ${alpha})`);
    grad.addColorStop(0.65, `rgba(70, 82, 44, ${alpha * 0.45})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  wear(22, H * 0.5, 90, 0.3);
  wear(W - 22, H * 0.5, 90, 0.3);
  wear(W * 0.5, H * 0.5, 130, 0.16);
  // touchline scuffs
  ctx.fillStyle = 'rgba(60, 74, 40, 0.13)';
  ctx.fillRect(0, 6, W, 10);
  ctx.fillRect(0, H - 16, W, 10);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Height-derived normal map that gives grass blades a bit of sparkle up close. */
export function makeGrassNormal() {
  const S = 256;
  const height = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) height[i] = Math.random() * 0.6 + Math.random() * 0.4;

  // smooth a little so it reads as blades rather than static
  const src = height.slice();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = (x + dx + S) % S;
          const ny = (y + dy + S) % S;
          sum += src[ny * S + nx];
          count++;
        }
      }
      height[y * S + x] = sum / count;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const strength = 26;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const l = height[y * S + ((x - 1 + S) % S)];
      const r = height[y * S + ((x + 1) % S)];
      const u = height[((y - 1 + S) % S) * S + x];
      const dn = height[((y + 1) % S) * S + x];
      const nx = (l - r) * strength;
      const ny = (u - dn) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Shirt back: squad number + name. */
export function makeShirtTexture(number, name, shirtColor, textColor = '#ffffff') {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px "Barlow Condensed", Arial, sans-serif';
  ctx.fillText(name, S / 2, 44);
  ctx.font = 'bold 150px "Barlow Condensed", Impact, Arial, sans-serif';
  ctx.fillText(String(number), S / 2, 196);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** LED advertising hoarding strip. */
export function makeAdTexture(text, bg = '#0e2b52', fg = '#eaf4ff') {
  const W = 2048;
  const H = 160;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, '#061423');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // subtle scan lines for LED look
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.fillStyle = fg;
  ctx.font = 'bold 58px "Barlow Condensed", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** radial glow sprite for floodlights / lens flare feel */
export function makeGlowTexture(inner = 'rgba(255,250,235,1)', outer = 'rgba(180,205,255,0)') {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, 'rgba(255,248,225,0.5)');
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
