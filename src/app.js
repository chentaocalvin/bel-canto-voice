import { createVoiceChain } from './audio/chain.js';
import { PARAMS, PANELS, PRESETS, DEFAULT_PRESET, defaultValues } from './ui/params.js';
import { Knob } from './ui/knob.js';
import { Scope } from './ui/scope.js';
import { CUSTOM_PRESET_LABEL, msg, presetName } from './strings.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const CUSTOM = '__custom__';

const state = {
  ctx: null,
  chain: null,
  scope: null,
  ready: null,
  values: defaultValues(),
  knobs: {},
  preset: DEFAULT_PRESET,
  bypass: false,

  monitorOn: true,

  mode: 'none',
  micOn: false,

  micStarting: false,
  micStream: null,
  micNode: null,
  fileBuffer: null,
  fileName: '',
  fileNode: null,
  playing: false,

  fileTime: 0,
  fileStartCtx: null,
  fileStartPos: 0,
  filePlayGen: 0,
  filePeaks: null,
  transportRaf: 0,

  loopOn: false,

  rec: {
    state: 'idle',
    recorder: null,
    dest: null,
    chunks: [],
    mimeType: '',
    blob: null,
    recordedMs: 0,
    segmentStart: 0,
    elapsed: 0,
    timer: null,
    saving: false,
    gen: 0,
  },
  exporting: false,

  exportProgress: { value: 0, history: [], slices: 0 },

  recSaveProgress: { value: 0, history: [], phases: [], phase: 'idle', failed: false },
  meterVals: { in: 0, out: 0 },
  meterPeaks: { in: 0, out: 0 },
  slot: 'A',
  slots: null,
  scopeMode: 'split',
  note: '',
};

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function setStatus(text, kind = '') {
  $('status-text').textContent = text;
  const dot = $('status-dot');
  dot.className = 'dot' + (kind ? ' ' + kind : '');
}

function bootError(msg) {
  $('boot-err').textContent = msg || '';
}

function buildPanels() {
  const host = $('panels');
  for (const panel of PANELS) {
    const section = document.createElement('section');
    section.className = 'panel';
    const head = document.createElement('div');
    head.className = 'panel-head';
    const idx = String(PANELS.indexOf(panel) + 1).padStart(2, '0');
    head.innerHTML = `<h2>${panel.title}</h2><em class="panel-index">${idx}</em>`;
    section.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'knobs';
    for (const id of panel.params) {
      const def = PARAMS[id];
      const knob = new Knob(id, def, state.values[id], onKnobChange);
      state.knobs[id] = knob;
      grid.appendChild(knob.el);
    }
    section.appendChild(grid);

    if (panel.id === 'voice') {
      const row = document.createElement('div');
      row.className = 'switch-row';
      row.innerHTML = `
        <span class="switch-label">PRESERVE</span>
        <button class="switch" id="preserve" role="switch" aria-checked="true"
          aria-label="Preserve formants"><i></i></button>`;
      section.appendChild(row);
    }

    host.appendChild(section);
  }
}

function buildPresets() {
  const sel = $('preset');
  for (const name of Object.keys(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = presetName(name);
    sel.appendChild(opt);
  }
  const custom = document.createElement('option');
  custom.value = CUSTOM;
  custom.textContent = CUSTOM_PRESET_LABEL;
  sel.appendChild(custom);
  sel.value = DEFAULT_PRESET;
  sel.addEventListener('change', () => {
    if (sel.value === CUSTOM) return;
    applyPreset(sel.value);
  });
}

function onKnobChange(id, value) {
  state.values[id] = value;
  markSlot();
  state.chain?.update({ [id]: value });
  if (state.preset !== CUSTOM) {
    state.preset = CUSTOM;
    $('preset').value = CUSTOM;
  }
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  state.preset = name;
  $('preset').value = name;
  for (const [id, v] of Object.entries(preset)) {
    if (id === 'preserve') {
      state.values.preserve = !!v;
      updatePreserveSwitch();
      continue;
    }
    state.values[id] = v;
    state.knobs[id]?.setValue(v, true);
  }
  markSlot();

  state.chain?.update(state.values, { smooth: true });
  toast(msg('toast.preset', { name: presetName(name) }));
}

function resetToDefaults() {
  const defaults = defaultValues();
  for (const [id, v] of Object.entries(defaults)) {
    if (id === 'preserve') {
      state.values.preserve = !!v;
      updatePreserveSwitch();
      continue;
    }
    state.values[id] = v;
    state.knobs[id]?.setValue(v, true);
  }

  state.preset = CUSTOM;
  $('preset').value = CUSTOM;
  markSlot();

  state.chain?.update(state.values, { smooth: true });
  toast(msg('toast.defaultsReset'));
}

function markSlot() {
  if (state.slots) state.slots[state.slot] = { ...state.values };
}

function updateSlotUI() {
  document.querySelectorAll('.ab-btn').forEach((b) => {
    const on = b.dataset.slot === state.slot;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function matchesPreset(name) {
  const p = PRESETS[name];
  if (!p) return false;
  return Object.entries(p).every(([k, v]) =>
    k === 'preserve' ? !!state.values.preserve === !!v : Math.abs(state.values[k] - v) < 0.005,
  );
}

function switchSlot(slot) {
  if (slot === state.slot || !state.slots || !state.slots[slot]) return;
  state.slots[state.slot] = { ...state.values };
  state.slot = slot;
  const next = state.slots[slot];
  Object.assign(state.values, next);
  for (const [id, v] of Object.entries(next)) {
    if (id === 'preserve') {
      updatePreserveSwitch();
      continue;
    }
    state.knobs[id]?.setValue(v, true);
  }
  state.chain?.update(state.values);
  const matchedPreset = Object.keys(PRESETS).find(matchesPreset);
  state.preset = matchedPreset || CUSTOM;
  $('preset').value = state.preset;
  updateSlotUI();
  toast(msg('toast.ab', { slot }));
}

function updatePreserveSwitch() {
  const btn = $('preserve');
  if (btn) btn.setAttribute('aria-checked', String(!!state.values.preserve));
}

function updateMonitorUI() {
  const btn = $('monitor');
  if (!btn) return;
  btn.textContent = msg(state.monitorOn ? 'app.monitorOn' : 'app.monitorOff');
  btn.setAttribute('aria-pressed', String(state.monitorOn));
  btn.setAttribute('title', msg(state.monitorOn ? 'app.monitorTitleOn' : 'app.monitorTitleOff'));
}

function setMonitor(on) {
  state.monitorOn = !!on;
  updateMonitorUI();
  state.chain?.setMonitor(state.monitorOn);
  toast(msg(state.monitorOn ? 'toast.monitorOn' : 'toast.monitorOff'));
}

async function ensureAudio() {
  if (state.ready) return state.ready;
  state.ready = (async () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error(msg('error.webAudio'));
    const ctx = new Ctx({ latencyHint: 'interactive' });
    if (!ctx.audioWorklet) throw new Error(msg('error.audioWorklet'));
    const chain = await createVoiceChain(ctx, state.values);
    state.ctx = ctx;
    state.chain = chain;

    chain.setMonitor(state.monitorOn);
    state.scope = new Scope($('scope'), {
      outAnalyser: chain.outAnalyser,
      inAnalyser: chain.inAnalyser,
    });
    state.scope.setMode(state.scopeMode || 'split');
    state.scope.start();
    updateLatency();
    startMeters();
    setInterval(updatePitch, 150);
    return chain;
  })();
  try {
    await state.ready;
  } catch (e) {
    state.ready = null;
    throw e;
  }
  if (state.ctx.state !== 'running') await state.ctx.resume();
}

function updateLatency() {
  if (!state.ctx) return;
  const base = state.ctx.baseLatency || 0;
  const dsp = (state.chain?.latencySamples || 2048) / state.ctx.sampleRate;
  const total = (base + dsp) * 1000;
  $('latency').textContent = msg('status.latency', {
    ms: total.toFixed(0),
    khz: (state.ctx.sampleRate / 1000).toFixed(1),
  });
}

function hideBoot() {
  $('boot').classList.add('hidden');
  $('screen-hint').classList.add('hidden');
}

function currentSourceStatus() {
  if (state.bypass) return [msg('status.bypass'), 'warn'];
  if (state.mode === 'mic') {
    return state.micOn ? [msg('status.micLive'), 'live'] : [msg('status.micOff'), ''];
  }
  if (state.mode === 'file') {
    if (!state.fileBuffer) return [msg('status.fileNoFile'), ''];
    return state.playing
      ? [msg('status.filePlaying', { name: state.fileName }), 'live']
      : [msg('status.fileLoaded', { name: state.fileName }), ''];
  }
  return [msg('status.ready'), ''];
}

function renderStatusFromState() {
  const [text, kind] = currentSourceStatus();
  setStatus(text, kind);
}

function renderModeUI() {
  const mode = state.mode;
  const fileReady = mode === 'file' && !!state.fileBuffer;

  $('transport').hidden = mode === 'none';
  $('transport-mic').hidden = mode !== 'mic';
  $('transport-file').hidden = mode !== 'file';

  $('timeline').hidden = mode !== 'file';

  for (const [id, m] of [
    ['source-mic', 'mic'],
    ['source-file', 'file'],
  ]) {
    const btn = $(id);
    const active = mode === m;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }

  const micBtn = $('mic-toggle');
  const micLabel = msg(state.micOn ? 'transport.disableMic' : 'transport.enableMic');
  micBtn.textContent = micLabel;
  micBtn.setAttribute('aria-label', micLabel);
  micBtn.setAttribute('aria-pressed', String(state.micOn));
  micBtn.classList.toggle('active', state.micOn);

  $('choose-file').disabled = mode !== 'file';
  $('play-btn').disabled = !fileReady;
  $('loop-btn').disabled = !fileReady;
  $('export-btn').disabled = !fileReady;
  const tl = $('timeline');
  tl.classList.toggle('disabled', !fileReady);
  tl.setAttribute('aria-disabled', String(!fileReady));
  tl.tabIndex = fileReady ? 0 : -1;

  if (mode === 'file') {
    $('file-name').textContent = state.fileBuffer ? state.fileName : '—';
    updatePlayButton();
    updateLoopUI();
    updateFileTimeUI();
  } else if (state.rec.state === 'idle') {
    $('rec-time').textContent = '';
  }
  renderStatusFromState();
}

function enterMode(mode) {
  if (mode !== 'mic' && mode !== 'file') return false;
  if (state.mode === mode) {
    renderModeUI();
    return false;
  }
  let discarded = false;
  if (mode === 'file') {
    if (state.micOn || state.micStream || state.micNode) {
      discarded = state.rec.state !== 'idle';
      stopMic();
    } else if (state.rec.state !== 'idle') {
      discarded = true;
      discardTake('reason.switchSource');
    }
  }
  if (state.playing) pauseFile();
  state.mode = mode;
  hideBoot();
  bootError('');
  renderModeUI();

  if (!discarded) {
    toast(mode === 'mic' ? msg('toast.enterMic') : msg('toast.enterFile'));
  }
  return discarded;
}

async function startMic() {
  if (state.micOn || state.micStarting) return;
  if (state.mode !== 'mic') enterMode('mic');
  state.micStarting = true;
  try {
    await ensureAudio();
    if (state.playing) pauseFile();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });

    if (state.mode !== 'mic') {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const node = state.ctx.createMediaStreamSource(stream);
    node.connect(state.chain.input);
    state.micStream = stream;
    state.micNode = node;
    state.micOn = true;
    hideBoot();
    bootError('');
    renderModeUI();
    toast(msg('toast.micOn'));
  } catch (err) {
    console.error(err);
    state.micOn = false;
    renderModeUI();
    const detail =
      err && err.name === 'NotAllowedError'
        ? msg('error.micDenied')
        : msg('error.micOpen', { message: err.message });
    bootError(detail);

    if (state.mode === 'mic') setStatus(msg('status.micUnavailable'), 'warn');
    toast(detail);
  } finally {
    state.micStarting = false;
  }
}

function closeMic() {
  const hadTake = state.rec.state !== 'idle';
  stopMic();
  renderModeUI();

  if (!hadTake) toast(msg('toast.micOff'));
}

function stopMic() {
  if (state.rec.state !== 'idle') discardTake('reason.switchSource');
  if (state.micNode) {
    try {
      state.micNode.disconnect();
    } catch {}
    state.micNode = null;
  }
  if (state.micStream) {
    state.micStream.getTracks().forEach((t) => t.stop());
    state.micStream = null;
  }
  state.micOn = false;
}

async function decodeAudioFile(file) {
  const ab = await file.arrayBuffer();
  try {
    return await state.ctx.decodeAudioData(ab.slice(0));
  } catch {
    setStatus(msg('status.converting'), 'warn');
    toast(msg('toast.converting'));
    let res;
    try {
      res = await fetch('/api/convert', { method: 'POST', body: ab });
    } catch {
      throw new Error(msg('error.convertUnavailable'));
    }
    if (!res.ok) {
      let detail = '';
      try {
        const t = await res.text();
        if (t && !t.includes('<')) detail = t;
      } catch {}
      throw new Error(detail || msg('error.convertUnsupported'));
    }
    return await state.ctx.decodeAudioData(await res.arrayBuffer());
  }
}

async function handleFile(file) {
  if (!file) return;
  try {
    await ensureAudio();
    setStatus(msg('status.decoding'), 'warn');
    const buf = await decodeAudioFile(file);

    let discarded = false;
    if (state.mode !== 'file') discarded = enterMode('file');
    else if (state.micOn) stopMic();
    stopFile();
    state.fileBuffer = buf;
    state.fileName = file.name;
    resetExportProgress();

    loadFile();
    hideBoot();
    bootError('');
    renderModeUI();
    toast(
      msg(discarded ? 'toast.loadedAfterDiscard' : 'toast.loaded', {
        name: file.name,
        duration: buf.duration.toFixed(1),
      }),
    );
  } catch (err) {
    console.error(err);
    bootError(msg('error.decodeFile', { message: err.message }));
    setStatus(msg('status.decodeFailed'), 'warn');
    toast(msg('toast.decodeFailed', { message: (err.message || '').slice(0, 60) }));
  }
}

function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fileDuration() {
  return state.fileBuffer ? state.fileBuffer.duration : 0;
}

function filePosition() {
  const dur = fileDuration();
  if (!dur) return 0;
  if (state.playing && state.fileStartCtx !== null) {
    const elapsed = Math.max(0, state.ctx.currentTime - state.fileStartCtx);
    const raw = state.fileStartPos + elapsed;
    if (state.loopOn) return ((raw % dur) + dur) % dur;
    return clamp(raw, 0, dur);
  }
  return clamp(state.fileTime, 0, dur);
}

function computeFilePeaks(columns) {
  const buf = state.fileBuffer;
  if (!buf || columns < 1) return null;
  const chans = [];
  const nch = Math.min(2, buf.numberOfChannels);
  for (let c = 0; c < nch; c++) chans.push(buf.getChannelData(c));
  const frames = buf.length;
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  if (!frames) return { columns, min, max, peak: 0 };
  let peak = 0;
  for (let col = 0; col < columns; col++) {
    const start = Math.floor((col * frames) / columns);
    const end = Math.max(start + 1, Math.min(frames, Math.floor(((col + 1) * frames) / columns)));
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      let mn = chans[0][i];
      let mx = mn;
      for (let c = 1; c < chans.length; c++) {
        const s = chans[c][i];
        if (s < mn) mn = s;
        if (s > mx) mx = s;
      }
      if (mn < lo) lo = mn;
      if (mx > hi) hi = mx;
    }
    min[col] = lo;
    max[col] = hi;
    if (hi > peak) peak = hi;
    if (-lo > peak) peak = -lo;
  }

  const norm = peak > 0 ? 1 / peak : 0;
  if (norm !== 1) {
    for (let col = 0; col < columns; col++) {
      min[col] *= norm;
      max[col] *= norm;
    }
  }
  return { columns, min, max, peak };
}

function drawWaveform() {
  const canvas = $('timeline-wave');
  const tl = $('timeline');
  if (!canvas || !tl || tl.hidden) return;
  const rect = tl.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!(fileDuration() > 0)) {
    state.filePeaks = null;
    return;
  }
  if (!state.filePeaks || state.filePeaks.columns !== w) state.filePeaks = computeFilePeaks(w);
  const peaks = state.filePeaks;
  if (!peaks) return;
  const mid = h / 2;
  const amp = Math.max(1, mid - 3);
  g.strokeStyle = 'rgba(227, 181, 107, 0.55)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x < peaks.columns; x++) {
    const top = mid - peaks.max[x] * amp;
    const bottom = mid - peaks.min[x] * amp;
    g.moveTo(x + 0.5, top);
    g.lineTo(x + 0.5, Math.max(bottom, top + 0.8));
  }
  g.stroke();
  g.strokeStyle = 'rgba(227, 181, 107, 0.14)';
  g.beginPath();
  g.moveTo(0, mid + 0.5);
  g.lineTo(w, mid + 0.5);
  g.stroke();
}

let waveformRedrawTimer = 0;
function scheduleWaveformRedraw() {
  clearTimeout(waveformRedrawTimer);
  waveformRedrawTimer = setTimeout(() => {
    waveformRedrawTimer = 0;
    drawWaveform();
  }, 120);
}

function updateFileTimeUI() {
  if (state.mode !== 'file') return;
  const dur = fileDuration();
  const pos = filePosition();
  const ratio = dur > 0 ? clamp(pos / dur, 0, 1) : 0;
  const head = $('timeline-head');
  if (head) head.style.left = `${(ratio * 100).toFixed(3)}%`;
  const time = $('rec-time');
  if (time) time.textContent = `${formatTime(pos)} / ${formatTime(dur)}`;
  const tl = $('timeline');
  if (tl) {
    tl.setAttribute('aria-valuemax', dur > 0 ? dur.toFixed(2) : '0');
    tl.setAttribute('aria-valuenow', pos > 0 ? pos.toFixed(2) : '0');
    if (dur > 0) tl.setAttribute('aria-valuetext', `${formatTime(pos)} / ${formatTime(dur)}`);
  }
}

function updatePlayButton() {
  const btn = $('play-btn');
  if (!btn) return;
  btn.textContent = state.playing ? '⏸' : '▶';
  btn.setAttribute('aria-label', msg(state.playing ? 'transport.pausePlayback' : 'transport.play'));
}

function updateLoopUI() {
  const btn = $('loop-btn');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(!!state.loopOn));
}

function updateFileTransport() {
  if (state.mode !== 'file') return;
  updatePlayButton();
  updateLoopUI();
  updateFileTimeUI();
  renderStatusFromState();
}

function ensureTransportLoop() {
  if (state.transportRaf) return;
  const tick = () => {
    state.transportRaf = 0;
    if (state.mode !== 'file') return;
    updateFileTimeUI();
    if (state.playing) state.transportRaf = requestAnimationFrame(tick);
  };
  state.transportRaf = requestAnimationFrame(tick);
}

function setFilePosition(seconds) {
  const dur = fileDuration();
  const pos = dur > 0 ? clamp(seconds, 0, dur) : 0;
  state.fileTime = pos;
  state.fileStartCtx = null;
  updateFileTimeUI();
  return pos;
}

function stopSource() {
  state.filePlayGen++;
  const src = state.fileNode;
  state.fileNode = null;
  if (!src) return;
  src.onended = null;
  try {
    src.stop();
  } catch {}
  try {
    src.disconnect();
  } catch {}
}

function stopFile() {
  stopSource();
  state.playing = false;
  state.fileTime = 0;
  state.fileStartCtx = null;
  timelineDrag = null;
  const bubble = $('timeline-bubble');
  if (bubble) bubble.hidden = true;
  updateFileTransport();
}

function pauseFile() {
  if (!state.playing) return;
  const pos = filePosition();
  stopSource();
  state.playing = false;
  state.fileTime = clamp(pos, 0, fileDuration());
  state.fileStartCtx = null;
  updateFileTransport();
}

function playFile(from = null) {
  if (state.mode !== 'file' || !state.fileBuffer || !state.chain) return;
  const dur = fileDuration();
  if (!(dur > 0)) return;
  let off = from == null ? state.fileTime : from;
  if (!Number.isFinite(off)) off = 0;
  if (state.loopOn) {
    off = ((off % dur) + dur) % dur;
  } else {
    if (off >= dur) off = 0;
    off = clamp(off, 0, Math.max(0, dur - 0.001));
  }
  stopSource();
  const src = state.ctx.createBufferSource();
  src.buffer = state.fileBuffer;
  src.loop = !!state.loopOn;
  src.connect(state.chain.input);
  const gen = ++state.filePlayGen;
  src.onended = () => {
    if (gen !== state.filePlayGen || state.fileNode !== src) return;
    state.fileNode = null;
    state.filePlayGen++;
    try {
      src.disconnect();
    } catch {}
    state.playing = false;
    state.fileTime = 0;
    state.fileStartCtx = null;
    updateFileTransport();
  };
  try {
    src.start(0, off);
  } catch {
    src.onended = null;
    try {
      src.disconnect();
    } catch {}
    state.playing = false;
    updateFileTransport();
    return;
  }
  state.fileNode = src;
  state.playing = true;
  state.fileTime = off;
  state.fileStartPos = off;
  state.fileStartCtx = state.ctx.currentTime;
  updateFileTransport();
  ensureTransportLoop();
}

function toggleLoop() {
  if (state.mode !== 'file' || !state.fileBuffer) return;
  state.loopOn = !state.loopOn;

  if (state.fileNode) {
    try {
      state.fileNode.loop = !!state.loopOn;
    } catch {}
  }
  updateLoopUI();
  toast(msg(state.loopOn ? 'toast.loopOn' : 'toast.loopOff'));
}

function seekFile(seconds) {
  if (state.mode !== 'file' || !state.fileBuffer) return 0;
  const wasPlaying = state.playing;
  stopSource();
  state.playing = false;
  const pos = setFilePosition(seconds);
  if (wasPlaying) playFile(pos);
  else updateFileTransport();
  return pos;
}

let timelineDrag = null;

function timelineRatio(e) {
  const tl = $('timeline');
  if (!tl) return 0;
  const rect = tl.getBoundingClientRect();
  if (!rect.width) return 0;
  return clamp((e.clientX - rect.left) / rect.width, 0, 1);
}

function showTimelineBubble() {
  const bubble = $('timeline-bubble');
  if (!bubble) return;
  const dur = fileDuration();
  const pos = filePosition();
  bubble.hidden = false;
  bubble.textContent = formatTime(pos);
  bubble.style.left = `${dur > 0 ? (pos / dur) * 100 : 0}%`;
}

function onTimelineDown(e) {
  if (state.mode !== 'file' || !state.fileBuffer || e.button !== 0) return;
  e.preventDefault();
  const wasPlaying = state.playing;
  if (wasPlaying) {
    const pos = filePosition();
    stopSource();
    state.playing = false;
    state.fileTime = pos;
    state.fileStartCtx = null;
  }
  timelineDrag = { wasPlaying };
  try {
    $('timeline').setPointerCapture?.(e.pointerId);
  } catch {}
  setFilePosition(timelineRatio(e) * fileDuration());
  showTimelineBubble();
  updateFileTransport();
}

function onTimelineMove(e) {
  if (!timelineDrag) return;
  e.preventDefault();
  setFilePosition(timelineRatio(e) * fileDuration());
  showTimelineBubble();
}

function finishTimelineDrag(e) {
  if (!timelineDrag) return;
  const { wasPlaying } = timelineDrag;
  timelineDrag = null;
  const pos = filePosition();
  const bubble = $('timeline-bubble');
  if (bubble) bubble.hidden = true;
  try {
    $('timeline').releasePointerCapture?.(e.pointerId);
  } catch {}
  if (wasPlaying) {
    playFile(pos);
  } else {
    state.playing = false;
    state.fileStartCtx = null;
    updateFileTransport();
  }
}

function onTimelineKey(e) {
  if (state.mode !== 'file' || !state.fileBuffer) return;
  const dur = fileDuration();
  const step = e.shiftKey ? 5 : 1;
  let target = null;
  if (e.key === 'ArrowLeft') target = filePosition() - step;
  else if (e.key === 'ArrowRight') target = filePosition() + step;
  else if (e.key === 'Home') target = 0;
  else if (e.key === 'End') target = dur;
  if (target === null) return;
  e.preventDefault();
  seekFile(target);
}

function loadFile() {
  stopSource();
  state.playing = false;
  state.fileTime = 0;
  state.fileStartCtx = null;
  state.filePeaks = null;
  timelineDrag = null;
  const bubble = $('timeline-bubble');
  if (bubble) bubble.hidden = true;
  $('file-name').textContent = state.fileName;
  renderModeUI();
  drawWaveform();
}

function createWavEncoder(audioBuffer) {
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const len = audioBuffer.length;
  const sr = audioBuffer.sampleRate;
  const bytes = 44 + len * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, len * channels * 2, true);

  const data = [];
  for (let c = 0; c < channels; c++) data.push(audioBuffer.getChannelData(c));
  return { view, data, channels, len, bytes };
}

function writePcmFrames(enc, from, to) {
  const { view, data, channels } = enc;
  let off = 44 + from * channels * 2;
  for (let i = from; i < to; i++) {
    for (let c = 0; c < channels; c++) {
      const s = clamp(data[c][i], -1, 1);
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
}

function encodeWav(audioBuffer) {
  const enc = createWavEncoder(audioBuffer);
  writePcmFrames(enc, 0, enc.len);
  return new Blob([enc.view.buffer], { type: 'audio/wav' });
}

const WAV_ENCODE_CHUNK_FRAMES = 16384;

const yieldToUi = (() => {
  if (typeof MessageChannel !== 'function') {
    return () => new Promise((resolve) => setTimeout(resolve, 0));
  }
  const channel = new MessageChannel();
  const queue = [];
  channel.port1.onmessage = () => {
    const resolve = queue.shift();
    if (resolve) resolve();
  };
  return () =>
    new Promise((resolve) => {
      queue.push(resolve);
      channel.port2.postMessage(0);
    });
})();

async function encodeWavWithProgress(audioBuffer, onProgress) {
  const enc = createWavEncoder(audioBuffer);
  let done = 0;
  while (done < enc.len) {
    const end = Math.min(enc.len, done + WAV_ENCODE_CHUNK_FRAMES);
    writePcmFrames(enc, done, end);
    done = end;
    onProgress(done / enc.len);
    if (done < enc.len) await yieldToUi();
  }
  return new Blob([enc.view.buffer], { type: 'audio/wav' });
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const EXPORT_PROGRESS_SLICE_SECONDS = 0.5;

const PROGRESS_TARGETS = {
  export: {
    bar: 'export-progress',
    fill: 'export-fill',
    pct: 'export-pct',
    store: () => state.exportProgress,
  },
  save: {
    bar: 'rec-progress',
    fill: 'rec-fill',
    pct: 'rec-pct',
    store: () => state.recSaveProgress,
  },
};

function progressEls(key) {
  const t = PROGRESS_TARGETS[key];
  return { t, bar: $(t.bar), fill: $(t.fill), pctEl: $(t.pct) };
}

function setProgressValue(key, fraction) {
  const { t, bar, fill, pctEl } = progressEls(key);
  if (!bar) return;
  const pct = clamp(Math.round(fraction * 100), 0, 100);
  bar.hidden = false;
  bar.classList.remove('is-indeterminate', 'is-failed');
  bar.setAttribute('aria-valuenow', String(pct));
  bar.removeAttribute('aria-valuetext');
  fill.style.width = `${pct}%`;
  pctEl.textContent = `${pct}%`;
  const prog = t.store();
  prog.value = pct;
  prog.failed = false;
  if (prog.history[prog.history.length - 1] !== pct) prog.history.push(pct);
}

function setProgressIndeterminate(key, label) {
  const { bar, fill, pctEl } = progressEls(key);
  if (!bar) return;
  bar.hidden = false;
  bar.classList.add('is-indeterminate');
  bar.classList.remove('is-failed');
  bar.removeAttribute('aria-valuenow');
  bar.setAttribute('aria-valuetext', label);
  fill.style.width = '100%';
  pctEl.textContent = label;
}

function setProgressFailed(key, label) {
  const { t, bar, pctEl } = progressEls(key);
  if (!bar) return;
  bar.hidden = false;
  bar.classList.remove('is-indeterminate');
  bar.classList.add('is-failed');
  bar.removeAttribute('aria-valuenow');
  bar.setAttribute('aria-valuetext', label);
  pctEl.textContent = label;
  t.store().failed = true;
}

function resetProgress(key) {
  const { bar, fill, pctEl } = progressEls(key);
  if (!bar) return;
  bar.hidden = true;
  bar.classList.remove('is-indeterminate', 'is-failed');
  bar.setAttribute('aria-valuenow', '0');
  bar.removeAttribute('aria-valuetext');
  fill.style.width = '0%';
  pctEl.textContent = '0%';
}

function setExportProgress(fraction) {
  setProgressValue('export', fraction);
}

function resetExportProgress() {
  resetProgress('export');
}

function renderOfflineWithProgress(off, totalFrames, onProgress) {
  if (typeof off.suspend !== 'function') {
    return { rendered: off.startRendering(), slices: 0, cancel() {} };
  }
  const sr = off.sampleRate;
  const duration = totalFrames / sr;
  const quantum = 128;
  let cancelled = false;
  const resume = () => {
    try {
      const r = off.resume();
      if (r && r.catch) r.catch(() => {});
    } catch {}
  };
  const suspendTimes = [];
  for (
    let t = EXPORT_PROGRESS_SLICE_SECONDS;
    t < duration - 1e-9;
    t += EXPORT_PROGRESS_SLICE_SECONDS
  ) {
    const q = (Math.ceil((t * sr) / quantum) * quantum) / sr;
    if (q > 0 && q < duration) suspendTimes.push(q);
  }
  for (const t of suspendTimes) {
    off
      .suspend(t)
      .then(() => {
        if (cancelled) {
          resume();
          return;
        }
        try {
          onProgress(t / duration);
        } finally {
          resume();
        }
      })
      .catch(() => {});
  }
  return {
    rendered: off.startRendering(),
    slices: suspendTimes.length,
    cancel() {
      cancelled = true;
      resume();
    },
  };
}

async function exportWav() {
  if (state.mode !== 'file' || !state.fileBuffer || state.exporting) return;
  state.exporting = true;
  state.exportProgress = { value: 0, history: [], slices: 0 };
  resetExportProgress();
  setExportProgress(0);
  setStatus(msg('status.rendering'), 'warn');
  const mins = state.fileBuffer.duration / 60;
  toast(
    mins > 1.5
      ? msg('toast.exportLong', { minutes: mins.toFixed(1) })
      : msg('toast.exportRendering'),
  );
  let renderJob = null;
  try {
    const sr = state.ctx.sampleRate;
    const tail = Math.floor(sr * 3);
    const totalFrames = state.fileBuffer.length + tail;
    const off = new OfflineAudioContext(2, totalFrames, sr);
    const chain = await createVoiceChain(off, state.values, { offline: true });
    const src = off.createBufferSource();
    src.buffer = state.fileBuffer;
    src.connect(chain.input);
    src.start();
    renderJob = renderOfflineWithProgress(off, totalFrames, setExportProgress);
    state.exportProgress.slices = renderJob.slices;
    const rendered = await renderJob.rendered;

    setExportProgress(1);
    const name = state.fileName.replace(/\.[^.]+$/, '') || 'take';
    download(encodeWav(rendered), `${name}-belcanto.wav`);
    setStatus(msg('status.exported'), 'live');
    toast(msg('toast.exported'));
  } catch (err) {
    console.error(err);
    renderJob?.cancel();
    setStatus(msg('status.exportFailed'), 'warn');
    toast(msg('toast.exportFailed', { message: err.message }));
  } finally {
    state.exporting = false;
  }
}

const REC_DISCARD_NOTE = 'bc.recDiscardNote';

function recordedSeconds() {
  const rec = state.rec;
  const running =
    rec.state === 'recording' && rec.segmentStart > 0 ? performance.now() - rec.segmentStart : 0;
  return (rec.recordedMs + running) / 1000;
}

function setRecState(next) {
  const rec = state.rec;
  const changed = rec.state !== next;
  rec.state = next;

  if (changed && next !== 'pending') resetProgress('save');
  renderRecUI();
}

function renderRecUI() {
  const rec = state.rec;
  const next = rec.state;
  const btn = $('rec-btn');
  const pause = $('rec-pause');
  const actions = $('rec-actions');
  const save = $('rec-save');
  const discard = $('rec-discard');
  const idle = next === 'idle';
  const recording = next === 'recording';
  const paused = next === 'paused';
  const pending = next === 'pending';
  const live = recording || paused;

  btn.disabled = false;
  btn.classList.toggle('recording', recording);
  btn.setAttribute('aria-pressed', String(recording));
  btn.innerHTML = `<span class="rec-dot"></span>${
    live ? msg('transport.stop') : pending ? msg('transport.rerecord') : msg('transport.record')
  }`;
  btn.setAttribute(
    'aria-label',
    live
      ? msg('transport.recordAriaStop')
      : pending
        ? msg('transport.recordAriaRerecord')
        : msg('transport.recordAriaStart'),
  );

  pause.disabled = !live;
  pause.hidden = !live;
  pause.textContent = msg(paused ? 'transport.resume' : 'transport.pause');
  pause.setAttribute('aria-pressed', String(paused));
  pause.setAttribute('aria-label', msg(paused ? 'transport.resumeAria' : 'transport.pauseAria'));

  actions.hidden = !pending;
  actions.setAttribute('aria-busy', 'false');
  save.hidden = !pending;
  discard.hidden = !pending;
  save.disabled = !pending;
  discard.disabled = !pending;
  $('rec-hint').hidden = pending;

  $('rec-time').textContent = idle ? '' : `● ${(rec.elapsed || 0).toFixed(1)}s`;
}

function setRecBusy(busy) {
  const st = state.rec.state;
  const pending = st === 'pending';
  const live = st === 'recording' || st === 'paused';
  $('rec-btn').disabled = busy;
  $('rec-pause').disabled = busy || !live;
  $('rec-save').disabled = busy || !pending;
  $('rec-discard').disabled = busy || !pending;
  $('rec-actions').setAttribute('aria-busy', String(busy));
}

function stopRecTimer() {
  if (state.rec.timer) {
    clearInterval(state.rec.timer);
    state.rec.timer = null;
  }
}

function releaseRecDest() {
  const rec = state.rec;
  const dest = rec.dest;
  rec.dest = null;
  if (!dest) return;
  try {
    state.chain?.output.disconnect(dest);
  } catch {}
  try {
    dest.stream.getTracks().forEach((t) => t.stop());
  } catch {}
}

function discardTake(reason = '', { silent = false } = {}) {
  const rec = state.rec;
  const hadTake = rec.state !== 'idle';
  rec.gen++;
  stopRecTimer();
  const mr = rec.recorder;
  rec.recorder = null;
  if (mr && mr.state !== 'inactive') {
    try {
      mr.stop();
    } catch {}
  }
  releaseRecDest();
  rec.chunks = [];
  rec.blob = null;
  rec.recordedMs = 0;
  rec.segmentStart = 0;
  rec.elapsed = 0;
  rec.saving = false;
  setRecState('idle');
  if (hadTake && !silent) {
    toast(
      reason ? msg('toast.recDiscardedReason', { reason: msg(reason) }) : msg('toast.recDiscarded'),
    );
  }
}

function finalizeTake(gen, mr) {
  const rec = state.rec;
  if (gen !== rec.gen) {
    if (rec.recorder === mr) rec.recorder = null;
    return;
  }
  stopRecTimer();
  rec.recorder = null;
  rec.segmentStart = 0;
  rec.elapsed = Math.max(0, recordedSeconds());
  releaseRecDest();
  const blob = new Blob(rec.chunks, { type: rec.mimeType || 'audio/webm' });
  rec.chunks = [];
  if (!blob.size) {
    rec.blob = null;
    setRecState('idle');
    toast(msg('toast.recEmpty'));
    return;
  }
  rec.blob = blob;
  setRecState('pending');
  toast(msg('toast.recDone', { seconds: rec.elapsed.toFixed(1) }));
}

function startRecording() {
  const rec = state.rec;
  if (!state.chain) return;

  if (!state.micOn) {
    toast(msg('toast.recMicFirst'));
    return;
  }
  if (rec.state === 'pending') discardTake('reason.rerecord');
  if (rec.state === 'recording' || rec.state === 'paused') return;

  const dest = state.ctx.createMediaStreamDestination();
  state.chain.output.connect(dest);
  let mr;
  try {
    mr = new MediaRecorder(dest.stream);
  } catch (err) {
    console.error(err);
    try {
      state.chain.output.disconnect(dest);
    } catch {}
    try {
      dest.stream.getTracks().forEach((t) => t.stop());
    } catch {}
    toast(msg('toast.recStartFailed', { message: err.message }));
    return;
  }

  rec.gen++;
  const gen = rec.gen;
  rec.recorder = mr;
  rec.dest = dest;
  rec.chunks = [];
  rec.mimeType = mr.mimeType || 'audio/webm';
  rec.blob = null;
  rec.recordedMs = 0;
  rec.segmentStart = 0;
  rec.elapsed = 0;
  rec.saving = false;
  mr.ondataavailable = (e) => {
    if (e.data.size) rec.chunks.push(e.data);
  };
  mr.onstop = () => finalizeTake(gen, mr);
  mr.onerror = (e) => {
    console.error(e);
    if (gen === rec.gen) discardTake('reason.recError');
  };
  try {
    mr.start();
  } catch (err) {
    console.error(err);
    discardTake('reason.recStart');
    toast(msg('toast.recStartFailed', { message: err.message }));
    return;
  }
  rec.segmentStart = performance.now();
  setRecState('recording');
  startRecTimer();
}

function startRecTimer() {
  const rec = state.rec;
  stopRecTimer();
  rec.elapsed = recordedSeconds();
  setRecState(rec.state);
  rec.timer = setInterval(() => {
    if (rec.state !== 'recording') return;
    rec.elapsed = recordedSeconds();
    setRecState(rec.state);
  }, 100);
}

function pauseRecording() {
  const rec = state.rec;
  if (rec.state !== 'recording' || !rec.recorder) return;
  const elapsedMs = performance.now() - rec.segmentStart;
  rec.recordedMs += elapsedMs;
  rec.segmentStart = 0;
  rec.elapsed = rec.recordedMs / 1000;
  stopRecTimer();
  try {
    rec.recorder.pause();
  } catch (err) {
    console.error(err);
    rec.recordedMs -= elapsedMs;
    rec.segmentStart = performance.now();
    startRecTimer();
    toast(msg('toast.recPauseFailed', { message: err.message }));
    return;
  }
  setRecState('paused');
}

function resumeRecording() {
  const rec = state.rec;
  if (rec.state !== 'paused' || !rec.recorder) return;
  try {
    rec.recorder.resume();
  } catch (err) {
    console.error(err);
    toast(msg('toast.recResumeFailed', { message: err.message }));
    return;
  }
  rec.segmentStart = performance.now();
  setRecState('recording');
  startRecTimer();
}

function stopRecording() {
  const rec = state.rec;
  const live = rec.state === 'recording' || rec.state === 'paused';
  if (!live || !rec.recorder) return;
  if (rec.state === 'recording' && rec.segmentStart > 0) {
    rec.recordedMs += performance.now() - rec.segmentStart;
  }
  rec.segmentStart = 0;
  rec.elapsed = rec.recordedMs / 1000;
  stopRecTimer();

  setRecState(rec.state);
  setRecBusy(true);
  try {
    rec.recorder.stop();
  } catch (err) {
    console.error(err);
    discardTake('reason.stopFailed');
    toast(msg('toast.recStopFailed', { message: err.message }));
  }
}

async function saveTake() {
  const rec = state.rec;
  if (rec.state !== 'pending' || !rec.blob || rec.saving) return;
  rec.saving = true;
  setRecBusy(true);
  const blob = rec.blob;
  const progress = { value: 0, history: [], phases: ['decode'], phase: 'decode', failed: false };
  state.recSaveProgress = progress;

  setProgressIndeterminate('save', msg('progress.decoding'));
  try {
    const buf = await state.ctx.decodeAudioData(await blob.arrayBuffer());

    if (rec.state !== 'pending' || rec.blob !== blob) return;
    progress.phase = 'encode';
    progress.phases.push('encode');
    setProgressValue('save', 0);

    const wav = await encodeWavWithProgress(buf, (fraction) => {
      if (rec.state === 'pending' && rec.blob === blob) setProgressValue('save', fraction);
    });
    if (rec.state !== 'pending' || rec.blob !== blob) return;
    setProgressValue('save', 1);
    progress.phase = 'done';
    progress.phases.push('done');
    download(wav, `belcanto-take-${Date.now()}.wav`);
    rec.blob = null;
    rec.elapsed = 0;
    setRecState('idle');
    toast(msg('toast.recSaved'));
  } catch (err) {
    console.error(err);
    progress.failed = true;
    progress.phase = 'error';
    progress.phases.push('error');

    if (rec.state === 'pending' && rec.blob === blob) {
      setProgressFailed('save', msg('progress.saveFailed'));
      setRecBusy(false);
      toast(msg('toast.recSaveFailed', { message: err.message || msg('error.recordDecode') }));
    }
  } finally {
    rec.saving = false;
  }
}

function toggleRecord() {
  if (!state.chain) return;
  const st = state.rec.state;
  if (st === 'recording' || st === 'paused') stopRecording();
  else startRecording();
}

function noteRecDiscardOnUnload() {
  if (state.rec.state === 'idle') return;
  try {
    sessionStorage.setItem(REC_DISCARD_NOTE, '1');
  } catch {}
  discardTake('reason.pageLeft', { silent: true });
}

function notifyDiscardedTake() {
  try {
    if (!sessionStorage.getItem(REC_DISCARD_NOTE)) return;
    sessionStorage.removeItem(REC_DISCARD_NOTE);
    setTimeout(() => toast(msg('toast.previousTakeDiscarded')), 300);
  } catch {}
}

function setMeter(id, buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  const db = 20 * Math.log10(rms + 1e-7);
  const target = clamp((db + 54) / 54, 0, 1);
  const key = id === 'meter-in' ? 'in' : 'out';
  const prev = state.meterVals[key];
  const v = Math.max(target, prev * 0.84);
  state.meterVals[key] = v;
  const peak = Math.max(v, (state.meterPeaks[key] || 0) - 0.008);
  state.meterPeaks[key] = peak;
  const el = document.getElementById(id);
  el.style.setProperty('--v', `${(v * 100).toFixed(1)}%`);
  const cap = el.querySelector('b');
  if (cap) cap.style.bottom = `${(peak * 100).toFixed(1)}%`;
}

function startMeters() {
  const inBuf = new Float32Array(1024);
  const outBuf = new Float32Array(1024);
  const loop = () => {
    if (!state.chain) return;
    state.chain.inAnalyser.getFloatTimeDomainData(inBuf);
    state.chain.outAnalyser.getFloatTimeDomainData(outBuf);
    setMeter('meter-in', inBuf);
    setMeter('meter-out', outBuf);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function autoCorrelate(buf, sr) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.006) return -1;

  const minLag = Math.max(2, Math.floor(sr / 1200));
  const maxLag = Math.min(n - 2, Math.floor(sr / 65));
  const seg = Math.min(n - maxLag, 768);
  const corr = new Float32Array(maxLag + 2);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < seg; i++) {
      const a = buf[i];
      const b = buf[i + lag];
      c += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    corr[lag] = c / Math.sqrt(e1 * e2 || 1);
    if (corr[lag] > best) best = corr[lag];
  }
  if (best < 0.35) return -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > best * 0.9) {
      const a = corr[lag - 1];
      const b = corr[lag];
      const cc = corr[lag + 1];
      const d = (0.5 * (a - cc)) / (a - 2 * b + cc || 1);
      return sr / (lag + d);
    }
  }
  return -1;
}

function updatePitch() {
  if (!state.chain) return;
  const buf = state.pitchBuf || (state.pitchBuf = new Float32Array(2048));
  state.chain.inAnalyser.getFloatTimeDomainData(buf);
  const f = autoCorrelate(buf, state.ctx.sampleRate);
  const nameEl = $('note-name');
  const metaEl = $('note-meta');
  const needle = $('tuner-needle');
  if (f > 0) {
    const midi = 69 + 12 * Math.log2(f / 440);
    const rounded = Math.round(midi);
    const cents = Math.round((midi - rounded) * 100);
    const note = NOTE_NAMES[((rounded % 12) + 12) % 12] + (Math.floor(rounded / 12) - 1);
    nameEl.textContent = note;
    nameEl.classList.remove('idle');
    metaEl.textContent = `${f.toFixed(1)} Hz · ${cents > 0 ? '+' : ''}${cents} ct`;
    needle.style.left = `${50 + (clamp(cents, -50, 50) / 50) * 46}%`;
    needle.style.opacity = '1';
    needle.classList.toggle('in-tune', Math.abs(cents) <= 8);
  } else {
    nameEl.textContent = '–';
    nameEl.classList.add('idle');
    metaEl.textContent = '-- Hz';
    needle.style.opacity = '0.18';
    needle.classList.remove('in-tune');
  }
}

function bindEvents() {
  $('boot-mic').addEventListener('click', () => enterMode('mic'));
  $('boot-file').addEventListener('click', () => enterMode('file'));
  $('source-mic').addEventListener('click', () => enterMode('mic'));
  $('source-file').addEventListener('click', () => enterMode('file'));
  $('mic-toggle').addEventListener('click', () => (state.micOn ? closeMic() : startMic()));
  $('choose-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) handleFile(file);
  });

  $('bypass').addEventListener('click', () => {
    state.bypass = !state.bypass;
    $('bypass').setAttribute('aria-pressed', String(state.bypass));
    state.chain?.setBypass(state.bypass);
    renderStatusFromState();
  });

  $('monitor').addEventListener('click', () => setMonitor(!state.monitorOn));

  $('play-btn').addEventListener('click', () => {
    if (state.playing) pauseFile();
    else playFile();
  });
  $('loop-btn').addEventListener('click', toggleLoop);
  const timeline = $('timeline');
  timeline.addEventListener('pointerdown', onTimelineDown);
  timeline.addEventListener('pointermove', onTimelineMove);
  timeline.addEventListener('pointerup', finishTimelineDrag);
  timeline.addEventListener('pointercancel', finishTimelineDrag);
  timeline.addEventListener('keydown', onTimelineKey);
  window.addEventListener('resize', scheduleWaveformRedraw);
  $('export-btn').addEventListener('click', exportWav);
  $('rec-btn').addEventListener('click', toggleRecord);
  $('rec-pause').addEventListener('click', () => {
    if (state.rec.state === 'recording') pauseRecording();
    else if (state.rec.state === 'paused') resumeRecording();
  });
  $('rec-save').addEventListener('click', saveTake);
  $('rec-discard').addEventListener('click', () => discardTake());
  window.addEventListener('pagehide', noteRecDiscardOnUnload);
  window.addEventListener('beforeunload', noteRecDiscardOnUnload);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) notifyDiscardedTake();
  });

  $('preset-prev').addEventListener('click', () => stepPreset(-1));
  $('preset-next').addEventListener('click', () => stepPreset(1));
  $('reset-btn').addEventListener('click', resetToDefaults);

  document.querySelectorAll('.ab-btn').forEach((b) => {
    b.addEventListener('click', () => switchSlot(b.dataset.slot));
  });

  document.querySelectorAll('.screen-tabs button').forEach((b) => {
    b.addEventListener('click', () => setScopeMode(b.dataset.mode));
  });

  $('preserve').addEventListener('click', () => {
    state.values.preserve = !state.values.preserve;
    updatePreserveSwitch();
    markSlot();
    state.chain?.update({ preserve: state.values.preserve });
    if (state.preset !== CUSTOM) {
      state.preset = CUSTOM;
      $('preset').value = CUSTOM;
    }
  });

  const app = $('app');
  let dragDepth = 0;
  app.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    app.classList.add('dragging');
  });
  app.addEventListener('dragover', (e) => e.preventDefault());
  app.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) app.classList.remove('dragging');
  });
  app.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    app.classList.remove('dragging');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Space' && state.mode === 'file') {
      e.preventDefault();
      if (state.playing) pauseFile();
      else playFile();
    }
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === 'a' || e.key === 'A') switchSlot('A');
      if (e.key === 'b' || e.key === 'B') switchSlot('B');
    }
  });
}

function setScopeMode(mode) {
  state.scopeMode = mode;
  state.scope?.setMode(mode);
  document.querySelectorAll('.screen-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  try {
    localStorage.setItem('bc.scopeMode', mode);
  } catch {}
}

function stepPreset(dir) {
  const names = Object.keys(PRESETS);
  let i = names.indexOf(state.preset);
  if (i < 0) i = 0;
  i = (i + dir + names.length) % names.length;
  applyPreset(names[i]);
}

function init() {
  applyPresetValuesOnly(DEFAULT_PRESET);
  state.slots = { A: { ...state.values }, B: { ...state.values } };
  buildPanels();
  buildPresets();
  bindEvents();
  setRecState('idle');
  notifyDiscardedTake();
  updatePreserveSwitch();
  updateMonitorUI();
  updateSlotUI();
  let savedMode = 'split';
  try {
    savedMode = localStorage.getItem('bc.scopeMode') || 'split';
  } catch {}
  setScopeMode(savedMode);
  renderModeUI();
  $('latency').textContent = '—';
}

function applyPresetValuesOnly(name) {
  const preset = PRESETS[name];
  for (const [id, v] of Object.entries(preset)) {
    state.values[id] = v;
  }
  state.preset = name;
  $('preset').value = name;
  updatePreserveSwitch();
}

init();

state.fileDuration = fileDuration;
state.filePosition = filePosition;
state.seekFile = seekFile;
window.__belcanto = state;
