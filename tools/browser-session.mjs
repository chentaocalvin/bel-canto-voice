import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRunDirectory } from './run-directory.mjs';

function chromeExecutable() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : process.platform === 'win32'
        ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
            .filter(Boolean)
            .map((base) => join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
        : (process.env.PATH || '')
            .split(delimiter)
            .flatMap((base) =>
              ['google-chrome', 'chromium', 'chromium-browser'].map((name) => join(base, name)),
            );
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable)
    throw new Error('Chrome or Chromium not found. Set CHROME to its executable path.');
  return executable;
}

function connectCDP(url, timeout) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  });
  socket.addEventListener('close', () => rejectPending(new Error('CDP connection closed')));
  socket.addEventListener('error', () => rejectPending(new Error('CDP connection failed')));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timeout')), timeout);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('CDP connection failed'));
      },
      { once: true },
    );
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new Error('CDP connection is not open'));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return {
    ready,
    send,
    onEvent(listener) {
      listeners.add(listener);
    },
    async evaluate(expression) {
      const response = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (response.exceptionDetails) {
        for (const listener of listeners)
          listener({
            method: 'Runtime.exceptionThrown',
            params: { exceptionDetails: response.exceptionDetails },
          });
        return {
          error: response.exceptionDetails.exception?.description || response.exceptionDetails.text,
        };
      }
      return response.result.value;
    },
    close() {
      rejectPending(new Error('CDP session closed'));
      socket.close();
    },
  };
}

export async function withBrowser(
  {
    chrome = chromeExecutable(),
    port = Number(process.env.CDP_PORT || 0),
    flags = [],
    startupTimeout = 18000,
    commandTimeout = 40000,
    spawnBrowser = spawn,
  } = {},
  run,
) {
  const profile = createRunDirectory({ prefix: 'belcanto-browser-' });
  let child;
  let connection;
  let launchError;
  let closed;
  let browserEndpoint = null;
  let startupOutput = '';
  const terminateBrowser = () => {
    if (!child?.pid || launchError) return;
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    } else if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  };
  const emergencyCleanup = () => {
    terminateBrowser();
    profile.cleanup();
  };
  process.once('exit', emergencyCleanup);
  try {
    child = spawnBrowser(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
        ...flags,
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile.path}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' },
    );
    closed = new Promise((resolve) => child.once('close', resolve));
    child.once('error', (error) => {
      launchError = error;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      if (browserEndpoint) return;
      startupOutput = (startupOutput + chunk).slice(-8192);
      const match = startupOutput.match(/DevTools listening on (ws:\/\/[^\r\n ]+)[\r\n]/);
      if (!match) return;
      let endpoint;
      try {
        endpoint = new URL(match[1]);
      } catch {
        return;
      }
      if (
        ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) &&
        /^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(endpoint.pathname)
      ) {
        browserEndpoint = endpoint.href;
      }
    });
    const deadline = Date.now() + startupTimeout;
    let target;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('Chrome exited before CDP was ready');
      if (!browserEndpoint) {
        await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
        continue;
      }
      try {
        const base = `http://${new URL(browserEndpoint).host}`;
        const versionResponse = await fetch(`${base}/json/version`, {
          signal: AbortSignal.timeout(Math.min(1000, startupTimeout)),
        });
        const version = await versionResponse.json();
        if (version.webSocketDebuggerUrl !== browserEndpoint) {
          const error = new Error('CDP endpoint does not belong to the launched Chrome process');
          error.code = 'CDP_OWNERSHIP';
          throw error;
        }
        const response = await fetch(`${base}/json/list`, {
          signal: AbortSignal.timeout(Math.min(1000, startupTimeout)),
        });
        const targets = await response.json();
        target = targets.find((entry) => entry.type === 'page');
        if (target) break;
      } catch (error) {
        if (error.code === 'CDP_OWNERSHIP') throw error;
        if (launchError) throw launchError;
        if (Date.now() >= deadline)
          throw new Error('Chrome did not start before the timeout', { cause: error });
      }
      await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
    }
    if (launchError) throw launchError;
    if (!target) throw new Error('Chrome did not start before the timeout');
    connection = connectCDP(target.webSocketDebuggerUrl, commandTimeout);
    await connection.ready;
    return await run(connection);
  } finally {
    try {
      connection?.close();
    } finally {
      try {
        terminateBrowser();
        if (closed) await closed;
        profile.cleanup();
      } finally {
        process.removeListener('exit', emergencyCleanup);
      }
    }
  }
}
