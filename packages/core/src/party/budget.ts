import Database from 'better-sqlite3';
import { logger } from '../logger';

/**
 * Per-day cost cap for parties. Mirrors the reflection daily-cap pattern
 * but with its own bucket so reflection and party costs don't conflate.
 *
 * Per-party caps are enforced in the orchestrator (each party tracks its
 * own running cost and halts at maxBudgetUsd). This module only handles
 * the daily total.
 */

interface PartyDailyRow {
  date: string;
  party_cost_usd: number;
  party_count: number;
}

class PartyDailyCap {
  private db: Database.Database | null = null;

  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS party_daily (
        date            TEXT PRIMARY KEY,
        party_cost_usd  REAL NOT NULL DEFAULT 0,
        party_count     INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  private get _db(): Database.Database {
    if (!this.db) throw new Error('partyDailyCap not initialized');
    return this.db;
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  underCap(maxUsd: number): boolean {
    const r = this._db
      .prepare<[string], PartyDailyRow>(
        `SELECT * FROM party_daily WHERE date = ?`,
      )
      .get(this.todayKey());
    return (r?.party_cost_usd ?? 0) < maxUsd;
  }

  record(costUsd: number): { todayUsd: number; todayCount: number } {
    const today = this.todayKey();
    this._db
      .prepare(
        `INSERT INTO party_daily (date, party_cost_usd, party_count)
           VALUES (?, ?, 1)
         ON CONFLICT(date) DO UPDATE SET
           party_cost_usd = party_cost_usd + excluded.party_cost_usd,
           party_count    = party_count + 1`,
      )
      .run(today, costUsd);
    const r = this._db
      .prepare<[string], PartyDailyRow>(
        `SELECT * FROM party_daily WHERE date = ?`,
      )
      .get(today);
    return {
      todayUsd: r?.party_cost_usd ?? 0,
      todayCount: r?.party_count ?? 0,
    };
  }

  todaySnapshot(): { todayUsd: number; todayCount: number } {
    const r = this._db
      .prepare<[string], PartyDailyRow>(
        `SELECT * FROM party_daily WHERE date = ?`,
      )
      .get(this.todayKey());
    return {
      todayUsd: r?.party_cost_usd ?? 0,
      todayCount: r?.party_count ?? 0,
    };
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

export const partyDailyCap = new PartyDailyCap();
