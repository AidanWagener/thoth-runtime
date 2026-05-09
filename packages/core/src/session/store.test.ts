// Unit tests for session/store — SQLite-backed thread session storage.
// Uses a tmp file per test for isolation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionStore, type Session } from './store';

let dbPath: string;
let store: SessionStore;

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    thread_key: 'C123:1700000000.0',
    claude_session_id: 'ses_test_001',
    cwd: '/tmp/sandbox/C123-1700000000-0',
    created_at: now,
    last_used: now,
    total_cost_usd: 0,
    num_turns: 0,
    persona_fingerprint: '',
    reflection_run_at: null,
    reflection_cost_usd: null,
    first_peer_id: null,
    channel_id: null,
    channel_name: null,
    thread_ts: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `thoth-session-test-${randomUUID()}.db`);
  store = new SessionStore(dbPath);
});

afterEach(() => {
  store.close();
  // Clean up DB + WAL files
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      // ignore
    }
  }
});

describe('SessionStore', () => {
  describe('get + upsert lifecycle', () => {
    it('returns null for unknown thread_key', () => {
      expect(store.get('does-not-exist')).toBeNull();
    });

    it('upserts a new session and retrieves it', () => {
      const s = makeSession();
      store.upsert(s);
      const got = store.get(s.thread_key);
      expect(got).not.toBeNull();
      expect(got?.thread_key).toBe(s.thread_key);
      expect(got?.claude_session_id).toBe('ses_test_001');
      expect(got?.num_turns).toBe(0);
    });

    it('upsert is idempotent (same key updates rather than duplicates)', () => {
      const s = makeSession({ num_turns: 1, total_cost_usd: 0.05 });
      store.upsert(s);
      store.upsert({ ...s, num_turns: 5, total_cost_usd: 0.25 });
      const got = store.get(s.thread_key);
      expect(got?.num_turns).toBe(5);
      expect(got?.total_cost_usd).toBe(0.25);
    });

    it('upsert updates claude_session_id (session-fork case)', () => {
      const s = makeSession({ claude_session_id: 'ses_v1' });
      store.upsert(s);
      store.upsert({ ...s, claude_session_id: 'ses_v2_after_fork' });
      const got = store.get(s.thread_key);
      expect(got?.claude_session_id).toBe('ses_v2_after_fork');
    });

    it('upsert updates persona_fingerprint (drift detection)', () => {
      const s = makeSession({ persona_fingerprint: 'fp_v1' });
      store.upsert(s);
      store.upsert({ ...s, persona_fingerprint: 'fp_v2_after_edit' });
      const got = store.get(s.thread_key);
      expect(got?.persona_fingerprint).toBe('fp_v2_after_edit');
    });
  });

  describe('delete', () => {
    it('removes the session', () => {
      const s = makeSession();
      store.upsert(s);
      store.delete(s.thread_key);
      expect(store.get(s.thread_key)).toBeNull();
    });

    it('is a no-op for non-existent thread_key', () => {
      expect(() => store.delete('not-there')).not.toThrow();
    });
  });

  describe('setMetadata (COALESCE semantics)', () => {
    it('sets fields when null', () => {
      const s = makeSession();
      store.upsert(s);
      store.setMetadata(s.thread_key, {
        first_peer_id: 'U_TEST_USER',
        channel_id: 'C_TEST_CH',
        channel_name: 'test-channel',
        thread_ts: '1700000000.0',
      });
      const got = store.get(s.thread_key);
      expect(got?.first_peer_id).toBe('U_TEST_USER');
      expect(got?.channel_id).toBe('C_TEST_CH');
      expect(got?.channel_name).toBe('test-channel');
      expect(got?.thread_ts).toBe('1700000000.0');
    });

    it('does NOT overwrite existing values (COALESCE preserves first set)', () => {
      const s = makeSession();
      store.upsert(s);
      store.setMetadata(s.thread_key, { first_peer_id: 'U_FIRST' });
      store.setMetadata(s.thread_key, { first_peer_id: 'U_SECOND' });
      const got = store.get(s.thread_key);
      expect(got?.first_peer_id).toBe('U_FIRST');
    });

    it('only fills in fields passed (others stay null)', () => {
      const s = makeSession();
      store.upsert(s);
      store.setMetadata(s.thread_key, { first_peer_id: 'U_TEST' });
      const got = store.get(s.thread_key);
      expect(got?.first_peer_id).toBe('U_TEST');
      expect(got?.channel_id).toBeNull();
      expect(got?.channel_name).toBeNull();
    });
  });

  describe('markReflected', () => {
    it('sets reflection_run_at and reflection_cost_usd', () => {
      const s = makeSession();
      store.upsert(s);
      store.markReflected(s.thread_key, 0.42);
      const got = store.get(s.thread_key);
      expect(got?.reflection_run_at).toBeGreaterThan(0);
      expect(got?.reflection_cost_usd).toBe(0.42);
    });
  });

  describe('listIdleNeedingReflection', () => {
    it('returns sessions older than idleMs that have a first_peer_id and no reflection_run_at', () => {
      const t = Date.now();
      // Old session, has peer, not reflected → should appear
      store.upsert(makeSession({
        thread_key: 'C:T1',
        last_used: t - 60 * 60 * 1000, // 1h ago
      }));
      store.setMetadata('C:T1', { first_peer_id: 'U_A' });

      // Recent session, has peer, not reflected → should NOT appear
      store.upsert(makeSession({
        thread_key: 'C:T2',
        last_used: t - 5 * 60 * 1000, // 5min ago
      }));
      store.setMetadata('C:T2', { first_peer_id: 'U_A' });

      // Old session, NO peer → should NOT appear (means no successful turn)
      store.upsert(makeSession({
        thread_key: 'C:T3',
        last_used: t - 60 * 60 * 1000,
      }));

      // Old session, has peer, ALREADY reflected → should NOT appear
      store.upsert(makeSession({
        thread_key: 'C:T4',
        last_used: t - 60 * 60 * 1000,
      }));
      store.setMetadata('C:T4', { first_peer_id: 'U_A' });
      store.markReflected('C:T4', 0.5);

      const idle30Min = store.listIdleNeedingReflection(30 * 60 * 1000);
      const keys = idle30Min.map((s) => s.thread_key).sort();
      expect(keys).toEqual(['C:T1']);
    });

    it('returns empty when no sessions match', () => {
      expect(store.listIdleNeedingReflection(1)).toEqual([]);
    });

    it('orders results by last_used ascending (oldest first)', () => {
      const t = Date.now();
      store.upsert(makeSession({ thread_key: 'C:T1', last_used: t - 30 * 60 * 1000 }));
      store.upsert(makeSession({ thread_key: 'C:T2', last_used: t - 60 * 60 * 1000 }));
      store.upsert(makeSession({ thread_key: 'C:T3', last_used: t - 90 * 60 * 1000 }));
      store.setMetadata('C:T1', { first_peer_id: 'U_A' });
      store.setMetadata('C:T2', { first_peer_id: 'U_A' });
      store.setMetadata('C:T3', { first_peer_id: 'U_A' });

      const idle = store.listIdleNeedingReflection(15 * 60 * 1000);
      expect(idle.map((s) => s.thread_key)).toEqual(['C:T3', 'C:T2', 'C:T1']);
    });
  });

  describe('schema migrations', () => {
    it('init() is safe to call repeatedly (idempotent)', () => {
      // First init happens in constructor. Re-create another instance on same db path.
      store.close();
      const store2 = new SessionStore(dbPath);
      const store3 = new SessionStore(dbPath);
      expect(() => store2.upsert(makeSession({ thread_key: 'C:T-mig' }))).not.toThrow();
      expect(store3.get('C:T-mig')).not.toBeNull();
      store2.close();
      store3.close();
    });
  });

  describe('parent-directory creation', () => {
    it('creates the parent directory if it does not exist', () => {
      const subDir = path.join(os.tmpdir(), `thoth-test-${randomUUID()}`, 'nested', 'deeper');
      const dbInSubDir = path.join(subDir, 'test.db');
      const s = new SessionStore(dbInSubDir);
      expect(fs.existsSync(subDir)).toBe(true);
      s.close();
      // cleanup
      try { fs.rmSync(path.dirname(subDir), { recursive: true, force: true }); } catch { /* */ }
    });
  });
});
