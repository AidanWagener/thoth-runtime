// Unit tests for scheduling/store.ts — pending future-Thoth-spawn registry.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { scheduledRunStore } from './store';

let dbDir: string;

beforeEach(() => {
  dbDir = path.join(os.tmpdir(), `thoth-sched-test-${randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  scheduledRunStore.init(path.join(dbDir, 'sched.db'));
});

afterEach(() => {
  scheduledRunStore.close();
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeRow(overrides: Partial<Parameters<typeof scheduledRunStore.insert>[0]> = {}) {
  return {
    thread_key: 'C123:1700000000.000100',
    channel_id: 'C123',
    thread_ts: '1700000000.000100',
    peer_id: 'U_USER',
    prompt_text: 'Follow up on the deploy status',
    reason: 'reflection-suggested-followup',
    run_at: Date.now() + 60_000, // 1 minute in the future
    source: 'reflection',
    ...overrides,
  };
}

describe('scheduledRunStore', () => {
  describe('insert', () => {
    it('inserts a pending run, returns id', () => {
      const id = scheduledRunStore.insert(makeRow());
      expect(id).toBeGreaterThan(0);

      const pending = scheduledRunStore.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.status).toBe('pending');
      expect(pending[0]?.fired_at).toBeNull();
    });

    it('accepts null reason and source', () => {
      const id = scheduledRunStore.insert(makeRow({ reason: null, source: null }));
      expect(id).toBeGreaterThan(0);
    });
  });

  describe('listPending + due', () => {
    it('listPending sorts by run_at ascending (soonest first)', () => {
      const now = Date.now();
      scheduledRunStore.insert(makeRow({ run_at: now + 30_000, prompt_text: 'middle' }));
      scheduledRunStore.insert(makeRow({ run_at: now + 90_000, prompt_text: 'last' }));
      scheduledRunStore.insert(makeRow({ run_at: now + 10_000, prompt_text: 'first' }));

      const pending = scheduledRunStore.listPending();
      expect(pending.map((r) => r.prompt_text)).toEqual(['first', 'middle', 'last']);
    });

    it('due returns only runs whose run_at is at-or-before now', () => {
      const now = Date.now();
      scheduledRunStore.insert(makeRow({ run_at: now - 1000, prompt_text: 'ready' }));
      scheduledRunStore.insert(makeRow({ run_at: now + 1000, prompt_text: 'not-yet' }));

      const due = scheduledRunStore.due(now);
      expect(due.map((r) => r.prompt_text)).toEqual(['ready']);
    });

    it('due excludes non-pending runs even if run_at is past', () => {
      const id = scheduledRunStore.insert(makeRow({ run_at: Date.now() - 1000 }));
      scheduledRunStore.setStatus(id, 'fired');
      expect(scheduledRunStore.due()).toEqual([]);
    });
  });

  describe('setStatus', () => {
    it('sets fired_at when transitioning to fired', () => {
      const id = scheduledRunStore.insert(makeRow());
      const before = Date.now();
      scheduledRunStore.setStatus(id, 'fired');
      const after = Date.now();

      const r = scheduledRunStore.listPending();
      expect(r).toHaveLength(0); // fired runs aren't pending

      const lastFired = scheduledRunStore.lastFiredAt('C123:1700000000.000100');
      expect(lastFired).not.toBeNull();
      expect(lastFired!).toBeGreaterThanOrEqual(before);
      expect(lastFired!).toBeLessThanOrEqual(after);
    });

    it('does not set fired_at when transitioning to cancelled or failed', () => {
      const id1 = scheduledRunStore.insert(makeRow({ thread_key: 'A' }));
      const id2 = scheduledRunStore.insert(makeRow({ thread_key: 'B' }));
      scheduledRunStore.setStatus(id1, 'cancelled');
      scheduledRunStore.setStatus(id2, 'failed');

      expect(scheduledRunStore.lastFiredAt('A')).toBeNull();
      expect(scheduledRunStore.lastFiredAt('B')).toBeNull();
    });
  });

  describe('countPendingForThread', () => {
    it('returns 0 for unknown thread', () => {
      expect(scheduledRunStore.countPendingForThread('C_UNKNOWN')).toBe(0);
    });

    it('counts only pending in the given thread', () => {
      scheduledRunStore.insert(makeRow({ thread_key: 'A' }));
      const fired = scheduledRunStore.insert(makeRow({ thread_key: 'A' }));
      scheduledRunStore.setStatus(fired, 'fired');
      scheduledRunStore.insert(makeRow({ thread_key: 'B' }));

      expect(scheduledRunStore.countPendingForThread('A')).toBe(1);
      expect(scheduledRunStore.countPendingForThread('B')).toBe(1);
    });
  });

  describe('countFiredForThread', () => {
    it('counts only fired runs scoped to thread', () => {
      const id1 = scheduledRunStore.insert(makeRow({ thread_key: 'A' }));
      const id2 = scheduledRunStore.insert(makeRow({ thread_key: 'A' }));
      const id3 = scheduledRunStore.insert(makeRow({ thread_key: 'A' }));
      scheduledRunStore.setStatus(id1, 'fired');
      scheduledRunStore.setStatus(id2, 'fired');
      // id3 stays pending

      expect(scheduledRunStore.countFiredForThread('A')).toBe(2);
      expect(scheduledRunStore.countFiredForThread('B')).toBe(0);
    });
  });

  describe('cancelPendingForThread', () => {
    it('cancels every pending run for the thread, returns the count', () => {
      const id1 = scheduledRunStore.insert(makeRow({ thread_key: 'A' }));
      scheduledRunStore.insert(makeRow({ thread_key: 'A' }));
      scheduledRunStore.insert(makeRow({ thread_key: 'A' }));
      scheduledRunStore.setStatus(id1, 'fired'); // already fired — should NOT be cancelled

      const cancelled = scheduledRunStore.cancelPendingForThread('A');
      expect(cancelled).toBe(2);
      expect(scheduledRunStore.countPendingForThread('A')).toBe(0);
      // Original fired run is preserved
      expect(scheduledRunStore.countFiredForThread('A')).toBe(1);
    });

    it('returns 0 when nothing to cancel', () => {
      expect(scheduledRunStore.cancelPendingForThread('C_NONE')).toBe(0);
    });
  });

  describe('init guards', () => {
    it('throws when not initialized', () => {
      scheduledRunStore.close();
      expect(() => scheduledRunStore.listPending()).toThrow(/not initialized/);
    });
  });
});
