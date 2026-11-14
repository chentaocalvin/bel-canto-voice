import { createBackingRecorder } from './backing-recorder.js';

export async function createBackingTake(context, chain, backing, adjustmentMs) {
  const recorder = await createBackingRecorder(context, {
    vocalNode: chain.output,
    backingNode: backing.output,
    latencyFrames: chain.nominalLatencyFrames,
    adjustmentFrames: Math.round((adjustmentMs * context.sampleRate) / 1000),
  });
  const boundary = () => Math.ceil(((context.currentTime + 0.04) * context.sampleRate) / 128) * 128;
  let frames = 0;
  let startFrame = null;
  const finishSegment = (frame) => {
    if (startFrame === null) return;
    frames += frame - startFrame;
    startFrame = null;
    backing.pause(frame / context.sampleRate);
  };
  return {
    start() {
      const frame = boundary();
      const position = backing.position(frame / context.sampleRate);
      backing.play(frame / context.sampleRate, position);
      recorder.start(frame);
      startFrame = frame;
    },
    async pause() {
      const frame = boundary();
      finishSegment(frame);
      await recorder.pause(frame);
    },
    resume() {
      const frame = boundary();
      recorder.resume(frame);
      backing.play(frame / context.sampleRate, backing.position());
      startFrame = frame;
    },
    async stop() {
      const frame = boundary();
      finishSegment(frame);
      const buffer = await recorder.stop(frame);
      recorder.discard();
      return buffer;
    },
    seconds() {
      return (
        (frames +
          (startFrame === null
            ? 0
            : Math.max(0, Math.round(context.currentTime * context.sampleRate) - startFrame))) /
        context.sampleRate
      );
    },
    discard() {
      recorder.discard();
      if (startFrame !== null) backing.pause();
    },
  };
}
