#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync, readdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRunDirectory } from './run-directory.mjs';
import { readWavFile, describeWav } from './wav-info.mjs';
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
const wavFiles = () => (existsSync(dl) ? readdirSync(dl).filter((f) => f.endsWith('.wav')) : []);

const partialFiles = () =>
  existsSync(dl) ? readdirSync(dl).filter((f) => /^belcanto-take-.*\.crdownload$/.test(f)) : [];

process.exitCode = await withBrowser(
  {
    flags: [
      '--window-size=1440,940',
      '--force-device-scale-factor=1',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
    commandTimeout: 40000,
  },
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

    const snap = () =>
      ev(`(() => {
  const st = window.__belcanto;
  const rec = st && st.rec;
  const btn = document.getElementById('rec-btn');
  const save = document.getElementById('rec-save');
  const discard = document.getElementById('rec-discard');
  const pause = document.getElementById('rec-pause');
  const progress = document.getElementById('rec-progress');
  const actions = document.getElementById('rec-actions');
  const toastEl = document.getElementById('toast');
  return {
    ctxState: st && st.ctx ? st.ctx.state : 'none',
    ctxSampleRate: st && st.ctx ? st.ctx.sampleRate : 0,
    micOn: !!(st && st.micOn),
    micStream: !!(st && st.micStream),
    micNode: !!(st && st.micNode),
    micToggleText: document.getElementById('mic-toggle').textContent.trim(),
    micTogglePressed: document.getElementById('mic-toggle').getAttribute('aria-pressed'),
    state: rec ? rec.state : 'missing',
    elapsed: rec ? rec.elapsed : -1,
    blobSize: rec && rec.blob ? rec.blob.size : 0,
    chunks: rec ? rec.chunks.length : -1,
    saving: rec ? rec.saving : null,
    recorderState: rec && rec.recorder ? rec.recorder.state : null,
    destTracks: rec && rec.dest ? rec.dest.stream.getTracks().map((t) => t.readyState) : null,
    saveProgress: st && st.recSaveProgress ? {
      value: st.recSaveProgress.value,
      phase: st.recSaveProgress.phase,
      failed: st.recSaveProgress.failed,
      history: [...st.recSaveProgress.history],
      phases: [...st.recSaveProgress.phases]
    } : null,
    time: document.getElementById('rec-time').textContent,
    btnText: btn.textContent.trim(),
    btnLabel: btn.getAttribute('aria-label'),
    btnPressed: btn.getAttribute('aria-pressed'),
    btnDisabled: btn.disabled,
    btnRecording: btn.classList.contains('recording'),
    pauseHidden: pause.hidden,
    pauseText: pause.textContent.trim(),
    pauseLabel: pause.getAttribute('aria-label'),
    pausePressed: pause.getAttribute('aria-pressed'),
    pauseDisabled: pause.disabled,
    recProgressHidden: progress.hidden,
    recProgressNow: progress.hasAttribute('aria-valuenow') ? Number(progress.getAttribute('aria-valuenow')) : null,
    recProgressText: document.getElementById('rec-pct').textContent,
    recProgressIndeterminate: progress.classList.contains('is-indeterminate'),
    recProgressFailed: progress.classList.contains('is-failed'),
    actionsHidden: actions.hidden,
    actionsBusy: actions.getAttribute('aria-busy'),
    saveHidden: save.hidden,
    saveDisabled: save.disabled,
    saveText: save.textContent.trim(),
    saveLabel: save.getAttribute('aria-label'),
    discardHidden: discard.hidden,
    discardDisabled: discard.disabled,
    discardText: discard.textContent.trim(),
    discardLabel: discard.getAttribute('aria-label'),
    hintHidden: document.getElementById('rec-hint').hidden,
    toast: toastEl.textContent,
    toastShown: toastEl.classList.contains('show'),
    toastLog: window.__toastLog || [],
    status: document.getElementById('status-text').textContent,
    mode: st ? st.mode : null,
    monitor: (() => {
      const b = document.getElementById('monitor');
      const chain = st && st.chain;
      const gain = chain ? chain.audioParams.monitor.value : null;
      const style = getComputedStyle(b);
      return {
        text: b.textContent.trim(),
        pressed: b.getAttribute('aria-pressed'),
        disabled: b.disabled,
        visible: b.offsetParent !== null && style.display !== 'none' && style.visibility !== 'hidden',
        gain,
        on: chain ? chain.isMonitorOn() : null,
        meterIn: parseFloat(document.getElementById('meter-in').style.getPropertyValue('--v')) || 0,
        meterOut: parseFloat(document.getElementById('meter-out').style.getPropertyValue('--v')) || 0
      };
    })()
  };
})()`);

    const waitFor = async (pred, timeoutMs = 8000, step = 100) => {
      const deadline = Date.now() + timeoutMs;
      let s = null;
      while (Date.now() < deadline) {
        s = await snap();
        if (pred(s)) return s;
        await sleep(step);
      }
      return s;
    };
    const waitState = (want, timeoutMs) => waitFor((s) => s && s.state === want, timeoutMs);
    const click = (id) => ev(`document.getElementById('${id}').click()`);

    const ensureMicStarted = async () => {
      let s = await snap();
      if (s?.mode !== 'mic') {
        await click('source-mic');
        s = await waitFor((x) => x && x.mode === 'mic', 4000);
      }
      if (!s?.micOn) {
        await click('mic-toggle');
        s = await waitFor((x) => x && x.micOn === true, 15000);
      }
      await sleep(300);
      return s;
    };
    const readTime = (s) => {
      const m = /●\s*([\d.]+)s/.exec(s.time || '');
      return m ? Number(m[1]) : NaN;
    };

    const startToastLog = () =>
      ev(`(() => {
  window.__toastLog = [];
  const el = document.getElementById('toast');
  const push = () => {
    const t = el.textContent;
    if (t && window.__toastLog[window.__toastLog.length - 1] !== t) window.__toastLog.push(t);
  };
  push();
  const obs = new MutationObserver(push);
  obs.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.__toastObs = obs;
  return true;
})()`);

    const startRecProgressLog = () =>
      ev(`(() => {
  window.__recProgressDom = [];
  const bar = document.getElementById('rec-progress');
  const pctEl = document.getElementById('rec-pct');
  const fill = document.getElementById('rec-fill');
  const save = document.getElementById('rec-save');
  const discard = document.getElementById('rec-discard');
  const btn = document.getElementById('rec-btn');
  const record = () => {
    window.__recProgressDom.push({
      hidden: bar.hidden,
      now: bar.hasAttribute('aria-valuenow') ? Number(bar.getAttribute('aria-valuenow')) : null,
      text: pctEl.textContent,
      width: fill.style.width,
      indeterminate: bar.classList.contains('is-indeterminate'),
      failed: bar.classList.contains('is-failed'),
      saveDisabled: save.disabled,
      discardDisabled: discard.disabled,
      btnDisabled: btn.disabled
    });
  };
  record();
  const obs = new MutationObserver(record);
  obs.observe(bar, { attributes: true });
  obs.observe(pctEl, { childList: true, characterData: true, subtree: true });
  obs.observe(fill, { attributes: true, attributeFilter: ['style'] });
  window.__recProgressObs = obs;
  return true;
})()`);

    const stopRecProgressLog = () =>
      ev(`(() => {
  if (window.__recProgressObs) { window.__recProgressObs.disconnect(); window.__recProgressObs = null; }
  const p = window.__belcanto.recSaveProgress || {};
  return {
    dom: window.__recProgressDom || [],
    value: p.value,
    phase: p.phase,
    failed: p.failed,
    history: [...(p.history || [])],
    phases: [...(p.phases || [])]
  };
})()`);

    const waitSavedWav = async (timeoutMs = 30000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await sleep(100);
        const files = wavFiles();
        const downloading = partialFiles().length > 0;
        if (files.length && !downloading) {
          const p = join(dl, files[0]);
          const s1 = statSync(p).size;
          await sleep(200);
          if (statSync(p).size === s1 && s1 > 44) return { files, size: s1 };
        }
      }
      return { files: wavFiles(), timeout: true };
    };

    await startToastLog();
    await click('boot-mic');
    const enteredMic = await waitFor((s) => s && s.mode === 'mic', 5000);
    console.log(
      'mic-mode-entered:',
      JSON.stringify({
        mode: enteredMic?.mode,
        micOn: enteredMic?.micOn,
        ctxState: enteredMic?.ctxState,
        toggle: enteredMic?.micToggleText,
        status: enteredMic?.status,
        stream: enteredMic?.micStream,
      }),
    );
    c.add(
      '首屏「进入麦克风模式」只进入模式：不请求权限、无 MediaStream / AudioContext',
      enteredMic?.mode === 'mic' &&
        enteredMic?.micOn === false &&
        enteredMic?.micStream === false &&
        enteredMic?.ctxState === 'none',
      { mode: 'mic', micOn: false, stream: false, ctxState: 'none' },
      enteredMic,
    );
    c.add(
      '进入麦克风模式后按钮显示「开启麦克风」、aria-pressed=false',
      enteredMic?.micToggleText === 'Enable mic' && enteredMic?.micTogglePressed === 'false',
      { text: 'Enable mic', pressed: 'false' },
      { text: enteredMic?.micToggleText, pressed: enteredMic?.micTogglePressed },
    );
    await click('mic-toggle');
    let boot = await waitFor(
      (s) => s && s.ctxState === 'running' && s.status === 'Microphone · Live' && s.micOn,
      12000,
    );
    console.log(
      'boot:',
      JSON.stringify({
        ctxState: boot?.ctxState,
        status: boot?.status,
        state: boot?.state,
        micOn: boot?.micOn,
        toggle: boot?.micToggleText,
      }),
    );
    c.add(
      '假麦克风已就绪（点「开启麦克风」后 AudioContext running）',
      boot?.ctxState === 'running',
      'running',
      boot?.ctxState,
    );
    c.add(
      '开启后 micOn=true、按钮变「关闭麦克风」、aria-pressed=true',
      boot?.micOn === true &&
        boot?.micToggleText === 'Disable mic' &&
        boot?.micTogglePressed === 'true',
      { micOn: true, text: 'Disable mic', pressed: 'true' },
      { micOn: boot?.micOn, text: boot?.micToggleText, pressed: boot?.micTogglePressed },
    );
    await sleep(1200);

    const idle = await snap();
    console.log(
      'idle:',
      JSON.stringify({
        state: idle.state,
        btn: idle.btnText,
        time: idle.time,
        actionsHidden: idle.actionsHidden,
      }),
    );
    c.add(
      '初始状态是 idle，DOM 显示「录制」',
      idle.state === 'idle' && idle.btnText === 'Record',
      { state: 'idle', btnText: 'Record' },
      { state: idle.state, btnText: idle.btnText },
    );
    c.add(
      'idle：保存/丢弃不可见且禁用，时长为空，hint 可见',
      idle.actionsHidden === true &&
        idle.saveHidden === true &&
        idle.discardHidden === true &&
        idle.saveDisabled === true &&
        idle.discardDisabled === true &&
        idle.time === '' &&
        idle.hintHidden === false,
      {
        actionsHidden: true,
        saveHidden: true,
        discardHidden: true,
        disabled: true,
        time: '',
        hintHidden: false,
      },
      {
        actionsHidden: idle.actionsHidden,
        saveHidden: idle.saveHidden,
        discardHidden: idle.discardHidden,
        saveDisabled: idle.saveDisabled,
        discardDisabled: idle.discardDisabled,
        time: idle.time,
        hintHidden: idle.hintHidden,
      },
    );
    c.add(
      'idle：录制按钮 aria-pressed=false / aria-label=开始录音',
      idle.btnPressed === 'false' && idle.btnLabel === 'Start recording',
      { pressed: 'false', label: 'Start recording' },
      { pressed: idle.btnPressed, label: idle.btnLabel },
    );
    c.add(
      '监听按钮默认「监听开」：🔊 监听 / aria-pressed=true / monitorGain=1',
      idle.monitor.text === '🔊 Monitor' &&
        idle.monitor.pressed === 'true' &&
        idle.monitor.on === true &&
        Math.abs(idle.monitor.gain - 1) < 1e-6,
      { text: '🔊 Monitor', pressed: 'true', on: true, gain: 1 },
      idle.monitor,
    );
    c.add(
      '麦克风模式下监听按钮在顶部按钮区可见且可用',
      idle.monitor.visible === true && idle.monitor.disabled === false,
      { visible: true, disabled: false },
      { visible: idle.monitor.visible, disabled: idle.monitor.disabled },
    );

    await click('rec-btn');
    const rec1 = await waitState('recording', 4000);
    const recStart = Date.now();
    const rec1b = await (async () => {
      await sleep(1200);
      return snap();
    })();
    console.log(
      'recording:',
      JSON.stringify({
        state: rec1b.state,
        time: rec1b.time,
        btn: rec1b.btnText,
        pressed: rec1b.btnPressed,
      }),
    );
    c.add(
      'idle→recording：按钮变「停止」、aria-pressed=true、带 recording 类',
      rec1b.state === 'recording' &&
        rec1b.btnText === 'Stop' &&
        rec1b.btnPressed === 'true' &&
        rec1b.btnRecording === true &&
        rec1b.btnLabel === 'Stop recording',
      {
        state: 'recording',
        btnText: 'Stop',
        pressed: 'true',
        recordingClass: true,
        label: 'Stop recording',
      },
      {
        state: rec1b.state,
        btnText: rec1b.btnText,
        pressed: rec1b.btnPressed,
        recordingClass: rec1b.btnRecording,
        label: rec1b.btnLabel,
      },
    );
    c.add(
      'recording：保存/丢弃仍隐藏，hint 可见，计时器在走',
      rec1b.actionsHidden === true &&
        rec1b.saveHidden === true &&
        rec1b.discardHidden === true &&
        rec1b.hintHidden === false &&
        Number.isFinite(readTime(rec1b)) &&
        readTime(rec1b) > 0.8,
      { actionsHidden: true, hintHidden: false, time: '> 0.8s' },
      { actionsHidden: rec1b.actionsHidden, hintHidden: rec1b.hintHidden, time: rec1b.time },
    );
    c.add(
      'recording：计时从 0.0s 递增（1.2s 后 ≥ 0.8s）',
      readTime(rec1b) - readTime(rec1) >= 0.8 && readTime(rec1b) < 3,
      { delta: '≥ 0.8s' },
      { first: rec1?.time, later: rec1b.time },
    );

    await click('rec-btn');
    const stopWall = Date.now();
    const pending1 = await waitState('pending', 6000);
    const recordSeconds = (stopWall - recStart) / 1000;
    const pending1Late = await (async () => {
      await sleep(900);
      return snap();
    })();
    console.log(
      'pending:',
      JSON.stringify({
        state: pending1?.state,
        time: pending1?.time,
        elapsed: pending1?.elapsed,
        saveDisabled: pending1?.saveDisabled,
        toast: pending1?.toast,
      }),
    );
    c.add(
      'recording→pending：按钮变「重新录制」、aria-pressed=false、recording 类移除',
      pending1?.state === 'pending' &&
        pending1?.btnText === 'Record again' &&
        pending1?.btnPressed === 'false' &&
        pending1?.btnRecording === false &&
        /discards/i.test(pending1?.btnLabel || ''),
      { state: 'pending', btnText: 'Record again', pressed: 'false', label: 'discards' },
      {
        state: pending1?.state,
        btnText: pending1?.btnText,
        pressed: pending1?.btnPressed,
        recordingClass: pending1?.btnRecording,
        label: pending1?.btnLabel,
      },
    );
    c.add(
      'pending：保存 WAV / 丢弃 同时出现、可用、文案与 aria 正确',
      pending1?.actionsHidden === false &&
        pending1?.actionsBusy === 'false' &&
        pending1?.saveHidden === false &&
        pending1?.saveDisabled === false &&
        pending1?.saveText === 'Save WAV' &&
        pending1?.discardHidden === false &&
        pending1?.discardDisabled === false &&
        pending1?.discardText === 'Discard' &&
        pending1?.saveLabel === 'Save this take as WAV' &&
        pending1?.discardLabel === 'Discard this take',
      {
        actionsHidden: false,
        save: '保存 WAV/可用',
        discard: '丢弃/可用',
        saveLabel: 'Save this take as WAV',
        discardLabel: 'Discard this take',
      },
      {
        actionsHidden: pending1?.actionsHidden,
        busy: pending1?.actionsBusy,
        saveHidden: pending1?.saveHidden,
        saveDisabled: pending1?.saveDisabled,
        saveText: pending1?.saveText,
        discardHidden: pending1?.discardHidden,
        discardDisabled: pending1?.discardDisabled,
        discardText: pending1?.discardText,
        saveLabel: pending1?.saveLabel,
        discardLabel: pending1?.discardLabel,
      },
    );
    const frozen = readTime(pending1);
    const frozenLate = readTime(pending1Late);
    const shownTotal = frozen;
    c.add(
      'pending：时长冻结在停止时刻（900ms 后不变）',
      Number.isFinite(frozen) && frozen > 0.5 && frozen === frozenLate,
      { frozen: '> 0.5s 且前后相等' },
      { first: pending1?.time, later: pending1Late?.time },
    );
    c.add(
      'pending：显示时长 = 本次录音总时长（±0.6s）',
      Math.abs(shownTotal - recordSeconds) <= 0.6,
      `${recordSeconds.toFixed(1)}s ±0.6s`,
      `${shownTotal}s`,
    );
    c.add(
      'pending：blob 保留在内存里（> 0 字节），尚未下载',
      (pending1?.blobSize || 0) > 44 && wavFiles().length === 0,
      { blobSize: '> 44', downloads: 0 },
      { blobSize: pending1?.blobSize, downloads: wavFiles() },
    );
    c.add(
      '停止后 900ms 内没有自动下载（目录里仍无 .wav / .crdownload）',
      wavFiles().length === 0 && partialFiles().length === 0,
      { wav: 0, crdownload: 0 },
      { wav: wavFiles(), crdownload: partialFiles() },
    );
    c.add(
      'pending：MediaStreamDestination 已断开、没有悬挂录音器',
      pending1?.destTracks === null && pending1?.recorderState === null,
      { dest: null, recorder: null },
      { dest: pending1?.destTracks, recorder: pending1?.recorderState },
    );

    await click('rec-discard');
    const afterDiscard = await waitState('idle', 4000);
    await sleep(700);
    const discardLate = await snap();
    console.log(
      'discard:',
      JSON.stringify({
        state: afterDiscard?.state,
        toast: afterDiscard?.toast,
        blobSize: afterDiscard?.blobSize,
      }),
    );
    c.add(
      'pending→idle（丢弃）：按钮恢复「录制」、操作区隐藏、时长为空',
      afterDiscard?.state === 'idle' &&
        afterDiscard?.btnText === 'Record' &&
        afterDiscard?.btnPressed === 'false' &&
        afterDiscard?.actionsHidden === true &&
        afterDiscard?.time === '' &&
        afterDiscard?.hintHidden === false,
      {
        state: 'idle',
        btnText: 'Record',
        pressed: 'false',
        actionsHidden: true,
        time: '',
        hintHidden: false,
      },
      {
        state: afterDiscard?.state,
        btnText: afterDiscard?.btnText,
        pressed: afterDiscard?.btnPressed,
        actionsHidden: afterDiscard?.actionsHidden,
        time: afterDiscard?.time,
        hintHidden: afterDiscard?.hintHidden,
      },
    );
    c.add(
      '丢弃：toast =「已丢弃本次录音」且 blob/chunks 已释放',
      afterDiscard?.toast === 'Take discarded' &&
        discardLate?.blobSize === 0 &&
        discardLate?.chunks === 0,
      { toast: 'Take discarded', blob: 0, chunks: 0 },
      { toast: afterDiscard?.toast, blob: discardLate?.blobSize, chunks: discardLate?.chunks },
    );
    c.add(
      '丢弃后仍然没有任何下载',
      wavFiles().length === 0 && partialFiles().length === 0,
      { wav: 0, crdownload: 0 },
      { wav: wavFiles(), crdownload: partialFiles() },
    );

    await click('rec-btn');
    await waitState('recording', 4000);
    const pauseStartWall = Date.now();
    await sleep(1200);
    await click('rec-pause');
    const paused1 = await waitState('paused', 3000);
    const pauseWall = Date.now();
    const pausedAt = readTime(paused1);
    console.log(
      'paused:',
      JSON.stringify({
        state: paused1?.state,
        time: paused1?.time,
        btn: paused1?.btnText,
        pause: paused1?.pauseText,
        pausePressed: paused1?.pausePressed,
        recorder: paused1?.recorderState,
      }),
    );
    c.add(
      '暂停：state=paused，录制按钮仍为「停止」，暂停按钮变「继续」且 aria-pressed=true',
      paused1?.state === 'paused' &&
        paused1?.btnText === 'Stop' &&
        paused1?.btnLabel === 'Stop recording' &&
        paused1?.btnPressed === 'false' &&
        paused1?.btnRecording === false &&
        paused1?.pauseHidden === false &&
        paused1?.pauseText === 'Resume' &&
        paused1?.pauseLabel === 'Resume recording' &&
        paused1?.pausePressed === 'true',
      {
        state: 'paused',
        btnText: 'Stop',
        pressed: 'false',
        pauseText: 'Resume',
        pausePressed: 'true',
        pauseLabel: 'Resume recording',
      },
      {
        state: paused1?.state,
        btnText: paused1?.btnText,
        pressed: paused1?.btnPressed,
        pauseText: paused1?.pauseText,
        pausePressed: paused1?.pausePressed,
        pauseLabel: paused1?.pauseLabel,
      },
    );
    c.add(
      '暂停：MediaRecorder 处于 paused，录音器与 MediaStreamDestination 仍保留（同一条 take）',
      paused1?.recorderState === 'paused' &&
        Array.isArray(paused1?.destTracks) &&
        paused1.destTracks.length > 0 &&
        paused1.destTracks.every((s) => s === 'live'),
      { recorder: 'paused', destTracks: 'live' },
      { recorder: paused1?.recorderState, destTracks: paused1?.destTracks },
    );
    const pausedLater = await (async () => {
      await sleep(1100);
      return snap();
    })();
    c.add(
      '暂停：计时冻结（1.1s 后显示与 elapsed 都不变）',
      Number.isFinite(pausedAt) &&
        pausedAt > 0.9 &&
        pausedLater?.state === 'paused' &&
        readTime(pausedLater) === pausedAt &&
        pausedLater.elapsed === paused1.elapsed &&
        pausedLater.time === paused1.time,
      { frozen: '> 0.9s 且前后相等' },
      {
        first: paused1?.time,
        later: pausedLater?.time,
        elapsedFirst: paused1?.elapsed,
        elapsedLater: pausedLater?.elapsed,
      },
    );
    c.add(
      '暂停：blob 尚未生成、没有任何下载',
      pausedLater?.blobSize === 0 && wavFiles().length === 0,
      { blob: 0, downloads: 0 },
      { blob: pausedLater?.blobSize, downloads: wavFiles() },
    );

    await click('rec-pause');
    const resumed1 = await waitState('recording', 3000);
    const resumeWall = Date.now();
    await sleep(1200);
    const resumedLater = await snap();
    const resumedAt = readTime(resumedLater);
    console.log(
      'resumed:',
      JSON.stringify({
        state: resumed1?.state,
        time: resumedLater?.time,
        pause: resumedLater?.pauseText,
      }),
    );
    c.add(
      '继续：回到 recording，暂停按钮回「暂停」/aria-pressed=false，录制按钮仍是「停止」',
      resumed1?.state === 'recording' &&
        resumedLater?.pauseText === 'Pause' &&
        resumedLater?.pausePressed === 'false' &&
        resumedLater?.pauseLabel === 'Pause recording' &&
        resumedLater?.btnText === 'Stop' &&
        resumedLater?.btnLabel === 'Stop recording',
      {
        state: 'recording',
        pauseText: 'Pause',
        pausePressed: 'false',
        pauseLabel: 'Pause recording',
        btnText: 'Stop',
      },
      {
        state: resumed1?.state,
        pauseText: resumedLater?.pauseText,
        pausePressed: resumedLater?.pausePressed,
        pauseLabel: resumedLater?.pauseLabel,
        btnText: resumedLater?.btnText,
      },
    );
    c.add(
      '继续：计时接着累加（1.2s 后比暂停时多 ≥ 0.9s）',
      Number.isFinite(resumedAt) && resumedAt - pausedAt >= 0.9,
      { delta: '≥ 0.9s' },
      { pausedAt, resumedAt },
    );

    await click('rec-btn');
    const pendingPause = await waitState('pending', 6000);
    const stopWallPause = Date.now();
    const displayedPause = readTime(pendingPause);
    const recordedWall = (pauseWall - pauseStartWall) / 1000 + (stopWallPause - resumeWall) / 1000;
    const totalWall = (stopWallPause - pauseStartWall) / 1000;
    console.log(
      'paused-take pending:',
      JSON.stringify({
        state: pendingPause?.state,
        time: pendingPause?.time,
        displayed: displayedPause,
        recordedWall,
        totalWall,
      }),
    );
    c.add(
      '暂停后停止：进入 pending，显示时长 ≈ 实际录制时长（不含暂停，±0.6s）',
      pendingPause?.state === 'pending' &&
        Number.isFinite(displayedPause) &&
        Math.abs(displayedPause - recordedWall) <= 0.6,
      `${recordedWall.toFixed(1)}s ±0.6s`,
      `${displayedPause}s`,
    );
    c.add(
      '暂停时长确实没有计入（显示时长比墙钟总时长短 ≥ 0.6s）',
      Number.isFinite(displayedPause) && totalWall - displayedPause >= 0.6,
      { gap: '≥ 0.6s' },
      { totalWall, displayed: displayedPause, gap: totalWall - displayedPause },
    );
    c.add(
      '保存前：保存进度条隐藏',
      pendingPause?.recProgressHidden === true,
      true,
      pendingPause?.recProgressHidden,
    );

    await startRecProgressLog();
    await click('rec-save');
    const savedPause = await waitSavedWav();
    const afterPauseSave = await waitState('idle', 5000);
    const pauseProgress = await stopRecProgressLog();
    const visibleProgress = (pauseProgress?.dom || []).filter((d) => !d.hidden && !d.failed);
    const sawDecodeIndeterminate = visibleProgress.some(
      (d) => d.indeterminate && d.now === null && d.text === 'Decoding…',
    );
    const encodeMid = visibleProgress.filter(
      (d) =>
        !d.indeterminate &&
        d.now !== null &&
        d.now > 0 &&
        d.now < 100 &&
        d.text === `${d.now}%` &&
        d.width === `${d.now}%`,
    );
    const history = pauseProgress?.history || [];
    const historyMid = history.filter((p) => p > 0 && p < 100);
    const monotonic = history.every((v, i, a) => i === 0 || v >= a[i - 1]);
    console.log(
      'save-progress:',
      JSON.stringify({
        phases: pauseProgress?.phases,
        phase: pauseProgress?.phase,
        value: pauseProgress?.value,
        history,
        dom: pauseProgress?.dom?.length,
        indeterminate: sawDecodeIndeterminate,
        encodeMid: encodeMid.length,
      }),
    );
    c.add(
      '保存进度：解码段显示不确定态「解码中…」（无假百分比）',
      sawDecodeIndeterminate && (pauseProgress?.phases || [])[0] === 'decode',
      { indeterminate: true, text: 'Decoding…', firstPhase: 'decode' },
      { indeterminate: sawDecodeIndeterminate, phases: pauseProgress?.phases },
    );
    c.add(
      '保存进度：编码段按真实分块回报，至少 2 个 0<p<100 的中间值且单调递增',
      encodeMid.length >= 2 && historyMid.length >= 2 && monotonic && history[0] === 0,
      { encodeMid: '≥ 2', history: '≥ 2 个中间值', monotonic: true, first: 0 },
      { encodeMid: encodeMid.length, historyMid: historyMid.length, monotonic, history },
    );
    c.add(
      '保存进度：阶段顺序 decode → encode → done',
      (pauseProgress?.phases || []).join(',') === 'decode,encode,done',
      'decode,encode,done',
      pauseProgress?.phases,
    );
    c.add(
      '保存完成：进度到 100%（可见的 100% 与 history 末项）',
      pauseProgress?.value === 100 &&
        history[history.length - 1] === 100 &&
        visibleProgress.some((d) => d.now === 100 && d.text === '100%' && d.width === '100%'),
      { value: 100, last: 100, domVisible: '100%' },
      {
        value: pauseProgress?.value,
        last: history[history.length - 1],
        dom: visibleProgress.slice(-1),
      },
    );
    c.add(
      '保存期间：进度条可见时三个按钮全部禁用（防重复点击）',
      visibleProgress.length > 0 &&
        visibleProgress.every((d) => d.saveDisabled && d.discardDisabled && d.btnDisabled),
      { allDisabled: true },
      {
        checked: visibleProgress.length,
        enabled: visibleProgress
          .filter((d) => !d.saveDisabled || !d.discardDisabled || !d.btnDisabled)
          .slice(0, 3),
      },
    );
    c.add(
      '保存暂停 take：下载恰好 1 条 belcanto-take-<时间戳>.wav',
      savedPause?.files?.length === 1 &&
        /^belcanto-take-\d+\.wav$/.test(savedPause.files[0]) &&
        wavFiles().length === 1,
      { files: 1, name: 'belcanto-take-<时间戳>.wav' },
      { saved: savedPause, now: wavFiles() },
    );
    c.add(
      '保存完成：进度条收起、回到 idle、toast=「录音已导出」、blob 释放',
      afterPauseSave?.state === 'idle' &&
        afterPauseSave?.recProgressHidden === true &&
        afterPauseSave?.toast === 'Recording exported' &&
        afterPauseSave?.blobSize === 0,
      { state: 'idle', hidden: true, toast: 'Recording exported', blob: 0 },
      {
        state: afterPauseSave?.state,
        hidden: afterPauseSave?.recProgressHidden,
        toast: afterPauseSave?.toast,
        blob: afterPauseSave?.blobSize,
      },
    );

    let pauseInfo = null;
    if (savedPause?.files?.length === 1) {
      pauseInfo = readWavFile(join(dl, savedPause.files[0]));
      console.log('paused wav:', describeWav(pauseInfo));
      c.add(
        '暂停 take 的 WAV 合法（RIFF/WAVE、16bit PCM、单声道/双声道）',
        pauseInfo.ok &&
          pauseInfo.riff === 'RIFF' &&
          pauseInfo.wave === 'WAVE' &&
          pauseInfo.audioFormat === 1 &&
          pauseInfo.bitsPerSample === 16 &&
          pauseInfo.channels >= 1 &&
          pauseInfo.channels <= 2,
        { riff: 'RIFF', wave: 'WAVE', audioFormat: 1, bitsPerSample: 16, channels: '1–2' },
        pauseInfo.ok
          ? {
              riff: pauseInfo.riff,
              wave: pauseInfo.wave,
              audioFormat: pauseInfo.audioFormat,
              bitsPerSample: pauseInfo.bitsPerSample,
              channels: pauseInfo.channels,
            }
          : pauseInfo.error,
      );
      c.add(
        '暂停 take 的 WAV 时长 ≈ 累计录制时长（不含暂停，±0.6s）',
        pauseInfo.ok &&
          Math.abs(pauseInfo.duration - recordedWall) <= 0.6 &&
          Math.abs(pauseInfo.duration - displayedPause) <= 0.6,
        `${recordedWall.toFixed(1)}s ±0.6s`,
        pauseInfo.ok ? `${pauseInfo.duration.toFixed(3)}s` : pauseInfo.error,
      );
      c.add(
        '暂停时长没有进入产物：WAV 时长明显短于墙钟总时长（≥ 0.6s）',
        pauseInfo.ok && totalWall - pauseInfo.duration >= 0.6,
        { gap: '≥ 0.6s' },
        pauseInfo.ok
          ? { totalWall, duration: pauseInfo.duration, gap: totalWall - pauseInfo.duration }
          : pauseInfo.error,
      );
    } else {
      c.add('找到暂停 take 的 WAV', false, '1 个 .wav', savedPause?.files);
    }
    rmSync(join(dl, savedPause?.files?.[0] || 'x'), { force: true });

    await click('rec-btn');
    await waitState('recording', 4000);
    await sleep(1000);
    await click('rec-btn');
    await waitState('pending', 6000);
    await startRecProgressLog();
    await ev(`(() => {
  window.__belcanto.ctx.decodeAudioData = () => Promise.reject(new Error('synthetic decode failure'));
  return true;
})()`);
    const failSnap = await errors.expect(
      { kind: 'console.error', message: 'Error: synthetic decode failure' },
      async () => {
        try {
          await click('rec-save');
          const snapshot = await waitFor(
            (s) => s && s.saveProgress && s.saveProgress.failed === true,
            4000,
          );
          await stopRecProgressLog();
          return snapshot;
        } finally {
          await ev(`(() => { delete window.__belcanto.ctx.decodeAudioData; return true; })()`);
        }
      },
    );
    console.log(
      'save-fail:',
      JSON.stringify({
        state: failSnap?.state,
        toast: failSnap?.toast,
        bar: failSnap?.recProgressText,
        failed: failSnap?.recProgressFailed,
        phase: failSnap?.saveProgress?.phase,
      }),
    );
    c.add(
      '保存失败：进度条保持可见的失败态（「保存失败」+ 仍停在 pending）',
      failSnap?.state === 'pending' &&
        failSnap?.recProgressHidden === false &&
        failSnap?.recProgressFailed === true &&
        failSnap?.recProgressText === 'Save failed' &&
        failSnap?.saveProgress?.phase === 'error',
      { state: 'pending', hidden: false, failed: true, text: 'Save failed', phase: 'error' },
      {
        state: failSnap?.state,
        hidden: failSnap?.recProgressHidden,
        failed: failSnap?.recProgressFailed,
        text: failSnap?.recProgressText,
        phase: failSnap?.saveProgress?.phase,
      },
    );
    c.add(
      '保存失败：按钮重新可用、有失败提示、未产生下载',
      failSnap?.saveDisabled === false &&
        failSnap?.discardDisabled === false &&
        failSnap?.btnDisabled === false &&
        /Couldn't export recording|failed/i.test(failSnap?.toast || '') &&
        wavFiles().length === 0,
      {
        saveDisabled: false,
        discardDisabled: false,
        btnDisabled: false,
        toast: 'mentions a failure',
        downloads: 0,
      },
      {
        saveDisabled: failSnap?.saveDisabled,
        discardDisabled: failSnap?.discardDisabled,
        btnDisabled: failSnap?.btnDisabled,
        toast: failSnap?.toast,
        downloads: wavFiles(),
      },
    );
    await click('rec-discard');
    await waitState('idle', 4000);

    await click('rec-btn');
    await waitState('recording', 4000);
    await sleep(1200);
    await click('rec-pause');
    const pausedBeforeStop = await waitState('paused', 3000);
    const pausedStopAt = readTime(pausedBeforeStop);
    await click('rec-btn');
    const pendingFromPause = await waitState('pending', 6000);
    console.log(
      'stop-from-paused:',
      JSON.stringify({
        state: pendingFromPause?.state,
        pausedAt: pausedStopAt,
        pendingTime: pendingFromPause?.time,
        blob: pendingFromPause?.blobSize,
      }),
    );
    c.add(
      '暂停中直接停止：进入 pending，时长与暂停时读数一致（暂停不累计）',
      pendingFromPause?.state === 'pending' &&
        Number.isFinite(pausedStopAt) &&
        readTime(pendingFromPause) === pausedStopAt &&
        (pendingFromPause?.blobSize || 0) > 44,
      { state: 'pending', time: pausedStopAt, blob: '> 44' },
      {
        state: pendingFromPause?.state,
        time: pendingFromPause?.time,
        blob: pendingFromPause?.blobSize,
      },
    );
    c.add(
      '暂停中直接停止不会产生下载',
      wavFiles().length === 0 && partialFiles().length === 0,
      { wav: 0, crdownload: 0 },
      { wav: wavFiles(), crdownload: partialFiles() },
    );
    await click('rec-discard');
    await waitState('idle', 4000);

    await click('rec-btn');
    await waitState('recording', 4000);
    await sleep(900);
    await click('rec-pause');
    await waitState('paused', 3000);
    await startToastLog();
    await click('source-file');
    await waitState('idle', 8000);
    await sleep(400);
    const pausedSwitch = await snap();
    console.log(
      'switch-from-paused:',
      JSON.stringify({
        state: pausedSwitch?.state,
        mode: pausedSwitch?.mode,
        micOn: pausedSwitch?.micOn,
        stream: pausedSwitch?.micStream,
        log: pausedSwitch?.toastLog?.slice(-3),
        blob: pausedSwitch?.blobSize,
      }),
    );
    c.add(
      '暂停中切换音源：自动丢弃、blob 释放、无下载',
      pausedSwitch?.state === 'idle' && pausedSwitch?.blobSize === 0 && wavFiles().length === 0,
      { state: 'idle', blob: 0, downloads: 0 },
      { state: pausedSwitch?.state, blob: pausedSwitch?.blobSize, downloads: wavFiles() },
    );
    c.add(
      '暂停中切到文件模式：麦克风关闭、MediaStream 释放',
      pausedSwitch?.mode === 'file' &&
        pausedSwitch?.micOn === false &&
        pausedSwitch?.micStream === false,
      { mode: 'file', micOn: false, stream: false },
      { mode: pausedSwitch?.mode, micOn: pausedSwitch?.micOn, stream: pausedSwitch?.micStream },
    );
    c.add(
      '暂停中切换音源有丢弃提示（含「已丢弃本次录音（切换音源）」）',
      (pausedSwitch?.toastLog || []).some((t) => t.includes('Take discarded (switching input)')),
      '含「已丢弃本次录音（切换音源）」',
      pausedSwitch?.toastLog,
    );
    await sleep(800);

    await ensureMicStarted();
    await click('rec-btn');
    await waitState('recording', 4000);
    await sleep(2300);
    await snap();
    await click('rec-btn');
    const pending2 = await waitState('pending', 6000);
    const saveElapsed = pending2?.elapsed || 0;
    const ctxSampleRate = pending2?.ctxSampleRate || 0;
    console.log(
      'pending2:',
      JSON.stringify({ state: pending2?.state, elapsed: pending2?.elapsed, time: pending2?.time }),
    );

    await click('rec-save');
    let saved = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await sleep(300);
      const files = wavFiles();
      const downloading = partialFiles().length > 0;
      if (files.length && !downloading) {
        const p = join(dl, files[0]);
        const s1 = statSync(p).size;
        await sleep(250);
        if (statSync(p).size === s1 && s1 > 44) {
          saved = { files, size: s1 };
          break;
        }
      }
      if ((await snap())?.state === 'idle' && files.length) {
        saved = { files, size: statSync(join(dl, files[0])).size };
        break;
      }
    }
    const afterSave = await waitState('idle', 5000);
    console.log(
      'save:',
      JSON.stringify({ saved, state: afterSave?.state, toast: afterSave?.toast }),
    );
    c.add(
      '保存：下载恰好 1 个 .wav，文件名 belcanto-take-<时间戳>.wav',
      !!saved && saved.files.length === 1 && /^belcanto-take-\d+\.wav$/.test(saved.files[0]),
      { files: 1, name: 'belcanto-take-<时间戳>.wav' },
      saved?.files,
    );
    c.add(
      '保存→idle：按钮恢复「录制」、操作区隐藏、计时清零、toast =「录音已导出」',
      afterSave?.state === 'idle' &&
        afterSave?.btnText === 'Record' &&
        afterSave?.actionsHidden === true &&
        afterSave?.time === '' &&
        afterSave?.toast === 'Recording exported' &&
        afterSave?.blobSize === 0,
      {
        state: 'idle',
        btnText: 'Record',
        actionsHidden: true,
        time: '',
        toast: 'Recording exported',
        blob: 0,
      },
      {
        state: afterSave?.state,
        btnText: afterSave?.btnText,
        actionsHidden: afterSave?.actionsHidden,
        time: afterSave?.time,
        toast: afterSave?.toast,
        blob: afterSave?.blobSize,
      },
    );

    let info = null;
    if (saved?.files.length === 1) {
      info = readWavFile(join(dl, saved.files[0]));
      console.log('wav:', describeWav(info));
      c.add(
        '保存的 WAV 是合法 RIFF/WAVE，16bit PCM',
        info.ok &&
          info.riff === 'RIFF' &&
          info.wave === 'WAVE' &&
          info.audioFormat === 1 &&
          info.bitsPerSample === 16,
        { riff: 'RIFF', wave: 'WAVE', audioFormat: 1, bitsPerSample: 16 },
        info.ok
          ? {
              riff: info.riff,
              wave: info.wave,
              audioFormat: info.audioFormat,
              bitsPerSample: info.bitsPerSample,
            }
          : info.error,
      );
      c.add(
        '保存的 WAV 声道数合理（1–2）且采样率 = 当前 AudioContext',
        info.ok && info.channels >= 1 && info.channels <= 2 && info.sampleRate === ctxSampleRate,
        { channels: '1–2', sampleRate: ctxSampleRate },
        info.ok ? { channels: info.channels, sampleRate: info.sampleRate } : info.error,
      );
      c.add(
        '保存的 WAV 时长 > 0，且与界面冻结时长一致（±1.0s）',
        info.ok && info.duration > 0.5 && Math.abs(info.duration - saveElapsed) <= 1.0,
        { duration: `> 0.5s / ${saveElapsed.toFixed(1)}s ±1.0s` },
        info.ok ? `${info.duration.toFixed(3)}s` : info.error,
      );
      c.add(
        '保存的 WAV 头部自洽（44 字节头、无尾随数据）',
        info.ok &&
          info.dataOffset === 44 &&
          info.trailingBytes === 0 &&
          info.riffSize + 8 === info.fileSize,
        'dataOffset=44 / trailing=0 / riffSize+8=fileSize',
        info.ok
          ? `dataOffset=${info.dataOffset} / trailing=${info.trailingBytes} / ${info.riffSize + 8}=${info.fileSize}`
          : info.error,
      );
    } else {
      c.add('找到可解析的录音 WAV', false, '1 个 .wav', saved?.files);
    }

    rmSync(join(dl, saved?.files?.[0] || 'x'), { force: true });

    const monitorClick = await ev(`(() => {
  const st = window.__belcanto;
  const b = document.getElementById('monitor');
  const p = st.chain.audioParams.monitor;
  const before = p.value;
  b.click();
  return {
    before,
    immediate: p.value,
    text: b.textContent.trim(),
    pressed: b.getAttribute('aria-pressed'),
    on: st.chain.isMonitorOn(),
    toast: document.getElementById('toast').textContent
  };
})()`);
    await sleep(250);
    const muted = await snap();
    console.log(
      'monitor-off:',
      JSON.stringify({
        before: monitorClick?.before,
        immediate: monitorClick?.immediate,
        gain: muted?.monitor?.gain,
        on: muted?.monitor?.on,
        text: muted?.monitor?.text,
        pressed: muted?.monitor?.pressed,
        meterIn: muted?.monitor?.meterIn,
        meterOut: muted?.monitor?.meterOut,
        toast: muted?.toast,
      }),
    );
    c.add(
      '点静音：按钮变「🔇 静音」、aria-pressed=false、电路状态 on=false',
      monitorClick?.text === '🔇 Muted' &&
        monitorClick?.pressed === 'false' &&
        monitorClick?.on === false,
      { text: '🔇 Muted', pressed: 'false', on: false },
      { text: monitorClick?.text, pressed: monitorClick?.pressed, on: monitorClick?.on },
    );
    c.add(
      '静音走 ~20ms 过渡（不是瞬间跳变），250ms 后 monitorGain 实际值趋近 0',
      Number.isFinite(monitorClick?.before) &&
        monitorClick.before > 0.99 &&
        monitorClick.immediate > 0.5 &&
        Number.isFinite(muted?.monitor?.gain) &&
        muted.monitor.gain < 0.01,
      { before: 1, immediate: '> 0.5', settled: '< 0.01' },
      {
        before: monitorClick?.before,
        immediate: monitorClick?.immediate,
        settled: muted?.monitor?.gain,
      },
    );
    c.add(
      '静音时提示「录音和导出不受影响」',
      (muted?.toast || '').includes('recording and export unaffected'),
      '含「录音和导出不受影响」',
      muted?.toast,
    );

    const mutedMeterPeak = await ev(`(async () => {
  const read = (id) => parseFloat(document.getElementById(id).style.getPropertyValue('--v')) || 0;
  let maxIn = 0; let maxOut = 0;
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 50));
    maxIn = Math.max(maxIn, read('meter-in'));
    maxOut = Math.max(maxOut, read('meter-out'));
  }
  return { maxIn, maxOut };
})()`);
    c.add(
      '静音只作用于扬声器边：IN/OUT 电平表仍有信号（取自 analyser）',
      (mutedMeterPeak?.maxIn || 0) > 0 && (mutedMeterPeak?.maxOut || 0) > 0,
      { in: '> 0%', out: '> 0%' },
      {
        in: mutedMeterPeak?.maxIn,
        out: mutedMeterPeak?.maxOut,
        snapshotIn: muted?.monitor?.meterIn,
        snapshotOut: muted?.monitor?.meterOut,
      },
    );

    await click('rec-btn');
    const mutedRecStart = await waitState('recording', 4000);
    await sleep(1100);
    const mutedLive = await snap();
    await click('rec-btn');
    const pendingMuted = await waitState('pending', 6000);
    console.log(
      'muted-recording:',
      JSON.stringify({
        state: pendingMuted?.state,
        gain: mutedLive?.monitor?.gain,
        blob: pendingMuted?.blobSize,
        time: pendingMuted?.time,
      }),
    );
    c.add(
      '静音状态下录音 1 秒：正常进入 pending，monitorGain 全程为 0',
      mutedRecStart?.state === 'recording' &&
        mutedLive?.monitor?.gain < 0.01 &&
        pendingMuted?.monitor?.gain < 0.01 &&
        pendingMuted?.state === 'pending' &&
        (pendingMuted?.blobSize || 0) > 44,
      { state: 'pending', gain: '< 0.01', blob: '> 44' },
      {
        state: pendingMuted?.state,
        gain: [mutedLive?.monitor?.gain, pendingMuted?.monitor?.gain],
        blob: pendingMuted?.blobSize,
      },
    );

    const mutedSaveStart = Date.now();
    await click('rec-save');
    const savedMuted = await waitSavedWav();
    const afterMutedSave = await waitState('idle', 5000);
    let mutedInfo = null;
    let mutedRms = 0;
    if (savedMuted?.files?.length === 1) {
      mutedInfo = readWavFile(join(dl, savedMuted.files[0]));
      if (mutedInfo.ok) {
        const buf = readFileSync(join(dl, savedMuted.files[0]));
        let sum = 0;
        for (let i = 0; i < mutedInfo.samples; i++) {
          const v = buf.readInt16LE(mutedInfo.dataOffset + i * 2) / 32768;
          sum += v * v;
        }
        mutedRms = Math.sqrt(sum / Math.max(1, mutedInfo.samples));
      }
    }
    console.log(
      'muted-save:',
      JSON.stringify({
        file: savedMuted?.files?.[0],
        duration: mutedInfo?.ok ? mutedInfo.duration : mutedInfo?.error,
        rms: mutedRms,
        peak: mutedInfo?.peak,
        elapsed: (Date.now() - mutedSaveStart) / 1000,
        state: afterMutedSave?.state,
      }),
    );
    c.add(
      '静音状态下录音并保存：导出 WAV 有实际内容（RMS > 0，不是静音）',
      !!mutedInfo?.ok && mutedRms > 0.001 && mutedInfo.peak > 0.001,
      { rms: '> 0.001', peak: '> 0.001' },
      { rms: mutedRms, peak: mutedInfo?.peak, error: mutedInfo?.error },
    );
    c.add(
      '静音不影响录音时长：保存的 WAV > 0.5s 且保存后回到 idle',
      !!mutedInfo?.ok &&
        mutedInfo.duration > 0.5 &&
        afterMutedSave?.state === 'idle' &&
        afterMutedSave?.toast === 'Recording exported',
      { duration: '> 0.5s', state: 'idle', toast: 'Recording exported' },
      {
        duration: mutedInfo?.ok ? mutedInfo.duration : mutedInfo?.error,
        state: afterMutedSave?.state,
        toast: afterMutedSave?.toast,
      },
    );

    const monitorRestore = await ev(`(() => {
  const st = window.__belcanto;
  const b = document.getElementById('monitor');
  b.click();
  return { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), on: st.chain.isMonitorOn(),
    toast: document.getElementById('toast').textContent };
})()`);
    await sleep(250);
    const restored = await snap();
    c.add(
      '恢复监听：monitorGain 回到 1，按钮 🔊 监听 / aria-pressed=true',
      restored?.monitor?.gain > 0.99 &&
        restored?.monitor?.pressed === 'true' &&
        restored?.monitor?.text === '🔊 Monitor' &&
        restored?.monitor?.on === true,
      { gain: '> 0.99', text: '🔊 Monitor', pressed: 'true', on: true },
      {
        gain: restored?.monitor?.gain,
        text: restored?.monitor?.text,
        pressed: restored?.monitor?.pressed,
        on: restored?.monitor?.on,
      },
    );
    c.add(
      '恢复监听有提示且状态同步',
      monitorRestore?.toast === 'Monitoring on' && monitorRestore?.on === true,
      { toast: 'Monitoring on', on: true },
      { toast: monitorRestore?.toast, on: monitorRestore?.on },
    );
    rmSync(join(dl, savedMuted?.files?.[0] || 'x'), { force: true });

    await click('rec-btn');
    await waitState('recording', 4000);
    await sleep(1300);
    await click('rec-btn');
    const pending3 = await waitState('pending', 6000);
    const oldBlob = pending3?.blobSize || 0;
    await click('rec-btn');
    await sleep(150);
    const restart = await snap();
    console.log(
      'restart:',
      JSON.stringify({
        state: restart.state,
        toast: restart.toast,
        blobSize: restart.blobSize,
        log: restart.toastLog.slice(-3),
      }),
    );
    c.add(
      'pending 下再点「录制」：旧 take 被丢弃并提示（不静默覆盖）',
      restart.state === 'recording' &&
        restart.blobSize === 0 &&
        /Take discarded \(new take\)/.test(restart.toast),
      { state: 'recording', blob: 0, toast: 'Take discarded (new take)' },
      { state: restart.state, blob: restart.blobSize, toast: restart.toast },
    );
    c.add(
      '重新录制前旧 take 确实有内容（断言不是空 blob 碰巧通过）',
      oldBlob > 44,
      '> 44',
      oldBlob,
    );
    await sleep(900);
    await click('rec-btn');
    await waitState('pending', 6000);
    await click('rec-discard');
    await waitState('idle', 4000);
    c.add('重新录制并丢弃后依旧没有下载', wavFiles().length === 0, 0, wavFiles());

    await click('rec-btn');
    await waitState('recording', 4000);
    await sleep(1300);
    await click('rec-btn');
    await waitState('pending', 6000);
    await startToastLog();
    await click('source-file');
    await waitState('idle', 8000);
    await sleep(400);
    const switchedLate = await snap();
    console.log(
      'switch:',
      JSON.stringify({
        state: switchedLate.state,
        mode: switchedLate.mode,
        micOn: switchedLate.micOn,
        toastLog: switchedLate.toastLog.slice(-4),
        status: switchedLate.status,
      }),
    );
    c.add(
      'pending 下切换音源：自动丢弃、blob 释放、无下载',
      switchedLate?.state === 'idle' &&
        switchedLate?.blobSize === 0 &&
        switchedLate?.destTracks === null &&
        wavFiles().length === 0,
      { state: 'idle', blob: 0, dest: null, downloads: 0 },
      {
        state: switchedLate?.state,
        blob: switchedLate?.blobSize,
        dest: switchedLate?.destTracks,
        downloads: wavFiles(),
      },
    );
    c.add(
      'pending 下切到文件模式：麦克风关闭、MediaStream 释放',
      switchedLate?.mode === 'file' &&
        switchedLate?.micOn === false &&
        switchedLate?.micStream === false,
      { mode: 'file', micOn: false, stream: false },
      { mode: switchedLate?.mode, micOn: switchedLate?.micOn, stream: switchedLate?.micStream },
    );
    c.add(
      '切换音源丢弃时有提示（toast 日志含「已丢弃本次录音（切换音源）」）',
      (switchedLate?.toastLog || []).some((t) => t.includes('Take discarded (switching input)')),
      '含「已丢弃本次录音（切换音源）」',
      switchedLate?.toastLog,
    );
    await sleep(800);

    await ensureMicStarted();
    await click('rec-btn');
    await waitState('recording', 4000);
    await sleep(1600);
    await click('rec-btn');
    const pending4 = await waitState('pending', 6000);
    const unloadBlob = pending4?.blobSize || 0;
    await send('Page.reload');

    await sleep(800);
    for (let i = 0; i < 20; i++) {
      if ((await ev('!!window.__belcanto')) === true) break;
      await sleep(200);
    }
    await sleep(900);
    const reloadedLate = await snap();
    console.log(
      'reload:',
      JSON.stringify({
        state: reloadedLate?.state,
        toast: reloadedLate?.toast,
        blobSize: reloadedLate?.blobSize,
      }),
    );
    c.add(
      'pending 下页面卸载：重新加载后回到 idle、blob 未恢复、无下载',
      reloadedLate?.state === 'idle' && reloadedLate?.blobSize === 0 && wavFiles().length === 0,
      { state: 'idle', blob: 0, downloads: 0 },
      { state: reloadedLate?.state, blob: reloadedLate?.blobSize, downloads: wavFiles() },
    );
    c.add(
      '页面卸载丢弃后下次加载有提示（含「已丢弃」）',
      (reloadedLate?.toast || '').includes('discarded'),
      '含「已丢弃」',
      { toast: reloadedLate?.toast, shown: reloadedLate?.toastShown, unloadBlob },
    );

    const docFile = await send('DOM.getDocument');
    const inputFile = await send('DOM.querySelector', {
      nodeId: docFile.root.nodeId,
      selector: '#file-input',
    });
    await send('DOM.setFileInputFiles', {
      nodeId: inputFile.nodeId,
      files: [resolve('tools/test-vocal.wav')],
    });
    let fileSnap = null;
    for (let i = 0; i < 120; i++) {
      fileSnap = await snap();
      if (fileSnap?.mode === 'file' && (fileSnap?.status || '').startsWith('File · ')) break;
      await sleep(200);
    }
    console.log(
      'file-mode:',
      JSON.stringify({
        mode: fileSnap?.mode,
        status: fileSnap?.status,
        monitor: fileSnap?.monitor,
      }),
    );
    c.add(
      '文件模式：监听按钮仍在顶部可见且可用，默认状态保持「监听开」',
      fileSnap?.mode === 'file' &&
        fileSnap?.monitor?.visible === true &&
        fileSnap?.monitor?.disabled === false &&
        fileSnap?.monitor?.text === '🔊 Monitor' &&
        fileSnap?.monitor?.pressed === 'true' &&
        Math.abs((fileSnap?.monitor?.gain ?? 0) - 1) < 1e-6,
      {
        mode: 'file',
        visible: true,
        disabled: false,
        text: '🔊 Monitor',
        pressed: 'true',
        gain: 1,
      },
      { mode: fileSnap?.mode, monitor: fileSnap?.monitor },
    );

    await ev(`document.getElementById('play-btn').click()`);
    for (let i = 0; i < 30; i++) {
      if ((await ev(`!!(window.__belcanto && window.__belcanto.playing)`)) === true) break;
      await sleep(100);
    }
    await sleep(400);

    const fileMuteClick = await ev(`(() => {
  const st = window.__belcanto;
  const b = document.getElementById('monitor');
  b.click();
  const p = st.chain.audioParams.monitor;
  return { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'),
    on: st.chain.isMonitorOn(), before: p.value };
})()`);
    await sleep(300);
    const fileMuted = await snap();
    c.add(
      '文件模式：监听按钮同样生效（静音 → gain 趋近 0，OUT 表仍有信号）',
      fileMuteClick?.text === '🔇 Muted' &&
        fileMuteClick?.pressed === 'false' &&
        fileMuteClick?.on === false &&
        fileMuted?.monitor?.gain < 0.01 &&
        fileMuted?.monitor?.meterOut > 0,
      { text: '🔇 Muted', pressed: 'false', on: false, gain: '< 0.01', meterOut: '> 0%' },
      {
        text: fileMuteClick?.text,
        pressed: fileMuteClick?.pressed,
        on: fileMuteClick?.on,
        gain: fileMuted?.monitor?.gain,
        meterOut: fileMuted?.monitor?.meterOut,
      },
    );

    const fileBeforeMicSwitch = await ev(`(() => {
  const st = window.__belcanto;
  return { mode: st.mode, playing: st.playing, hasBuffer: !!st.fileBuffer,
    name: st.fileName, pos: st.filePosition(), duration: st.fileDuration() };
})()`);
    await click('source-mic');
    let backToMic = null;
    for (let i = 0; i < 100; i++) {
      backToMic = await snap();
      if (backToMic?.mode === 'mic' && backToMic?.status === 'Microphone mode · mic off') break;
      await sleep(200);
    }
    const fileAfterMicSwitch = await ev(`(() => {
  const st = window.__belcanto;
  return { mode: st.mode, playing: st.playing, hasBuffer: !!st.fileBuffer,
    name: st.fileName, pos: st.filePosition(), duration: st.fileDuration() };
})()`);
    const keptMuted = await snap();
    console.log(
      'mode-switch-monitor:',
      JSON.stringify({
        before: fileBeforeMicSwitch,
        after: fileAfterMicSwitch,
        mode: keptMuted?.mode,
        text: keptMuted?.monitor?.text,
        pressed: keptMuted?.monitor?.pressed,
        gain: keptMuted?.monitor?.gain,
        status: keptMuted?.status,
      }),
    );
    c.add(
      '文件播放中切到麦克风：停止播放，但文件仍在、播放头停在原位置',
      fileBeforeMicSwitch?.playing === true &&
        fileBeforeMicSwitch?.hasBuffer === true &&
        fileAfterMicSwitch?.mode === 'mic' &&
        fileAfterMicSwitch?.playing === false &&
        fileAfterMicSwitch?.hasBuffer === true &&
        fileAfterMicSwitch?.name === fileBeforeMicSwitch?.name &&
        Math.abs((fileAfterMicSwitch?.pos || 0) - (fileBeforeMicSwitch?.pos || 0)) <= 0.6,
      {
        before: { playing: true, pos: `≈ ${(fileBeforeMicSwitch?.pos || 0).toFixed(2)}s` },
        after: { playing: false, hasBuffer: true, pos: '同前' },
      },
      { before: fileBeforeMicSwitch, after: fileAfterMicSwitch },
    );
    c.add(
      '切到麦克风只进入模式：micOn=false、无 MediaStream、状态「麦克风模式 · 未开启」',
      keptMuted?.mode === 'mic' &&
        keptMuted?.micOn === false &&
        keptMuted?.micStream === false &&
        keptMuted?.status === 'Microphone mode · mic off',
      { mode: 'mic', micOn: false, stream: false, status: 'Microphone mode · mic off' },
      {
        mode: keptMuted?.mode,
        micOn: keptMuted?.micOn,
        stream: keptMuted?.micStream,
        status: keptMuted?.status,
      },
    );
    c.add(
      '切模式时监听状态保持：文件(静音) → 麦克风仍是「🔇 静音」、gain 仍为 0',
      backToMic?.mode === 'mic' &&
        keptMuted?.monitor?.text === '🔇 Muted' &&
        keptMuted?.monitor?.pressed === 'false' &&
        keptMuted?.monitor?.on === false &&
        keptMuted?.monitor?.gain < 0.01,
      { mode: 'mic', text: '🔇 Muted', pressed: 'false', on: false, gain: '< 0.01' },
      {
        mode: keptMuted?.mode,
        text: keptMuted?.monitor?.text,
        pressed: keptMuted?.monitor?.pressed,
        on: keptMuted?.monitor?.on,
        gain: keptMuted?.monitor?.gain,
      },
    );

    await click('monitor');
    await sleep(250);
    const finalMonitor = await snap();
    c.add(
      '切模式后仍可恢复监听：gain 回到 1、aria-pressed=true',
      finalMonitor?.monitor?.gain > 0.99 &&
        finalMonitor?.monitor?.pressed === 'true' &&
        finalMonitor?.monitor?.text === '🔊 Monitor',
      { gain: '> 0.99', text: '🔊 Monitor', pressed: 'true' },
      {
        gain: finalMonitor?.monitor?.gain,
        text: finalMonitor?.monitor?.text,
        pressed: finalMonitor?.monitor?.pressed,
      },
    );

    c.add('No unexpected page errors', errors.unexpected.length === 0, [], errors.unexpected);
    return c.report('REC_PASS', 'REC_FAIL') ? 0 : 1;
  },
);
