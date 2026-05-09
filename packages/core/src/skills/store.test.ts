// Unit tests for skills/store.ts — the skill-draft SQLite-backed registry.
// Uses a temp DB path per test to keep the module-level singleton clean.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { skillDraftStore } from './store';

let dbDir: string;
let dbPath: string;

beforeEach(() => {
  dbDir = path.join(os.tmpdir(), `thoth-skills-test-${randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  dbPath = path.join(dbDir, 'skills.db');
  skillDraftStore.init(dbPath);
});

afterEach(() => {
  skillDraftStore.close();
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {
    // Windows can hold the file briefly after close — best effort cleanup
  }
});

function makeDraftFixture(overrides: Partial<Parameters<typeof skillDraftStore.insert>[0]> = {}) {
  return {
    slug: 'test-skill',
    file_path: '/skills/test-skill/SKILL.md',
    description: 'A test skill',
    source_thread_key: 'C123:1234.5678',
    source_channel_id: 'C123',
    proposed_by: 'reflection-pass-2026-05-09',
    status: 'pending' as const,
    created_at: Date.now(),
    ...overrides,
  };
}

describe('skillDraftStore', () => {
  describe('insert + findById', () => {
    it('inserts a draft and returns its id', () => {
      const id = skillDraftStore.insert(makeDraftFixture());
      expect(id).toBeGreaterThan(0);

      const row = skillDraftStore.findById(id);
      expect(row).not.toBeNull();
      expect(row?.slug).toBe('test-skill');
      expect(row?.status).toBe('pending');
      expect(row?.slack_channel).toBeNull();
    });

    it('returns null for unknown id', () => {
      expect(skillDraftStore.findById(999_999)).toBeNull();
    });

    it('auto-increments ids across inserts', () => {
      const id1 = skillDraftStore.insert(makeDraftFixture({ slug: 'one' }));
      const id2 = skillDraftStore.insert(makeDraftFixture({ slug: 'two' }));
      expect(id2).toBeGreaterThan(id1);
    });
  });

  describe('attachSlackMessage + findBySlackMessage', () => {
    it('attaches Slack message metadata and looks it up', () => {
      const id = skillDraftStore.insert(makeDraftFixture());
      skillDraftStore.attachSlackMessage(id, 'C_FOUNDER', '1715242800.000100');

      const row = skillDraftStore.findBySlackMessage('C_FOUNDER', '1715242800.000100');
      expect(row?.id).toBe(id);
      expect(row?.slack_channel).toBe('C_FOUNDER');
      expect(row?.slack_message_ts).toBe('1715242800.000100');
    });

    it('returns null when no draft matches', () => {
      expect(skillDraftStore.findBySlackMessage('C_NONE', '0.0')).toBeNull();
    });
  });

  describe('setStatus', () => {
    it('transitions pending → accepted with decided_by + decided_at', () => {
      const id = skillDraftStore.insert(makeDraftFixture());
      const before = Date.now();
      skillDraftStore.setStatus(id, 'accepted', 'U_FOUNDER');
      const after = Date.now();

      const row = skillDraftStore.findById(id);
      expect(row?.status).toBe('accepted');
      expect(row?.decided_by).toBe('U_FOUNDER');
      expect(row?.decided_at).toBeGreaterThanOrEqual(before);
      expect(row?.decided_at).toBeLessThanOrEqual(after);
    });

    it('transitions to rejected with null decider (system-rejected)', () => {
      const id = skillDraftStore.insert(makeDraftFixture());
      skillDraftStore.setStatus(id, 'rejected', null);
      const row = skillDraftStore.findById(id);
      expect(row?.status).toBe('rejected');
      expect(row?.decided_by).toBeNull();
    });

    it('transitions to expired', () => {
      const id = skillDraftStore.insert(makeDraftFixture());
      skillDraftStore.setStatus(id, 'expired', null);
      expect(skillDraftStore.findById(id)?.status).toBe('expired');
    });
  });

  describe('listAll', () => {
    it('returns drafts newest-first', () => {
      const old = skillDraftStore.insert(makeDraftFixture({ slug: 'old', created_at: 1000 }));
      const mid = skillDraftStore.insert(makeDraftFixture({ slug: 'mid', created_at: 2000 }));
      const young = skillDraftStore.insert(makeDraftFixture({ slug: 'young', created_at: 3000 }));

      const all = skillDraftStore.listAll();
      expect(all.map((r) => r.id)).toEqual([young, mid, old]);
    });

    it('respects limit parameter', () => {
      skillDraftStore.insert(makeDraftFixture({ slug: 'a' }));
      skillDraftStore.insert(makeDraftFixture({ slug: 'b' }));
      skillDraftStore.insert(makeDraftFixture({ slug: 'c' }));
      expect(skillDraftStore.listAll(2)).toHaveLength(2);
    });

    it('returns empty array when empty', () => {
      expect(skillDraftStore.listAll()).toEqual([]);
    });
  });

  describe('listPending', () => {
    it('includes pending and accepted, excludes rejected and expired', () => {
      const p = skillDraftStore.insert(makeDraftFixture({ slug: 'p' }));
      const a = skillDraftStore.insert(makeDraftFixture({ slug: 'a' }));
      const r = skillDraftStore.insert(makeDraftFixture({ slug: 'r' }));
      const e = skillDraftStore.insert(makeDraftFixture({ slug: 'e' }));
      skillDraftStore.setStatus(a, 'accepted', 'U_FOUNDER');
      skillDraftStore.setStatus(r, 'rejected', 'U_FOUNDER');
      skillDraftStore.setStatus(e, 'expired', null);

      const pending = skillDraftStore.listPending();
      const ids = pending.map((row) => row.id);
      expect(ids).toContain(p);
      expect(ids).toContain(a);
      expect(ids).not.toContain(r);
      expect(ids).not.toContain(e);
    });
  });

  describe('listPendingOlderThan', () => {
    it('returns only pending drafts older than threshold', () => {
      const now = Date.now();
      // 10 minutes ago — should be returned with 5min threshold
      const oldId = skillDraftStore.insert(
        makeDraftFixture({ slug: 'old', created_at: now - 10 * 60 * 1000 }),
      );
      // 1 minute ago — should NOT be returned
      const newId = skillDraftStore.insert(
        makeDraftFixture({ slug: 'fresh', created_at: now - 60 * 1000 }),
      );
      // 10 minutes ago BUT accepted — should NOT be returned (only pending)
      const acceptedOld = skillDraftStore.insert(
        makeDraftFixture({ slug: 'accepted-old', created_at: now - 10 * 60 * 1000 }),
      );
      skillDraftStore.setStatus(acceptedOld, 'accepted', 'U_FOUNDER');

      const stale = skillDraftStore.listPendingOlderThan(5 * 60 * 1000);
      const ids = stale.map((r) => r.id);
      expect(ids).toContain(oldId);
      expect(ids).not.toContain(newId);
      expect(ids).not.toContain(acceptedOld);
    });

    it('returns empty when nothing is stale', () => {
      skillDraftStore.insert(makeDraftFixture({ created_at: Date.now() }));
      expect(skillDraftStore.listPendingOlderThan(60 * 60 * 1000)).toEqual([]);
    });
  });

  describe('init guards', () => {
    it('throws when used before init', () => {
      skillDraftStore.close();
      expect(() => skillDraftStore.findById(1)).toThrow(/not initialized/);
    });
  });
});
