const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Scope {
  constructor(canvas, { outAnalyser } = {}) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.out = outAnalyser;
    this.freq = new Uint8Array(2048);
    this.wave = new Uint8Array(2048);
    this.running = false;
    this.raf = 0;
    this.w = 1;
    this.h = 1;
    this.mode = 'split';
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }

  setMode(mode) {
    if (mode === 'split' || mode === 'spectrum' || mode === 'wave') this.mode = mode;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.smooth = new Float32Array(Math.max(2, Math.round(this.w)));
    this.smooth.fill(0);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  draw() {
    const c = this.c;
    const w = this.w;
    const h = this.h;
    if (!w || !h) return;

    c.clearRect(0, 0, w, h);

    const mode = this.mode;
    const top = 22;
    const bottom = h - 14;
    const waveH = mode === 'split' ? Math.min(52, h * 0.27) : 0;
    const specBottom = mode === 'split' ? h - waveH - 14 : bottom;
    const specH = Math.max(10, specBottom - top);

    if (mode === 'wave') {
      this.drawWaveGrid(c, w, top, bottom);
    } else {
      this.drawGrid(c, w, top, specBottom);
      this.drawSpectrum(c, w, top, specBottom, specH);
    }

    if (mode !== 'spectrum') {
      const wy = mode === 'split' ? h - waveH - 4 : top;
      const wh = mode === 'split' ? waveH : bottom - top;
      this.drawWave(c, w, wy, wh);
    }
  }

  drawGrid(c, w, top, bottom) {
    const h = bottom - top;
    c.strokeStyle = 'rgba(255,255,255,0.045)';
    c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = Math.round(top + (h * i) / 4) + 0.5;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }

    c.font = '8px -apple-system, system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.16)';
    for (const f of [100, 500, 1000, 5000, 10000]) {
      const x = Math.round(this.xOf(f, w)) + 0.5;
      c.strokeStyle = 'rgba(255,255,255,0.035)';
      c.beginPath();
      c.moveTo(x, top - 8);
      c.lineTo(x, bottom);
      c.stroke();
      c.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, bottom - 4);
    }
  }

  drawWaveGrid(c, w, top, bottom) {
    const h = bottom - top;
    const mid = top + h / 2;
    c.strokeStyle = 'rgba(255,255,255,0.05)';
    c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = Math.round(top + (h * i) / 4) + 0.5;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.strokeStyle = 'rgba(227,181,107,0.18)';
    c.beginPath();
    c.moveTo(0, Math.round(mid) + 0.5);
    c.lineTo(w, Math.round(mid) + 0.5);
    c.stroke();

    c.strokeStyle = 'rgba(255,255,255,0.03)';
    for (let i = 1; i < 8; i++) {
      const x = Math.round((w * i) / 8) + 0.5;
      c.beginPath();
      c.moveTo(x, top);
      c.lineTo(x, bottom);
      c.stroke();
    }
  }

  xOf(f, w) {
    const fMin = 30;
    const fMax = 18000;
    return (Math.log(f / fMin) / Math.log(fMax / fMin)) * w;
  }

  drawSpectrum(c, w, top, bottom, specH) {
    const ana = this.out;
    let binHz = 23.4;
    if (ana) {
      if (this.freq.length !== ana.frequencyBinCount) {
        this.freq = new Uint8Array(ana.frequencyBinCount);
      }
      ana.getByteFrequencyData(this.freq);
      binHz = (ana.context.sampleRate || 48000) / ana.fftSize;
    }

    const pts = Math.max(2, Math.round(w));
    if (!this.smooth || this.smooth.length !== pts) this.smooth = new Float32Array(pts);
    const sm = this.smooth;
    const fMin = 30;
    const fMax = 18000;

    c.beginPath();
    c.moveTo(0, bottom);
    for (let i = 0; i < pts; i++) {
      const f = fMin * Math.pow(fMax / fMin, i / (pts - 1));
      const b = f / binHz;
      const i0 = Math.floor(b);
      const fr = b - i0;
      let v = 0;
      if (i0 >= 0 && i0 + 1 < this.freq.length) {
        v = (this.freq[i0] * (1 - fr) + this.freq[i0 + 1] * fr) / 255;
      }
      v = Math.pow(v, 0.72);

      v *= 0.72 + 0.55 * Math.min(1, f / 2500);
      v = clamp(v, 0, 1);
      sm[i] += (v - sm[i]) * 0.42;
      const y = bottom - sm[i] * specH;
      c.lineTo(i, y);
    }
    c.lineTo(w, bottom);
    c.closePath();

    const grad = c.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, 'rgba(227,181,107,0.32)');
    grad.addColorStop(0.55, 'rgba(227,181,107,0.1)');
    grad.addColorStop(1, 'rgba(227,181,107,0.01)');
    c.fillStyle = grad;
    c.fill();

    c.beginPath();
    for (let i = 0; i < pts; i++) {
      const y = bottom - sm[i] * specH;
      if (i === 0) c.moveTo(i, y);
      else c.lineTo(i, y);
    }
    c.strokeStyle = 'rgba(227,181,107,0.2)';
    c.lineWidth = 4;
    c.stroke();
    c.strokeStyle = 'rgba(246,217,166,0.92)';
    c.lineWidth = 1.4;
    c.stroke();
  }

  drawWave(c, w, wy, waveH) {
    const ana = this.out;
    const wcy = wy + waveH / 2;

    c.strokeStyle = 'rgba(255,255,255,0.06)';
    c.beginPath();
    c.moveTo(0, wcy);
    c.lineTo(w, wcy);
    c.stroke();

    if (!ana) return;
    if (this.wave.length !== ana.fftSize) this.wave = new Uint8Array(ana.fftSize);
    ana.getByteTimeDomainData(this.wave);
    const len = this.wave.length;
    const n = Math.min(1024, Math.round(w));
    const amp = waveH / 2 - 3;

    c.beginPath();
    for (let i = 0; i < n; i++) {
      const idx = Math.floor((i / n) * len);
      const v = (this.wave[idx] - 128) / 128;
      const x = (i / (n - 1)) * w;
      const y = wcy + v * amp;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.strokeStyle = 'rgba(246,217,166,0.22)';
    c.lineWidth = 3.4;
    c.stroke();
    c.strokeStyle = 'rgba(246,217,166,0.62)';
    c.lineWidth = 1.3;
    c.stroke();
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._resize);
  }
}
