export function titleExitCode(title, success = /^E2E_PASS$/) {
  if (/^E2E_(FAIL|ERROR)/.test(title)) return 1;
  success.lastIndex = 0;
  return success.test(title) ? 0 : null;
}
