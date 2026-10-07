import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm } from './args.js';
import { globMatchesKey } from './classify.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_POLICY_PATH = path.join(here, '..', 'policies', 'default.json');
const ACTIONS = new Set(['allow', 'deny', 'approve']);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const arr = (v) => (v === undefined ? [] : [].concat(v));

export function policyPath() {
  if (process.env.SENTINEL_POLICY) return path.resolve(process.env.SENTINEL_POLICY);
  const local = path.resolve('sentinel.policy.json');
  return fs.existsSync(local) ? local : DEFAULT_POLICY_PATH;
}
export function loadPolicy(file = policyPath()) {
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validatePolicy(policy);
  if (errors.length) throw new Error(`invalid policy ${file}:\n  - ${errors.join('\n  - ')}`);
  policy.defaultAction ||= 'allow';
  policy.rules ||= [];
  return policy;
}
export function validatePolicy(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['policy must be an object'];
  if (p.defaultAction && !ACTIONS.has(p.defaultAction)) errs.push(`defaultAction "${p.defaultAction}" is not allow|deny|approve`);
  const seen = new Set();
  for (const [i, r] of (p.rules || []).entries()) {
    const id = r.id || `#${i}`;
    if (!r.id) errs.push(`rule ${id} has no id`);
    else if (seen.has(r.id)) errs.push(`duplicate rule id "${r.id}"`);
    seen.add(r.id);
    if (!ACTIONS.has(r.action)) errs.push(`rule ${id}: action must be allow|deny|approve`);
    for (const w of arr(r.match?.when)) {
      if (!arr(w.days).every((d) => DAYS.includes(d))) errs.push(`rule ${id}: days must be ${DAYS.join('|')}`);
      if (!/^\d\d:\d\d$/.test(w.from || '') || !/^\d\d:\d\d$/.test(w.to || '')) errs.push(`rule ${id}: when.from/to must be HH:MM`);
    }
    try { if (r.match?.anyArg) new RegExp(r.match.anyArg, 'i'); } catch { errs.push(`rule ${id}: anyArg is not a valid regex`); }
  }
  return errs;
}

function clock(date, tz = 'UTC') {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
function inWindows(windows, now, tz) {
  const c = clock(now, tz);
  return arr(windows).some((w) => (!w.days || w.days.includes(c.day)) && c.minutes >= toMin(w.from) && c.minutes < toMin(w.to));
}
function matches(m, ctx, policy) {
  if (m.channel && !arr(m.channel).includes(ctx.channel)) return false;
  if (m.actor && !arr(m.actor).includes(ctx.actor)) return false;
  if (m.risk && !arr(m.risk).includes(ctx.risk)) return false;
  if (m.tool && !arr(m.tool).some((g) => globMatchesKey(g, ctx.key))) return false;
  for (const [k, want] of Object.entries(m.args || {})) {
    const have = ctx.args[norm(k)];
    if (have === undefined || have === false) return false;
    if (want !== true && !arr(want).map(String).includes(String(have))) return false;
  }
  if (m.anyArg && !new RegExp(m.anyArg, 'i').test(JSON.stringify(Object.values(ctx.args)))) return false;
  if (m.when && !inWindows(m.when, ctx.now || new Date(), policy.timezone)) return false;
  return true;
}
export function evaluate(policy, ctx) {
  for (const r of policy.rules) {
    if (matches(r.match || {}, ctx, policy)) return { action: r.action, ruleId: r.id, reason: r.reason || '' };
  }
  return { action: policy.defaultAction, ruleId: 'default', reason: '' };
}
