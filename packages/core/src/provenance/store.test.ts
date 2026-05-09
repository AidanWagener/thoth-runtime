// Unit tests for provenance/store.ts — memory-source decision trail.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { provenanceStore } from './store';
import type { ProvenanceKind } from './store';

let dbDir: string;

beforeEach(() => {
  dbDir = path.join(os.tmpdir(), `thoth-prov-test-${randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  provenanceStore.init(path.join(dbDir, 'prov.db'));
});

afterEach(() => {
  provenanceStore.close();
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeRow(overrides: Partial<Parameters<typeof provenanceStore.insert>[0]> = {}) {
  return {
    thread_key: 'C123:1700000000.000100',
    spawn_started_at: 1715242800000,
    kind: 'related-episode' as ProvenanceKind,
    source_id: 'episode:42',
    label: 'Past episode about onboarding',
    chars: 280,
    score: 0.81,
    payload_json: '{"preview":"the user asked about..."}',
    ...overrides,
  };
}

describe('provenanceStore', () => {
  describe('insert', () => {
    it('inserts one row, returns its id', () => {
      const id = provenanceStore.insert(makeRow());
      expect(id).toBeGreaterThan(0);
      expect(provenanceStore.count()).toBe(1);
    });

    it('accepts all provenance kinds', () => {
      const kinds: ProvenanceKind[] = [
        'slack-context',
        'user-model',
        'related-episode',
        'persona-stack',
        'skill',
      ];
      for (const k of kinds) {
        provenanceStore.insert(makeRow({ kind: k, label: `${k} label` }));
      }
      expect(provenanceStore.count()).toBe(kinds.length);
    });

    it('allows null score (slack-context, persona-stack have no score)', () => {
      const id = provenanceStore.insert(makeRow({ score: null, kind: 'persona-stack' }));
      expect(id).toBeGreaterThan(0);
    });

    it('allows null source_id (some kinds have no anchor id)', () => {
      const id = provenanceStore.insert(makeRow({ source_id: null }));
      expect(id).toBeGreaterThan(0);
    });
  });

  describe('forEpisode', () => {
    it('returns empty array when no rows match', () => {
      expect(provenanceStore.forEpisode(999)).toEqual([]);
    });

    it('returns rows matching the given episode id, in insertion order', () => {
      const id1 = provenanceStore.insert(makeRow({ label: 'first' }));
      const id2 = provenanceStore.insert(makeRow({ label: 'second' }));
      provenanceStore.bindToEpisode('C123:1700000000.000100', 1715242800000, 7);

      const rows = provenanceStore.forEpisode(7);
      expect(rows.map((r) => r.id)).toEqual([id1, id2]);
      expect(rows.map((r) => r.label)).toEqual(['first', 'second']);
    });

    it('does not return rows bound to a different episode', () => {
      provenanceStore.insert(
        makeRow({ thread_key: 'A', spawn_started_at: 1, label: 'episode-1-row' }),
      );
      provenanceStore.insert(
        makeRow({ thread_key: 'B', spawn_started_at: 2, label: 'episode-2-row' }),
      );
      provenanceStore.bindToEpisode('A', 1, 100);
      provenanceStore.bindToEpisode('B', 2, 200);

      const ep1 = provenanceStore.forEpisode(100);
      const ep2 = provenanceStore.forEpisode(200);
      expect(ep1.map((r) => r.label)).toEqual(['episode-1-row']);
      expect(ep2.map((r) => r.label)).toEqual(['episode-2-row']);
    });
  });

  describe('bindToEpisode', () => {
    it('binds only orphan rows matching (thread_key, spawn_ts)', () => {
      provenanceStore.insert(makeRow({ label: 'will-bind', thread_key: 'X', spawn_started_at: 100 }));
      provenanceStore.insert(
        makeRow({ label: 'wrong-spawn', thread_key: 'X', spawn_started_at: 200 }),
      );
      provenanceStore.insert(
        makeRow({ label: 'wrong-thread', thread_key: 'Y', spawn_started_at: 100 }),
      );

      provenanceStore.bindToEpisode('X', 100, 5);

      expect(provenanceStore.forEpisode(5).map((r) => r.label)).toEqual(['will-bind']);
    });

    it('does not rebind rows already attached to a different episode', () => {
      provenanceStore.insert(makeRow({ label: 'pre-bound', thread_key: 'X', spawn_started_at: 1 }));
      provenanceStore.bindToEpisode('X', 1, 10);
      // Second bind attempt — should be a no-op since episode_id is now non-null
      provenanceStore.bindToEpisode('X', 1, 99);

      expect(provenanceStore.forEpisode(10)).toHaveLength(1);
      expect(provenanceStore.forEpisode(99)).toHaveLength(0);
    });
  });

  describe('count', () => {
    it('returns zero when empty', () => {
      expect(provenanceStore.count()).toBe(0);
    });

    it('reflects total row count', () => {
      provenanceStore.insert(makeRow());
      provenanceStore.insert(makeRow());
      provenanceStore.insert(makeRow());
      expect(provenanceStore.count()).toBe(3);
    });
  });

  describe('init guards', () => {
    it('insert returns -1 when not initialized', () => {
      provenanceStore.close();
      expect(provenanceStore.insert(makeRow())).toBe(-1);
    });

    it('forEpisode returns empty array when not initialized', () => {
      provenanceStore.close();
      expect(provenanceStore.forEpisode(1)).toEqual([]);
    });

    it('count returns 0 when not initialized', () => {
      provenanceStore.close();
      expect(provenanceStore.count()).toBe(0);
    });
  });
});
