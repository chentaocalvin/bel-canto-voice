#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createRunDirectory } from './run-directory.mjs';
import { readWavFile, describeWav, verifyExportedWav, compareExportedWavs } from './wav-info.mjs';
import { createChecks } from './checks.mjs';
import { withBrowser } from './browser-session.mjs';
import { createPageErrors } from './page-errors.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5188';
const c = createChecks();
const downloads = createRunDirectory({
  parent: process.env.DOWNLOAD_DIR,
  prefix: 'belcanto-downloads-',
});
const dl = downloads.path;
console.log('download directory:', dl);
c.add('本次下载目录为空', readdirSync(dl).length === 0, 0, readdirSync(dl).length);
const wav = resolve(process.argv[2] || 'tools/test-vocal.wav');
const src = readWavFile(wav);
console.log('source:', describeWav(src));
if (!src.ok) throw new Error(`Source WAV cannot be parsed: ${wav}: ${src.error}`);
const PRESET = process.env.PRESET || '';
process.exitCode = await withBrowser(
  { flags: ['--window-size=1440,940'], commandTimeout: 40000 },
  async (browser) => {
    const send = browser.send;
    const ev = browser.evaluate;
    const errors = createPageErrors();
    browser.onEvent(errors.record);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(2200);

    const doc = await send('DOM.getDocument');
    const node = await send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '#file-input',
    });
    await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [wav] });

    let state = null;
    for (let i = 0; i < 80; i++) {
      state = await ev(`({
    status: document.getElementById('status-text').textContent,
    fileName: document.getElementById('file-name').textContent,
    playing: !!(window.__belcanto && window.__belcanto.playing),
    hasBuffer: !!(window.__belcanto && window.__belcanto.fileBuffer),
    duration: window.__belcanto && window.__belcanto.fileBuffer ? window.__belcanto.fileBuffer.duration : 0,
    bufferLength: window.__belcanto && window.__belcanto.fileBuffer ? window.__belcanto.fileBuffer.length : 0,
    ctxSampleRate: window.__belcanto && window.__belcanto.ctx ? window.__belcanto.ctx.sampleRate : 0,
    preset: window.__belcanto ? window.__belcanto.preset : ''
  })`);
      if (state && state.hasBuffer && (state.status || '').startsWith('File · ')) break;
      await sleep(250);
    }

    await ev(`document.getElementById('play-btn').click()`);
    let playingAfterClick = false;
    for (let i = 0; i < 40; i++) {
      playingAfterClick = (await ev(`!!(window.__belcanto && window.__belcanto.playing)`)) === true;
      if (playingAfterClick) break;
      await sleep(100);
    }
    state.playing = playingAfterClick;
    console.log('page:', JSON.stringify(state, null, 2));

    c.add(
      'WAV 已解码进页面并能播放（导入后点 ▶）',
      state?.hasBuffer === true && state?.playing === true,
      { hasBuffer: true, playing: true },
      { hasBuffer: state?.hasBuffer, playing: state?.playing },
    );
    c.add(
      '状态文本进入文件播放模式',
      (state?.status || '').startsWith('File · '),
      'File · <name>',
      state?.status,
    );
    c.add(
      '源 WAV 头时长与页面解码时长一致（±0.1s）',
      Math.abs(src.duration - (state?.duration || 0)) <= 0.1,
      `${src.duration.toFixed(3)}s ±0.1s`,
      `${(state?.duration || 0).toFixed(3)}s`,
    );

    const monitorBefore = await ev(`(() => {
  const st = window.__belcanto;
  const b = document.getElementById('monitor');
  return { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), disabled: b.disabled,
    visible: b.offsetParent !== null, on: st.chain.isMonitorOn(),
    gain: st.chain.audioParams.monitor.value };
})()`);
    console.log('monitor-before:', JSON.stringify(monitorBefore));
    c.add(
      '文件模式：监听按钮可见、可用，默认「监听开」',
      monitorBefore?.visible === true &&
        monitorBefore?.disabled === false &&
        monitorBefore?.text === '🔊 Monitor' &&
        monitorBefore?.pressed === 'true' &&
        monitorBefore?.on === true &&
        Math.abs((monitorBefore?.gain ?? 0) - 1) < 1e-6,
      { visible: true, disabled: false, text: '🔊 Monitor', pressed: 'true', on: true, gain: 1 },
      monitorBefore,
    );

    await ev(`document.getElementById('monitor').click()`);
    await sleep(250);
    const monitorMuted = await ev(`(() => {
  const st = window.__belcanto;
  const b = document.getElementById('monitor');
  return { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), on: st.chain.isMonitorOn(),
    gain: st.chain.audioParams.monitor.value, toast: document.getElementById('toast').textContent };
})()`);
    console.log('monitor-muted:', JSON.stringify(monitorMuted));
    c.add(
      '文件模式点静音：按钮变「🔇 静音」、aria-pressed=false、gain 趋近 0',
      monitorMuted?.text === '🔇 Muted' &&
        monitorMuted?.pressed === 'false' &&
        monitorMuted?.on === false &&
        monitorMuted?.gain < 0.01,
      { text: '🔇 Muted', pressed: 'false', on: false, gain: '< 0.01' },
      monitorMuted,
    );
    c.add(
      '点静音提示「录音和导出不受影响」',
      (monitorMuted?.toast || '').includes('recording and export unaffected'),
      '含「录音和导出不受影响」',
      monitorMuted?.toast,
    );

    if (PRESET) {
      await ev(
        `(() => { const s = document.getElementById('preset'); s.value = ${JSON.stringify(PRESET)}; s.dispatchEvent(new Event('change')); })()`,
      );
      await sleep(600);
      const presetNow = await ev(
        `({ preset: window.__belcanto.preset, select: document.getElementById('preset').value, mix: window.__belcanto.values.mix })`,
      );
      c.add(
        `PRESET=${PRESET} 已应用`,
        presetNow.preset === PRESET && presetNow.select === PRESET,
        { preset: PRESET, select: PRESET },
        { preset: presetNow.preset, select: presetNow.select },
      );
    }

    const before = await ev(`document.getElementById('status-text').textContent`);
    console.log('before export:', before);

    const waitForDownload = async (timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      let status = '';
      let files = [];
      let settled = false;
      while (Date.now() < deadline) {
        await sleep(300);
        const entries = existsSync(dl) ? readdirSync(dl) : [];
        const downloading = entries.some((f) => f.endsWith('.crdownload'));
        files = entries.filter((f) => f.endsWith('.wav'));
        status = await ev(`document.getElementById('status-text').textContent`);
        if (files.length && !downloading) {
          const p = join(dl, files[0]);
          const s1 = statSync(p).size;
          await sleep(300);
          const s2 = statSync(p).size;
          if (s1 === s2 && s1 > 44) {
            settled = true;
            break;
          }
        }
        if (status === 'Export failed') break;
      }
      return { status, files, settled };
    };

    const exportStart = Date.now();

    await ev(`(() => {
  window.__bcProgressDom = [];
  const pctEl = document.getElementById('export-pct');
  const record = () => {
    const bar = document.getElementById('export-progress');
    window.__bcProgressDom.push({
      hidden: bar.hidden,
      now: Number(bar.getAttribute('aria-valuenow')),
      text: pctEl.textContent,
      width: document.getElementById('export-fill').style.width,
      status: document.getElementById('status-text').textContent
    });
  };
  record();
  const obs = new MutationObserver(record);
  obs.observe(pctEl, { childList: true, characterData: true, subtree: true });
  window.__bcProgressObs = obs;
})()`);
    await ev(`document.getElementById('export-btn').click()`);
    const first = await waitForDownload(90000);
    console.log('status:', first.status);
    console.log('downloaded:', first.files, first.settled ? '(stable)' : '(not stable)');

    const progress = await ev(`(() => {
  const bar = document.getElementById('export-progress');
  if (window.__bcProgressObs) { window.__bcProgressObs.disconnect(); window.__bcProgressObs = null; }
  const prog = window.__belcanto.exportProgress || {};
  return {
    hidden: bar.hidden,
    aria: Number(bar.getAttribute('aria-valuenow')),
    text: document.getElementById('export-pct').textContent,
    width: document.getElementById('export-fill').style.width,
    history: prog.history || [],
    slices: prog.slices || 0,
    value: prog.value,
    dom: window.__bcProgressDom || []
  };
})()`);
    console.log('progress:', JSON.stringify(progress));

    c.add(
      '导出状态为「导出完成」',
      first.status === 'Export complete',
      'Export complete',
      first.status,
    );
    const intermediate = (progress.history || []).filter((p) => p > 0 && p < 100);
    const domMid = (progress.dom || []).filter(
      (d) =>
        !d.hidden && d.now > 0 && d.now < 100 && d.text === `${d.now}%` && d.width === `${d.now}%`,
    );
    const monotonic = (progress.history || []).every((v, i, a) => i === 0 || v >= a[i - 1]);
    const maxStep = (progress.history || []).reduce(
      (m, v, i, a) => (i === 0 ? m : Math.max(m, v - a[i - 1])),
      0,
    );
    c.add(
      '导出进度：渲染中真的出现过 0 < p < 100 的中间值（状态与 DOM 同步）',
      intermediate.length >= 1 && domMid.length >= 1,
      { history: '至少 1 个 0<p<100', dom: '至少 1 个可见且文本/宽度同步的 0<p<100' },
      { history: progress.history, domMid: domMid.length },
    );
    const expectedSlices = Math.floor((state.duration + 3 - 1e-6) / 0.5);
    c.add(
      '导出进度：每个 suspend 时间片都回报一次（每 0.5s 渲染时长）',
      progress.slices === expectedSlices && intermediate.length === progress.slices,
      { slices: expectedSlices, intermediate: expectedSlices },
      { slices: progress.slices, intermediate: intermediate.length },
    );
    c.add(
      '导出进度：百分比单调递增，单步 ≤ 10 个百分点',
      monotonic && maxStep <= 10,
      { monotonic: true, maxStep: '≤ 10' },
      { history: progress.history, maxStep },
    );
    c.add(
      '导出完成时进度为 100% 且进度条可见',
      progress.hidden === false &&
        progress.aria === 100 &&
        progress.text === '100%' &&
        progress.width === '100%' &&
        progress.value === 100,
      { hidden: false, aria: 100, text: '100%', width: '100%', value: 100 },
      {
        hidden: progress.hidden,
        aria: progress.aria,
        text: progress.text,
        width: progress.width,
        value: progress.value,
      },
    );
    c.add('下载目录只有本次 1 个 .wav', first.files.length === 1, 1, first.files);
    c.add('下载已写完（无 .crdownload、大小稳定）', first.settled === true, true, first.settled);

    let info = null;
    let firstBuf = null;
    if (first.files.length >= 1) {
      const exportPath = join(dl, first.files[0]);
      const st = statSync(exportPath);
      info = readWavFile(exportPath);
      firstBuf = readFileSync(exportPath);
      console.log('export:', describeWav(info));
      const expectedName = basename(wav).replace(/\.[^.]+$/, '') + '-belcanto.wav';
      c.add(
        '下载文件名由源文件派生',
        first.files[0] === expectedName,
        expectedName,
        first.files[0],
      );
      c.add(
        '下载文件是导出开始后新建/写入的',
        st.mtimeMs >= exportStart - 2000,
        `mtime ≥ ${new Date(exportStart).toISOString()}`,
        new Date(st.mtimeMs).toISOString(),
      );
      c.addAll(
        verifyExportedWav(info, {
          sourceDuration: state.duration,
          sampleRate: state.ctxSampleRate,
          bufferLength: state.bufferLength,
        }),
      );
      c.add(
        '监听静音时导出的 WAV 仍有实际内容（peak > 0.01，离线链路不经过 monitorGain）',
        info.ok && info.peak > 0.01,
        '> 0.01',
        info.ok ? info.peak : info.error,
      );
    } else {
      c.add('找到可解析的导出 WAV', false, '1 个 .wav', first.files);
    }

    if (firstBuf) {
      await ev(`document.getElementById('monitor').click()`);
      await sleep(250);
      const monitorRestored = await ev(`(() => {
    const st = window.__belcanto;
    const b = document.getElementById('monitor');
    return { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'),
      on: st.chain.isMonitorOn(), gain: st.chain.audioParams.monitor.value };
  })()`);
      console.log('monitor-restored:', JSON.stringify(monitorRestored));
      c.add(
        '恢复监听：gain 回到 1、按钮 🔊 监听 / aria-pressed=true',
        monitorRestored?.text === '🔊 Monitor' &&
          monitorRestored?.pressed === 'true' &&
          monitorRestored?.on === true &&
          monitorRestored?.gain > 0.99,
        { text: '🔊 Monitor', pressed: 'true', on: true, gain: '> 0.99' },
        monitorRestored,
      );
      rmSync(join(dl, first.files[0]), { force: true });
      await ev(`document.getElementById('export-btn').click()`);
      const second = await waitForDownload(90000);
      console.log('repro status:', second.status);
      console.log('repro downloaded:', second.files, second.settled ? '(stable)' : '(not stable)');
      c.add(
        '第二次导出也完成且只下载 1 个 .wav',
        second.status === 'Export complete' && second.files.length === 1 && second.settled === true,
        { status: 'Export complete', files: 1, settled: true },
        { status: second.status, files: second.files, settled: second.settled },
      );
      if (second.files.length >= 1) {
        const secondBuf = readFileSync(join(dl, second.files[0]));
        const comparison = compareExportedWavs(firstBuf, secondBuf, {
          sourceDuration: state.duration,
          sampleRate: state.ctxSampleRate,
          bufferLength: state.bufferLength,
        });
        c.addAll(comparison.checks);
        const { headerDiff, maxLSB, sampleDiff, totalSamples, allowed } = comparison;
        console.log(
          'repro diff:',
          JSON.stringify({ headerDiff, maxLSB, sampleDiff, totalSamples, allowed }),
        );
        c.add(
          '同参数连续两次导出只差 ≤ 1 LSB，且不同采样点 ≤ 0.02%',
          comparison.pass,
          { headerDiff: 0, maxLSB: '≤ 1', sampleDiff: `≤ ${allowed}`, totalSamples },
          { headerDiff, maxLSB, sampleDiff, totalSamples },
        );
        c.add(
          '监听静音没有进入离线导出：静音态与非静音态产物一致（≤ 1 LSB 量化差）',
          comparison.pass,
          { headerDiff: 0, maxLSB: '≤ 1', sampleDiff: `≤ ${allowed}`, totalSamples },
          { headerDiff, maxLSB, sampleDiff, totalSamples },
        );
      }
    }

    c.add('No unexpected page errors', errors.unexpected.length === 0, [], errors.unexpected);
    return c.report('EXPORT_PASS', 'EXPORT_FAIL') ? 0 : 1;
  },
);
