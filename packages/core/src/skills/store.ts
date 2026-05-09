import Database from 'better-sqlite3';
import { logger } from '../logger';

export type SkillDraftStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface SkillDraftRow {
  id: number;
  slug: string;
  file_path: string;
  description: string | null;
  source_thread_key: string;
  source_channel_id: string;
  proposed_by: string;
  slack_channel: string | null;
  slack_message_ts: string | null;
  status: SkillDraftStatus;
  created_at: number;
  decided_at: number | null;
  decided_by: string | null;
}

class SkillDraftStore {
  private db: Database.Database | null = null;

  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_drafts (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        slug               TEXT NOT NULL,
        file_path          TEXT NOT NULL,
        description        TEXT,
        source_thread_key  TEXT NOT NULL,
        source_channel_id  TEXT NOT NULL,
        proposed_by        TEXT NOT NULL,
        slack_channel      TEXT,
        slack_message_ts   TEXT,
        status             TEXT NOT NULL DEFAULT 'pending',
        created_at         INTEGER NOT NULL,
        decided_at         INTEGER,
        decided_by         TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_skill_drafts_slack
        ON skill_drafts(slack_channel, slack_message_ts);
      CREATE INDEX IF NOT EXISTS idx_skill_drafts_status
        ON skill_drafts(status);
    `);
    logger.info({ dbPath }, 'skill draft store ready');
  }

  private get _db(): Database.Database {
    if (!this.db) throw new Error('skillDraftStore not initialized');
    return this.db;
  }

  insert(d: Omit<SkillDraftRow, 'id' | 'slack_channel' | 'slack_message_ts' | 'decided_at' | 'decided_by'>): number {
    const stmt = this._db.prepare<unknown[], { id: number }>(`
      INSERT INTO skill_drafts (
        slug, file_path, description, source_thread_key,
        source_channel_id, proposed_by, status, created_at
      ) VALUES (?,?,?,?,?,?,?,?)
      RETURNING id
    `);
    const r = stmt.get(
      d.slug,
      d.file_path,
      d.description,
      d.source_thread_key,
      d.source_channel_id,
      d.proposed_by,
      d.status,
      d.created_at,
    );
    return r?.id ?? -1;
  }

  attachSlackMessage(id: number, channel: string, ts: string): void {
    this._db
      .prepare(
        `UPDATE skill_drafts SET slack_channel = ?, slack_message_ts = ? WHERE id = ?`,
      )
      .run(channel, ts, id);
  }

  findBySlackMessage(channel: string, ts: string): SkillDraftRow | null {
    return (
      this._db
        .prepare<[string, string], SkillDraftRow>(
          `SELECT * FROM skill_drafts WHERE slack_channel = ? AND slack_message_ts = ?`,
        )
        .get(channel, ts) ?? null
    );
  }

  findById(id: number): SkillDraftRow | null {
    return (
      this._db
        .prepare<[number], SkillDraftRow>(
          `SELECT * FROM skill_drafts WHERE id = ?`,
        )
        .get(id) ?? null
    );
  }

  setStatus(
    id: number,
    status: SkillDraftStatus,
    decidedBy: string | null,
  ): void {
    this._db
      .prepare(
        `UPDATE skill_drafts
            SET status = ?, decided_at = ?, decided_by = ?
          WHERE id = ?`,
      )
      .run(status, Date.now(), decidedBy, id);
  }

  /** All drafts in any status, newest first — used by harvester for dedup. */
  listAll(limit = 200): SkillDraftRow[] {
    return this._db
      .prepare<[number], SkillDraftRow>(
        `SELECT * FROM skill_drafts ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit);
  }

  /** Pending-only convenience used by the harvester. */
  listPending(): SkillDraftRow[] {
    return this._db
      .prepare<[], SkillDraftRow>(
        `SELECT * FROM skill_drafts WHERE status IN ('pending', 'accepted') ORDER BY created_at DESC`,
      )
      .all();
  }

  listPendingOlderThan(thresholdMs: number): SkillDraftRow[] {
    const cutoff = Date.now() - thresholdMs;
    return this._db
      .prepare<[number], SkillDraftRow>(
        `SELECT * FROM skill_drafts WHERE status = 'pending' AND created_at < ?`,
      )
      .all(cutoff);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

/** Module-level singleton; initialized once at boot. */
export const skillDraftStore = new SkillDraftStore();
