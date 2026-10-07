import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseCli, cliKey } from './args.js';
import { classifyCli } from './classify.js';
import { loadPolicy } from './policy.js';
import { decide, recordResult } from './guard.js';
import { resolveActor } from './actor.js';
import { flushNotifications } from './notify.js';

export const agentiaBin = () => process.env.AGENTIA_BIN || 'agentia';
// A .js/.mjs binary (e.g. the test fixture) is run through node, so no executable bit or shebang is needed (Windows-safe).
export function agentiaCommand(args) {
  const bin = agentiaBin();
  return /\.(c|m)?js$/.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args];
}
export const EXIT_DENIED = 13;
export const EXIT_APPROVAL = 14;

export function contextFromArgv(argv, actor) {
  const { words, positionals, args } = parseCli(argv);
  const key = cliKey(words);
  return { channel: 'cli', actor, key, args, positionals, risk: classifyCli(key, args, words) };
}

export function stripBinary(argv) {
  return argv.length && path.basename(argv[0]).replace(/\.(cmd|exe)$/, '') === 'agentia' ? argv.slice(1) : argv;
}

export async function runCli(argv, { actor: explicit, dryRun = false } = {}) {
  const policy = loadPolicy();
  const ctx = contextFromArgv(argv, resolveActor(explicit));
  if (!ctx.key) throw new Error('no agentia command given. Example: sentinel exec -- agentia cicd promotion list');
  const d = decide(policy, ctx);
  if (dryRun) {
    process.stdout.write(JSON.stringify({ key: ctx.key, risk: ctx.risk, actor: ctx.actor, outcome: d.outcome, rule: d.ruleId, reason: d.reason }, null, 2) + '\n');
    await flushNotifications();
    return d.allowed ? 0 : d.outcome === 'deny' ? EXIT_DENIED : EXIT_APPROVAL;
  }
  if (!d.allowed) {
    process.stderr.write(`sentinel: ${d.message}\n`);
    await flushNotifications();
    return d.outcome === 'deny' ? EXIT_DENIED : EXIT_APPROVAL;
  }
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const [cmd, cmdArgs] = agentiaCommand(argv);
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit' });
    child.on('error', (e) => { process.stderr.write(`sentinel: cannot start "${agentiaBin()}": ${e.message}\n`); resolve(127); });
    child.on('exit', (c, sig) => resolve(c ?? (sig ? 128 : 1)));
    for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
  });
  recordResult(d.seq, { exitCode: code, ok: code === 0, durationMs: Date.now() - t0 });
  await flushNotifications();
  return code;
}
