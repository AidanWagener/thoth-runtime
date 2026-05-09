// Unit tests for policy/allowlist — security-critical: a wrong allowlist
// gate would let unauthorized users invoke the bot.

import { describe, it, expect } from 'vitest';
import { Allowlist } from './allowlist';

describe('Allowlist', () => {
  it('grants access to listed users', () => {
    const a = new Allowlist(['U_A', 'U_B', 'U_C']);
    expect(a.has('U_A')).toBe(true);
    expect(a.has('U_B')).toBe(true);
    expect(a.has('U_C')).toBe(true);
  });

  it('denies access to unlisted users', () => {
    const a = new Allowlist(['U_A']);
    expect(a.has('U_B')).toBe(false);
    expect(a.has('')).toBe(false);
    expect(a.has('U_b')).toBe(false); // case-sensitive
  });

  it('handles an empty allowlist (denies everyone)', () => {
    const a = new Allowlist([]);
    expect(a.has('U_A')).toBe(false);
    expect(a.list()).toEqual([]);
  });

  it('list() returns all allowed user IDs', () => {
    const a = new Allowlist(['U_A', 'U_B']);
    expect(a.list().sort()).toEqual(['U_A', 'U_B']);
  });

  it('deduplicates input via Set semantics', () => {
    const a = new Allowlist(['U_A', 'U_A', 'U_B', 'U_A']);
    expect(a.list().sort()).toEqual(['U_A', 'U_B']);
  });

  it('list() is independent from internal state (mutation does not affect Allowlist)', () => {
    const a = new Allowlist(['U_A', 'U_B']);
    const out = a.list();
    out.push('U_C');
    expect(a.has('U_C')).toBe(false);
    expect(a.list().sort()).toEqual(['U_A', 'U_B']);
  });

  it('case sensitivity matters (U_A !== U_a)', () => {
    const a = new Allowlist(['U_A']);
    expect(a.has('U_A')).toBe(true);
    expect(a.has('U_a')).toBe(false);
    expect(a.has('u_a')).toBe(false);
  });
});
