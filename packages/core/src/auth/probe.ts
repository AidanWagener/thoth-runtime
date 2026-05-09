import { logger } from '../logger';

/**
 * Refuse to start if any environment variable that would override
 * Claude Code's subscription OAuth credentials is set.
 *
 * Per Claude Code's auth precedence:
 *   1. Cloud-provider flags (Bedrock/Vertex/Foundry)
 *   2. ANTHROPIC_AUTH_TOKEN
 *   3. ANTHROPIC_API_KEY
 *   4. apiKeyHelper script
 *   5. CLAUDE_CODE_OAUTH_TOKEN (long-lived, billed as subscription)
 *   6. Subscription OAuth from /login (what we want)
 *
 * If any of (1)-(3) are present, claude -p will silently bill against
 * the API instead of the user's Max subscription. This is the bug
 * mode we are explicitly preventing.
 *
 * CLAUDE_CODE_OAUTH_TOKEN is allowed because it still bills as
 * subscription, but we warn so an operator can confirm intent.
 */
const VIOLATORS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const;

export const SCRUBBED_ENV_KEYS: readonly string[] = VIOLATORS;

export function authProbe(): void {
  const found = VIOLATORS.filter((k) => process.env[k]);
  if (found.length > 0) {
    logger.fatal(
      { found },
      'refusing to start: env vars present that would override Max subscription billing',
    );
    // eslint-disable-next-line no-console
    console.error(
      `\n  Refusing to start. The following env vars are set:\n` +
        found.map((k) => `    - ${k}`).join('\n') +
        `\n\n  Any of these would cause 'claude -p' to bill against the API\n` +
        `  instead of your Max subscription. Unset them and try again:\n\n` +
        found.map((k) => `    Remove-Item Env:${k}`).join('\n') +
        `\n`,
    );
    process.exit(1);
  }

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    logger.warn(
      'CLAUDE_CODE_OAUTH_TOKEN is set; that path bills as subscription but skips interactive login.',
    );
  }

  logger.info('auth probe passed: no API-routing env vars set');
}
