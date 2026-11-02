/** Synthesised stadium atmosphere — no audio files needed. */
export class StadiumAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.excitement = 0;
    this.started = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);

    // brown-ish noise = crowd rumble
    const len = Math.floor(this.ctx.sampleRate * 3);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.0;
    }
    this.noiseBuffer = buffer;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    this.band = this.ctx.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.frequency.value = 620;
    this.band.Q.value = 0.55;

    this.low = this.ctx.createBiquadFilter();
    this.low.type = 'lowpass';
    this.low.frequency.value = 2600;

    this.ambGain = this.ctx.createGain();
    this.ambGain.gain.value = 0.5;

    src.connect(this.band).connect(this.low).connect(this.ambGain).connect(this.master);
    src.start();
    this.ambSource = src;

    this.master.gain.linearRampToValueAtTime(this.enabled ? 0.55 : 0, this.ctx.currentTime + 1.6);
    this.started = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setExcitement(v) {
    this.excitement = v;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.ambGain.gain.setTargetAtTime(0.42 + v * 0.75, t, 0.35);
    this.band.frequency.setTargetAtTime(560 + v * 420, t, 0.4);
    this.low.frequency.setTargetAtTime(2200 + v * 3200, t, 0.4);
  }

  noiseBurst({ gain = 0.5, dur = 2.6, freq = 900, q = 0.7, attack = 0.18 } = {}) {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.1);
  }

  cheer() {
    this.noiseBurst({ gain: 0.85, dur: 3.6, freq: 1100, q: 0.5, attack: 0.12 });
    this.noiseBurst({ gain: 0.4, dur: 2.4, freq: 2400, q: 0.9, attack: 0.3 });
    this.noiseBurst({ gain: 0.35, dur: 4.2, freq: 520, q: 0.4, attack: 0.5 });
  }

  ooh() {
    this.noiseBurst({ gain: 0.45, dur: 1.1, freq: 800, q: 1.2, attack: 0.08 });
  }

  whistle(times = 1) {
    if (!this.ctx) return;
    for (let i = 0; i < times; i++) {
      const now = this.ctx.currentTime + i * 0.32;
      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3000;
      bp.Q.value = 8;
      osc.type = 'sine';
      osc.frequency.value = 2950;
      osc2.type = 'sine';
      osc2.frequency.value = 3120;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      osc.connect(bp);
      osc2.connect(bp);
      bp.connect(g).connect(this.master);
      osc.start(now);
      osc2.start(now);
      osc.stop(now + 0.3);
      osc2.stop(now + 0.3);
    }
  }

  kick() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.09);
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(enabled ? 0.55 : 0, this.ctx.currentTime, 0.15);
  }
}
