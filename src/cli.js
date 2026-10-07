import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPolicy, policyPath, DEFAULT_POLICY_PATH, validatePolicy } from './policy.js';
import { runCli, stripBinary, agentiaBin, agentiaCommand } from './runner.js';
import { runHook, installHook } from './hook.js';
import { runMcpProxy } from './mcp-proxy.js';
import { approve, listPending } from './approvals.js';
import * as audit from './audit.js';
import { buildReport } from './report.js';
import { stateDir } from './state.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'sentinel.js');
const HELP = `Agentia Sentinel: policy, approvals and tamper-evident audit for Agentia CLI, hooks and MCP

  sentinel init                         write sentinel.policy.json and .sentinel/
  sentinel exec [--actor X] -- agentia <args...>     run agentia under policy (exit 13 denied, 14 needs approval)
  sentinel check -- agentia <args...>   explain what policy would do (also records a decision)
  sentinel pending                      list requests waiting for a human
  sentinel approve <id> [--ttl 30]      human approval for ONE exact invocation (interactive terminal only)
  sentinel audit show [--last N]        print recent audit entries
  sentinel audit verify                 verify the hash chain
  sentinel audit report [--since 7d]    markdown report
  sentinel mcp                          governed MCP server (use in place of "agentia mcp start")
  sentinel hook                         Claude Code PreToolUse hook (reads stdin)
  sentinel install-hook                 add the hook to .claude/settings.json
  sentinel doctor                       check setup end to end
`;

function flag(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'init': {
      const dest = path.resolve('sentinel.policy.json');
      if (!fs.existsSync(dest)) fs.copyFileSync(DEFAULT_POLICY_PATH, dest);
      fs.mkdirSync(stateDir(), { recursive: true });
      fs.writeFileSync(path.join(stateDir(), '.gitignore'), 'pending/\napprovals/\n.lock\n');
      console.log(`Policy: ${dest}\nState:  ${stateDir()}\nNext:   sentinel install-hook   (and point your MCP client at: sentinel mcp)`);
      return 0;
    }
    case 'exec': case 'check': {
      const sep = rest.indexOf('--');
      const opts = sep >= 0 ? rest.slice(0, sep) : [];
      const actor = flag(opts, 'actor');
      return runCli(stripBinary(sep >= 0 ? rest.slice(sep + 1) : rest), { actor, dryRun: cmd === 'check' });
    }
    case 'pending': {
      const p = listPending();
      if (!p.length) console.log('No pending approvals.');
      for (const x of p) console.log(`${x.id}  ${x.actor}/${x.channel}  ${x.key}  rule=${x.ruleId}  ${x.requestedAt}\n    args: ${JSON.stringify(x.args)} ${x.positionals.join(' ')}`);
      return 0;
    }
    case 'approve': {
      const args = [...rest];
      const ttl = Number(flag(args, 'ttl', loadPolicy().approvalTtlMinutes ?? 30));
      const id = args[0];
      if (!id) throw new Error('usage: sentinel approve <id> [--ttl minutes]');
      const pending = listPending().find((x) => x.id.startsWith(id));
      if (!pending) throw new Error(`no pending request "${id}"`);
      if (!process.stdin.isTTY && process.env.SENTINEL_APPROVE_NONTTY !== '1') throw new Error('approval needs an interactive terminal (a human must be present)');
      console.log(`Approve ${pending.key} (${pending.actor}/${pending.channel})\n  rule: ${pending.ruleId}\n  args: ${JSON.stringify(pending.args)} ${pending.positionals.join(' ')}`);
      if (process.stdin.isTTY) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ans = await rl.question('Type "approve" to confirm: '); rl.close();
        if (ans.trim() !== 'approve') { console.log('Cancelled.'); return 1; }
      }
      const rec = approve(id, os.userInfo().username, ttl);
      audit.append({ type: 'approval', approvalId: rec.id, tool: rec.key, approvedBy: rec.approvedBy, expiresAt: rec.expiresAt });
      console.log(`Approved by ${rec.approvedBy} until ${rec.expiresAt}. Single use. Ask the agent to retry.`);
      return 0;
    }
    case 'audit': {
      const [sub, ...a] = rest;
      if (sub === 'verify') { const v = audit.verify(); console.log(v.ok ? `OK: ${v.entries} entries, head ${v.head}` : `BROKEN at seq ${v.brokenAt}: ${v.why}`); return v.ok ? 0 : 2; }
      if (sub === 'report') {
        const s = flag(a, 'since'); console.log(buildReport({ sinceDays: s ? parseInt(s, 10) : undefined })); return 0;
      }
      if (sub === 'show') {
        const n = Number(flag(a, 'last', 20));
        for (const e of audit.readAll().slice(-n)) console.log(`#${e.seq} ${e.ts} ${e.type}${e.type === 'decision' ? ` ${e.actor}/${e.channel} ${e.tool} [${e.risk}] -> ${e.outcome} (${e.ruleId})` : e.type === 'result' ? ` ref=#${e.ref} ok=${e.ok}` : ` ${e.tool} by ${e.approvedBy}`}`);
        return 0;
      }
      throw new Error('usage: sentinel audit show|verify|report');
    }
    case 'mcp': return runMcpProxy();
    case 'hook': {
      let data = ''; for await (const c of process.stdin) data += c;
      return runHook(data);
    }
    case 'install-hook': console.log(`Hook installed in ${installHook(process.cwd(), BIN)}`); return 0;
    case 'doctor': {
      const ok = (b, msg) => { console.log(`${b ? 'PASS' : 'FAIL'}  ${msg}`); return b; };
      let good = true;
      const [vc, va] = agentiaCommand(['--version']);
      const v = spawnSync(vc, va, { encoding: 'utf8' });
      good &= ok(v.status === 0, v.status === 0 ? `agentia found: ${v.stdout.trim()}` : `agentia not runnable ("${agentiaBin()}"); npm i -g @copado/agentia-cli@beta`);
      try { const p = policyPath(); const errs = validatePolicy(JSON.parse(fs.readFileSync(p, 'utf8'))); good &= ok(!errs.length, `policy ${p}${errs.length ? ': ' + errs.join('; ') : ''}`); }
      catch (e) { good &= ok(false, `policy unreadable: ${e.message}`); }
      const av = audit.verify(); good &= ok(av.ok, `audit chain ${av.ok ? `intact (${av.entries} entries)` : `broken at #${av.brokenAt}`}`);
      const s = path.resolve('.claude', 'settings.json');
      good &= ok(fs.existsSync(s) && fs.readFileSync(s, 'utf8').includes('sentinel.js'), 'Claude Code hook installed (sentinel install-hook)');
      console.log(`INFO  webhook ${process.env.SENTINEL_WEBHOOK ? 'configured' : 'not set (SENTINEL_WEBHOOK)'}`);
      return good ? 0 : 1;
    }
    default: console.log(HELP); return cmd ? 1 : 0;
  }
}
