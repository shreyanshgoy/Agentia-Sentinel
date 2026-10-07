# Agentia Sentinel

**One policy, one approval flow and one tamper-evident audit log for everything an agent can do through Agentia CLI.**

Built for the Agentia Headless hackathon. Zero runtime dependencies, Node 20+.

## The gap

Agentia Headless moves Copado delivery into the terminal and the IDE, and `agentia mcp start` exposes **192 tools**
(promotions, deployments, deletes, credentials, data syncs) directly to any MCP-capable coding agent. Copado keeps the
pipeline's quality gates and logs, but there is no layer that answers:

- *Which of these should an AI agent be allowed to do on its own?*
- *Who approved the one time it deployed to production, and for exactly which command?*
- *Can I prove, afterwards, what the agent actually did?*

Sentinel is that layer. It sits in front of Agentia on three channels, and all three share a single decision engine:

```
 Claude Code / Cursor ──► sentinel mcp  ──► agentia mcp start      (tools/call evaluated; blocked calls never reach Agentia)
 Claude Code Bash tool ─► sentinel hook ──► forces writes through exec; protects policy + audit files
 Humans / CI / scripts ─► sentinel exec ──► agentia <args>         (exit 13 = denied, 14 = needs approval)
                              │
                     policy ─ approvals ─ hash-chained audit ─ Slack-style webhook
```

CLI commands and MCP tools are normalised to one canonical key (`agentia cicd promotion run` and the MCP tool
`agentia_promotion_run` both become `promotion.run`), so **one rule covers both doors**.

## Quick start

```bash
npm i -g @copado/agentia-cli@beta && agentia setup      # prerequisite
cd agentia-sentinel && npm link                          # exposes `sentinel`
cd your-salesforce-project
sentinel init                    # sentinel.policy.json + .sentinel/
sentinel install-hook            # Claude Code PreToolUse hook
sentinel doctor
```

MCP client config (replace `agentia mcp start` with the governed version):

```json
{ "mcpServers": { "agentia": { "command": "sentinel", "args": ["mcp"] } } }
```

Try it without an org: `bash demo.sh`

## What the default policy does

| Rule | Effect |
|---|---|
| `agents-never-delete` | any `*.delete` by an agent is denied |
| `agents-never-touch-credentials` | `auth.set`, `credential.*` writes by an agent are denied |
| `weekend-change-freeze` | all writes denied Fri 16:00 to Sun 24:00 (humans too; reads unaffected) |
| `agent-deploy-flag-needs-approval` / `agent-merge-and-deploy-needs-approval` | `--deploy` / `--operation merge_and_deploy` need a human |
| `agent-critical-needs-approval` | promotions, submits, sync-apply, job kill, env sync need a human |
| `agent-production-needs-approval` | any write mentioning production needs a human |

Against the real server, that classifies the 192 tools as 166 open, 19 blocked and 7 needing approval for agents.
On `tools/list`, Sentinel prefixes those descriptions (`[Sentinel: blocked for agents]`) so the model knows *before* it tries.

Rules are first-match-wins JSON. Match on `actor`, `channel`, `risk` (`read|write|critical`), `tool` (glob),
`args` (presence or value), `anyArg` (regex over argument values) and `when` (day/time windows in a timezone).
`sentinel check -- agentia ...` explains any decision without running it.

## Approvals that can't be gamed

- Bound to the **exact invocation** (SHA-256 of tool + normalised args). Approving promotion A does not approve promotion B.
- **Single use** and **time-limited** (default 30 min).
- Requires an **interactive TTY** and a typed confirmation. Anything without a TTY is treated as `agent`.
- The hook blocks agents from running `sentinel approve`, setting `SENTINEL_*` env vars, wrapping agentia in `bash -c`/`eval`/`$()`,
  or editing the policy and `.sentinel/` files.

## Audit

`.sentinel/audit.jsonl` is an append-only hash chain: every entry commits to the previous one. `sentinel audit verify` detects
edited, removed or reordered entries; `sentinel audit report` produces a markdown summary for release managers.
Secret-looking arguments are redacted and large payloads are stored as hash + length only.

## Honest limits

- **Tamper-evident, not tamper-proof.** Someone with write access to the disk can rewrite the whole chain. Forward the webhook
  to Slack/SIEM to get an external anchor.
- **The hook protects Claude Code's shell.** An agent with other unguarded execution paths, or a user who runs `agentia` directly,
  bypasses Sentinel. Pair with the MCP proxy (remove the raw `agentia mcp start` entry) and normal Copado approvals.
  Copado's own pipeline gates remain the system of record; Sentinel is an additional local control, not a replacement.
- CLI risk classification is verb-based (unknown verbs fail safe to `write`); MCP uses Copado's own `readOnlyHint`/`destructiveHint`.
  Review `src/classify.js` when Copado adds commands.
- Built against `@copado/agentia-cli@1.0.0-beta.2`. The test suite runs on Windows, but the real `agentia.cmd` shim is not handled yet, so use WSL2 for live demos on Windows.
- Tests use a fixture instead of a live org. Allowed live calls (that need Copado auth) were not exercised here; the denial,
  approval, audit, hook and MCP paths were exercised against the real binary.

## Layout

```
src/guard.js       single decision path (policy -> approval -> audit -> notify)
src/policy.js      rule engine + validation        src/classify.js   risk + canonical keys
src/runner.js      sentinel exec/check             src/mcp-proxy.js  governed MCP gateway
src/hook.js        Claude Code hook + installer    src/audit.js      hash chain, redaction
src/approvals.js   bound, single-use approvals     src/report.js     markdown report
SKILL.md           agent instructions   DEMO_SCRIPT.md   5-minute demo plan
test/              13 tests incl. real subprocess, hook, MCP and webhook end-to-end
```

## Agent skill

`SKILL.md` teaches agents how to behave under Sentinel: read the `[Sentinel: ...]` tags, stop when blocked, hand the approval id to a human, never work around a block. Copy it into your agent's skills folder.

## License

MIT, see `LICENSE`.

## Ideas to extend

Package as an `agentia plugins link` oclif plugin (`npm init @copado/agentia-plugin`), add a Slack approve button,
per-pipeline policies pulled from Copado, and `sentinel audit export` to SIEM.
