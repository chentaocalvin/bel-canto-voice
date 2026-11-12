import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSource, buildSite, checkRelease } from './release.mjs';

test('source export contains only listed files and refuses existing destinations or symlinks', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'belcanto-release-'));
  const root = join(parent, 'source');
  const destination = join(parent, 'release');
  try {
    await mkdir(root);
    await writeFile(join(root, 'LICENSE'), 'fixture license');
    await writeFile(join(root, 'private.txt'), 'fixture note');
    await exportSource({ root, destination, files: ['LICENSE'] });
    assert.deepEqual(await readdir(destination), ['LICENSE']);
    assert.equal(await readFile(join(destination, 'LICENSE'), 'utf8'), 'fixture license');
    await assert.rejects(exportSource({ root, destination, files: ['LICENSE'] }), /exist/i);
    await assert.rejects(
      exportSource({ root, destination: join(parent, 'escape'), files: ['../private.txt'] }),
      /Invalid release path/,
    );
    await symlink(join(root, 'private.txt'), join(root, 'linked.txt'));
    await assert.rejects(
      exportSource({ root, destination: join(parent, 'linked'), files: ['linked.txt'] }),
      /Symbolic link/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('site build replaces stale output without touching files outside dist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'belcanto-build-'));
  try {
    await writeFile(join(root, 'LICENSE'), 'fixture license');
    await writeFile(join(root, 'index.html'), 'current application');
    await writeFile(join(root, 'keep.txt'), 'untouched');
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist/stale.txt'), 'stale output');
    await buildSite({ root, files: ['LICENSE', 'index.html'] });
    assert.deepEqual((await readdir(join(root, 'dist'))).sort(), ['LICENSE', 'index.html']);
    assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), 'current application');
    assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'untouched');
    await rm(join(root, 'dist'), { recursive: true });
    await symlink(root, join(root, 'dist'));
    await assert.rejects(buildSite({ root, files: ['LICENSE'] }), /dist must be a directory/);
    assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'untouched');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release lists reject operating system metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'belcanto-metadata-'));
  try {
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'tools'));
    await mkdir(join(root, '__MACOSX'));
    await writeFile(join(root, 'LICENSE'), 'fixture license');
    for (const path of ['src/.DS_Store', '__MACOSX/note.txt']) {
      await writeFile(join(root, path), 'fixture metadata');
      await assert.rejects(
        checkRelease({ root, manifest: { source: ['LICENSE', path], site: ['LICENSE'] } }),
        /Unsupported release path/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
