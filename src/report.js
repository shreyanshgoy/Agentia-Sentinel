import * as audit from './audit.js';

export function buildReport({ sinceDays } = {}) {
  const v = audit.verify();
  const cutoff = sinceDays ? Date.now() - sinceDays * 864e5 : 0;
  const all = audit.readAll().filter((e) => Date.parse(e.ts) >= cutoff);
  const decisions = all.filter((e) => e.type === 'decision');
  const results = new Map(all.filter((e) => e.type === 'result').map((e) => [e.ref, e]));
  const count = (f) => decisions.reduce((m, d) => ((m[f(d)] = (m[f(d)] || 0) + 1), m), {});
  const by = (title, obj) => `**${title}:** ` + (Object.entries(obj).map(([k, n]) => `${k} ${n}`).join(' | ') || 'none');
  const rows = (list) => list.map((d) => `| ${d.ts.slice(0, 19)}Z | #${d.seq} | ${d.actor}/${d.channel} | \`${d.tool}\` | ${d.risk} | ${d.ruleId} | ${d.approvedBy || ''} |`).join('\n');
  const head = '| Time | Seq | Actor/channel | Tool | Risk | Rule | Approved by |\n|---|---|---|---|---|---|---|';
  const section = (title, list) => list.length ? `\n## ${title} (${list.length})\n\n${head}\n${rows(list)}\n` : '';
  const failed = decisions.filter((d) => results.get(d.seq)?.ok === false);

  return `# Agentia Sentinel audit report\n\n` +
    `- Entries analysed: ${all.length} (${decisions.length} decisions)\n` +
    `- Chain integrity: ${v.ok ? `OK (${v.entries} entries, head ${v.head?.slice(0, 16)})` : `**BROKEN at seq ${v.brokenAt}: ${v.why}**`}\n\n` +
    [by('Outcome', count((d) => d.outcome)), by('Actor', count((d) => d.actor)), by('Channel', count((d) => d.channel)), by('Risk', count((d) => d.risk))].join('\n\n') + '\n' +
    section('Blocked', decisions.filter((d) => d.outcome === 'deny')) +
    section('Approval required (not yet approved)', decisions.filter((d) => d.outcome === 'approval-required')) +
    section('Executed with human approval', decisions.filter((d) => d.outcome === 'allow-approved')) +
    section('Allowed but failed at runtime', failed) +
    section('Critical actions that ran', decisions.filter((d) => d.risk === 'critical' && ['allow', 'allow-approved'].includes(d.outcome)));
}
