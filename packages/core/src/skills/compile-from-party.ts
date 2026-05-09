import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { partyStore } from '../party/store';
import { AGENTS } from '../party/agents';
import { skillDraftStore } from './store';
import { logger } from '../logger';
import { eventBus } from '../dashboard/event-bus';

const execFileP = promisify(execFile);

const TARGET_BRANCH = 'emerald-tablets';

/**
 * Compile a successful party run into a reusable SKILL.md draft, then
 * commit it on the dedicated `emerald-tablets` branch (founder
 * decision §3 of ROADMAP).
 *
 * Triggered by the 🎉 (`tada`) reaction on the Master synthesis message
 * of any party. Per founder decision §4: auto-skill-compile is gated
 * on 🎉 only — never on every successful reflection.
 *
 * Branch flow:
 *   1. Save current branch
 *   2. Stash any uncommitted changes (unrelated work-in-progress)
 *   3. Checkout (or create) emerald-tablets, syncing from origin/main
 *   4. Write SKILL.md
 *   5. git add + commit (author apex@thoth.local, Co-Authored-By the
 *      reactor)
 *   6. Push to origin/emerald-tablets (auto-PR — founder reviews on github)
 *   7. Restore original branch + unstash
 *
 * Soft-fails everywhere with a clear log line. Never throws upward.
 */
export async function compilePartyToSkill(
  partyId: string,
  decidedByPeerId: string,
  bridgeRepoRoot: string,
): Promise<{ ok: boolean; reason?: string; branch?: string; sha?: string; slug?: string }> {
  const party = partyStore.getRun(partyId);
  if (!party) return { ok: false, reason: 'party not found' };
  if (party.outcome !== 'success' && party.outcome !== 'over_budget') {
    return { ok: false, reason: `cannot compile party with outcome=${party.outcome}` };
  }

  const slug = `party-${slugify(party.topic).slice(0, 32)}`;
  const skillDir = path.join(bridgeRepoRoot, '.claude', 'skills', slug);
  const filePath = path.join(skillDir, 'SKILL.md');

  // Build the skill content from the party config + topic.
  const messages = partyStore.listMessages(partyId);
  const synthesis = messages.find((m) => m.agent_role === 'master');
  const roster = safeParse<string[]>(party.roster_json) ?? [];
  const rosterDisplay = roster.map((r) => AGENTS[r as keyof typeof AGENTS]?.display ?? r).join(', ');

  const skillBody = renderSkillBody({
    slug,
    party,
    rosterDisplay,
    synthesis: synthesis?.content ?? '',
  });

  // Find the git root.
  const gitRoot = await findGitRoot(skillDir);
  if (!gitRoot) return { ok: false, reason: 'no git root above .claude/skills' };

  // Save current branch + stash WIP.
  let originalBranch: string;
  try {
    const r = await execFileP('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: gitRoot,
    });
    originalBranch = r.stdout.trim();
  } catch (err) {
    return { ok: false, reason: 'git rev-parse failed: ' + String(err).slice(0, 200) };
  }

  let stashed = false;
  try {
    await execFileP(
      'git',
      ['stash', 'push', '-u', '-m', `auto:emerald-tablets:${slug}:${Date.now()}`],
      { cwd: gitRoot },
    );
    stashed = true; // it's a no-op if there's nothing to stash; we err on the safe side
  } catch {
    stashed = false;
  }

  let branchSha: string | undefined;
  let restoreErr: string | undefined;
  try {
    // Switch to (or create) emerald-tablets, branched from main if new.
    const branches = (
      await execFileP('git', ['branch', '--list', TARGET_BRANCH], { cwd: gitRoot })
    ).stdout.trim();
    if (!branches) {
      // Branch doesn't exist locally. Try fetching it from origin first.
      try {
        await execFileP('git', ['fetch', 'origin', TARGET_BRANCH], { cwd: gitRoot });
        await execFileP('git', ['checkout', '-B', TARGET_BRANCH, `origin/${TARGET_BRANCH}`], {
          cwd: gitRoot,
        });
      } catch {
        // Doesn't exist on origin either — branch from current main.
        await execFileP('git', ['checkout', '-b', TARGET_BRANCH], { cwd: gitRoot });
      }
    } else {
      await execFileP('git', ['checkout', TARGET_BRANCH], { cwd: gitRoot });
    }

    // Write the skill file.
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(filePath, skillBody, 'utf8');

    const relPath = path.relative(gitRoot, filePath).replace(/\\/g, '/');
    await execFileP('git', ['add', relPath], { cwd: gitRoot });

    const message = [
      `skill: ${slug} — auto-compiled from party ${partyId}`,
      '',
      `Topic: ${party.topic.replace(/\n/g, ' ').slice(0, 200)}`,
      `Mode: ${party.mode} · template: ${party.template} · rounds: ${party.rounds}`,
      `Roster: ${rosterDisplay}`,
      `Total cost: $${party.total_cost_usd.toFixed(4)}`,
      '',
      'Co-Authored-By: Aidan Wagener <38454859+AidanWagener@users.noreply.github.com>',
      `Co-Authored-By: ${decidedByPeerId} <noreply@thoth.local>`,
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
      { cwd: gitRoot },
    );
    branchSha = (
      await execFileP('git', ['rev-parse', 'HEAD'], { cwd: gitRoot })
    ).stdout.trim();

    // Push to origin/emerald-tablets — best effort. If push fails the
    // commit is still on the local branch.
    try {
      await execFileP('git', ['push', '-u', 'origin', TARGET_BRANCH], { cwd: gitRoot });
    } catch (err) {
      logger.warn(
        { err: String(err).slice(0, 200), branch: TARGET_BRANCH },
        'auto-skill push failed (commit retained locally)',
      );
    }
  } catch (err) {
    return {
      ok: false,
      reason: `branch flow failed: ${String(err).slice(0, 240)}`,
    };
  } finally {
    // Restore original branch + unstash.
    try {
      await execFileP('git', ['checkout', originalBranch], { cwd: gitRoot });
      if (stashed) {
        try {
          await execFileP('git', ['stash', 'pop'], { cwd: gitRoot });
        } catch {
          /* nothing to pop is fine */
        }
      }
    } catch (err) {
      restoreErr = String(err).slice(0, 200);
    }
  }

  if (restoreErr) {
    logger.error({ restoreErr, originalBranch }, 'failed to restore branch after auto-compile');
  }

  // Register the draft as accepted (founder already 🎉'd; no further approval needed).
  const draftId = skillDraftStore.insert({
    slug,
    file_path: filePath,
    description: `auto-compiled from party ${partyId}`,
    source_thread_key: party.thread_key,
    source_channel_id: party.thread_key.split(':')[0],
    proposed_by: 'reflection-auto',
    status: 'accepted',
    created_at: Date.now(),
  });
  skillDraftStore.setStatus(draftId, 'accepted', decidedByPeerId);

  eventBus.emitEvent({
    kind: 'skill.decided',
    ts: Date.now(),
    draftId,
    slug,
    status: 'accepted',
    decidedBy: decidedByPeerId,
    sha: branchSha ?? null,
  });

  logger.info(
    {
      partyId,
      slug,
      branch: TARGET_BRANCH,
      sha: branchSha,
      decidedByPeerId,
    },
    'party auto-compiled to skill on emerald-tablets',
  );

  return { ok: true, branch: TARGET_BRANCH, sha: branchSha, slug };
}

// ── helpers ────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function safeParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
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

function renderSkillBody(opts: {
  slug: string;
  party: { topic: string; mode: string; template: string; rounds: number };
  rosterDisplay: string;
  synthesis: string;
}): string {
  return `---
name: ${opts.slug}
description: |
  Auto-compiled from a successful party. Topic was:
  "${opts.party.topic.replace(/\n/g, ' ').slice(0, 200)}"
  Re-run with: /party ${opts.slug} <new-topic>
allowed-tools: Read, Glob, Grep, WebFetch
disable-model-invocation: true
---

# ${opts.slug}

This skill captures a multi-agent debate pattern that worked well
on a previous topic. The synthesis below is the original outcome —
adapt it as a guide for similar topics.

## Source party

- Topic: ${opts.party.topic.replace(/\n/g, ' ')}
- Mode: ${opts.party.mode}
- Template: ${opts.party.template}
- Rounds: ${opts.party.rounds}
- Roster: ${opts.rosterDisplay}

## Original synthesis

${opts.synthesis.trim() || '_(no synthesis available)_'}

## How to invoke

\`/party ${opts.slug} <new-topic>\` — re-runs with the same roster /
mode / template / rounds against a new topic.
`;
}
