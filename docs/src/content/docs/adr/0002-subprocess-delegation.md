---
title: ADR-0002 — Subprocess delegation, not API
description: Why the runtime spawns the local `claude` CLI instead of calling api.anthropic.com directly.
---

**Status:** Accepted · **Date:** 2026-05-09 · **Decider:** maintainer · **Verification:** A (architectural; no rollback)

## Context

In early 2026, Anthropic ended third-party OAuth for the Claude API.
Off-the-shelf Slack-Claude relays either:
- Lost their subscription auth path entirely
- Fell back to calling `api.anthropic.com` directly with API keys,
  billing against Max overage credits at higher rates

Users running heavily on their Max subscription saw effective costs
double when their tools fell into the API path.

We needed to keep every turn under the user's existing Claude Max
subscription billing.

## Decision

**The runtime never calls `api.anthropic.com` directly.** Instead, it
**spawns the local `claude` CLI binary** via `child_process.spawn`,
sending the prompt via stdin and parsing the streaming JSON output
from stdout.

The auth probe at boot **refuses to start** if any of these env vars
are set:
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `CLAUDE_CODE_USE_BEDROCK`
- `CLAUDE_CODE_USE_VERTEX`
- `CLAUDE_CODE_USE_FOUNDRY`

These are deleted from the spawned subprocess's environment. The local
`claude` CLI then resolves auth in this order (per Anthropic's docs):

1. Bedrock/Vertex/Foundry env (refused at boot)
2. `ANTHROPIC_AUTH_TOKEN` (refused at boot)
3. `ANTHROPIC_API_KEY` (refused at boot)
4. `apiKeyHelper` (we don't set one)
5. `CLAUDE_CODE_OAUTH_TOKEN` (allowed; bills as subscription)
6. Subscription OAuth from `/login` (the default — bills as subscription)

Items 5 and 6 win, ensuring the turn bills against the user's Max
subscription.

## Consequences

### Positive

- **Subscription billing wins** — every turn under Max allowance
- **Defense in depth** — the spawn boundary scrubs env vars; even if
  the parent process leaks API keys, they don't reach the subprocess
- **No third-party OAuth complexity** — we don't need to be an OAuth
  client at all
- **No customer credential storage** — we never see Anthropic
  credentials; they live in `~/.claude/.credentials.json` which the
  CLI manages

### Negative

- **Requires a local Claude install** — users must have `claude` CLI
  on PATH; "managed" runtimes can't ship without bundling Claude
- **Subprocess overhead** — ~50–100ms per spawn for cold-start;
  mitigated by per-thread session resume via `claude --resume`
- **Platform-specific edge cases** — Windows `CreateProcess` has a
  ~32 KB command-line limit; we side-step with `--append-system-prompt-file`
- **Anthropic could break this** — if Claude CLI changes its
  arguments or output format

### Mitigation

- Document `claude /login` as a hard prereq in Quickstart
- `thoth doctor` validates `claude` binary at runtime
- Pin to a specific Claude CLI version range in docs
- Smoke test runs daily in CI against latest CLI

## Alternatives considered

### Alternative 1 — Direct API calls with API keys

**Pros:** Standard architecture, no subprocess complexity.

**Cons:** Bills against API rates (>2x Max-subscription rates);
violates the "keep using your Max subscription" thesis.

**Rejected because:** the cost differential is the entire point of
this architecture.

### Alternative 2 — Anthropic SDK with OAuth

**Pros:** Cleaner integration, no subprocess.

**Cons:** Anthropic killed third-party OAuth in early 2026. Not
available.

### Alternative 3 — Run Claude CLI in a Docker container we manage

**Pros:** Reproducible Claude CLI environment.

**Cons:** Adds Docker dependency for users; complicates the local-dev
experience.

**Rejected because:** Docker is a heavy dependency for what should be
a simple `pnpm dev`.

## Review trigger

Revisit this decision when:
- Anthropic re-enables third-party OAuth
- Anthropic offers a subscription-tier API endpoint
- Claude CLI changes its argument or output shape (next major version)
