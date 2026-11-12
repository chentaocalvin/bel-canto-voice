export function createPageErrors() {
  const unexpected = [];
  const expected = [];
  let active = null;
  const record = (event) => {
    let kind;
    let description;
    if (event.method === 'Runtime.exceptionThrown') {
      kind = 'exception';
      const details = event.params.exceptionDetails;
      description = details.exception?.description || details.text;
    } else if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
      kind = 'console.error';
      description = (event.params.args || [])
        .map((arg) => arg.value ?? arg.description ?? '')
        .join(' ');
    } else return;
    const message = String(description).split('\n')[0];
    const error = { kind, message, description };
    if (active && !active.observed && active.kind === kind && active.message === message) {
      active.observed = true;
      expected.push(error);
    } else unexpected.push(error);
  };
  return {
    record,
    unexpected,
    expected,
    async expect({ kind, message }, action) {
      if (active) throw new Error('Page error expectations cannot overlap');
      const expectation = { kind, message, observed: false };
      active = expectation;
      try {
        const result = await action();
        if (!expectation.observed)
          throw new Error(`Expected page error was not observed: ${message}`);
        return result;
      } finally {
        active = null;
      }
    },
  };
}
