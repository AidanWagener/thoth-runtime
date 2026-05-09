// Unit tests for auth/probe — the SCRUBBED_ENV_KEYS list is
// security-critical: removing one would cause silent API billing
// instead of subscription billing.

import { describe, it, expect } from 'vitest';
import { SCRUBBED_ENV_KEYS } from './probe';

describe('SCRUBBED_ENV_KEYS', () => {
  const REQUIRED_KEYS = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ] as const;

  it.each(REQUIRED_KEYS)(
    'must include "%s" — its absence would leak subscription billing to API',
    (key) => {
      expect(SCRUBBED_ENV_KEYS).toContain(key);
    },
  );

  it('exposes exactly the 5 currently-known violators', () => {
    // If Anthropic adds a new env var that overrides subscription auth,
    // this assertion will catch the regression and force conscious update.
    expect(SCRUBBED_ENV_KEYS.length).toBe(5);
  });

  it('uses uppercase env-var names (POSIX convention)', () => {
    for (const key of SCRUBBED_ENV_KEYS) {
      expect(key).toBe(key.toUpperCase());
    }
  });
});
