import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAppServer } from './serve.mjs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

const root = resolve(process.env.APP_ROOT || '.');
const evidence = process.env.EVIDENCE_DIR;
const shapes = (process.env.MIC_CHANNEL_SHAPES || 'left,right,equal').split(',');
const server = createAppServer({ root });
await new Promise((done) => server.listen(0, '127.0.0.1', done));
if (evidence) await mkdir(evidence, { recursive: true });

function installMicrophone(shape) {
  const NativeContext = globalThis.AudioContext;
  let context;
  globalThis.AudioContext = class extends NativeContext {
    constructor(options) {
      super({ ...options, sampleRate: 48000 });
      context = this;
    }
  };
  globalThis.navigator.mediaDevices.getUserMedia = async () => {
    const destination = new globalThis.MediaStreamAudioDestinationNode(context, {
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    const buffer = context.createBuffer(2, 48000, 48000);
    for (let channel = 0; channel < 2; channel++) {
      if ((shape === 'left' && channel === 1) || (shape === 'right' && channel === 0)) continue;
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / 48000);
      }
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(destination);
    source.start();
    return destination.stream;
  };
}

async function observeMicrophone() {
  const state = globalThis.__belcanto;
  const context = state.ctx;
  const start = Math.ceil(((context.currentTime + 0.1) * 48000) / 128) * 128;
  const processor = `class ChannelMeasure extends AudioWorkletProcessor {
    constructor(options) { super(); this.start=options.processorOptions.start; this.n=0; this.counts={}; this.energy=[]; this.peak=[]; this.maxDifference=0; this.done=false; }
    process(inputs) {
      if(this.done)return false;
      if(currentFrame<this.start)return true;
      const channels=inputs[0], count=Math.min(128,48000-this.n);
      this.counts[channels.length]=(this.counts[channels.length]||0)+1;
      for(let ch=0;ch<channels.length;ch++)for(let i=0;i<count;i++){
        const value=channels[ch][i]; this.energy[ch]=(this.energy[ch]||0)+value*value;
        this.peak[ch]=Math.max(this.peak[ch]||0,Math.abs(value));
      }
      if(channels.length===2)for(let i=0;i<count;i++)this.maxDifference=Math.max(this.maxDifference,Math.abs(channels[0][i]-channels[1][i]));
      this.n+=count;
      if(this.n===48000){this.done=true;this.port.postMessage({frames:this.n,counts:this.counts,rms:this.energy.map(x=>Math.sqrt(x/this.n)),peak:this.peak,maxDifference:this.maxDifference});return false;}
      return true;
    }
  }; registerProcessor('mic-channel-measure',ChannelMeasure);`;
  const url = URL.createObjectURL(new globalThis.Blob([processor], { type: 'text/javascript' }));
  await context.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const read = (source) =>
    new Promise((done, reject) => {
      const tap = new globalThis.AudioWorkletNode(context, 'mic-channel-measure', {
        channelCountMode: 'max',
        channelInterpretation: 'discrete',
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { start },
      });
      const mute = context.createGain();
      mute.gain.value = 0;
      let finished = false;
      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        tap.port.onmessage = null;
        for (const release of [
          () => source.disconnect(tap),
          () => tap.disconnect(),
          () => mute.disconnect(),
          () => tap.port.close(),
        ]) {
          try {
            release();
          } catch (cause) {
            error ||= cause;
          }
        }
        if (error) reject(error);
        else done(result);
      };
      const timer = setTimeout(() => finish(Error('Channel observation timed out')), 5000);
      tap.port.onmessage = (event) => finish(null, event.data);
      tap.onprocessorerror = () => finish(Error('Channel observer failed'));
      source.connect(tap);
      tap.connect(mute).connect(context.destination);
    });
  const [input, output] = await Promise.all([read(state.micNode), read(state.chain.monitorGain)]);
  return { input, output, sampleRate: context.sampleRate, bypass: state.bypass };
}

try {
  for (const shape of shapes) {
    await withBrowser({}, async (browser) => {
      const errors = createPageErrors();
      browser.onEvent(errors.record);
      await browser.send('Runtime.enable');
      await browser.send('Page.enable');
      await browser.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(${installMicrophone})(${JSON.stringify(shape)})`,
      });
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
      for (let i = 0; i < 100 && !(await browser.evaluate('!!globalThis.__belcanto')); i++)
        await sleep(50);
      await browser.evaluate(`(() => {
        document.getElementById('boot-mic').click();
        for(const [key,value] of Object.entries({pitch:0,formant:0,vibDepth:0,warmth:0,ring:0,smooth:0,air:0,drive:0,comp:0,input:0,out:0,mix:0,chorus:0}))globalThis.__belcanto.knobs[key].setValue(value);
        document.getElementById('mic-toggle').click();
      })()`);
      for (let i = 0; i < 100 && !(await browser.evaluate('!!globalThis.__belcanto.micOn')); i++)
        await sleep(50);
      assert.equal(
        await browser.evaluate('globalThis.__belcanto.micOn'),
        true,
        'Enable mic starts the real app',
      );
      await browser.evaluate("document.getElementById('bypass').click()");
      await sleep(1000);
      const result = await browser.evaluate(`(${observeMicrophone})()`);
      if (evidence)
        await writeFile(join(evidence, `${shape}.json`), JSON.stringify(result, null, 2) + '\n');
      console.log('MIC_CHANNEL_RESULT', JSON.stringify({ shape, ...result }));
      assert.equal(result.error, undefined, 'Observation completed');
      assert.deepEqual(result.input.counts, { 2: 375 }, 'Observed input is actually two channels');
      const inputReference =
        shape === 'left'
          ? [0.0707106781187, 0]
          : shape === 'right'
            ? [0, 0.0707106781187]
            : [0.0707106781187, 0.0707106781187];
      for (let channel = 0; channel < 2; channel++)
        assert.ok(
          Math.abs(result.input.rms[channel] - inputReference[channel]) <= 1e-7,
          'Observed microphone content matches the declared fixture',
        );
      assert.equal(result.output.frames, 48000);
      assert.deepEqual(result.output.counts, { 2: 375 }, 'Monitor is actually stereo');
      assert.ok(
        result.output.rms.every((value) => Number.isFinite(value) && value > 0),
        'BYPASS microphone reaches both ears',
      );
      assert.ok(result.output.maxDifference <= 1e-7, 'BYPASS microphone samples match across ears');
      const expected = shape === 'equal' ? 0.0707106781187 : 0.0353553390593;
      for (const rms of result.output.rms)
        assert.ok(Math.abs(rms - expected) <= 1e-7, 'BYPASS uses standard mono gain');
      assert.deepEqual(errors.unexpected, [], 'No unexpected browser errors');
      console.log(`MIC_CHANNEL_PASS ${shape}`);
    });
  }
} finally {
  await new Promise((done) => server.close(done));
}
