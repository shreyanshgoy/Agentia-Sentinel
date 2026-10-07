# Demo script (target 4:30, limit 5:00)

Setup: terminal with `AGENTIA_BIN` unset (real agentia installed), a project with `sentinel init` and `sentinel install-hook` done, an MCP client (Claude Code) pointed at `sentinel mcp`.

**0:00 The problem (30s).** Agentia Headless exposes 192 MCP tools to coding agents, including promote, deploy and delete. Nothing local decides what an agent may do on its own, who approved a deploy, or how to prove it later.

**0:30 One door, three entrances (30s).** Show the diagram in the README: `sentinel exec`, `sentinel mcp`, the Claude Code hook, all into one decision engine.

**1:00 Safe work flows (30s).** Agent lists promotions. Show it succeed. `sentinel audit show`.

**1:30 Blocked (45s).** Ask the agent to delete a user story. Show the refusal message naming the rule, and that nothing reached Agentia. Point out the `[Sentinel: blocked for agents]` tag in the tool list.

**2:15 Approval (60s).** Ask the agent to promote with deploy. It stops and gives an approval id. In a second terminal run `sentinel pending`, then `sentinel approve <id>`. Agent retries and it runs. Retry again: needs approval again (single use). Mention approval is bound to the exact command.

**3:15 Can't cheat (30s).** Show the hook denying `sentinel approve` and a `bash -c` wrapped call.

**3:45 Proof (45s).** `sentinel audit verify` passes. Edit one line of `.sentinel/audit.jsonl`, run verify again, show BROKEN. Then `sentinel audit report`.

**4:30 Close (20s).** Honest limits: tamper-evident not tamper-proof; covers calls through Sentinel; Copado's gates stay the system of record.

Tip: run `./demo.sh` first as a fallback recording if live MCP is flaky.
