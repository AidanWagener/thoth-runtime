import Database from 'better-sqlite3';
import { logger } from '../logger';

/**
 * Daily-bounded budget for ambient agent autonomy. Pattern matches
 * `reflection/daily-cap.ts` and `party/budget.ts` — one row per UTC
 * day, atomic updates.
 *
 * Default: $1.00/day. Triggers consult underCap() before spending and
 * record() after. Public for the dashboard to render a burndown bar.
 */

class AmbientBudget {
  private db: Database.Database | null = null;

  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ambient_daily_cost (
        utc_day        TEXT PRIMARY KEY,
        runs           INTEGER NOT NULL DEFAULT 0,
        total_cost_usd REAL NOT NULL DEFAULT 0,
        last_updated   INTEGER NOT NULL
      );
    `);
    logger.info({ dbPath }, 'ambient budget store ready');
  }

  private todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }

  underCap(capUsd: number): boolean {
    if (!this.db) return false;
    const r = this.db
      .prepare<[string], { total_cost_usd: number }>(
        `SELECT total_cost_usd FROM ambient_daily_cost WHERE utc_day = ?`,
      )
      .get(this.todayUtc());
    const used = r?.total_cost_usd ?? 0;
    return used < capUsd;
  }

  record(costUsd: number): void {
    if (!this.db) return;
    const day = this.todayUtc();
    this.db
      .prepare(
        `INSERT INTO ambient_daily_cost (utc_day, runs, total_cost_usd, last_updated)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(utc_day) DO UPDATE SET
           runs = runs + 1,
           total_cost_usd = total_cost_usd + excluded.total_cost_usd,
           last_updated = excluded.last_updated`,
      )
      .run(day, costUsd, Date.now());
  }

  todaySnapshot(): { todayUsd: number; todayCount: number } {
    if (!this.db) return { todayUsd: 0, todayCount: 0 };
    const r = this.db
      .prepare<[string], { runs: number; total_cost_usd: number }>(
        `SELECT runs, total_cost_usd FROM ambient_daily_cost WHERE utc_day = ?`,
      )
      .get(this.todayUtc());
    return {
      todayUsd: r?.total_cost_usd ?? 0,
      todayCount: r?.runs ?? 0,
    };
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

export const ambientBudget = new AmbientBudget();
