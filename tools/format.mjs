import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(
  await readFile(new URL('../release-files.json', import.meta.url), 'utf8'),
);
const write = process.argv[2] === '--write';
if (!write && process.argv[2] !== '--check') throw new Error('Expected --check or --write');
const files = manifest.source.filter((path) => /\.(?:js|mjs|json|html|css|md)$/.test(path));
let failures = 0;
for (const file of files) {
  const path = resolve(root, file);
  const input = await readFile(path, 'utf8');
  const options = { ...(await prettier.resolveConfig(path)), filepath: path };
  if (write) await writeFile(path, await prettier.format(input, options));
  else if (!(await prettier.check(input, options))) {
    console.error('Formatting differs:', file);
    failures++;
  }
}
console.log(`${write ? 'Formatted' : 'Checked'} ${files.length} files; ${failures} differences`);
process.exitCode = failures ? 1 : 0;
