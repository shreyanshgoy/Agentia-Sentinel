// Human approvals are bound to the exact invocation (SHA-256 of tool + normalized args), single-use, and expire.
import fs from 'node:fs';
import path from 'node:path';
import { ensure, stateDir } from './state.js';
import { fingerprint, redact } from './audit.js';

const fpOf = (ctx) => fingerprint({ key: ctx.key, args: ctx.args, positionals: ctx.positionals || [] });
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export function requestApproval(ctx, ruleId, reason) {
  const fp = fpOf(ctx);
  const id = fp.slice(0, 10);
  const f = path.join(ensure('pending'), `${id}.json`);
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, JSON.stringify({ id, fp, key: ctx.key, actor: ctx.actor, channel: ctx.channel, ruleId, reason,
      args: redact(ctx.args), positionals: ctx.positionals || [], requestedAt: new Date().toISOString() }, null, 2));
  }
  return id;
}

export function consumeApproval(ctx) {
  const f = path.join(ensure('approvals'), `${fpOf(ctx)}.json`);
  const a = read(f);
  if (!a) return null;
  fs.rmSync(f, { force: true }); // single use, even if expired
  return Date.parse(a.expiresAt) > Date.now() ? a : null;
}

export function listPending() {
  const dir = path.join(stateDir(), 'pending');
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => read(path.join(dir, n))).filter(Boolean) : [];
}

export function approve(id, by, ttlMinutes) {
  const p = listPending().find((x) => x.id === id || x.id.startsWith(id));
  if (!p) throw new Error(`no pending request "${id}" (see: sentinel pending)`);
  const rec = { fp: p.fp, id: p.id, key: p.key, approvedBy: by, approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMinutes * 60000).toISOString() };
  fs.writeFileSync(path.join(ensure('approvals'), `${p.fp}.json`), JSON.stringify(rec, null, 2));
  fs.rmSync(path.join(stateDir(), 'pending', `${p.id}.json`), { force: true });
  return { ...rec, request: p };
}
