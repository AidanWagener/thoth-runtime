// Unit tests for dashboard/sigils.ts — procedural SVG sigil generator.
// The whole point of this module is determinism, so most tests verify
// stable-output guarantees and structural sanity.

import { describe, it, expect } from 'vitest';
import { sigilSvg, sigilForName, councilSealSvg } from './sigils';

describe('sigilForName', () => {
  it('produces an SVG string with viewBox and svg tags', () => {
    const out = sigilForName('Seshat', '#46d3ff');
    expect(out).toMatch(/<svg [^>]*viewBox="0 0 64 64"/);
    expect(out).toMatch(/<\/svg>$/);
  });

  it('is deterministic — same name produces identical output', () => {
    const a = sigilForName('Seshat', '#46d3ff');
    const b = sigilForName('Seshat', '#46d3ff');
    expect(a).toBe(b);
  });

  it('different names produce different sigils', () => {
    const seshat = sigilForName('Seshat', '#46d3ff');
    const ptah = sigilForName('Ptah', '#46d3ff');
    expect(seshat).not.toBe(ptah);
  });

  it('embeds the requested color via style attribute', () => {
    const out = sigilForName('Maat', '#fbbf24');
    expect(out).toContain('color:#fbbf24');
  });

  it('respects custom size', () => {
    const out = sigilForName('Hathor', '#f472b6', { size: 128 });
    expect(out).toContain('width="128"');
    expect(out).toContain('height="128"');
  });

  it('omits ring when ring: false', () => {
    const withRing = sigilForName('Khnum', '#fb923c', { ring: true });
    const without = sigilForName('Khnum', '#fb923c', { ring: false });
    // The ring is rendered as <path d="M ..." stroke-width="0.9" — its
    // absence shrinks the output.
    expect(withRing.length).toBeGreaterThan(without.length);
    expect(without).not.toContain('stroke-width="0.9"');
  });

  it('adds glow filter def when glow: true', () => {
    const out = sigilForName('Anubis', '#a78bfa', { glow: true });
    expect(out).toContain('filter="url(#sigilGlow)"');
    expect(out).toContain('feGaussianBlur');
  });

  it('omits glow filter when glow not requested', () => {
    const out = sigilForName('Anubis', '#a78bfa');
    expect(out).not.toContain('feGaussianBlur');
  });

  it('adds spin class when spinning: true', () => {
    const out = sigilForName('Hermes', '#ffd166', { spinning: true });
    expect(out).toContain('sigil-spin');
  });

  it('always includes the central anchor circle', () => {
    const out = sigilForName('any-name', '#ffffff');
    // The center anchor is filled with currentColor and uses cx/cy = 32
    expect(out).toContain('cx="32" cy="32"');
    expect(out).toContain('fill="currentColor"');
  });
});

describe('sigilSvg (role-based)', () => {
  it('produces output for every defined agent role', () => {
    const roles = ['analyst', 'pm', 'architect', 'dev', 'qa', 'ux', 'master'] as const;
    for (const role of roles) {
      const out = sigilSvg(role);
      expect(out).toMatch(/^<svg /);
      expect(out).toMatch(/<\/svg>$/);
    }
  });

  it('uses the agent accent color', () => {
    // analyst has accent 46d3ff per AGENTS table
    const out = sigilSvg('analyst');
    expect(out.toLowerCase()).toContain('color:#46d3ff');
  });
});

describe('councilSealSvg', () => {
  it('returns a valid empty SVG when given no roles', () => {
    const out = councilSealSvg([]);
    expect(out).toMatch(/^<svg /);
    expect(out).toMatch(/<\/svg>$/);
  });

  it('respects custom size on viewBox + dimensions', () => {
    const out = councilSealSvg(['analyst', 'pm'], { size: 400 });
    expect(out).toContain('viewBox="0 0 400 400"');
    expect(out).toContain('width="400"');
  });

  it('embeds Maats feather glyph as the central mark', () => {
    const out = councilSealSvg(['analyst']);
    expect(out).toContain('𓆄');
  });

  it('includes a <g transform> per role passed in', () => {
    const out = councilSealSvg(['analyst', 'pm', 'dev']);
    const transformCount = (out.match(/<g transform="translate/g) ?? []).length;
    expect(transformCount).toBe(3);
  });

  it('is deterministic for the same role list', () => {
    const a = councilSealSvg(['analyst', 'pm', 'dev']);
    const b = councilSealSvg(['analyst', 'pm', 'dev']);
    expect(a).toBe(b);
  });
});
