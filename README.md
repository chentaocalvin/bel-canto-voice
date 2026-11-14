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

## Using a backing track

Choose **Load backing** in the transport area. Loading and transposing prepare the track without starting playback. The gain starts at -6 dB to leave mixing headroom. Vocal effects, presets, bypass, and the Out control affect the voice only. Transpose the backing from -6 to +6 semitones without changing its tempo.

In file mode, both tracks share playback, seeking, and looping. A shorter track becomes silent until the common loop restarts. A longer backing can finish. Changing Loop just before the end briefly pauses both tracks while they realign, then resumes at the same position. Export renders the complete mix, regardless of the playhead position or loop setting.

In microphone mode, preview the backing before recording, or choose its starting position. Starting a take includes the backing; pausing the take pauses the backing as well. Stop, then save or discard. The backing file and transpose are locked until the take is saved or discarded. Gain changes during the take are captured.

Use **Move saved vocal earlier (ms)** to adjust remaining recording offset. Positive values move the saved vocal earlier; negative values move it later. The default is zero. This setting is frozen for the take and does not change live monitoring. Use headphones and audition a short saved take with your microphone before recording a full performance.

## How it works

The application uses the Web Audio API, AudioWorklet, and JavaScript DSP.

Audio passes through input gain, pitch and formant processing, EQ, saturation, dynamics, and vibrato. The signal then splits into dry, chorus, and reverb paths before reaching the output.

### Pitch and formant

The pitch processor uses a short-time Fourier transform with spectral remapping and overlap-add reconstruction. It estimates the spectral envelope through cepstral smoothing so that formant adjustment can operate independently of pitch.

The Preserve control keeps the formant setting independent when pitch changes. Turning it off makes the formant follow the pitch shift.

### Dynamics and space

An AudioWorklet processor handles compression and soft-clipping limiting. Reverb uses a procedurally generated impulse response with early reflections, noise decay, and frequency-dependent damping.

### Playback and export

Real-time playback and offline export use the same audio-chain implementation and parameter mappings. Export renders the entire source file, regardless of the playhead position or loop setting. With backing, the output lasts for the longer of the backing or the vocal file plus its three-second effects tail.

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
node tools/backing-processor-test.mjs
node tools/backing-ui-test.mjs
node tools/backing-transport-test.mjs
node tools/backing-export-test.mjs
node tools/backing-recorder-test.mjs
node tools/backing-recording-test.mjs
npm run build
node tools/backing-site-test.mjs
```

These tests use synthetic audio and simulated microphone input.

</details>

## Limitations

- Live monitoring has processing and device latency. Backing alignment measures the fixed vocal processing delay; device latency still varies. The recording adjustment affects the saved take only.
- Large pitch shifts can produce audible phase artifacts.
- Backing pitch shifting can smear transients near the beginning or end of a track; the processed track keeps its original duration. Zero transpose uses the decoded audio unchanged.
- Synthetic browser checks do not replace listening to real music and microphone recordings on your device.
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

The bundled backing processor and its licenses are listed in [Third-party notices](THIRD_PARTY_NOTICES.md).

[MIT](https://github.com/chentaocalvin/bel-canto-voice/blob/main/LICENSE).
