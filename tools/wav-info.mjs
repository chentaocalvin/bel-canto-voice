import { readFileSync, statSync } from 'node:fs';

const ascii = (buf, off, n) => buf.toString('ascii', off, off + n);
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

export function parseWav(buffer, label = 'wav') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return fail(`文件太短（${buffer?.length ?? 0} 字节，至少需要 12 字节）`, {
      label,
      fileSize: buffer?.length ?? 0,
    });
  }
  const riff = ascii(buffer, 0, 4);
  const wave = ascii(buffer, 8, 4);
  if (riff !== 'RIFF')
    return fail(`RIFF 标识是 ${JSON.stringify(riff)}，期望 "RIFF"`, {
      label,
      riff,
      wave,
      fileSize: buffer.length,
    });
  if (wave !== 'WAVE')
    return fail(`WAVE 标识是 ${JSON.stringify(wave)}，期望 "WAVE"`, {
      label,
      riff,
      wave,
      fileSize: buffer.length,
    });

  let fmt = null;
  let data = null;
  let off = 12;
  while (off + 8 <= buffer.length) {
    const id = ascii(buffer, off, 4);
    const size = buffer.readUInt32LE(off + 4);
    const body = off + 8;
    if (body + size > buffer.length) {
      return fail(
        `chunk ${JSON.stringify(id)} 声明 ${size} 字节，超出文件末尾（剩余 ${buffer.length - body} 字节）`,
        {
          label,
          riff,
          wave,
          fileSize: buffer.length,
        },
      );
    }
    if (id === 'fmt ') {
      if (size < 16)
        return fail(`fmt chunk 只有 ${size} 字节，至少需要 16 字节`, {
          label,
          riff,
          wave,
          fileSize: buffer.length,
        });
      fmt = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        blockAlign: buffer.readUInt16LE(body + 12),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = { offset: body, bytes: size };
      break;
    }
    off = body + size + (size & 1);
  }

  if (!fmt) return fail('没有找到 fmt chunk', { label, riff, wave, fileSize: buffer.length });
  if (!data) return fail('没有找到 data chunk', { label, riff, wave, fileSize: buffer.length });

  const blockAlign = fmt.blockAlign || fmt.channels * Math.ceil(fmt.bitsPerSample / 8);
  const duration =
    blockAlign > 0 && fmt.sampleRate > 0 ? data.bytes / (fmt.sampleRate * blockAlign) : 0;

  let peak = 0;
  const samples = Math.floor(data.bytes / 2);
  for (let i = 0; i < samples; i++) {
    const v = Math.abs(buffer.readInt16LE(data.offset + i * 2)) / 32768;
    if (v > peak) peak = v;
  }

  const dataEnd = data.offset + data.bytes;
  return {
    ok: true,
    label,
    fileSize: buffer.length,
    riff,
    wave,
    riffSize: buffer.readUInt32LE(4),
    ...fmt,
    dataOffset: data.offset,
    dataBytes: data.bytes,
    trailingBytes: buffer.length - dataEnd,
    duration,
    peak,
    samples,
  };
}

export function readWavFile(path) {
  try {
    const buf = readFileSync(path);
    const st = statSync(path);
    return {
      ...parseWav(buf, path),
      path,
      fileSize: buf.length,
      mtimeMs: st.mtimeMs,
      birthtimeMs: st.birthtimeMs,
    };
  } catch (err) {
    return { ok: false, error: err.message, path, fileSize: 0, mtimeMs: 0, birthtimeMs: 0 };
  }
}

export function describeWav(info) {
  if (!info.ok) return `解析失败: ${info.error}`;
  return `RIFF/WAVE ${info.channels}ch ${info.sampleRate}Hz ${info.bitsPerSample}bit ${info.duration.toFixed(3)}s peak=${info.peak.toFixed(3)}`;
}

export function verifyExportedWav(
  info,
  {
    sourceDuration,
    sampleRate,
    bufferLength = null,
    channels = 2,
    bitsPerSample = 16,
    tailSeconds = 3,
    tolerance = 0.15,
  } = {},
) {
  const out = [];
  const add = (name, pass, expected, actual) => out.push({ name, pass: !!pass, expected, actual });
  const n = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

  add(
    'WAV 头是 RIFF/WAVE',
    info.ok && info.riff === 'RIFF' && info.wave === 'WAVE',
    'RIFF/WAVE',
    info.ok ? `${info.riff}/${info.wave}` : `解析失败: ${info.error}`,
  );
  add(
    `PCM ${bitsPerSample}bit`,
    info.ok && info.audioFormat === 1 && info.bitsPerSample === bitsPerSample,
    `audioFormat=1 / ${bitsPerSample}bit`,
    info.ok ? `audioFormat=${info.audioFormat} / ${info.bitsPerSample}bit` : 'n/a',
  );
  add(
    `声道数 = ${channels}`,
    info.ok && info.channels === channels,
    channels,
    info.ok ? info.channels : 'n/a',
  );
  add(
    `采样率 = ${sampleRate}Hz（当前 AudioContext）`,
    info.ok && info.sampleRate === sampleRate,
    sampleRate,
    info.ok ? info.sampleRate : 'n/a',
  );

  const expectedDuration = sourceDuration + tailSeconds;
  add(
    `时长 = 源 ${n(sourceDuration)}s + ${tailSeconds}s 尾音（±${tolerance}s）`,
    info.ok && Math.abs(info.duration - expectedDuration) <= tolerance,
    `${n(expectedDuration)}s ±${tolerance}s`,
    info.ok ? `${n(info.duration)}s` : 'n/a',
  );

  if (bufferLength != null) {
    const expectedBytes =
      (bufferLength + tailSeconds * sampleRate) * channels * (bitsPerSample / 8);
    add(
      'data 长度 =（源帧数 + 尾音帧数）× 声道 × 字节',
      info.ok && info.dataBytes === expectedBytes,
      expectedBytes,
      info.ok ? info.dataBytes : 'n/a',
    );
  }

  add(
    '44 字节头、RIFF 长度自洽、无尾随数据',
    info.ok &&
      info.dataOffset === 44 &&
      info.trailingBytes === 0 &&
      info.riffSize + 8 === info.fileSize,
    'dataOffset=44 / trailingBytes=0 / riffSize+8=fileSize',
    info.ok
      ? `dataOffset=${info.dataOffset} / trailingBytes=${info.trailingBytes} / riffSize+8=${info.riffSize + 8} / fileSize=${info.fileSize}`
      : 'n/a',
  );
  add(
    '导出不是静音（peak > 0.001）',
    info.ok && info.peak > 0.001,
    '> 0.001',
    info.ok ? n(info.peak, 4) : 'n/a',
  );

  return out;
}

export function compareExportedWavs(first, second, expected) {
  const firstInfo = parseWav(first, 'first export');
  const secondInfo = parseWav(second, 'second export');
  const checks = [
    ...verifyExportedWav(firstInfo, expected).map((check) => ({
      ...check,
      name: `First export: ${check.name}`,
    })),
    ...verifyExportedWav(secondInfo, expected).map((check) => ({
      ...check,
      name: `Second export: ${check.name}`,
    })),
    {
      name: 'Repeat exports have identical byte lengths',
      pass: first.length === second.length,
      expected: first.length,
      actual: second.length,
    },
  ];
  if (checks.some((check) => !check.pass)) return { pass: false, checks };
  let headerDiff = 0;
  let sampleDiff = 0;
  let maxLSB = 0;
  for (let i = 0; i < 44; i++) if (first[i] !== second[i]) headerDiff++;
  for (let i = 44; i < first.length; i += 2) {
    const difference = Math.abs(first.readInt16LE(i) - second.readInt16LE(i));
    if (difference) sampleDiff++;
    maxLSB = Math.max(maxLSB, difference);
  }
  const totalSamples = (first.length - 44) / 2;
  const allowed = Math.floor(totalSamples * 0.0002);
  return {
    pass: headerDiff === 0 && maxLSB <= 1 && sampleDiff <= allowed,
    checks,
    headerDiff,
    sampleDiff,
    maxLSB,
    totalSamples,
    allowed,
  };
}
