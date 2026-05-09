import { z } from 'zod';

const configSchema = z.object({
  SLACK_BOT_TOKEN: z.string().regex(/^xoxb-/, 'must start with xoxb-'),
  SLACK_APP_TOKEN: z.string().regex(/^xapp-/, 'must start with xapp-'),
  // Socket Mode does not need the signing secret (events arrive over the
  // WebSocket, not via signed HTTP). Optional so we can run with just the
  // bot + app tokens.
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),

  ALLOWED_USERS: z
    .string()
    .min(1, 'ALLOWED_USERS must contain at least one user ID')
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),

  CLAUDE_BIN: z.string().default('claude'),
  PERSONA_DIR: z.string().min(1),
  AETHER_RULES_PATH: z.string().optional(),
  SANDBOX_ROOT: z.string().min(1),

  MAX_TURNS: z.coerce.number().int().positive().default(25),
  MAX_BUDGET_USD: z.coerce.number().positive().default(5),
  CONCURRENCY_CAP: z.coerce.number().int().positive().default(3),

  DB_PATH: z.string().default('./bridge.db'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // --- Honcho (Phase 1: identity / theory-of-mind) ---
  HONCHO_API_KEY: z.string().optional(),
  HONCHO_WORKSPACE_ID: z.string().default('thoth-prod'),
  HONCHO_BASE_URL: z.string().default('https://api.honcho.dev'),
  HONCHO_DIALECTIC_TIMEOUT_MS: z.coerce.number().int().positive().default(1500),
  HONCHO_WRITE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  HONCHO_DISABLED: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // --- Episodic memory (Phase 2: cross-thread recall) ---
  EPISODIC_DISABLED: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // --- Reflection loop (Phase 3) ---
  REFLECTION_DISABLED: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  REFLECTION_IDLE_MIN: z.coerce.number().int().positive().default(30),
  REFLECTION_MAX_BUDGET_USD: z.coerce.number().positive().default(0.5),
  REFLECTION_DAILY_CAP_USD: z.coerce.number().positive().default(5.0),
  /** Bridge repo root — where .claude/skills/ lives for skill commits. */
  BRIDGE_REPO_ROOT: z.string().default(process.cwd()),

  // --- BMAD party mode (Step 2 / Phase A) ---
  PARTY_DISABLED: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  PARTY_DEFAULT_BUDGET_USD: z.coerce.number().positive().default(1.5),
  PARTY_DAILY_CAP_USD: z.coerce.number().positive().default(10.0),
  /** Absolute path to persona/apex/party/ directory. Auto-resolved if unset. */
  PARTY_PERSONA_DIR: z.string().optional(),

  // --- Dashboard (local web UI) ---
  DASHBOARD_DISABLED: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  DASHBOARD_PORT: z.coerce.number().int().positive().default(8787),
  DASHBOARD_BIND: z.string().default('127.0.0.1'),
  DASHBOARD_AUTO_OPEN: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(
      'config error — fix .env and try again:\n',
      JSON.stringify(parsed.error.format(), null, 2),
    );
    process.exit(1);
  }
  return parsed.data;
}
