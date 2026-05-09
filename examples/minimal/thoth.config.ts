// thoth.config.ts — minimal example
//
// The smallest configuration that boots a working Thoth bridge.
// Persona files live alongside this config in ./persona/.
//
// To run:
//   1. cp .env.example .env  (and fill in Slack tokens)
//   2. claude /login          (Max-subscription auth)
//   3. pnpm dev

import { defineConfig } from '@thoth-runtime/core';
import slack from '@thoth-runtime/transport-slack';

export default defineConfig({
  runtime: {
    sandboxRoot: './sandbox',
    claudeBin: 'claude',
    maxTurns: 50,
    maxBudgetUsd: 5,
  },

  transport: slack({
    botToken: process.env.SLACK_BOT_TOKEN!,
    appToken: process.env.SLACK_APP_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    allowedUsers: process.env.ALLOWED_USERS?.split(',') ?? [],
  }),

  persona: {
    dir: './persona',
  },

  memory: {
    episodic: {
      embedder: 'xenova-minilm-l6-v2',
      retentionDays: 365,
    },
    reflection: {
      enabled: true,
      dailyCapUsd: 5,
      idleMinutes: 30,
    },
    // identity layer (Honcho) is optional — skipped here for minimal
  },
});
