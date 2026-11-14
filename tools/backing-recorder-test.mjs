import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAppServer } from './serve.mjs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

const server = createAppServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  await withBrowser({ commandTimeout: 40000 }, async (browser) => {
    const errors = createPageErrors();
    browser.onEvent(errors.record);
    await browser.send('Runtime.enable');
    await browser.send('Page.enable');
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await sleep(300);
    const result = await browser.evaluate(`(async () => {
      const { createBackingRecorder } = await import('/src/audio/backing-recorder.js');
      const { encodeWav } = await import('/src/audio/wav.js');
      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
      try {
        const vocal = ctx.createBufferSource(), backing = ctx.createBufferSource();
        vocal.buffer = ctx.createBuffer(2, 8192, 48000);
        backing.buffer = ctx.createBuffer(2, 8192, 48000);
        vocal.buffer.getChannelData(0)[0] = 0.125;
        vocal.buffer.getChannelData(1)[8191] = -0.25;
        backing.buffer.getChannelData(0)[31] = 0.375;
        backing.buffer.getChannelData(1)[4097] = -0.5;
        const recorder = await createBackingRecorder(ctx, {
          vocalNode: vocal, backingNode: backing, latencyFrames: 0,
        });
        const start = Math.ceil(ctx.currentTime * ctx.sampleRate) + 4096;
        recorder.start(start);
        vocal.start(start / ctx.sampleRate);
        backing.start(start / ctx.sampleRate);
        const take = await recorder.stop(start + 8192);
        const bytes = await encodeWav(take).arrayBuffer();
        const view = new DataView(bytes);
        const decoded = await ctx.decodeAudioData(bytes.slice(0));
        const observed = [];
        for (let channel = 0; channel < 2; channel++) {
          decoded.getChannelData(channel).forEach((value, frame) => {
            if (Math.abs(value) > 0.01) observed.push([channel, frame, value]);
          });
        }
        recorder.discard();
        return { format: view.getUint16(20, true), bits: view.getUint16(34, true),
          frames: decoded.length, rate: decoded.sampleRate, channels: decoded.numberOfChannels,
          observed };
      } finally { await ctx.close(); }
    })()`);
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.format, 1);
    assert.equal(result.bits, 16);
    assert.equal(result.frames, 8192);
    assert.equal(result.rate, 48000);
    assert.equal(result.channels, 2);
    const expected = [
      [0, 0, 0.125],
      [0, 31, 0.375],
      [1, 4097, -0.5],
      [1, 8191, -0.25],
    ];
    assert.equal(result.observed.length, expected.length, JSON.stringify(result));
    for (const [index, marker] of expected.entries()) {
      assert.deepEqual(result.observed[index].slice(0, 2), marker.slice(0, 2));
      assert.ok(Math.abs(result.observed[index][2] - marker[2]) <= 1 / 32768);
    }
    console.log(
      'BACKING_RECORDER_PASS stereo stems, exact start/end frames and real PCM WAV',
      JSON.stringify(result),
    );
    const aligned = await browser.evaluate(`(async () => {
      const { createBackingRecorder } = await import('/src/audio/backing-recorder.js');
      const { encodeWav } = await import('/src/audio/wav.js');
      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
      try {
        const vocal = ctx.createBufferSource(), backing = ctx.createBufferSource();
        vocal.buffer = ctx.createBuffer(2, 10262, 48000);
        backing.buffer = ctx.createBuffer(2, 8192, 48000);
        vocal.buffer.getChannelData(0)[2070] = 0.125;
        vocal.buffer.getChannelData(1)[10261] = -0.25;
        backing.buffer.getChannelData(0)[31] = 0.375;
        backing.buffer.getChannelData(1)[8191] = -0.5;
        const recorder = await createBackingRecorder(ctx, {
          vocalNode: vocal, backingNode: backing, latencyFrames: 2053, adjustmentFrames: 17,
        });
        const start = Math.ceil(ctx.currentTime * ctx.sampleRate) + 4096;
        recorder.start(start);
        vocal.start(start / ctx.sampleRate);
        backing.start(start / ctx.sampleRate);
        const decoded = await ctx.decodeAudioData(await encodeWav(await recorder.stop(start + 8192)).arrayBuffer());
        const observed = [];
        for (let channel = 0; channel < 2; channel++) {
          decoded.getChannelData(channel).forEach((value, frame) => {
            if (Math.abs(value) > 0.01) observed.push([channel, frame, value]);
          });
        }
        recorder.discard();
        return { frames: decoded.length, observed };
      } finally { await ctx.close(); }
    })()`);
    assert.equal(aligned.error, undefined, JSON.stringify(aligned));
    assert.equal(aligned.frames, 8192);
    const alignedMarkers = [
      [0, 0, 0.125],
      [0, 31, 0.375],
      [1, 8191, -0.75],
    ];
    assert.equal(aligned.observed.length, alignedMarkers.length, JSON.stringify(aligned));
    for (const [index, marker] of alignedMarkers.entries()) {
      assert.deepEqual(aligned.observed[index].slice(0, 2), marker.slice(0, 2));
      assert.ok(Math.abs(aligned.observed[index][2] - marker[2]) <= 1 / 32768);
    }
    console.log(
      'BACKING_RECORDER_PASS vocal latency plus residual adjustment; backing unchanged; tail drain',
      JSON.stringify(aligned),
    );
    const segmented = await browser.evaluate(`(async () => {
      const { createBackingRecorder } = await import('/src/audio/backing-recorder.js');
      const { encodeWav } = await import('/src/audio/wav.js');
      const ctx = new AudioContext({ sampleRate: 44100 });
      await ctx.resume();
      try {
        const vocalGain = ctx.createGain(), backingGain = ctx.createGain();
        const recorder = await createBackingRecorder(ctx, {
          vocalNode: vocalGain, backingNode: backingGain, latencyFrames: 256,
        });
        const start = Math.ceil(ctx.currentTime * ctx.sampleRate) + 4096;
        const resume = start + 16384;
        for (const frame of [start, resume]) {
          const vocal = ctx.createBufferSource(), backing = ctx.createBufferSource();
          vocal.buffer = ctx.createBuffer(2, 8192, 44100);
          backing.buffer = ctx.createBuffer(2, 8192, 44100);
          vocal.buffer.getChannelData(0)[256] = 0.5;
          vocal.buffer.getChannelData(1)[4351] = -0.5;
          backing.buffer.getChannelData(0)[31] = 0.25;
          backing.buffer.getChannelData(1)[4095] = -0.25;
          vocal.buffer.getChannelData(0)[6000] = 0.75;
          backing.buffer.getChannelData(1)[6000] = 0.75;
          vocal.connect(vocalGain); backing.connect(backingGain);
          vocal.start(frame / ctx.sampleRate); backing.start(frame / ctx.sampleRate);
        }
        vocalGain.gain.setValueAtTime(0.5, start / ctx.sampleRate);
        vocalGain.gain.setValueAtTime(0.25, resume / ctx.sampleRate);
        backingGain.gain.setValueAtTime(0.5, start / ctx.sampleRate);
        backingGain.gain.setValueAtTime(0.75, resume / ctx.sampleRate);
        recorder.start(start);
        await recorder.pause(start + 4096);
        recorder.resume(resume);
        const take = await recorder.stop(resume + 4096);
        const decoded = await ctx.decodeAudioData(await encodeWav(take).arrayBuffer());
        const observed = [];
        for (let channel = 0; channel < 2; channel++) {
          decoded.getChannelData(channel).forEach((value, frame) => {
            if (Math.abs(value) > 0.01) observed.push([channel, frame, value]);
          });
        }
        recorder.discard();
        return { rate: decoded.sampleRate, frames: decoded.length, observed };
      } finally { await ctx.close(); }
    })()`);
    assert.equal(segmented.error, undefined, JSON.stringify(segmented));
    assert.equal(segmented.rate, 44100);
    assert.equal(segmented.frames, 8192);
    const segmentMarkers = [
      [0, 0, 0.25],
      [0, 31, 0.125],
      [0, 4096, 0.125],
      [0, 4127, 0.1875],
      [1, 4095, -0.375],
      [1, 8191, -0.3125],
    ];
    assert.equal(segmented.observed.length, segmentMarkers.length, JSON.stringify(segmented));
    for (const [index, marker] of segmentMarkers.entries()) {
      assert.deepEqual(segmented.observed[index].slice(0, 2), marker.slice(0, 2));
      assert.ok(Math.abs(segmented.observed[index][2] - marker[2]) <= 1 / 32768);
    }
    console.log(
      'BACKING_RECORDER_PASS pause gap omitted equally; segment head/tail drained; live gains captured',
      JSON.stringify(segmented),
    );
    const monitoring = await browser.evaluate(`(async () => {
      const { createBackingRecorder } = await import('/src/audio/backing-recorder.js');
      const { encodeWav } = await import('/src/audio/wav.js');
      const results = [];
      for (const gain of [1, 0, 0.5]) {
        const ctx = new AudioContext({ sampleRate: 48000 });
        await ctx.resume();
        const sink = ctx.createMediaStreamDestination();
        Object.defineProperty(ctx, 'destination', { value: sink });
        try {
        const vocal = ctx.createBufferSource(), backing = ctx.createBufferSource();
        const monitor = ctx.createGain();
        monitor.gain.value = gain;
        vocal.buffer = ctx.createBuffer(2, 48000, 48000);
        backing.buffer = ctx.createBuffer(2, 48000, 48000);
        for (let channel = 0; channel < 2; channel++) {
          for (let frame = 0; frame < 48000; frame++) {
            const wave = Math.sin(2 * Math.PI * 750 * frame / 48000) * (channel ? -1 : 1);
            vocal.buffer.getChannelData(channel)[frame] = 0.25 * wave;
            backing.buffer.getChannelData(channel)[frame] = 0.125 * wave;
          }
        }
        vocal.connect(monitor); backing.connect(monitor); monitor.connect(ctx.destination);
        const recorder = gain === 1 ? null : await createBackingRecorder(ctx, {
          vocalNode: vocal, backingNode: backing, latencyFrames: 0,
        });
        const media = new MediaRecorder(sink.stream);
        const chunks = [];
        const speakerOutput = new Promise((resolve, reject) => {
          media.ondataavailable = event => chunks.push(event.data);
          media.onerror = event => reject(new Error(event.error?.message || 'Speaker capture failed.'));
          media.onstop = () => resolve(new Blob(chunks, { type: media.mimeType }));
        });
        media.start();
        const start = Math.ceil(ctx.currentTime * ctx.sampleRate) + 8192;
        recorder?.start(start);
        vocal.start(start / 48000); backing.start(start / 48000);
        const pending = recorder?.stop(start + 48000);
        while (ctx.currentTime * ctx.sampleRate < start + 50048) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        media.stop();
        const audible = await ctx.decodeAudioData(await (await speakerOutput).arrayBuffer());
        function rms(buffer) {
          const samples = buffer.getChannelData(0);
          const middle = Math.floor(samples.length / 2);
          let energy = 0;
          for (let frame = middle - 2048; frame < middle + 2048; frame++) energy += samples[frame] ** 2;
          return Math.sqrt(energy / 4096);
        }
        const result = { gain, audibleRms: rms(audible), codec: media.mimeType };
        if (recorder) {
          const first = new Uint8Array(await encodeWav(await pending).arrayBuffer());
          const second = new Uint8Array(await encodeWav(await recorder.stop(start + 48000)).arrayBuffer());
          const saved = await ctx.decodeAudioData(first.buffer.slice(0));
          result.frames = saved.length;
          result.repeat = first.length === second.length && first.every((value, i) => value === second[i]);
          result.savedRms = rms(saved);
          recorder.discard(); recorder.discard();
        }
        results.push(result);
        } finally { sink.stream.getTracks().forEach(track => track.stop()); await ctx.close(); }
      }
      return results;
    })()`);
    assert.ok(Array.isArray(monitoring), JSON.stringify(monitoring));
    assert.ok(
      Math.abs(monitoring[0].audibleRms - 0.2651650429449553) <= 0.02651650429449553,
      JSON.stringify(monitoring),
    );
    for (const item of monitoring.slice(1)) {
      assert.equal(item.frames, 48000);
      assert.equal(item.repeat, true);
      assert.ok(Math.abs(item.savedRms - 0.2651650429449553) <= 1 / 32768, JSON.stringify(item));
      if (item.gain === 0) assert.ok(item.audibleRms <= 0.0001, JSON.stringify(item));
      else
        assert.ok(
          Math.abs(item.audibleRms / monitoring[0].audibleRms - 0.5) <= 0.05,
          JSON.stringify(item),
        );
    }
    console.log(
      'BACKING_RECORDER_PASS silent sink; monitor mute independent; no doubled output; repeat WAV identical',
      JSON.stringify(monitoring),
    );
    const lifecycle = await browser.evaluate(`(async () => {
      const { createBackingRecorder } = await import('/src/audio/backing-recorder.js');
      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
      try {
        const vocal = ctx.createGain(), backing = ctx.createGain();
        const options = { vocalNode: vocal, backingNode: backing, latencyFrames: 0 };
        const errors = [];
        function rejects(name, action) {
          try { action(); return false; }
          catch (error) { errors.push([name, error.message]); return !!error.message; }
        }
        let negativeRejected = false;
        try { await createBackingRecorder(ctx, { ...options, adjustmentFrames: -1 }); }
        catch (error) { negativeRejected = error instanceof RangeError; }
        const recorder = await createBackingRecorder(ctx, options);
        const frame = Math.ceil(ctx.currentTime * ctx.sampleRate) + 4096;
        const checks = [negativeRejected,
          rejects('idle stop', () => recorder.stop(frame)),
          rejects('idle pause', () => recorder.pause(frame)),
          rejects('idle resume', () => recorder.resume(frame)),
          rejects('past start', () => recorder.start(-1))];
        recorder.start(frame);
        checks.push(rejects('second start', () => recorder.start(frame)),
          rejects('active resume', () => recorder.resume(frame)),
          rejects('empty segment', () => recorder.pause(frame)));
        const drained = recorder.pause(frame + 1024);
        checks.push(rejects('resume before drain', () => recorder.resume(frame + 8192)));
        const pending = recorder.stop(frame + 8192);
        checks.push(pending === recorder.stop(frame + 8192));
        await drained;
        const take = await pending;
        checks.push(take.length === 1024,
          rejects('pending start', () => recorder.start(frame + 8192)));
        recorder.discard(); recorder.discard();
        checks.push(rejects('discarded stop', () => recorder.stop(frame + 8192)),
          rejects('discarded start', () => recorder.start(frame + 8192)));
        const next = await createBackingRecorder(ctx, options);
        const nextFrame = Math.ceil(ctx.currentTime * ctx.sampleRate) + 4096;
        next.start(nextFrame);
        const canceled = next.stop(nextFrame + 1024).then(() => false, error => /discarded/i.test(error.message));
        next.discard();
        checks.push(await canceled);
        const fresh = await createBackingRecorder(ctx, options);
        const freshFrame = Math.ceil(ctx.currentTime * ctx.sampleRate) + 4096;
        fresh.start(freshFrame);
        const freshTake = await fresh.stop(freshFrame + 1024);
        checks.push(freshTake.length === 1024);
        fresh.discard();
        return { checks, errors };
      } finally { await ctx.close(); }
    })()`);
    assert.equal(lifecycle.error, undefined, JSON.stringify(lifecycle));
    assert.ok(lifecycle.checks.every(Boolean), JSON.stringify(lifecycle));
    assert.deepEqual(errors.unexpected, [], 'Unexpected page errors');
    console.log(
      'BACKING_RECORDER_PASS lifecycle errors; stop during pause drain; discard cancellation; fresh take',
      JSON.stringify(lifecycle),
    );
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
}
