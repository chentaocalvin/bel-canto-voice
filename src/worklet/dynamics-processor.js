class DynamicsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = (options && options.processorOptions) || {};
    this.thresholdDb = p.thresholdDb ?? -20;
    this.ratio = p.ratio ?? 3;
    this.attack = p.attack ?? 0.004;
    this.release = p.release ?? 0.16;
    this.makeup = p.makeup ?? 1;
    this.ceiling = p.ceiling ?? 0.8;
    this.env = 0;

    this.targetThresholdDb = this.thresholdDb;
    this.targetRatio = this.ratio;
    this.targetMakeup = this.makeup;
    this.smoothTau = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.thresholdDb !== undefined) this.targetThresholdDb = d.thresholdDb;
      if (d.ratio !== undefined) this.targetRatio = d.ratio;
      if (d.makeup !== undefined) this.targetMakeup = d.makeup;
      if (d.attack !== undefined) this.attack = d.attack;
      if (d.release !== undefined) this.release = d.release;
      if (d.smoothTau !== undefined) this.smoothTau = Math.max(0, d.smoothTau || 0);

      if (!this.smoothTau) {
        this.thresholdDb = this.targetThresholdDb;
        this.ratio = this.targetRatio;
        this.makeup = this.targetMakeup;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const n = output[0].length;
    const input = inputs[0];
    const chans = output.length;

    const sr = sampleRate;
    if (this.smoothTau > 0) {
      const alpha = 1 - Math.exp(-n / (this.smoothTau * sr));
      this.thresholdDb += (this.targetThresholdDb - this.thresholdDb) * alpha;
      this.ratio += (this.targetRatio - this.ratio) * alpha;
      this.makeup += (this.targetMakeup - this.makeup) * alpha;
    }
    const att = Math.exp(-1 / (Math.max(0.0005, this.attack) * sr));
    const rel = Math.exp(-1 / (Math.max(0.01, this.release) * sr));
    const thr = this.thresholdDb;
    const invRatio = 1 - 1 / Math.max(1, this.ratio);
    const makeup = this.makeup;
    const c = this.ceiling;

    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let ch = 0; ch < chans; ch++) {
        const s = input && input[ch] ? input[ch] : input && input[0];
        const v = s ? s[i] : 0;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      this.env =
        peak > this.env ? att * this.env + (1 - att) * peak : rel * this.env + (1 - rel) * peak;

      let gr = 1;
      if (this.env > 1e-6) {
        const db = 20 * Math.log10(this.env);
        const over = db - thr;
        if (over > 0) gr = Math.pow(10, (-over * invRatio) / 20);
      }

      for (let ch = 0; ch < chans; ch++) {
        const s = input && input[ch] ? input[ch] : input && input[0];
        let y = (s ? s[i] : 0) * gr * makeup;

        const ay = y < 0 ? -y : y;
        if (ay > c) {
          const t = (ay - c) / (1 - c + 1e-6);
          const shaped = c + (0.97 - c) * Math.tanh(t);
          y = y < 0 ? -shaped : shaped;
        }
        output[ch][i] = y;
      }
    }
    return true;
  }
}

registerProcessor('bel-canto-dynamics', DynamicsProcessor);
