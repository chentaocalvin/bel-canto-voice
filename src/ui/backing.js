import { formatTime, paintWaveform } from './timeline.js';
import { Knob } from './knob.js';
import { msg } from '../strings.js';
import { minimumRecordingAdjustment } from '../audio/voice-timing.js';

export function createBackingControls({
  ensureAudio,
  getTrack,
  onChange,
  notify,
  locked,
  transport,
  onPlay,
  onSeek,
}) {
  const section = document.createElement('div');
  section.className = 'backing-controls';
  section.innerHTML = `<div class="backing-main">
      <div class="backing-heading"><strong>${msg('backing.title')}</strong>
        <span id="backing-status" role="status">${msg('backing.empty')}</span></div>
      <input type="file" id="backing-input" accept="audio/*" hidden>
      <div class="backing-transport">
        <button class="btn small" id="backing-load">${msg('backing.load')}</button>
        <button class="btn small" id="backing-play" aria-pressed="false" disabled>${msg('backing.play')}</button>
        <button class="btn small" id="backing-reset" disabled>${msg('backing.reset')}</button>
        <button class="btn small" id="backing-remove" disabled>${msg('backing.remove')}</button>
      </div>
      <div class="backing-progress">
        <div class="timeline backing-timeline" id="backing-timeline" aria-disabled="true">
          <canvas id="backing-wave" aria-hidden="true"></canvas>
          <div class="timeline-head" id="backing-head" aria-hidden="true"></div>
          <input id="backing-position" type="range" min="0" max="0" step="0.01" value="0" aria-label="${msg('backing.position')}" disabled>
        </div>
        <span class="rec-time" id="backing-time">0:00 / 0:00</span>
      </div>
    </div>
    <div class="backing-settings">
      <div class="backing-knobs" id="backing-knobs"></div>
    </div>
    <details class="backing-recording">
      <summary>${msg('backing.recordingAlignment')}</summary>
      <label class="backing-alignment">${msg('backing.alignment')} <input id="backing-alignment" type="number" min="-40" max="200" step="1" value="0"></label>
    </details>`;
  document.getElementById('transport').appendChild(section);
  section.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && event.target.closest('button, summary')) event.stopPropagation();
  });
  const get = (name) => document.getElementById(`backing-${name}`);
  const attempt = async (operation) => {
    try {
      await operation();
    } catch (error) {
      notify(error.message);
    }
  };
  const makeKnob = (id, label, min, max, value, format, change) => {
    const knob = new Knob(
      `backing-${id}`,
      {
        label,
        min,
        max,
        step: 1,
        def: value,
        bipolar: true,
        format,
        accessibleName: 'Backing ' + label,
        description:
          id === 'gain'
            ? 'Adjust the backing track level independently of the voice.'
            : 'Shift the backing track’s key without changing its tempo.',
      },
      value,
      (_, next) => change(next),
      { nativeInput: true },
    );
    get('knobs').appendChild(knob.container);
    return knob;
  };
  const gain = makeKnob(
    'gain',
    msg('backing.gain'),
    -36,
    6,
    -6,
    (value) => msg('backing.gainValue', { value }),
    (value) => getTrack()?.setGain(value),
  );
  const pitch = makeKnob(
    'pitch',
    msg('backing.transpose'),
    -6,
    6,
    0,
    (value) => msg('backing.pitchValue', { value: `${value > 0 ? '+' : ''}${value}` }),
    (value) =>
      attempt(async () => {
        if (await getTrack()?.transpose(value)) onChange();
      }),
  );
  pitch.setDisabled(true);
  get('load').addEventListener('click', () => get('input').click());
  get('input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      await ensureAudio();
      if (await getTrack().load(file)) onChange();
    } catch (error) {
      notify(error.message);
    }
  });
  get('reset').addEventListener('click', () =>
    attempt(async () => {
      if (await getTrack()?.transpose(0)) onChange();
    }),
  );
  get('remove').addEventListener('click', () =>
    attempt(() => {
      getTrack()?.remove();
      onChange();
    }),
  );
  get('play').addEventListener('click', () =>
    attempt(async () => {
      if (locked()) throw new Error(msg('error.backingLocked'));
      await onPlay();
    }),
  );
  get('position').addEventListener('input', () => {
    if (!locked()) onSeek(Number(get('position').value));
    updatePosition();
  });
  function updatePosition() {
    const playback = transport();
    if (playback.duration !== waveformDuration) drawWaveform();
    const time = `${formatTime(playback.position)} / ${formatTime(playback.duration)}`;
    get('position').max = String(playback.duration);
    get('position').value = String(playback.position);
    get('position').setAttribute('aria-valuetext', time);
    get('time').textContent = time;
    get('head').style.left =
      `${playback.duration ? Math.min(1, playback.position / playback.duration) * 100 : 0}%`;
  }
  let waveformBuffer;
  let waveformDuration;
  let waveformWidth;
  function drawWaveform() {
    const canvas = get('wave');
    const buffer = getTrack()?.buffer;
    const duration = transport().duration;
    const rect = get('timeline').getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    if (buffer === waveformBuffer && duration === waveformDuration && width === waveformWidth)
      return;
    waveformBuffer = buffer;
    waveformDuration = duration;
    waveformWidth = width;
    const height = Math.max(1, Math.round(rect.height));
    if (!buffer || !duration) {
      paintWaveform(canvas, null, width, height);
      return;
    }
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      buffer.getChannelData(channel),
    );
    const min = new Float32Array(width);
    const max = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      const start = Math.floor((x / width) * duration * buffer.sampleRate);
      const end = Math.min(
        buffer.length,
        Math.ceil(((x + 1) / width) * duration * buffer.sampleRate),
      );
      if (start >= buffer.length) break;
      let low = 0;
      let high = 0;
      const step = Math.max(1, Math.floor((end - start) / 128));
      for (const channel of channels)
        for (let sample = start; sample < end; sample += step) {
          low = Math.min(low, channel[sample]);
          high = Math.max(high, channel[sample]);
        }
      min[x] = low;
      max[x] = high;
    }
    paintWaveform(canvas, { columns: width, min, max }, width, height);
  }

  new ResizeObserver(drawWaveform).observe(get('timeline'));
  setInterval(updatePosition, 50);
  return {
    render() {
      const track = getTrack();
      if (!track) return;
      get('status').textContent = track.busy
        ? msg('backing.preparing')
        : track.error
          ? msg('backing.failed', { message: track.error })
          : track.buffer
            ? msg('backing.ready', { name: track.name })
            : msg('backing.empty');
      section.setAttribute('aria-busy', String(track.busy));
      const blocked = locked();
      const minimum = minimumRecordingAdjustment(track.sampleRate, track.alignmentFrames);
      get('alignment').min = String(minimum);
      get('alignment').value = String(
        Math.max(minimum, Math.min(200, Number(get('alignment').value))),
      );
      for (const name of ['input', 'load', 'alignment']) get(name).disabled = blocked;
      for (const name of ['remove', 'play', 'reset', 'position'])
        get(name).disabled = blocked || !track.buffer;
      pitch.setDisabled(blocked || !track.buffer);
      get('timeline').setAttribute('aria-disabled', String(get('position').disabled));
      const playback = transport();
      get('play').setAttribute('aria-pressed', String(playback.playing));
      get('play').textContent = msg(playback.playing ? 'backing.pause' : 'backing.play');
      gain.setValue(track.gainDb, true);
      if (!track.busy) pitch.setValue(track.semitones, true);
      updatePosition();
      drawWaveform();
    },
  };
}
