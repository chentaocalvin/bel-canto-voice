import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: root });
const results = await eslint.lintFiles(['src/**/*.js', 'tools/**/*.mjs', 'eslint.config.mjs']);
const html = await readFile(new URL('./e2e.html', import.meta.url), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  results.push(...(await eslint.lintText(match[1], { filePath: 'tools/e2e.browser.js' })));
}
const formatter = await eslint.loadFormatter('stylish');
const output = formatter.format(results);
if (output) console.log(output);
const errors = results.reduce((sum, result) => sum + result.errorCount + result.warningCount, 0);
console.log(`Linted ${results.length} source units; ${errors} diagnostics`);
process.exitCode = errors ? 1 : 0;
