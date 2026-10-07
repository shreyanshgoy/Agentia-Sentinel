// Claude Code PreToolUse hook. Forces agent shell calls through the guard and protects Sentinel's own state.
import fs from 'node:fs';
import path from 'node:path';
import { loadPolicy, policyPath } from './policy.js';
import { decide } from './guard.js';
import { contextFromArgv } from './runner.js';
import { stateDir } from './state.js';

export function shellSplit(s) {
  const out = []; let cur = ''; let q = null;
  for (const ch of s) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const base = (t) => path.basename(t || '').replace(/\.(cmd|exe|js|mjs)$/, '');

function agentiaArgv(tokens) {
  let t = [...tokens];
  while (t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]) || ['sudo', 'time', 'command', 'env'].includes(t[0]))) t.shift();
  if (base(t[0]) === 'npx') { t.shift(); while (t[0]?.startsWith('-')) t.shift(); if (!['agentia', '@copado/agentia-cli'].includes(t[0])) return null; return t.slice(1); }
  return base(t[0]) === 'agentia' ? t.slice(1) : null;
}

export function evaluateBash(command, policy) {
  if (/SENTINEL_(HOME|POLICY|TRUST_NONTTY|APPROVE_NONTTY|ACTOR)/.test(command))
    return { deny: 'Sentinel configuration cannot be changed from an agent shell.' };
  const segments = command.split(/&&|\|\||;|\||\n/).map((s) => shellSplit(s.trim())).filter((t) => t.length);
  for (const toks of segments) {
    const b = base(toks.find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) || '');
    if (b === 'sentinel' && toks.includes('approve')) return { deny: 'Agents cannot approve their own actions. A human must run `sentinel approve` in an interactive terminal.' };
  }
  if (/agentia/.test(command) && (/\$\(|`|\beval\b|\b(ba|z)?sh\s+-c\b/.test(command)))
    return { deny: 'This command wraps agentia in a way Sentinel cannot analyze. Run it plainly, or via `sentinel exec -- agentia ...`.' };
  for (const toks of segments) {
    const argv = agentiaArgv(toks);
    if (!argv) continue;
    const ctx = contextFromArgv(argv, 'agent');
    if (ctx.key === 'mcp.start') return { deny: 'Do not start the raw Agentia MCP server; use `sentinel mcp` so tool calls are governed.' };
    if (ctx.risk !== 'read') return { deny: `Run state-changing Agentia commands through Sentinel: sentinel exec -- agentia ${argv.join(' ')}` };
    const d = decide(policy, ctx);
    if (!d.allowed) return { deny: d.message };
  }
  return {};
}

export function evaluateFileEdit(filePath) {
  const p = path.resolve(filePath || '');
  const protectedPaths = [stateDir(), policyPath()];
  if (protectedPaths.some((x) => p === x || p.startsWith(x + path.sep)))
    return { deny: 'Sentinel policy and state files are protected from agent edits.' };
  return {};
}

export async function runHook(stdinText) {
  let input; try { input = JSON.parse(stdinText); } catch { return 0; }
  let verdict = {};
  if (input.tool_name === 'Bash') verdict = evaluateBash(input.tool_input?.command || '', loadPolicy());
  else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(input.tool_name)) verdict = evaluateFileEdit(input.tool_input?.file_path || input.tool_input?.notebook_path);
  if (verdict.deny) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.deny } }) + '\n');
  }
  return 0;
}

export function installHook(cwd = process.cwd(), binPath) {
  const f = path.join(cwd, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  const command = `node "${binPath}" hook`;
  s.hooks ||= {}; s.hooks.PreToolUse ||= [];
  s.hooks.PreToolUse = s.hooks.PreToolUse.filter((h) => !JSON.stringify(h).includes(' hook"') && !JSON.stringify(h).includes('sentinel.js'));
  s.hooks.PreToolUse.push({ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command }] });
  fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
  return f;
}
