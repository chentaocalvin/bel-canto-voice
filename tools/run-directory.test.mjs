import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunDirectory } from './run-directory.mjs';

test('a removal failure remains visible and does not mark the run as cleaned', (t) => {
  const run = createRunDirectory();
  const failure = Object.assign(new Error('directory remains nonempty'), { code: 'ENOTEMPTY' });
  const mock = t.mock.method(fs, 'rmSync', (path) => {
    assert.equal(path, run.path);
    throw failure;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => run.cleanup(),
      (error) => error === failure,
    );
    assert.equal(existsSync(run.path), true);
  } finally {
    mock.mock.restore();
    syncBuiltinESMExports();
    run.cleanup();
  }
  assert.equal(existsSync(run.path), false);
});

test('run cleanup preserves the configured parent and other runs', () => {
  const parent = mkdtempSync(join(tmpdir(), 'belcanto-parent-'));
  try {
    const sentinel = join(parent, 'keep.txt');
    writeFileSync(sentinel, 'untouched');
    const first = createRunDirectory({ parent });
    const second = createRunDirectory({ parent });
    assert.notEqual(first.path, second.path);
    writeFileSync(join(first.path, 'result.txt'), 'owned');
    first.cleanup();
    first.cleanup();
    assert.equal(existsSync(first.path), false);
    assert.equal(existsSync(second.path), true);
    assert.equal(readFileSync(sentinel, 'utf8'), 'untouched');
    second.cleanup();
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
