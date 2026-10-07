const READ_LAST = new Set(['list', 'get', 'open', 'search', 'match', 'status', 'logs', 'log', 'files', 'refs', 'fields',
  'relationships', 'compare', 'check', 'help', 'defaults', 'validate', 'detail', 'updates', 'types', 'flows', 'content',
  'latest', 'history', 'screenshot', 'reports', 'inspect', 'quota', 'resolve', 'prompt', 'chat', 'ask', 'info']);

export const CRITICAL = ['promotion.run', 'cloud.promote', 'work.done', 'work.submit', 'work.delete', 'job.kill',
  'work.environment.sync', 'data.sync.apply', 'repository.reset', 'auth.set', '*.delete'];

export function globToRe(glob) {
  return new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}
// A glob matches the key itself or any dot-separated prefix of it (so "work.create" matches "work.create.title").
export function globMatchesKey(glob, key) {
  const re = globToRe(glob);
  const segs = key.split('.');
  for (let n = segs.length; n >= 1; n--) if (re.test(segs.slice(0, n).join('.'))) return true;
  return false;
}
const isCritical = (key, args) =>
  CRITICAL.some((g) => globMatchesKey(g, key)) || (args.deploy && args.deploy !== false) || args.operation === 'merge_and_deploy';

const last = (key) => key.split('.').pop();

export function classifyCli(key, args, words) {
  if (args.help || args.h || words[0] === 'help') return 'read';
  if (isCritical(key, args)) return 'critical';
  return READ_LAST.has(last(key)) ? 'read' : 'write'; // unknown verbs fail safe to "write"
}
export function classifyMcp(key, args, ann) {
  if (isCritical(key, args)) return 'critical';
  if (ann?.readOnlyHint) return 'read';
  if (!ann?.destructiveHint && READ_LAST.has(last(key))) return 'read';
  return 'write';
}
