---
name: agentia-sentinel
description: How to work with Copado Agentia CLI and MCP when Agentia Sentinel guardrails are active. Use whenever a tool call or agentia command is blocked, returns "Approval required", or a tool description starts with "[Sentinel: ...]".
---

# Working under Agentia Sentinel

Sentinel enforces a policy between you and Copado. Its decisions are constraints from the team that owns the pipeline, not errors to work around.

## Before acting
- Tool descriptions starting with `[Sentinel: blocked for agents]` will be refused. Do not call them; tell the user a human must do it.
- Tool descriptions starting with `[Sentinel: needs human approval]` will pause for a person. Plan for that.
- Unsure what will happen? Run `sentinel check -- agentia <args>`. It explains the decision without executing anything.
- Run state-changing CLI commands as `sentinel exec -- agentia <args>`, never bare `agentia`.

## When you get "Blocked by Agentia Sentinel"
1. Stop. Do not retry, rephrase, or try another tool or flag that does the same thing.
2. Tell the user which rule blocked it (it is named in the message) and what you were trying to do.
3. Suggest what a human could do instead. Carry on with any unblocked parts of the task.

## When you get "Approval required"
1. Do not retry in a loop. Give the user the approval id from the message and say exactly what you want to run.
2. The user approves in their own terminal with `sentinel approve <id>`. Approval covers that exact command only, once, for a limited time.
3. Only after the user confirms they approved, retry the identical command. Changing any argument needs a new approval.

## Never
- Run `sentinel approve`, set `SENTINEL_*` environment variables, or edit `sentinel.policy.json` or `.sentinel/`.
- Wrap agentia in `bash -c`, `eval` or `$(...)` to get past a block.
- Start the raw server with `agentia mcp start`. Use `sentinel mcp`.
- Describe a blocked action as done. Report what actually ran.

Reads (list, get, status, logs, search) are normally allowed. Use them freely to gather context before proposing changes.
