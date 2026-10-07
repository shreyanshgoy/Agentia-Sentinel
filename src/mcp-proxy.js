// Governed MCP gateway: sits between an MCP client (Claude Code, Cursor...) and `agentia mcp start`.
// Every tools/call is evaluated; blocked calls never reach Agentia and return an MCP tool error the model can read.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { loadPolicy, evaluate } from './policy.js';
import { mcpKey, normArgs } from './args.js';
import { classifyMcp } from './classify.js';
import { decide, recordResult } from './guard.js';
import { flushNotifications } from './notify.js';
import { agentiaCommand } from './runner.js';

export function runMcpProxy() {
  const policy = loadPolicy();
  const [cmd, cmdArgs] = agentiaCommand(['mcp', 'start']);
  const child = spawn(cmd, cmdArgs, { stdio: ['pipe', 'pipe', 'inherit'] });
  const meta = new Map();       // tool name -> annotations
  const listIds = new Set();    // request ids awaiting tools/list responses
  const inflight = new Map();   // request id -> { seq, t0 }
  const toClient = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o)) + '\n');
  const toServer = (o) => child.stdin.write((typeof o === 'string' ? o : JSON.stringify(o)) + '\n');
  const blocked = (id, text) => toClient({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text }] } });

  createInterface({ input: process.stdin }).on('line', (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return toServer(line); }
    if (Array.isArray(msg)) {
      if (msg.some((m) => m?.method === 'tools/call')) return toClient({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Sentinel does not allow batched tools/call' } });
      return toServer(line);
    }
    if (msg.method === 'tools/list' && msg.id !== undefined) listIds.add(msg.id);
    if (msg.method !== 'tools/call') return toServer(line);

    const name = msg.params?.name || '';
    const key = mcpKey(name);
    const args = normArgs(msg.params?.arguments);
    const risk = classifyMcp(key, args, meta.get(name));
    const d = decide(policy, { channel: 'mcp', actor: 'agent', key, args, positionals: [], risk });
    if (!d.allowed) return blocked(msg.id, d.message);
    inflight.set(msg.id, { seq: d.seq, t0: Date.now() });
    toServer(line);
  });

  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return toClient(line); }
    if (!Array.isArray(msg) && msg.id !== undefined) {
      if (listIds.delete(msg.id) && msg.result?.tools) {
        for (const t of msg.result.tools) {
          meta.set(t.name, t.annotations);
          const key = mcpKey(t.name);
          const risk = classifyMcp(key, {}, t.annotations);
          const v = evaluate(policy, { channel: 'mcp', actor: 'agent', key, args: {}, risk, now: new Date() });
          if (v.action === 'deny') t.description = `[Sentinel: blocked for agents] ${t.description || ''}`;
          else if (v.action === 'approve') t.description = `[Sentinel: needs human approval] ${t.description || ''}`;
        }
        return toClient(msg);
      }
      const f = inflight.get(msg.id);
      if (f) { inflight.delete(msg.id); recordResult(f.seq, { ok: !msg.error && !msg.result?.isError, durationMs: Date.now() - f.t0 }); }
    }
    toClient(line);
  });

  process.stdin.on('end', () => child.stdin.end());
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
  return new Promise((resolve) => child.on('exit', async (c) => { await flushNotifications(); resolve(c ?? 0); }));
}
