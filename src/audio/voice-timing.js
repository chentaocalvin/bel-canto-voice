import { msg } from '../strings.js';
const measurements = new Map();

export function voiceAlignmentFrames(sampleRate) {
  return 3840 + Math.round(sampleRate * 0.012);
}

export function minimumRecordingAdjustment(
  sampleRate,
  alignmentFrames = voiceAlignmentFrames(sampleRate),
) {
  return Math.max(-40, -Math.floor((alignmentFrames * 1000) / sampleRate));
}

export async function measureVoiceAlignment(sampleRate) {
  if (measurements.has(sampleRate)) return measurements.get(sampleRate);
  let cancelled = false;
  let timer;
  const measurement = (async () => {
    const { createVoiceChain } = await import('./chain.js');
    const context = new OfflineAudioContext(2, 16384, sampleRate);
    const chain = await createVoiceChain(
      context,
      {
        input: 0,
        out: 0,
        pitch: 0,
        formant: 0,
        vibDepth: 0,
        warmth: 0,
        ring: 0,
        smooth: 0,
        air: 0,
        drive: 0,
        comp: 0,
        mix: 0,
        chorus: 0,
      },
      { offline: true },
    );
    if (cancelled) {
      chain.dispose();
      throw new Error(msg('error.alignmentCancelled'));
    }
    chain.setBackingActive(true);
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 8192, sampleRate);
    source.buffer.getChannelData(0)[4096] = 0.125;
    source.connect(chain.input);
    source.start();
    try {
      const rendered = await context.startRendering();
      const samples = rendered.getChannelData(0);
      let peak = 0,
        position = -1;
      for (let i = 4096; i < samples.length; i++) {
        if (Math.abs(samples[i]) > peak) {
          peak = Math.abs(samples[i]);
          position = i;
        }
      }
      if (peak < 0.01) throw new Error(msg('error.alignmentMeasurement'));
      return position - 4096;
    } finally {
      source.disconnect();
      chain.dispose();
    }
  })();
  const bounded = Promise.race([
    measurement,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg('error.alignmentTimeout'))), 30000);
    }),
  ]);
  measurements.set(sampleRate, bounded);
  try {
    return await bounded;
  } catch (error) {
    cancelled = true;
    measurements.delete(sampleRate);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
