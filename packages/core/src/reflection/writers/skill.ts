import fs from 'fs/promises';
import path from 'path';
import type { WebClient } from '@slack/web-api';
import { logger } from '../../logger';
import { skillDraftStore, type SkillDraftRow } from '../../skills/store';
import { eventBus } from '../../dashboard/event-bus';

/**
 * Write a proposed SKILL.md to the bridge repo's `.claude/skills/<slug>/`
 * directory and post a Slack DM with ✅/❌ approval reactions.
 *
 * The file lives uncommitted on disk until the founder reacts ✅ — at
 * which point the skills/manager.ts commits it. ❌ or 7-day timeout
 * deletes the file and marks the draft rejected/expired.
 */

export interface ProposedSkill {
  slug: string;
  description: string | null;
  body: string;
}

export interface SkillWriteContext {
  bridgeRepoRoot: string;
  sourceThreadKey: string;
  sourceChannelId: string;
  sourceChannelName: string;
  sourceThreadTs: string;
  proposedBy: string; // peer_id who triggered the session
  notifyChannel: string; // where to post the approval card (typically the source channel)
  notifyThreadTs: string;
  client: WebClient;
}

export interface SkillWriteResult {
  draftId: number;
  filePath: string;
  slackMessageTs: string | null;
}

const HARNESS_KEYWORDS = /\b(hermes|openclaw|nanoclaw|claw)\b/i;

export async function writeSkillDraft(
  proposed: ProposedSkill,
  ctx: SkillWriteContext,
): Promise<SkillWriteResult | null> {
  if (!isValidSlug(proposed.slug)) {
    logger.warn(
      { slug: proposed.slug },
      'skill draft rejected: slug not kebab-case',
    );
    return null;
  }
  if (!proposed.body || proposed.body.length < 50) {
    logger.warn({ slug: proposed.slug }, 'skill draft rejected: body too short');
    return null;
  }
  if (HARNESS_KEYWORDS.test(proposed.body) || HARNESS_KEYWORDS.test(proposed.slug)) {
    logger.warn(
      { slug: proposed.slug },
      'skill draft rejected: harness keyword detected',
    );
    return null;
  }
  const skillDir = path.join(
    ctx.bridgeRepoRoot,
    '.claude',
    'skills',
    proposed.slug,
  );
  const filePath = path.join(skillDir, 'SKILL.md');
  try {
    await fs.access(filePath);
    logger.warn(
      { slug: proposed.slug, filePath },
      'skill draft rejected: file already exists at this slug',
    );
    return null;
  } catch {
    // good — doesn't exist
  }

  const body = ensureFrontmatter(proposed);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(filePath, body, 'utf8');

  // Persist the draft so reaction handlers can find it later.
  const draftId = skillDraftStore.insert({
    slug: proposed.slug,
    file_path: filePath,
    description: proposed.description ?? null,
    source_thread_key: ctx.sourceThreadKey,
    source_channel_id: ctx.sourceChannelId,
    proposed_by: ctx.proposedBy,
    status: 'pending',
    created_at: Date.now(),
  } as Omit<SkillDraftRow, 'id'>);

  const card = formatApprovalCard(proposed, draftId, filePath);
  let postedTs: string | null = null;
  try {
    const r = await ctx.client.chat.postMessage({
      channel: ctx.notifyChannel,
      thread_ts: ctx.notifyThreadTs,
      text: card,
    });
    postedTs = r.ts ?? null;
    if (postedTs) {
      // Pre-attach reaction targets so the founder sees them as buttons.
      await ctx.client.reactions
        .add({ channel: ctx.notifyChannel, timestamp: postedTs, name: 'white_check_mark' })
        .catch(() => undefined);
      await ctx.client.reactions
        .add({ channel: ctx.notifyChannel, timestamp: postedTs, name: 'x' })
        .catch(() => undefined);
      skillDraftStore.attachSlackMessage(draftId, ctx.notifyChannel, postedTs);
    }
  } catch (err) {
    logger.warn(
      { err: String(err), slug: proposed.slug, draftId },
      'skill draft posted to disk but Slack DM failed',
    );
  }

  logger.info(
    {
      draftId,
      slug: proposed.slug,
      filePath,
      slackMessageTs: postedTs,
    },
    'skill draft proposed',
  );
  eventBus.emitEvent({
    kind: 'skill.proposed',
    ts: Date.now(),
    draftId,
    slug: proposed.slug,
    description: proposed.description,
    sourceThreadKey: ctx.sourceThreadKey,
  });

  return { draftId, filePath, slackMessageTs: postedTs };
}

function isValidSlug(slug: string): boolean {
  return /^[a-z][a-z0-9-]{1,49}$/.test(slug);
}

function ensureFrontmatter(p: ProposedSkill): string {
  const trimmed = p.body.trim();
  if (trimmed.startsWith('---\n')) return trimmed + '\n';
  // Synthesize minimal frontmatter from the description.
  const desc = (p.description ?? '').replace(/[\r\n]+/g, ' ').slice(0, 240);
  return [
    '---',
    `name: ${p.slug}`,
    `description: ${desc || 'Auto-proposed skill — please refine'}`,
    '---',
    '',
    trimmed,
    '',
  ].join('\n');
}

function formatApprovalCard(
  p: ProposedSkill,
  draftId: number,
  filePath: string,
): string {
  const desc = p.description ?? '_(no description provided)_';
  return [
    `:hammer_and_wrench: *Skill draft proposed* — \`${p.slug}\`  (#${draftId})`,
    `${desc}`,
    '',
    'React :white_check_mark: to commit it to `.claude/skills/`. React :x: to discard.',
    '_Auto-discards after 7 days._',
    '',
    '```',
    truncate(p.body, 1500),
    '```',
    '',
    `_File staged at:_ \`${filePath}\``,
  ].join('\n');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '\n…(truncated, full file on disk)';
}
