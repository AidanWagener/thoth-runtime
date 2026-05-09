// Unit tests for reflection/daily-cap.ts — per-day cost-cap counter.
// Uses a temp DB per test to keep the module-level singleton clean.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dailyCostCap } from './daily-cap';

let dbDir: string;

beforeEach(() => {
  dbDir = path.join(os.tmpdir(), `thoth-cap-test-${randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  dailyCostCap.init(path.join(dbDir, 'cap.db'));
});

afterEach(() => {
  dailyCostCap.close();
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe('dailyCostCap', () => {
  describe('underCap', () => {
    it('returns true when no spend recorded yet', () => {
      expect(dailyCostCap.underCap(5.0)).toBe(true);
    });

    it('returns true when spend is below cap', () => {
      dailyCostCap.record(0.5);
      dailyCostCap.record(0.3);
      expect(dailyCostCap.underCap(5.0)).toBe(true);
    });

    it('returns false when spend is at or above cap', () => {
      dailyCostCap.record(3.0);
      dailyCostCap.record(2.5);
      expect(dailyCostCap.underCap(5.0)).toBe(false);
    });

    it('returns false at exactly the cap (strict <)', () => {
      dailyCostCap.record(5.0);
      expect(dailyCostCap.underCap(5.0)).toBe(false);
    });
  });

  describe('record', () => {
    it('creates a new daily row on first call', () => {
      const result = dailyCostCap.record(0.42);
      expect(result.todayUsd).toBeCloseTo(0.42, 5);
      expect(result.todayCount).toBe(1);
    });

    it('accumulates cost across multiple calls in the same day', () => {
      dailyCostCap.record(0.10);
      dailyCostCap.record(0.20);
      const result = dailyCostCap.record(0.30);
      expect(result.todayUsd).toBeCloseTo(0.60, 5);
      expect(result.todayCount).toBe(3);
    });

    it('records zero-cost runs correctly (free interactions)', () => {
      const result = dailyCostCap.record(0);
      expect(result.todayUsd).toBe(0);
      expect(result.todayCount).toBe(1);
    });
  });

  describe('todaySnapshot', () => {
    it('returns zeros when no spend recorded yet', () => {
      const snap = dailyCostCap.todaySnapshot();
      expect(snap.todayUsd).toBe(0);
      expect(snap.todayCount).toBe(0);
    });

    it('reflects accumulated state after recording', () => {
      dailyCostCap.record(1.5);
      dailyCostCap.record(2.5);
      const snap = dailyCostCap.todaySnapshot();
      expect(snap.todayUsd).toBeCloseTo(4.0, 5);
      expect(snap.todayCount).toBe(2);
    });
  });

  describe('init guards', () => {
    it('throws when used before init', () => {
      dailyCostCap.close();
      expect(() => dailyCostCap.underCap(5.0)).toThrow(/not initialized/);
    });
  });
});
