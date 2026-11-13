# BEL CANTO

A vocal effects processor that runs in your browser.

BEL CANTO processes live microphone input and audio files. Adjust pitch and formant independently, shape vocal tone with EQ and effects, compare two parameter settings, and export processed audio as WAV.

**[Open the live demo](https://chentaocalvin.github.io/bel-canto-voice/)**

## Try it

Open the demo in your browser. No installation is required.

1. Choose microphone or audio file mode.
2. Start the microphone and allow access, or load an audio file and press play.
3. Select a preset or adjust the controls. Use A/B to compare two settings.
4. Export the processed file as WAV, or record a microphone take and save it.

Use headphones when working with a live microphone to prevent speaker feedback.

## What you can do

- Adjust pitch and formant separately, with controls for vibrato, resonance, saturation, compression, chorus, and reverb.
- Start with one of six presets: Tenor, Soprano, Lyric Baritone, Choir Hall, Cathedral, or Studio.
- Compare two sets of parameters with A/B, while viewing the spectrum, waveform, and pitch display.
- Navigate audio files with the waveform timeline and an optional loop control.
- Record microphone input, pause and resume within the same take, then save or discard the recording.
- Export a complete audio file with the current effects and a three-second reverb tail.

## How it works

The application uses the Web Audio API, AudioWorklet, and JavaScript DSP.

Audio passes through input gain, pitch and formant processing, EQ, saturation, dynamics, and vibrato. The signal then splits into dry, chorus, and reverb paths before reaching the output.

### Pitch and formant

The pitch processor uses a short-time Fourier transform with spectral remapping and overlap-add reconstruction. It estimates the spectral envelope through cepstral smoothing so that formant adjustment can operate independently of pitch.

The Preserve control keeps the formant setting independent when pitch changes. Turning it off makes the formant follow the pitch shift.

### Dynamics and space

An AudioWorklet processor handles compression and soft-clipping limiting. Reverb uses a procedurally generated impulse response with early reflections, noise decay, and frequency-dependent damping.

### Playback and export

Real-time playback and offline export use the same audio-chain implementation and parameter mappings. Export renders the entire source file, regardless of the playhead position or loop setting.

The output is stereo, 16-bit PCM WAV at the current AudioContext sample rate. Muting speaker monitoring does not mute recordings or exported files.

## Run locally

Local development requires Node.js 22.13.0 or a later 22.x release, or Node.js 24 or later.

Clone the repository, then run:

```bash
npm ci
npm start
```

Open [http://127.0.0.1:5188](http://127.0.0.1:5188).

Use the local server instead of opening `index.html` directly. The application requires an HTTP context for its audio worklets.

## Testing

Run the formatting, lint, tool, DSP, and release-file checks:

```bash
npm run format:check
npm run lint
npm run test:tools
npm test
npm run check:release
```

DSP tests check pitch accuracy, formant separation, transparency at neutral settings, and stability at extreme parameter values.

Browser tests cover controls and presets, file playback, recording, and WAV export. They check behavior such as preserving paused recordings, exporting the full source duration, and keeping monitoring separate from recorded output.

<details>
<summary>Run the browser tests</summary>

Start the application in a separate terminal with `npm start`.

Set `CHROME` to a Chromium executable that supports `--headless=new`. If you use a different server port, set `BASE_URL` to the corresponding address.

Generate the synthetic audio input:

```bash
node tools/make-test-wav.mjs
```

Then run:

```bash
node tools/cdp-run.mjs
node tools/ui-test.mjs
node tools/file-test.mjs
node tools/export-test.mjs
node tools/rec-test.mjs
```

These tests use synthetic audio and simulated microphone input.

</details>

## Limitations

- The STFT stage adds 2,048 samples of latency. Total latency also depends on the browser and audio device.
- Large pitch shifts can produce audible phase artifacts.
- Changing the reverb size rebuilds the impulse response and may cause a brief click.
- Export uses the current AudioContext sample rate, which may differ from the source file.
- The hosted demo relies on the browser's audio-format support. If a file cannot be decoded, convert it to WAV before importing it. The local macOS server provides an additional conversion path for ALAC, AIFF, and CAF.

## Deployment

The source repository and website use separate release-file lists. Build the static website with:

```bash
npm run build
```

Publish the contents of `dist/` through an HTTPS static host. See the [deployment guide](https://github.com/chentaocalvin/bel-canto-voice/blob/main/DEPLOY.md) for the file lists and publishing steps.

## License

[MIT](https://github.com/chentaocalvin/bel-canto-voice/blob/main/LICENSE).
