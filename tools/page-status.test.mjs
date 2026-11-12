import test from 'node:test';
import assert from 'node:assert/strict';
import { titleExitCode } from './page-status.mjs';

test('failure and error titles cannot pass a broad completion pattern', () => {
  assert.equal(titleExitCode('E2E_FAIL', /^E2E_/), 1);
  assert.equal(titleExitCode('E2E_ERROR', /^E2E_/), 1);
  assert.equal(titleExitCode('E2E_PASS'), 0);
  assert.equal(titleExitCode('E2E'), null);
  assert.equal(titleExitCode('E2E_PASSING'), null);
  assert.equal(titleExitCode('CUSTOM_PASS', /^CUSTOM_PASS$/), 0);
});
