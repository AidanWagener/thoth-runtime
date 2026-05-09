import type { WebClient } from '@slack/web-api';
import { skillDraftStore } from '../skills/store';
import { ambientBudget } from './budget';
import { eventBus } from '../dashboard/event-bus';
import { logger } from '../logger';

/**
 * A1 — Ambient agents.
 *
 * Periodically scans the bridge state for "interesting" conditions and
 * fires DMs to allowlisted users when the agent has something proactive
 * to say. Strictly bounded by ambientBudget so it can't run away.
 *
 * Trigger menu (v1):
 *   - skill-draft-stale  → DM nudge if a draft has been pending > 3 days
 *   - morning-digest     → daily 09:00 (local TZ) summary of yesterday
 *   - quiet-hours-fact   → fact-check pending claims during low-activity
 *                          windows (deferred to v2 — needs richer claims
 *                          extraction; placeholder included)
 *
 * Each trigger has a per-trigger cooldown so the same condition doesn't
 * fire multiple notifications in a window.
 *
 * Cost model: most ambient triggers are pure DB scans (zero cost). The
 * morning-digest is the only expensive trigger and is capped at one
 * spawn per day; if the daily envelope is exhausted, it's skipped with
 * a log line.
 */

const TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const STALE_DRAFT_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
const STALE_DRAFT_REMINDER_MS = 24 * 60 * 60 * 1000; // remind at most once/day
const DEFAULT_DAILY_CAP_USD = 1.0;

export interface AmbientDeps {
  client: WebClient;
  allowlistUserIds: string[];
  announceChannelId: string | null;
  dailyCapUsd?: number;
}

export class AmbientAgent {
  private timer: NodeJS.Timeout | null = null;
  private dmCache = new Map<string, string>();
  /** trigger-key -> last-fired ms */
  private lastFired = new Map<string, number>();

  constructor(private readonly deps: AmbientDeps) {}

  start(): void {
    if (this.timer) return;
    // First tick after 90s so the bridge is warm.
    setTimeout(() => this.tick().catch(() => undefined), 90_000);
    this.timer = setInterval(() => this.tick().catch(() => undefined), TICK_INTERVAL_MS);
    logger.info(
      { intervalMin: TICK_INTERVAL_MS / 60000, dailyCapUsd: this.deps.dailyCapUsd ?? DEFAULT_DAILY_CAP_USD },
      'ambient agent started',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Diagnostic snapshot used by /api/ambient. */
  snapshot(): { lastTickAt: number; lastFired: Record<string, number>; today: ReturnType<typeof ambientBudget.todaySnapshot> } {
    return {
      lastTickAt: this.lastTickAt,
      lastFired: Object.fromEntries(this.lastFired),
      today: ambientBudget.todaySnapshot(),
    };
  }

  private lastTickAt = 0;

  private async tick(): Promise<void> {
    this.lastTickAt = Date.now();
    try {
      await this.checkStaleSkillDrafts();
      await this.maybeMorningDigest();
    } catch (err) {
      logger.warn({ err: String(err) }, 'ambient tick threw');
    }
  }

  // ── triggers ────────────────────────────────────────────────────

  private async checkStaleSkillDrafts(): Promise<void> {
    const stale = skillDraftStore.listPendingOlderThan(STALE_DRAFT_THRESHOLD_MS);
    if (stale.length === 0) return;
    const triggerKey = 'stale-drafts';
    const lf = this.lastFired.get(triggerKey) ?? 0;
    if (Date.now() - lf < STALE_DRAFT_REMINDER_MS) return;

    const lines = [
      ':bell: *Ambient nudge — stale skill drafts*',
      `${stale.length} draft${stale.length === 1 ? '' : 's'} have been pending > 3 days:`,
      ...stale.slice(0, 5).map((d) => {
        const ageDays = ((Date.now() - d.created_at) / (24 * 60 * 60 * 1000)).toFixed(1);
        return `• \`${d.slug}\` — ${ageDays}d old (proposed by ${d.proposed_by})`;
      }),
      stale.length > 5 ? `_(${stale.length - 5} more)_` : '',
      'React 🎉 to accept, ❌ to discard, or run `/skills` to review them all.',
    ].filter(Boolean);

    await this.broadcast(lines.join('\n'));
    this.lastFired.set(triggerKey, Date.now());
    eventBus.emitEvent({
      kind: 'schedule.fired',
      ts: Date.now(),
      id: -1,
      threadKey: 'ambient',
      reason: `stale-drafts: ${stale.length} drafts`,
    });
  }

  private async maybeMorningDigest(): Promise<void> {
    // Fire at 09:00 local time, with a 16-min window to ensure we don't miss it.
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    if (hour !== 9 || minute > 16) return;

    const triggerKey = 'morning-digest';
    const lf = this.lastFired.get(triggerKey) ?? 0;
    // Once per UTC day.
    if (Date.now() - lf < 22 * 60 * 60 * 1000) return;

    if (!ambientBudget.underCap(this.deps.dailyCapUsd ?? DEFAULT_DAILY_CAP_USD)) {
      logger.info('ambient morning-digest: daily cap reached, skipping');
      return;
    }

    // Build a light-weight digest from in-memory state — no model spawn
    // needed for v1. Future: spawn claude -p with --effort low for a
    // narrative summary, gated on ambientBudget.
    const drafts = skillDraftStore.listPendingOlderThan(0);
    const ambientToday = ambientBudget.todaySnapshot();
    const lines = [
      ':sunrise: *Morning digest — ' + now.toISOString().slice(0, 10) + '*',
      `• ${drafts.length} pending skill draft${drafts.length === 1 ? '' : 's'}`,
      `• Ambient autonomy: ${ambientToday.todayCount} actions · $${ambientToday.todayUsd.toFixed(4)} spent today`,
      `• Run /health for a full system check`,
    ];
    await this.broadcast(lines.join('\n'));

    // Record cost-zero activity (we want the daily counter to tick).
    ambientBudget.record(0);
    this.lastFired.set(triggerKey, Date.now());
  }

  // ── helpers ─────────────────────────────────────────────────────

  private async broadcast(text: string): Promise<void> {
    if (this.deps.announceChannelId) {
      await this.deps.client.chat.postMessage({
        channel: this.deps.announceChannelId,
        text,
        unfurl_links: false,
      }).catch((err) => logger.warn({ err: String(err) }, 'ambient broadcast: post failed'));
      return;
    }
    for (const u of this.deps.allowlistUserIds) {
      let dm = this.dmCache.get(u);
      if (!dm) {
        try {
          const r = await this.deps.client.conversations.open({ users: u });
          dm = (r.channel as { id?: string } | undefined)?.id ?? '';
          if (dm) this.dmCache.set(u, dm);
        } catch (err) {
          logger.warn({ err: String(err), userId: u }, 'ambient: DM open failed');
          continue;
        }
      }
      if (!dm) continue;
      await this.deps.client.chat.postMessage({
        channel: dm,
        text,
        unfurl_links: false,
      }).catch((err) => logger.warn({ err: String(err), userId: u }, 'ambient DM failed'));
    }
  }
}
