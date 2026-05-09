import Database from 'better-sqlite3';
import { eventBus, type DashboardEvent } from './event-bus';
import { logger } from '../logger';

/**
 * Lightweight long-tail event archive that powers the live-flow tab's
 * "fractal time" view. The eventBus's in-memory ring buffer holds the
 * last 500 events — fine for the live console scrollback but useless
 * for a 1d/1w aggregation. This archive persists every event with
 * just two columns (timestamp + kind) so we can answer "how many of
 * each event happened in the last N hours" cheaply.
 *
 * No payload is stored — the flow heatmap only needs the kind to
 * resolve which edges should light up. If a future tab needs full
 * event replay across days, we can extend this table or add a
 * sibling.
 *
 * Pruning policy: drop entries older than 14 days on each prune tick
 * (run hourly). 14 days is more than enough for a 1w window with a
 * little slack for clock drift.
 */

const PRUNE_OLDER_THAN_MS = 14 * 24 * 60 * 60 * 1000; // 14d
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;             // 1h

export interface ArchivedEvent {
  ts: number;
  kind: string;
}

export class EventArchive {
  private db: Database.Database | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private listener: ((ev: DashboardEvent) => void) | null = null;
  private insertStmt: Database.Statement | null = null;

  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dashboard_events (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        ts   INTEGER NOT NULL,
        kind TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dashboard_events_ts ON dashboard_events(ts);
    `);
    this.insertStmt = this.db.prepare(
      `INSERT INTO dashboard_events (ts, kind) VALUES (?, ?)`,
    );
    logger.info({ dbPath }, 'event archive ready');
  }

  /** Subscribe to the bus and start the prune timer. */
  start(): void {
    if (!this.db || !this.insertStmt) return;
    this.listener = (ev: DashboardEvent): void => {
      try {
        this.insertStmt!.run(ev.ts, ev.kind);
      } catch (err) {
        logger.warn({ err: String(err) }, 'event archive: insert failed');
      }
    };
    eventBus.on('event', this.listener);
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    // Run one prune at startup so a long-paused bridge doesn't carry
    // stale rows through to the next session.
    this.prune();
  }

  stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    if (this.listener) {
      eventBus.off('event', this.listener);
      this.listener = null;
    }
  }

  close(): void {
    this.stop();
    this.db?.close();
    this.db = null;
  }

  /**
   * Return all archived events with ts >= sinceMs, oldest first.
   * Caller (frontend) buckets by edge using its own kind→edges map.
   */
  since(sinceMs: number): ArchivedEvent[] {
    if (!this.db) return [];
    return this.db
      .prepare<[number], ArchivedEvent>(
        `SELECT ts, kind FROM dashboard_events
            WHERE ts >= ?
            ORDER BY ts ASC`,
      )
      .all(sinceMs);
  }

  /**
   * Daily activity counts for the last `days` days, oldest first. Used by
   * the heatmap calendar — one row per UTC day, kind buckets so the grid
   * can color cells by the dominant activity type.
   */
  dailyActivity(days = 365): Array<{ day: string; total: number; byKind: Record<string, number> }> {
    if (!this.db) return [];
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = this.db
      .prepare<[number], { day: string; kind: string; n: number }>(
        `SELECT
           strftime('%Y-%m-%d', ts/1000, 'unixepoch') AS day,
           kind,
           COUNT(*) AS n
         FROM dashboard_events
         WHERE ts >= ?
         GROUP BY day, kind
         ORDER BY day ASC`,
      )
      .all(since);
    const map = new Map<string, { total: number; byKind: Record<string, number> }>();
    for (const r of rows) {
      const cur = map.get(r.day) ?? { total: 0, byKind: {} };
      cur.total += r.n;
      cur.byKind[r.kind] = (cur.byKind[r.kind] ?? 0) + r.n;
      map.set(r.day, cur);
    }
    return Array.from(map, ([day, v]) => ({ day, total: v.total, byKind: v.byKind }));
  }

  /** Total count of archived rows (cheap — used by status snapshot). */
  count(): number {
    if (!this.db) return 0;
    const r = this.db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM dashboard_events`)
      .get();
    return r?.n ?? 0;
  }

  private prune(): void {
    if (!this.db) return;
    const cutoff = Date.now() - PRUNE_OLDER_THAN_MS;
    try {
      const r = this.db
        .prepare(`DELETE FROM dashboard_events WHERE ts < ?`)
        .run(cutoff);
      if (r.changes > 0) {
        logger.debug({ removed: r.changes }, 'event archive: pruned old rows');
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'event archive: prune failed');
    }
  }
}

export const eventArchive = new EventArchive();
