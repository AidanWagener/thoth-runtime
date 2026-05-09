import Database from 'better-sqlite3';
import { logger } from '../logger';

/**
 * Tiny per-day cost counter for the reflection loop. Persists across
 * restarts (in SQLite) and resets implicitly when the date rolls over.
 *
 * Default cap is $5/day. Reflection orchestrator checks this before
 * spawning a new claude turn; if the cap is reached, the session-end
 * trigger silently no-ops and logs.
 */

interface DailyCostRow {
  date: string; // YYYY-MM-DD (UTC)
  reflection_cost_usd: number;
  reflection_count: number;
}

class DailyCostCap {
  private db: Database.Database | null = null;

  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_costs (
        date                TEXT PRIMARY KEY,
        reflection_cost_usd REAL NOT NULL DEFAULT 0,
        reflection_count    INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  private get _db(): Database.Database {
    if (!this.db) throw new Error('dailyCostCap not initialized');
    return this.db;
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Returns true if today's reflection spend is under the cap. */
  underCap(maxUsd: number): boolean {
    const today = this.todayKey();
    const r = this._db
      .prepare<[string], DailyCostRow>(
        `SELECT * FROM daily_costs WHERE date = ?`,
      )
      .get(today);
    return (r?.reflection_cost_usd ?? 0) < maxUsd;
  }

  /** Add cost to today's bucket. Creates the row if missing. */
  record(costUsd: number): { todayUsd: number; todayCount: number } {
    const today = this.todayKey();
    this._db
      .prepare(
        `INSERT INTO daily_costs (date, reflection_cost_usd, reflection_count)
         VALUES (?, ?, 1)
         ON CONFLICT(date) DO UPDATE SET
           reflection_cost_usd = reflection_cost_usd + excluded.reflection_cost_usd,
           reflection_count    = reflection_count + 1`,
      )
      .run(today, costUsd);
    const r = this._db
      .prepare<[string], DailyCostRow>(
        `SELECT * FROM daily_costs WHERE date = ?`,
      )
      .get(today);
    return {
      todayUsd: r?.reflection_cost_usd ?? 0,
      todayCount: r?.reflection_count ?? 0,
    };
  }

  todaySnapshot(): { todayUsd: number; todayCount: number } {
    const today = this.todayKey();
    const r = this._db
      .prepare<[string], DailyCostRow>(
        `SELECT * FROM daily_costs WHERE date = ?`,
      )
      .get(today);
    return {
      todayUsd: r?.reflection_cost_usd ?? 0,
      todayCount: r?.reflection_count ?? 0,
    };
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

export const dailyCostCap = new DailyCostCap();

/** Convenience for log lines. */
export function logCapSnapshot(maxUsd: number): void {
  const snap = dailyCostCap.todaySnapshot();
  logger.info(
    {
      todayUsd: snap.todayUsd.toFixed(4),
      todayCount: snap.todayCount,
      capUsd: maxUsd.toFixed(2),
    },
    'reflection daily cap snapshot',
  );
}
