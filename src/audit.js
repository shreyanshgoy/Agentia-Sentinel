// Append-only, hash-chained JSONL. Editing or deleting any past line breaks every later hash.
// Tamper-EVIDENT, not tamper-proof: anchor the head hash externally (webhook) for stronger guarantees.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stateDir, ensure } from './state.js';

const GENESIS = '0'.repeat(64);
const file = () => path.join(stateDir(), 'audit.jsonl');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashOf = (e) => { const { hash, ...rest } = e; return sha(JSON.stringify(rest)); };

export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const fingerprint = (o) => sha(canon(o));

const SECRET = /(token|secret|password|passwd|key|credential|authorization)/i;
export function redact(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (SECRET.test(k)) { out[k] = '[REDACTED]'; continue; }
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    out[k] = s && s.length > 200 ? `[${s.length} bytes sha256:${sha(s).slice(0, 12)}]` : v;
  }
  return out;
}

function withLock(fn) {
  const dir = ensure();
  const lock = path.join(dir, '.lock');
  for (let i = 0; i < 100; i++) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (i === 99 || (Date.now() - fs.statSync(lock).mtimeMs > 5000)) { try { fs.rmdirSync(lock); } catch {} }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch {} }
}

export function readAll() {
  if (!fs.existsSync(file())) return [];
  return fs.readFileSync(file(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function append(entry) {
  return withLock(() => {
    const all = readAll();
    const prev = all.at(-1);
    const e = { seq: (prev?.seq ?? 0) + 1, ts: new Date().toISOString(), ...entry, prevHash: prev?.hash ?? GENESIS };
    e.hash = hashOf(e);
    fs.appendFileSync(file(), JSON.stringify(e) + '\n');
    return e;
  });
}

export function verify() {
  const all = readAll();
  let prev = GENESIS;
  for (const e of all) {
    if (e.prevHash !== prev) return { ok: false, entries: all.length, brokenAt: e.seq, why: 'prevHash mismatch (entry removed or reordered)' };
    if (hashOf(e) !== e.hash) return { ok: false, entries: all.length, brokenAt: e.seq, why: 'hash mismatch (entry modified)' };
    prev = e.hash;
  }
  return { ok: true, entries: all.length, head: prev };
}
