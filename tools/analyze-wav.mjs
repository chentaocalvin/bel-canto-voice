import { readFileSync } from 'node:fs';

import { resolve } from 'node:path';
import { parseWav } from './wav-info.mjs';

function readWav(path) {
  const buffer = readFileSync(path);
  const info = parseWav(buffer, path);
  if (
    !info.ok ||
    info.audioFormat !== 1 ||
    info.bitsPerSample !== 16 ||
    ![1, 2].includes(info.channels) ||
    info.sampleRate <= 0 ||
    info.dataBytes % (info.channels * 2) !== 0
  ) {
    throw new Error(
      `Expected PCM16 mono/stereo WAV: ${path}: ${info.error || 'unsupported format'}`,
    );
  }
  const n = info.dataBytes / (info.channels * 2);
  const ch0 = new Float32Array(n);
  const ch1 = info.channels === 2 ? new Float32Array(n) : null;
  for (let i = 0; i < n; i++) {
    ch0[i] = buffer.readInt16LE(info.dataOffset + i * info.channels * 2) / 32768;
    if (ch1) ch1[i] = buffer.readInt16LE(info.dataOffset + i * info.channels * 2 + 2) / 32768;
  }
  return { sr: info.sampleRate, ch: info.channels, ch0, ch1, n };
}

function rms(a, from, to) {
  let s = 0;
  const f = Math.max(0, from),
    t = Math.min(a.length, to);
  for (let i = f; i < t; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, t - f));
}

function bandEnergy(sig, sr, lo, hi) {
  let sum = 0,
    cnt = 0;
  for (let k = 0; k < 40; k++) {
    const f = lo * Math.pow(hi / lo, k / 39);
    const w = (2 * Math.PI * f) / sr;
    const coeff = 2 * Math.cos(w);
    let s0 = 0,
      s1 = 0,
      s2 = 0;
    const start = Math.floor(sr * 1.0),
      end = Math.floor(sr * 4.5);
    for (let i = start; i < end; i++) {
      s0 = sig[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    sum += Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2);
    cnt++;
  }
  return sum / cnt;
}

function f0Track(sig, sr, from, to, step = 0.02) {
  const out = [];
  const win = Math.floor(sr * 0.04);
  for (let t = from; t < to; t += step) {
    const start = Math.floor(t * sr);
    if (start + win * 2 > sig.length) break;
    let best = 0,
      bestLag = 0;
    for (let lag = Math.floor(sr / 400); lag < Math.floor(sr / 70); lag++) {
      let c = 0,
        e1 = 0,
        e2 = 0;
      for (let i = 0; i < win; i++) {
        const a = sig[start + i],
          b = sig[start + i + lag];
        c += a * b;
        e1 += a * a;
        e2 += b * b;
      }
      const nc = c / Math.sqrt(e1 * e2 || 1);
      if (nc > best) {
        best = nc;
        bestLag = lag;
      }
    }
    if (best > 0.4) out.push(sr / bestLag);
  }
  return out;
}

const [dryInput, wetInput] = process.argv.slice(2);
if (!dryInput || !wetInput)
  throw new Error('Usage: node tools/analyze-wav.mjs <dry.wav> <wet.wav>');
const dryPath = resolve(dryInput);
const wetPath = resolve(wetInput);
console.log('inputs:', { dry: dryPath, wet: wetPath });
const dry = readWav(dryPath);
const wet = readWav(wetPath);
if (dry.n / dry.sr < 4.5 || wet.n / wet.sr < 4.5 || wet.ch !== 2)
  throw new Error('Analysis needs at least 4.5 seconds of input and a stereo wet file');
console.log(
  `dry: ${dry.sr}Hz ${dry.ch}ch ${(dry.n / dry.sr).toFixed(2)}s | wet: ${wet.sr}Hz ${wet.ch}ch ${(wet.n / wet.sr).toFixed(2)}s`,
);

const bands = [
  [150, 400],
  [400, 900],
  [900, 2000],
  [2400, 3400],
  [6000, 10000],
];
console.log('\n频段能量（相对 150-400Hz）:');
for (const [lo, hi] of bands) {
  const d = bandEnergy(dry.ch0, dry.sr, lo, hi);
  const w = bandEnergy(wet.ch0, wet.sr, lo, hi);
  const ref = bandEnergy(dry.ch0, dry.sr, 150, 400);
  const refW = bandEnergy(wet.ch0, wet.sr, 150, 400);
  console.log(
    `  ${lo}-${hi}Hz  dry ${(20 * Math.log10(d / ref)).toFixed(1)}dB   wet ${(20 * Math.log10(w / refW)).toFixed(1)}dB   Δ ${(20 * Math.log10(w / refW) - 20 * Math.log10(d / ref)).toFixed(1)}dB`,
  );
}

console.log('\n电平:');
let peakD = 0;
for (let i = 0; i < dry.n; i++) peakD = Math.max(peakD, Math.abs(dry.ch0[i]));
console.log('  dry rms', rms(dry.ch0, dry.sr, dry.sr * 4).toFixed(3), ' peak', peakD.toFixed(3));
let peakW = 0;
for (let i = 0; i < wet.n; i++) peakW = Math.max(peakW, Math.abs(wet.ch0[i]), Math.abs(wet.ch1[i]));
console.log('  wet rms', rms(wet.ch0, wet.sr, wet.sr * 4).toFixed(3), ' peak', peakW.toFixed(3));

const dryDuration = dry.n / dry.sr;
console.log(`\n混响尾巴 (原曲 ${dryDuration.toFixed(3)}s 结束):`);
for (const offset of [0.2, 0.5, 1.0, 1.5, 2.0]) {
  const t = dryDuration + offset;
  const from = Math.floor(t * wet.sr);
  const to = Math.floor((t + 0.25) * wet.sr);
  const value = to <= wet.n ? rms(wet.ch0, from, to).toFixed(4) : 'N/A (incomplete wet interval)';
  console.log(`  t=${t.toFixed(3)}s rms ${value}`);
}

console.log('\n颤音（湿声基频轨迹）:');
const track = f0Track(wet.ch0, wet.sr, 1.2, 4.2);
const mean = track.reduce((a, b) => a + b, 0) / track.length;
const maxDev = Math.max(...track.map((f) => Math.abs(1200 * Math.log2(f / mean))));
console.log(
  `  帧数 ${track.length}  平均 ${mean.toFixed(1)}Hz  最大偏差 ${maxDev.toFixed(1)} cents`,
);

console.log('\n立体声宽度:');
let mid = 0,
  side = 0;
for (let i = wet.sr; i < wet.sr * 4; i++) {
  const m = (wet.ch0[i] + wet.ch1[i]) / 2,
    s = (wet.ch0[i] - wet.ch1[i]) / 2;
  mid += m * m;
  side += s * s;
}
console.log(`  side/mid = ${Math.sqrt(side / mid).toFixed(3)}`);
