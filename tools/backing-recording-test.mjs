import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRunDirectory } from './run-directory.mjs';
import { createAppServer } from './serve.mjs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';
import { parseWav } from './wav-info.mjs';

const downloads = createRunDirectory();
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
      await browser.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloads.path,
      });
      let pausedRequest;
      browser.onEvent((event) => {
        if (event.method === 'Fetch.requestPaused') pausedRequest = event.params.requestId;
      });
      for (const action of ['mode', 'microphone']) {
        await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
        await sleep(300);
        await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*backing-capture.js' }] });
        pausedRequest = null;
        const prepared = await browser.evaluate(`(async () => {
          const get = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
          const until = async fn => { const deadline = Date.now() + 10000; while (!fn() && Date.now() < deadline) await wait(20); if (!fn()) throw new Error('Preparation setup timeout'); };
          get('boot-mic').click(); get('mic-toggle').click();
          await until(() => get('mic-toggle').getAttribute('aria-pressed') === 'true');
          const { encodeWav } = await import('/src/audio/wav.js');
          const buffer = new AudioBuffer({ length: 48000, sampleRate: 48000, numberOfChannels: 1 });
          const transfer = new DataTransfer(); transfer.items.add(new File([encodeWav(buffer)], 'race.wav', { type: 'audio/wav' }));
          get('backing-input').files = transfer.files; get('backing-input').dispatchEvent(new Event('change'));
          await until(() => get('backing-status').textContent.includes('Ready'));
          get('rec-btn').click();
          return { disabled: get('rec-btn').disabled, label: get('rec-btn').getAttribute('aria-label') };
        })()`);
        assert.equal(prepared.error, undefined, JSON.stringify(prepared));
        for (let i = 0; !pausedRequest && i < 100; i++) await sleep(20);
        assert.ok(pausedRequest, 'Real capture worklet request was intercepted');
        const reopened = await browser.evaluate(`(async () => {
          const get = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
          if (${JSON.stringify(action)} === 'mode') { get('source-file').click(); get('source-mic').click(); }
          else get('mic-toggle').click();
          get('mic-toggle').click();
          const deadline = Date.now() + 10000;
          while (get('mic-toggle').getAttribute('aria-pressed') !== 'true' && Date.now() < deadline) await wait(20);
          return get('mic-toggle').getAttribute('aria-pressed');
        })()`);
        assert.equal(reopened, 'true');
        await browser.send('Fetch.continueRequest', { requestId: pausedRequest });
        await browser.send('Fetch.disable');
        await sleep(300);
        const settled = await browser.evaluate(
          `({ label: document.getElementById('rec-btn').getAttribute('aria-label'), disabled: document.getElementById('rec-btn').disabled, backingPlaying: document.getElementById('backing-play').getAttribute('aria-pressed') })`,
        );
        console.log(
          'BACKING_PENDING_START_OBSERVED',
          JSON.stringify({ action, prepared, settled }),
        );
        assert.equal(settled.label, 'Start recording', JSON.stringify({ action, settled }));
        assert.equal(settled.disabled, false);
        assert.equal(settled.backingPlaying, 'false');
        const explicit = await browser.evaluate(
          `(async () => { document.getElementById('rec-btn').click(); await new Promise(r => setTimeout(r, 250)); return document.getElementById('rec-btn').getAttribute('aria-label'); })()`,
        );
        assert.equal(explicit, 'Stop recording', 'A new explicit Record action still works');
      }
      console.log(
        'BACKING_RECORDING_PASS pending capture preparation is invalidated by mode change and microphone teardown',
      );
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
      await sleep(300);
      const result = await browser.evaluate(`(async () => {
      const get = id => document.getElementById(id);
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const until = async fn => { const deadline = Date.now() + 10000; while (!fn() && Date.now() < deadline) await wait(20); };
      get('boot-mic').click(); get('mic-toggle').click();
      await until(() => get('mic-toggle').getAttribute('aria-pressed') === 'true');
      const { encodeWav } = await import('/src/audio/wav.js');
      const sr = window.__belcanto.ctx.sampleRate;
      const backing = new AudioBuffer({ length: sr * 4, sampleRate: sr, numberOfChannels: 2 });
      for (let ch = 0; ch < 2; ch++) for (let i = 0; i < backing.length; i++) backing.getChannelData(ch)[i] = 0.1 * Math.sin(2 * Math.PI * (ch ? 880 : 660) * i / sr);
      const transfer = new DataTransfer(); transfer.items.add(new File([encodeWav(backing)], 'take-backing.wav', { type: 'audio/wav' }));
      get('backing-input').files = transfer.files; get('backing-input').dispatchEvent(new Event('change'));
      await until(() => get('backing-status').textContent.includes('Ready'));
      get('monitor').click(); get('rec-btn').click(); await wait(350);
      const locked = ['input', 'remove', 'pitch', 'reset', 'position'].every(id => get('backing-' + id).disabled);
      get('rec-pause').click(); await wait(200);
      const pausedPosition = Number(get('backing-position').value);
      await wait(200);
      const afterPause = Number(get('backing-position').value);
      get('backing-gain').value = '-18'; get('backing-gain').dispatchEvent(new Event('input'));
      get('rec-pause').click(); await wait(350);
      get('rec-btn').click(); await until(() => !get('rec-actions').hidden);
      const pendingLocked = get('backing-remove').disabled;
      const elapsed = window.__belcanto.rec.elapsed;
      return { locked, pausedPosition, afterPause, pendingLocked, elapsed, sr };
    })()`);
      assert.equal(result.error, undefined, JSON.stringify(result));
      result.retryOwned = await errors.expect(
        { kind: 'console.error', message: 'Error: Simulated download failure' },
        () =>
          browser.evaluate(`(async () => {
          const get = id => document.getElementById(id);
          const original = URL.createObjectURL;
          URL.createObjectURL = () => { throw new Error('Simulated download failure'); };
          try {
            get('rec-save').click(); await new Promise(r => setTimeout(r, 150));
            return !get('rec-actions').hidden && !get('rec-save').disabled && get('backing-remove').disabled;
          } finally { URL.createObjectURL = original; }
        })()`),
      );
      result.unlocked = await browser.evaluate(`(async () => {
        const get = id => document.getElementById(id), deadline = Date.now() + 10000;
        get('rec-save').click();
        while (!get('rec-actions').hidden && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
        return !get('backing-remove').disabled;
      })()`);
      assert.ok(
        result.locked && result.pendingLocked && result.retryOwned && result.unlocked,
        JSON.stringify(result),
      );
      assert.ok(result.pausedPosition > 0.15, JSON.stringify(result));
      assert.equal(result.afterPause, result.pausedPosition);
      let file;
      for (let i = 0; i < 100; i++) {
        file = readdirSync(downloads.path).find((name) => name.endsWith('.wav'));
        if (file) break;
        await sleep(50);
      }
      assert.ok(file, 'Saved WAV after retry');
      const info = parseWav(readFileSync(join(downloads.path, file)));
      assert.equal(info.ok, true);
      assert.equal(info.channels, 2);
      assert.equal(info.bitsPerSample, 16);
      assert.ok(Math.abs(info.duration - result.elapsed) <= 1 / result.sr);
      assert.ok(
        info.duration > 0.4 && info.duration < 1.2 && info.peak > 0.01,
        JSON.stringify(info),
      );
      assert.deepEqual(errors.unexpected, [], 'Unexpected page errors');
      console.log(
        'BACKING_RECORDING_PASS locks, pause/resume, actual muted-monitor WAV, sample-clock duration and save retry',
        JSON.stringify(result),
      );
    },
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  downloads.cleanup();
}
