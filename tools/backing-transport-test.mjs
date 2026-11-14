import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAppServer } from './serve.mjs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

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
      const { createVoiceChain } = await import('/src/audio/chain.js');
      const { CommonTransport } = await import('/src/audio/common-transport.js');
      const { encodeWav } = await import('/src/audio/wav.js');
      const { measureVoiceAlignment } = await import('/src/audio/voice-timing.js');
      const results = [];
      for (const rate of [44100, 48000]) for (const bypass of [false, true]) for (const seek of [0, 4096]) {
        const period = 16384;
        const context = new OfflineAudioContext(2, period * 3 + 8192, rate);
        const merger = context.createChannelMerger(2); merger.connect(context.destination);
        const splitter = context.createChannelSplitter(2); splitter.connect(merger, 0, 0);
        const backingOutput = context.createGain(); backingOutput.connect(merger, 0, 1);
        const chain = await createVoiceChain(context, { input: 0, out: 0, pitch: 0, formant: 0, vibDepth: 0, warmth: 0, ring: 0, smooth: 0, air: 0, drive: 0, comp: 0, mix: 0, chorus: 0 }, { destination: splitter, offline: true });
        chain.setBackingActive(true, await measureVoiceAlignment(rate)); chain.setBypass(bypass, { immediate: true });
        const voice = context.createBuffer(1, 8192, rate); voice.getChannelData(0)[0] = 0.2; voice.getChannelData(0)[8191] = 0.2;
        const backing = context.createBuffer(1, period, rate); backing.getChannelData(0)[0] = 0.25; backing.getChannelData(0)[period - 1] = 0.25;
        const transport = new CommonTransport(context, { voice, backing, vocalOutput: chain.input, backingOutput, latencyFrames: chain.nominalLatencyFrames, onEnded() {} });
        const origin = Math.round(transport.play(seek / rate, true) * rate);
        const rendered = await context.startRendering();
        const encoded = new DataView(await encodeWav(rendered).arrayBuffer());
        const sample = (frame, channel) => encoded.getInt16(44 + frame * 4 + channel * 2, true) / 32768;
        const peak = (frame, channel) => {
          let amplitude = 0, offset = null;
          for (let i = -128; i <= 128; i++) {
            const a = Math.abs(sample(frame + i, channel));
            if (a > amplitude) { amplitude = a; offset = i; }
          }
          return { frame, amplitude, offset };
        };
        const events = [];
        for (let cycle = 0; cycle < 3; cycle++) {
          for (const mark of [0, 8191]) {
            const frame = origin + cycle * period + mark - seek;
            if (frame >= origin) events.push({ stem: 'voice', ...peak(frame, 0) });
          }
          for (const mark of [0, period - 1]) {
            const frame = origin + cycle * period + mark - seek;
            if (frame >= origin) events.push({ stem: 'backing', ...peak(frame, 1) });
          }
        }
        transport.stop(); chain.dispose();
        const voiceSamples = rendered.getChannelData(0);
        results.push({ rate, bypass, seek, origin, events, firstVoice: voiceSamples.findIndex(v => Math.abs(v) > .001), peakVoice: voiceSamples.reduce((best, v, i) => Math.abs(v) > best.amplitude ? { amplitude: Math.abs(v), frame: i } : best, { amplitude: 0, frame: -1 }) });
      }
      return results;
    })()`);
    assert.ok(Array.isArray(result), JSON.stringify(result));
    for (const item of result)
      for (const event of item.events) {
        assert.ok(event.amplitude > 0.01, JSON.stringify({ item, event }));
        assert.ok(Math.abs(event.offset) <= 128, JSON.stringify({ item, event }));
        if (event.stem === 'backing')
          assert.ok(Math.abs(event.offset) <= 1, JSON.stringify({ item, event }));
      }
    console.log(
      'BACKING_TRANSPORT_PASS actual voice chain output: head/tail, seek, three common loops, bypass delay match; one-quantum maximum voice-clock tolerance',
      JSON.stringify(result),
    );
    const transitions = await browser.evaluate(`(async () => {
      const { createVoiceChain } = await import('/src/audio/chain.js');
      const { measureVoiceAlignment } = await import('/src/audio/voice-timing.js');
      const { CommonTransport } = await import('/src/audio/common-transport.js');
      const results = [];
      for (const rate of [44100, 48000]) for (const turnOn of [true, false]) {
        const period = 16384, latency = await measureVoiceAlignment(rate);
        const context = new OfflineAudioContext(2, period * 3 + 8192, rate);
        const merger = context.createChannelMerger(2); merger.connect(context.destination);
        const splitter = context.createChannelSplitter(2); splitter.connect(merger, 0, 0);
        const backingOutput = context.createGain(); backingOutput.connect(merger, 0, 1);
        const chain = await createVoiceChain(context, { input: 0, out: 0, pitch: 0, formant: 0, vibDepth: 0, warmth: 0, ring: 0, smooth: 0, air: 0, drive: 0, comp: 0, mix: 0, chorus: 0 }, { destination: splitter, offline: true });
        chain.setBackingActive(true, latency);
        const voice = context.createBuffer(1, period, rate), backing = context.createBuffer(1, period, rate);
        for (let i = 0; i < period; i++) {
          voice.getChannelData(0)[i] = .1 * Math.sin(2 * Math.PI * 160 * i / period);
          backing.getChannelData(0)[i] = .1 * Math.sin(2 * Math.PI * 240 * i / period);
        }
        for (const mark of [0, period - 1]) {
          voice.getChannelData(0)[mark] += .5;
          backing.getChannelData(0)[mark] += .5;
        }
        let ended = 0;
        const transport = new CommonTransport(context, { voice, backing, vocalOutput: chain.input, vocalGate: chain.audioParams.playback, backingOutput, latencyFrames: latency, onEnded() { ended++; } });
        const origin = Math.round(transport.play(0, !turnOn) * rate), boundary = origin + period;
        const suspendAt = Math.floor((boundary - latency / 2) / 128) * 128;
        const suspended = context.suspend(suspendAt / rate), rendering = context.startRendering();
        await suspended; const restarted = transport.setLoop(turnOn); await context.resume();
        const output = await rendering;
        const rms = (ch, start, length) => { const a = output.getChannelData(ch); let sum = 0; for (let i = start; i < start + length; i++) sum += a[i] ** 2; return Math.sqrt(sum / length); };
        const resumedFrame = restarted ? Math.round(restarted.origin * rate) : suspendAt;
        const endFrame = boundary + resumedFrame - suspendAt;
        const windows = [];
        for (let frame = suspendAt; frame < endFrame + 4096; frame += 128) windows.push({ frame, rms: [0, 1].map(ch => rms(ch, frame, 128)) });
        const samples = output.getChannelData(1);
        let backingError = 0;
        for (let frame = resumedFrame; frame < endFrame; frame++) {
          const sourceFrame = frame - resumedFrame + suspendAt - origin;
          backingError = Math.max(backingError, Math.abs(samples[frame] - backing.getChannelData(0)[sourceFrame]));
        }
        const peakOffset = (ch, expected) => {
          const a = output.getChannelData(ch); let best = 0, offset = null;
          for (let d = -128; d <= 128; d++) if (Math.abs(a[expected + d]) > best) { best = Math.abs(a[expected + d]); offset = d; }
          return offset;
        };
        const endpointOffsets = [0, 1].map(ch => peakOffset(ch, endFrame - 1));
        results.push({ rate, turnOn, latency, boundary, suspendAt, resumedFrame, endFrame, pauseFrames: resumedFrame - suspendAt, backingError, endpointOffsets, ended, windows, naturalTail: rms(0, endFrame, 256), secondCycle: [0, 1].map(ch => rms(ch, endFrame + 8192, 1024)) });
        transport.stop(); chain.dispose();
      }
      return results;
    })()`);
    assert.ok(Array.isArray(transitions), JSON.stringify(transitions));
    console.log('BACKING_LOOP_TRANSITION_OBSERVED', JSON.stringify(transitions));
    for (const item of transitions) {
      assert.ok(
        item.pauseFrames >= item.latency + 0.04 * item.rate &&
          item.pauseFrames <= item.latency + 0.04 * item.rate + 128,
        JSON.stringify(item),
      );
      assert.ok(item.backingError < 0.000001, JSON.stringify(item));
      assert.ok(
        Number.isInteger(item.endpointOffsets[0]) && Math.abs(item.endpointOffsets[0]) <= 128,
        JSON.stringify(item),
      );
      assert.ok(
        Number.isInteger(item.endpointOffsets[1]) && Math.abs(item.endpointOffsets[1]) <= 1,
        JSON.stringify(item),
      );
      for (const window of item.windows) {
        if (window.frame + 128 <= item.resumedFrame)
          assert.ok(
            window.rms.every((v) => v < 0.00001),
            JSON.stringify({ item, window }),
          );
        else if (window.frame >= item.resumedFrame && window.frame + 128 <= item.endFrame)
          assert.ok(
            window.rms.every((v) => v > 0.01),
            JSON.stringify({ item, window }),
          );
      }
      if (item.turnOn) {
        assert.equal(item.ended, 0, JSON.stringify(item));
        assert.ok(
          item.secondCycle.every((v) => v > 0.01),
          JSON.stringify(item),
        );
      } else {
        assert.equal(item.ended, 1, JSON.stringify(item));
        assert.ok(item.naturalTail > 0.00001, JSON.stringify(item));
        assert.ok(
          item.secondCycle.every((v) => v < 0.00001),
          JSON.stringify(item),
        );
      }
    }
    console.log(
      'BACKING_TRANSPORT_PASS late Loop on/off at both rates: bounded common pre-roll pause, preserved position, both stems resume and share end',
    );
    const cycles = await browser.evaluate(`(async () => {
      const { createVoiceChain } = await import('/src/audio/chain.js');
      const { measureVoiceAlignment } = await import('/src/audio/voice-timing.js');
      const { CommonTransport } = await import('/src/audio/common-transport.js');
      const results = [];
      for (const rate of [44100, 48000]) for (const cycle of [2, 3]) {
        const period = 16384, latency = await measureVoiceAlignment(rate);
        const render = async change => {
          const context = new OfflineAudioContext(2, period * 4 + 8192, rate);
          const merger = context.createChannelMerger(2); merger.connect(context.destination);
          const splitter = context.createChannelSplitter(2); splitter.connect(merger, 0, 0);
          const backingOutput = context.createGain(); backingOutput.connect(merger, 0, 1);
          const chain = await createVoiceChain(context, { input: 0, out: 0, pitch: 0, formant: 0, vibDepth: 0, warmth: 0, ring: 0, smooth: 0, air: 0, drive: 0, comp: 0, mix: 0, chorus: 0 }, { destination: splitter, offline: true });
          chain.setBackingActive(true, latency);
          const voice = context.createBuffer(1, period, rate), backing = context.createBuffer(1, period, rate);
          for (const mark of [0, 8192, period - 1]) { voice.getChannelData(0)[mark] = .2; backing.getChannelData(0)[mark] = .25; }
          const transport = new CommonTransport(context, { voice, backing, vocalOutput: chain.input, vocalGate: chain.audioParams.playback, backingOutput, latencyFrames: latency, onEnded() {} });
          const origin = Math.round(transport.play(0, true) * rate);
          const offFrame = Math.floor((origin + (cycle - 1) * period + 4096) / 128) * 128;
          let rendered;
          if (change) {
            const off = context.suspend(offFrame / rate), on = context.suspend((offFrame + 1024) / rate);
            const rendering = context.startRendering();
            await off; transport.setLoop(false); await context.resume();
            await on; transport.setLoop(true); await context.resume(); rendered = await rendering;
          } else rendered = await context.startRendering();
          transport.stop(); chain.dispose();
          return { output: rendered, origin, offFrame };
        };
        const baseline = await render(false), changed = await render(true);
        let backingError = 0;
        for (let i = changed.offFrame; i < changed.output.length; i++) backingError = Math.max(backingError, Math.abs(changed.output.getChannelData(1)[i] - baseline.output.getChannelData(1)[i]));
        const events = [8192, period - 1].map(mark => {
          const expected = changed.origin + (cycle - 1) * period + mark, samples = changed.output.getChannelData(0);
          let amplitude = 0, offset = null;
          for (let d = -128; d <= 128; d++) if (Math.abs(samples[expected + d]) > amplitude) { amplitude = Math.abs(samples[expected + d]); offset = d; }
          return { expected, amplitude, offset };
        });
        results.push({ rate, cycle, backingError, events });
      }
      return results;
    })()`);
    assert.ok(Array.isArray(cycles), JSON.stringify(cycles));
    console.log('BACKING_CYCLE_AUDIO_OBSERVED', JSON.stringify(cycles));
    for (const item of cycles) {
      assert.ok(item.backingError < 0.000001, JSON.stringify(item));
      for (const event of item.events) {
        assert.ok(event.amplitude > 0.01, JSON.stringify(item));
        assert.ok(event.offset !== null && Math.abs(event.offset) <= 128, JSON.stringify(item));
      }
    }
    console.log(
      'BACKING_TRANSPORT_PASS second/third-cycle off/on retains both audible stem clocks',
    );
    const stopped = await browser.evaluate(`(async () => {
      const { createVoiceChain } = await import('/src/audio/chain.js');
      const { measureVoiceAlignment } = await import('/src/audio/voice-timing.js');
      const { CommonTransport } = await import('/src/audio/common-transport.js');
      const rate = 48000, frames = 32768;
      const context = new OfflineAudioContext(2, frames, rate);
      const merger = context.createChannelMerger(2); merger.connect(context.destination);
      const splitter = context.createChannelSplitter(2); splitter.connect(merger, 0, 0);
      const backingOutput = context.createGain(); backingOutput.connect(merger, 0, 1);
      const chain = await createVoiceChain(context, { input: 0, out: 0, pitch: 0, formant: 0, vibDepth: 0, warmth: 0, ring: 0, smooth: 0, air: 0, drive: 0, comp: 0, mix: 0, chorus: 0 }, { destination: splitter, offline: true });
      chain.setBackingActive(true, await measureVoiceAlignment(rate));
      const voice = context.createBuffer(1, 16384, rate), backing = context.createBuffer(1, 16384, rate);
      for (let i = 0; i < voice.length; i++) { voice.getChannelData(0)[i] = .1 * Math.sin(2 * Math.PI * 440 * i / rate); backing.getChannelData(0)[i] = .1 * Math.sin(2 * Math.PI * 660 * i / rate); }
      const transport = new CommonTransport(context, { voice, backing, vocalOutput: chain.input, vocalGate: chain.audioParams.playback, backingOutput, latencyFrames: chain.nominalLatencyFrames, onEnded() {} });
      const origin = Math.round(transport.play(0, true) * rate), stopFrame = origin + 8192;
      const suspended = context.suspend(stopFrame / rate), rendering = context.startRendering();
      await suspended; transport.stop(); await context.resume();
      const output = await rendering;
      const rms = (channel, from, to) => { let sum = 0; const samples = output.getChannelData(channel); for (let i = from; i < to; i++) sum += samples[i] ** 2; return Math.sqrt(sum / (to - from)); };
      chain.dispose();
      return { before: [0, 1].map(ch => rms(ch, stopFrame - 1024, stopFrame)), after: [0, 1].map(ch => rms(ch, stopFrame + 128, stopFrame + 2048)) };
    })()`);
    assert.equal(stopped.error, undefined, JSON.stringify(stopped));
    assert.ok(
      stopped.before.every((value) => value > 0.01),
      JSON.stringify(stopped),
    );
    assert.ok(
      stopped.after.every((value) => value < 0.00001),
      JSON.stringify(stopped),
    );
    assert.deepEqual(errors.unexpected, [], 'Unexpected page errors');
    console.log(
      'BACKING_TRANSPORT_PASS common pause/stop silences both audible stems within one quantum',
      JSON.stringify(stopped),
    );
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
}
