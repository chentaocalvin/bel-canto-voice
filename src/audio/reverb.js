function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildImpulseResponse(ctx, size = 0.5) {
  const rand = mulberry32(Math.round(size * 100000) + 20261111);
  const sr = ctx.sampleRate;
  const seconds = 0.8 + size * 4.6;
  const length = Math.max(64, Math.floor(sr * seconds));
  const buffer = ctx.createBuffer(2, length, sr);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    let lp2 = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;

      const env = Math.pow(1 - t, 1.6) * Math.exp(-2.2 * t);
      const noise = rand() * 2 - 1;

      const coef = 0.62 - 0.5 * t;
      lp += coef * (noise - lp);
      lp2 += coef * (lp - lp2);
      data[i] = lp2 * env * 1.6;
    }

    const taps = 7 + Math.floor(size * 7);
    for (let k = 0; k < taps; k++) {
      const ms = 6 + rand() * (14 + size * 46);
      const pos = Math.floor((ms / 1000) * sr);
      if (pos < length) {
        const gain = (0.15 + rand() * 0.55) * (1 - k / (taps + 2));
        data[pos] += (rand() < 0.5 ? -1 : 1) * gain;
      }
    }
  }

  let peak = 1e-6;
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const g = 0.9 / peak;
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
  return buffer;
}
