import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { withBrowser } from './browser-session.mjs';

for (const leaderExitsFirst of [false, true]) {
  test(
    leaderExitsFirst
      ? 'cleanup terminates descendants after the browser leader has exited'
      : 'cleanup terminates the owned process group before removing its profile',
    {
      skip: process.platform === 'win32',
      timeout: 5000,
    },
    async (t) => {
      let child;
      let descendant;
      let profile;
      let closed = false;
      let profileAtClose = false;
      t.after(async () => {
        for (const pid of [descendant, child?.pid]) {
          if (!pid) continue;
          try {
            process.kill(pid, 'SIGKILL');
          } catch (error) {
            if (error.code !== 'ESRCH') throw error;
          }
        }
        if (child && !closed) await new Promise((resolve) => child.once('close', resolve));
      });
      const worker =
        "process.stderr.write('worker:' + process.pid + '\\n'); process.send('ready'); process.disconnect(); setInterval(() => {}, 1000)";
      const script = `
    const { spawn } = require('node:child_process');
    const worker = spawn(process.execPath, ['-e', ${JSON.stringify(worker)}], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    ${leaderExitsFirst ? "worker.once('message', () => process.exit(0));" : 'setInterval(() => {}, 1000);'}
  `;
      await assert.rejects(
        withBrowser(
          {
            chrome: process.execPath,
            startupTimeout: 1000,
            spawnBrowser(_command, args, options) {
              profile = args.find((arg) => arg.startsWith('--user-data-dir=')).split('=')[1];
              child = spawn(process.execPath, ['-e', script], options);
              child.stderr.on('data', (chunk) => {
                const match = String(chunk).match(/worker:(\d+)/);
                if (match) descendant = Number(match[1]);
              });
              child.once('close', () => {
                closed = true;
                profileAtClose = existsSync(profile);
              });
              return child;
            },
          },
          () => assert.fail('startup must not succeed'),
        ),
        leaderExitsFirst ? /Chrome exited before CDP was ready/ : /Chrome did not start/,
      );
      assert.ok(descendant, 'the descendant must be running before the timeout');
      assert.equal(closed, true, 'cleanup must await all inherited child stdio closing');
      assert.equal(profileAtClose, true, 'the profile must remain until child stdio closes');
      assert.equal(existsSync(profile), false);
    },
  );
}

test('a browser startup timeout terminates its process and removes only its profile', async () => {
  let child;
  let profile;
  await assert.rejects(
    withBrowser(
      {
        chrome: process.execPath,
        port: 1,
        startupTimeout: 100,
        spawnBrowser(_command, args, options) {
          profile = args.find((arg) => arg.startsWith('--user-data-dir=')).split('=')[1];
          child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
          return child;
        },
      },
      () => assert.fail('startup must not succeed'),
    ),
    /Chrome did not start/,
  );
  assert.equal(existsSync(profile), false);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('an executable launch error also removes the allocated profile', async () => {
  let profile;
  await assert.rejects(
    withBrowser(
      {
        chrome: 'belcanto-missing-browser-executable',
        startupTimeout: 100,
        spawnBrowser(command, args, options) {
          profile = args.find((arg) => arg.startsWith('--user-data-dir=')).split('=')[1];
          return spawn(command, args, options);
        },
      },
      () => assert.fail('launch must fail'),
    ),
    /ENOENT/,
  );
  assert.equal(existsSync(profile), false);
});

test('a scenario exception closes CDP and reclaims the browser process and profile', async (t) => {
  let child;
  let profile;
  let closed = false;
  t.after(() => child?.kill('SIGKILL'));
  t.mock.method(globalThis, 'fetch', async (url) => ({
    json: async () =>
      url.endsWith('/json/version')
        ? { webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/owned' }
        : [{ type: 'page', webSocketDebuggerUrl: 'ws://fixture' }],
  }));
  const originalWebSocket = globalThis.WebSocket;
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
  });
  globalThis.WebSocket = class extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(text) {
      const { id } = JSON.parse(text);
      queueMicrotask(() =>
        this.dispatchEvent(
          Object.assign(new Event('message'), { data: JSON.stringify({ id, result: {} }) }),
        ),
      );
    }
    close() {
      closed = true;
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  };
  await assert.rejects(
    withBrowser(
      {
        chrome: process.execPath,
        port: 1,
        spawnBrowser(_command, args, options) {
          profile = args.find((arg) => arg.startsWith('--user-data-dir=')).split('=')[1];
          child = spawn(
            process.execPath,
            [
              '-e',
              "process.stderr.write('DevTools listening on ws://127.0.0.1:1/devtools/browser/owned\\n'); setInterval(() => {}, 1000)",
            ],
            options,
          );
          return child;
        },
      },
      async (browser) => {
        await browser.send('Runtime.enable');
        throw new Error('scenario failed');
      },
    ),
    /scenario failed/,
  );
  assert.equal(closed, true);
  assert.equal(existsSync(profile), false);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

for (const announced of [false, true]) {
  test(
    announced
      ? 'a foreign browser UUID is rejected before any page command'
      : 'an occupied debugging port cannot substitute for the child endpoint',
    async (t) => {
      let child;
      let profile;
      let callbacks = 0;
      let connections = 0;
      const commands = [];
      const originalWebSocket = globalThis.WebSocket;
      t.after(() => {
        child?.kill('SIGKILL');
        globalThis.WebSocket = originalWebSocket;
      });
      t.mock.method(globalThis, 'fetch', async (url) => ({
        json: async () =>
          url.endsWith('/json/version')
            ? { webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/foreign' }
            : [{ type: 'page', webSocketDebuggerUrl: 'ws://foreign-page' }],
      }));
      globalThis.WebSocket = class extends EventTarget {
        static OPEN = 1;
        readyState = 1;
        constructor() {
          super();
          connections++;
          queueMicrotask(() => this.dispatchEvent(new Event('open')));
        }
        send(text) {
          const message = JSON.parse(text);
          commands.push(message.method);
          queueMicrotask(() =>
            this.dispatchEvent(
              Object.assign(new Event('message'), {
                data: JSON.stringify({ id: message.id, result: {} }),
              }),
            ),
          );
        }
        close() {
          this.dispatchEvent(new Event('close'));
        }
      };
      await assert.rejects(
        withBrowser(
          {
            chrome: process.execPath,
            port: 1,
            startupTimeout: 300,
            spawnBrowser(_command, args, options) {
              profile = args.find((arg) => arg.startsWith('--user-data-dir=')).split('=')[1];
              const announcement = announced
                ? "process.stderr.write('DevTools listening on ws://127.0.0.1:1/devtools/browser/owned\\n');"
                : '';
              child = spawn(
                process.execPath,
                ['-e', announcement + 'setInterval(() => {}, 1000)'],
                options,
              );
              return child;
            },
          },
          async (browser) => {
            callbacks++;
            await browser.send('Page.navigate', { url: 'http://fixture' });
            await browser.send('Runtime.enable');
            await browser.send('Browser.setDownloadBehavior', { behavior: 'allow' });
          },
        ),
        announced ? /does not belong/ : /Chrome did not start/,
      );
      assert.equal(callbacks, 0);
      assert.equal(connections, 0);
      assert.deepEqual(commands, []);
      assert.equal(existsSync(profile), false);
      assert.ok(child.exitCode !== null || child.signalCode !== null);
    },
  );
}
