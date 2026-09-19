// edge hides console.debug by default, so diagnostics use console.warn.
// comment scrolling fires dozens of identical api calls and the repeat lines
// bury the signals that actually matter — each key logs once per page load.
const _seen = new Set<string>();

export function warnOnce(key: string, ...args: any[]): void {
  if (_seen.has(key)) return;
  _seen.add(key);
  console.warn('[ytm-comments]', ...args);
}
