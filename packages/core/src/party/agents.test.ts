// Unit tests for party/agents.ts — focused on the pure functions
// (parseRoster) and the AGENTS constant shape.

import { describe, it, expect } from 'vitest';
import { AGENTS, DEFAULT_ROSTER, parseRoster } from './agents';

describe('AGENTS', () => {
  it('has all 7 expected roles', () => {
    const keys = Object.keys(AGENTS).sort();
    expect(keys).toEqual(['analyst', 'architect', 'dev', 'master', 'pm', 'qa', 'ux']);
  });

  it('every spec has the required fields', () => {
    for (const [role, spec] of Object.entries(AGENTS)) {
      expect(spec.role).toBe(role);
      expect(spec.name).toBeTruthy();
      expect(spec.title).toBeTruthy();
      expect(spec.display).toContain(spec.name);
      expect(spec.display).toContain(spec.title);
      expect(spec.accent).toMatch(/^[0-9a-fA-F]{6}$/);
      expect(spec.glyph.length).toBeGreaterThan(0);
      expect(spec.personaFileName).toMatch(/\.md$/);
    }
  });

  it('persona file names are unique across roles', () => {
    const files = Object.values(AGENTS).map((a) => a.personaFileName);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe('DEFAULT_ROSTER', () => {
  it('excludes master (synthesis is invoked separately)', () => {
    expect(DEFAULT_ROSTER).not.toContain('master');
  });

  it('contains the 6 working agents in canonical order', () => {
    expect(DEFAULT_ROSTER).toEqual(['analyst', 'pm', 'architect', 'dev', 'qa', 'ux']);
  });
});

describe('parseRoster', () => {
  it('parses a single role', () => {
    expect(parseRoster('analyst')).toEqual(['analyst']);
  });

  it('parses comma-separated multiple roles', () => {
    expect(parseRoster('analyst, pm, dev')).toEqual(['analyst', 'pm', 'dev']);
  });

  it('lowercases and trims input', () => {
    expect(parseRoster(' Analyst ,  PM ,DEV')).toEqual(['analyst', 'pm', 'dev']);
  });

  it('filters out empty segments', () => {
    expect(parseRoster('analyst,,pm,')).toEqual(['analyst', 'pm']);
  });

  it('returns null on unknown role', () => {
    expect(parseRoster('analyst, wizard, dev')).toBeNull();
  });

  it('returns null when master is requested (master is auto-invoked)', () => {
    expect(parseRoster('master')).toBeNull();
    expect(parseRoster('analyst, master, dev')).toBeNull();
  });

  it('returns empty array for empty string (no roles selected)', () => {
    expect(parseRoster('')).toEqual([]);
  });

  it('preserves duplicates if user explicitly lists the same role twice', () => {
    // Behavior contract: parseRoster doesn't dedupe — caller decides.
    expect(parseRoster('dev, dev, dev')).toEqual(['dev', 'dev', 'dev']);
  });
});
