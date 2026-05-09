import Database from 'better-sqlite3';
import { logger } from '../logger';
import type { AgentRole } from './agents';

export type PartyOutcome = 'running' | 'success' | 'aborted' | 'over_budget' | 'failed';

export interface PartyRunRow {
  id: string;
  thread_key: string;
  initiator_peer: string;
  topic: string;
  template: string;
  mode: string;
  roster_json: string;
  rounds: number;
  started_at: number;
  ended_at: number | null;
  outcome: PartyOutcome;
  total_cost_usd: number;
  output_path: string | null;
  /** Set if this party was spawned as a sub-party from another. */
  parent_party_id: string | null;
  /** 0 for top-level, 1 for sub, capped at MAX_PARTY_DEPTH. */
  depth: number;
}

export interface PartyTemplateRow {
  name: string;
  description: string | null;
  /** Either an object or a JSON string — store handles both. */
  config_json: string | Record<string, unknown>;
  created_by: string;
  created_at: number;
  invocations: number;
}

export interface PartyMessageRow {
  id: number;
  party_id: string;
  round_number: number;
  agent_role: string;
  content: string;
  confidence: number | null;
  cost_usd: number;
  duration_ms: number;
  created_at: number;
  slack_message_ts: string | null;
}

class PartyStore {
  private db: Database.Database | null = null;

  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS party_runs (
        id              TEXT PRIMARY KEY,
        thread_key      TEXT NOT NULL,
        initiator_peer  TEXT NOT NULL,
        topic           TEXT NOT NULL,
        template        TEXT NOT NULL DEFAULT 'freeform',
        mode            TEXT NOT NULL DEFAULT 'sequential',
        roster_json     TEXT NOT NULL,
        rounds          INTEGER NOT NULL DEFAULT 2,
        started_at      INTEGER NOT NULL,
        ended_at        INTEGER,
        outcome         TEXT NOT NULL DEFAULT 'running',
        total_cost_usd  REAL NOT NULL DEFAULT 0,
        output_path     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_party_runs_thread ON party_runs(thread_key);
      CREATE INDEX IF NOT EXISTS idx_party_runs_time   ON party_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_party_runs_status ON party_runs(outcome);

      CREATE TABLE IF NOT EXISTS party_messages (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        party_id          TEXT NOT NULL,
        round_number      INTEGER NOT NULL,
        agent_role        TEXT NOT NULL,
        content           TEXT NOT NULL,
        confidence        REAL,
        cost_usd          REAL NOT NULL DEFAULT 0,
        duration_ms       INTEGER NOT NULL DEFAULT 0,
        created_at        INTEGER NOT NULL,
        slack_message_ts  TEXT,
        FOREIGN KEY (party_id) REFERENCES party_runs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_party_messages_party ON party_messages(party_id);
      CREATE INDEX IF NOT EXISTS idx_party_messages_role  ON party_messages(party_id, agent_role);
    `);
    // Phase D: parent/depth columns for nested sub-parties. Idempotent
    // ALTER — try/catch because SQLite has no IF NOT EXISTS for columns.
    try { this.db.exec(`ALTER TABLE party_runs ADD COLUMN parent_party_id TEXT`); } catch { /* exists */ }
    try { this.db.exec(`ALTER TABLE party_runs ADD COLUMN depth INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
    try { this.db.exec(`CREATE INDEX IF NOT EXISTS idx_party_runs_parent ON party_runs(parent_party_id)`); } catch { /* exists */ }

    // Phase B: party_templates table for /party-save reusable invocations.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS party_templates (
        name        TEXT PRIMARY KEY,
        description TEXT,
        config_json TEXT NOT NULL,
        created_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        invocations INTEGER NOT NULL DEFAULT 0
      );
    `);
    logger.info({ dbPath }, 'party store ready');
  }

  // ── party templates (Step 4 / Phase B) ────────────────────────────

  saveTemplate(t: PartyTemplateRow): void {
    this._db
      .prepare(
        `INSERT OR REPLACE INTO party_templates
            (name, description, config_json, created_by, created_at,
             invocations)
         VALUES (@name, @description, @config_json, @created_by,
                 @created_at, @invocations)`,
      )
      .run({
        ...t,
        config_json:
          typeof t.config_json === 'string'
            ? t.config_json
            : JSON.stringify(t.config_json),
      });
  }

  getTemplate(name: string): PartyTemplateRow | null {
    return (
      this._db
        .prepare<[string], PartyTemplateRow>(
          `SELECT * FROM party_templates WHERE name = ?`,
        )
        .get(name) ?? null
    );
  }

  listTemplates(): PartyTemplateRow[] {
    return this._db
      .prepare<[], PartyTemplateRow>(
        `SELECT * FROM party_templates ORDER BY created_at DESC`,
      )
      .all();
  }

  bumpTemplateInvocations(name: string): void {
    this._db
      .prepare(
        `UPDATE party_templates SET invocations = invocations + 1 WHERE name = ?`,
      )
      .run(name);
  }

  private get _db(): Database.Database {
    if (!this.db) throw new Error('partyStore not initialized');
    return this.db;
  }

  createRun(row: Omit<PartyRunRow, 'ended_at' | 'outcome' | 'total_cost_usd' | 'output_path'>): void {
    this._db
      .prepare(
        `INSERT INTO party_runs (id, thread_key, initiator_peer, topic,
                                 template, mode, roster_json, rounds,
                                 started_at, parent_party_id, depth)
         VALUES (@id, @thread_key, @initiator_peer, @topic,
                 @template, @mode, @roster_json, @rounds, @started_at,
                 @parent_party_id, @depth)`,
      )
      .run(row);
  }

  /** Sub-parties of a given parent, oldest first. */
  listChildren(parentId: string): PartyRunRow[] {
    return this._db
      .prepare<[string], PartyRunRow>(
        `SELECT * FROM party_runs WHERE parent_party_id = ? ORDER BY started_at ASC`,
      )
      .all(parentId);
  }

  addMessage(row: Omit<PartyMessageRow, 'id'>): number {
    const stmt = this._db.prepare<unknown[], { id: number }>(
      `INSERT INTO party_messages (party_id, round_number, agent_role,
                                    content, confidence, cost_usd,
                                    duration_ms, created_at,
                                    slack_message_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    );
    const r = stmt.get(
      row.party_id,
      row.round_number,
      row.agent_role,
      row.content,
      row.confidence,
      row.cost_usd,
      row.duration_ms,
      row.created_at,
      row.slack_message_ts,
    );
    return r?.id ?? -1;
  }

  setSlackTs(messageId: number, ts: string): void {
    this._db
      .prepare(`UPDATE party_messages SET slack_message_ts = ? WHERE id = ?`)
      .run(ts, messageId);
  }

  endRun(
    id: string,
    outcome: PartyOutcome,
    totalCostUsd: number,
    outputPath: string | null,
  ): void {
    this._db
      .prepare(
        `UPDATE party_runs
            SET ended_at = ?, outcome = ?, total_cost_usd = ?, output_path = ?
          WHERE id = ?`,
      )
      .run(Date.now(), outcome, totalCostUsd, outputPath, id);
  }

  getRun(id: string): PartyRunRow | null {
    return (
      this._db
        .prepare<[string], PartyRunRow>(`SELECT * FROM party_runs WHERE id = ?`)
        .get(id) ?? null
    );
  }

  listMessages(partyId: string): PartyMessageRow[] {
    return this._db
      .prepare<[string], PartyMessageRow>(
        `SELECT * FROM party_messages
            WHERE party_id = ?
            ORDER BY round_number ASC, id ASC`,
      )
      .all(partyId);
  }

  /** Most recent active party for a thread, if any. */
  activeForThread(threadKey: string): PartyRunRow | null {
    return (
      this._db
        .prepare<[string], PartyRunRow>(
          `SELECT * FROM party_runs
              WHERE thread_key = ? AND outcome = 'running'
              ORDER BY started_at DESC LIMIT 1`,
        )
        .get(threadKey) ?? null
    );
  }

  /** Most recent N parties across all threads. Used by dashboard history. */
  listRecent(limit = 30): PartyRunRow[] {
    return this._db
      .prepare<[number], PartyRunRow>(
        `SELECT * FROM party_runs ORDER BY started_at DESC LIMIT ?`,
      )
      .all(limit);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

export const partyStore = new PartyStore();

export function nanoid(len = 10): string {
  // tiny, dependency-free nanoid for party IDs.
  const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alpha[Math.floor(Math.random() * alpha.length)];
  return out;
}
