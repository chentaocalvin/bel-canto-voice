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
  await withBrowser({ commandTimeout: 120000 }, async (browser) => {
    const errors = createPageErrors();
    browser.onEvent(errors.record);
    await browser.send('Runtime.enable');
    await browser.send('Page.enable');
    await browser.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloads.path,
    });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await sleep(300);
    const setup = await browser.evaluate(`(async () => {
      const get = id => document.getElementById(id);
      get('boot-file').click();
      const { encodeWav } = await import('/src/audio/wav.js');
      const load = async (id, buffer, name, ready) => {
        const transfer = new DataTransfer(); transfer.items.add(new File([encodeWav(buffer)], name, { type: 'audio/wav' }));
        get(id).files = transfer.files; get(id).dispatchEvent(new Event('change'));
        const deadline = Date.now() + 10000;
        while (!ready() && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
      };
      const voice = new AudioBuffer({ length: 96000, sampleRate: 48000, numberOfChannels: 1 });
      voice.getChannelData(0)[0] = 0.125; voice.getChannelData(0)[95999] = 0.125;
      await load('file-input', voice, 'alignment.wav', () => get('file-name').textContent === 'alignment.wav');
      const sr = window.__belcanto.ctx.sampleRate;
      const backing = new AudioBuffer({ length: sr * 6 + 19, sampleRate: sr, numberOfChannels: 2 });
      backing.getChannelData(0)[0] = 0.25; backing.getChannelData(1)[backing.length - 1] = -0.25;
      await load('backing-input', backing, 'backing.wav', () => get('backing-status').textContent.includes('Ready'));
      get('backing-gain').value = '0'; get('backing-gain').dispatchEvent(new Event('input'));
      get('bypass').click(); get('monitor').click(); get('loop-btn').click();
      get('backing-position').value = '3'; get('backing-position').dispatchEvent(new Event('input'));
      get('export-btn').click();
      return { rate: sr, frames: sr * 6 + 19 };
    })()`);
    assert.equal(setup.error, undefined, JSON.stringify(setup));
    let file;
    for (let i = 0; i < 200; i++) {
      file = readdirSync(downloads.path).find((name) => name.endsWith('.wav'));
      if (file) break;
      await sleep(100);
    }
    assert.ok(file, 'Actual Export WAV download');
    const wav = readFileSync(join(downloads.path, file));
    const info = parseWav(wav);
    assert.equal(info.ok, true);
    assert.equal(info.channels, 2);
    assert.equal(info.bitsPerSample, 16);
    assert.equal(info.sampleRate, setup.rate);
    assert.equal(info.dataBytes / 4, setup.frames);
    const sample = (frame, channel) =>
      wav.readInt16LE(info.dataOffset + frame * 4 + channel * 2) / 32768;
    assert.ok(
      Math.abs(sample(setup.frames - 1, 1) + 0.25) < 0.0001,
      'Backing final frame remains at its exact source position',
    );
    assert.ok(Math.abs(sample(0, 0)) > 0.2, 'Backing first frame survives');
    assert.ok(
      Array.from({ length: 128 }, (_, i) => Math.abs(sample(i, 1))).some((value) => value > 0.001),
      'Vocal first event survives compensated render',
    );
    const tailStart = 2 * setup.rate - 129;
    assert.ok(
      Array.from({ length: 256 }, (_, i) => Math.abs(sample(tailStart + i, 1))).some(
        (value) => value > 0.001,
      ),
      'Vocal final event survives drain',
    );
    assert.deepEqual(errors.unexpected, [], 'Unexpected page errors');
    console.log(
      'BACKING_EXPORT_PASS actual stereo PCM16 WAV, exact duration, head/tail alignment, muted monitor, seek/loop ignored',
      JSON.stringify(setup),
    );
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
  downloads.cleanup();
}
