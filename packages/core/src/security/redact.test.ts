// Unit tests for security/redact — high-value because secret leakage is
// catastrophic and the redaction patterns are easy to regress.

import { describe, it, expect } from 'vitest';
import { redact, containsSecrets } from './redact';

describe('redact', () => {
  describe('Slack tokens', () => {
    it('redacts xoxb- bot tokens', () => {
      const r = redact('My token is xoxb-1234567890-1234567890-abcdefghijk');
      expect(r.redacted).toBe(true);
      expect(r.text).not.toContain('xoxb-1234567890-1234567890-abcdefghijk');
      expect(r.text).toContain('[REDACTED:slack-bot-token]');
    });

    it('redacts xapp- app tokens', () => {
      const r = redact('And xapp-1-A012-3456-abcdefghijklmn');
      expect(r.redacted).toBe(true);
      expect(r.text).not.toContain('xapp-1-A012-3456-abcdefghijklmn');
      expect(r.text).toContain('[REDACTED:slack-app-token]');
    });
  });

  describe('GitHub tokens', () => {
    it('redacts ghp_ classic tokens', () => {
      const r = redact('token ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF');
      expect(r.redacted).toBe(true);
      expect(r.text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF');
      expect(r.text).toContain('[REDACTED:github-pat-classic]');
    });

    it('redacts github_pat_ fine-grained tokens', () => {
      const r = redact(
        'pat: github_pat_11ABCDEFG0_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ',
      );
      expect(r.redacted).toBe(true);
      expect(r.text).not.toContain(
        'github_pat_11ABCDEFG0_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ',
      );
      expect(r.text).toContain('[REDACTED:github-pat-fine]');
    });
  });

  describe('Anthropic + OpenAI keys', () => {
    it('redacts sk- secret keys', () => {
      const r = redact('OPENAI=sk-proj-abcdefghijklmnopqrstuvwxyzABCDEFG');
      expect(r.redacted).toBe(true);
      expect(r.text).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyzABCDEFG');
      // env-secret rule fires first because of OPENAI= prefix
      expect(r.text).toMatch(/REDACTED:(env-secret|openai-key)/);
    });

    it('redacts sk-ant- Anthropic keys', () => {
      const r = redact(
        'token: sk-ant-api03-abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
      );
      expect(r.redacted).toBe(true);
      expect(r.text).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyzABCDEFGHIJ');
      expect(r.text).toMatch(/REDACTED:(anthropic-key|openai-key)/);
    });
  });

  describe('Honcho keys', () => {
    it('redacts hch-v1 keys', () => {
      const r = redact(
        'HONCHO=hch-v1-abcdefghijklmnopqrstuvwxyz01234567',
      );
      expect(r.redacted).toBe(true);
      expect(r.text).not.toContain('hch-v1-abcdefghijklmnopqrstuvwxyz01234567');
      expect(r.text).toMatch(/REDACTED:(honcho-key|env-secret)/);
    });
  });

  describe('AWS keys', () => {
    it('redacts AKIA access key IDs', () => {
      const r = redact('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
      expect(r.redacted).toBe(true);
      expect(r.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });
  });

  describe('clean strings', () => {
    it('passes plain text unmodified', () => {
      const input = 'No secrets here, just words';
      const r = redact(input);
      expect(r.redacted).toBe(false);
      expect(r.text).toBe(input);
    });

    it('preserves Slack user IDs (not secrets per se)', () => {
      const input = 'User U_EXAMPLE_USER_01 mentioned C_EXAMPLE_CH_01';
      const r = redact(input);
      expect(r.redacted).toBe(false);
      expect(r.text).toBe(input);
    });
  });

  describe('multiple secrets in one input', () => {
    it('redacts each one with its own kind label', () => {
      const r = redact(
        'xoxb-aaa1234567890bbb1234567890ccc and ghp_abcdefghijklmnopqrstuvwxyz012345',
      );
      expect(r.redacted).toBe(true);
      expect(r.text).not.toContain('xoxb-aaa1234567890bbb1234567890ccc');
      expect(r.text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz012345');
      expect(r.replacements.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('env-style assignments', () => {
    it('redacts the value, keeps the variable name', () => {
      const r = redact('SLACK_BOT_TOKEN="hidden_value_secret_8chars"');
      expect(r.redacted).toBe(true);
      expect(r.text).toContain('SLACK_BOT_TOKEN=[REDACTED:env-secret]');
      expect(r.text).not.toContain('hidden_value_secret_8chars');
    });
  });

  describe('empty / nullish input', () => {
    it('returns empty string unchanged', () => {
      const r = redact('');
      expect(r.redacted).toBe(false);
      expect(r.text).toBe('');
    });
  });
});

describe('containsSecrets', () => {
  it('returns true when a secret pattern matches', () => {
    expect(containsSecrets('token xoxb-1234567890-1234567890-abc')).toBe(true);
  });

  it('returns false on clean text', () => {
    expect(containsSecrets('No secrets here')).toBe(false);
    expect(containsSecrets('')).toBe(false);
  });
});
