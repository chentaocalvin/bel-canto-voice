import { writeFileSync } from 'node:fs';

const SR = 48000;
const DUR = 5;
const n = SR * DUR;
const data = new Float32Array(n);

const formants = [
  [700, 90, 1.0],
  [1220, 110, 0.55],
  [2600, 160, 0.22],
];

for (let i = 0; i < n; i++) {
  const t = i / SR;

  const vib = 30 * Math.sin(2 * Math.PI * 5.5 * t) + 8 * Math.sin(2 * Math.PI * 0.7 * t);
  const f0 = 120 * Math.pow(2, vib / 1200);

  if (i === 0) data.phase = 0;
  data.phase = (data.phase || 0) + (2 * Math.PI * f0) / SR;
  const ph = data.phase;
  let s = 0;
  for (let h = 1; h * f0 < 9000; h++) {
    const f = h * f0;
    let amp = 0;
    for (const [fc, bw, g] of formants) amp += (g * bw * bw) / (bw * bw + (f - fc) ** 2);
    if (amp < 1e-4) continue;
    s += amp * Math.sin(h * ph);
  }

  const env = Math.min(1, t / 0.35) * Math.min(1, (DUR - t) / 0.5);
  data[i] = 0.22 * s * env;
}

let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]));
const gain = 0.8 / peak;
const pcm = Buffer.alloc(44 + n * 2);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + n * 2, 4);
pcm.write('WAVE', 8);
pcm.write('fmt ', 12);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) {
  const v = Math.max(-1, Math.min(1, data[i] * gain));
  pcm.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
writeFileSync(new URL('./test-vocal.wav', import.meta.url), pcm);
console.log('wrote tools/test-vocal.wav', (pcm.length / 1024).toFixed(0) + 'KB');
