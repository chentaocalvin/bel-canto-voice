import { msg } from '../strings.js';
import SignalsmithStretch from '../../vendor/signalsmith-stretch/SignalsmithStretch.mjs';

SignalsmithStretch.moduleUrl = new URL(
  '../../vendor/signalsmith-stretch/SignalsmithStretch.mjs',
  import.meta.url,
).href;

export async function prepareBacking(buffer, semitones) {
  if (!Number.isInteger(semitones) || semitones < -6 || semitones > 6) {
    throw new RangeError(msg('error.backingTranspose'));
  }
  if (semitones === 0) return buffer;
  const rate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const reserve = Math.ceil(rate / 128) * 128;
  let padding;
  const context = new OfflineAudioContext(channels, buffer.length + reserve * 2, rate);
  let node;
  let timer;
  let cancelled = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(msg('error.backingTimeout'))), 30000);
  });
  try {
    const render = async () => {
      node = await SignalsmithStretch(context, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
      });
      if (cancelled) {
        node.port.close();
        throw new Error(msg('error.backingCancelled'));
      }
      const latency = await node.latency();
      padding = Math.ceil((latency * rate) / 128) * 128;
      if (!Number.isFinite(latency) || padding > reserve)
        throw new Error(msg('error.backingLatency'));
      node.connect(context.destination);
      await node.addBuffers(Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch)));
      await node.schedule({ active: true, input: 0, output: padding / rate, rate: 1, semitones });
      const rendered = await context.startRendering();
      const result = new AudioBuffer({
        length: buffer.length,
        sampleRate: rate,
        numberOfChannels: channels,
      });
      for (let ch = 0; ch < channels; ch++)
        result.copyToChannel(
          rendered.getChannelData(ch).subarray(padding, padding + buffer.length),
          ch,
        );
      return result;
    };
    return await Promise.race([render(), deadline]);
  } finally {
    cancelled = true;
    clearTimeout(timer);
    node?.disconnect();
    node?.port.close();
  }
}
