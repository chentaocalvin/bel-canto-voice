const show = (v) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

export function createChecks() {
  const items = [];
  const failed = () => items.filter((c) => !c.pass);

  const api = {
    add(name, pass, expected, actual) {
      const item = { name, pass: !!pass, expected, actual };
      items.push(item);
      console.log(
        `  ${item.pass ? '✓' : '✗'} ${name}${item.pass ? '' : `  (期望 ${show(expected)}，实际 ${show(actual)})`}`,
      );
      return item;
    },
    addAll(list) {
      for (const c of list) api.add(c.name, c.pass, c.expected, c.actual);
    },
    get items() {
      return items;
    },
    report(passLabel, failLabel) {
      const bad = failed();
      if (bad.length) {
        console.log(`\n--- 失败项 ${bad.length}/${items.length} ---`);
        for (const f of bad)
          console.log(`✗ ${f.name}\n    期望: ${show(f.expected)}\n    实际: ${show(f.actual)}`);
      }
      console.log(
        `\n${bad.length ? failLabel : passLabel}  ${items.length - bad.length}/${items.length} 项通过`,
      );
      return bad.length === 0;
    },
  };
  return api;
}
