class BackingCapture extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.startFrame = Infinity;
    this.endFrame = Infinity;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') {
        this.startFrame = data.frame;
        this.id = data.id;
      }
      if (data.type === 'stop') this.endFrame = data.frame + processorOptions.correction;
    };
  }

  process(inputs, outputs) {
    const size = outputs[0][0].length;
    const from = Math.max(currentFrame, this.startFrame);
    const to = Math.min(currentFrame + size, this.endFrame);
    if (to > from) {
      const samples = inputs.flatMap((input) =>
        [0, 1].map((channel) => {
          const source = input[channel] || input[0];
          return source
            ? source.slice(from - currentFrame, to - currentFrame)
            : new Float32Array(to - from);
        }),
      );
      this.port.postMessage(
        { type: 'samples', frame: from, samples, id: this.id },
        samples.map((channel) => channel.buffer),
      );
    }
    if (currentFrame + size >= this.endFrame) {
      this.port.postMessage({ type: 'done', id: this.id });
      this.startFrame = Infinity;
      this.endFrame = Infinity;
    }
    return true;
  }
}

registerProcessor('backing-capture', BackingCapture);
