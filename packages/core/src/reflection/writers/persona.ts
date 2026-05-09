import type { WebClient } from '@slack/web-api';
import { logger } from '../../logger';

/**
 * Persona observations from reflection are NEVER auto-applied to
 * persona/apex/. They get DM'd to the founder as a candidate diff.
 *
 * Why: persona files are the source of truth for Thoth's identity.
 * Wrong observations propagating into MEMORY.md or RULES.md would
 * compound — bad input becomes worse output. So we always loop the
 * human in for this category of write.
 */

export interface PersonaDmContext {
  client: WebClient;
  founderUserIds: string[];
  threadKey: string;
  channelName: string;
}

export async function dmPersonaObservations(
  observations: readonly string[],
  ctx: PersonaDmContext,
): Promise<{ delivered: number; failed: number }> {
  const valid = observations.map((o) => o.trim()).filter(Boolean);
  if (valid.length === 0) return { delivered: 0, failed: 0 };

  const text = formatDm(valid, ctx);

  let delivered = 0;
  let failed = 0;
  for (const userId of ctx.founderUserIds) {
    try {
      // Open a DM channel with the founder, then post.
      const open = await ctx.client.conversations.open({ users: userId });
      const channel = open.channel?.id;
      if (!channel) {
        failed++;
        logger.warn({ userId }, 'persona DM: could not open conversation');
        continue;
      }
      await ctx.client.chat.postMessage({ channel, text });
      delivered++;
    } catch (err) {
      failed++;
      logger.warn({ err: String(err), userId }, 'persona DM failed');
    }
  }

  logger.info(
    { delivered, failed, threadKey: ctx.threadKey, count: valid.length },
    'persona observations DM\'d to founders',
  );
  return { delivered, failed };
}

function formatDm(observations: readonly string[], ctx: PersonaDmContext): string {
  return [
    `:thought_balloon: *Persona observations from a reflection in ${ctx.channelName}*`,
    '_These are CANDIDATES, never applied automatically. Edit `persona/apex/MEMORY.md` or `RULES.md` only if you agree._',
    '',
    ...observations.map((o, i) => `${i + 1}. ${o}`),
    '',
    `_thread: ${ctx.threadKey}_`,
  ].join('\n');
}
