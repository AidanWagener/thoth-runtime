import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { skillDraftStore, type SkillDraftRow } from './store';
import { logger } from '../logger';
import { eventBus } from '../dashboard/event-bus';

const execFileP = promisify(execFile);

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Accept a skill draft: stage + commit the SKILL.md to the bridge repo.
 * Push is intentionally NOT done here — let the founder push when they
 * want, OR let a separate cron pick up unpushed commits.
 */
export async function acceptSkillDraft(
  draftId: number,
  decidedByPeerId: string,
): Promise<{ ok: boolean; reason?: string; sha?: string }> {
  const draft = skillDraftStore.findById(draftId);
  if (!draft) return { ok: false, reason: 'draft not found' };
  if (draft.status !== 'pending') {
    return { ok: false, reason: `already ${draft.status}` };
  }

  // Verify the file is still on disk.
  try {
    await fs.access(draft.file_path);
  } catch {
    skillDraftStore.setStatus(draftId, 'rejected', decidedByPeerId);
    return { ok: false, reason: 'file missing on disk' };
  }

  const repoRoot = await findGitRoot(path.dirname(draft.file_path));
  if (!repoRoot) {
    return { ok: false, reason: 'no git root above skill file' };
  }

  const relPath = path.relative(repoRoot, draft.file_path).replace(/\\/g, '/');
  try {
    await execFileP('git', ['add', relPath], { cwd: repoRoot });
    const message = [
      `skill: ${draft.slug} — proposed by reflection`,
      '',
      `Source thread: ${draft.source_thread_key}`,
      `Proposed-by: ${draft.proposed_by}`,
      `Approved-by: ${decidedByPeerId}`,
      '',
      'Co-Authored-By: Aidan Wagener <38454859+AidanWagener@users.noreply.github.com>',
    ].join('\n');
    await execFileP(
      'git',
      [
        '-c',
        'user.email=apex@thoth.local',
        '-c',
        'user.name=apex',
        'commit',
        '-m',
        message,
      ],
      { cwd: repoRoot },
    );
    const sha = (await execFileP('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })).stdout.trim();
    skillDraftStore.setStatus(draftId, 'accepted', decidedByPeerId);
    logger.info(
      { draftId, slug: draft.slug, sha, repoRoot },
      'skill draft accepted + committed',
    );
    eventBus.emitEvent({
      kind: 'skill.decided',
      ts: Date.now(),
      draftId,
      slug: draft.slug,
      status: 'accepted',
      decidedBy: decidedByPeerId,
      sha,
    });
    return { ok: true, sha };
  } catch (err) {
    logger.error(
      { err: String(err), draftId, slug: draft.slug },
      'skill draft commit failed',
    );
    return { ok: false, reason: String(err).slice(0, 200) };
  }
}

/**
 * Reject a skill draft: delete the file from disk, mark rejected.
 */
export async function rejectSkillDraft(
  draftId: number,
  decidedByPeerId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const draft = skillDraftStore.findById(draftId);
  if (!draft) return { ok: false, reason: 'draft not found' };
  if (draft.status !== 'pending') {
    return { ok: false, reason: `already ${draft.status}` };
  }

  await safeDelete(draft.file_path);
  await safeDeleteEmptyParent(draft.file_path);
  skillDraftStore.setStatus(draftId, 'rejected', decidedByPeerId);

  logger.info(
    { draftId, slug: draft.slug },
    'skill draft rejected + file removed',
  );
  eventBus.emitEvent({
    kind: 'skill.decided',
    ts: Date.now(),
    draftId,
    slug: draft.slug,
    status: 'rejected',
    decidedBy: decidedByPeerId,
    sha: null,
  });
  return { ok: true };
}

/**
 * Sweep for drafts older than EXPIRY_MS and discard them. Designed to
 * run periodically (e.g. once an hour) — idempotent and cheap.
 */
export async function expireOldSkillDrafts(): Promise<{ expired: SkillDraftRow[] }> {
  const stale = skillDraftStore.listPendingOlderThan(EXPIRY_MS);
  for (const draft of stale) {
    await safeDelete(draft.file_path);
    await safeDeleteEmptyParent(draft.file_path);
    skillDraftStore.setStatus(draft.id, 'expired', null);
    logger.info(
      { draftId: draft.id, slug: draft.slug, ageMs: Date.now() - draft.created_at },
      'skill draft expired',
    );
  }
  return { expired: stale };
}

async function safeDelete(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    logger.debug(
      { err: String(err), filePath },
      'safeDelete: file already gone or inaccessible',
    );
  }
}

async function safeDeleteEmptyParent(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  try {
    const entries = await fs.readdir(dir);
    if (entries.length === 0) {
      await fs.rmdir(dir);
    }
  } catch {
    // ignore
  }
}

async function findGitRoot(startDir: string): Promise<string | null> {
  let cur = path.resolve(startDir);
  while (true) {
    try {
      const entries = await fs.readdir(cur);
      if (entries.includes('.git')) return cur;
    } catch {
      return null;
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}
