import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  embed,
  cosineSimilarity,
  embeddingToBlob,
  blobToEmbedding,
  EMBEDDING_DIM,
} from './embeddings';
import { logger } from '../logger';

/**
 * Cross-thread episodic memory.
 *
 * Every successful turn is summarized into one row of `episodes` with
 * a 384-dim embedding. New threads (no --resume available) start by
 * searching for semantically similar past episodes and prepending a
 * <related-episodes> block, so Thoth has continuity across Slack
 * threads without inflating the system prompt for every turn.
 *
 * Storage decisions:
 *   - Same SQLite file as sessions (./bridge.db). Separate connection
 *     to avoid cross-coupling with the session store's prepared
 *     statements; better-sqlite3 + WAL handles concurrent connections.
 *   - Embeddings stored as Float32Array BLOB (1536 bytes each).
 *   - sqlite-vec deliberately NOT used. At our scale (< 100K episodes)
 *     a JS-side cosine over a pre-filtered candidate set is fast and
 *     adds zero native-build complexity.
 */

export interface Episode {
  id: number;
  thread_key: string;
  sender_peer: string;
  channel_name: string | null;
  channel_id: string | null;
  thread_ts: string | null;
  user_text: string;
  apex_summary: string;
  num_turns: number;
  total_cost_usd: number;
  created_at: number;
  outdated: number;
  /** Slack ts of Thoth's reply message — used to look up by reaction_added events. */
  slack_message_ts: string | null;
  slack_channel_id: string | null;
  /** Reaction-driven verification: success | failure | null. */
  verified_status: string | null;
  verified_by: string | null;
  verified_at: number | null;
}

export interface NewEpisode {
  thread_key: string;
  sender_peer: string;
  channel_name?: string;
  channel_id?: string;
  thread_ts?: string;
  user_text: string;
  apex_summary: string;
  num_turns: number;
  total_cost_usd: number;
  slack_message_ts?: string;
  slack_channel_id?: string;
}

export interface RecallHit {
  episode: Episode;
  score: number; // cosine similarity, decayed by recency
  rawScore: number; // pre-decay similarity
}

export interface RecallOptions {
  /** Max candidates to score (post-filter). Default 200. */
  candidateLimit?: number;
  /** Minimum decayed score to include. Default 0.45. */
  minScore?: number;
  /** Top-K to return after sort. Default 3. */
  topK?: number;
  /** Restrict to a specific peer (sender). Optional. */
  peerId?: string;
  /** Recency decay time-constant in days. Default 14. */
  recencyTauDays?: number;
}

const SUMMARY_MAX_CHARS = 600;
const USER_TEXT_MAX_CHARS = 1500;
const DEFAULT_RECENCY_TAU_DAYS = 14;

export class EpisodicStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
    logger.info({ dbPath, embeddingDim: EMBEDDING_DIM }, 'episodic store ready');
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_key      TEXT NOT NULL,
        sender_peer     TEXT NOT NULL,
        channel_name    TEXT,
        channel_id      TEXT,
        thread_ts       TEXT,
        user_text       TEXT NOT NULL,
        apex_summary    TEXT NOT NULL,
        num_turns       INTEGER NOT NULL DEFAULT 0,
        total_cost_usd  REAL NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        embedding       BLOB,
        outdated        INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_thread ON episodes(thread_key);
      CREATE INDEX IF NOT EXISTS idx_episodes_peer   ON episodes(sender_peer);
      CREATE INDEX IF NOT EXISTS idx_episodes_time   ON episodes(created_at DESC);
    `);
    // Phase 4 additive ALTERs.
    this.addColumnIfMissing('slack_message_ts', 'TEXT');
    this.addColumnIfMissing('slack_channel_id', 'TEXT');
    this.addColumnIfMissing('verified_status', 'TEXT');
    this.addColumnIfMissing('verified_by', 'TEXT');
    this.addColumnIfMissing('verified_at', 'INTEGER');
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_episodes_slack_msg
        ON episodes (slack_channel_id, slack_message_ts);
    `);
  }

  private addColumnIfMissing(column: string, typeDecl: string): void {
    const cols = this.db
      .prepare<[], { name: string }>(`PRAGMA table_info(episodes)`)
      .all();
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE episodes ADD COLUMN ${column} ${typeDecl}`);
      logger.info({ column, typeDecl }, 'episodes migration: column added');
    }
  }

  /**
   * Persist an episode. The embedding is computed from a concatenation
   * of the user's message and Thoth's summary so similarity reflects
   * both sides of the exchange.
   *
   * Truncates user_text and apex_summary at storage time so we never
   * blow up on long replies.
   */
  async write(ep: NewEpisode): Promise<number> {
    const userText = ep.user_text.slice(0, USER_TEXT_MAX_CHARS);
    const apexSummary = summarize(ep.apex_summary);
    const corpus = `${userText}\n\n${apexSummary}`.trim();

    const t0 = Date.now();
    const vec = await embed(corpus);
    const blob = embeddingToBlob(vec);
    const embedMs = Date.now() - t0;

    const stmt = this.db.prepare<unknown[], { id: number }>(`
      INSERT INTO episodes (
        thread_key, sender_peer, channel_name, channel_id, thread_ts,
        user_text, apex_summary, num_turns, total_cost_usd,
        created_at, embedding,
        slack_message_ts, slack_channel_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      RETURNING id
    `);
    const row = stmt.get(
      ep.thread_key,
      ep.sender_peer,
      ep.channel_name ?? null,
      ep.channel_id ?? null,
      ep.thread_ts ?? null,
      userText,
      apexSummary,
      ep.num_turns,
      ep.total_cost_usd,
      Date.now(),
      blob,
      ep.slack_message_ts ?? null,
      ep.slack_channel_id ?? null,
    );

    logger.debug(
      {
        id: row?.id,
        threadKey: ep.thread_key,
        peer: ep.sender_peer,
        embedMs,
        corpusChars: corpus.length,
      },
      'episode written',
    );
    return row?.id ?? -1;
  }

  /**
   * Find episodes semantically similar to a free-text query. Used both
   * by the auto-recall path (new thread first turn) and by /recall.
   *
   * Algorithm:
   *   1. Pre-filter by peer (optional) + outdated=0 + LIMIT candidates
   *      ordered by recency. We don't iterate over every episode.
   *   2. Compute cosine similarity in JS over the candidate set.
   *   3. Apply exponential recency decay: score *= exp(-age_days / tau).
   *   4. Filter by minScore, sort desc, return topK.
   */
  async recall(query: string, opts: RecallOptions = {}): Promise<RecallHit[]> {
    const candidateLimit = opts.candidateLimit ?? 200;
    const minScore = opts.minScore ?? 0.45;
    const topK = opts.topK ?? 3;
    const tauDays = opts.recencyTauDays ?? DEFAULT_RECENCY_TAU_DAYS;
    const tauMs = tauDays * 24 * 3600 * 1000;
    const now = Date.now();

    let candidates: Episode[];
    if (opts.peerId) {
      candidates = this.db
        .prepare<[string, number], Episode>(
          `SELECT * FROM episodes
             WHERE outdated = 0 AND sender_peer = ?
             ORDER BY created_at DESC
             LIMIT ?`,
        )
        .all(opts.peerId, candidateLimit);
    } else {
      candidates = this.db
        .prepare<[number], Episode>(
          `SELECT * FROM episodes
             WHERE outdated = 0
             ORDER BY created_at DESC
             LIMIT ?`,
        )
        .all(candidateLimit);
    }
    if (candidates.length === 0) return [];

    const queryVec = await embed(query);

    const hits: RecallHit[] = [];
    for (const ep of candidates) {
      // SQLite gives us the BLOB as Buffer when you use better-sqlite3.
      // The type system doesn't know — cast.
      const blob = (ep as unknown as { embedding: Buffer | null }).embedding;
      if (!blob || !Buffer.isBuffer(blob)) continue;
      let stored: Float32Array;
      try {
        stored = blobToEmbedding(blob);
      } catch (err) {
        logger.warn({ err: String(err), id: ep.id }, 'episode blob decode failed');
        continue;
      }
      const raw = cosineSimilarity(queryVec, stored);
      const ageMs = Math.max(0, now - ep.created_at);
      const decay = Math.exp(-ageMs / tauMs);
      const score = raw * decay;
      if (score >= minScore) {
        hits.push({ episode: ep, score, rawScore: raw });
      }
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  /**
   * Find the K nearest episodes by cosine similarity to a *given*
   * episode's stored embedding. Used by the dashboard's neighborhood
   * view (Phase D) — no model invocation, pure DB + JS cosine.
   */
  nearestForEpisode(id: number, k = 5): { id: number; score: number }[] {
    const focal = this.db
      .prepare<[number], { embedding: Buffer | null }>(
        `SELECT embedding FROM episodes WHERE id = ? AND outdated = 0`,
      )
      .get(id);
    if (!focal || !focal.embedding) return [];
    let queryVec: Float32Array;
    try {
      queryVec = blobToEmbedding(focal.embedding);
    } catch {
      return [];
    }
    const candidates = this.db
      .prepare<[number, number], Episode>(
        `SELECT * FROM episodes
            WHERE outdated = 0 AND id <> ?
            ORDER BY created_at DESC
            LIMIT ?`,
      )
      .all(id, 200);
    const scored: { id: number; score: number }[] = [];
    for (const ep of candidates) {
      const blob = (ep as unknown as { embedding: Buffer | null }).embedding;
      if (!blob || !Buffer.isBuffer(blob)) continue;
      try {
        const v = blobToEmbedding(blob);
        const score = cosineSimilarity(queryVec, v);
        scored.push({ id: ep.id, score });
      } catch {
        /* skip */
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /** Mark a single episode outdated (excluded from recall). */
  markOutdated(id: number): void {
    this.db.prepare(`UPDATE episodes SET outdated = 1 WHERE id = ?`).run(id);
  }

  /** Total episode count, useful for smoke-testing. */
  count(): number {
    const r = this.db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM episodes').get();
    return r?.n ?? 0;
  }

  /** All episodes for a single thread, oldest first — used by reflection. */
  listByThread(threadKey: string): Episode[] {
    return this.db
      .prepare<[string], Episode>(
        `SELECT * FROM episodes
           WHERE thread_key = ?
           ORDER BY created_at ASC`,
      )
      .all(threadKey);
  }

  /**
   * Most recent N episodes across all threads, newest first. Used by
   * the dashboard's recent-activity panel. Excludes the embedding BLOB
   * (1.5 KB each) since the dashboard never needs it.
   */
  listRecent(limit = 30): Omit<Episode, 'embedding'>[] {
    return this.db
      .prepare<[number], Omit<Episode, 'embedding'>>(
        `SELECT id, thread_key, sender_peer, channel_name, channel_id,
                thread_ts, user_text, apex_summary, num_turns,
                total_cost_usd, created_at, outdated,
                slack_message_ts, slack_channel_id, verified_status,
                verified_by, verified_at
           FROM episodes
           ORDER BY created_at DESC
           LIMIT ?`,
      )
      .all(limit);
  }

  /** Direct lookup by id — used by EntityCard episode renderer. */
  findById(id: number): Episode | null {
    return (
      this.db
        .prepare<[number], Episode>(
          `SELECT * FROM episodes WHERE id = ?`,
        )
        .get(id) ?? null
    );
  }

  /** Look up an episode by the Slack message ts of Thoth's reply. */
  findBySlackMessage(channelId: string, messageTs: string): Episode | null {
    return (
      this.db
        .prepare<[string, string], Episode>(
          `SELECT * FROM episodes
             WHERE slack_channel_id = ? AND slack_message_ts = ?
             ORDER BY id DESC LIMIT 1`,
        )
        .get(channelId, messageTs) ?? null
    );
  }

  /** Phase 4: reaction-driven verified flag. */
  setVerified(
    id: number,
    status: 'success' | 'failure',
    byPeerId: string,
  ): void {
    this.db
      .prepare(
        `UPDATE episodes
            SET verified_status = ?, verified_by = ?, verified_at = ?
          WHERE id = ?`,
      )
      .run(status, byPeerId, Date.now(), id);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Compress Thoth's reply into the part most worth retaining for future
 * recall. Strategy: take the first SUMMARY_MAX_CHARS of the reply,
 * trimmed at a sentence boundary if convenient.
 */
function summarize(reply: string): string {
  const cleaned = reply.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= SUMMARY_MAX_CHARS) return cleaned;
  const cut = cleaned.slice(0, SUMMARY_MAX_CHARS);
  const lastDot = cut.lastIndexOf('. ');
  if (lastDot > SUMMARY_MAX_CHARS * 0.6) return cut.slice(0, lastDot + 1);
  return cut + '…';
}

export function formatRelatedEpisodesBlock(hits: RecallHit[]): string {
  if (hits.length === 0) return '';
  const lines: string[] = ['<related-episodes>'];
  for (const hit of hits) {
    const ep = hit.episode;
    const dateIso = new Date(ep.created_at).toISOString().slice(0, 10);
    const channel = ep.channel_name ?? ep.channel_id ?? 'unknown';
    const link =
      ep.channel_id && ep.thread_ts
        ? `https://slack.com/archives/${ep.channel_id}/p${ep.thread_ts.replace('.', '')}`
        : null;
    lines.push(
      `  <episode date="${dateIso}" channel="${channel}" peer="${ep.sender_peer}" score="${hit.score.toFixed(2)}"${link ? ` link="${link}"` : ''}>`,
    );
    lines.push(`    user: ${ep.user_text.slice(0, 400).replace(/\n/g, ' ')}`);
    lines.push(`    apex: ${ep.apex_summary.slice(0, 400).replace(/\n/g, ' ')}`);
    lines.push(`  </episode>`);
  }
  lines.push('</related-episodes>');
  return lines.join('\n');
}
