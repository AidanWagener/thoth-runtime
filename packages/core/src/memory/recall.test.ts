// Unit tests for memory/recall.buildUserModelBlock.
// Tests the skip rules and block formatting via a minimal HonchoClient stub.

import { describe, it, expect } from 'vitest';
import { buildUserModelBlock } from './recall';

// Minimal stub satisfying the HonchoClient surface that recall.ts uses.
// We don't import the real class to keep this isolated from network deps.
function makeStubHoncho(opts: {
  enabled?: boolean;
  dialecticResponse?: { content: string; latencyMs: number } | null;
  dialecticThrows?: boolean;
}): any {
  return {
    get enabled() {
      return opts.enabled ?? true;
    },
    async dialectic(_peerId: string, _query: string) {
      if (opts.dialecticThrows) throw new Error('simulated dialectic failure');
      return opts.dialecticResponse ?? null;
    },
  };
}

function makeIdentity(userId = `U_TEST_${Math.random().toString(36).slice(2, 10)}`): any {
  return {
    user: {
      id: userId,
      displayName: 'Test User',
    },
    channel: { id: 'C_TEST', name: 'test-channel' },
  };
}

describe('buildUserModelBlock', () => {
  describe('skip rules', () => {
    it('returns empty when honcho is disabled', async () => {
      const honcho = makeStubHoncho({ enabled: false });
      const result = await buildUserModelBlock(
        honcho,
        makeIdentity(),
        'a long enough message to pass the min-chars check',
        { isResume: false },
      );
      expect(result).toBe('');
    });

    it('returns empty on resumed sessions', async () => {
      const honcho = makeStubHoncho({
        dialecticResponse: { content: 'should not appear', latencyMs: 100 },
      });
      const result = await buildUserModelBlock(
        honcho,
        makeIdentity(),
        'a long enough message to pass the min-chars check',
        { isResume: true },
      );
      expect(result).toBe('');
    });

    it('returns empty for short messages (under default 20 chars)', async () => {
      const honcho = makeStubHoncho({
        dialecticResponse: { content: 'should not appear', latencyMs: 100 },
      });
      const result = await buildUserModelBlock(
        honcho,
        makeIdentity(),
        'short msg',
        { isResume: false },
      );
      expect(result).toBe('');
    });

    it('respects custom minMessageChars threshold', async () => {
      const honcho = makeStubHoncho({
        dialecticResponse: { content: 'a meaningful response from dialectic', latencyMs: 50 },
      });
      const result = await buildUserModelBlock(
        honcho,
        makeIdentity(),
        'short',
        { isResume: false, minMessageChars: 4 },
      );
      expect(result).toContain('<user-model');
    });

    it('returns empty on per-peer cooldown (second call within window)', async () => {
      const honcho = makeStubHoncho({
        dialecticResponse: { content: 'a meaningful response from dialectic', latencyMs: 50 },
      });
      const identity = makeIdentity('U_COOLDOWN_TEST');

      // First call seeds the cooldown
      const first = await buildUserModelBlock(
        honcho,
        identity,
        'a long enough message to pass the min-chars check',
        { isResume: false },
      );
      expect(first).toContain('<user-model');

      // Second call within default 60s should be skipped
      const second = await buildUserModelBlock(
        honcho,
        identity,
        'another sufficiently long message to pass the threshold',
        { isResume: false },
      );
      expect(second).toBe('');
    });

    it('cooldown=0 lets multiple calls succeed in a row', async () => {
      const honcho = makeStubHoncho({
        dialecticResponse: { content: 'a meaningful response from dialectic', latencyMs: 50 },
      });
      const identity = makeIdentity('U_NO_COOLDOWN_TEST');

      const first = await buildUserModelBlock(
        honcho,
        identity,
        'first message that is long enough to clear the threshold',
        { isResume: false, cooldownMs: 0 },
      );
      const second = await buildUserModelBlock(
        honcho,
        identity,
        'second message that is also long enough to pass through',
        { isResume: false, cooldownMs: 0 },
      );
      expect(first).toContain('<user-model');
      expect(second).toContain('<user-model');
    });
  });

  describe('soft-fail behavior', () => {
    it('returns empty when dialectic throws (no exception bubbles up)', async () => {
      const honcho = makeStubHoncho({ dialecticThrows: true });
      const result = await buildUserModelBlock(
        honcho,
        makeIdentity(),
        'a long enough message to pass the min-chars check',
        { isResume: false },
      );
      expect(result).toBe('');
    });

    it('returns empty when dialectic returns null', async () => {
      const honcho = makeStubHoncho({ dialecticResponse: null });
      const result = await buildUserModelBlock(
        honcho,
        makeIdentity(),
        'a long enough message to pass the min-chars check',
        { isResume: false },
      );
      expect(result).toBe('');
    });
  });

  describe('formatting', () => {
    it('wraps successful dialectic in <user-model> tags', async () => {
      const honcho = makeStubHoncho({
        dialecticResponse: {
          content: 'User prefers terse answers when stressed; expansive when exploring.',
          latencyMs: 234,
        },
      });
      const result = await buildUserModelBlock(
        honcho,
        makeIdentity('U_FORMAT_TEST_1'),
        'a long enough message to pass the min-chars check',
        { isResume: false },
      );
      expect(result).toContain('<user-model');
      expect(result).toContain('peer="U_FORMAT_TEST_1"');
      expect(result).toContain('source="honcho"');
      expect(result).toContain('latency_ms="234"');
      expect(result).toContain('User prefers terse answers');
      expect(result).toContain('</user-model>');
    });

    it('drops "no signal" responses (case-insensitive)', async () => {
      for (const variant of ['no signal', 'No signal', 'NO SIGNAL', 'no signal yet']) {
        const honcho = makeStubHoncho({
          dialecticResponse: { content: variant, latencyMs: 50 },
        });
        const result = await buildUserModelBlock(
          honcho,
          makeIdentity(),
          'a long enough message to pass the min-chars check',
          { isResume: false },
        );
        expect(result).toBe('');
      }
    });

    it('drops short content (under 20 chars)', async () => {
      const honcho = makeStubHoncho({
        dialecticResponse: { content: 'short', latencyMs: 50 },
      });
      const result = await buildUserModelBlock(
        honcho,
        makeIdentity(),
        'a long enough message to pass the min-chars check',
        { isResume: false },
      );
      expect(result).toBe('');
    });

    it('indents multi-line content by 2 spaces', async () => {
      const multiline = 'line one with substantive content\nline two with more content';
      const honcho = makeStubHoncho({
        dialecticResponse: { content: multiline, latencyMs: 50 },
      });
      const result = await buildUserModelBlock(
        honcho,
        makeIdentity(),
        'a long enough message to pass the min-chars check',
        { isResume: false },
      );
      expect(result).toContain('  line one');
      expect(result).toContain('  line two');
    });
  });
});
