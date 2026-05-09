# @thoth-runtime/transport-slack

> Slack transport for Thoth — Bolt Socket Mode, Block Kit 2026 components, reactions as training signals.

## Install

```bash
pnpm add @thoth-runtime/transport-slack
```

## Use

```ts
import { defineConfig } from '@thoth-runtime/core';
import slack from '@thoth-runtime/transport-slack';

export default defineConfig({
  transport: slack({
    botToken: process.env.SLACK_BOT_TOKEN!,
    appToken: process.env.SLACK_APP_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    allowedUsers: process.env.ALLOWED_USERS?.split(',') ?? [],
  }),
  // ... other config
});
```

## Features

- **Socket Mode** — outbound-only WebSocket; no public ingress
- **Threaded sessions** — each Slack thread = one Claude session
- **Reactions as feedback** — ✅❌🧠🗑️👤 on agent replies become training signals
- **Magic commands** — `/help`, `/whoami`, `/recall <q>`, `/done`, `/loop-stop`
- **Block Kit 2026** — Cards, Alerts, Carousels, Data Tables, Work Objects, Code blocks (graceful fallback to legacy on older workspaces)
- **Streaming replies** — `chat.update` polling at ~1s cadence
- **Self-spawn** — autonomous follow-ups on scheduled `next_check_at`

## Setup

See [docs.thoth-runtime.dev/transports/slack](https://docs.thoth-runtime.dev/transports/slack)
for the full Slack Developer Portal walkthrough.

## License

MIT
