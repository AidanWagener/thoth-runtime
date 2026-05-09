import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger';

export interface Session {
  thread_key: string;
  claude_session_id: string;
  cwd: string;
  created_at: number;
  last_used: number;
  total_cost_usd: number;
  num_turns: number;
  persona_fingerprint: string;
  /** Set when the reflection orchestrator processed this session. */
  reflection_run_at: number | null;
  /** Cost the reflection turn itself incurred. */
  reflection_cost_usd: number | null;
  /** First-message peer for the thread. Used as the reflection sender. */
  first_peer_id: string | null;
  /** Channel ID & display name captured at first turn. */
  channel_id: string | null;
  channel_name: string | null;
  thread_ts: string | null;
}

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
    logger.info({ dbPath }, 'session store ready');
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        thread_key          TEXT PRIMARY KEY,
        claude_session_id   TEXT NOT NULL,
        cwd                 TEXT NOT NULL,
        created_at          INTEGER NOT NULL,
        last_used           INTEGER NOT NULL,
        total_cost_usd      REAL NOT NULL DEFAULT 0,
        num_turns           INTEGER NOT NULL DEFAULT 0,
        persona_fingerprint TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_last_used
        ON sessions (last_used);
    `);
    // Phase 3 additions — additive ALTER for backwards compat.
    this.addColumnIfMissing('sessions', 'reflection_run_at', 'INTEGER');
    this.addColumnIfMissing('sessions', 'reflection_cost_usd', 'REAL');
    this.addColumnIfMissing('sessions', 'first_peer_id', 'TEXT');
    this.addColumnIfMissing('sessions', 'channel_id', 'TEXT');
    this.addColumnIfMissing('sessions', 'channel_name', 'TEXT');
    this.addColumnIfMissing('sessions', 'thread_ts', 'TEXT');
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_reflection
        ON sessions (reflection_run_at);
    `);
  }

  private addColumnIfMissing(
    table: string,
    column: string,
    typeDecl: string,
  ): void {
    const cols = this.db
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all();
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDecl}`);
      logger.info({ table, column, typeDecl }, 'sqlite migration: column added');
    }
  }

  get(threadKey: string): Session | null {
    const row = this.db
      .prepare<[string], Session>(
        `SELECT thread_key, claude_session_id, cwd, created_at, last_used,
                total_cost_usd, num_turns, persona_fingerprint,
                reflection_run_at, reflection_cost_usd,
                first_peer_id, channel_id, channel_name, thread_ts
           FROM sessions WHERE thread_key = ?`,
      )
      .get(threadKey);
    return row ?? null;
  }

  /** Idempotent metadata writeback after first turn. */
  setMetadata(
    threadKey: string,
    meta: {
      first_peer_id?: string;
      channel_id?: string;
      channel_name?: string;
      thread_ts?: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE sessions
            SET first_peer_id = COALESCE(first_peer_id, @first_peer_id),
                channel_id    = COALESCE(channel_id,    @channel_id),
                channel_name  = COALESCE(channel_name,  @channel_name),
                thread_ts     = COALESCE(thread_ts,     @thread_ts)
          WHERE thread_key = @thread_key`,
      )
      .run({
        thread_key: threadKey,
        first_peer_id: meta.first_peer_id ?? null,
        channel_id: meta.channel_id ?? null,
        channel_name: meta.channel_name ?? null,
        thread_ts: meta.thread_ts ?? null,
      });
  }

  /** Mark a session as reflected so the orchestrator skips it next time. */
  markReflected(threadKey: string, reflectionCostUsd: number): void {
    this.db
      .prepare(
        `UPDATE sessions
            SET reflection_run_at = ?, reflection_cost_usd = ?
          WHERE thread_key = ?`,
      )
      .run(Date.now(), reflectionCostUsd, threadKey);
  }

  /**
   * Sessions with last_used older than `idleMs`, never reflected on,
   * with a captured first_peer_id (means a successful turn happened).
   */
  listIdleNeedingReflection(idleMs: number): Session[] {
    const cutoff = Date.now() - idleMs;
    return this.db
      .prepare<[number], Session>(
        `SELECT thread_key, claude_session_id, cwd, created_at, last_used,
                total_cost_usd, num_turns, persona_fingerprint,
                reflection_run_at, reflection_cost_usd,
                first_peer_id, channel_id, channel_name, thread_ts
           FROM sessions
           WHERE reflection_run_at IS NULL
             AND first_peer_id IS NOT NULL
             AND last_used < ?
           ORDER BY last_used ASC`,
      )
      .all(cutoff);
  }

  upsert(s: Session): void {
    this.db
      .prepare(
        `INSERT INTO sessions (thread_key, claude_session_id, cwd,
                               created_at, last_used, total_cost_usd,
                               num_turns, persona_fingerprint)
         VALUES (@thread_key, @claude_session_id, @cwd, @created_at,
                 @last_used, @total_cost_usd, @num_turns,
                 @persona_fingerprint)
         ON CONFLICT(thread_key) DO UPDATE SET
           claude_session_id   = excluded.claude_session_id,
           last_used           = excluded.last_used,
           total_cost_usd      = excluded.total_cost_usd,
           num_turns           = excluded.num_turns,
           persona_fingerprint = excluded.persona_fingerprint`,
      )
      .run(s);
  }

  delete(threadKey: string): void {
    this.db
      .prepare(`DELETE FROM sessions WHERE thread_key = ?`)
      .run(threadKey);
  }

  close(): void {
    this.db.close();
  }
}
