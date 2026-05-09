// Unit tests for memory/episodic — covers schema + non-embed methods.
// The embed-dependent paths (write, recall) are integration-tested
// separately because they require warming the 25MB Xenova model,
// which would slow CI by ~12s. These unit tests cover everything else.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { EpisodicStore } from './episodic';

let dbPath: string;
let store: EpisodicStore;

/** Insert a test episode directly via raw SQLite — bypasses embedder. */
function insertFakeEpisode(opts: {
  threadKey: string;
  peer: string;
  userText?: string;
  apexSummary?: string;
  channelId?: string | null;
  channelName?: string | null;
  threadTs?: string | null;
  numTurns?: number;
  costUsd?: number;
  createdAt?: number;
  outdated?: 0 | 1;
  slackMessageTs?: string | null;
  slackChannelId?: string | null;
}): number {
  const db = new Database(dbPath);
  // Minimal 384-dim float32 embedding (zeros) — 1536 bytes
  const blob = Buffer.alloc(384 * 4);
  const stmt = db.prepare<unknown[], { id: number }>(`
    INSERT INTO episodes (
      thread_key, sender_peer, channel_name, channel_id, thread_ts,
      user_text, apex_summary, num_turns, total_cost_usd,
      created_at, embedding, outdated,
      slack_message_ts, slack_channel_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    RETURNING id
  `);
  const row = stmt.get(
    opts.threadKey,
    opts.peer,
    opts.channelName ?? null,
    opts.channelId ?? null,
    opts.threadTs ?? null,
    opts.userText ?? 'user message',
    opts.apexSummary ?? 'apex reply',
    opts.numTurns ?? 1,
    opts.costUsd ?? 0.001,
    opts.createdAt ?? Date.now(),
    blob,
    opts.outdated ?? 0,
    opts.slackMessageTs ?? null,
    opts.slackChannelId ?? null,
  );
  db.close();
  return row?.id ?? -1;
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `thoth-episodic-test-${randomUUID()}.db`);
  store = new EpisodicStore(dbPath);
});

afterEach(() => {
  store.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      // ignore
    }
  }
});

describe('EpisodicStore', () => {
  describe('count', () => {
    it('returns 0 for empty store', () => {
      expect(store.count()).toBe(0);
    });

    it('reflects inserted rows', () => {
      insertFakeEpisode({ threadKey: 'C:T1', peer: 'U_A' });
      insertFakeEpisode({ threadKey: 'C:T2', peer: 'U_A' });
      insertFakeEpisode({ threadKey: 'C:T3', peer: 'U_B' });
      expect(store.count()).toBe(3);
    });
  });

  describe('listByThread', () => {
    it('returns episodes for a specific thread', () => {
      insertFakeEpisode({ threadKey: 'C:T1', peer: 'U_A' });
      insertFakeEpisode({ threadKey: 'C:T1', peer: 'U_A' });
      insertFakeEpisode({ threadKey: 'C:T2', peer: 'U_B' });
      const t1 = store.listByThread('C:T1');
      expect(t1).toHaveLength(2);
    });

    it('returns empty array for unknown thread', () => {
      expect(store.listByThread('C:nothing-here')).toEqual([]);
    });
  });

  describe('listRecent', () => {
    it('returns most recent first', () => {
      const now = Date.now();
      insertFakeEpisode({
        threadKey: 'C:T1',
        peer: 'U_A',
        userText: 'oldest',
        createdAt: now - 1_000_000,
      });
      insertFakeEpisode({
        threadKey: 'C:T1',
        peer: 'U_A',
        userText: 'middle',
        createdAt: now - 500_000,
      });
      insertFakeEpisode({
        threadKey: 'C:T1',
        peer: 'U_A',
        userText: 'newest',
        createdAt: now,
      });
      const recent = store.listRecent(10);
      expect(recent[0]?.user_text).toBe('newest');
      expect(recent[1]?.user_text).toBe('middle');
      expect(recent[2]?.user_text).toBe('oldest');
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        insertFakeEpisode({ threadKey: `C:T${i}`, peer: 'U_A' });
      }
      expect(store.listRecent(3)).toHaveLength(3);
    });

    it('omits the embedding field from listRecent results', () => {
      insertFakeEpisode({ threadKey: 'C:T1', peer: 'U_A' });
      const recent = store.listRecent(10);
      // The Omit<Episode, 'embedding'> type means no embedding field
      expect((recent[0] as unknown as Record<string, unknown>).embedding).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('returns the episode with matching id', () => {
      const id = insertFakeEpisode({
        threadKey: 'C:T1',
        peer: 'U_A',
        userText: 'specific message',
      });
      const ep = store.findById(id);
      expect(ep).not.toBeNull();
      expect(ep?.user_text).toBe('specific message');
    });

    it('returns null for unknown id', () => {
      expect(store.findById(999999)).toBeNull();
    });
  });

  describe('findBySlackMessage', () => {
    it('returns episode by (channel_id, message_ts)', () => {
      insertFakeEpisode({
        threadKey: 'C:T1',
        peer: 'U_A',
        slackChannelId: 'C_TEST',
        slackMessageTs: '1700000123.456',
      });
      const found = store.findBySlackMessage('C_TEST', '1700000123.456');
      expect(found).not.toBeNull();
    });

    it('returns null when no match', () => {
      expect(store.findBySlackMessage('C_NONE', '1.2')).toBeNull();
    });
  });

  describe('markOutdated', () => {
    it('flips the outdated bit on the episode', () => {
      const id = insertFakeEpisode({ threadKey: 'C:T1', peer: 'U_A' });
      store.markOutdated(id);
      const ep = store.findById(id);
      expect(ep?.outdated).toBe(1);
    });

    it('handles unknown id gracefully (no-op)', () => {
      expect(() => store.markOutdated(999999)).not.toThrow();
    });
  });

  describe('setVerified', () => {
    it('records a successful verification', () => {
      const id = insertFakeEpisode({ threadKey: 'C:T1', peer: 'U_A' });
      store.setVerified(id, 'success', 'U_VERIFIER');
      const ep = store.findById(id);
      expect(ep?.verified_status).toBe('success');
      expect(ep?.verified_by).toBe('U_VERIFIER');
      expect(ep?.verified_at).toBeGreaterThan(0);
    });

    it('records a failure verification', () => {
      const id = insertFakeEpisode({ threadKey: 'C:T1', peer: 'U_A' });
      store.setVerified(id, 'failure', 'U_VERIFIER');
      const ep = store.findById(id);
      expect(ep?.verified_status).toBe('failure');
    });

    it('overwrites previous verification (last reaction wins)', () => {
      const id = insertFakeEpisode({ threadKey: 'C:T1', peer: 'U_A' });
      store.setVerified(id, 'success', 'U_A');
      store.setVerified(id, 'failure', 'U_B');
      const ep = store.findById(id);
      expect(ep?.verified_status).toBe('failure');
      expect(ep?.verified_by).toBe('U_B');
    });
  });

  describe('schema migrations', () => {
    it('reopening on the same path retains episodes', () => {
      insertFakeEpisode({ threadKey: 'C:T1', peer: 'U_A' });
      store.close();
      store = new EpisodicStore(dbPath);
      expect(store.count()).toBe(1);
    });
  });
});
