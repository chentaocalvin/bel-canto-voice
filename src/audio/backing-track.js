import { msg } from '../strings.js';
import { measureVoiceAlignment } from './voice-timing.js';
import { prepareBacking } from './backing-processor.js';

export class BackingTrack {
  constructor(context, { locked, onChange }) {
    this.context = context;
    this.locked = locked;
    this.onChange = onChange;
    this.original = null;
    this.buffer = null;
    this.name = '';
    this.semitones = 0;
    this.gainDb = -6;
    this.busy = false;
    this.error = '';
    this.generation = 0;
    this.source = null;
    this.offset = 0;
    this.started = 0;
    this.output = context.createGain();
    this.output.gain.value = 10 ** (this.gainDb / 20);
    this.monitor = context.createGain();
    this.output.connect(this.monitor).connect(context.destination);
  }

  checkUnlocked() {
    if (this.locked()) throw new Error(msg('error.backingLocked'));
  }

  get playing() {
    return this.source !== null;
  }

  get sampleRate() {
    return this.context.sampleRate;
  }

  async prepareChange(prepare, commit) {
    this.checkUnlocked();
    const generation = ++this.generation;
    this.busy = true;
    this.error = '';
    this.onChange();
    try {
      const prepared = await prepare();
      if (generation !== this.generation) return false;
      this.checkUnlocked();
      this.pause();
      commit(prepared);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.error = error.message;
      throw error;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.onChange();
      }
    }
  }

  load(file) {
    return this.prepareChange(
      async () => {
        const original = await this.context.decodeAudioData(await file.arrayBuffer());
        if (original.numberOfChannels > 2) throw new Error(msg('error.backingChannels'));
        const buffer = await prepareBacking(original, 0);
        const alignmentFrames = await measureVoiceAlignment(this.sampleRate);
        return { original, buffer, alignmentFrames };
      },
      ({ original, buffer, alignmentFrames }) => {
        this.offset = 0;
        this.alignmentFrames = alignmentFrames;
        this.original = original;
        this.buffer = buffer;
        this.name = file.name;
        this.semitones = 0;
      },
    );
  }

  async transpose(semitones) {
    this.checkUnlocked();
    if (!this.original) return false;
    return this.prepareChange(
      () => prepareBacking(this.original, semitones),
      (buffer) => {
        this.buffer = buffer;
        this.semitones = semitones;
      },
    );
  }

  remove() {
    this.checkUnlocked();
    this.generation++;
    this.pause();
    this.original = null;
    this.buffer = null;
    this.offset = 0;
    this.name = '';
    this.semitones = 0;
    this.busy = false;
    this.error = '';
    this.onChange();
  }

  setGain(db) {
    this.gainDb = Math.max(-36, Math.min(6, Number(db)));
    this.output.gain.setTargetAtTime(10 ** (this.gainDb / 20), this.context.currentTime, 0.01);
    this.onChange();
  }

  setMonitor(on) {
    this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.context.currentTime, 0.02);
  }

  position(when = this.context.currentTime) {
    return Math.min(
      this.buffer?.duration || 0,
      this.offset + (this.source ? Math.max(0, when - this.started) : 0),
    );
  }

  play(when = this.context.currentTime, offset = this.offset) {
    this.pause(when);
    if (!this.buffer || offset >= this.buffer.duration) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.output);
    source.onended = () => {
      source.disconnect();
      if (this.source !== source) return;
      this.offset = this.buffer.duration;
      this.source = null;
      this.onChange();
    };
    source.start(when, offset);
    this.source = source;
    this.offset = offset;
    this.started = when;
    this.onChange();
  }

  pause(when = this.context.currentTime) {
    if (!this.source) return;
    this.offset = this.position(when);
    const source = this.source;
    this.source = null;
    source.stop(when);
    this.onChange();
  }

  seek(position) {
    this.pause();
    this.offset = Math.max(0, Math.min(position, this.buffer?.duration || 0));
    this.onChange();
  }
}
