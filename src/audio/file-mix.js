import { measureVoiceAlignment } from './voice-timing.js';
import { createVoiceChain } from './chain.js';

export async function createFileMix({ voice, backing, gainDb, params, bypass }) {
  const rate = voice.sampleRate;
  const frames = Math.max(voice.length + Math.floor(rate * 3), backing.length);
  const latencyFrames = await measureVoiceAlignment(rate);
  const preroll = Math.ceil(latencyFrames / 128) * 128;
  const crop = preroll + latencyFrames;
  const context = new OfflineAudioContext(2, frames + crop, rate);
  const chain = await createVoiceChain(context, params, { offline: true });
  chain.setBackingActive(true, latencyFrames);
  chain.setBypass(bypass, { immediate: true });
  const vocal = context.createBufferSource();
  vocal.buffer = voice;
  vocal.connect(chain.input);
  vocal.start(preroll / rate);
  const accompaniment = context.createBufferSource();
  accompaniment.buffer = backing;
  const gain = context.createGain();
  gain.gain.value = 10 ** (gainDb / 20);
  accompaniment.connect(gain).connect(context.destination);
  accompaniment.start(crop / rate);
  return {
    context,
    frames: frames + crop,
    finish(rendered) {
      const result = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate: rate });
      for (let ch = 0; ch < 2; ch++)
        result.copyToChannel(rendered.getChannelData(ch).subarray(crop, crop + frames), ch);
      return result;
    },
    dispose() {
      chain.dispose();
      vocal.disconnect();
      accompaniment.disconnect();
      gain.disconnect();
    },
  };
}
