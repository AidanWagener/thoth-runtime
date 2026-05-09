import type { WebClient } from '@slack/web-api';
import { scheduledRunStore, type ScheduledRunRow } from './store';
import { logger } from '../logger';
import { eventBus } from '../dashboard/event-bus';

const TICK_MS = 60_000;
const PER_THREAD_CAP = 5;
const COOLDOWN_MS = 60_000;

export type SyntheticDispatchFn = (params: {
  userId: string;
  channel: string;
  text: string;
  ts: string;
  threadTs: string;
  isDm: boolean;
}) => Promise<void>;

export interface SchedulerDeps {
  client: WebClient;
  dispatch: SyntheticDispatchFn;
}

/**
 * Polls scheduled_runs every 60s and fires due rows by:
 *   1. Posting a "🤖 self-spawn (<reason>)" notice into the thread.
 *   2. Synthetically dispatching the prompt as if the original peer
 *      had typed it — Thoth --resumes the same session and replies.
 *
 * Caps:
 *   - 5 fired self-spawns per thread total
 *   - 60s cooldown between fires for the same thread
 */
export class SchedulingPoller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref();
    logger.info({ tickMs: TICK_MS, perThreadCap: PER_THREAD_CAP }, 'scheduler started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = scheduledRunStore.due();
      for (const run of due) {
        await this.fire(run);
      }
    } catch (err) {
      logger.error({ err: String(err) }, 'scheduler tick threw');
    } finally {
      this.running = false;
    }
  }

  private async fire(run: ScheduledRunRow): Promise<void> {
    const fired = scheduledRunStore.countFiredForThread(run.thread_key);
    if (fired >= PER_THREAD_CAP) {
      logger.warn(
        { id: run.id, threadKey: run.thread_key, fired, cap: PER_THREAD_CAP },
        'scheduler: thread cap reached — cancelling pending',
      );
      scheduledRunStore.setStatus(run.id, 'cancelled');
      return;
    }
    const lastFired = scheduledRunStore.lastFiredAt(run.thread_key);
    if (lastFired && Date.now() - lastFired < COOLDOWN_MS) {
      // Push it forward into the future and let next tick try again.
      logger.debug(
        { id: run.id, threadKey: run.thread_key, lastFired },
        'scheduler: cooldown active — deferring',
      );
      return;
    }

    logger.info(
      {
        id: run.id,
        threadKey: run.thread_key,
        reason: run.reason,
        promptPreview: run.prompt_text.slice(0, 80),
      },
      'scheduler: firing self-spawn',
    );

    try {
      await this.deps.client.chat.postMessage({
        channel: run.channel_id,
        thread_ts: run.thread_ts,
        text: `:robot_face: *self-spawn* — ${run.reason ?? 'follow-up'}`,
      });
    } catch (err) {
      logger.warn(
        { err: String(err), id: run.id },
        'scheduler: notice post failed (continuing to dispatch anyway)',
      );
    }

    try {
      await this.deps.dispatch({
        userId: run.peer_id,
        channel: run.channel_id,
        text: run.prompt_text,
        ts: String(Date.now() / 1000),
        threadTs: run.thread_ts,
        isDm: false,
      });
      scheduledRunStore.setStatus(run.id, 'fired');
      eventBus.emitEvent({
        kind: 'schedule.fired',
        ts: Date.now(),
        id: run.id,
        threadKey: run.thread_key,
        reason: run.reason ?? '',
      });
    } catch (err) {
      logger.error(
        { err: String(err), id: run.id },
        'scheduler: dispatch failed — marking failed',
      );
      scheduledRunStore.setStatus(run.id, 'failed');
    }
  }
}

/**
 * Helper used by the orchestrator's next_check_at and any other code
 * that wants to schedule a self-spawn. Soft-fails on cap-reached.
 */
export function scheduleRun(input: {
  threadKey: string;
  channelId: string;
  threadTs: string;
  peerId: string;
  promptText: string;
  runAt: Date;
  reason: string;
  source: string;
}): { ok: boolean; id?: number; reason?: string } {
  // Refuse if cap reached.
  const fired = scheduledRunStore.countFiredForThread(input.threadKey);
  const pending = scheduledRunStore.countPendingForThread(input.threadKey);
  if (fired + pending >= PER_THREAD_CAP) {
    return { ok: false, reason: `per-thread cap of ${PER_THREAD_CAP} reached` };
  }
  const id = scheduledRunStore.insert({
    thread_key: input.threadKey,
    channel_id: input.channelId,
    thread_ts: input.threadTs,
    peer_id: input.peerId,
    prompt_text: input.promptText,
    reason: input.reason,
    run_at: input.runAt.getTime(),
    source: input.source,
  });
  eventBus.emitEvent({
    kind: 'schedule.created',
    ts: Date.now(),
    id,
    threadKey: input.threadKey,
    reason: input.reason,
    runAt: input.runAt.getTime(),
    source: input.source,
  });
  return { ok: true, id };
}
