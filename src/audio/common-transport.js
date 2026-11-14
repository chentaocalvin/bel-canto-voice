function padBuffer(context, buffer, frames) {
  if (buffer.length === frames) return buffer;
  const padded = context.createBuffer(buffer.numberOfChannels, frames, context.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++)
    padded.copyToChannel(buffer.getChannelData(ch), ch);
  return padded;
}

export class CommonTransport {
  constructor(
    context,
    { voice, backing, vocalOutput, vocalGate, backingOutput, latencyFrames, onEnded },
  ) {
    this.context = context;
    const frames = Math.max(voice.length, backing.length);
    this.voice = padBuffer(context, voice, frames);
    this.backing = padBuffer(context, backing, frames);
    this.vocalOutput = vocalOutput;
    this.vocalGate = vocalGate;
    this.backingOutput = backingOutput;
    this.latency = latencyFrames / context.sampleRate;
    this.onEnded = onEnded;
    this.sources = [];
  }

  play(offset, loop) {
    this.stop();
    const context = this.context;
    const inputStart =
      (Math.ceil(((context.currentTime + 0.04) * context.sampleRate) / 128) * 128) /
      context.sampleRate;
    const origin = inputStart + this.latency;
    this.origin = origin;
    this.offset = offset;
    this.loop = loop;
    this.vocalGate?.setValueAtTime(1, origin);
    for (const [buffer, output, when] of [
      [this.voice, this.vocalOutput, inputStart],
      [this.backing, this.backingOutput, origin],
    ]) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      source.connect(output);
      source.start(when, offset);
      this.sources.push(source);
    }
    this.sources[1].onended = () => {
      this.stop({ preserveTail: true });
      this.onEnded();
    };
    return origin;
  }

  setLoop(loop) {
    if (!this.sources.length || loop === this.loop) return null;
    const duration = this.voice.duration;
    const elapsed = this.offset + Math.max(0, this.context.currentTime - this.origin);
    const offset = this.loop ? elapsed % duration : Math.min(elapsed, duration);
    if (duration - offset <= this.latency + 128 / this.context.sampleRate) {
      return { offset, origin: this.play(offset, loop) };
    }
    this.loop = loop;
    this.offset = offset;
    this.origin = Math.max(this.origin, this.context.currentTime);
    for (const source of this.sources) source.loop = loop;
    return { offset: this.offset, origin: this.origin };
  }

  stop({ preserveTail = false } = {}) {
    if (!preserveTail && this.vocalGate) {
      this.vocalGate.cancelScheduledValues(this.context.currentTime);
      this.vocalGate.setValueAtTime(0, this.context.currentTime);
    }
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources = [];
  }
}
