import {
  orchestrateReflection,
  type OrchestratorDeps,
} from './orchestrator';
import { expireOldSkillDrafts } from '../skills/manager';
import { logger } from '../logger';

/**
 * Background poller that fires reflection on threads idle longer than
 * the threshold. Single-flight per thread (guarded by reflection_run_at
 * idempotency in the orchestrator). Also runs cleanup of expired
 * skill-draft files once per tick.
 */

const TICK_MS = 60_000;
const SKILL_EXPIRY_TICK_EVERY = 60; // run skill expiry once an hour (60 ticks @ 60s)

export class IdleDetector {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickCount = 0;

  constructor(
    private readonly deps: OrchestratorDeps,
    private readonly idleMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    // Don't keep the event loop alive purely for this timer.
    this.timer.unref();
    logger.info(
      { idleMs: this.idleMs, tickMs: TICK_MS },
      'idle detector started',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap
    this.running = true;
    this.tickCount++;
    try {
      const candidates = this.deps.sessionStore.listIdleNeedingReflection(this.idleMs);
      if (candidates.length > 0) {
        logger.debug(
          { count: candidates.length, idleMs: this.idleMs },
          'idle detector found candidates',
        );
      }
      for (const session of candidates) {
        if (
          !session.first_peer_id ||
          !session.channel_id ||
          !session.thread_ts
        ) {
          // Missing metadata — mark reflected with 0 cost so we don't
          // re-attempt forever.
          this.deps.sessionStore.markReflected(session.thread_key, 0);
          continue;
        }
        try {
          await orchestrateReflection(this.deps, {
            threadKey: session.thread_key,
            channelId: session.channel_id,
            channelName: session.channel_name ?? session.channel_id,
            threadTs: session.thread_ts,
            senderPeerId: session.first_peer_id,
            senderDisplayName: session.first_peer_id, // resolver lookup is overkill here
            numTurns: session.num_turns,
            totalCostUsd: session.total_cost_usd,
            startedAt: session.created_at,
            endedAt: session.last_used,
          });
        } catch (err) {
          logger.error(
            { err: String(err), threadKey: session.thread_key },
            'orchestrator threw — marking reflected anyway to avoid loop',
          );
          this.deps.sessionStore.markReflected(session.thread_key, 0);
        }
      }

      // Hourly skill-draft expiry sweep.
      if (this.tickCount % SKILL_EXPIRY_TICK_EVERY === 0) {
        try {
          const r = await expireOldSkillDrafts();
          if (r.expired.length > 0) {
            logger.info(
              { expired: r.expired.length },
              'skill-draft expiry sweep',
            );
          }
        } catch (err) {
          logger.warn({ err: String(err) }, 'skill-draft expiry threw');
        }
      }
    } finally {
      this.running = false;
    }
  }
}
