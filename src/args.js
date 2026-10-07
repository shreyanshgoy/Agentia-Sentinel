// Parses an `agentia` argv into a canonical (key, args) shape shared with the MCP channel.
const BOOL = new Set(['json', 'yes', 'y', 'wait', 'nowait', 'deploy', 'help', 'h', 'recreatepromotionbranch',
  'done', 'abort', 'continue', 'gitsizer', 'stdin', 'force', 'verbose', 'v', 'version']);

export const norm = (k) => String(k).toLowerCase().replace(/[-_]/g, '');

export function parseCli(argv) {
  const args = {};
  const positionals = [];
  const set = (k, v) => {
    const key = norm(k);
    if (key in args) args[key] = [].concat(args[key], v);
    else args[key] = v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { set(a.slice(2, eq), a.slice(eq + 1)); continue; }
      const name = a.slice(2);
      const next = argv[i + 1];
      if (!BOOL.has(norm(name)) && next !== undefined && !next.startsWith('-')) { set(name, next); i++; }
      else set(name, true);
    } else if (a.startsWith('-') && a.length > 1) {
      for (const ch of a.slice(1)) set(ch, true);
    } else positionals.push(a);
  }
  const words = [];
  for (const p of positionals) { if (/^[a-z][a-z-]*$/.test(p)) words.push(p); else break; }
  return { words, positionals: positionals.slice(words.length), args };
}

// "cicd work environment-sync" -> "work.environment.sync"; MCP "agentia_data_template_get_detail" -> "data.template.get.detail"
export function cliKey(words) {
  const w = words[0] === 'cicd' ? words.slice(1) : words;
  return w.join('.').replace(/-/g, '.');
}
export function mcpKey(toolName) {
  return toolName.replace(/^agentia_/, '').replace(/[_-]/g, '.');
}
export function normArgs(obj = {}) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [norm(k), v]));
}
