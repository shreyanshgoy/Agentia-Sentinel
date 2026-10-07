// Slack-compatible webhook ({text}). Failures never block delivery work.
const pending = new Set();
export function notify(policy, event, text, extra = {}) {
  const cfg = policy.notify;
  if (!cfg?.webhook || !(cfg.on || []).includes(event)) return;
  const url = cfg.webhook.startsWith('env:') ? process.env[cfg.webhook.slice(4)] : cfg.webhook;
  if (!url) return;
  const p = fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `:shield: Agentia Sentinel [${event}] ${text}`, event, ...extra }),
    signal: AbortSignal.timeout(3000) }).catch(() => {}).finally(() => pending.delete(p));
  pending.add(p);
}
export const flushNotifications = () => Promise.allSettled([...pending]);
