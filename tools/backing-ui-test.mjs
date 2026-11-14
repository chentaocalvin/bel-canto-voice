import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAppServer } from './serve.mjs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

const server = createAppServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  await withBrowser(
    {
      commandTimeout: 120000,
      flags: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    async (browser) => {
      const errors = createPageErrors();
      browser.onEvent(errors.record);
      await browser.send('Runtime.enable');
      await browser.send('Page.enable');
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
      await sleep(300);
      const result = await browser.evaluate(`(async () => {
      document.getElementById('boot-file').click();
      const input = document.getElementById('backing-input');
      if (!input) return { missing: 'backing-input' };
      const { encodeWav } = await import('/src/audio/wav.js');
      const buffer = new AudioBuffer({ length: 48000 * 6, sampleRate: 48000, numberOfChannels: 2 });
      for (let ch = 0; ch < 2; ch++) for (let i = 0; i < buffer.length; i++) buffer.getChannelData(ch)[i] = 0.15 * Math.sin(2 * Math.PI * (ch ? 660 : 440) * i / 48000);
      const transfer = new DataTransfer();
      transfer.items.add(new File([encodeWav(buffer)], 'backing.wav', { type: 'audio/wav' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const deadline = Date.now() + 10000;
      while (!document.getElementById('backing-status').textContent.includes('Ready') && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
      return { status: document.getElementById('backing-status').textContent, playing: document.getElementById('backing-play').getAttribute('aria-pressed'), shift: document.getElementById('backing-pitch').value, gain: document.getElementById('backing-gain').value };
    })()`);
      assert.match(result.status || '', /Ready/);
      assert.equal(result.playing, 'false');
      assert.equal(result.shift, '0');
      assert.equal(result.gain, '-6');
      console.log('BACKING_UI_PASS load prepares without autoplay and leaves mixing headroom');
      const controls = await browser.evaluate(`(async () => {
      const get = id => document.getElementById(id);
      get('source-mic').click();
      const values = JSON.stringify(window.__belcanto.values);
      get('backing-gain').value = '-12'; get('backing-gain').dispatchEvent(new Event('input'));
      get('backing-pitch').value = '2'; get('backing-pitch').dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 1200));
      const unchanged = values === JSON.stringify(window.__belcanto.values);
      get('preset-next').click(); get('bypass').click(); get('reset-btn').click();
      get('backing-play').click(); await new Promise(r => setTimeout(r, 200));
      const playing = get('backing-play').getAttribute('aria-pressed');
      const position = Number(get('backing-position').value);
      get('backing-play').click(); await new Promise(r => setTimeout(r, 100));
      return { unchanged, gain: get('backing-gain').value, pitch: get('backing-pitch').value, playing, position, paused: get('backing-play').getAttribute('aria-pressed') };
    })()`);
      assert.equal(controls.unchanged, true);
      assert.equal(controls.gain, '-12');
      assert.equal(controls.pitch, '2');
      assert.equal(controls.playing, 'true');
      assert.equal(controls.paused, 'false');
      assert.ok(controls.position > 0.05, JSON.stringify(controls));
      console.log('BACKING_UI_PASS microphone preview and independent controls');
      const common = await browser.evaluate(`(async () => {
      const get = id => document.getElementById(id);
      get('source-file').click();
      const { encodeWav } = await import('/src/audio/wav.js');
      const voice = new AudioBuffer({ length: 96000, sampleRate: 48000, numberOfChannels: 1 });
      for (let i = 0; i < voice.length; i++) voice.getChannelData(0)[i] = 0.1 * Math.sin(2 * Math.PI * 220 * i / 48000);
      const transfer = new DataTransfer(); transfer.items.add(new File([encodeWav(voice)], 'voice.wav', { type: 'audio/wav' }));
      get('file-input').files = transfer.files; get('file-input').dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 400));
      const duration = Number(get('timeline').getAttribute('aria-valuemax'));
      get('play-btn').click(); await new Promise(r => setTimeout(r, 250));
      const playing = get('play-btn').getAttribute('aria-label');
      get('backing-position').value = '5.5'; get('backing-position').dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 200));
      const position = Number(get('timeline').getAttribute('aria-valuenow'));
      get('play-btn').click();
      return { duration, playing, position, paused: get('play-btn').getAttribute('aria-label') };
    })()`);
      assert.equal(common.duration, 6);
      assert.equal(common.playing, 'Pause playback');
      assert.ok(common.position > 5.5 && common.position < 6, JSON.stringify(common));
      assert.equal(common.paused, 'Play');
      console.log('BACKING_UI_PASS common timeline follows longer backing and shared seek/pause');

      const loopTransition = await browser.evaluate(`(async () => {
        const get = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
        const position = () => Number(get('timeline').getAttribute('aria-valuenow'));
        const seek = value => { get('backing-position').value = String(value); get('backing-position').dispatchEvent(new Event('input')); };
        seek(5.75); get('play-btn').click();
        const deadline = Date.now() + 3000;
        while (position() < 5.93 && Date.now() < deadline) await wait(5);
        const before = position(); get('loop-btn').click();
        await wait(40); const held = position();
        await wait(350); const resumed = position(), playing = get('play-btn').getAttribute('aria-label');
        seek(5.96); get('loop-btn').click();
        await wait(500);
        return { before, held, resumed, playing, stopped: get('play-btn').getAttribute('aria-label'), loop: get('loop-btn').getAttribute('aria-pressed') };
      })()`);
      assert.equal(loopTransition.error, undefined, JSON.stringify(loopTransition));
      assert.ok(
        loopTransition.before >= 5.93 && loopTransition.before < 6,
        JSON.stringify(loopTransition),
      );
      assert.ok(
        Math.abs(loopTransition.held - loopTransition.before) < 0.03,
        JSON.stringify(loopTransition),
      );
      assert.ok(
        loopTransition.resumed > 0.1 && loopTransition.resumed < 0.7,
        JSON.stringify(loopTransition),
      );
      assert.equal(loopTransition.playing, 'Pause playback');
      assert.equal(loopTransition.stopped, 'Play');
      assert.equal(loopTransition.loop, 'false');
      console.log(
        'BACKING_UI_PASS late Loop change holds the common playhead during pre-roll, wraps then stops both tracks',
        JSON.stringify(loopTransition),
      );

      const multiCycle = await browser.evaluate(`(async () => {
        const get = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
        const position = () => Number(get('timeline').getAttribute('aria-valuenow'));
        const seek = value => { get('backing-position').value = String(value); get('backing-position').dispatchEvent(new Event('input')); };
        const { encodeWav } = await import('/src/audio/wav.js');
        const rate = window.__belcanto.ctx.sampleRate;
        const buffer = new AudioBuffer({ length: rate * 6, sampleRate: rate, numberOfChannels: 1 });
        for (let i = 0; i < buffer.length; i++) buffer.getChannelData(0)[i] = .15 * Math.sin(2 * Math.PI * (220 + 110 * Math.floor(i / rate)) * i / rate);
        const transfer = new DataTransfer(); transfer.items.add(new File([encodeWav(buffer)], 'clock-sections.wav', { type: 'audio/wav' }));
        get('backing-input').files = transfer.files; get('backing-input').dispatchEvent(new Event('change'));
        const deadline = Date.now() + 10000;
        while (!get('backing-status').textContent.includes('clock-sections.wav') && Date.now() < deadline) await wait(20);
        const analyser = window.__belcanto.ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
        const sink = window.__belcanto.ctx.createGain(); sink.gain.value = 0;
        window.__belcanto.backing.monitor.connect(analyser); analyser.connect(sink).connect(window.__belcanto.ctx.destination);
        const frequency = () => { const bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins); let peak = 1; for (let i = 2; i < bins.length; i++) if (bins[i] > bins[peak]) peak = i; return { hz: peak * rate / analyser.fftSize, db: bins[peak] }; };
        const results = [];
        for (const cycle of [2, 3]) for (const action of ['on', 'pause']) {
          if (get('play-btn').getAttribute('aria-label') === 'Pause playback') get('play-btn').click();
          if (get('loop-btn').getAttribute('aria-pressed') !== 'true') get('loop-btn').click();
          seek(0); get('play-btn').click();
          let wraps = 0, previous = 0;
          const limit = Date.now() + 20000;
          while (Date.now() < limit) {
            const current = position(); if (previous - current > 3) wraps++;
            previous = current;
            if (wraps === cycle - 1 && current >= 2) break;
            await wait(5);
          }
          const before = position(); get('loop-btn').click(); await wait(80);
          const off = position(), offTone = frequency();
          let paused = null;
          if (action === 'on') get('loop-btn').click();
          else { get('play-btn').click(); paused = position(); await wait(30); get('play-btn').click(); }
          await wait(250);
          results.push({ cycle, action, wraps, before, off, paused, after: position(), offTone, afterTone: frequency(), binWidth: rate / analyser.fftSize });
        }
        get('play-btn').click();
        if (get('loop-btn').getAttribute('aria-pressed') === 'true') get('loop-btn').click();
        window.__belcanto.backing.monitor.disconnect(analyser); analyser.disconnect(); sink.disconnect();
        return results;
      })()`);
      assert.ok(Array.isArray(multiCycle), JSON.stringify(multiCycle));
      console.log('BACKING_MULTICYCLE_OBSERVED', JSON.stringify(multiCycle));
      for (const item of multiCycle) {
        assert.equal(item.wraps, item.cycle - 1, JSON.stringify(item));
        assert.ok(item.before >= 2 && item.before < 2.1, JSON.stringify(item));
        assert.ok(item.off >= item.before && item.off < 2.4, JSON.stringify(item));
        assert.ok(item.after > 2.1 && item.after < 2.7, JSON.stringify(item));
        if (item.paused !== null)
          assert.ok(item.paused >= 2 && item.paused < 2.4, JSON.stringify(item));
        for (const tone of [item.offTone, item.afterTone]) {
          assert.ok(tone.db > -60, JSON.stringify(item));
          assert.ok(Math.abs(tone.hz - 440) <= item.binWidth, JSON.stringify(item));
        }
      }
      console.log(
        'BACKING_UI_PASS second/third-cycle Loop off/on and off/pause/resume preserve displayed position and actual audible section',
      );

      const transactions = await browser.evaluate(`(async () => {
      const get = id => document.getElementById(id);
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const { encodeWav } = await import('/src/audio/wav.js');
      const buffer = new AudioBuffer({ length: 48000, sampleRate: 48000, numberOfChannels: 1 });
      buffer.getChannelData(0).fill(0.1);
      const load = file => { const transfer = new DataTransfer(); transfer.items.add(file); get('backing-input').files = transfer.files; get('backing-input').dispatchEvent(new Event('change')); };
      get('source-mic').click();
      const slow = new File([encodeWav(buffer)], 'superseded.wav', { type: 'audio/wav' });
      const originalRead = slow.arrayBuffer.bind(slow);
      slow.arrayBuffer = async () => { await wait(250); return originalRead(); };
      load(slow); await wait(20); load(new File([encodeWav(buffer)], 'latest.wav', { type: 'audio/wav' }));
      await wait(600);
      const latest = get('backing-status').textContent;
      get('backing-pitch').value = '6'; get('backing-pitch').dispatchEvent(new Event('input'));
      get('backing-pitch').value = '0'; get('backing-pitch').dispatchEvent(new Event('input'));
      await wait(1200);
      const stalePitch = get('backing-pitch').value;
      const OriginalOffline = window.OfflineAudioContext;
      window.OfflineAudioContext = class { constructor() { throw new Error('Simulated processor failure'); } };
      get('backing-pitch').value = '3'; get('backing-pitch').dispatchEvent(new Event('input'));
      await wait(100); window.OfflineAudioContext = OriginalOffline;
      const failedPitch = get('backing-pitch').value, failure = get('backing-status').textContent;
      get('backing-play').click(); await wait(200);
      const stillUsable = Number(get('backing-position').value) > 0.05;
      load(new File(['invalid audio'], 'broken.wav', { type: 'audio/wav' })); await wait(200);
      const failedReplacement = get('backing-status').textContent.includes('failed') && get('backing-play').getAttribute('aria-pressed') === 'true';
      get('backing-remove').click(); await wait(100);
      return { latest, stalePitch, failedPitch, failure, stillUsable, failedReplacement, removed: get('backing-status').textContent, stopped: get('backing-play').getAttribute('aria-pressed') };
    })()`);
      assert.match(transactions.latest, /latest.wav/);
      assert.equal(transactions.stalePitch, '0');
      assert.equal(transactions.failedPitch, '0');
      assert.match(transactions.failure, /failed/);
      assert.ok(
        transactions.stillUsable && transactions.failedReplacement,
        JSON.stringify(transactions),
      );
      assert.equal(transactions.removed, 'No backing loaded');
      assert.equal(transactions.stopped, 'false');
      assert.deepEqual(errors.unexpected, [], 'Unexpected page errors');
      console.log(
        'BACKING_UI_PASS stale work rejected, processor/decode failures preserve usable audio, removal stops playback',
      );
    },
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
