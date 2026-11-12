#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';
import { titleExitCode } from './page-status.mjs';

const url = process.argv[2] || `${process.env.BASE_URL || 'http://127.0.0.1:5188'}/tools/e2e.html`;
const success = new RegExp(process.argv[3] || '^E2E_PASS$');
const timeout = Number(process.argv[4] || 45000);

process.exitCode = await withBrowser(
  { flags: ['--disable-background-networking'], commandTimeout: 20000 },
  async (browser) => {
    const errors = createPageErrors();
    const logs = [];
    browser.onEvent(errors.record);
    browser.onEvent((message) => {
      if (message.method === 'Runtime.consoleAPICalled') {
        logs.push(
          `[console.${message.params.type}] ${(message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')}`,
        );
      }
      if (message.method === 'Log.entryAdded')
        logs.push(`[log.${message.params.entry.level}] ${message.params.entry.text}`);
    });
    await browser.send('Runtime.enable');
    await browser.send('Log.enable');
    await browser.send('Page.enable');
    await browser.send('Page.navigate', { url });
    const deadline = Date.now() + timeout;
    let title = '';
    let body = '';
    let exitCode = null;
    while (Date.now() < deadline) {
      await sleep(400);
      const snapshot = await browser.evaluate(
        '({title: document.title, body: document.body ? document.body.innerText : ""})',
      );
      if (snapshot?.error) break;
      title = snapshot.title;
      body = snapshot.body;
      exitCode = titleExitCode(title, success);
      if (exitCode !== null) break;
    }
    console.log('title:', title);
    console.log(body);
    if (logs.length) console.log(logs.join('\n'));
    if (errors.unexpected.length) console.error('Unexpected page errors:', errors.unexpected);
    return errors.unexpected.length ? 1 : (exitCode ?? 1);
  },
);
