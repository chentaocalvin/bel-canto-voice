import { VoiceSculptor } from '../dsp/pitch-formant.js';

class BelCantoProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.sculptor = new VoiceSculptor(sampleRate, {
      fftSize: opts.fftSize || 2048,
      hopSize: opts.hopSize || 256,
    });
    if (opts.params) {
      this.sculptor.setParams(opts.params);
      this.sculptor.pitchSmooth = opts.params.pitch ?? 0;
      this.sculptor.formantSmooth = opts.params.formant ?? 0;
    }
    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'params') {
        this.sculptor.setParams(msg.params || {}, { smoothTau: msg.smoothTau ?? 0 });
      } else if (msg.type === 'reset') {
        this.sculptor.reset();
      }
    };
    this.port.postMessage({
      type: 'ready',
      latency: this.sculptor.getLatency(),
      sampleRate,
    });
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const out = output[0];
    const input = inputs[0];
    const inCh = input && input[0] ? input[0] : null;

    this.sculptor.process(inCh, out, out.length);

    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

registerProcessor('bel-canto-sculptor', BelCantoProcessor);
