import Database from 'better-sqlite3';
import { logger } from '../logger';

export type ScheduledRunStatus = 'pending' | 'fired' | 'cancelled' | 'failed';

export interface ScheduledRunRow {
  id: number;
  thread_key: string;
  channel_id: string;
  thread_ts: string;
  peer_id: string;
  prompt_text: string;
  reason: string | null;
  run_at: number;
  status: ScheduledRunStatus;
  created_at: number;
  fired_at: number | null;
  source: string | null; // 'reflection' | 'manual' | 'reaction' | ...
}

class ScheduledRunStore {
  private db: Database.Database | null = null;

  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_runs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_key    TEXT NOT NULL,
        channel_id    TEXT NOT NULL,
        thread_ts     TEXT NOT NULL,
        peer_id       TEXT NOT NULL,
        prompt_text   TEXT NOT NULL,
        reason        TEXT,
        run_at        INTEGER NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        created_at    INTEGER NOT NULL,
        fired_at      INTEGER,
        source        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_runs_due
        ON scheduled_runs (status, run_at);
      CREATE INDEX IF NOT EXISTS idx_scheduled_runs_thread
        ON scheduled_runs (thread_key, status);
    `);
    logger.info({ dbPath }, 'scheduled-runs store ready');
  }

  private get _db(): Database.Database {
    if (!this.db) throw new Error('scheduledRunStore not initialized');
    return this.db;
  }

  insert(
    row: Omit<ScheduledRunRow, 'id' | 'status' | 'created_at' | 'fired_at'>,
  ): number {
    const stmt = this._db.prepare<unknown[], { id: number }>(`
      INSERT INTO scheduled_runs (
        thread_key, channel_id, thread_ts, peer_id, prompt_text,
        reason, run_at, status, created_at, source
      ) VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)
      RETURNING id
    `);
    const r = stmt.get(
      row.thread_key,
      row.channel_id,
      row.thread_ts,
      row.peer_id,
      row.prompt_text,
      row.reason ?? null,
      row.run_at,
      Date.now(),
      row.source ?? null,
    );
    return r?.id ?? -1;
  }

  /** All pending runs (future + due), soonest-first. Used by Firmament comets. */
  listPending(): ScheduledRunRow[] {
    return this._db
      .prepare<[], ScheduledRunRow>(
        `SELECT * FROM scheduled_runs WHERE status = 'pending' ORDER BY run_at ASC LIMIT 50`,
      )
      .all();
  }

  /** Pending runs whose run_at is in the past, oldest first. */
  due(now = Date.now()): ScheduledRunRow[] {
    return this._db
      .prepare<[number], ScheduledRunRow>(
        `SELECT * FROM scheduled_runs
           WHERE status = 'pending' AND run_at <= ?
           ORDER BY run_at ASC LIMIT 50`,
      )
      .all(now);
  }

  countPendingForThread(threadKey: string): number {
    const r = this._db
      .prepare<[string], { n: number }>(
        `SELECT COUNT(*) AS n FROM scheduled_runs
           WHERE thread_key = ? AND status = 'pending'`,
      )
      .get(threadKey);
    return r?.n ?? 0;
  }

  /** Total spawns ever fired for this thread (cap enforcement). */
  countFiredForThread(threadKey: string): number {
    const r = this._db
      .prepare<[string], { n: number }>(
        `SELECT COUNT(*) AS n FROM scheduled_runs
           WHERE thread_key = ? AND status = 'fired'`,
      )
      .get(threadKey);
    return r?.n ?? 0;
  }

  /** Most recent fired_at for this thread, for cooldown enforcement. */
  lastFiredAt(threadKey: string): number | null {
    const r = this._db
      .prepare<[string], { fired_at: number | null }>(
        `SELECT MAX(fired_at) AS fired_at FROM scheduled_runs
           WHERE thread_key = ? AND status = 'fired'`,
      )
      .get(threadKey);
    return r?.fired_at ?? null;
  }

  setStatus(id: number, status: ScheduledRunStatus): void {
    if (status === 'fired') {
      this._db
        .prepare(
          `UPDATE scheduled_runs SET status = ?, fired_at = ? WHERE id = ?`,
        )
        .run(status, Date.now(), id);
    } else {
      this._db
        .prepare(`UPDATE scheduled_runs SET status = ? WHERE id = ?`)
        .run(status, id);
    }
  }

  cancelPendingForThread(threadKey: string): number {
    const r = this._db
      .prepare(
        `UPDATE scheduled_runs SET status = 'cancelled'
           WHERE thread_key = ? AND status = 'pending'`,
      )
      .run(threadKey);
    return r.changes;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

export const scheduledRunStore = new ScheduledRunStore();
