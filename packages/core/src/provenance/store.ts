import Database from 'better-sqlite3';
import { logger } from '../logger';

/**
 * Provenance store — A3 "Memory provenance graph".
 *
 * For every Thoth turn, we record the *decision trail*: which memory
 * sources seeded the context window. The dashboard renders this as a
 * clickable proof tree under any episode.
 *
 * One row per "source" — a single turn typically yields 0-10 rows
 * (slack-context: 1, user-model: 0-1, related-episodes: 0-N, persona: 1).
 *
 * `payload_json` holds source-type-specific detail (cosine score for
 * episodes, char count for persona, etc.) so the UI can render rich
 * context without a join.
 */

export type ProvenanceKind =
  | 'slack-context'
  | 'user-model'         // Honcho dialectic block
  | 'related-episode'    // cross-thread cosine recall
  | 'persona-stack'      // the system-prompt persona files
  | 'skill';             // an active skill that influenced the answer

export interface ProvenanceRow {
  id: number;
  episode_id: number | null;       // populated after episode is written
  thread_key: string;
  spawn_started_at: number;        // matches spawn_started_at marker in handler
  kind: ProvenanceKind;
  source_id: string | null;        // e.g. episode.id, peer id, skill slug, persona file path
  label: string;                   // human readable, used as anchor text
  chars: number;                   // size of the contribution to the prompt
  score: number | null;            // cosine score for related-episode etc.
  payload_json: string;            // free-form blob (preview text, mtime, etc.)
}

class ProvenanceStore {
  private db: Database.Database | null = null;

  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provenance (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id         INTEGER,
        thread_key         TEXT NOT NULL,
        spawn_started_at   INTEGER NOT NULL,
        kind               TEXT NOT NULL,
        source_id          TEXT,
        label              TEXT NOT NULL,
        chars              INTEGER NOT NULL DEFAULT 0,
        score              REAL,
        payload_json       TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_prov_episode ON provenance(episode_id);
      CREATE INDEX IF NOT EXISTS idx_prov_spawn   ON provenance(thread_key, spawn_started_at);
    `);
    logger.info({ dbPath }, 'provenance store ready');
  }

  /** Insert one provenance row at spawn-time (before the episode is written). */
  insert(row: Omit<ProvenanceRow, 'id' | 'episode_id'> & { episode_id?: number | null }): number {
    if (!this.db) return -1;
    const r = this.db
      .prepare(
        `INSERT INTO provenance
          (episode_id, thread_key, spawn_started_at, kind, source_id, label, chars, score, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.episode_id ?? null,
        row.thread_key,
        row.spawn_started_at,
        row.kind,
        row.source_id,
        row.label,
        row.chars,
        row.score,
        row.payload_json,
      );
    return Number(r.lastInsertRowid);
  }

  /**
   * Bind orphan rows (episode_id IS NULL) for a (thread_key, spawn_ts) to
   * an episode id once the episode is written. Called from handler after
   * `episodic.write()` returns.
   */
  bindToEpisode(threadKey: string, spawnStartedAt: number, episodeId: number): void {
    if (!this.db) return;
    this.db
      .prepare(
        `UPDATE provenance
            SET episode_id = ?
          WHERE thread_key = ? AND spawn_started_at = ? AND episode_id IS NULL`,
      )
      .run(episodeId, threadKey, spawnStartedAt);
  }

  /** Fetch provenance trail for a single episode, in insertion order. */
  forEpisode(episodeId: number): ProvenanceRow[] {
    if (!this.db) return [];
    return this.db
      .prepare<[number], ProvenanceRow>(
        `SELECT * FROM provenance WHERE episode_id = ? ORDER BY id ASC`,
      )
      .all(episodeId);
  }

  count(): number {
    if (!this.db) return 0;
    const r = this.db
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM provenance')
      .get();
    return r?.n ?? 0;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

export const provenanceStore = new ProvenanceStore();
