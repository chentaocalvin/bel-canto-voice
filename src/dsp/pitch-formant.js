import { FFT } from './fft.js';

const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class VoiceSculptor {
  constructor(sampleRate, options = {}) {
    const fftSize = options.fftSize ?? 2048;
    const hopSize = options.hopSize ?? 256;

    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.hopSize = hopSize;
    this.half = fftSize >> 1;

    this.fft = new FFT(fftSize);

    this.window = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((TAU * i) / fftSize);
    }

    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
    this.mag = new Float64Array(this.half + 1);
    this.phase = new Float64Array(this.half + 1);
    this.prevPhase = new Float64Array(this.half + 1);
    this.sumPhase = new Float64Array(this.half + 1);
    this.omega = new Float64Array(this.half + 1);
    this.trueOmega = new Float64Array(this.half + 1);
    for (let k = 0; k <= this.half; k++) {
      this.omega[k] = (TAU * k * hopSize) / fftSize;
    }

    this.cepRe = new Float64Array(fftSize);
    this.cepIm = new Float64Array(fftSize);
    this.env = new Float64Array(this.half + 1);
    this.warpedMag = new Float64Array(this.half + 1);

    this.quefrency = clamp(Math.round(sampleRate * 0.0028), 24, (fftSize >> 2) - 1);

    this.inSize = 8192;
    this.inMask = this.inSize - 1;
    this.inBuf = new Float64Array(this.inSize);
    this.inPos = 0;
    this.acc = 0;

    this.olaSize = 32768;
    this.olaMask = this.olaSize - 1;
    this.ola = new Float64Array(this.olaSize);
    this.norm = new Float64Array(this.olaSize);
    this.olaWrite = 0;

    this.rdPos = this.olaSize - fftSize;
    this.clearPos = (this.rdPos - 3) & this.olaMask;
    this.started = false;

    this.targetPitch = 0;
    this.targetFormant = 0;
    this.preserve = true;
    this.pitchSmooth = 0;
    this.formantSmooth = 0;

    this.paramSmoothTau = 0;
  }

  getLatency() {
    return this.fftSize;
  }

  setParams(params = {}, options = {}) {
    if (typeof params.pitch === 'number') this.targetPitch = clamp(params.pitch, -24, 24);
    if (typeof params.formant === 'number') this.targetFormant = clamp(params.formant, -24, 24);
    if (typeof params.preserve === 'boolean') this.preserve = params.preserve;

    if (options.smoothTau !== undefined) {
      this.paramSmoothTau = Math.max(0, options.smoothTau || 0);
    }
  }

  reset() {
    this.inBuf.fill(0);
    this.ola.fill(0);
    this.norm.fill(0);
    this.prevPhase.fill(0);
    this.sumPhase.fill(0);
    this.phase.fill(0);
    this.inPos = 0;
    this.acc = 0;
    this.olaWrite = 0;
    this.rdPos = this.olaSize - this.fftSize;
    this.clearPos = (this.rdPos - 3) & this.olaMask;
    this.started = false;
    this.pitchSmooth = this.targetPitch;
    this.formantSmooth = this.targetFormant;
  }

  process(input, output, length) {
    const inBuf = this.inBuf;
    const inMask = this.inMask;
    const hop = this.hopSize;

    for (let i = 0; i < length; i++) {
      inBuf[this.inPos & inMask] = input ? input[i] : 0;
      this.inPos++;
      if (++this.acc >= hop) {
        this.acc = 0;
        this.renderFrame();
      }
      output[i] = this.readSample();
    }
  }

  renderFrame() {
    const N = this.fftSize;
    const half = this.half;
    const H = this.hopSize;
    const win = this.window;
    const re = this.re;
    const im = this.im;

    const start = this.inPos - N;
    for (let i = 0; i < N; i++) {
      re[i] = this.inBuf[(start + i) & this.inMask] * win[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);

    for (let k = 0; k <= half; k++) {
      const r = re[k];
      const ii = im[k];
      this.mag[k] = Math.sqrt(r * r + ii * ii);
      this.phase[k] = Math.atan2(ii, r);
    }

    for (let k = 0; k <= half; k++) {
      let d = this.phase[k] - this.prevPhase[k] - this.omega[k];
      d -= TAU * Math.round(d / TAU);
      this.trueOmega[k] = (TAU * k) / N + d / H;
      this.prevPhase[k] = this.phase[k];
    }

    const paramAlpha =
      this.paramSmoothTau > 0 ? 1 - Math.exp(-H / (this.paramSmoothTau * this.sampleRate)) : 0.08;
    this.pitchSmooth += (this.targetPitch - this.pitchSmooth) * paramAlpha;
    this.formantSmooth += (this.targetFormant - this.formantSmooth) * paramAlpha;
    const p = Math.pow(2, this.pitchSmooth / 12);
    const fTarget = (this.preserve ? 1 : p) * Math.pow(2, this.formantSmooth / 12);
    const warp = fTarget / p;

    const magIn = Math.abs(warp - 1) > 0.004 ? this.warpEnvelope(warp) : this.mag;

    const first = !this.started;
    for (let k = 0; k <= half; k++) {
      const srcF = k / p;
      let m = 0;
      let freq = this.trueOmega[0];
      let srcPhase = this.phase[0];

      if (srcF <= half) {
        const j = srcF | 0;
        const fr = srcF - j;
        const j1 = j + 1 <= half ? j + 1 : half;
        m = magIn[j] * (1 - fr) + magIn[j1] * fr;
        freq = this.trueOmega[j] * (1 - fr) + this.trueOmega[j1] * fr;
        srcPhase = this.phase[j];
      }

      let ph;
      if (first) {
        ph = srcPhase;
      } else {
        ph = this.sumPhase[k] + freq * p * H;
        ph -= TAU * Math.floor(ph / TAU);
      }
      this.sumPhase[k] = ph;

      const c = m * Math.cos(ph);
      const s = m * Math.sin(ph);
      re[k] = c;
      im[k] = s;
      if (k > 0 && k < half) {
        re[N - k] = c;
        im[N - k] = -s;
      }
    }
    this.started = true;

    this.fft.inverse(re, im);

    const ola = this.ola;
    const norm = this.norm;
    const mask = this.olaMask;
    const w = this.olaWrite;
    for (let i = 0; i < N; i++) {
      const wi = win[i];
      const idx = (w + i) & mask;
      ola[idx] += re[i] * wi;
      norm[idx] += wi * wi;
    }
    this.olaWrite = (w + H) & mask;
  }

  warpEnvelope(g) {
    const N = this.fftSize;
    const half = this.half;
    const cr = this.cepRe;
    const ci = this.cepIm;
    const mag = this.mag;

    cr[0] = Math.log(mag[0] + 1e-9);
    ci[0] = 0;
    cr[half] = Math.log(mag[half] + 1e-9);
    ci[half] = 0;
    for (let k = 1; k < half; k++) {
      const v = Math.log(mag[k] + 1e-9);
      cr[k] = v;
      ci[k] = 0;
      cr[N - k] = v;
      ci[N - k] = 0;
    }

    this.fft.inverse(cr, ci);

    const q = this.quefrency;
    for (let i = 0; i < N; i++) {
      let wgt = 0;
      if (i <= q) wgt = 0.5 + 0.5 * Math.cos((Math.PI * i) / (q + 1));
      else if (i >= N - q) wgt = 0.5 + 0.5 * Math.cos((Math.PI * (N - i)) / (q + 1));
      cr[i] *= wgt;
      ci[i] *= wgt;
    }

    this.fft.transform(cr, ci);
    const env = this.env;
    for (let k = 0; k <= half; k++) env[k] = Math.exp(cr[k]);

    const out = this.warpedMag;
    for (let k = 0; k <= half; k++) {
      const src = k / g;
      let e;
      if (src >= half) {
        e = env[half];
      } else {
        const i0 = src | 0;
        const f = src - i0;
        e = env[i0] * (1 - f) + env[i0 + 1] * f;
      }
      let ratio = e / (env[k] + 1e-12);

      if (!(ratio > 0.1)) ratio = 0.1;
      else if (ratio > 10) ratio = 10;
      out[k] = mag[k] * ratio;
    }
    return out;
  }

  readSample() {
    const ola = this.ola;
    const norm = this.norm;
    const mask = this.olaMask;
    const p = this.rdPos;
    const i0 = p | 0;
    const t = p - i0;

    const y0 = ola[(i0 - 1) & mask];
    const y1 = ola[i0 & mask];
    const y2 = ola[(i0 + 1) & mask];
    const y3 = ola[(i0 + 2) & mask];
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    const v = ((c3 * t + c2) * t + c1) * t + y1;

    const n0 = norm[i0 & mask];
    const n1 = norm[(i0 + 1) & mask];
    const nv = n0 + (n1 - n0) * t;

    this.rdPos = (p + 1) & (this.olaSize - 1);

    const target = (i0 - 3) & mask;
    let cp = this.clearPos;
    while (cp !== target) {
      ola[cp] = 0;
      norm[cp] = 0;
      cp = (cp + 1) & mask;
    }
    this.clearPos = cp;

    if (!(nv > 0.02)) return 0;
    return v / nv;
  }
}
