# minimal example

> The smallest configuration that boots a working Thoth bridge.
> Roughly 20 lines of `thoth.config.ts` plus a 2-file persona stack.

## What this is

A starter project to verify the install + Slack flow works end-to-end.
Use it to:
- Confirm your Slack app credentials are valid
- Confirm `claude` CLI is logged in to your Max subscription
- See a working bot reply to a Slack DM

## What this is NOT

A production-ready persona. The persona files in `persona/` are stubs.
Once `pnpm dev` works, fork this directory and write your own persona.

## Setup

```bash
cp .env.example .env
# Edit .env with your Slack tokens and member ID

claude /login   # if not already logged in to Max subscription

pnpm install
pnpm dev
```

## Talk to it

In Slack: DM the bot. The first reply may take a few seconds (loads the
embedder; subsequent replies are fast).

## What ships in `persona/`

- `IDENTITY.md` — one-liner persona name
- `SOUL.md` — voice, mission, axioms (placeholder)

These get loaded into Claude's system prompt on the first turn of each
new thread.

## Next steps

- For a richer persona example, see [`examples/operator-agent/`](../operator-agent)
- For multi-LLM debate setup, see [`examples/multi-llm-party/`](../multi-llm-party)
- Full docs: [docs.thoth-runtime.dev](https://docs.thoth-runtime.dev)
