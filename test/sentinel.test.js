import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseCli, cliKey, mcpKey } from '../src/args.js';
import { classifyCli, classifyMcp } from '../src/classify.js';
import { evaluate, loadPolicy, validatePolicy, DEFAULT_POLICY_PATH } from '../src/policy.js';
import { evaluateBash } from '../src/hook.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'bin', 'sentinel.js');
const FAKE = path.join(root, 'test', 'fixtures', 'fake-agentia.mjs');

let home;
const env = (extra = {}) => ({ ...process.env, SENTINEL_HOME: home, SENTINEL_POLICY: DEFAULT_POLICY_PATH, AGENTIA_BIN: FAKE, SENTINEL_WEBHOOK: '', ...extra });
const run = (args, extra) => spawnSync('node', [BIN, ...args], { env: env(extra), encoding: 'utf8' });
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-')); process.env.SENTINEL_HOME = home; });

const FRIDAY_NIGHT = new Date('2026-10-09T18:00:00Z');
const policy = () => loadPolicy(DEFAULT_POLICY_PATH);
const cli = (argv, actor = 'agent', now) => {
  const { words, positionals, args } = parseCli(argv); const key = cliKey(words);
  return { channel: 'cli', actor, key, args, positionals, risk: classifyCli(key, args, words), now };
};

test('parser: keys, booleans do not swallow positionals, flag forms', () => {
  const p = parseCli(['cicd', 'promotion', 'run', 'a0B000000000000AAA', '--operation=merge_and_deploy', '--json', '--wait']);
  assert.equal(cliKey(p.words), 'promotion.run');
  assert.equal(p.args.operation, 'merge_and_deploy');
  assert.equal(p.args.json, true);
  assert.equal(cliKey(parseCli(['cicd', 'work', 'environment-sync']).words), 'work.environment.sync');
  assert.equal(mcpKey('agentia_data_template_get_detail'), 'data.template.get.detail');
});

test('classification: CLI and MCP agree on the same canonical key', () => {
  assert.equal(classifyCli('promotion.list', {}, ['promotion']), 'read');
  assert.equal(classifyCli('promotion.run', {}, []), 'critical');
  assert.equal(classifyCli('cloud.commit', {}, []), 'write');
  assert.equal(classifyCli('work.create', { deploy: true }, []), 'critical');
  assert.equal(classifyCli('work.delete', { help: true }, []), 'read');
  assert.equal(classifyMcp('work.list', {}, { readOnlyHint: true }), 'read');
  assert.equal(classifyMcp('data.template.delete', {}, { destructiveHint: true }), 'critical');
  assert.equal(classifyMcp('health.check', {}, {}), 'read');
});

test('policy: default rules', () => {
  const p = policy();
  assert.deepEqual(validatePolicy(p), []);
  assert.equal(evaluate(p, cli(['cicd', 'work', 'delete', 'a0B1'])).ruleId, 'agents-never-delete');
  assert.equal(evaluate(p, cli(['cicd', 'promotion', 'run', 'a0B1', '--operation', 'merge'])).action, 'approve');
  assert.equal(evaluate(p, cli(['cicd', 'promotion', 'list'])).action, 'allow');
  assert.equal(evaluate(p, cli(['cicd', 'work', 'create', '--name', 'x'], 'human')).action, 'allow');
  assert.equal(evaluate(p, cli(['cicd', 'work', 'create', '--org', 'Production'])).ruleId, 'agent-production-needs-approval');
});

test('policy: freeze window applies to humans too, but never to reads', () => {
  const p = policy();
  assert.equal(evaluate(p, cli(['cicd', 'cloud', 'commit'], 'human', FRIDAY_NIGHT)).ruleId, 'weekend-change-freeze');
  assert.equal(evaluate(p, cli(['cicd', 'job', 'list'], 'human', FRIDAY_NIGHT)).action, 'allow');
  assert.equal(evaluate(p, cli(['cicd', 'cloud', 'commit'], 'human', new Date('2026-10-07T10:00:00Z'))).action, 'allow');
});

test('policy validation catches mistakes', () => {
  const errs = validatePolicy({ rules: [{ id: 'a', action: 'nope' }, { id: 'a', action: 'deny', match: { when: [{ days: ['Funday'], from: '9', to: '10' }] } }] });
  assert.ok(errs.length >= 4);
});

test('exec: reads pass through to agentia and are audited, exit code propagates', () => {
  const r = run(['exec', '--', 'agentia', 'cicd', 'promotion', 'list', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"fake":true/);
  const bad = run(['exec', '--', 'agentia', 'cicd', 'job', 'list', '--fail']);
  assert.equal(bad.status, 3);
  assert.match(run(['audit', 'show']).stdout, /job\.list/);
});

test('exec: agent delete is denied and never reaches agentia', () => {
  const r = run(['exec', '--', 'agentia', 'cicd', 'work', 'delete', 'a0B1']);
  assert.equal(r.status, 13);
  assert.doesNotMatch(r.stdout, /fake/);
  assert.match(r.stderr, /agents-never-delete/);
});

test('approval flow: blocked -> human approves exact command -> runs once -> blocked again', () => {
  const cmd = ['exec', '--', 'agentia', 'cicd', 'promotion', 'run', 'a0B000000000000AAA', '--operation', 'merge'];
  const first = run(cmd);
  assert.equal(first.status, 14);
  const id = first.stderr.match(/sentinel approve (\w+)/)[1];
  assert.equal(run(['approve', id]).status, 1, 'approve without a TTY must fail'); // no TTY, no escape hatch set
  const ok = run(['approve', id], { SENTINEL_APPROVE_NONTTY: '1' });
  assert.equal(ok.status, 0, ok.stderr);
  const other = run(['exec', '--', 'agentia', 'cicd', 'promotion', 'run', 'a0B000000000000BBB', '--operation', 'merge']);
  assert.equal(other.status, 14, 'approval must not transfer to a different invocation');
  const go = run(cmd); assert.equal(go.status, 0, go.stderr); assert.match(go.stdout, /fake/);
  assert.equal(run(cmd).status, 14, 'approval is single use');
  const v = run(['audit', 'verify']); assert.equal(v.status, 0);
  assert.match(run(['audit', 'report']).stdout, /Executed with human approval/);
});

test('audit: tampering is detected, secrets are redacted', () => {
  run(['exec', '--', 'agentia', 'cicd', 'job', 'list', '--token', 'hunter2']);
  run(['exec', '--', 'agentia', 'cicd', 'job', 'list']);
  const f = path.join(home, 'audit.jsonl');
  assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /hunter2/);
  assert.equal(run(['audit', 'verify']).status, 0);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"outcome":"allow"', '"outcome":"deny"'));
  const bad = run(['audit', 'verify']);
  assert.equal(bad.status, 2); assert.match(bad.stdout, /BROKEN/);
});

test('hook: forces writes through sentinel, blocks self-approval and env tampering', () => {
  const p = policy();
  assert.ok(evaluateBash('agentia cicd job list --json', p).deny === undefined);
  assert.match(evaluateBash('agentia cicd cloud commit', p).deny, /sentinel exec/);
  assert.match(evaluateBash('cd x && sentinel approve abc123', p).deny, /cannot approve/);
  assert.match(evaluateBash('SENTINEL_TRUST_NONTTY=1 sentinel exec -- agentia cicd work delete 1', p).deny, /cannot be changed/);
  assert.match(evaluateBash('bash -c "agentia cicd work delete 1"', p).deny, /cannot analyze/);
  assert.match(evaluateBash('npx @copado/agentia-cli cicd job kill 1', p).deny, /sentinel exec/);
  assert.match(evaluateBash('agentia mcp start', p).deny, /sentinel mcp/);
  assert.deepEqual(evaluateBash('sentinel exec -- agentia cicd job list', p), {});
  assert.deepEqual(evaluateBash('git status && ls', p), {});
});

test('hook CLI: emits Claude Code deny JSON and protects policy files', () => {
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(home, 'audit.jsonl') } });
  const r = spawnSync('node', [BIN, 'hook'], { env: env(), input: payload, encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const ok = spawnSync('node', [BIN, 'hook'], { env: env(), input: JSON.stringify({ tool_name: 'Read', tool_input: {} }), encoding: 'utf8' });
  assert.equal(ok.stdout, '');
});

function mcpSession() {
  const child = spawn('node', [BIN, 'mcp'], { env: env(), stdio: ['pipe', 'pipe', 'inherit'] });
  const waiters = new Map();
  createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); waiters.get(m.id)?.(m); });
  let id = 0;
  const call = (method, params) => new Promise((res) => { const i = ++id; waiters.set(i, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  return { call, close: () => child.stdin.end() };
}

test('mcp proxy: annotates tools, passes reads, blocks deletes, gates promotions', async () => {
  const s = mcpSession();
  await s.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  const list = await s.call('tools/list');
  const desc = Object.fromEntries(list.result.tools.map((t) => [t.name, t.description]));
  assert.match(desc.agentia_work_delete, /blocked for agents/);
  assert.match(desc.agentia_promotion_run, /needs human approval/);
  assert.equal(desc.agentia_work_list, 'List work');

  const ok = await s.call('tools/call', { name: 'agentia_work_list', arguments: {} });
  assert.equal(ok.result.content[0].text, 'executed:agentia_work_list');
  const del = await s.call('tools/call', { name: 'agentia_work_delete', arguments: { id: 'a0B1' } });
  assert.equal(del.result.isError, true); assert.match(del.result.content[0].text, /agents-never-delete/);
  const promo = await s.call('tools/call', { name: 'agentia_promotion_run', arguments: { id: 'a0B1', operation: 'merge' } });
  assert.equal(promo.result.isError, true); assert.match(promo.result.content[0].text, /sentinel approve/);
  s.close();
  const text = fs.readFileSync(path.join(home, 'audit.jsonl'), 'utf8');
  assert.doesNotMatch(text, /executed:agentia_work_delete/);
  assert.equal(run(['audit', 'verify']).status, 0);
});

test('webhook: blocked events are delivered to a Slack-style endpoint', async () => {
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}/hook`;
  const r = await new Promise((resolve) => { const c = spawn('node', [BIN, 'exec', '--', 'agentia', 'cicd', 'work', 'delete', 'a0B1'], { env: env({ SENTINEL_WEBHOOK: url }) }); c.on('exit', resolve); });
  srv.close();
  assert.equal(r, 13);
  assert.equal(got.length, 1);
  assert.match(got[0].text, /deny/);
});
