import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from './serve.mjs';

test('HTTP serves application files but never repository metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'belcanto-http-'));
  let server;
  try {
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git/config'), 'fixture metadata');
    await writeFile(join(root, 'index.html'), 'fixture application');
    server = createAppServer({ root });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const app = await fetch(base + '/');
    assert.equal(app.status, 200);
    assert.equal(await app.text(), 'fixture application');
    const metadata = await fetch(base + '/.git/config');
    assert.equal(metadata.status, 403);
    assert.notEqual(await metadata.text(), 'fixture metadata');
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP rejects internal notes, encoded traversal and symlinks outside public resources', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'belcanto-boundary-'));
  const root = join(parent, 'site');
  let server;
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'tools'));
    await mkdir(join(root, '.git'));
    await mkdir(join(parent, 'site-private'));
    await writeFile(join(root, 'src/app.js'), 'fixture module');
    await writeFile(join(root, 'tools/e2e.html'), 'fixture test page');
    await writeFile(join(root, 'COMPARE.md'), 'fixture private note');
    await writeFile(join(root, '.git/config'), 'fixture metadata');
    await writeFile(join(parent, 'site-private/note.txt'), 'fixture sibling');
    await symlink(join(parent, 'site-private/note.txt'), join(root, 'src/outside.js'));
    await symlink(join(root, '.git/config'), join(root, 'src/metadata.js'));
    server = createAppServer({ root });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/src/app.js', '/tools/e2e.html']) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    for (const path of [
      '/COMPARE.md',
      '/..%2Fsite-private/note.txt',
      '/src/outside.js',
      '/src/metadata.js',
    ]) {
      assert.equal((await fetch(base + path)).status, 403, path);
    }
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(parent, { recursive: true, force: true });
  }
});
