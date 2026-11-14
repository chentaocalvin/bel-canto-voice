import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createAppServer } from './serve.mjs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

const app = createAppServer({ root: resolve('dist') });
const server = createServer((request, response) => {
  if (!request.url.startsWith('/bel-canto-voice/')) {
    response.writeHead(404).end();
    return;
  }
  request.url = request.url.slice('/bel-canto-voice'.length);
  app.emit('request', request, response);
});
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
      await browser.send('Page.navigate', {
        url: `http://127.0.0.1:${server.address().port}/bel-canto-voice/`,
      });
      await sleep(300);
      const result = await browser.evaluate(`(async () => {
      const { prepareBacking } = await import('./src/audio/backing-processor.js');
      const { measureVoiceAlignment, minimumRecordingAdjustment } = await import('./src/audio/voice-timing.js');
      const { createBackingRecorder } = await import('./src/audio/backing-recorder.js');
      const buffer = new AudioBuffer({ numberOfChannels: 1, sampleRate: 48000, length: 48000 });
      buffer.getChannelData(0).fill(0.1);
      const shifted = await prepareBacking(buffer, 2);
      const context = new AudioContext(); await context.resume();
      const vocal = context.createGain(), backing = context.createGain();
      const recorder = await createBackingRecorder(context, { vocalNode: vocal, backingNode: backing, latencyFrames: 0 });
      recorder.discard(); await context.close();
      const rates = [];
      for (const rate of [44100, 48000, 96000, 192000]) {
        const frames = await measureVoiceAlignment(rate);
        const minimum = minimumRecordingAdjustment(rate, frames);
        rates.push({ rate, frames, minimum, total: frames + Math.round(minimum * rate / 1000) });
      }
      document.getElementById('boot-mic').click();
      return { frames: shifted.length, rate: shifted.sampleRate, rates };
    })()`);
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.frames, 48000);
      assert.equal(result.rate, 48000);
      assert.ok(
        result.rates.every((value) => value.total >= 0),
        JSON.stringify(result),
      );
      for (const width of [1440, 390]) {
        await browser.send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 940,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await sleep(100);
        const layout = await browser.evaluate(
          `({ width: innerWidth, scroll: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed').slice(0, 12).map(el => ({ tag: el.tagName, id: el.id, cls: el.className, right: el.getBoundingClientRect().right })), controls: [...document.querySelectorAll('.backing-controls button, .backing-controls input:not([hidden])')].every(el => el.offsetWidth > 0 && el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth), labels: [...document.querySelectorAll('.backing-controls input:not([hidden])')].every(el => el.labels?.length || el.getAttribute('aria-label')) })`,
        );
        assert.ok(
          layout.scroll <= width && layout.controls && layout.labels,
          JSON.stringify(layout),
        );
        if (process.env.SCREENSHOT_DIR) {
          mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
          const shot = await browser.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
          });
          writeFileSync(
            join(process.env.SCREENSHOT_DIR, `backing-${width}.png`),
            Buffer.from(shot.data, 'base64'),
          );
        }
      }
      assert.deepEqual(errors.unexpected, [], 'Unexpected page errors');
      console.log(
        'BACKING_SITE_PASS static project subpath, vendor/worklets, calibration rates and keyboard-labelled responsive controls',
        JSON.stringify(result),
      );
    },
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
