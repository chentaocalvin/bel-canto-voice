import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAppServer } from './serve.mjs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

const server = createAppServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  await withBrowser({}, async (browser) => {
    const errors = createPageErrors();
    browser.onEvent(errors.record);
    await browser.send('Runtime.enable');
    await browser.send('Page.enable');
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await sleep(300);
    const start = await browser.evaluate(`(async () => {
      const get = id => document.getElementById(id);
      const ready = Date.now() + 5000;
      while (!get('backing-input') && Date.now() < ready) await new Promise(r => setTimeout(r, 20));
      get('boot-file').click();
      if (!get('boot').classList.contains('hidden')) throw new Error('File mode did not open');
      while (getComputedStyle(get('boot')).visibility !== 'hidden') await new Promise(r => setTimeout(r, 20));
      const { encodeWav } = await import('/src/audio/wav.js');
      const audio = new AudioContext(); const rate = audio.sampleRate; await audio.close();
      const buffer = new AudioBuffer({ length: rate * 2, sampleRate: rate, numberOfChannels: 1 });
      for (let i = 0; i < buffer.length; i++) buffer.getChannelData(0)[i] = .7 * Math.sin(2 * Math.PI * 440 * i / rate);
      const transfer = new DataTransfer(); transfer.items.add(new File([encodeWav(buffer)], 'short-backing.wav', { type: 'audio/wav' }));
      get('backing-input').files = transfer.files; get('backing-input').dispatchEvent(new Event('change'));
      const deadline = Date.now() + 10000;
      while (!get('backing-status').textContent.includes('Ready') && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
      get('backing-gain').scrollIntoView({ block: 'center' });
      const rect = get('backing-gain').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, value: Number(get('backing-gain').value) };
    })()`);
    assert.equal(start.value, -6);
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: start.x,
      y: start.y,
      button: 'left',
      clickCount: 1,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x,
      y: start.y - 34,
      button: 'left',
      buttons: 1,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: start.x,
      y: start.y - 34,
      button: 'left',
      clickCount: 1,
    });
    const dragged = await browser.evaluate(`Number(document.getElementById('backing-gain').value)`);
    assert.ok(
      dragged > start.value,
      `Upward backing gain drag must increase gain: ${start.value} -> ${dragged}`,
    );
    await browser.evaluate(`document.getElementById('backing-pitch').focus()`);
    await browser.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
    });
    await browser.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
    });
    await sleep(1000);
    assert.equal(await browser.evaluate(`document.getElementById('backing-pitch').value`), '1');
    console.log('BACKING_CONTROLS_PASS vertical gain drag and native integer transpose keyboard');
    await browser.evaluate(
      `document.getElementById('source-mic').click(); document.getElementById('backing-position').focus()`,
    );
    await browser.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'End',
      code: 'End',
      windowsVirtualKeyCode: 35,
    });
    await browser.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'End',
      code: 'End',
      windowsVirtualKeyCode: 35,
    });
    await sleep(100);
    assert.equal(
      await browser.evaluate(`document.getElementById('backing-time')?.textContent`),
      '0:02 / 0:02',
    );
    console.log('BACKING_CONTROLS_PASS seek updates visible current/total time');
    const timeline = await browser.evaluate(`(() => {
      const el = document.getElementById('backing-position'); el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, width: r.width };
    })()`);
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: timeline.x + timeline.width / 4,
      y: timeline.y,
      button: 'left',
      clickCount: 1,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: timeline.x + timeline.width * 0.75,
      y: timeline.y,
      button: 'left',
      buttons: 1,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: timeline.x + timeline.width * 0.75,
      y: timeline.y,
      button: 'left',
      clickCount: 1,
    });
    const seek = await browser.evaluate(
      `Number(document.getElementById('backing-position').value)`,
    );
    assert.ok(seek > 1.4 && seek < 1.6, String(seek));
    const shared = await browser.evaluate(`(async () => {
      const get = id => document.getElementById(id);
      const { encodeWav } = await import('/src/audio/wav.js');
      get('source-file').click();
      const audio = new AudioContext(); const rate = audio.sampleRate; await audio.close();
      const voice = new AudioBuffer({ length: rate * 6, sampleRate: rate, numberOfChannels: 1 });
      const transfer = new DataTransfer(); transfer.items.add(new File([encodeWav(voice)], 'long-voice.wav', { type: 'audio/wav' }));
      get('file-input').files = transfer.files; get('file-input').dispatchEvent(new Event('change'));
      const deadline = Date.now() + 5000;
      while (get('backing-position').max !== '6' && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
      const canvas = get('backing-wave'), context = canvas.getContext('2d');
      const alpha = fraction => context.getImageData(Math.floor(canvas.width * fraction), Math.floor(canvas.height / 4), 1, 1).data[3];
      return { max: get('backing-position').max, content: alpha(.2), silence: alpha(.8) };
    })()`);
    assert.equal(shared.error, undefined, JSON.stringify(shared));
    assert.equal(shared.max, '6');
    assert.ok(shared.content > 0, JSON.stringify(shared));
    assert.equal(shared.silence, 0);
    console.log(
      'BACKING_CONTROLS_PASS waveform drag seeks and shorter backing leaves silence in shared timeline',
      shared,
    );
    assert.equal(
      await browser.evaluate(`document.querySelector('.backing-recording').open`),
      false,
    );
    await browser.evaluate(`document.querySelector('.backing-recording summary').focus()`);
    const stopped = await browser.evaluate(
      `document.getElementById('backing-play').getAttribute('aria-pressed')`,
    );
    assert.equal(stopped, 'false');
    for (const open of [true, false]) {
      await browser.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: ' ',
        code: 'Space',
        text: ' ',
        windowsVirtualKeyCode: 32,
      });
      await browser.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: ' ',
        code: 'Space',
        windowsVirtualKeyCode: 32,
      });
      await sleep(100);
      const afterSpace = await browser.evaluate(
        `({ open: document.querySelector('.backing-recording').open, playing: document.getElementById('backing-play').getAttribute('aria-pressed') })`,
      );
      console.log('DISCLOSURE_SPACE_STATE', afterSpace);
      assert.deepEqual(afterSpace, { open, playing: stopped });
    }

    for (let toggle = 0; toggle < 3; toggle++) {
      await browser.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        windowsVirtualKeyCode: 13,
      });
      await browser.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      assert.equal(
        await browser.evaluate(`document.querySelector('.backing-recording').open`),
        toggle !== 1,
      );
      if (toggle === 0) {
        await browser.evaluate(
          `document.getElementById('backing-alignment').focus(); document.getElementById('backing-alignment').select()`,
        );
        await browser.send('Input.insertText', { text: '12' });
        await browser.evaluate(`document.querySelector('.backing-recording summary').focus()`);
      }
    }
    assert.equal(
      await browser.evaluate(`document.getElementById('backing-alignment').value`),
      '12',
    );
    console.log('BACKING_CONTROLS_PASS native recording alignment disclosure and retained value');
    for (const mode of ['file', 'mic']) {
      await browser.evaluate(`document.getElementById('source-${mode}').click()`);
      await sleep(100);
      if (mode === 'mic')
        assert.equal(
          await browser.evaluate(`document.getElementById('backing-position').max`),
          '2',
        );
      for (const width of [1440, 390]) {
        await browser.send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 1100,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await sleep(150);
        const layout = await browser.evaluate(`(() => {
          document.querySelector('.backing-recording').open = true;
          scrollTo(0, 0);
          const section = document.querySelector('.backing-controls').getBoundingClientRect();
          return { scroll: document.documentElement.scrollWidth, controls: [...document.querySelectorAll('.backing-controls button, .backing-controls input:not([hidden])')].every(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= section.left && r.right <= section.right + 1; }) };
        })()`);
        assert.ok(layout.scroll <= width && layout.controls, JSON.stringify(layout));
        await browser.evaluate(`document.querySelector('.backing-recording').open = false`);
        if (process.env.SCREENSHOT_DIR) {
          mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
          const shot = await browser.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
          });
          writeFileSync(
            join(process.env.SCREENSHOT_DIR, `backing-loaded-${mode}-${width}.png`),
            Buffer.from(shot.data, 'base64'),
          );
        }
      }
    }
    console.log(
      'BACKING_CONTROLS_PASS shared and microphone duration; loaded desktop/mobile controls fit BACKING',
    );
    const press = async ({ key, code, windowsVirtualKeyCode, text }) => {
      await browser.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode,
        ...(text ? { text } : {}),
      });
      await browser.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode,
      });
    };
    const playback = () =>
      browser.evaluate(`({
      vocal: document.getElementById('play-btn').getAttribute('aria-label'),
      backing: document.getElementById('backing-play').getAttribute('aria-pressed')
    })`);
    const stoppedPlayback = { vocal: 'Play', backing: 'false' };
    await browser.evaluate(`document.getElementById('source-file').click()`);
    assert.deepEqual(await playback(), stoppedPlayback);
    await browser.send('Page.setInterceptFileChooserDialog', { enabled: true });
    let fileChooser;
    browser.onEvent((event) => {
      if (event.method === 'Page.fileChooserOpened') fileChooser = event.params;
    });
    for (const key of [
      { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
      { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
    ]) {
      fileChooser = null;
      await browser.evaluate(`document.getElementById('backing-load').focus()`);
      await press(key);
      for (let wait = 0; !fileChooser && wait < 50; wait++) await sleep(20);
      assert.ok(fileChooser, `${key.code} opens the native backing file chooser`);
      assert.deepEqual(await playback(), stoppedPlayback);
      await browser.send('DOM.setFileInputFiles', {
        files: [join(process.cwd(), 'tools', 'test-vocal.wav')],
        backendNodeId: fileChooser.backendNodeId,
      });
      const loaded = await browser.evaluate(`(async () => {
        const get = id => document.getElementById(id);
        const deadline = Date.now() + 10000;
        while ((!get('backing-status').textContent.includes('test-vocal.wav') || get('backing-reset').disabled) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
        return get('backing-status').textContent;
      })()`);
      assert.match(loaded, /test-vocal.wav.*Ready|Ready.*test-vocal.wav/);
      assert.deepEqual(await playback(), stoppedPlayback);
      await browser.evaluate(`document.getElementById('backing-pitch').focus()`);
      await press({ key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      const shifted = await browser.evaluate(`(async () => {
        const get = id => document.getElementById(id), deadline = Date.now() + 10000;
        while ((get('backing-pitch').value !== '1' || get('backing-reset').disabled) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
        get('backing-reset').focus(); return get('backing-pitch').value;
      })()`);
      assert.equal(shifted, '1');
      await press(key);
      const reset = await browser.evaluate(`(async () => {
        const get = id => document.getElementById(id), deadline = Date.now() + 10000;
        while (get('backing-pitch').value !== '0' && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
        return { pitch: get('backing-pitch').value, focus: document.activeElement.id };
      })()`);
      assert.deepEqual(reset, { pitch: '0', focus: 'backing-reset' });
      assert.deepEqual(await playback(), stoppedPlayback);
      await browser.evaluate(`document.getElementById('backing-remove').focus()`);
      await press(key);
      const removed = await browser.evaluate(`({
        status: document.getElementById('backing-status').textContent,
        resetDisabled: document.getElementById('backing-reset').disabled,
        removeDisabled: document.getElementById('backing-remove').disabled
      })`);
      assert.deepEqual(removed, {
        status: 'No backing loaded',
        resetDisabled: true,
        removeDisabled: true,
      });
      assert.deepEqual(await playback(), stoppedPlayback);
      console.log('BACKING_CONTROLS_PASS native action keys without unrelated playback', key.code);
    }
    await browser.send('Page.setInterceptFileChooserDialog', { enabled: false });
    await browser.evaluate(`document.activeElement.blur()`);
    const space = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' };
    await press(space);
    assert.equal((await playback()).vocal, 'Pause playback');
    await press(space);
    assert.deepEqual(await playback(), stoppedPlayback);
    assert.deepEqual(errors.unexpected, [], 'Unexpected page errors');
    console.log('BACKING_CONTROLS_PASS global Space playback remains available off controls');
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
}
