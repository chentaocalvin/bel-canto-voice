import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageErrors } from './page-errors.mjs';

const consoleError = (text) => ({
  method: 'Runtime.consoleAPICalled',
  params: { type: 'error', args: [{ description: text }] },
});

test('only one exact error inside its injection scope is expected', async () => {
  const errors = createPageErrors();
  await errors.expect(
    { kind: 'console.error', message: 'Error: synthetic decode failure' },
    async () => {
      errors.record(consoleError('Error: synthetic decode failure\n    at fixture'));
      errors.record(consoleError('Error: unrelated failure'));
      errors.record(consoleError('Error: synthetic decode failure\n    at duplicate'));
    },
  );
  errors.record(consoleError('Error: synthetic decode failure'));
  assert.equal(errors.unexpected.length, 3);
  assert.equal(errors.expected.length, 1);
});

test('unhandled exceptions fail and a missing expected error is not silently accepted', async () => {
  const errors = createPageErrors();
  errors.record({
    method: 'Runtime.exceptionThrown',
    params: { exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: broken' } } },
  });
  assert.equal(errors.unexpected.length, 1);
  await assert.rejects(
    errors.expect({ kind: 'console.error', message: 'Error: absent' }, async () => {}),
    /Expected page error was not observed/,
  );
});
