import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function createRunDirectory({ parent = tmpdir(), prefix = 'belcanto-' } = {}) {
  if (!/^[a-zA-Z0-9-]+$/.test(prefix)) throw new Error('Invalid temporary directory prefix');
  const base = resolve(parent);
  mkdirSync(base, { recursive: true });
  const path = mkdtempSync(join(base, prefix));
  let cleaned = false;
  return {
    path,
    cleanup() {
      if (cleaned) return;
      rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      cleaned = true;
    },
  };
}
