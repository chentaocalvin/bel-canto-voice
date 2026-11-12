#!/usr/bin/env node

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || process.argv[2] || 5188);

const host = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

const MAX_UPLOAD = 400 * 1024 * 1024;

function isPublicResource(resource) {
  return (
    [
      'index.html',
      'styles.css',
      'LICENSE',
      '.nojekyll',
      'tools/e2e.html',
      'tools/test-vocal.wav',
    ].includes(resource) || /^src\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.js$/i.test(resource)
  );
}

async function handleConvert(req, res) {
  let dir = null;
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_UPLOAD) throw new Error('文件太大（上限 400MB）');
      chunks.push(chunk);
    }
    if (!total) throw new Error('没有收到文件内容');

    dir = await mkdtemp(join(tmpdir(), 'belcanto-'));
    const src = join(dir, 'input.bin');
    const dst = join(dir, 'output.wav');
    await writeFile(src, Buffer.concat(chunks));

    await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', src, dst], {
      timeout: 240000,
      maxBuffer: 4 * 1024 * 1024,
    });

    const wav = await readFile(dst);
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': wav.length,
      'Cache-Control': 'no-store',
    });
    res.end(wav);
  } catch (err) {
    const msg = /ENOENT/.test(String(err.message))
      ? '这台机器上没有 afconvert，无法转换 ALAC/无损格式，请先转成 WAV 或 MP3'
      : err.message;
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('转换失败：' + msg);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function createAppServer({ root = projectRoot } = {}) {
  const rootPath = realpath(root);
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/convert') {
      await handleConvert(req, res);
      return;
    }

    try {
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      const resource = pathname.slice(1);
      if (!isPublicResource(resource)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const boundary = await rootPath;
      const file = await realpath(join(boundary, resource));
      const within = relative(boundary, file);
      if (
        isAbsolute(within) ||
        within === '..' ||
        within.startsWith('..' + sep) ||
        !isPublicResource(within.split(sep).join('/'))
      ) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`BEL CANTO  →  http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);
    if (host === '0.0.0.0') {
      const nets = networkInterfaces();
      for (const list of Object.values(nets)) {
        for (const n of list || []) {
          if (n.family === 'IPv4' && !n.internal)
            console.log(`  局域网:  http://${n.address}:${port}`);
        }
      }
    }
  });
}
