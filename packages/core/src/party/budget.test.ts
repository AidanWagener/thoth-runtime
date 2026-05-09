// Unit tests for party/budget.ts — daily party-cost cap (separate bucket
// from reflection costs).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { partyDailyCap } from './budget';

let dbDir: string;

beforeEach(() => {
  dbDir = path.join(os.tmpdir(), `thoth-party-budget-test-${randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  partyDailyCap.init(path.join(dbDir, 'party-budget.db'));
});

afterEach(() => {
  partyDailyCap.close();
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe('partyDailyCap', () => {
  describe('underCap', () => {
    it('returns true when no spend recorded', () => {
      expect(partyDailyCap.underCap(10.0)).toBe(true);
    });

    it('returns true when spend is below cap', () => {
      partyDailyCap.record(2.0);
      expect(partyDailyCap.underCap(10.0)).toBe(true);
    });

    it('returns false when spend equals cap (strict <)', () => {
      partyDailyCap.record(10.0);
      expect(partyDailyCap.underCap(10.0)).toBe(false);
    });

    it('returns false when spend exceeds cap', () => {
      partyDailyCap.record(15.0);
      expect(partyDailyCap.underCap(10.0)).toBe(false);
    });
  });

  describe('record', () => {
    it('creates new daily row on first call', () => {
      const result = partyDailyCap.record(0.85);
      expect(result.todayUsd).toBeCloseTo(0.85, 5);
      expect(result.todayCount).toBe(1);
    });

    it('accumulates across calls', () => {
      partyDailyCap.record(1.0);
      partyDailyCap.record(2.0);
      const result = partyDailyCap.record(0.5);
      expect(result.todayUsd).toBeCloseTo(3.5, 5);
      expect(result.todayCount).toBe(3);
    });
  });

  describe('todaySnapshot', () => {
    it('returns zeros on empty', () => {
      const snap = partyDailyCap.todaySnapshot();
      expect(snap.todayUsd).toBe(0);
      expect(snap.todayCount).toBe(0);
    });

    it('reflects accumulated state', () => {
      partyDailyCap.record(0.5);
      partyDailyCap.record(1.5);
      const snap = partyDailyCap.todaySnapshot();
      expect(snap.todayUsd).toBeCloseTo(2.0, 5);
      expect(snap.todayCount).toBe(2);
    });
  });

  describe('init guards', () => {
    it('throws when used before init', () => {
      partyDailyCap.close();
      expect(() => partyDailyCap.underCap(10)).toThrow(/not initialized/);
    });
  });
});
