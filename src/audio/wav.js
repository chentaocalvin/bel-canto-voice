const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

function createWavEncoder(audioBuffer) {
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const len = audioBuffer.length;
  const sr = audioBuffer.sampleRate;
  const bytes = 44 + len * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, len * channels * 2, true);

  const data = [];
  for (let c = 0; c < channels; c++) data.push(audioBuffer.getChannelData(c));
  return { view, data, channels, len, bytes };
}

function writePcmFrames(enc, from, to) {
  const { view, data, channels } = enc;
  let off = 44 + from * channels * 2;
  for (let i = from; i < to; i++) {
    for (let c = 0; c < channels; c++) {
      const s = clamp(data[c][i], -1, 1);
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
}

export function encodeWav(audioBuffer) {
  const enc = createWavEncoder(audioBuffer);
  writePcmFrames(enc, 0, enc.len);
  return new Blob([enc.view.buffer], { type: 'audio/wav' });
}

const WAV_ENCODE_CHUNK_FRAMES = 16384;

const yieldToUi = (() => {
  if (typeof MessageChannel !== 'function') {
    return () => new Promise((resolve) => setTimeout(resolve, 0));
  }
  const channel = new MessageChannel();
  const queue = [];
  channel.port1.onmessage = () => {
    const resolve = queue.shift();
    if (resolve) resolve();
  };
  return () =>
    new Promise((resolve) => {
      queue.push(resolve);
      channel.port2.postMessage(0);
    });
})();

export async function encodeWavWithProgress(audioBuffer, onProgress) {
  const enc = createWavEncoder(audioBuffer);
  let done = 0;
  while (done < enc.len) {
    const end = Math.min(enc.len, done + WAV_ENCODE_CHUNK_FRAMES);
    writePcmFrames(enc, done, end);
    done = end;
    onProgress(done / enc.len);
    if (done < enc.len) await yieldToUi();
  }
  return new Blob([enc.view.buffer], { type: 'audio/wav' });
}
