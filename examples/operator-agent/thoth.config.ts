// thoth.config.ts — operator-agent example
//
// Production-grade configuration demonstrating the full Thoth stack.
// Setting: fictional Helios Tools (devtools SaaS).
//
// To run:
//   1. cp .env.example .env  (and fill in)
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
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    allowedUsers: process.env.ALLOWED_USERS?.split(',') ?? [],
  }),

  persona: {
    dir: './persona',
    aetherRulesPath: './persona/aether/RULES.md',
  },

  memory: {
    episodic: {
      embedder: 'xenova-minilm-l6-v2',
      retentionDays: 365,
    },
    identity: {
      provider: 'honcho',
      apiKey: process.env.HONCHO_API_KEY,
      workspace: 'helios-thoth-prod',
    },
    reflection: {
      enabled: true,
      dailyCapUsd: 5,
      idleMinutes: 30,
    },
  },

  ambient: {
    triggers: [
      {
        name: 'morning_digest',
        type: 'cron',
        schedule: '0 9 * * *',
        budgetUsd: 0.50,
      },
      {
        name: 'stale_skill_nudge',
        type: 'threshold',
        watch: 'skill_drafts.pending_days >= 3',
        cooldownHours: 168,
        budgetUsd: 0.05,
      },
    ],
    dailyCapUsd: 1.0,
  },
});
