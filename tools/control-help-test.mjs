import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5188';
await withBrowser(
  { flags: ['--window-size=1440,940', '--force-device-scale-factor=1'] },
  async (browser) => {
    const send = browser.send;
    const read = browser.evaluate;
    const errors = createPageErrors();
    browser.onEvent(errors.record);
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: base });
    await sleep(1000);
    const point = async (selector) =>
      read(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
    const click = async (selector) => {
      const p = await point(selector);
      assert.ok(p, `Visible target: ${selector}`);
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        ...p,
      });
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        ...p,
      });
    };
    await click('#boot-file');
    await read(`new Promise(resolve => {
    const wait = () => getComputedStyle(document.getElementById('boot')).visibility === 'hidden' ? resolve() : setTimeout(wait, 20);
    wait();
  })`);
    const pitch = await point('button[aria-label="About Pitch"]');
    assert.ok(pitch, 'Pitch has a separate, keyboard-accessible help button');
    const before = await read(
      `document.querySelector('[role="slider"][aria-label="Pitch"]').getAttribute('aria-valuenow')`,
    );
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pitch });
    await sleep(100);
    assert.equal(
      await read(`document.querySelector('[role="tooltip"]:not([hidden])')?.textContent`),
      'Shift the voice up or down in semitones.',
      'hover reveals useful control guidance',
    );
    assert.equal(
      await read(
        `document.querySelector('[role="slider"][aria-label="Pitch"]').getAttribute('aria-valuenow')`,
      ),
      before,
      'reading help leaves Pitch unchanged',
    );
    console.log('PASS: pointer help without parameter changes');
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode,
        modifiers,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode,
        modifiers,
      });
    };
    const openCount = () =>
      read(`document.querySelectorAll('[role="tooltip"]:not([hidden])').length`);
    const tip = await point('[role="tooltip"]:not([hidden])');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...tip });
    await sleep(250);
    assert.equal(await openCount(), 1, 'pointer can enter the help text without losing it');
    await key('Escape', 'Escape', 27);
    assert.equal(await openCount(), 0, 'Escape dismisses hovered help');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    const tabTo = async (selector) => {
      for (let i = 0; i < 80; i++) {
        if (await read(`document.activeElement?.matches(${JSON.stringify(selector)})`)) return;
        await key('Tab', 'Tab', 9);
      }
      throw new Error('Keyboard could not reach ' + selector);
    };
    await tabTo('button[aria-label="About Formant"]');
    assert.equal(await openCount(), 1, 'keyboard focus reveals help');
    assert.match(
      await read(`document.querySelector('[role="tooltip"]:not([hidden])').textContent`),
      /formants/,
    );
    await key('Escape', 'Escape', 27);
    await sleep(100);
    assert.equal(await openCount(), 0, 'Escape stays dismissed while trigger retains focus');
    await click('button[aria-label="About Pitch"]');
    assert.equal(await openCount(), 1, 'intentional click opens help');
    await click('#panels .panel-head');
    assert.equal(await openCount(), 0, 'outside click dismisses help');
    console.log('PASS: pointer and keyboard help lifecycle');
    const values = () =>
      read(
        `JSON.stringify([...document.querySelectorAll('[role="slider"],input[type="range"],#preserve')].map(el=>[el.getAttribute('aria-label'),el.getAttribute('aria-valuenow'),el.value,el.getAttribute('aria-checked')]))`,
      );
    const untouched = await values();
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const tap = async (selector) => {
      const p = await point(selector);
      assert.ok(p, 'Touch target exists: ' + selector);
      await send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...p, id: 1 }],
      });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(80);
    };
    await tap('button[aria-label="About Preserve Formants"]');
    assert.equal(
      await openCount(),
      1,
      'first touch opens Preserve help despite focus preceding click',
    );
    assert.match(
      await read(`document.querySelector('[role="tooltip"]:not([hidden])').textContent`),
      /independent/,
    );
    await tap('button[aria-label="About Backing Transpose"]');
    assert.equal(await openCount(), 1, 'only one description remains open');
    assert.match(
      await read(`document.querySelector('[role="tooltip"]:not([hidden])').textContent`),
      /tempo/,
    );
    assert.equal(
      await read(`document.getElementById('backing-pitch').disabled`),
      true,
      'disabled transpose still offers help',
    );
    await tap('#panels .panel-head');
    assert.equal(await openCount(), 0, 'outside touch dismisses help');
    assert.equal(await values(), untouched, 'touch help changes neither controls nor Preserve');
    console.log('PASS: touch help and disabled controls remain independent');
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('DOM.enable');
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#file-input',
    });
    await send('DOM.setFileInputFiles', { nodeId, files: [resolve('tools/test-vocal.wav')] });
    for (let i = 0; i < 100; i++) {
      if (await read(`!document.getElementById('play-btn').disabled`)) break;
      await sleep(100);
    }
    assert.equal(
      await read(`document.getElementById('play-btn').disabled`),
      false,
      'audio file is ready for shortcut isolation',
    );
    await tabTo('button[aria-label="About Pitch"]');
    await key(' ', 'Space', 32);
    await sleep(150);
    assert.equal(
      await read(`document.getElementById('play-btn').getAttribute('aria-label')`),
      'Play',
      'Space on help does not start audio playback',
    );
    const pitchSlider = '[role="slider"][aria-label="Pitch"]';
    await tabTo(pitchSlider);
    await key('ArrowUp', 'ArrowUp', 38);
    assert.equal(
      await read(
        `Number(document.querySelector(${JSON.stringify(pitchSlider)}).getAttribute('aria-valuenow'))`,
      ),
      0.5,
      'ordinary keyboard adjustment remains available',
    );
    await key('ArrowUp', 'ArrowUp', 38, 8);
    assert.equal(
      await read(
        `Number(document.querySelector(${JSON.stringify(pitchSlider)}).getAttribute('aria-valuenow'))`,
      ),
      0.6,
      'Shift keyboard fine adjustment remains available',
    );
    const dial = await point(pitchSlider + ' .knob-dial');
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      ...dial,
      deltaY: -100,
      deltaX: 0,
    });
    await sleep(50);
    assert.equal(
      await read(
        `Number(document.querySelector(${JSON.stringify(pitchSlider)}).getAttribute('aria-valuenow'))`,
      ),
      1,
      'wheel adjustment remains available',
    );
    const reset = async () => {
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...dial,
        button: 'left',
        clickCount: 2,
      });
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...dial,
        button: 'left',
        clickCount: 2,
      });
    };
    await reset();
    assert.equal(
      await read(
        `Number(document.querySelector(${JSON.stringify(pitchSlider)}).getAttribute('aria-valuenow'))`,
      ),
      0,
      'double-click resets the dial',
    );
    const drag = async (modifiers = 0) => {
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...dial,
        button: 'left',
        clickCount: 1,
        modifiers,
      });
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: dial.x,
        y: dial.y - 34,
        button: 'left',
        buttons: 1,
        modifiers,
      });
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: dial.x,
        y: dial.y - 34,
        button: 'left',
        clickCount: 1,
        modifiers,
      });
      return read(
        `Number(document.querySelector(${JSON.stringify(pitchSlider)}).getAttribute('aria-valuenow'))`,
      );
    };
    const ordinary = await drag();
    await reset();
    const fine = await drag(8);
    assert.ok(ordinary > fine && fine > 0, 'Shift drag adjusts more finely than ordinary drag');
    await reset();
    console.log('PASS: help shortcut isolation and original knob interactions');
    const associations = await read(`(() => {
    const controls = [...document.querySelectorAll('#panels [role="slider"],.backing-knobs input,#preserve')];
    return {count:controls.length, valid:controls.every(el=>{
      const help=document.getElementById(el.getAttribute('aria-describedby'));
      return help?.getAttribute('role')==='tooltip' && help.textContent.length>20 && !el.querySelector('button');
    }), buttons:document.querySelectorAll('button.control-help').length};
  })()`);
    assert.deepEqual(
      associations,
      { count: 19, valid: true, buttons: 19 },
      'each control has descriptive help outside the slider semantics',
    );
    for (const width of [1440, 1024, 768, 390]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const layout = await read(`(() => {
      const labels=[...document.querySelectorAll('.control-help .knob-name')];
      return {overflow:document.documentElement.scrollWidth>innerWidth+1, clipped:labels.filter(label=>{
        const a=label.getBoundingClientRect(), b=label.parentElement.getBoundingClientRect();
        return a.left<b.left-1 || a.right>b.right+1 || a.height<10;
      }).map(el=>el.textContent)};
    })()`);
      assert.deepEqual(
        layout,
        { overflow: false, clipped: [] },
        `readable labels without horizontal overflow at ${width}px`,
      );
      await click('button[aria-label="About Vocal Ring"]');
      const bounds = await read(
        `(() => {const e=document.querySelector('[role="tooltip"]:not([hidden])');if(!e)return null; const r=e.getBoundingClientRect();return {inside:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight};})()`,
      );
      assert.deepEqual(bounds, { inside: true }, `help remains within the ${width}px viewport`);
      await key('Escape', 'Escape', 27);
    }
    console.log('PASS: accessible descriptions and responsive help layout');
    assert.deepEqual(errors.unexpected, []);
  },
);
