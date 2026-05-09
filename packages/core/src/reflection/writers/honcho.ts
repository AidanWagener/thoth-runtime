import type { HonchoClient } from '../../memory/honcho';
import { logger } from '../../logger';

/**
 * Forward user_model_updates from a reflection back into Honcho as
 * messages tagged with the apex peer. The Deriver picks them up on its
 * next pass and folds them into the target peer's representation.
 *
 * We tag each note as a system-style message authored by `apex` so the
 * Deriver knows it's an observation, not a verbatim user message.
 */

export interface HonchoFeedbackContext {
  threadKey: string;
}

export async function feedHonchoUpdates(
  honcho: HonchoClient,
  updates: Record<string, string[]>,
  ctx: HonchoFeedbackContext,
): Promise<{ written: number }> {
  if (!honcho.enabled) return { written: 0 };
  let written = 0;

  for (const [peerId, notes] of Object.entries(updates)) {
    for (const note of notes) {
      const observation = `[reflection-observation about ${peerId}] ${note}`.slice(0, 2000);
      // Use the agent self-peer as author so the deriver attributes the
      // observation to the agent rather than to the human.
      honcho.ingest(ctx.threadKey, 'thoth', observation);
      written++;
    }
  }

  if (written > 0) {
    logger.info(
      { threadKey: ctx.threadKey, written },
      'honcho user_model_updates queued (fire-and-forget)',
    );
  }
  return { written };
}
