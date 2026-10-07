// Humans are identified by an interactive TTY on stdin. Anything else (agents, CI) is "agent" and cannot opt out:
// the only override is SENTINEL_TRUST_NONTTY=1, which the hook refuses to let an agent set.
export function resolveActor(explicit) {
  if (!process.stdin.isTTY && process.env.SENTINEL_TRUST_NONTTY !== '1') return 'agent';
  return explicit || process.env.SENTINEL_ACTOR || 'human';
}
