import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import type { WebClient } from '@slack/web-api';
import { runReflection } from './runner';
import type { ReflectionContext } from './prompts';
import { writeMemoryNotes } from './writers/memory';
import { writeSkillDraft } from './writers/skill';
import { dmPersonaObservations } from './writers/persona';
import { feedHonchoUpdates } from './writers/honcho';
import type { HonchoClient } from '../memory/honcho';
import type { EpisodicStore } from '../memory/episodic';
import type { SessionStore } from '../session/store';
import { dailyCostCap } from './daily-cap';
import { logger } from '../logger';
import { eventBus } from '../dashboard/event-bus';

export interface OrchestratorDeps {
  client: WebClient;
  honcho?: HonchoClient;
  episodic: EpisodicStore;
  sessionStore: SessionStore;
  claudeBin: string;
  bridgeRepoRoot: string;
  founderUserIds: string[];
  reflectionMaxBudgetUsd: number; // per-session
  dailyCapUsd: number;
  reflectionDisabled: boolean;
  /** absolute path to the reflection sandbox cwd (created lazily). */
  reflectionCwdRoot?: string;
}

export interface SessionEndInput {
  threadKey: string;
  channelId: string;
  channelName: string;
  threadTs: string;
  senderPeerId: string;
  senderDisplayName: string;
  numTurns: number;
  totalCostUsd: number;
  startedAt: number;
  endedAt: number;
}

export interface OrchestratorResult {
  ran: boolean;
  reason?: string;
  costUsd?: number;
  notesAppended?: number;
  skillProposed?: boolean;
  personaObservations?: number;
  honchoUpdates?: number;
}

/**
 * Coordinates: gather transcript → run reflection → fan out writes →
 * mark session as reflection-complete (idempotent).
 *
 * Soft-fails everywhere. Session reflection is best-effort; never
 * blocks foreground bridge operations and never throws upward.
 */
export async function orchestrateReflection(
  deps: OrchestratorDeps,
  input: SessionEndInput,
): Promise<OrchestratorResult> {
  if (deps.reflectionDisabled) {
    return { ran: false, reason: 'reflection disabled by env' };
  }

  // Idempotency: if we already reflected on this thread, skip.
  const session = deps.sessionStore.get(input.threadKey);
  if (session?.reflection_run_at) {
    return { ran: false, reason: 'already reflected' };
  }

  // Daily cap check.
  if (!dailyCostCap.underCap(deps.dailyCapUsd)) {
    logger.warn(
      { threadKey: input.threadKey, capUsd: deps.dailyCapUsd },
      'reflection skipped — daily cap reached',
    );
    deps.sessionStore.markReflected(input.threadKey, 0);
    return { ran: false, reason: 'daily cap reached' };
  }

  // Gather transcript.
  const episodes = deps.episodic.listByThread(input.threadKey);
  if (episodes.length === 0) {
    deps.sessionStore.markReflected(input.threadKey, 0);
    return { ran: false, reason: 'no episodes for this thread' };
  }

  // Lazily create a fresh reflection sandbox cwd. Reflection runs
  // outside the user's worktree so it doesn't see prior tool output.
  const cwdRoot =
    deps.reflectionCwdRoot ??
    path.join(os.homedir(), '.claude', 'projects', 'Thoth', 'reflection-sandboxes');
  const cwd = path.join(cwdRoot, input.threadKey.replace(/[^a-zA-Z0-9]/g, '-'));
  await fs.mkdir(cwd, { recursive: true });

  const ctx: ReflectionContext = {
    threadKey: input.threadKey,
    channelName: input.channelName,
    channelId: input.channelId,
    threadTs: input.threadTs,
    senderPeerId: input.senderPeerId,
    senderDisplayName: input.senderDisplayName,
    episodes,
    numTurns: input.numTurns,
    totalCostUsd: input.totalCostUsd,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  };

  logger.info(
    {
      threadKey: input.threadKey,
      episodes: episodes.length,
      maxBudgetUsd: deps.reflectionMaxBudgetUsd,
    },
    'starting reflection',
  );
  eventBus.emitEvent({
    kind: 'reflection.start',
    ts: Date.now(),
    threadKey: input.threadKey,
    episodeCount: episodes.length,
  });

  const run = await runReflection(
    cwd,
    ctx,
    deps.claudeBin,
    deps.reflectionMaxBudgetUsd,
  );

  // Always record cost (even on failure, to keep the cap honest).
  const capped = dailyCostCap.record(run.costUsd);
  logger.info(
    {
      threadKey: input.threadKey,
      costUsd: run.costUsd.toFixed(4),
      durationMs: run.durationMs,
      todayUsd: capped.todayUsd.toFixed(4),
      todayCount: capped.todayCount,
      capUsd: deps.dailyCapUsd,
    },
    'reflection subprocess complete',
  );

  if (!run.reflection) {
    deps.sessionStore.markReflected(input.threadKey, run.costUsd);
    return {
      ran: true,
      reason: 'reflection JSON unparseable (logged)',
      costUsd: run.costUsd,
    };
  }

  // Fan-out writes. All best-effort.
  const reflection = run.reflection;
  const writeCtx = {
    threadKey: input.threadKey,
    senderPeerId: input.senderPeerId,
    senderDisplayName: input.senderDisplayName,
    channelName: input.channelName,
    recordedAt: Date.now(),
  };

  // 1. Auto Memory append.
  let notesAppended = 0;
  if (reflection.memory_notes.length > 0) {
    try {
      const r = await writeMemoryNotes(reflection.memory_notes, writeCtx);
      notesAppended = r.appended;
    } catch (err) {
      logger.warn({ err: String(err) }, 'memory writer failed');
    }
  }

  // 2. Skill draft.
  let skillProposed = false;
  if (
    reflection.should_skill &&
    reflection.skill_slug &&
    reflection.skill_body
  ) {
    try {
      const r = await writeSkillDraft(
        {
          slug: reflection.skill_slug,
          description: reflection.skill_description,
          body: reflection.skill_body,
        },
        {
          bridgeRepoRoot: deps.bridgeRepoRoot,
          sourceThreadKey: input.threadKey,
          sourceChannelId: input.channelId,
          sourceChannelName: input.channelName,
          sourceThreadTs: input.threadTs,
          proposedBy: input.senderPeerId,
          notifyChannel: input.channelId,
          notifyThreadTs: input.threadTs,
          client: deps.client,
        },
      );
      skillProposed = r !== null;
    } catch (err) {
      logger.warn({ err: String(err) }, 'skill writer failed');
    }
  }

  // 3. Persona observations DM.
  let personaCount = 0;
  if (reflection.persona_observations.length > 0) {
    try {
      await dmPersonaObservations(reflection.persona_observations, {
        client: deps.client,
        founderUserIds: deps.founderUserIds,
        threadKey: input.threadKey,
        channelName: input.channelName,
      });
      personaCount = reflection.persona_observations.length;
    } catch (err) {
      logger.warn({ err: String(err) }, 'persona writer failed');
    }
  }

  // 4. Honcho user_model_updates.
  let honchoCount = 0;
  if (deps.honcho?.enabled && Object.keys(reflection.user_model_updates).length > 0) {
    try {
      const r = await feedHonchoUpdates(
        deps.honcho,
        reflection.user_model_updates,
        { threadKey: input.threadKey },
      );
      honchoCount = r.written;
    } catch (err) {
      logger.warn({ err: String(err) }, 'honcho writer failed');
    }
  }

  // 5. next_check_at → schedule a self-spawn (Phase 4).
  if (reflection.next_check_at) {
    const runAt = new Date(reflection.next_check_at);
    const minDelayMs = 30_000;
    const earliest = new Date(Date.now() + minDelayMs);
    const effective = runAt.getTime() < earliest.getTime() ? earliest : runAt;
    try {
      const { scheduleRun } = await import('../scheduling/poller');
      const r = scheduleRun({
        threadKey: input.threadKey,
        channelId: input.channelId,
        threadTs: input.threadTs,
        peerId: input.senderPeerId,
        promptText:
          'Follow-up time. Check whatever you flagged for revisit and report back tersely.',
        runAt: effective,
        reason: 'reflection follow-up',
        source: 'reflection',
      });
      logger.info(
        {
          threadKey: input.threadKey,
          requestedAt: reflection.next_check_at,
          effectiveAt: effective.toISOString(),
          scheduled: r.ok,
          reason: r.reason,
        },
        r.ok ? 'self-spawn scheduled' : 'self-spawn refused',
      );
    } catch (err) {
      logger.warn(
        { err: String(err), threadKey: input.threadKey },
        'self-spawn schedule failed (soft)',
      );
    }
  }

  deps.sessionStore.markReflected(input.threadKey, run.costUsd);

  logger.info(
    {
      threadKey: input.threadKey,
      outcome: reflection.outcome,
      notesAppended,
      skillProposed,
      personaObservations: personaCount,
      honchoUpdates: honchoCount,
    },
    'reflection complete',
  );
  eventBus.emitEvent({
    kind: 'reflection.complete',
    ts: Date.now(),
    threadKey: input.threadKey,
    costUsd: run.costUsd,
    outcome: reflection.outcome,
    notesAppended,
    skillProposed,
    personaObservations: personaCount,
    honchoUpdates: honchoCount,
  });

  return {
    ran: true,
    costUsd: run.costUsd,
    notesAppended,
    skillProposed,
    personaObservations: personaCount,
    honchoUpdates: honchoCount,
  };
}
