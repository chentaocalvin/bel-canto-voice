import { VoiceSculptor } from '../src/dsp/pitch-formant.js';
import { FFT } from '../src/dsp/fft.js';

const SR = 48000;
const N = 2048;
const BLOCK = 128;

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

function runDSP(input, params, seconds = 2.4) {
  const sc = new VoiceSculptor(SR, { fftSize: N, hopSize: 256 });
  sc.setParams(params);

  sc.pitchSmooth = params.pitch ?? 0;
  sc.formantSmooth = params.formant ?? 0;

  const total = Math.ceil(seconds * SR);
  const padded = new Float32Array(total + SR);
  padded.set(input.subarray(0, Math.min(input.length, total)), 0);
  const out = new Float32Array(total);
  const block = new Float32Array(BLOCK);
  for (let i = 0; i < total; i += BLOCK) {
    block.set(padded.subarray(i, i + BLOCK));
    const ob = out.subarray(i, i + BLOCK);
    sc.process(block, ob, Math.min(BLOCK, total - i));
  }
  return out;
}

function rms(a, from = 0, to = a.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

function hasNaN(a) {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return true;
  return false;
}

function peakFreq(signal, from) {
  const size = 16384;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const start = Math.max(0, from);
  for (let i = 0; i < size; i++) re[i] = (signal[start + i] ?? 0) * win[i];
  const fft = new FFT(size);
  fft.transform(re, im);
  let best = 1;
  let bestMag = 0;
  for (let k = 2; k < size / 2; k++) {
    const m = Math.hypot(re[k], im[k]);
    if (m > bestMag) {
      bestMag = m;
      best = k;
    }
  }
  const a = Math.hypot(re[best - 1], im[best - 1]);
  const b = bestMag;
  const c = Math.hypot(re[best + 1], im[best + 1]);
  const delta = (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return ((best + delta) * SR) / size;
}

function spectrum(signal, from, seconds = 0.5) {
  const size = 32768;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const n = Math.min(size, Math.floor(seconds * SR));
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re[i] = (signal[from + i] ?? 0) * w;
  }
  new FFT(size).transform(re, im);
  const mag = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return { mag, binHz: SR / size };
}

function centroid(signal, from, lo = 150, hi = 5000) {
  const { mag, binHz } = spectrum(signal, from);
  let num = 0;
  let den = 0;
  for (let k = Math.ceil(lo / binHz); k < Math.min(mag.length, hi / binHz); k++) {
    num += mag[k] * k * binHz;
    den += mag[k];
  }
  return den > 0 ? num / den : 0;
}

function envelope(signal, from, seconds = 0.5) {
  const size = 32768;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const n = Math.min(size, Math.floor(seconds * SR));
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re[i] = (signal[from + i] ?? 0) * w;
  }
  const fft = new FFT(size);
  fft.transform(re, im);
  const half = size / 2;
  const logRe = new Float64Array(size);
  const logIm = new Float64Array(size);
  for (let k = 0; k <= half; k++) {
    const v = Math.log(Math.hypot(re[k], im[k]) + 1e-9);
    logRe[k] = v;
    if (k > 0 && k < half) logRe[size - k] = v;
  }
  fft.inverse(logRe, logIm);
  const q = Math.round(SR * 0.0015);
  for (let i = 0; i < size; i++) {
    let wgt = 0;
    if (i <= q) wgt = 0.5 + 0.5 * Math.cos((Math.PI * i) / (q + 1));
    else if (i >= size - q) wgt = 0.5 + 0.5 * Math.cos((Math.PI * (size - i)) / (q + 1));
    logRe[i] *= wgt;
    logIm[i] *= wgt;
  }
  fft.transform(logRe, logIm);
  const env = new Float64Array(half);
  for (let k = 0; k < half; k++) env[k] = logRe[k];
  return { env, binHz: SR / size };
}

function envelopePeak(signal, from, lo = 250, hi = 3500) {
  const { env, binHz } = envelope(signal, from);
  let best = Math.ceil(lo / binHz);
  for (let k = best; k < Math.min(env.length - 1, hi / binHz); k++) {
    if (env[k] > env[best]) best = k;
  }
  const a = env[best - 1];
  const b = env[best];
  const c = env[best + 1];
  const d = (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return (best + d) * binHz;
}

function f0of(signal, from, minF = 60, maxF = 1000) {
  const len = 8192;
  const minLag = Math.max(2, Math.floor(SR / maxF));
  const maxLag = Math.min(len - 2, Math.ceil(SR / minF));
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let c = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < len; i++) {
      const a = signal[from + i] ?? 0;
      const b = signal[from + i + lag] ?? 0;
      c += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    ac[lag] = c / Math.sqrt(e1 * e2 || 1);
  }
  let peak = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (ac[lag] > ac[peak]) peak = lag;

  let best = peak;
  for (let lag = minLag + 1; lag <= maxLag - 1; lag++) {
    if (ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > ac[peak] * 0.9) {
      best = lag;
      break;
    }
  }
  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const d = (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return SR / (best + d);
}

function correlation(a, b, maxLag = 4096, from = 0, len = 24000) {
  let best = -1;
  let bestLag = 0;
  for (let lag = maxLag - 64; lag < maxLag + 64; lag++) {
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < len; i++) {
      const x = a[from + i + lag] ?? 0;
      const y = b[from + i] ?? 0;
      num += x * y;
      da += x * x;
      db += y * y;
    }
    const c = num / Math.sqrt(da * db || 1);
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  return { corr: best, lag: bestLag };
}

function makeVowel(f0 = 120, seconds = 3) {
  const len = Math.floor(seconds * SR);
  const out = new Float32Array(len);
  const formants = [
    [800, 90, 1.0],
    [1250, 110, 0.6],
    [2700, 160, 0.25],
  ];
  for (let h = 1; h * f0 < 8000; h++) {
    const f = h * f0;
    let amp = 0;
    for (const [fc, bw, g] of formants) amp += (g * bw * bw) / (bw * bw + (f - fc) ** 2);
    if (amp < 1e-4) continue;
    const phase = (h * 0.37) % 1;
    for (let i = 0; i < len; i++) {
      out[i] += amp * 0.25 * Math.sin(2 * Math.PI * f * (i / SR) + phase * 2 * Math.PI);
    }
  }
  return out;
}

let failures = 0;
const check = (name, cond, detail) => {
  const tag = cond ? '  ✓' : '  ✗';
  console.log(`${tag} ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) failures++;
};

console.log('\n== 1. 透明性（pitch 0 / formant 0） ==');
{
  const n = SR * 3;
  const input = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    input[i] =
      0.35 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.12 * Math.sin((2 * Math.PI * 660 * i) / SR);
  }
  const out = runDSP(input, { pitch: 0, formant: 0 });
  const { corr, lag } = correlation(input, out, N, SR, 24000);
  const rIn = rms(input, SR, SR * 2);
  const rOut = rms(out, SR, SR * 2);
  check('无 NaN', !hasNaN(out));
  check(
    '波形相关度 ≥ 0.99995（四舍五入即 1.0000）',
    corr >= 0.99995,
    `corr=${fmt(corr, 6)} lag=${lag}`,
  );
  check(
    '电平基本一致（±1.5dB）',
    Math.abs(20 * Math.log10(rOut / rIn)) < 1.5,
    `${fmt(rIn, 3)} → ${fmt(rOut, 3)}`,
  );
}

console.log('\n== 2. 变调精度（220Hz 正弦） ==');
{
  const n = SR * 3;
  const input = new Float32Array(n);
  for (let i = 0; i < n; i++) input[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / SR);

  for (const semis of [12, -12, 5, -3]) {
    const out = runDSP(input, { pitch: semis, formant: 0, preserve: true });
    const f = peakFreq(out, SR);
    const expected = 220 * 2 ** (semis / 12);
    const cents = 1200 * Math.log2(f / expected);
    check(
      `pitch ${semis > 0 ? '+' : ''}${semis}st → ${fmt(expected, 1)}Hz`,
      !hasNaN(out) && Math.abs(cents) < 12,
      `实测 ${fmt(f, 1)}Hz (${fmt(cents, 1)} cents)`,
    );
  }
}

console.log('\n== 3. 共振峰与音高解耦（元音 /a/） ==');
{
  const input = makeVowel(120, 3);
  const base = runDSP(input, { pitch: 0, formant: 0, preserve: true });
  const cBase = centroid(base, SR * 1.2);
  const eBase = envelopePeak(base, SR * 1.2);
  const fBase = f0of(base, SR * 1.2);
  console.log(
    `   基准：F0=${fmt(fBase, 1)}Hz  共振峰包络峰=${fmt(eBase, 0)}Hz  谱重心=${fmt(cBase, 0)}Hz`,
  );

  const up = runDSP(input, { pitch: 0, formant: 12, preserve: true });
  const eUp = envelopePeak(up, SR * 1.2);
  const fUp = f0of(up, SR * 1.2);
  check(
    'formant +12：基频不变',
    Math.abs(1200 * Math.log2(fUp / fBase)) < 20,
    `${fmt(fBase, 1)} → ${fmt(fUp, 1)}Hz`,
  );
  check(
    'formant +12：包络峰约 ×2',
    Math.abs(eUp / eBase - 2) < 0.7,
    `${fmt(eBase, 0)} → ${fmt(eUp, 0)}Hz`,
  );

  const down = runDSP(input, { pitch: 0, formant: -12, preserve: true });
  const eDown = envelopePeak(down, SR * 1.2);
  check(
    'formant -12：包络峰约 ÷2',
    Math.abs(eDown / eBase - 0.5) < 0.2,
    `${fmt(eBase, 0)} → ${fmt(eDown, 0)}Hz`,
  );

  const shifted = runDSP(input, { pitch: 12, formant: 0, preserve: true });
  const eShift = envelopePeak(shifted, SR * 1.2);
  const fShift = f0of(shifted, SR * 1.2);
  check(
    'pitch +12 保持共振峰：基频 ×2',
    Math.abs(1200 * Math.log2(fShift / fBase) - 1200) < 30,
    `${fmt(fBase, 1)} → ${fmt(fShift, 1)}Hz`,
  );
  check(
    'pitch +12 保持共振峰：包络峰基本不动',
    Math.abs(1200 * Math.log2(eShift / eBase)) < 150,
    `${fmt(eBase, 0)} → ${fmt(eShift, 0)}Hz`,
  );

  const chip = runDSP(input, { pitch: 12, formant: 0, preserve: false });
  const eChip = envelopePeak(chip, SR * 1.2);
  check(
    'preserve off：包络峰随音高上移约 ×2',
    Math.abs(eChip / eBase - 2) < 0.6,
    `${fmt(eBase, 0)} → ${fmt(eChip, 0)}Hz`,
  );

  const bass = runDSP(input, { pitch: -5, formant: -3, preserve: true });
  const eBass = envelopePeak(bass, SR * 1.2);
  check('男声预设：包络峰下移', eBass < eBase * 0.9, `${fmt(eBase, 0)} → ${fmt(eBass, 0)}Hz`);
}

console.log('\n== 4. 极端设置稳定性 ==');
{
  const input = makeVowel(90, 2);
  for (const p of [
    { pitch: 12, formant: 12, preserve: false },
    { pitch: -12, formant: -12, preserve: true },
    { pitch: 7, formant: -7, preserve: true },
  ]) {
    const out = runDSP(input, p);
    const r = rms(out, SR, SR * 1.8);
    check(
      `pitch ${p.pitch} / formant ${p.formant} / preserve ${p.preserve}`,
      !hasNaN(out) && r > 0.001 && r < 2,
      `rms=${fmt(r, 3)}`,
    );
  }
}

console.log(failures === 0 ? '\n全部通过 ✓\n' : `\n${failures} 项失败 ✗\n`);
process.exit(failures === 0 ? 0 : 1);
