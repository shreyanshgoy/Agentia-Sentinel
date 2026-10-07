# Hackathon form text (paste into each field)

## Solution title (max 200)
Agentia Sentinel: guardrails, approvals and an audit trail for AI agents using Agentia CLI

## Problem statement (max 2000)
Agentia Headless lets developers and their AI coding agents run Copado from the terminal and the IDE. The CLI also ships a local MCP server with 192 tools, including ones that promote, deploy, delete records and change credentials. That's powerful, but right now nothing sits between the agent and those tools to decide what it may do on its own.

Release managers end up with three questions they can't answer. Which actions should an agent be allowed to take without asking? When an agent did deploy something, who approved it and for exactly which command? And can anyone prove afterwards what the agent actually did? Copado's pipeline gates and logs still protect the release, but the local layer where agents work has no policy, no approval step and no record of its own.

## Abstract / description of solution (max 4000)
Sentinel is a small tool that sits in front of Agentia CLI and enforces one set of rules everywhere an agent can reach Copado.

It covers three entry points. `sentinel exec` wraps normal CLI calls. `sentinel mcp` is a drop-in replacement for `agentia mcp start`, so every tool call from an MCP client gets checked before it reaches Agentia. A Claude Code hook forces state-changing shell commands through Sentinel and stops the agent from editing the policy or approving its own requests. All three use the same decision engine, and a CLI command and its matching MCP tool map to the same key. For example, `agentia cicd promotion run` and the MCP tool `agentia_promotion_run` are both `promotion.run`, so one rule covers both.

Rules live in a plain JSON policy file. They can match on who is acting (human or agent), risk level (read, write, critical), the tool, specific arguments like `--deploy`, and time windows. The default policy blocks agents from deleting records or touching credentials, requires a human for promotions and deploys, and enforces a weekend change freeze. Run against the real server, that leaves 166 of the 192 tools open, blocks 19 and puts 7 behind approval. Blocked calls never reach Agentia, and the agent gets a clear message it can read. Tool descriptions are also tagged so the model knows a tool is restricted before it tries. A bundled SKILL.md teaches agents how to behave when blocked: stop, report, ask for approval, never work around it.

When something needs a human, Sentinel creates a pending request. The approval is tied to that exact command, works once, expires after 30 minutes, and needs a person at an interactive terminal. Approving one promotion doesn't approve a different one.

Every decision goes into a hash-chained audit log, where each entry commits to the one before it. If anyone edits or removes an entry, `sentinel audit verify` flags it. Secrets are redacted. A report command produces a readable summary for release managers, and blocked or approved events can be sent to a Slack-style webhook.

It's honest about its limits. The log is tamper-evident, not tamper-proof, and Sentinel only covers calls that go through it. Copado's own pipeline gates remain the system of record. This is an extra local control, not a replacement.

## Problem solved (max 4000)
Teams can let AI agents use Agentia without giving them unchecked power. Agents handle safe, everyday work on their own. Deploys, promotions and deletes are blocked or held for a named human, and every decision is recorded in a way a release manager can verify, showing what happened and who signed off.

## Your approach (max 4000)
I installed the real Agentia CLI first and inspected its command tree and MCP server rather than guessing. I then built one decision engine shared by the CLI wrapper, a Claude Code hook and an MCP proxy, so the three can never disagree. It's written in Node with no runtime dependencies. I wrote 13 automated tests, including end-to-end runs through the real binary, an MCP session and a webhook, and ran it against the real 192-tool MCP server. Anything needing live Copado authentication wasn't tested.

## Tools / technologies (max 500)
Node.js 20+ (no dependencies); Agentia CLI (@copado/agentia-cli beta) and its local MCP server; Model Context Protocol (JSON-RPC over stdio); Claude Code PreToolUse hooks; SHA-256 hash-chained audit log; JSON policy files; Slack-compatible webhooks; agent SKILL.md; Node built-in test runner.

## Reminders before submitting
- Register with a company or college email (the rules reject personal webmail).
- Submit by Oct 26, 2026: demo video (<=5 min), deck, public GitHub repo link.
- Demo must match what the code really does.
