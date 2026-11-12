#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { readdirSync, existsSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createRunDirectory } from './run-directory.mjs';
import { readWavFile, describeWav, verifyExportedWav } from './wav-info.mjs';
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
const shotPath = process.argv[3] || join(dl, 'file.png');
const inputs = createRunDirectory({ prefix: 'belcanto-inputs-' });
const secondWav = join(inputs.path, 'second-vocal.wav');
try {
  copyFileSync(wav, secondWav);
  process.exitCode = await withBrowser(
    {
      flags: [
        '--window-size=1440,940',
        '--force-device-scale-factor=1',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
      commandTimeout: 30000,
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

      const doc = await send('DOM.getDocument');
      const node = await send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: '#file-input',
      });

      const readSnapshot = () =>
        ev(`(() => {
  const st = window.__belcanto;
  const tl = document.getElementById('timeline');
  const wave = document.getElementById('timeline-wave');
  return {
    status: document.getElementById('status-text').textContent,
    mode: st && st.mode,
    micOn: !!(st && st.micOn),
    micStream: !!(st && st.micStream),
    micNode: !!(st && st.micNode),
    fileName: document.getElementById('file-name').textContent,
    playing: !!(st && st.playing),
    hasBuffer: !!(st && st.fileBuffer),
    duration: st && st.fileBuffer ? st.fileBuffer.duration : 0,
    bufferLength: st && st.fileBuffer ? st.fileBuffer.length : 0,
    ctxSampleRate: st && st.ctx ? st.ctx.sampleRate : 0,
    pos: st && st.filePosition ? st.filePosition() : 0,
    loopOn: !!(st && st.loopOn),
    loopPressed: document.getElementById('loop-btn').getAttribute('aria-pressed'),
    srcLoop: st && st.fileNode ? !!st.fileNode.loop : null,
    playButton: document.getElementById('play-btn').textContent,
    time: document.getElementById('rec-time').textContent,
    fileTransport: !document.getElementById('transport-file').hidden,
    micTransport: !document.getElementById('transport-mic').hidden,
    timelineHidden: tl.hidden,
    timelineWidth: tl.getBoundingClientRect().width,
    waveWidth: wave.width,
    waveHeight: wave.height,
    peaksColumns: st && st.filePeaks ? st.filePeaks.columns : 0,
    headLeft: document.getElementById('timeline-head').style.left,
    bubbleHidden: document.getElementById('timeline-bubble').hidden,
    bubbleText: document.getElementById('timeline-bubble').textContent,
    meterIn: document.getElementById('meter-in').style.getPropertyValue('--v'),
    meterOut: document.getElementById('meter-out').style.getPropertyValue('--v'),
    note: document.getElementById('note-name').textContent,
    noteMeta: document.getElementById('note-meta').textContent
  };
})()`);

      const fmt = (sec) => {
        const s = Math.max(0, Math.round(sec));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      };

      const pointer = (type, ratio) =>
        ev(`(() => {
  const el = document.getElementById('timeline');
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('${type}', {
    bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: ${type === 'pointerdown' || type === 'pointermove' ? 1 : 0},
    clientX: r.left + r.width * ${ratio}, clientY: r.top + r.height / 2
  }));
  return { width: r.width, x: r.left + r.width * ${ratio} };
})()`);

      await ev(`document.getElementById('source-file').click()`);
      await sleep(250);
      const fileEmpty = await ev(`(() => {
  const st = window.__belcanto;
  const tl = document.getElementById('timeline');
  return {
    mode: st.mode, micOn: st.micOn, hasCtx: !!st.ctx, hasChain: !!st.chain,
    hasBuffer: !!st.fileBuffer, status: document.getElementById('status-text').textContent,
    playDisabled: document.getElementById('play-btn').disabled,
    loopDisabled: document.getElementById('loop-btn').disabled,
    exportDisabled: document.getElementById('export-btn').disabled,
    timelineHidden: tl.hidden, timelineDisabled: tl.getAttribute('aria-disabled'),
    timelineClass: tl.classList.contains('disabled'), timelineTabIndex: tl.tabIndex,
    chooseText: document.getElementById('choose-file').textContent.trim(),
    fileName: document.getElementById('file-name').textContent,
    headerFile: document.getElementById('source-file').getAttribute('aria-pressed'),
    headerMic: document.getElementById('source-mic').getAttribute('aria-pressed'),
    fileTransport: !document.getElementById('transport-file').hidden,
    micTransport: !document.getElementById('transport-mic').hidden
  };
})()`);
      console.log('file-mode-empty:', JSON.stringify(fileEmpty));
      c.add(
        '点「音频文件」只进入文件模式：不请求权限/不建 AudioContext、也未载入文件',
        fileEmpty?.mode === 'file' &&
          fileEmpty?.micOn === false &&
          fileEmpty?.hasCtx === false &&
          fileEmpty?.hasChain === false &&
          fileEmpty?.hasBuffer === false &&
          fileEmpty?.status === 'File mode · no file loaded',
        {
          mode: 'file',
          micOn: false,
          ctx: false,
          chain: false,
          hasBuffer: false,
          status: 'File mode · no file loaded',
        },
        fileEmpty,
      );
      c.add(
        '文件模式未载入：▶ / LOOP / 导出 / 时间轴全部禁用，选择文件按钮可用',
        fileEmpty?.playDisabled === true &&
          fileEmpty?.loopDisabled === true &&
          fileEmpty?.exportDisabled === true &&
          fileEmpty?.timelineHidden === false &&
          fileEmpty?.timelineDisabled === 'true' &&
          fileEmpty?.timelineClass === true &&
          fileEmpty?.timelineTabIndex === -1 &&
          fileEmpty?.chooseText === 'Choose file',
        { play: true, loop: true, export: true, timeline: 'disabled', choose: 'Choose file' },
        fileEmpty,
      );
      c.add(
        '文件模式未载入：顶栏文件高亮、麦克风不高亮、文件名占位、文件 transport 可见',
        fileEmpty?.headerFile === 'true' &&
          fileEmpty?.headerMic === 'false' &&
          fileEmpty?.fileName === '—' &&
          fileEmpty?.fileTransport === true &&
          fileEmpty?.micTransport === false,
        { file: 'true', mic: 'false', fileName: '—', fileTransport: true },
        fileEmpty,
      );

      await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [wav] });

      let loaded = null;
      for (let i = 0; i < 100; i++) {
        loaded = await readSnapshot();
        if (loaded?.hasBuffer && (loaded?.status || '').startsWith('File · ')) break;
        await sleep(200);
      }
      console.log('loaded:', JSON.stringify(loaded, null, 2));
      const loadedControls = await ev(`(() => ({
  mode: window.__belcanto.mode,
  playDisabled: document.getElementById('play-btn').disabled,
  loopDisabled: document.getElementById('loop-btn').disabled,
  exportDisabled: document.getElementById('export-btn').disabled,
  timelineDisabled: document.getElementById('timeline').getAttribute('aria-disabled'),
  timelineClass: document.getElementById('timeline').classList.contains('disabled'),
  timelineTabIndex: document.getElementById('timeline').tabIndex
}))()`);
      c.add(
        '载入文件后 ▶ / LOOP / 导出 / 时间轴恢复可用',
        loadedControls?.mode === 'file' &&
          loadedControls?.playDisabled === false &&
          loadedControls?.loopDisabled === false &&
          loadedControls?.exportDisabled === false &&
          loadedControls?.timelineDisabled === 'false' &&
          loadedControls?.timelineClass === false &&
          loadedControls?.timelineTabIndex === 0,
        { play: false, loop: false, export: false, timelineDisabled: 'false', tabIndex: 0 },
        loadedControls,
      );
      c.add(
        '导入后 playing === false（不再自动播放）',
        loaded?.playing === false,
        false,
        loaded?.playing,
      );
      c.add(
        '导入后播放头停在 0（≤0.05s）',
        Math.abs(loaded?.pos || 0) <= 0.05,
        '≈ 0s',
        loaded?.pos,
      );
      c.add('导入后播放按钮显示 ▶', loaded?.playButton === '▶', '▶', loaded?.playButton);
      await sleep(500);
      const idle = await readSnapshot();
      console.log(
        'idle-after-500ms:',
        JSON.stringify({ playing: idle?.playing, pos: idle?.pos, button: idle?.playButton }),
      );
      c.add(
        '500ms 后仍没有自动播放（位置仍 ≈0 且 playing=false）',
        idle?.playing === false && Math.abs(idle?.pos || 0) <= 0.05,
        { playing: false, pos: '≈ 0s' },
        { playing: idle?.playing, pos: idle?.pos },
      );

      c.add('文件名显示正确', loaded?.fileName === basename(wav), basename(wav), loaded?.fileName);
      c.add(
        '状态文本进入文件播放模式',
        (loaded?.status || '').startsWith('File · '),
        `File · ${basename(wav)}`,
        loaded?.status,
      );
      c.add(
        'transport 切到文件模式',
        loaded?.fileTransport === true && loaded?.micTransport === false,
        { file: true, mic: false },
        { file: loaded?.fileTransport, mic: loaded?.micTransport },
      );
      c.add(
        '页面解码时长 = 源 WAV 头时长（±0.1s）',
        Math.abs((loaded?.duration || 0) - src.duration) <= 0.1,
        `${src.duration.toFixed(3)}s ±0.1s`,
        `${(loaded?.duration || 0).toFixed(3)}s`,
      );
      c.add(
        '文件模式显示 当前时间 / 总时长，且没有旧 LOOP 后缀',
        loaded?.time === `0:00 / ${fmt(src.duration)}` && !/LOOP/.test(loaded?.time || ''),
        `0:00 / ${fmt(src.duration)}`,
        loaded?.time,
      );

      c.add(
        '循环按钮默认关闭：aria-pressed=false',
        loaded?.loopPressed === 'false',
        'false',
        loaded?.loopPressed,
      );
      c.add(
        '循环状态默认关闭：state.loopOn === false',
        loaded?.loopOn === false,
        false,
        loaded?.loopOn,
      );

      c.add(
        '文件模式时间轴可见且已画出波形',
        loaded?.timelineHidden === false &&
          (loaded?.timelineWidth || 0) > 100 &&
          (loaded?.waveWidth || 0) > 0 &&
          (loaded?.peaksColumns || 0) > 0,
        { visible: true, width: '> 100px', waveWidth: '> 0', peaksColumns: '> 0' },
        {
          visible: !loaded?.timelineHidden,
          width: loaded?.timelineWidth,
          waveWidth: loaded?.waveWidth,
          peaksColumns: loaded?.peaksColumns,
        },
      );
      c.add(
        '播放头初始在最左（left ≈ 0%）',
        Math.abs(parseFloat(loaded?.headLeft || '0')) <= 0.01,
        '≈ 0%',
        loaded?.headLeft,
      );

      await ev(`document.getElementById('play-btn').click()`);
      await sleep(900);
      const playA = await readSnapshot();
      await sleep(1000);
      const playB = await readSnapshot();
      console.log(
        'play:',
        JSON.stringify({
          a: playA?.pos,
          b: playB?.pos,
          playing: playB?.playing,
          srcLoop: playB?.srcLoop,
        }),
      );

      c.add(
        '文件已解码并可播放（点 ▶ 后 playing === true）',
        playB?.hasBuffer === true && playB?.playing === true,
        { hasBuffer: true, playing: true },
        { hasBuffer: playB?.hasBuffer, playing: playB?.playing },
      );
      c.add(
        '点播放后播放头随时间推进（1 秒前进 ≈1s，±0.3s）',
        playB?.playing === true && Math.abs((playB?.pos || 0) - (playA?.pos || 0) - 1) <= 0.3,
        'Δ ≈ 1s ±0.3s',
        { from: playA?.pos, to: playB?.pos, delta: (playB?.pos || 0) - (playA?.pos || 0) },
      );
      c.add(
        '循环关时 AudioBufferSourceNode.loop === false',
        playB?.loopOn === false && playB?.srcLoop === false,
        { loopOn: false, srcLoop: false },
        { loopOn: playB?.loopOn, srcLoop: playB?.srcLoop },
      );
      c.add('播放中按钮变为 ⏸', playB?.playButton === '⏸', '⏸', playB?.playButton);

      let tonal = playB;
      for (let i = 0; i < 12; i++) {
        if (
          tonal?.note !== '–' &&
          /Hz/.test(tonal?.noteMeta || '') &&
          parseFloat(tonal?.meterOut) > 0
        )
          break;
        await sleep(150);
        tonal = await readSnapshot();
      }
      c.add(
        '音高识别出有效音名',
        /^[A-G]#?\d+$/.test(tonal?.note || ''),
        'A–G# + 八度',
        tonal?.note,
      );
      c.add('音高读数包含 Hz', /Hz/.test(tonal?.noteMeta || ''), '含 "Hz"', tonal?.noteMeta);
      c.add(
        '输入/输出电平都大于 0',
        parseFloat(tonal?.meterIn) > 0 && parseFloat(tonal?.meterOut) > 0,
        { in: '> 0%', out: '> 0%' },
        { in: tonal?.meterIn, out: tonal?.meterOut },
      );

      await ev(`document.getElementById('play-btn').click()`);
      await sleep(120);
      const paused = await readSnapshot();
      c.add(
        '再点一次暂停：播放头停在原处、按钮回到 ▶',
        paused?.playing === false &&
          paused?.playButton === '▶' &&
          Math.abs((paused?.pos || 0) - (tonal?.pos || 0)) <= 0.3,
        { playing: false, button: '▶', pos: `≈ ${(tonal?.pos || 0).toFixed(2)}s` },
        { playing: paused?.playing, button: paused?.playButton, pos: paused?.pos },
      );

      await pointer('pointerdown', 0.5);
      await pointer('pointerup', 0.5);
      await sleep(120);
      const clickHalf = await readSnapshot();
      console.log(
        'click-50%:',
        JSON.stringify({ pos: clickHalf?.pos, time: clickHalf?.time, name: clickHalf?.fileName }),
      );
      c.add(
        '点击时间轴 50% → 位置 ≈ 总时长/2（±0.3s）',
        Math.abs((clickHalf?.pos || 0) - src.duration * 0.5) <= 0.3,
        `${(src.duration * 0.5).toFixed(2)}s ±0.3s`,
        `${(clickHalf?.pos || 0).toFixed(2)}s`,
      );
      const expectedClickTime = `${fmt(clickHalf?.pos)} / ${fmt(loaded?.duration)}`;
      c.add(
        '点击定位后时间显示同步为 当前时间 / 总时长',
        Number.isFinite(clickHalf?.pos) &&
          Number.isFinite(loaded?.duration) &&
          clickHalf?.time === expectedClickTime,
        expectedClickTime,
        clickHalf?.time,
      );
      c.add(
        '点击定位后文件名保持同步',
        clickHalf?.fileName === basename(wav),
        basename(wav),
        clickHalf?.fileName,
      );
      c.add(
        '原本暂停时点击时间轴不会自动开播',
        clickHalf?.playing === false,
        false,
        clickHalf?.playing,
      );

      await pointer('pointerdown', 0.2);
      await sleep(40);
      await pointer('pointermove', 0.8);
      await sleep(80);
      const dragMid = await readSnapshot();
      await pointer('pointerup', 0.8);
      await sleep(100);
      const dragEnd = await readSnapshot();
      console.log(
        'drag-80%:',
        JSON.stringify({
          mid: dragMid?.pos,
          bubble: dragMid?.bubbleText,
          bubbleHidden: dragMid?.bubbleHidden,
          end: dragEnd?.pos,
          playing: dragEnd?.playing,
        }),
      );
      c.add(
        '拖动到 80% → 位置 ≈ 0.8×总时长（±0.3s）',
        Math.abs((dragEnd?.pos || 0) - src.duration * 0.8) <= 0.3,
        `${(src.duration * 0.8).toFixed(2)}s ±0.3s`,
        `${(dragEnd?.pos || 0).toFixed(2)}s`,
      );
      c.add(
        '拖动时显示时间气泡，文本跟随拖动位置',
        dragMid?.bubbleHidden === false && dragMid?.bubbleText === fmt(src.duration * 0.8),
        { visible: true, text: fmt(src.duration * 0.8) },
        { visible: !dragMid?.bubbleHidden, text: dragMid?.bubbleText },
      );
      c.add('拖动松手后气泡收起', dragEnd?.bubbleHidden === true, true, dragEnd?.bubbleHidden);

      await ev(`window.__belcanto.seekFile(1)`);
      await ev(`document.getElementById('play-btn').click()`);
      await sleep(400);
      const beforeDrag = await readSnapshot();
      await pointer('pointerdown', 0.2);
      await sleep(40);
      await pointer('pointermove', 0.6);
      await sleep(60);
      const freezingA = await readSnapshot();
      await sleep(250);
      const freezingB = await readSnapshot();
      await pointer('pointerup', 0.6);
      await sleep(150);
      const resumed = await readSnapshot();
      console.log(
        'drag-while-playing:',
        JSON.stringify({
          before: beforeDrag?.playing,
          freezeA: freezingA?.pos,
          freezeB: freezingB?.pos,
          resumedPlaying: resumed?.playing,
          resumedPos: resumed?.pos,
        }),
      );
      c.add(
        '拖动过程中播放头不推进（暂停在拖动位置）',
        freezingA?.playing === false &&
          Math.abs((freezingB?.pos || 0) - (freezingA?.pos || 0)) <= 0.05 &&
          Math.abs((freezingA?.pos || 0) - src.duration * 0.6) <= 0.3,
        { playing: false, delta: '≤ 0.05s', pos: `${(src.duration * 0.6).toFixed(2)}s ±0.3s` },
        {
          playing: freezingA?.playing,
          delta: (freezingB?.pos || 0) - (freezingA?.pos || 0),
          pos: freezingA?.pos,
        },
      );
      c.add(
        '拖动前在播放 → 松手后从新位置继续播放',
        resumed?.playing === true && (resumed?.pos || 0) >= src.duration * 0.6 - 0.3,
        { playing: true, pos: `≥ ${(src.duration * 0.6 - 0.3).toFixed(2)}s` },
        { playing: resumed?.playing, pos: resumed?.pos },
      );
      await ev(`document.getElementById('play-btn').click()`);
      await sleep(120);

      const nearEnd = (src.duration - 0.3) / src.duration;
      await pointer('pointerdown', nearEnd);
      await pointer('pointerup', nearEnd);
      await sleep(100);
      const nearEndSnap = await readSnapshot();
      c.add(
        '循环关：可定位到末尾前 0.3s',
        Math.abs((nearEndSnap?.pos || 0) - (src.duration - 0.3)) <= 0.3,
        `${(src.duration - 0.3).toFixed(2)}s ±0.3s`,
        `${(nearEndSnap?.pos || 0).toFixed(2)}s`,
      );
      await ev(`document.getElementById('play-btn').click()`);
      await sleep(1200);
      const ended = await readSnapshot();
      console.log(
        'loop-off-end:',
        JSON.stringify({
          playing: ended?.playing,
          pos: ended?.pos,
          button: ended?.playButton,
          time: ended?.time,
        }),
      );
      c.add(
        '循环关：播到末尾自动停止、播放头回到 0、按钮回 ▶',
        ended?.playing === false &&
          Math.abs(ended?.pos || 0) <= 0.05 &&
          ended?.playButton === '▶' &&
          ended?.time === `0:00 / ${fmt(src.duration)}`,
        { playing: false, pos: 0, button: '▶', time: `0:00 / ${fmt(src.duration)}` },
        { playing: ended?.playing, pos: ended?.pos, button: ended?.playButton, time: ended?.time },
      );

      await ev(`document.getElementById('loop-btn').click()`);
      await sleep(80);
      const loopArmed = await readSnapshot();
      c.add(
        '循环开关可独立打开：aria-pressed=true / state.loopOn=true',
        loopArmed?.loopPressed === 'true' && loopArmed?.loopOn === true,
        { pressed: 'true', loopOn: true },
        { pressed: loopArmed?.loopPressed, loopOn: loopArmed?.loopOn },
      );
      await pointer('pointerdown', nearEnd);
      await pointer('pointerup', nearEnd);
      await sleep(80);
      await ev(`document.getElementById('play-btn').click()`);
      await sleep(1200);
      const wrapped = await readSnapshot();
      console.log(
        'loop-on-end:',
        JSON.stringify({
          playing: wrapped?.playing,
          pos: wrapped?.pos,
          srcLoop: wrapped?.srcLoop,
          time: wrapped?.time,
        }),
      );
      c.add(
        '循环开：AudioBufferSourceNode.loop === true',
        wrapped?.srcLoop === true,
        true,
        wrapped?.srcLoop,
      );
      c.add(
        '循环开：播到末尾回绕到开头附近且仍在播放',
        wrapped?.playing === true && (wrapped?.pos || 0) >= 0 && (wrapped?.pos || 0) < 1.5,
        { playing: true, pos: '0–1.5s' },
        { playing: wrapped?.playing, pos: wrapped?.pos },
      );
      c.add(
        '循环开：时间显示跟随回绕后的位置',
        wrapped?.time === `${fmt(wrapped?.pos || 0)} / ${fmt(src.duration)}`,
        `${fmt(wrapped?.pos || 0)} / ${fmt(src.duration)}`,
        wrapped?.time,
      );

      await pointer('pointerdown', 0.8);
      await pointer('pointerup', 0.8);
      await sleep(120);
      const beforeExport = await readSnapshot();
      console.log(
        'before export:',
        JSON.stringify({
          status: beforeExport?.status,
          pos: beforeExport?.pos,
          loopOn: beforeExport?.loopOn,
          playing: beforeExport?.playing,
        }),
      );
      const exportStart = Date.now();
      await ev(`document.getElementById('export-btn').click()`);

      let status = '';
      let files = [];
      let settled = false;
      const deadline = Date.now() + 90000;
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
      console.log('status:', status);
      console.log('downloaded:', files, settled ? '(stable)' : '(not stable)');

      c.add('导出状态为「导出完成」', status === 'Export complete', 'Export complete', status);
      c.add('下载目录只有本次 1 个 .wav', files.length === 1, 1, files);
      c.add('下载已写完（无 .crdownload、大小稳定）', settled === true, true, settled);

      let info = null;
      if (files.length >= 1) {
        const exportPath = join(dl, files[0]);
        const st = statSync(exportPath);
        info = readWavFile(exportPath);
        console.log('export:', describeWav(info));
        const expectedName = basename(wav).replace(/\.[^.]+$/, '') + '-belcanto.wav';
        c.add('下载文件名由源文件派生', files[0] === expectedName, expectedName, files[0]);
        c.add(
          '下载文件是导出开始后新建/写入的',
          st.mtimeMs >= exportStart - 2000,
          `mtime ≥ ${new Date(exportStart).toISOString()}`,
          new Date(st.mtimeMs).toISOString(),
        );
        c.addAll(
          verifyExportedWav(info, {
            sourceDuration: beforeExport?.duration,
            sampleRate: beforeExport?.ctxSampleRate,
            bufferLength: beforeExport?.bufferLength,
          }),
        );
        c.add(
          '导出的是整段：播放头在 80% 且循环开也不影响产物范围',
          info.ok &&
            Math.abs((info.duration || 0) - (src.duration + 3)) <= 0.2 &&
            (beforeExport?.pos || 0) >= src.duration * 0.7,
          {
            duration: `${(src.duration + 3).toFixed(2)}s`,
            playhead: `≥ ${(src.duration * 0.7).toFixed(2)}s`,
          },
          { duration: info.ok ? info.duration : info.error, playhead: beforeExport?.pos },
        );
      } else {
        c.add('找到可解析的导出 WAV', false, '1 个 .wav', files);
      }

      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
      console.log('screenshot:', shotPath);

      await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [secondWav] });
      let switched = null;
      for (let i = 0; i < 100; i++) {
        switched = await readSnapshot();
        if (
          switched?.hasBuffer &&
          switched?.fileName === basename(secondWav) &&
          (switched?.status || '').startsWith('File · ')
        )
          break;
        await sleep(200);
      }
      console.log(
        'switch-file:',
        JSON.stringify({
          name: switched?.fileName,
          loopOn: switched?.loopOn,
          pressed: switched?.loopPressed,
          playing: switched?.playing,
          pos: switched?.pos,
        }),
      );
      c.add(
        '切换文件时循环开关状态保留（仍为开）',
        switched?.fileName === basename(secondWav) &&
          switched?.loopOn === true &&
          switched?.loopPressed === 'true',
        { name: basename(secondWav), loopOn: true, pressed: 'true' },
        { name: switched?.fileName, loopOn: switched?.loopOn, pressed: switched?.loopPressed },
      );
      c.add(
        '切换文件后同样不自动播放（位置 0、按钮 ▶）',
        switched?.playing === false &&
          Math.abs(switched?.pos || 0) <= 0.05 &&
          switched?.playButton === '▶',
        { playing: false, pos: 0, button: '▶' },
        { playing: switched?.playing, pos: switched?.pos, button: switched?.playButton },
      );

      await ev(`window.__belcanto.seekFile(1)`);
      await ev(`document.getElementById('play-btn').click()`);
      let playingBeforeSwitch = null;
      for (let i = 0; i < 40; i++) {
        playingBeforeSwitch = await readSnapshot();
        if (playingBeforeSwitch?.playing === true && (playingBeforeSwitch?.pos || 0) > 1.1) break;
        await sleep(100);
      }
      await ev(`document.getElementById('source-mic').click()`);
      let afterMicSwitch = null;
      for (let i = 0; i < 60; i++) {
        afterMicSwitch = await readSnapshot();
        if (afterMicSwitch?.mode === 'mic' && afterMicSwitch?.micTransport === true) break;
        await sleep(100);
      }
      console.log(
        'file-playing-to-mic:',
        JSON.stringify({
          before: { playing: playingBeforeSwitch?.playing, pos: playingBeforeSwitch?.pos },
          after: {
            playing: afterMicSwitch?.playing,
            pos: afterMicSwitch?.pos,
            hasBuffer: afterMicSwitch?.hasBuffer,
            name: afterMicSwitch?.fileName,
            status: afterMicSwitch?.status,
          },
        }),
      );
      c.add(
        '文件播放中切到麦克风：停止播放（playing=false）',
        playingBeforeSwitch?.playing === true && afterMicSwitch?.playing === false,
        { before: true, after: false },
        { before: playingBeforeSwitch?.playing, after: afterMicSwitch?.playing },
      );
      c.add(
        '文件播放中切到麦克风：已载入文件保留，播放头停在切换位置、不自动续播',
        afterMicSwitch?.hasBuffer === true &&
          afterMicSwitch?.fileName === basename(secondWav) &&
          Math.abs((afterMicSwitch?.pos || 0) - (playingBeforeSwitch?.pos || 0)) <= 0.6,
        {
          hasBuffer: true,
          name: basename(secondWav),
          pos: `≈ ${(playingBeforeSwitch?.pos || 0).toFixed(2)}s`,
        },
        {
          hasBuffer: afterMicSwitch?.hasBuffer,
          name: afterMicSwitch?.fileName,
          pos: afterMicSwitch?.pos,
        },
      );
      c.add(
        '切到麦克风只进入模式：micOn=false、无 MediaStream、状态「麦克风模式 · 未开启」',
        afterMicSwitch?.mode === 'mic' &&
          afterMicSwitch?.micOn === false &&
          afterMicSwitch?.micStream === false &&
          afterMicSwitch?.status === 'Microphone mode · mic off',
        { mode: 'mic', micOn: false, stream: false, status: 'Microphone mode · mic off' },
        {
          mode: afterMicSwitch?.mode,
          micOn: afterMicSwitch?.micOn,
          stream: afterMicSwitch?.micStream,
          status: afterMicSwitch?.status,
        },
      );

      await ev(`document.getElementById('source-file').click()`);
      let backToFile = null;
      for (let i = 0; i < 60; i++) {
        backToFile = await readSnapshot();
        if (backToFile?.mode === 'file' && backToFile?.fileTransport === true) break;
        await sleep(100);
      }
      const backToFileControls = await ev(`(() => ({
  playDisabled: document.getElementById('play-btn').disabled,
  loopDisabled: document.getElementById('loop-btn').disabled,
  exportDisabled: document.getElementById('export-btn').disabled,
  timelineDisabled: document.getElementById('timeline').getAttribute('aria-disabled')
}))()`);
      console.log(
        'back-to-file:',
        JSON.stringify({
          mode: backToFile?.mode,
          playing: backToFile?.playing,
          pos: backToFile?.pos,
          name: backToFile?.fileName,
          controls: backToFileControls,
        }),
      );
      c.add(
        '切回文件模式：已载入文件仍在、停在原位置、不自动播放',
        backToFile?.mode === 'file' &&
          backToFile?.hasBuffer === true &&
          backToFile?.fileName === basename(secondWav) &&
          backToFile?.playing === false &&
          Math.abs((backToFile?.pos || 0) - (afterMicSwitch?.pos || 0)) <= 0.2,
        { mode: 'file', playing: false, pos: `≈ ${(afterMicSwitch?.pos || 0).toFixed(2)}s` },
        { mode: backToFile?.mode, playing: backToFile?.playing, pos: backToFile?.pos },
      );
      c.add(
        '切回文件模式：▶ / LOOP / 导出 / 时间轴重新可用',
        backToFileControls?.playDisabled === false &&
          backToFileControls?.loopDisabled === false &&
          backToFileControls?.exportDisabled === false &&
          backToFileControls?.timelineDisabled === 'false',
        { play: false, loop: false, export: false, timelineDisabled: false },
        backToFileControls,
      );

      await ev(`document.getElementById('source-mic').click()`);
      let mic = null;
      for (let i = 0; i < 60; i++) {
        mic = await readSnapshot();
        if (mic?.mode === 'mic' && mic?.micTransport === true) break;
        await sleep(200);
      }
      console.log(
        'mic-mode:',
        JSON.stringify({
          mode: mic?.mode,
          timelineHidden: mic?.timelineHidden,
          fileTransport: mic?.fileTransport,
          micTransport: mic?.micTransport,
        }),
      );
      c.add(
        '麦克风模式时间轴不可见',
        mic?.mode === 'mic' && mic?.timelineHidden === true,
        { mode: 'mic', hidden: true },
        { mode: mic?.mode, hidden: mic?.timelineHidden },
      );
      c.add(
        '麦克风模式文件 transport（含播放/循环）隐藏',
        mic?.micTransport === true && mic?.fileTransport === false,
        { mic: true, file: false },
        { mic: mic?.micTransport, file: mic?.fileTransport },
      );

      await ev(`document.getElementById('mic-toggle').click()`);
      let micStarted = null;
      for (let i = 0; i < 80; i++) {
        micStarted = await readSnapshot();
        if (micStarted?.micOn === true && micStarted?.micStream === true) break;
        await sleep(100);
      }
      console.log(
        'mic-started:',
        JSON.stringify({
          micOn: micStarted?.micOn,
          stream: micStarted?.micStream,
          status: micStarted?.status,
        }),
      );
      await ev(`document.getElementById('source-file').click()`);
      let micClosed = null;
      for (let i = 0; i < 60; i++) {
        micClosed = await readSnapshot();
        if (micClosed?.mode === 'file' && micClosed?.micOn === false) break;
        await sleep(100);
      }
      console.log(
        'mic-to-file:',
        JSON.stringify({
          mode: micClosed?.mode,
          micOn: micClosed?.micOn,
          stream: micClosed?.micStream,
          node: micClosed?.micNode,
          hasBuffer: micClosed?.hasBuffer,
          name: micClosed?.fileName,
          playing: micClosed?.playing,
          status: micClosed?.status,
        }),
      );
      c.add(
        '麦克风运行中切到文件模式：麦克风关闭、MediaStream/输入节点释放',
        micStarted?.micOn === true &&
          micStarted?.micStream === true &&
          micClosed?.mode === 'file' &&
          micClosed?.micOn === false &&
          micClosed?.micStream === false &&
          micClosed?.micNode === false,
        {
          before: { micOn: true, stream: true },
          after: { micOn: false, stream: false, node: false },
        },
        {
          before: { micOn: micStarted?.micOn, stream: micStarted?.micStream },
          after: {
            micOn: micClosed?.micOn,
            stream: micClosed?.micStream,
            node: micClosed?.micNode,
          },
        },
      );
      c.add(
        '麦克风切到文件模式：已载入文件仍保留、未播放、状态回到文件已载入',
        micClosed?.hasBuffer === true &&
          micClosed?.fileName === basename(secondWav) &&
          micClosed?.playing === false &&
          (micClosed?.status || '').startsWith('File · '),
        {
          hasBuffer: true,
          name: basename(secondWav),
          playing: false,
          status: `File · ${basename(secondWav)}`,
        },
        {
          hasBuffer: micClosed?.hasBuffer,
          name: micClosed?.fileName,
          playing: micClosed?.playing,
          status: micClosed?.status,
        },
      );

      c.add('No unexpected page errors', errors.unexpected.length === 0, [], errors.unexpected);
      return c.report('FILE_PASS', 'FILE_FAIL') ? 0 : 1;
    },
  );
} finally {
  inputs.cleanup();
}
