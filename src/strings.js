export const PRESET_NAMES = {
  tenor: 'Tenor',
  soprano: 'Soprano',
  baritone: 'Lyric Baritone',
  choir: 'Choir Hall',
  cathedral: 'Cathedral',
  studio: 'Studio',
};

export const CUSTOM_PRESET_LABEL = 'Custom';
export const presetName = (id) => PRESET_NAMES[id] || id;

const MESSAGES = {
  'app.monitorOn': '🔊 Monitor',
  'app.monitorOff': '🔇 Muted',
  'app.monitorTitleOn': 'Mute speaker monitoring (recording and export keep running)',
  'app.monitorTitleOff': 'Restore speaker monitoring (recording and export keep running)',

  'transport.enableMic': 'Enable mic',
  'transport.disableMic': 'Disable mic',
  'transport.record': 'Record',
  'transport.stop': 'Stop',
  'transport.rerecord': 'Record again',
  'transport.recordAriaStart': 'Start recording',
  'transport.recordAriaStop': 'Stop recording',
  'transport.recordAriaRerecord': 'Record again (discards the unsaved take)',
  'transport.pause': 'Pause',
  'transport.resume': 'Resume',
  'transport.pauseAria': 'Pause recording',
  'transport.resumeAria': 'Resume recording',
  'transport.play': 'Play',
  'transport.pausePlayback': 'Pause playback',

  'status.ready': 'Ready · choose an input',
  'status.bypass': 'Bypassed · dry signal',
  'status.micLive': 'Microphone · Live',
  'status.micOff': 'Microphone mode · mic off',
  'status.micUnavailable': 'Microphone unavailable',
  'status.fileNoFile': 'File mode · no file loaded',
  'status.filePlaying': 'File · {name} · Playing',
  'status.fileLoaded': 'File · {name} · Loaded',
  'status.decoding': 'Decoding…',
  'status.converting': 'Converting with the system decoder…',
  'status.decodeFailed': "Couldn't decode file",
  'status.rendering': 'Rendering offline…',
  'status.exported': 'Export complete',
  'status.exportFailed': 'Export failed',
  'status.latency': 'LATENCY ≈ {ms} ms · {khz} kHz',

  'progress.decoding': 'Decoding…',
  'progress.saveFailed': 'Save failed',

  'toast.preset': 'Preset: {name}',
  'toast.defaultsReset': 'Defaults restored',
  'toast.ab': 'A/B → {slot}',
  'toast.monitorOn': 'Monitoring on',
  'toast.monitorOff': 'Monitoring muted · recording and export unaffected',
  'toast.enterMic': 'Microphone mode · click “Enable mic” to start',
  'toast.enterFile': 'File mode · click “Choose file” to load',
  'toast.micOn': 'Microphone on · headphones recommended',
  'toast.micOff': 'Microphone off',
  'toast.converting':
    "This codec isn't supported natively. Converting to WAV with the system decoder…",
  'toast.loaded': 'Loaded {name} ({duration}s)',
  'toast.loadedAfterDiscard': 'Unsaved recording discarded · loaded {name} ({duration}s)',
  'toast.decodeFailed': "Couldn't decode this file: {message}",
  'toast.loopOn': 'Loop on',
  'toast.loopOff': 'Loop off',
  'toast.exportLong':
    'Long file ({minutes} min). Offline rendering takes a while; please keep this page open.',
  'toast.exportRendering': 'Rendering offline · same length as the file plus a 3 s tail',
  'toast.exported': 'WAV exported',
  'toast.exportFailed': 'Export failed: {message}',
  'toast.recMicFirst': 'Enable the microphone first',
  'toast.recStartFailed': "Couldn't start recording: {message}",
  'toast.recEmpty': 'Empty take · discarded',
  'toast.recDone': 'Recorded {seconds}s · save or discard',
  'toast.recDiscarded': 'Take discarded',
  'toast.recDiscardedReason': 'Take discarded ({reason})',
  'toast.recSaved': 'Recording exported',
  'toast.recSaveFailed': "Couldn't export recording: {message}",
  'toast.recPauseFailed': "Couldn't pause recording: {message}",
  'toast.recResumeFailed': "Couldn't resume recording: {message}",
  'toast.recStopFailed': "Couldn't stop recording: {message}",
  'toast.previousTakeDiscarded': 'The previous unsaved recording was discarded',
  'error.webAudio': "This browser doesn't support Web Audio.",
  'error.audioWorklet':
    "This browser doesn't support AudioWorklet. Use a current Chrome, Safari, or Edge.",
  'error.micOpen': "Couldn't open the microphone: {message}",
  'error.micDenied':
    'Microphone access was denied. Use the lock icon in the address bar to allow it, or switch to an audio file.',
  'error.convertUnavailable':
    "No local conversion service on this page, so ALAC/lossless files can't be decoded. Convert to WAV or MP3 first.",
  'error.convertUnsupported':
    "This format needs the local conversion service, which isn't available here. Convert to WAV or MP3 first.",
  'error.decodeFile': "Couldn't decode this file: {message}",
  'error.recordDecode': "couldn't decode",
  'reason.switchSource': 'switching input',
  'reason.rerecord': 'new take',
  'reason.recError': 'recording error',
  'reason.recStart': 'recording failed to start',
  'reason.stopFailed': 'stop failed',
  'reason.pageLeft': 'page left',
};

export function msg(key, vars) {
  const raw = MESSAGES[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}
