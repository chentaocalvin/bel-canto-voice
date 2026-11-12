#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

const url = process.argv[2];
const output = process.argv[3];
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 900);
const expression = process.argv[6] || '';
if (!url || !output)
  throw new Error('Usage: node tools/shot.mjs <url> <output.png> [width] [height] [expression]');

await withBrowser(
  {
    flags: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
    ],
    commandTimeout: 20000,
  },
  async (browser) => {
    const errors = createPageErrors();
    browser.onEvent(errors.record);
    await browser.send('Page.enable');
    await browser.send('Runtime.enable');
    await browser.send('Page.navigate', { url });
    await sleep(2200);
    if (expression) {
      await browser.evaluate(expression);
      await sleep(2500);
    }
    if (errors.unexpected.length) throw new Error(JSON.stringify(errors.unexpected));
    const screenshot = await browser.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
    console.log('saved', output);
  },
);
