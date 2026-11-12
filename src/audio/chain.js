import { buildImpulseResponse } from './reverb.js';

const dbToGain = (db) => Math.pow(10, db / 20);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const PRESET_SMOOTH_TAU = 0.2;

const MONITOR_FADE_TAU = 0.02;

function makeSaturationCurve(drive, size = 2048) {
  const curve = new Float32Array(size);
  const k = 2.5;
  const g = 1 + drive * 5;
  const norm = 1 / Math.tanh(k);
  const comp = 1 / (1 + 0.75 * (g - 1));
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const sat = Math.tanh(k * g * x) * norm * comp;
    curve[i] = (1 - drive) * x + drive * sat;
  }
  return curve;
}

export async function createVoiceChain(ctx, params = {}, options = {}) {
  const { destination = ctx.destination, offline = false } = options;

  const workletUrl = options.workletUrl || new URL('../worklet/processor.js', import.meta.url).href;
  await ctx.audioWorklet.addModule(workletUrl);
  await ctx.audioWorklet.addModule(
    options.dynamicsUrl || new URL('../worklet/dynamics-processor.js', import.meta.url).href,
  );

  const node = (factory, ...args) => factory.apply(ctx, args);

  const input = node(ctx.createGain);
  const trim = node(ctx.createGain);
  const inAnalyser = node(ctx.createAnalyser);
  inAnalyser.fftSize = 2048;
  inAnalyser.smoothingTimeConstant = 0.5;
  inAnalyser.minDecibels = -88;
  inAnalyser.maxDecibels = -10;

  const sculptor = new AudioWorkletNode(ctx, 'bel-canto-sculptor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: {
      fftSize: 2048,
      hopSize: 256,
      params: {
        pitch: params.pitch ?? 0,
        formant: params.formant ?? 0,
        preserve: params.preserve ?? true,
      },
    },
  });

  const hp = node(ctx.createBiquadFilter);
  hp.type = 'highpass';
  hp.frequency.value = 78;
  hp.Q.value = 0.72;

  const warmth = node(ctx.createBiquadFilter);
  warmth.type = 'lowshelf';
  warmth.frequency.value = 210;

  const ring = node(ctx.createBiquadFilter);
  ring.type = 'peaking';
  ring.frequency.value = 2900;
  ring.Q.value = 1.05;

  const harsh = node(ctx.createBiquadFilter);
  harsh.type = 'peaking';
  harsh.frequency.value = 5600;
  harsh.Q.value = 1.3;

  const air = node(ctx.createBiquadFilter);
  air.type = 'highshelf';
  air.frequency.value = 9000;

  const driveIn = node(ctx.createGain);
  driveIn.gain.value = 1;
  const shaper = node(ctx.createWaveShaper);
  shaper.curve = makeSaturationCurve(0.22);
  shaper.oversample = '4x';
  const driveOut = node(ctx.createGain);
  driveOut.gain.value = 1;
  let lastDrive = 0.22;
  let driveTimer = null;

  const applyDrive = (d) => {
    lastDrive = d;
    shaper.curve = makeSaturationCurve(d);
  };

  const smoothDriveTo = (target) => {
    clearTimeout(driveTimer);
    driveTimer = null;
    const to = clamp(target, 0, 1);
    const from = lastDrive;

    if (Math.abs(to - from) <= 0.004) {
      applyDrive(to);
      return;
    }
    const t0 = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - t0) / 1000;
      const v = to + (from - to) * Math.exp(-elapsed / PRESET_SMOOTH_TAU);
      if (Math.abs(v - to) < 0.001) {
        applyDrive(to);
        driveTimer = null;
        return;
      }
      applyDrive(v);
      driveTimer = setTimeout(tick, 16);
    };
    tick();
  };

  const dynamics = new AudioWorkletNode(ctx, 'bel-canto-dynamics', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: { thresholdDb: -20, ratio: 3, makeup: 1.2, ceiling: 0.82 },
  });

  const vibDelay = node(ctx.createDelay, 0.06);
  vibDelay.delayTime.value = 0.012;
  const vibOsc = node(ctx.createOscillator);
  vibOsc.type = 'sine';
  const vibDepth = node(ctx.createGain);
  vibOsc.connect(vibDepth).connect(vibDelay.delayTime);
  vibOsc.start();

  const post = node(ctx.createGain);
  post.gain.value = 1;

  const wetGate = node(ctx.createGain);
  const bypassGain = node(ctx.createGain);
  bypassGain.gain.value = 0;

  const chorusL = node(ctx.createDelay, 0.08);
  const chorusR = node(ctx.createDelay, 0.08);
  chorusL.delayTime.value = 0.013;
  chorusR.delayTime.value = 0.021;
  const lfoL = node(ctx.createOscillator);
  const lfoR = node(ctx.createOscillator);
  lfoL.type = 'sine';
  lfoR.type = 'sine';
  lfoL.frequency.value = 0.27;
  lfoR.frequency.value = 0.41;
  const depthL = node(ctx.createGain);
  const depthR = node(ctx.createGain);
  depthL.gain.value = 0.0026;
  depthR.gain.value = 0.0021;
  lfoL.connect(depthL).connect(chorusL.delayTime);
  lfoR.connect(depthR).connect(chorusR.delayTime);
  lfoL.start();
  lfoR.start();

  const panL = node(ctx.createStereoPanner);
  const panR = node(ctx.createStereoPanner);
  const chorusMix = node(ctx.createGain);
  chorusMix.gain.value = 0;

  const reverbHP = node(ctx.createBiquadFilter);
  reverbHP.type = 'highpass';
  reverbHP.frequency.value = 190;
  const preDelay = node(ctx.createDelay, 0.12);
  const convolver = node(ctx.createConvolver);
  convolver.normalize = true;
  const reverbGain = node(ctx.createGain);
  reverbGain.gain.value = 0;

  const dry = node(ctx.createGain);
  const master = node(ctx.createGain);

  const limiterNode = new AudioWorkletNode(ctx, 'bel-canto-dynamics', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: { thresholdDb: 0, ratio: 1, makeup: 1, ceiling: 0.8 },
  });

  const outGain = node(ctx.createGain);
  const outAnalyser = node(ctx.createAnalyser);
  outAnalyser.fftSize = 2048;
  outAnalyser.smoothingTimeConstant = 0.72;
  outAnalyser.minDecibels = -88;
  outAnalyser.maxDecibels = -10;

  const monitorGain = node(ctx.createGain);
  monitorGain.gain.value = 1;
  let monitorOn = true;

  input.connect(trim);
  trim.connect(inAnalyser);
  trim.connect(sculptor);
  sculptor.connect(hp);
  hp.connect(warmth).connect(ring).connect(harsh).connect(air);
  air.connect(driveIn);
  driveIn.connect(shaper);
  shaper.connect(driveOut);
  driveOut.connect(dynamics);
  dynamics.connect(vibDelay);
  vibDelay.connect(post);

  post.connect(wetGate);
  wetGate.connect(dry);
  dry.connect(master);

  wetGate.connect(chorusL);
  wetGate.connect(chorusR);
  chorusL.connect(panL);
  chorusR.connect(panR);
  panL.connect(chorusMix);
  panR.connect(chorusMix);
  chorusMix.connect(master);

  wetGate.connect(reverbHP);
  reverbHP.connect(preDelay);
  preDelay.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(master);

  input.connect(bypassGain);
  bypassGain.connect(master);

  master.connect(limiterNode);
  limiterNode.connect(outGain);
  outGain.connect(outAnalyser);
  outAnalyser.connect(monitorGain);
  monitorGain.connect(destination);

  let lastSize = -1;
  let irTimer = null;

  const buildIR = (size) => {
    convolver.buffer = buildImpulseResponse(ctx, size);
    lastSize = size;
  };

  function update(p = {}, opts = {}) {
    const t = ctx.currentTime;

    const smoothTau = opts.smooth ? PRESET_SMOOTH_TAU : 0;
    const ramp = (param, value, tc = 0.04) => param.setTargetAtTime(value, t, smoothTau || tc);

    if (p.input !== undefined) ramp(trim.gain, dbToGain(p.input), 0.02);
    if (p.out !== undefined) ramp(outGain.gain, dbToGain(p.out), 0.02);

    if (p.pitch !== undefined || p.formant !== undefined || p.preserve !== undefined) {
      sculptor.port.postMessage({
        type: 'params',
        params: { pitch: p.pitch, formant: p.formant, preserve: p.preserve },

        smoothTau,
      });
    }

    if (p.vibRate !== undefined) ramp(vibOsc.frequency, p.vibRate, 0.08);
    if (p.vibDepth !== undefined) {
      const rate = p.vibRate ?? 5.5;
      const cents = clamp(p.vibDepth, 0, 200);

      const amp = (Math.pow(2, cents / 1200) - 1) / (2 * Math.PI * rate);
      ramp(vibDepth.gain, Math.max(0, amp), 0.04);
    }
    if (p.vibDepth !== undefined || p.vibRate !== undefined) {
      ramp(vibDelay.delayTime, 0.012, 0.05);
    }

    if (p.warmth !== undefined) ramp(warmth.gain, p.warmth);
    if (p.ring !== undefined) ramp(ring.gain, p.ring);
    if (p.smooth !== undefined) ramp(harsh.gain, -p.smooth);
    if (p.air !== undefined) ramp(air.gain, p.air);

    if (p.drive !== undefined) {
      const d = clamp(p.drive, 0, 1);
      if (smoothTau) {
        smoothDriveTo(d);
      } else if (Math.abs(d - lastDrive) > 0.004) {
        clearTimeout(driveTimer);
        driveTimer = null;
        applyDrive(d);
      }
    }

    if (p.comp !== undefined) {
      const c = clamp(p.comp, 0, 1);
      const thresholdDb = -6 - 22 * c;
      const ratio = 1.5 + 3 * c;

      const theoretical = -(thresholdDb + (0 - thresholdDb) / ratio);
      const makeupDb = clamp(theoretical * 0.7, 0, 11);
      dynamics.port.postMessage({
        thresholdDb,
        ratio,
        makeup: Math.pow(10, makeupDb / 20),

        smoothTau,
      });
    }

    if (p.chorus !== undefined) ramp(chorusMix.gain, clamp(p.chorus, 0, 1) * 0.95);
    if (p.width !== undefined) {
      const w = clamp(p.width, 0, 1);
      ramp(panL.pan, -(0.25 + 0.75 * w));
      ramp(panR.pan, 0.25 + 0.75 * w);
    }

    if (p.mix !== undefined) {
      const m = clamp(p.mix, 0, 1);
      ramp(reverbGain.gain, m * 0.9);
      ramp(dry.gain, 1 - 0.22 * m);
    }

    if (p.size !== undefined && Math.abs(p.size - lastSize) > 0.008) {
      const size = clamp(p.size, 0, 1);
      ramp(preDelay.delayTime, 0.004 + size * 0.035, 0.1);
      if (offline || lastSize < 0) {
        buildIR(size);
      } else {
        clearTimeout(irTimer);

        irTimer = setTimeout(() => buildIR(size), smoothTau ? PRESET_SMOOTH_TAU * 1000 : 140);
      }
    }
  }

  function setBypass(on) {
    const t = ctx.currentTime;
    wetGate.gain.setTargetAtTime(on ? 0 : 1, t, 0.012);
    bypassGain.gain.setTargetAtTime(on ? 1 : 0, t, 0.012);
  }

  function setMonitor(on) {
    monitorOn = !!on;
    monitorGain.gain.setTargetAtTime(monitorOn ? 1 : 0, ctx.currentTime, MONITOR_FADE_TAU);
    return monitorOn;
  }

  function dispose() {
    clearTimeout(irTimer);
    clearTimeout(driveTimer);
    try {
      vibOsc.stop();
      lfoL.stop();
      lfoR.stop();
    } catch {}
    outAnalyser.disconnect();
    monitorGain.disconnect();
    input.disconnect();
  }

  update({
    input: 0,
    out: 0,
    pitch: 0,
    formant: 0,
    preserve: true,
    vibRate: 5.5,
    vibDepth: 24,
    warmth: 2,
    ring: 5,
    smooth: 2,
    air: 1,
    drive: 0.2,
    comp: 0.45,
    chorus: 0.1,
    width: 0.6,
    mix: 0.3,
    size: 0.45,
    ...params,
  });

  const audioParams = {
    input: trim.gain,
    out: outGain.gain,
    vibRate: vibOsc.frequency,
    vibDepth: vibDepth.gain,
    warmth: warmth.gain,
    ring: ring.gain,
    smooth: harsh.gain,
    air: air.gain,
    chorus: chorusMix.gain,
    width: panL.pan,
    mix: reverbGain.gain,
    dry: dry.gain,
    preDelay: preDelay.delayTime,
    monitor: monitorGain.gain,
  };

  return {
    input,
    output: outGain,
    master,
    outAnalyser,
    inAnalyser,
    monitorGain,
    composer: sculptor,
    dynamics,
    limiterNode,
    update,
    setBypass,
    setMonitor,
    isMonitorOn: () => monitorOn,
    dispose,
    audioParams,
    latencySamples: 2048,
  };
}
