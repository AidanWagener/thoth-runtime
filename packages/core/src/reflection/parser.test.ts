// Unit tests for reflection/parser — Reflexion output is the single
// most important agent-generated artifact (it writes back to memory,
// skills, persona). Parsing must be robust to model output quirks.

import { describe, it, expect } from 'vitest';
import { parseReflection, reflectionSchema } from './parser';

const minimalReflection = {
  outcome: 'success',
  what_worked: null,
  what_didnt: null,
  should_skill: false,
  skill_slug: null,
  skill_description: null,
  skill_body: null,
  memory_notes: [],
  persona_observations: [],
  next_check_at: null,
  user_model_updates: {},
};

describe('parseReflection', () => {
  it('parses a clean JSON output', () => {
    const out = parseReflection(JSON.stringify(minimalReflection));
    expect(out).not.toBeNull();
    expect(out?.outcome).toBe('success');
    expect(out?.memory_notes).toEqual([]);
  });

  it('strips ```json fences', () => {
    const wrapped = '```json\n' + JSON.stringify(minimalReflection) + '\n```';
    const out = parseReflection(wrapped);
    expect(out).not.toBeNull();
  });

  it('strips ``` plain fences', () => {
    const wrapped = '```\n' + JSON.stringify(minimalReflection) + '\n```';
    const out = parseReflection(wrapped);
    expect(out).not.toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseReflection('')).toBeNull();
    expect(parseReflection('   ')).toBeNull();
    expect(parseReflection('\n\n\n')).toBeNull();
  });

  it('returns null for non-JSON text', () => {
    expect(parseReflection('this is not json at all')).toBeNull();
  });

  it('recovers JSON from surrounding prose', () => {
    const noisy =
      "Here's my reflection:\n" +
      JSON.stringify(minimalReflection) +
      '\n\nLet me know if you need anything else.';
    const out = parseReflection(noisy);
    expect(out).not.toBeNull();
    expect(out?.outcome).toBe('success');
  });

  describe('outcome validation', () => {
    it('accepts the three legal outcomes', () => {
      for (const outcome of ['success', 'partial', 'failure'] as const) {
        const out = parseReflection(JSON.stringify({ ...minimalReflection, outcome }));
        expect(out?.outcome).toBe(outcome);
      }
    });

    it('rejects an unknown outcome value', () => {
      const out = parseReflection(
        JSON.stringify({ ...minimalReflection, outcome: 'maybe' }),
      );
      expect(out).toBeNull();
    });
  });

  describe('skill_slug validation', () => {
    it('accepts kebab-case slugs', () => {
      const out = parseReflection(
        JSON.stringify({
          ...minimalReflection,
          should_skill: true,
          skill_slug: 'sentry-triage',
        }),
      );
      expect(out?.skill_slug).toBe('sentry-triage');
    });

    it('rejects slugs that start with a number', () => {
      const out = parseReflection(
        JSON.stringify({ ...minimalReflection, skill_slug: '7-best-practices' }),
      );
      expect(out).toBeNull();
    });

    it('rejects slugs with uppercase', () => {
      const out = parseReflection(
        JSON.stringify({ ...minimalReflection, skill_slug: 'Sentry-Triage' }),
      );
      expect(out).toBeNull();
    });

    it('rejects slugs with underscores', () => {
      const out = parseReflection(
        JSON.stringify({ ...minimalReflection, skill_slug: 'sentry_triage' }),
      );
      expect(out).toBeNull();
    });

    it('rejects empty-after-trim strings as null (transforms)', () => {
      const out = parseReflection(
        JSON.stringify({ ...minimalReflection, skill_slug: '   ' }),
      );
      expect(out?.skill_slug).toBeNull();
    });
  });

  describe('next_check_at parsing', () => {
    it('accepts a valid ISO 8601 string', () => {
      const out = parseReflection(
        JSON.stringify({
          ...minimalReflection,
          next_check_at: '2026-05-09T12:00:00.000Z',
        }),
      );
      expect(out?.next_check_at).toBe('2026-05-09T12:00:00.000Z');
    });

    it('normalizes loose date strings to ISO', () => {
      const out = parseReflection(
        JSON.stringify({ ...minimalReflection, next_check_at: '2026-05-09' }),
      );
      expect(out?.next_check_at).toMatch(/^2026-05-09T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('returns null for unparseable date', () => {
      const out = parseReflection(
        JSON.stringify({ ...minimalReflection, next_check_at: 'next tuesday' }),
      );
      expect(out?.next_check_at).toBeNull();
    });
  });

  describe('memory_notes + persona_observations', () => {
    it('trims whitespace and removes empty entries', () => {
      const out = parseReflection(
        JSON.stringify({
          ...minimalReflection,
          memory_notes: [' note A ', '', '  ', 'note B'],
          persona_observations: ['obs A', '', 'obs B'],
        }),
      );
      expect(out?.memory_notes).toEqual(['note A', 'note B']);
      expect(out?.persona_observations).toEqual(['obs A', 'obs B']);
    });

    it('handles null/undefined as empty array', () => {
      const out = parseReflection(
        JSON.stringify({
          ...minimalReflection,
          memory_notes: null,
          persona_observations: null,
        }),
      );
      expect(out?.memory_notes).toEqual([]);
      expect(out?.persona_observations).toEqual([]);
    });
  });

  describe('user_model_updates', () => {
    it('preserves valid peer-keyed records', () => {
      const out = parseReflection(
        JSON.stringify({
          ...minimalReflection,
          user_model_updates: { U_A: ['note 1', 'note 2'] },
        }),
      );
      expect(out?.user_model_updates).toEqual({ U_A: ['note 1', 'note 2'] });
    });

    it('drops empty arrays', () => {
      const out = parseReflection(
        JSON.stringify({
          ...minimalReflection,
          user_model_updates: { U_A: [], U_B: ['real note'] },
        }),
      );
      expect(out?.user_model_updates).toEqual({ U_B: ['real note'] });
    });

    it('handles null as empty record', () => {
      const out = parseReflection(
        JSON.stringify({ ...minimalReflection, user_model_updates: null }),
      );
      expect(out?.user_model_updates).toEqual({});
    });
  });

  describe('banned-keyword guard', () => {
    it('rejects reflection containing "Hermes" anywhere', () => {
      const out = parseReflection(
        JSON.stringify({
          ...minimalReflection,
          memory_notes: ['User mentioned Hermes architecture'],
        }),
      );
      expect(out).toBeNull();
    });

    it('rejects reflection containing "openclaw"', () => {
      const out = parseReflection(
        JSON.stringify({
          ...minimalReflection,
          what_worked: 'OpenClaw approach worked',
        }),
      );
      expect(out).toBeNull();
    });

    it('rejects "nanoclaw" (case insensitive)', () => {
      const out = parseReflection(
        JSON.stringify({
          ...minimalReflection,
          what_worked: 'NanoClaw was better',
        }),
      );
      expect(out).toBeNull();
    });

    it('passes clean reflections without banned words', () => {
      const out = parseReflection(
        JSON.stringify({
          ...minimalReflection,
          what_worked: 'Thoth handled the request gracefully',
        }),
      );
      expect(out).not.toBeNull();
    });
  });

  describe('schema robustness', () => {
    it('reflectionSchema is exported and usable directly', () => {
      const r = reflectionSchema.safeParse(minimalReflection);
      expect(r.success).toBe(true);
    });
  });
});
