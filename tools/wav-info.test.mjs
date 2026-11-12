import test from 'node:test';
import assert from 'node:assert/strict';
import { compareExportedWavs } from './wav-info.mjs';

function fixtureWav() {
  const buffer = Buffer.alloc(4044);
  buffer.write('RIFF');
  buffer.writeUInt32LE(4036, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(1000, 24);
  buffer.writeUInt32LE(4000, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(4000, 40);
  for (let offset = 44; offset < buffer.length; offset += 2) buffer.writeInt16LE(4096, offset);
  return buffer;
}

test('repeat exports must both be complete WAVs before quantization comparison', () => {
  const first = fixtureWav();
  const expected = { sourceDuration: 1, sampleRate: 1000, bufferLength: 1000, tailSeconds: 0 };
  assert.equal(compareExportedWavs(first, Buffer.from(first), expected).pass, true);
  assert.equal(
    compareExportedWavs(first, first.subarray(0, first.length - 2), expected).pass,
    false,
  );
  assert.equal(
    compareExportedWavs(first, Buffer.concat([first, Buffer.from([0, 0])]), expected).pass,
    false,
  );
  const changed = Buffer.from(first);
  changed.writeInt16LE(4100, 44);
  assert.equal(compareExportedWavs(first, changed, expected).pass, false);
});
