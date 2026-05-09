import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { skillDraftStore } from './store';
import { logger } from '../logger';
import { eventBus } from '../dashboard/event-bus';

const execFileP = promisify(execFile);

/**
 * A14 — Public skill marketplace integration.
 *
 * When a skill is "published" (🌍 reaction on a draft, OR explicit
 * /skill-publish command), Thoth pushes the skill body to the
 * configured public registry repo with metadata in `index.json`.
 *
 * Other Thoth users can browse the registry and install skills they
 * find useful. The first network-effect surface for the bridge.
 *
 * Required env vars:
 *   THOTH_SKILL_REGISTRY_REPO   — owner/repo (default: AidanWagener/thoth-registry)
 *   THOTH_SKILL_REGISTRY_BRANCH — default: main
 *
 * The registry repo is expected to have:
 *   index.json   — registry of all published skills
 *   skills/<slug>/SKILL.md — published skill bodies
 *
 * On read side: GET /api/skills/registry fetches index.json from the
 * registry's raw github URL so the dashboard can browse without git
 * clone.
 */

const DEFAULT_REGISTRY_REPO = 'AidanWagener/thoth-registry';
const DEFAULT_REGISTRY_BRANCH = 'main';
const REGISTRY_INDEX = 'index.json';

export interface RegistryEntry {
  slug: string;
  description: string;
  publishedBy: string;
  publishedAt: number;
  sourceBridge: string;
  size: number;
}

export interface PublishResult {
  ok: boolean;
  slug?: string;
  url?: string;
  reason?: string;
}

/**
 * Fetch the public registry's index.json for the read-side. No auth
 * needed — uses the raw github URL.
 */
export async function fetchRegistryIndex(): Promise<{ entries: RegistryEntry[]; fetchedAt: number }> {
  const repo = process.env.THOTH_SKILL_REGISTRY_REPO ?? DEFAULT_REGISTRY_REPO;
  const branch = process.env.THOTH_SKILL_REGISTRY_BRANCH ?? DEFAULT_REGISTRY_BRANCH;
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${REGISTRY_INDEX}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      logger.debug({ status: r.status, url }, 'registry index fetch non-OK');
      return { entries: [], fetchedAt: Date.now() };
    }
    const data = (await r.json()) as { entries?: RegistryEntry[] } | RegistryEntry[];
    const entries = Array.isArray(data) ? data : data.entries ?? [];
    return { entries, fetchedAt: Date.now() };
  } catch (err) {
    logger.debug({ err: String(err), url }, 'registry index fetch failed (returning empty)');
    return { entries: [], fetchedAt: Date.now() };
  }
}

/**
 * Publish an accepted skill draft to the registry. Requires GITHUB_TOKEN
 * with push access to the registry repo.
 *
 * Workflow:
 *   1. Read SKILL.md from the local file_path
 *   2. Clone registry into a temp dir (if not cached)
 *   3. Write skills/<slug>/SKILL.md
 *   4. Update index.json — append/replace entry
 *   5. git commit + push
 *
 * Soft-fails everywhere with a clear reason. Never throws upward.
 */
export async function publishSkill(
  draftId: number,
  publishedBy: string,
  bridgeRepoRoot: string,
): Promise<PublishResult> {
  const draft = skillDraftStore.findById(draftId);
  if (!draft) return { ok: false, reason: 'draft not found' };
  if (draft.status !== 'accepted' && draft.status !== 'pending') {
    return { ok: false, reason: `cannot publish status=${draft.status}` };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { ok: false, reason: 'GITHUB_TOKEN not set' };
  }
  const repo = process.env.THOTH_SKILL_REGISTRY_REPO ?? DEFAULT_REGISTRY_REPO;
  const branch = process.env.THOTH_SKILL_REGISTRY_BRANCH ?? DEFAULT_REGISTRY_BRANCH;

  // Read the skill body locally first so we don't waste a clone if it's missing.
  let body: string;
  try {
    body = await fs.readFile(draft.file_path, 'utf8');
  } catch (err) {
    return { ok: false, reason: 'cannot read SKILL.md: ' + String(err).slice(0, 200) };
  }

  const tmpRoot = path.join(bridgeRepoRoot, 'runtime', 'skill-registry');
  await fs.mkdir(tmpRoot, { recursive: true });

  // Clone or pull the registry.
  const cloneTarget = path.join(tmpRoot, 'repo');
  const remoteUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
  try {
    const exists = await fs.stat(cloneTarget).then(() => true).catch(() => false);
    if (!exists) {
      await execFileP('git', ['clone', '--depth', '1', '-b', branch, remoteUrl, cloneTarget]);
    } else {
      await execFileP('git', ['fetch', 'origin', branch], { cwd: cloneTarget });
      await execFileP('git', ['reset', '--hard', `origin/${branch}`], { cwd: cloneTarget });
    }
  } catch (err) {
    return { ok: false, reason: 'registry clone/pull failed: ' + String(err).slice(0, 200) };
  }

  // Write the skill body.
  const skillRel = path.join('skills', draft.slug, 'SKILL.md');
  const skillAbs = path.join(cloneTarget, skillRel);
  try {
    await fs.mkdir(path.dirname(skillAbs), { recursive: true });
    await fs.writeFile(skillAbs, body, 'utf8');
  } catch (err) {
    return { ok: false, reason: 'skill write failed: ' + String(err).slice(0, 200) };
  }

  // Update index.json (idempotent — replace entry by slug).
  const indexAbs = path.join(cloneTarget, REGISTRY_INDEX);
  let index: { entries: RegistryEntry[] };
  try {
    const raw = await fs.readFile(indexAbs, 'utf8').catch(() => '{"entries":[]}');
    const parsed = JSON.parse(raw);
    index = Array.isArray(parsed) ? { entries: parsed } : (parsed.entries ? parsed : { entries: [] });
  } catch {
    index = { entries: [] };
  }
  const description = (body.match(/^description:\s*(.+)$/m)?.[1] ?? draft.description ?? '').trim().slice(0, 220);
  const entry: RegistryEntry = {
    slug: draft.slug,
    description,
    publishedBy,
    publishedAt: Date.now(),
    sourceBridge: process.env.THOTH_BRIDGE_NAME ?? 'thoth',
    size: body.length,
  };
  index.entries = index.entries.filter((e) => e.slug !== draft.slug);
  index.entries.push(entry);
  index.entries.sort((a, b) => b.publishedAt - a.publishedAt);

  try {
    await fs.writeFile(indexAbs, JSON.stringify(index, null, 2) + '\n', 'utf8');
  } catch (err) {
    return { ok: false, reason: 'index write failed: ' + String(err).slice(0, 200) };
  }

  // Commit + push.
  try {
    await execFileP('git', ['add', skillRel, REGISTRY_INDEX], { cwd: cloneTarget });
    const message = [
      `publish: ${draft.slug}`,
      '',
      description,
      '',
      `Published by ${publishedBy} via Thoth.`,
    ].join('\n');
    await execFileP(
      'git',
      [
        '-c', 'user.email=apex@thoth.local',
        '-c', 'user.name=apex',
        'commit',
        '-m', message,
      ],
      { cwd: cloneTarget },
    );
    await execFileP('git', ['push', 'origin', branch], { cwd: cloneTarget });
  } catch (err) {
    return { ok: false, reason: 'commit/push failed: ' + String(err).slice(0, 240) };
  }

  const browseUrl = `https://github.com/${repo}/tree/${branch}/skills/${draft.slug}`;
  eventBus.emitEvent({
    kind: 'skill.decided',
    ts: Date.now(),
    draftId,
    slug: draft.slug,
    status: 'accepted',
    decidedBy: publishedBy,
    sha: null,
  });

  logger.info(
    { draftId, slug: draft.slug, publishedBy, registry: repo },
    'skill published to registry',
  );

  return { ok: true, slug: draft.slug, url: browseUrl };
}
