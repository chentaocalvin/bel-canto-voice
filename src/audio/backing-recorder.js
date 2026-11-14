import { msg } from '../strings.js';
export async function createBackingRecorder(
  ctx,
  { vocalNode, backingNode, latencyFrames, adjustmentFrames = 0 },
) {
  const correction = latencyFrames + adjustmentFrames;
  if (!Number.isSafeInteger(correction) || correction < 0) {
    throw new RangeError(msg('error.captureAlignment'));
  }
  await ctx.audioWorklet.addModule(new URL('../worklet/backing-capture.js', import.meta.url));
  const capture = new AudioWorkletNode(ctx, 'backing-capture', {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: { correction },
  });
  vocalNode.connect(capture, 0, 0);
  backingNode.connect(capture, 0, 1);
  capture.connect(ctx.destination);
  let state = 'idle';
  let segments = [];
  let active;
  let pending;
  let resolvePending;
  let rejectPending;
  let connected = true;

  function disconnect() {
    if (!connected) return;
    connected = false;
    vocalNode.disconnect(capture, 0, 0);
    backingNode.disconnect(capture, 0, 1);
    capture.disconnect();
    capture.onprocessorerror = null;
    capture.port.onmessage = null;
    capture.port.close();
  }

  function validateFrame(frame) {
    if (!Number.isSafeInteger(frame) || frame < Math.ceil(ctx.currentTime * ctx.sampleRate)) {
      throw new RangeError(msg('error.captureBoundary'));
    }
  }

  function openSegment(frame) {
    active = { id: segments.length, start: frame, end: null, chunks: [], drained: false };
    segments.push(active);
    capture.port.postMessage({ type: 'start', frame, id: active.id });
  }

  function closeSegment(frame) {
    validateFrame(frame);
    if (frame <= active.start) throw new RangeError(msg('error.captureEmpty'));
    active.end = frame;
    capture.port.postMessage({ type: 'stop', frame });
  }

  function finish() {
    try {
      const length = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
      const output = ctx.createBuffer(2, length, ctx.sampleRate);
      let segmentOffset = 0;
      for (const segment of segments) {
        const segmentLength = segment.end - segment.start;
        for (const chunk of segment.chunks) {
          for (let channel = 0; channel < 2; channel++) {
            const target = output.getChannelData(channel);
            for (let i = 0; i < chunk.samples[channel].length; i++) {
              const backingFrame = chunk.frame - segment.start + i;
              const vocalFrame = backingFrame - correction;
              if (backingFrame < segmentLength) {
                target[segmentOffset + backingFrame] += chunk.samples[channel + 2][i];
              }
              if (vocalFrame >= 0 && vocalFrame < segmentLength) {
                target[segmentOffset + vocalFrame] += chunk.samples[channel][i];
              }
            }
          }
        }
        segmentOffset += segmentLength;
      }
      segments = [];
      active = null;
      state = 'pending';
      disconnect();
      resolvePending(output);
      resolvePending = null;
      rejectPending = null;
    } catch (error) {
      fail(error);
    }
  }

  capture.port.onmessage = ({ data }) => {
    const segment = segments[data.id];
    if (data.type === 'samples') segment.chunks.push(data);
    if (data.type === 'done') {
      segment.drained = true;
      segment.resolveDrain?.();
      if (state === 'stopping') finish();
    }
  };
  function fail(error) {
    state = 'error';
    active?.rejectDrain?.(error);
    segments = [];
    active = null;
    disconnect();
    rejectPending?.(error);
    resolvePending = null;
    rejectPending = null;
  }
  capture.onprocessorerror = () => fail(new Error(msg('error.captureFailed')));

  return {
    start(frame) {
      if (state !== 'idle') throw new Error(msg('error.captureStarted'));
      validateFrame(frame);
      state = 'recording';
      openSegment(frame);
    },
    pause(frame) {
      if (state !== 'recording') throw new Error(msg('error.capturePause'));
      closeSegment(frame);
      state = 'paused';
      return new Promise((resolve, reject) => {
        active.resolveDrain = resolve;
        active.rejectDrain = reject;
      });
    },
    resume(frame) {
      if (state !== 'paused') throw new Error(msg('error.captureResume'));
      if (!active.drained) throw new Error(msg('error.captureDrain'));
      validateFrame(frame);
      state = 'recording';
      openSegment(frame);
    },
    stop(frame) {
      if (state === 'stopping' || state === 'pending') return pending;
      if (state !== 'recording' && state !== 'paused') {
        throw new Error(msg('error.captureStop'));
      }
      validateFrame(frame);
      if (state === 'recording') closeSegment(frame);
      state = 'stopping';
      pending = new Promise((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
      if (active.drained) finish();
      return pending;
    },
    discard() {
      if (state === 'discarded') return;
      state = 'discarded';
      active?.rejectDrain?.(new Error(msg('error.captureDiscarded')));
      segments = [];
      active = null;
      disconnect();
      rejectPending?.(new Error(msg('error.captureDiscarded')));
      resolvePending = null;
      rejectPending = null;
      pending = null;
    },
  };
}
