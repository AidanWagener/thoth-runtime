// Unit tests for slack/identity.ts — focused on the pure formatter.
// resolveUser/resolveChannel are integration concerns (require a Slack
// client mock); the format helper is pure and worth locking down.

import { describe, it, expect } from 'vitest';
import { formatSlackMeta } from './identity';
import type { SlackIdentity } from './identity';

function makeIdentity(overrides: Partial<SlackIdentity> = {}): SlackIdentity {
  return {
    user: {
      id: 'U_TEST',
      displayName: 'Test User',
      email: null,
      ...(overrides.user ?? {}),
    },
    channel: {
      id: 'C_TEST',
      name: '#general',
      isDm: false,
      ...(overrides.channel ?? {}),
    },
  };
}

describe('formatSlackMeta', () => {
  it('produces an XML-ish slack-context block', () => {
    const out = formatSlackMeta(makeIdentity(), '1700000000.000100');
    expect(out).toMatch(/^<slack-context>/);
    expect(out).toMatch(/<\/slack-context>$/);
  });

  it('includes sender id, channel id, and thread_ts', () => {
    const out = formatSlackMeta(makeIdentity(), '1700000000.000100');
    expect(out).toContain('U_TEST');
    expect(out).toContain('C_TEST');
    expect(out).toContain('thread_ts: 1700000000.000100');
  });

  it('shows email when present', () => {
    const out = formatSlackMeta(
      makeIdentity({
        user: {
          id: 'U_TEST',
          displayName: 'Test User',
          email: 'user@example.com',
        },
      }),
      '1700000000.000100',
    );
    expect(out).toContain('user@example.com');
  });

  it('omits email parens when email is null', () => {
    const out = formatSlackMeta(makeIdentity(), '1700000000.000100');
    expect(out).toContain('Test User (U_TEST)');
    expect(out).not.toContain(', null');
  });

  it('uses the channel display name (with # prefix or DM)', () => {
    const channel = formatSlackMeta(
      makeIdentity({ channel: { id: 'C123', name: '#prod-alerts', isDm: false } }),
      '1.0',
    );
    expect(channel).toContain('#prod-alerts');

    const dm = formatSlackMeta(
      makeIdentity({ channel: { id: 'D123', name: 'DM', isDm: true } }),
      '1.0',
    );
    expect(dm).toContain('DM');
  });

  it('records a received_at ISO timestamp', () => {
    const out = formatSlackMeta(makeIdentity(), '1700000000.000100');
    expect(out).toMatch(/received_at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('uses 2-space indentation for inner lines', () => {
    const out = formatSlackMeta(makeIdentity(), '1700000000.000100');
    const lines = out.split('\n');
    // First and last lines are the tags; middle lines should be indented
    for (let i = 1; i < lines.length - 1; i++) {
      expect(lines[i]).toMatch(/^  \w/);
    }
  });
});
