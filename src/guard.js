// The one decision path used by every channel (CLI wrapper, hook, MCP proxy).
import * as audit from './audit.js';
import { evaluate } from './policy.js';
import { requestApproval, consumeApproval } from './approvals.js';
import { notify } from './notify.js';

export function decide(policy, ctx) {
  const ev = evaluate(policy, { ...ctx, now: ctx.now || new Date() });
  let outcome = ev.action === 'approve' ? 'approval-required' : ev.action;
  let approvedBy, approvalId;
  if (outcome === 'approval-required') {
    const a = consumeApproval(ctx);
    if (a) { outcome = 'allow-approved'; approvedBy = a.approvedBy; }
    else approvalId = requestApproval(ctx, ev.ruleId, ev.reason);
  }
  const ttl = policy.approvalTtlMinutes ?? 30;
  const label = `${ctx.actor} via ${ctx.channel}: ${ctx.key} (${ctx.risk})`;
  const entry = audit.append({ type: 'decision', channel: ctx.channel, actor: ctx.actor, tool: ctx.key, risk: ctx.risk,
    args: audit.redact(ctx.args), positionals: ctx.positionals || [], outcome, ruleId: ev.ruleId, reason: ev.reason,
    ...(approvedBy && { approvedBy }), ...(approvalId && { approvalId }) });
  notify(policy, outcome, `${label} -> ${outcome} [rule ${ev.ruleId}]${approvedBy ? ` approved by ${approvedBy}` : ''}`, { tool: ctx.key });

  const allowed = outcome === 'allow' || outcome === 'allow-approved';
  let message = '';
  if (outcome === 'deny') message = `Blocked by Agentia Sentinel (rule: ${ev.ruleId}). ${ev.reason} Nothing was executed.`;
  if (outcome === 'approval-required') {
    message = `Approval required by Agentia Sentinel (rule: ${ev.ruleId}). ${ev.reason} A human must approve this exact invocation: ` +
      `run \`sentinel approve ${approvalId}\` in an interactive terminal (valid ${ttl} min, single use), then retry. Nothing was executed.`;
  }
  return { outcome, allowed, seq: entry.seq, ruleId: ev.ruleId, reason: ev.reason, approvalId, message };
}

export const recordResult = (seq, data) => audit.append({ type: 'result', ref: seq, ...data });
