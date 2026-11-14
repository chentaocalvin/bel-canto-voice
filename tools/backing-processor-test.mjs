import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAppServer } from './serve.mjs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

function peak(samples, rate, expected) {
  const size = 16384;
  const center = Math.round((expected * size) / rate);
  let best = 0,
    bin = 0;
  for (let k = center - 4; k <= center + 4; k++) {
    let re = 0,
      im = 0;
    for (let n = 0; n < size; n++) {
      const value =
        samples[n + Math.floor(rate / 2)] * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (size - 1)));
      re += value * Math.cos((2 * Math.PI * k * n) / size);
      im -= value * Math.sin((2 * Math.PI * k * n) / size);
    }
    const power = re * re + im * im;
    if (power > best) {
      best = power;
      bin = k;
    }
  }
  return { hz: (bin * rate) / size, power: best };
}

const server = createAppServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  await withBrowser({ commandTimeout: 120000 }, async (browser) => {
    const errors = createPageErrors();
    browser.onEvent(errors.record);
    await browser.send('Runtime.enable');
    await browser.send('Page.enable');
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await sleep(300);
    const result = await browser.evaluate(`(async () => {
      const { prepareBacking } = await import('/src/audio/backing-processor.js');
      const results = [];
      for (const rate of [44100, 48000]) {
        const input = new AudioBuffer({ length: 5003, sampleRate: rate, numberOfChannels: 2 });
        for (let ch = 0; ch < 2; ch++) {
          const samples = input.getChannelData(ch);
          for (let i = 0; i < samples.length; i++) samples[i] = ((i * 13 + ch * 7) % 101 - 50) / 100;
        }
        const output = await prepareBacking(input, 0);
        results.push({ rate: output.sampleRate, frames: output.length, channels: output.numberOfChannels,
          exact: [0, 1].every(ch => output.getChannelData(ch).every((value, i) => value === input.getChannelData(ch)[i])) });
      }
      return results;
    })()`);
    assert.deepEqual(
      result,
      [44100, 48000].map((rate) => ({ rate, frames: 5003, channels: 2, exact: true })),
    );
    console.log('BACKING_PROCESSOR_PASS zero-shift exact PCM at 44100/48000 Hz');
    const pitched = await browser.evaluate(`(async () => {
      const { prepareBacking } = await import('/src/audio/backing-processor.js');
      ${peak.toString()}
      const results = [];
      for (const rate of [44100, 48000]) {
        for (const [shift, ratio] of [[-6, 0.7071067811865476], [-3, 0.8408964152537145], [2, 1.122462048309373], [6, 1.4142135623730951]]) {
          const input = new AudioBuffer({ length: rate * 2 + 13, sampleRate: rate, numberOfChannels: 2 });
          for (let ch = 0; ch < 2; ch++) {
            const samples = input.getChannelData(ch), tone = ch ? 660 : 440;
            for (let i = 0; i < samples.length; i++) samples[i] = 0.2 * Math.sin(2 * Math.PI * tone * i / rate);
          }
          const output = await prepareBacking(input, shift);
          const left = output.getChannelData(0), right = output.getChannelData(1);
          results.push({ rate, shift, frames: output.length, outputRate: output.sampleRate, channels: output.numberOfChannels,
            finite: left.every(Number.isFinite) && right.every(Number.isFinite),
            distinct: left.some((v, i) => Math.abs(v - right[i]) > 0.05),
            left: peak(left, rate, 440 * ratio), right: peak(right, rate, 660 * ratio), expected: [440 * ratio, 660 * ratio] });
        }
      }
      return results;
    })()`);
    assert.ok(Array.isArray(pitched), JSON.stringify(pitched));
    for (const item of pitched) {
      assert.equal(item.frames, item.rate * 2 + 13);
      assert.equal(item.outputRate, item.rate);
      assert.equal(item.channels, 2);
      assert.ok(item.finite && item.distinct);
      for (const [index, peak] of [item.left, item.right].entries()) {
        assert.ok(peak.power > 100, JSON.stringify(item));
        assert.ok(
          Math.abs(peak.hz - item.expected[index]) <= item.rate / 16384,
          JSON.stringify(item),
        );
      }
    }
    console.log(
      'BACKING_PROCESSOR_PASS shifted tones; independent 16384-point Hann DFT; tolerance one bin',
      JSON.stringify(pitched),
    );
    const boundaries = await browser.evaluate(`(async () => {
      const { prepareBacking } = await import('/src/audio/backing-processor.js');
      const results = [];
      for (const rate of [44100, 48000]) for (const shift of [-6, -3, 2, 6]) {
        const input = new AudioBuffer({ length: rate + 17, sampleRate: rate, numberOfChannels: 1 });
        const positions = [0, Math.round(rate * 0.5), input.length - 1];
        for (const position of positions) input.getChannelData(0)[position] = 0.5;
        const output = await prepareBacking(input, shift), samples = output.getChannelData(0);
        const events = positions.map(position => {
          const from = Math.max(0, position - Math.round(rate * 0.05));
          const to = Math.min(samples.length, position + Math.round(rate * 0.05));
          let energy = 0, moment = 0, peak = 0, peakFrame = from;
          for (let i = from; i < to; i++) { const e = samples[i] ** 2; energy += e; moment += i * e; if (e > peak) { peak = e; peakFrame = i; } }
          return { energy, peakFrame, offsetMs: (moment / energy - position) * 1000 / rate };
        });
        results.push({ rate, shift, frames: output.length, channels: output.numberOfChannels, events });
      }
      return results;
    })()`);
    assert.ok(Array.isArray(boundaries), JSON.stringify(boundaries));
    for (const item of boundaries) {
      assert.equal(item.frames, item.rate + 17);
      assert.equal(item.channels, 1);
      assert.ok(
        Math.abs(
          item.events[1].peakFrame - item.events[0].peakFrame - Math.round(item.rate * 0.5),
        ) <= 128,
        JSON.stringify(item),
      );
      for (const event of item.events) {
        assert.ok(event.energy > 0.000001, JSON.stringify(item));
        assert.ok(Math.abs(event.offsetMs) < 30, JSON.stringify(item));
      }
    }
    console.log(
      'BACKING_PROCESSOR_PASS mono leading/middle/trailing impulses; STFT energy centroid within predeclared 30ms waveform-spread bound (not clock tolerance)',
      JSON.stringify(boundaries),
    );

    const chords = await browser.evaluate(`(async () => {
      const { prepareBacking } = await import('/src/audio/backing-processor.js');
      ${peak.toString()}
      const results = [];
      for (const rate of [44100, 48000]) for (const [shift, ratio] of [[-6, 0.7071067811865476], [6, 1.4142135623730951]]) {
        const input = new AudioBuffer({ length: rate * 2, sampleRate: rate, numberOfChannels: 2 });
        for (let i = 0; i < input.length; i++) {
          const value = 0.1 * Math.sin(2 * Math.PI * 440 * i / rate) + 0.1 * Math.sin(2 * Math.PI * 660 * i / rate) + 0.1 * Math.sin(2 * Math.PI * 880 * i / rate);
          input.getChannelData(0)[i] = value; input.getChannelData(1)[i] = -0.5 * value;
        }
        const output = await prepareBacking(input, shift);
        const left = output.getChannelData(0), right = output.getChannelData(1);
        let error = 0, energy = 0;
        for (let i = rate / 2; i < rate * 1.5; i++) { error += (left[i] + 2 * right[i]) ** 2; energy += left[i] ** 2; }
        const tones = [440, 660, 880].map(frequency => {
          const expected = frequency * ratio;
          return { expected, ...peak(left, rate, expected) };
        });
        results.push({ rate, shift, stereoError: Math.sqrt(error / energy), tones });
      }
      return results;
    })()`);
    assert.ok(Array.isArray(chords), JSON.stringify(chords));
    for (const chord of chords) {
      assert.ok(chord.stereoError < 0.01, JSON.stringify(chord));
      for (const tone of chord.tones) {
        assert.ok(tone.power > 100);
        assert.ok(Math.abs(tone.hz - tone.expected) <= chord.rate / 16384, JSON.stringify(chord));
      }
    }
    assert.deepEqual(errors.unexpected, [], 'Unexpected page errors');
    console.log(
      'BACKING_PROCESSOR_PASS independent three-tone chord and inverted half-level stereo relation',
      JSON.stringify(chords),
    );
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
}
