#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { createChecks } from './checks.mjs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5188';
const c = createChecks();
const wav = resolve(process.env.UI_TEST_WAV || 'tools/test-vocal.wav');
process.exitCode = await withBrowser(
  {
    flags: [
      '--window-size=1440,940',
      '--force-device-scale-factor=1',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
    commandTimeout: 20000,
  },
  async (browser) => {
    const send = browser.send;
    const evalJs = browser.evaluate;
    const errors = createPageErrors();
    browser.onEvent(errors.record);
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(2500);

    const before = await evalJs(`({
  knobs: document.querySelectorAll('.knob').length,
  panels: document.querySelectorAll('.panel').length,
  presetOptions: document.getElementById('preset').options.length,
  bootVisible: !document.getElementById('boot').classList.contains('hidden'),
  monitor: (() => {
    const b = document.getElementById('monitor');
    return { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'),
      disabled: b.disabled, visible: b.offsetParent !== null };
  })(),
  ranges: {
    pitch: (() => { const el = window.__belcanto.knobs.pitch.el; return [Number(el.getAttribute('aria-valuemin')), Number(el.getAttribute('aria-valuemax'))]; })(),
    vibRate: (() => { const el = window.__belcanto.knobs.vibRate.el; return [Number(el.getAttribute('aria-valuemin')), Number(el.getAttribute('aria-valuemax'))]; })(),
    vibDepth: (() => { const el = window.__belcanto.knobs.vibDepth.el; return [Number(el.getAttribute('aria-valuemin')), Number(el.getAttribute('aria-valuemax'))]; })()
  }
})`);
    console.log('before:', JSON.stringify(before));
    c.add('初始有 16 个旋钮', before.knobs === 16, 16, before.knobs);
    c.add('初始有 4 个参数面板', before.panels === 4, 4, before.panels);
    c.add('预设为 6 个 + 自定义项（共 7 项）', before.presetOptions === 7, 7, before.presetOptions);
    c.add('启动遮罩初始可见', before.bootVisible === true, true, before.bootVisible);
    c.add(
      '监听按钮默认「监听开」：🔊 监听 / aria-pressed=true / 顶部可见可用',
      before.monitor.text === '🔊 Monitor' &&
        before.monitor.pressed === 'true' &&
        before.monitor.disabled === false &&
        before.monitor.visible === true,
      { text: '🔊 Monitor', pressed: 'true', disabled: false, visible: true },
      before.monitor,
    );
    c.add(
      'PITCH 范围 ±12 半音',
      JSON.stringify(before.ranges?.pitch) === '[-12,12]',
      '[-12,12]',
      before.ranges?.pitch,
    );
    c.add(
      'VIBRATO 范围 3–8Hz',
      JSON.stringify(before.ranges?.vibRate) === '[3,8]',
      '[3,8]',
      before.ranges?.vibRate,
    );
    c.add(
      'DEPTH 范围 0–80 音分',
      JSON.stringify(before.ranges?.vibDepth) === '[0,80]',
      '[0,80]',
      before.ranges?.vibDepth,
    );

    const pristine = await evalJs(`(() => {
  const st = window.__belcanto;
  return {
    mode: st.mode, micOn: st.micOn, hasCtx: !!st.ctx, hasChain: !!st.chain,
    stream: !!st.micStream, node: !!st.micNode, status: document.getElementById('status-text').textContent,
    micPressed: document.getElementById('source-mic').getAttribute('aria-pressed'),
    filePressed: document.getElementById('source-file').getAttribute('aria-pressed')
  };
})()`);
    console.log('pristine:', JSON.stringify(pristine));
    c.add(
      '初始未选模式：mode=none、micOn=false、无 MediaStream / AudioContext / 音频链',
      pristine.mode === 'none' &&
        pristine.micOn === false &&
        pristine.stream === false &&
        pristine.node === false &&
        pristine.hasCtx === false &&
        pristine.hasChain === false,
      { mode: 'none', micOn: false, stream: false, node: false, ctx: false, chain: false },
      pristine,
    );
    c.add(
      '初始顶栏两个音源按钮都未高亮（aria-pressed=false）',
      pristine.micPressed === 'false' && pristine.filePressed === 'false',
      { mic: 'false', file: 'false' },
      { mic: pristine.micPressed, file: pristine.filePressed },
    );

    const english = await evalJs(`(() => {
  const text = (id) => document.getElementById(id).textContent.trim();
  const cjk = /[\u3400-\u9fff\uf900-\ufaff]/;
  const sel = document.getElementById('preset');
  return {
    htmlLang: document.documentElement.lang,
    title: document.title,
    sourceMic: text('source-mic'),
    sourceFile: text('source-file'),
    micToggle: text('mic-toggle'),
    rec: text('rec-btn'),
    choose: text('choose-file'),
    exportBtn: text('export-btn'),
    reset: text('reset-btn'),
    resetAria: document.getElementById('reset-btn').getAttribute('aria-label'),
    bootMic: text('boot-mic'),
    bootFile: text('boot-file'),
    status: text('status-text'),
    knobNames: [...document.querySelectorAll('.knob-name')].map((e) => e.textContent),
    knobCnCount: document.querySelectorAll('.knob-cn').length,
    panelCjk: cjk.test(document.getElementById('panels').textContent),
    statusbarCjk: cjk.test(document.querySelector('.statusbar').textContent),
    appCjk: cjk.test(document.getElementById('app').textContent),
    presetValues: [...sel.options].map((o) => o.value),
    presetLabels: [...sel.options].map((o) => o.textContent)
  };
})()`);
    console.log('english:', JSON.stringify(english));
    c.add(
      '页面默认纯英文：html lang=en、document.title 为英文',
      english.htmlLang === 'en' && english.title === 'BEL CANTO · Vocal Sculptor',
      { lang: 'en', title: 'BEL CANTO · Vocal Sculptor' },
      { lang: english.htmlLang, title: english.title },
    );
    c.add(
      '关键 UI 文案为英文（音源/传输/状态/boot/RESET）',
      english.sourceMic === 'Microphone' &&
        english.sourceFile === 'Audio file' &&
        english.micToggle === 'Enable mic' &&
        english.rec === 'Record' &&
        english.choose === 'Choose file' &&
        english.exportBtn === 'Export WAV' &&
        english.reset === '↺ RESET' &&
        english.resetAria === 'Reset to defaults' &&
        english.bootMic === 'Enter microphone mode' &&
        english.bootFile === 'Enter file mode' &&
        english.status === 'Ready · choose an input',
      {
        mic: 'Microphone',
        file: 'Audio file',
        micToggle: 'Enable mic',
        rec: 'Record',
        choose: 'Choose file',
        export: 'Export WAV',
        reset: '↺ RESET',
        bootMic: 'Enter microphone mode',
        bootFile: 'Enter file mode',
        status: 'Ready · choose an input',
      },
      english,
    );
    c.add(
      '旋钮只有英文主标签，中文副标题节点已移除',
      english.knobNames.length === 16 &&
        english.knobNames.every((n) => /^[A-Z]+$/.test(n)) &&
        english.knobCnCount === 0,
      { knobNames: 16, allUpperEnglish: true, cnNodes: 0 },
      { knobNames: english.knobNames, cnNodes: english.knobCnCount },
    );
    c.add(
      '面板区、状态栏与整页 textContent 均不含 CJK 字符',
      english.panelCjk === false && english.statusbarCjk === false && english.appCjk === false,
      { panels: false, statusbar: false, app: false },
      { panels: english.panelCjk, statusbar: english.statusbarCjk, app: english.appCjk },
    );

    const presetAudit = await evalJs(`(async () => {
  const mod = await import('./src/ui/params.js');
  return {
    count: Object.keys(mod.PRESETS).length,
    keys: Object.keys(mod.PRESETS),
    def: mod.DEFAULT_PRESET
  };
})()`);
    const pa = presetAudit || {};
    c.add(
      '预设仍为 6 个，且不存在 Chipmunk / 花栗鼠',
      pa.count === 6 &&
        pa.def === 'tenor' &&
        !(pa.keys || []).some((k) => /chipmunk|花栗鼠/i.test(k)) &&
        !(english.presetValues || []).some((v) => /chipmunk|花栗鼠/i.test(v)) &&
        !(english.presetLabels || []).some((v) => /chipmunk|花栗鼠/i.test(v)),
      { count: 6, default: 'tenor', noChipmunk: true },
      { count: pa.count, default: pa.def, keys: pa.keys },
    );
    c.add(
      '预设下拉为 6 个英文预设 + Custom',
      JSON.stringify(english.presetLabels) ===
        JSON.stringify([
          'Tenor',
          'Soprano',
          'Lyric Baritone',
          'Choir Hall',
          'Cathedral',
          'Studio',
          'Custom',
        ]),
      ['Tenor', 'Soprano', 'Lyric Baritone', 'Choir Hall', 'Cathedral', 'Studio', 'Custom'],
      english.presetLabels,
    );

    await evalJs(`document.getElementById('boot-mic').click()`);
    await sleep(350);
    const entered = await evalJs(`(() => {
  const st = window.__belcanto;
  const b = document.getElementById('mic-toggle');
  return {
    mode: st.mode, micOn: st.micOn, hasCtx: !!st.ctx, hasChain: !!st.chain,
    stream: !!st.micStream, node: !!st.micNode,
    headerMic: document.getElementById('source-mic').getAttribute('aria-pressed'),
    headerFile: document.getElementById('source-file').getAttribute('aria-pressed'),
    micText: b.textContent.trim(), micPressed: b.getAttribute('aria-pressed'),
    micVisible: !document.getElementById('transport-mic').hidden,
    transportVisible: !document.getElementById('transport').hidden,
    timelineHidden: document.getElementById('timeline').hidden,
    bootHidden: document.getElementById('boot').classList.contains('hidden'),
    status: document.getElementById('status-text').textContent,
    panels: document.querySelectorAll('.panel').length,
    knobs: document.querySelectorAll('.knob').length
  };
})()`);
    console.log('mic-mode-entered:', JSON.stringify(entered));
    c.add(
      '点「麦克风」只进入模式：不请求权限 → micOn=false、无 MediaStream、无 AudioContext / 音频链',
      entered.mode === 'mic' &&
        entered.micOn === false &&
        entered.stream === false &&
        entered.node === false &&
        entered.hasCtx === false &&
        entered.hasChain === false,
      { mode: 'mic', micOn: false, stream: false, ctx: false, chain: false },
      entered,
    );
    c.add(
      '进入麦克风模式：传输行出现「开启麦克风」按钮（aria-pressed=false）',
      entered.micVisible === true &&
        entered.transportVisible === true &&
        entered.micText === 'Enable mic' &&
        entered.micPressed === 'false',
      { visible: true, text: 'Enable mic', pressed: 'false' },
      entered,
    );
    c.add(
      '进入麦克风模式：顶栏麦克风高亮、文件不高亮，状态栏「麦克风模式 · 未开启」',
      entered.headerMic === 'true' &&
        entered.headerFile === 'false' &&
        entered.status === 'Microphone mode · mic off',
      { mic: 'true', file: 'false', status: 'Microphone mode · mic off' },
      { mic: entered.headerMic, file: entered.headerFile, status: entered.status },
    );
    c.add(
      '进入模式不新增面板（仍 4 个面板 / 16 个旋钮）',
      entered.panels === 4 && entered.knobs === 16,
      { panels: 4, knobs: 16 },
      { panels: entered.panels, knobs: entered.knobs },
    );
    c.add(
      '进入模式即收起启动遮罩，且时间轴在麦克风模式隐藏',
      entered.bootHidden === true && entered.timelineHidden === true,
      { bootHidden: true, timelineHidden: true },
      { bootHidden: entered.bootHidden, timelineHidden: entered.timelineHidden },
    );

    await evalJs(`document.getElementById('mic-toggle').click()`);
    await sleep(3000);

    const after = await evalJs(`({
  status: document.getElementById('status-text').textContent,
  dotClass: document.getElementById('status-dot').className,
  bootHidden: document.getElementById('boot').classList.contains('hidden'),
  ctxState: window.__belcanto && window.__belcanto.ctx ? window.__belcanto.ctx.state : 'none',
  ctxSampleRate: window.__belcanto && window.__belcanto.ctx ? window.__belcanto.ctx.sampleRate : 0,
  ctxBaseLatency: window.__belcanto && window.__belcanto.ctx ? window.__belcanto.ctx.baseLatency : null,
  hasChain: !!(window.__belcanto && window.__belcanto.chain),
  latencySamples: window.__belcanto && window.__belcanto.chain ? window.__belcanto.chain.latencySamples : 0,
  latencyText: document.getElementById('latency').textContent,
  transportVisible: !document.getElementById('transport').hidden,
  micTransport: !document.getElementById('transport-mic').hidden,
  fileTransport: !document.getElementById('transport-file').hidden,
  meterIn: document.getElementById('meter-in').style.getPropertyValue('--v'),
  note: document.getElementById('note-name').textContent,
  monitorGain: window.__belcanto && window.__belcanto.chain ? window.__belcanto.chain.audioParams.monitor.value : null,
  micOn: window.__belcanto && window.__belcanto.micOn,
  micStream: !!(window.__belcanto && window.__belcanto.micStream),
  micToggleText: document.getElementById('mic-toggle').textContent.trim(),
  micTogglePressed: document.getElementById('mic-toggle').getAttribute('aria-pressed')
})`);
    console.log('after:', JSON.stringify(after, null, 2));

    c.add('AudioContext 状态 running', after.ctxState === 'running', 'running', after.ctxState);
    c.add('音频链已建立', after.hasChain === true, true, after.hasChain);
    c.add(
      '点「开启麦克风」后才真正 running：micOn=true 且有 MediaStream',
      after.micOn === true && after.micStream === true,
      { micOn: true, stream: true },
      { micOn: after.micOn, stream: after.micStream },
    );
    c.add(
      '运行中启动按钮变「关闭麦克风」、aria-pressed=true',
      after.micToggleText === 'Disable mic' && after.micTogglePressed === 'true',
      { text: 'Disable mic', pressed: 'true' },
      { text: after.micToggleText, pressed: after.micTogglePressed },
    );
    c.add('启动遮罩已隐藏', after.bootHidden === true, true, after.bootHidden);
    c.add(
      '状态文本 = 麦克风 · 实时',
      after.status === 'Microphone · Live',
      'Microphone · Live',
      after.status,
    );
    c.add('状态灯为 live', after.dotClass === 'dot live', 'dot live', after.dotClass);
    c.add(
      'transport 可见且切到麦克风 transport',
      after.transportVisible === true &&
        after.micTransport === true &&
        after.fileTransport === false,
      { transport: true, mic: true, file: false },
      { transport: after.transportVisible, mic: after.micTransport, file: after.fileTransport },
    );
    const latencyInputsValid =
      Number.isFinite(after.ctxSampleRate) &&
      after.ctxSampleRate > 0 &&
      Number.isFinite(after.ctxBaseLatency) &&
      after.ctxBaseLatency >= 0;
    const expectedLatencyText = latencyInputsValid
      ? `LATENCY ≈ ${((after.ctxBaseLatency + 2048 / after.ctxSampleRate) * 1000).toFixed(0)} ms · ${(after.ctxSampleRate / 1000).toFixed(1)} kHz`
      : null;
    c.add(
      '延迟读数与实际基础延迟、采样率及 2048 样本精确一致',
      latencyInputsValid && after.latencyText === expectedLatencyText,
      expectedLatencyText,
      after.latencyText,
    );
    c.add(
      '延迟读数采样率与 AudioContext 一致',
      (after.latencyText || '').includes(`${(after.ctxSampleRate / 1000).toFixed(1)} kHz`),
      `${(after.ctxSampleRate / 1000).toFixed(1)} kHz`,
      after.latencyText,
    );
    c.add('STFT/延迟样本数 = 2048', after.latencySamples === 2048, 2048, after.latencySamples);
    c.add(
      '音频链建立后 monitorGain = 1（监听开）',
      Math.abs(after.monitorGain - 1) < 1e-6,
      1,
      after.monitorGain,
    );

    await evalJs(
      `(() => { const k = window.__belcanto.knobs.pitch; k.setValue(0); k.el.scrollIntoView({ block: 'center' }); })()`,
    );
    await sleep(200);
    const dragStart = await evalJs(`(() => {
  const k = window.__belcanto.knobs.pitch;
  const r = k.el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, value: k.value, state: window.__belcanto.values.pitch, aria: k.el.getAttribute('aria-valuenow'), preset: window.__belcanto.preset };
})()`);
    const dx = dragStart.x;
    const dy = dragStart.y;
    const dragPx = 34;
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: dx,
      y: dy,
      button: 'none',
      buttons: 0,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: dx,
      y: dy,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    for (let i = 1; i <= 8; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: dx,
        y: dy - (dragPx * i) / 8,
        button: 'left',
        buttons: 1,
      });
      await sleep(15);
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: dx,
      y: dy - dragPx,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await sleep(200);
    const dragEnd = await evalJs(`(() => {
  const k = window.__belcanto.knobs.pitch;
  return { value: k.value, state: window.__belcanto.values.pitch, aria: k.el.getAttribute('aria-valuenow'), bubble: k.el.querySelector('.knob-bubble').textContent, preset: window.__belcanto.preset };
})()`);
    console.log('knob drag:', JSON.stringify({ start: dragStart, end: dragEnd }));
    const delta = dragEnd.value - dragStart.value;
    c.add(
      '向上拖动 34px 后 PITCH 值真的变大',
      delta > 1,
      '> +1',
      `${delta.toFixed(2)}（${dragStart.value} → ${dragEnd.value}）`,
    );
    c.add(
      '旋钮值与 state.values.pitch 同步',
      dragEnd.state === dragEnd.value,
      dragEnd.value,
      dragEnd.state,
    );
    c.add(
      'aria-valuenow 与旋钮值同步',
      dragEnd.aria === String(dragEnd.value),
      String(dragEnd.value),
      dragEnd.aria,
    );
    c.add(
      '拖动时数值气泡显示半音单位',
      /st/.test(dragEnd.bubble || ''),
      '包含 "st"',
      dragEnd.bubble,
    );
    c.add('拖动后预设标记为自定义', dragEnd.preset === '__custom__', '__custom__', dragEnd.preset);

    const arcTest = await evalJs(`(() => {
  const st = window.__belcanto;

  const angleOf = (x, y) => (Math.atan2(x - 40, 40 - y) * 180) / Math.PI;
  const parse = (d) => {
    if (!d) return null;
    const n = d
      .split(' ')
      .filter((t) => t !== 'M' && t !== 'A')
      .map(Number);
    const a0 = angleOf(n[0], n[1]);
    const a1 = angleOf(n[7], n[8]);
    let span = Math.abs(a1 - a0);
    if (span > 180) span = 360 - span;
    return { a0, a1, span, len: ((span * Math.PI) / 180) * 30 };
  };
  const snap = (id, v) => {
    const k = st.knobs[id];
    k.setValue(v);
    const d = k.arc.getAttribute('d') || '';
    return {
      value: k.value,
      state: st.values[id],
      aria: k.el.getAttribute('aria-valuenow'),
      text: k.el.getAttribute('aria-valuetext'),
      d,
      geom: parse(d),
    };
  };
  const zeroAngle = (id) => -135 + 270 * st.knobs[id]._frac(0);
  const out = {};
  for (const v of [0, 3, -3]) out['warmth' + (v >= 0 ? '+' : '') + v] = snap('warmth', v);
  for (const v of [0, 5, -5]) out['pitch' + (v >= 0 ? '+' : '') + v] = snap('pitch', v);
  out.ringMin = snap('ring', 0);
  out.ringMid = snap('ring', 6);
  out.zero = { warmth: zeroAngle('warmth'), pitch: zeroAngle('pitch') };
  return out;
})();
`);
    console.log('arc:', JSON.stringify(arcTest));
    const arc = arcTest || {};
    const w0 = arc['warmth+0'] || {};
    const wPos = arc['warmth+3'] || {};
    const wNeg = arc['warmth-3'] || {};
    const pZero = arc['pitch+0'] || {};
    const pPos = arc['pitch+5'] || {};
    const pNeg = arc['pitch-5'] || {};
    const ringMin = arc.ringMin || {};
    const ringMid = arc.ringMid || {};
    const zero = arc.zero || {};
    c.add('弧线起点取数值 0：WARMTH=0 时 arc 为空', w0.d === '', '', w0.d);
    c.add(
      'WARMTH=0 只是视觉：参数值 / state / aria-valuenow 仍为 0',
      w0.value === 0 && w0.state === 0 && w0.aria === '0',
      { value: 0, state: 0, aria: '0' },
      { value: w0.value, state: w0.state, aria: w0.aria },
    );
    c.add(
      'WARMTH=+3：arc 非空，且从 0 的位置（−27°）向右画',
      !!wPos.d && !!wPos.geom && Math.abs(wPos.geom.a0 - zero.warmth) < 0.05,
      { 起点: zero.warmth, 非空: true },
      { 起点: wPos.geom && wPos.geom.a0, d: wPos.d },
    );
    c.add(
      'WARMTH=+3：参数值 / state / aria-valuenow 与设定值一致',
      wPos.value === 3 && wPos.state === 3 && wPos.aria === '3' && /dB/.test(wPos.text || ''),
      { value: 3, state: 3, aria: '3', text: 'dB' },
      { value: wPos.value, state: wPos.state, aria: wPos.aria, text: wPos.text },
    );
    c.add('WARMTH=−3：arc 非空', !!wNeg.d, '非空', wNeg.d);
    c.add('WARMTH=−3 与 +3 的弧线路径不同', wNeg.d !== wPos.d, '不同', {
      neg: wNeg.d,
      pos: wPos.d,
    });
    c.add(
      'WARMTH=−3：弧线另一端仍落在 0 的位置（−27°），向负方向展开',
      !!wNeg.geom && Math.abs(wNeg.geom.a1 - zero.warmth) < 0.05,
      { 终点: zero.warmth },
      wNeg.geom,
    );
    c.add('对称 bipolar PITCH=0 时 arc 为空', pZero.d === '', '', pZero.d);
    c.add(
      'PITCH=+5：arc 非空且起点仍是量程中点 0.5（视觉不变）',
      !!pPos.d && !!pPos.geom && Math.abs(pPos.geom.a0 - zero.pitch) < 0.05,
      { 起点: zero.pitch, 非空: true },
      { 起点: pPos.geom && pPos.geom.a0, d: pPos.d },
    );
    c.add(
      'PITCH=−5：arc 非空且终点仍是量程中点 0.5（视觉不变）',
      !!pNeg.d && !!pNeg.geom && Math.abs(pNeg.geom.a1 - zero.pitch) < 0.05,
      { 终点: zero.pitch, 非空: true },
      { 终点: pNeg.geom && pNeg.geom.a1, d: pNeg.d },
    );
    c.add(
      'PITCH ±5 弧长几乎相等（对称量程，误差 < 0.5px）',
      !!pPos.geom &&
        !!pNeg.geom &&
        pPos.geom.len > 10 &&
        Math.abs(pPos.geom.len - pNeg.geom.len) < 0.5,
      { 接近: true },
      { pos: pPos.geom && pPos.geom.len, neg: pNeg.geom && pNeg.geom.len },
    );
    c.add(
      'PITCH ±5 只改视觉：参数值 / aria-valuenow 按设定值同步',
      pPos.value === 5 &&
        pPos.state === 5 &&
        pPos.aria === '5' &&
        pNeg.value === -5 &&
        pNeg.state === -5 &&
        pNeg.aria === '-5',
      { pos: { value: 5, state: 5, aria: '5' }, neg: { value: -5, state: -5, aria: '-5' } },
      {
        pos: { value: pPos.value, state: pPos.state, aria: pPos.aria },
        neg: { value: pNeg.value, state: pNeg.state, aria: pNeg.aria },
      },
    );
    c.add(
      '非 bipolar RING 在 min（0）时 arc 为空（保持原行为）',
      ringMin.value === 0 && ringMin.aria === '0' && ringMin.d === '',
      { value: 0, aria: '0', d: '' },
      { value: ringMin.value, aria: ringMin.aria, d: ringMin.d },
    );
    c.add(
      '非 bipolar RING 仍从 min 起画：6 时起点 = 起始角 −135°',
      !!ringMid.geom &&
        Math.abs(ringMid.geom.a0 - -135) < 0.05 &&
        Math.abs(ringMid.geom.a1 - 0) < 0.05,
      { 起点: -135, 终点: 0 },
      ringMid.geom,
    );
    c.add(
      '非 bipolar RING 只改视觉：参数值 / aria-valuenow 按设定值同步',
      ringMid.value === 6 && ringMid.state === 6 && ringMid.aria === '6',
      { value: 6, state: 6, aria: '6' },
      { value: ringMid.value, state: ringMid.state, aria: ringMid.aria },
    );

    await evalJs(`window.__belcanto.knobs.pitch.setValue(0)`);
    await sleep(100);
    const abTest = await evalJs(`(() => {
  const st = window.__belcanto;
  const btnA = document.querySelector('.ab-btn[data-slot="A"]');
  const btnB = document.querySelector('.ab-btn[data-slot="B"]');
  st.knobs.pitch.setValue(5);
  const aBefore = st.values.pitch;
  const aKnobBefore = st.knobs.pitch.value;
  btnB.click();
  const bVal = st.values.pitch;
  const bKnob = st.knobs.pitch.value;
  st.knobs.pitch.setValue(-4);
  btnA.click();
  const aAfter = st.values.pitch;
  const aKnobAfter = st.knobs.pitch.value;
  btnB.click();
  const bAfter = st.values.pitch;
  const bKnobAfter = st.knobs.pitch.value;
  return { aBefore, aKnobBefore, bVal, bKnob, aAfter, aKnobAfter, bAfter, bKnobAfter,
    slot: st.slot, aPressed: btnA.getAttribute('aria-pressed'), bPressed: btnB.getAttribute('aria-pressed') };
})()`);
    console.log('ab:', JSON.stringify(abTest));
    c.add(
      'A/B：A 槽保存 pitch=5',
      abTest.aBefore === 5 && abTest.aKnobBefore === 5,
      { value: 5, knob: 5 },
      { value: abTest.aBefore, knob: abTest.aKnobBefore },
    );
    c.add(
      'A/B：切到 B 参数回到 B 槽 pitch=0',
      abTest.bVal === 0 && abTest.bKnob === 0,
      { value: 0, knob: 0 },
      { value: abTest.bVal, knob: abTest.bKnob },
    );
    c.add(
      'A/B：切回 A 参数恢复 pitch=5',
      abTest.aAfter === 5 && abTest.aKnobAfter === 5,
      { value: 5, knob: 5 },
      { value: abTest.aAfter, knob: abTest.aKnobAfter },
    );
    c.add(
      'A/B：再切 B 参数恢复 pitch=-4',
      abTest.bAfter === -4 && abTest.bKnobAfter === -4,
      { value: -4, knob: -4 },
      { value: abTest.bAfter, knob: abTest.bKnobAfter },
    );
    c.add(
      'A/B：槽位与按钮 aria-pressed 一致',
      abTest.slot === 'B' && abTest.aPressed === 'false' && abTest.bPressed === 'true',
      { slot: 'B', A: 'false', B: 'true' },
      { slot: abTest.slot, A: abTest.aPressed, B: abTest.bPressed },
    );

    const tabTest = await evalJs(`(() => {
  const st = window.__belcanto;
  const snap = () => {
    const active = [...document.querySelectorAll('.screen-tabs button')].filter((b) => b.classList.contains('active'));
    return {
      mode: st.scope.mode,
      scopeMode: st.scopeMode,
      activeMode: active.length === 1 ? active[0].dataset.mode : null,
      activeCount: active.length,
      saved: localStorage.getItem('bc.scopeMode')
    };
  };
  const out = {};
  for (const mode of ['spectrum', 'wave', 'split']) {
    document.querySelector('.screen-tabs button[data-mode="' + mode + '"]').click();
    out[mode] = snap();
  }
  return out;
})()`);
    console.log('tabs:', JSON.stringify(tabTest));
    for (const mode of ['spectrum', 'wave', 'split']) {
      const t = tabTest?.[mode] || {};
      c.add(
        `视图 ${mode}：Scope 状态、active DOM、localStorage 都切换`,
        t.mode === mode &&
          t.scopeMode === mode &&
          t.activeMode === mode &&
          t.activeCount === 1 &&
          t.saved === mode,
        { mode, scopeMode: mode, activeMode: mode, activeCount: 1, saved: mode },
        t,
      );
    }

    const bypassTest = await evalJs(`(() => {
  const st = window.__belcanto;
  const b = document.getElementById('bypass');
  const p = document.getElementById('preserve');
  const initialPreserve = { value: st.values.preserve, aria: p.getAttribute('aria-checked') };
  b.click();
  const on = { bypass: st.bypass, pressed: b.getAttribute('aria-pressed'), status: document.getElementById('status-text').textContent, dot: document.getElementById('status-dot').className };
  b.click();
  const off = { bypass: st.bypass, pressed: b.getAttribute('aria-pressed'), status: document.getElementById('status-text').textContent, dot: document.getElementById('status-dot').className };
  p.click();
  const preserveFlipped = { value: st.values.preserve, aria: p.getAttribute('aria-checked') };
  p.click();
  const preserveRestored = { value: st.values.preserve, aria: p.getAttribute('aria-checked') };
  return { initialPreserve, on, off, preserveFlipped, preserveRestored };
})()`);
    console.log('bypass:', JSON.stringify(bypassTest));
    c.add(
      'BYPASS 开启：state/aria/状态文本都切到旁通',
      bypassTest.on.bypass === true &&
        bypassTest.on.pressed === 'true' &&
        bypassTest.on.status === 'Bypassed · dry signal' &&
        bypassTest.on.dot === 'dot warn',
      { bypass: true, pressed: 'true', status: 'Bypassed · dry signal', dot: 'dot warn' },
      bypassTest.on,
    );
    c.add(
      'BYPASS 关闭：state/aria/状态文本都恢复',
      bypassTest.off.bypass === false &&
        bypassTest.off.pressed === 'false' &&
        bypassTest.off.status === 'Microphone · Live' &&
        bypassTest.off.dot === 'dot live',
      { bypass: false, pressed: 'false', status: 'Microphone · Live', dot: 'dot live' },
      bypassTest.off,
    );
    const p0 = bypassTest.initialPreserve.value;
    c.add(
      'PRESERVE 点击后真的翻转',
      bypassTest.preserveFlipped.value === !p0 && bypassTest.preserveFlipped.aria === String(!p0),
      { value: !p0, aria: String(!p0) },
      bypassTest.preserveFlipped,
    );
    c.add(
      'PRESERVE 再点一次复位',
      bypassTest.preserveRestored.value === p0 && bypassTest.preserveRestored.aria === String(p0),
      { value: p0, aria: String(p0) },
      bypassTest.preserveRestored,
    );

    const presetTest = await evalJs(`(() => {
  const sel = document.getElementById('preset');
  sel.value = 'cathedral';
  sel.dispatchEvent(new Event('change'));
  const st = window.__belcanto;
  return {
    preset: st.preset,
    select: sel.value,
    mix: st.values.mix,
    formant: st.values.formant,
    pitch: st.values.pitch,
    pitchKnob: st.knobs.pitch.value,
    pitchAria: st.knobs.pitch.el.getAttribute('aria-valuenow'),
    preserve: st.values.preserve,
    size: st.values.size
  };
})()`);
    console.log('preset:', JSON.stringify(presetTest));
    c.add(
      '预设选择「大教堂 · Cathedral」已生效',
      presetTest.preset === 'cathedral' && presetTest.select === 'cathedral',
      { preset: 'cathedral', select: 'cathedral' },
      { preset: presetTest.preset, select: presetTest.select },
    );
    c.add('大教堂预设 REVERB（mix）= 0.62', presetTest.mix === 0.62, 0.62, presetTest.mix);
    c.add('大教堂预设 FORMANT = -2.4', presetTest.formant === -2.4, -2.4, presetTest.formant);
    c.add('大教堂预设 SIZE = 0.96', presetTest.size === 0.96, 0.96, presetTest.size);
    c.add(
      '大教堂预设 PITCH = 0 且旋钮/aria 同步',
      presetTest.pitch === 0 && presetTest.pitchKnob === 0 && presetTest.pitchAria === '0',
      { value: 0, knob: 0, aria: '0' },
      { value: presetTest.pitch, knob: presetTest.pitchKnob, aria: presetTest.pitchAria },
    );
    c.add('大教堂预设 PRESERVE = true', presetTest.preserve === true, true, presetTest.preserve);

    await sleep(1400);
    const smoothTest = await evalJs(`(async () => {
  const st = window.__belcanto;
  const mixParam = st.chain.audioParams.mix;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const targetGain = 0.12 * 0.9;
  const before = mixParam.value;
  const sel = document.getElementById('preset');
  sel.value = 'studio';
  sel.dispatchEvent(new Event('change'));
  const ui = {
    preset: st.preset,
    stateMix: st.values.mix,
    knobMix: st.knobs.mix.value,
    aria: st.knobs.mix.el.getAttribute('aria-valuenow'),
    text: st.knobs.mix.valueEl.textContent,
    bubble: st.knobs.mix.el.querySelector('.knob-bubble').textContent,
  };
  const at0 = mixParam.value;
  await wait(250);
  const at250 = mixParam.value;
  await wait(1700);
  const settled = mixParam.value;

  st.knobs.mix.setValue(0.5);
  const manualTarget = 0.5 * 0.9;
  const manualAt0 = mixParam.value;
  await wait(250);
  const manualAt250 = mixParam.value;

  document.getElementById('preserve').click();
  sel.value = 'studio';
  sel.dispatchEvent(new Event('change'));
  const presetBool = {
    preserve: st.values.preserve,
    aria: document.getElementById('preserve').getAttribute('aria-checked'),
  };
  return {
    before,
    targetGain,
    ui,
    at0,
    at250,
    settled,
    manualTarget,
    manualAt0,
    manualAt250,
    presetBool,
  };
})();
`);
    console.log('smooth:', JSON.stringify(smoothTest));
    const s = smoothTest || {};
    c.add(
      '平滑：切换后 AudioParam 没有一步跳到目标（仍贴近旧值）',
      Number.isFinite(s.at0) &&
        Math.abs(s.at0 - s.before) < 0.02 &&
        Math.abs(s.at0 - s.targetGain) > 0.2,
      { 距旧值: '< 0.02', 距目标: '> 0.2' },
      { at0: s.at0, before: s.before, target: s.targetGain },
    );
    c.add(
      '平滑：250ms 时处于中途（既非旧值也非目标）',
      Math.abs(s.at250 - s.before) > 0.05 && Math.abs(s.at250 - s.targetGain) > 0.05,
      { 距旧值: '> 0.05', 距目标: '> 0.05' },
      s.at250,
    );
    c.add(
      '平滑：约 2s 后收敛到预设目标值（±0.005）',
      Math.abs(s.settled - s.targetGain) < 0.005,
      `±0.005 of ${s.targetGain}`,
      s.settled,
    );
    c.add(
      '平滑：UI 数值立即显示目标值（旋钮/aria/文本）',
      !!s.ui &&
        s.ui.preset === 'studio' &&
        s.ui.stateMix === 0.12 &&
        s.ui.knobMix === 0.12 &&
        s.ui.aria === '0.12' &&
        s.ui.text === '12' &&
        s.ui.bubble === '12',
      { preset: 'studio', mix: 0.12, aria: '0.12', text: '12', bubble: '12' },
      s.ui,
    );
    c.add(
      '手动拖旋钮同一参数仍是即时路径（250ms 内到目标 ±0.01）',
      Math.abs(s.manualAt250 - s.manualTarget) < 0.01,
      `±0.01 of ${s.manualTarget}`,
      { at0: s.manualAt0, at250: s.manualAt250 },
    );
    c.add(
      '布尔 PRESERVE 不参与平滑：切换后立即生效',
      !!s.presetBool && s.presetBool.preserve === true && s.presetBool.aria === 'true',
      { preserve: true, aria: 'true' },
      s.presetBool,
    );

    const interruptTest = await evalJs(`(async () => {
  const st = window.__belcanto;
  const p = st.chain.audioParams.mix;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sel = document.getElementById('preset');
  sel.value = 'cathedral';
  sel.dispatchEvent(new Event('change'));
  await wait(100);
  const mid1 = p.value;
  sel.value = 'studio';
  sel.dispatchEvent(new Event('change'));
  const at0 = p.value;
  await wait(250);
  const at250 = p.value;
  await wait(1700);
  const settled = p.value;
  return { mid1, at0, at250, settled, target: 0.12 * 0.9 };
})()`);
    console.log('interrupt:', JSON.stringify(interruptTest));
    const it = interruptTest || {};
    c.add(
      '平滑中途切换：从当前中间值连续转向新目标（无跳变）',
      Math.abs(it.at0 - it.mid1) < 0.02 &&
        it.at250 < it.at0 - 0.1 &&
        Math.abs(it.at250 - it.target) > 0.05,
      { 切换瞬间差: '< 0.02', '250ms后': '继续向新目标移动' },
      { mid1: it.mid1, at0: it.at0, at250: it.at250, target: it.target },
    );
    c.add(
      '平滑中途切换：最终收敛到新预设目标（±0.005）',
      Math.abs(it.settled - it.target) < 0.005,
      `±0.005 of ${it.target}`,
      it.settled,
    );

    const resetTest = await evalJs(`(async () => {
  const st = window.__belcanto;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sel = document.getElementById('preset');
  const btn = document.getElementById('reset-btn');
  const preserveBtn = document.getElementById('preserve');
  const mod = await import('./src/ui/params.js');
  const ids = Object.keys(mod.PARAMS);
  const defs = Object.fromEntries(ids.map((id) => [id, mod.PARAMS[id].def]));
  const btnA = document.querySelector('.ab-btn[data-slot="A"]');
  const btnB = document.querySelector('.ab-btn[data-slot="B"]');
  const snapUi = () => ({
    values: { ...st.values },
    knobs: Object.fromEntries(ids.map((id) => [id, st.knobs[id].value])),
    aria: Object.fromEntries(ids.map((id) => [id, st.knobs[id].el.getAttribute('aria-valuenow')])),
    preset: st.preset,
    select: sel.value,
    preserve: st.values.preserve,
    preserveAria: preserveBtn.getAttribute('aria-checked'),
    toast: document.getElementById('toast').textContent,
    toastShown: document.getElementById('toast').classList.contains('show'),
    slotsA: { ...st.slots.A },
    slotsB: { ...st.slots.B },
  });

  if (st.slot !== 'A') btnA.click();
  st.knobs.pitch.setValue(5);
  st.knobs.comp.setValue(0.8);
  const savedA = { pitch: st.values.pitch, comp: st.values.comp };

  btnB.click();
  sel.value = 'cathedral';
  sel.dispatchEvent(new Event('change'));
  await wait(1500);
  const presetBefore = {
    preset: st.preset,
    select: sel.value,
    mix: st.values.mix,
    formant: st.values.formant,
    size: st.values.size,
    preserve: st.values.preserve,
  };

  btn.click();
  const fromPreset = snapUi();

  btnA.click();
  const restoredA = {
    pitch: st.values.pitch,
    comp: st.values.comp,
    knobPitch: st.knobs.pitch.value,
  };
  btnB.click();
  const restoredB = { pitch: st.values.pitch, mix: st.values.mix };

  st.knobs.pitch.setValue(-7);
  st.knobs.comp.setValue(0.9);
  st.knobs.mix.setValue(0.95);
  st.knobs.warmth.setValue(-3.5);
  const manualBefore = {
    pitch: st.values.pitch,
    comp: st.values.comp,
    mix: st.values.mix,
    warmth: st.values.warmth,
    preset: st.preset,
  };
  await wait(300);
  const mixParam = st.chain.audioParams.mix;
  const mixBefore = mixParam.value;
  if (st.values.preserve) preserveBtn.click();
  const preserveBefore = st.values.preserve;
  btn.click();
  const afterClick = snapUi();
  const mixAt0 = mixParam.value;
  await wait(250);
  const mixAt250 = mixParam.value;
  await wait(1700);
  const mixSettled = mixParam.value;

  return {
    ids,
    defs,
    factory: { ...mod.DEFAULTS },
    factoryPreserve: mod.DEFAULTS.preserve,
    factoryMatchesDefs: ids.every((id) => Math.abs(mod.DEFAULTS[id] - defs[id]) < 1e-12),
    savedA,
    presetBefore,
    fromPreset,
    restoredA,
    restoredB,
    manualBefore,
    preserveBefore,
    afterClick,
    mixBefore,
    target: defs.mix * 0.9,
    mixAt0,
    mixAt250,
    mixSettled,
    btn: {
      visible: btn.offsetParent !== null,
      disabled: btn.disabled,
      aria: btn.getAttribute('aria-label'),
      title: btn.getAttribute('title'),
      inPresetBar: btn.parentElement.classList.contains('preset-bar'),
      prevId: btn.previousElementSibling && btn.previousElementSibling.id,
    },
  };
})();
`);
    console.log('reset:', JSON.stringify(resetTest));
    const rt = resetTest || {};
    const rid = rt.ids || [];
    const idsEqual = (vals, expected) =>
      rid.length === 16 && rid.every((id) => Math.abs((vals || {})[id] - expected[id]) < 1e-9);
    c.add(
      'RESET 按钮在预设栏内、有 aria-label/title 说明、可见可用',
      rt.btn &&
        rt.btn.inPresetBar === true &&
        rt.btn.visible === true &&
        rt.btn.disabled === false &&
        rt.btn.prevId === 'preset-next' &&
        rt.btn.aria === 'Reset to defaults' &&
        /factory defaults/.test(rt.btn.title || ''),
      {
        inPresetBar: true,
        visible: true,
        disabled: false,
        prevId: 'preset-next',
        aria: 'Reset to defaults',
      },
      rt.btn,
    );
    c.add(
      '默认值唯一来源：params.js 的 DEFAULTS 全部由 def 派生，preserve 默认 true',
      rt.factoryMatchesDefs === true &&
        rt.factoryPreserve === true &&
        rt.factory &&
        Math.abs(rt.factory.mix - rt.defs.mix) < 1e-12,
      { '全部等于 def': true, preserve: true },
      { matches: rt.factoryMatchesDefs, preserve: rt.factoryPreserve },
    );
    c.add(
      'RESET 前状态确实非默认（预设「大教堂」/ 手动值）',
      rt.presetBefore &&
        rt.presetBefore.preset === 'cathedral' &&
        rt.manualBefore &&
        rt.manualBefore.pitch === -7 &&
        rt.manualBefore.comp === 0.9 &&
        rt.manualBefore.mix === 0.95 &&
        rt.manualBefore.warmth === -3.5,
      { preset: 'cathedral', pitch: -7, comp: 0.9, mix: 0.95, warmth: -3.5 },
      { preset: rt.presetBefore && rt.presetBefore.preset, manual: rt.manualBefore },
    );
    c.add(
      '点 RESET：16 个参数 state.values 全部等于 params.js 的 def',
      idsEqual(rt.afterClick && rt.afterClick.values, rt.defs || {}),
      '全等于 def',
      rt.afterClick && rt.afterClick.values,
    );
    c.add(
      '点 RESET：16 个旋钮的 value / aria-valuenow 同步到 def',
      idsEqual(rt.afterClick && rt.afterClick.knobs, rt.defs || {}) &&
        rid.every((id) => rt.afterClick.aria[id] === String(rt.defs[id])),
      'value + aria 全等于 def',
      rt.afterClick && rt.afterClick.aria,
    );
    c.add(
      '点 RESET：预设下拉切到「自定义 · Custom」',
      rt.afterClick &&
        rt.afterClick.preset === '__custom__' &&
        rt.afterClick.select === '__custom__',
      { preset: '__custom__', select: '__custom__' },
      rt.afterClick && { preset: rt.afterClick.preset, select: rt.afterClick.select },
    );
    c.add(
      '点 RESET：preserve 从 false 回到默认 true（state + aria-checked）',
      rt.preserveBefore === false &&
        rt.afterClick &&
        rt.afterClick.preserve === true &&
        rt.afterClick.preserveAria === 'true',
      { before: false, value: true, aria: 'true' },
      {
        before: rt.preserveBefore,
        value: rt.afterClick && rt.afterClick.preserve,
        aria: rt.afterClick && rt.afterClick.preserveAria,
      },
    );
    c.add(
      '点 RESET：toast 显示「已重置为默认」且可见',
      rt.afterClick &&
        rt.afterClick.toast === 'Defaults restored' &&
        rt.afterClick.toastShown === true,
      { toast: 'Defaults restored', shown: true },
      rt.afterClick && { toast: rt.afterClick.toast, shown: rt.afterClick.toastShown },
    );
    c.add(
      'RESET 平滑：点击瞬间仍贴近旧值（没有一步跳到目标）',
      Math.abs(rt.mixAt0 - rt.mixBefore) < 0.02 && Math.abs(rt.mixAt0 - rt.target) > 0.2,
      { 距旧值: '< 0.02', 距目标: '> 0.2' },
      { at0: rt.mixAt0, before: rt.mixBefore, target: rt.target },
    );
    c.add(
      'RESET 平滑：250ms 时处于中途（既非旧值也非目标）',
      Math.abs(rt.mixAt250 - rt.mixBefore) > 0.05 && Math.abs(rt.mixAt250 - rt.target) > 0.05,
      { 距旧值: '> 0.05', 距目标: '> 0.05' },
      { at250: rt.mixAt250, before: rt.mixBefore, target: rt.target },
    );
    c.add(
      'RESET 平滑：约 2s 后收敛到 def 对应目标（±0.005）',
      Math.abs(rt.mixSettled - rt.target) < 0.005,
      `±0.005 of ${rt.target}`,
      rt.mixSettled,
    );
    c.add(
      'A/B 快照未被清空：RESET 后 A 槽仍保存用户值 pitch=5 / comp=0.8',
      rt.afterClick &&
        Math.abs(rt.afterClick.slotsA.pitch - rt.savedA.pitch) < 1e-9 &&
        Math.abs(rt.afterClick.slotsA.comp - rt.savedA.comp) < 1e-9 &&
        rt.savedA.pitch === 5 &&
        rt.savedA.comp === 0.8,
      { pitch: 5, comp: 0.8 },
      rt.afterClick && { pitch: rt.afterClick.slotsA.pitch, comp: rt.afterClick.slotsA.comp },
    );
    c.add(
      'A/B：RESET 后点 A 仍能还原此前存的槽位值',
      rt.restoredA &&
        rt.restoredA.pitch === 5 &&
        Math.abs(rt.restoredA.comp - 0.8) < 1e-9 &&
        rt.restoredA.knobPitch === 5,
      { pitch: 5, comp: 0.8, knobPitch: 5 },
      rt.restoredA,
    );
    c.add(
      'A/B：markSlot 让当前槽 B 同步为 RESET 后的默认值',
      rt.afterClick &&
        Math.abs(rt.afterClick.slotsB.pitch - rt.defs.pitch) < 1e-9 &&
        Math.abs(rt.afterClick.slotsB.mix - rt.defs.mix) < 1e-9,
      { pitch: rt.defs.pitch, mix: rt.defs.mix },
      rt.afterClick && { pitch: rt.afterClick.slotsB.pitch, mix: rt.afterClick.slotsB.mix },
    );
    c.add(
      'RESET 后切回 B 仍是默认值（两次槽位切换互不污染）',
      rt.restoredB &&
        rt.restoredB.pitch === rt.defs.pitch &&
        Math.abs(rt.restoredB.mix - rt.defs.mix) < 1e-9,
      { pitch: rt.defs.pitch, mix: rt.defs.mix },
      rt.restoredB,
    );

    const closedMic = await evalJs(`(() => {
  const st = window.__belcanto;
  const b = document.getElementById('mic-toggle');
  const before = { micOn: st.micOn, stream: !!st.micStream };
  b.click();
  return {
    before,
    micOn: st.micOn, stream: !!st.micStream, node: !!st.micNode,
    text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'),
    status: document.getElementById('status-text').textContent,
    micVisible: !document.getElementById('transport-mic').hidden,
    headerMic: document.getElementById('source-mic').getAttribute('aria-pressed'),
    recState: st.rec.state
  };
})()`);
    console.log('mic-closed:', JSON.stringify(closedMic));
    c.add(
      '点「关闭麦克风」：micOn=false、MediaStream/输入节点释放、回到模式内未开启',
      closedMic.before.micOn === true &&
        closedMic.before.stream === true &&
        closedMic.micOn === false &&
        closedMic.stream === false &&
        closedMic.node === false,
      { before: { micOn: true, stream: true }, micOn: false, stream: false, node: false },
      closedMic,
    );
    c.add(
      '关闭后按钮变回「开启麦克风」、aria-pressed=false、状态栏「麦克风模式 · 未开启」、麦克风模式仍高亮',
      closedMic.text === 'Enable mic' &&
        closedMic.pressed === 'false' &&
        closedMic.status === 'Microphone mode · mic off' &&
        closedMic.headerMic === 'true' &&
        closedMic.micVisible === true &&
        closedMic.recState === 'idle',
      {
        text: 'Enable mic',
        pressed: 'false',
        status: 'Microphone mode · mic off',
        headerMic: 'true',
      },
      closedMic,
    );

    await evalJs(`document.getElementById('source-file').click()`);
    await sleep(250);
    const fileEntered = await evalJs(`(() => {
  const st = window.__belcanto;
  const tl = document.getElementById('timeline');
  return {
    mode: st.mode, micOn: st.micOn, hasBuffer: !!st.fileBuffer, fileName: st.fileName,
    playDisabled: document.getElementById('play-btn').disabled,
    loopDisabled: document.getElementById('loop-btn').disabled,
    exportDisabled: document.getElementById('export-btn').disabled,
    timelineHidden: tl.hidden, timelineDisabled: tl.getAttribute('aria-disabled'),
    timelineClass: tl.classList.contains('disabled'), timelineTabIndex: tl.tabIndex,
    fileTransport: !document.getElementById('transport-file').hidden,
    micTransport: !document.getElementById('transport-mic').hidden,
    headerMic: document.getElementById('source-mic').getAttribute('aria-pressed'),
    headerFile: document.getElementById('source-file').getAttribute('aria-pressed'),
    status: document.getElementById('status-text').textContent,
    shownName: document.getElementById('file-name').textContent,
    chooseText: document.getElementById('choose-file').textContent.trim()
  };
})()`);
    console.log('file-mode-entered:', JSON.stringify(fileEntered));
    c.add(
      '点「音频文件」只进入文件模式：未载入文件（fileBuffer=null、文件名占位）',
      fileEntered.mode === 'file' &&
        fileEntered.hasBuffer === false &&
        fileEntered.shownName === '—' &&
        fileEntered.fileName === '',
      { mode: 'file', hasBuffer: false, shownName: '—' },
      fileEntered,
    );
    c.add(
      '文件模式未载入：▶ / LOOP / 导出 全部 disabled',
      fileEntered.playDisabled === true &&
        fileEntered.loopDisabled === true &&
        fileEntered.exportDisabled === true,
      { play: true, loop: true, export: true },
      {
        play: fileEntered.playDisabled,
        loop: fileEntered.loopDisabled,
        export: fileEntered.exportDisabled,
      },
    );
    c.add(
      '文件模式未载入：时间轴灰显（aria-disabled=true / .disabled / tabindex=-1）但仍在文件模式内',
      fileEntered.timelineHidden === false &&
        fileEntered.timelineDisabled === 'true' &&
        fileEntered.timelineClass === true &&
        fileEntered.timelineTabIndex === -1,
      { hidden: false, ariaDisabled: 'true', classDisabled: true, tabIndex: -1 },
      {
        hidden: fileEntered.timelineHidden,
        ariaDisabled: fileEntered.timelineDisabled,
        classDisabled: fileEntered.timelineClass,
        tabIndex: fileEntered.timelineTabIndex,
      },
    );
    c.add(
      '文件模式：传输行出现「选择文件」、顶栏文件高亮、麦克风 transport 隐藏、状态「文件模式 · 未载入文件」',
      fileEntered.chooseText === 'Choose file' &&
        fileEntered.headerFile === 'true' &&
        fileEntered.headerMic === 'false' &&
        fileEntered.fileTransport === true &&
        fileEntered.micTransport === false &&
        fileEntered.status === 'File mode · no file loaded',
      {
        choose: 'Choose file',
        file: 'true',
        mic: 'false',
        fileTransport: true,
        status: 'File mode · no file loaded',
      },
      fileEntered,
    );

    await send('DOM.enable');
    const doc = await send('DOM.getDocument');
    const fileNode = await send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '#file-input',
    });
    await send('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [wav] });
    let fileReady = null;
    for (let i = 0; i < 100; i++) {
      fileReady = await evalJs(`(() => {
    const st = window.__belcanto;
    return { mode: st.mode, hasBuffer: !!st.fileBuffer, name: st.fileName,
      status: document.getElementById('status-text').textContent };
  })()`);
      if (fileReady?.mode === 'file' && fileReady?.hasBuffer) break;
      await sleep(200);
    }
    const fileLoadedControls = await evalJs(`(() => {
  const st = window.__belcanto;
  const tl = document.getElementById('timeline');
  return {
    mode: st.mode, hasBuffer: !!st.fileBuffer,
    playDisabled: document.getElementById('play-btn').disabled,
    loopDisabled: document.getElementById('loop-btn').disabled,
    exportDisabled: document.getElementById('export-btn').disabled,
    timelineDisabled: tl.getAttribute('aria-disabled'), timelineClass: tl.classList.contains('disabled'),
    timelineTabIndex: tl.tabIndex, timelineHidden: tl.hidden,
    status: document.getElementById('status-text').textContent
  };
})()`);
    console.log('file-loaded-controls:', JSON.stringify(fileLoadedControls));
    c.add(
      '载入文件后 ▶ / LOOP / 导出 / 时间轴全部恢复可用，且仍不自动播放',
      fileLoadedControls.mode === 'file' &&
        fileLoadedControls.hasBuffer === true &&
        fileLoadedControls.playDisabled === false &&
        fileLoadedControls.loopDisabled === false &&
        fileLoadedControls.exportDisabled === false &&
        fileLoadedControls.timelineDisabled === 'false' &&
        fileLoadedControls.timelineClass === false &&
        fileLoadedControls.timelineTabIndex === 0 &&
        fileLoadedControls.timelineHidden === false &&
        (fileLoadedControls.status || '').includes('Loaded'),
      {
        play: false,
        loop: false,
        export: false,
        timelineDisabled: 'false',
        tabIndex: 0,
        autoPlay: false,
      },
      fileLoadedControls,
    );

    const fileReset = await evalJs(`(async () => {
  const st = window.__belcanto;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.getElementById('reset-btn');
  const pre = {
    mode: st.mode,
    name: st.fileName,
    duration: st.fileBuffer ? st.fileBuffer.duration : 0,
    status: document.getElementById('status-text').textContent,
    visible: btn.offsetParent !== null,
    disabled: btn.disabled,
    aria: btn.getAttribute('aria-label'),
  };

  st.knobs.pitch.setValue(3);
  st.knobs.comp.setValue(0.7);
  document.getElementById('play-btn').click();
  await wait(300);
  const playingBefore = st.playing;
  btn.click();
  const after = {
    playing: st.playing,
    hasBuffer: !!st.fileBuffer,
    name: st.fileName,
    duration: st.fileBuffer ? st.fileBuffer.duration : 0,
    pitch: st.values.pitch,
    comp: st.values.comp,
    preset: st.preset,
    select: document.getElementById('preset').value,
    status: document.getElementById('status-text').textContent,
    toast: document.getElementById('toast').textContent,
    recState: st.rec.state,
  };
  document.getElementById('play-btn').click();
  return { pre, playingBefore, after };
})();
`);
    console.log('file-reset:', JSON.stringify(fileReset));
    const fr = fileReset || {};
    c.add(
      '文件模式下 RESET 按钮仍可见可用（顶部预设栏）',
      fr.pre &&
        fr.pre.mode === 'file' &&
        fr.pre.visible === true &&
        fr.pre.disabled === false &&
        fr.pre.aria === 'Reset to defaults',
      { mode: 'file', visible: true, disabled: false, aria: 'Reset to defaults' },
      fr.pre,
    );
    c.add(
      '播放中点 RESET：播放不中断、已载入文件与时长不变',
      fr.playingBefore === true &&
        fr.after &&
        fr.after.playing === true &&
        fr.after.hasBuffer === true &&
        fr.after.name === fr.pre.name &&
        Math.abs(fr.after.duration - fr.pre.duration) < 1e-6,
      { playing: true, fileUnchanged: true },
      {
        playingBefore: fr.playingBefore,
        playingAfter: fr.after && fr.after.playing,
        name: fr.after && fr.after.name,
        duration: fr.after && fr.after.duration,
      },
    );
    c.add(
      '播放中点 RESET：参数回到 def、下拉切自定义、toast 正确',
      fr.after &&
        fr.after.pitch === 0 &&
        Math.abs(fr.after.comp - 0.45) < 1e-9 &&
        fr.after.preset === '__custom__' &&
        fr.after.select === '__custom__' &&
        fr.after.toast === 'Defaults restored' &&
        fr.after.recState === 'idle',
      { pitch: 0, comp: 0.45, preset: '__custom__', toast: 'Defaults restored' },
      fr.after,
    );

    c.add('No unexpected page errors', errors.unexpected.length === 0, [], errors.unexpected);
    return c.report('UI_PASS', 'UI_FAIL') ? 0 : 1;
  },
);
