import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function validatePath(path) {
  if (
    typeof path !== 'string' ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid release path: ${path}`);
  }
}

async function checkedFile(root, path) {
  validatePath(path);
  const boundary = await realpath(root);
  const file = join(boundary, path);
  const target = await realpath(file);
  if (target !== file) throw new Error(`Symbolic link is not a release file: ${path}`);
  if (!(await lstat(file)).isFile()) throw new Error(`Release entry is not a file: ${path}`);
  return file;
}

export async function exportSource({ root, destination, files }) {
  const sources = await Promise.all(files.map((path) => checkedFile(root, path)));
  await mkdir(destination);
  try {
    for (let index = 0; index < files.length; index++) {
      const target = join(destination, files[index]);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(sources[index], target);
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export async function buildSite({ root, files }) {
  const destination = join(root, 'dist');
  let previous = false;
  try {
    const entry = await lstat(destination);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error('dist must be a directory, not a symbolic link');
    previous = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const staging = await mkdtemp(join(root, '.site-build-'));
  const output = join(staging, 'site');
  const backup = join(staging, 'previous');
  let hasBackup = false;
  let built = false;
  try {
    await exportSource({ root, destination: output, files });
    if (previous) {
      await rename(destination, backup);
      hasBackup = true;
    }
    try {
      await rename(output, destination);
      built = true;
    } catch (error) {
      if (previous) {
        await rename(backup, destination);
        hasBackup = false;
      }
      throw error;
    }
  } finally {
    if (built || !hasBackup) await rm(staging, { recursive: true, force: true });
  }
  return destination;
}

async function sourceFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory())
      files.push(...(await sourceFiles(join(directory, entry.name), path + '/')));
    else files.push(path);
  }
  return files;
}

export async function checkRelease({ root, manifest }) {
  if (!Array.isArray(manifest.source) || !Array.isArray(manifest.site))
    throw new Error('Release manifest needs source and site lists');
  for (const [kind, files] of Object.entries(manifest)) {
    if (new Set(files).size !== files.length) throw new Error(`Duplicate entries in ${kind} list`);
    if (!files.includes('LICENSE')) throw new Error(`LICENSE is missing from ${kind} list`);
    for (const path of files) {
      await checkedFile(root, path);
      if (
        path
          .split('/')
          .some((part) =>
            [
              '.git',
              'node_modules',
              'dist',
              'demo',
              '.DS_Store',
              '__MACOSX',
              'Thumbs.db',
              'desktop.ini',
            ].includes(part),
          )
      )
        throw new Error(`Unsupported release path: ${path}`);
      if (kind === 'site' && !manifest.source.includes(path))
        throw new Error(`Site file absent from source list: ${path}`);
    }
  }
  for (const folder of ['src', 'tools']) {
    for (const path of await sourceFiles(join(root, folder), folder + '/')) {
      if (/\.(?:js|mjs|html)$/.test(path) && !manifest.source.includes(path))
        throw new Error(`Unlisted source file: ${path}`);
    }
  }
  const patterns = [
    /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];
  for (const path of manifest.source) {
    if (!/\.(?:md|js|mjs|json|html|css)$/.test(path)) continue;
    const content = await readFile(join(root, path), 'utf8');
    if (patterns.some((pattern) => pattern.test(content)))
      throw new Error(`Release text needs review: ${path}`);
    if (path.endsWith('.md') && /\b(?:TODO|FIXME)\b/.test(content))
      throw new Error(`Unfinished documentation: ${path}`);
  }
  return { sourceFiles: manifest.source.length, siteFiles: manifest.site.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'release-files.json'), 'utf8'));
  const command = process.argv[2];
  const counts = await checkRelease({ root: projectRoot, manifest });
  if (command === 'check') console.log('Release lists verified:', counts);
  else if (command === 'build') {
    console.log('Static site:', await buildSite({ root: projectRoot, files: manifest.site }));
  } else if (command === 'source') {
    if (!process.argv[3]) throw new Error('Usage: npm run release:source -- <new-directory>');
    const destination = resolve(process.argv[3]);
    await exportSource({ root: projectRoot, destination, files: manifest.source });
    console.log('Source release:', destination);
  } else throw new Error('Expected release command: check, build or source');
}
