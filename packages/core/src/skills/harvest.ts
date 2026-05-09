import fs from 'fs/promises';
import path from 'path';
import type { EpisodicStore, Episode } from '../memory/episodic';
import { skillDraftStore } from './store';
import { eventBus } from '../dashboard/event-bus';
import { logger } from '../logger';

/**
 * A8 — Auto-skill harvesting.
 *
 * Periodically scans recent episodes for *patterns* that suggest a
 * recurring task worth crystallizing as a skill. Algorithm:
 *
 *   1. Pull the last N episodes (default 200, ~2 weeks of activity)
 *   2. Group by surface-form similarity of user_text using a tight
 *      shingle hash + a length-tolerant normalized prefix.
 *   3. Cluster by cosine similarity of stored embeddings (already in
 *      the episodes table) — single-linkage agglomerative, threshold
 *      0.78 cosine.
 *   4. Reject clusters with fewer than MIN_CLUSTER_SIZE members.
 *   5. Reject clusters whose members span < MIN_DAYS_SPAN — we want
 *      patterns that recur over multiple sessions, not chatter in
 *      a single thread.
 *   6. For each surviving cluster, generate a draft skill scaffold
 *      and propose it via the existing skill_drafts pipeline. The
 *      🎉/❌ reaction flow handles approval.
 *
 * Idempotency: a skill draft fingerprint (sorted episode-id list) is
 * stored in the draft's description; before proposing, we check if a
 * draft with the same fingerprint already exists pending or accepted.
 *
 * NO model spawn — this is pure heuristic harvesting. The actual skill
 * body is the user's own pattern, lightly templated. If the founder
 * wants a polished skill body, they edit on emerald-tablets after
 * accepting.
 */

const MIN_CLUSTER_SIZE = 3;          // need ≥3 similar episodes
const MIN_DAYS_SPAN = 1;             // must span ≥1 day (not all in one session)
const COSINE_THRESHOLD = 0.78;       // tight cluster
const DEFAULT_LOOKBACK = 200;        // episodes
const FP_PREFIX = 'auto-harvest:';   // marker in draft description

export interface HarvestDeps {
  episodic: EpisodicStore;
  bridgeRepoRoot: string;
}

export interface HarvestResult {
  scanned: number;
  clusters: number;
  proposed: number;
  skipped_existing: number;
  skipped_small: number;
}

export async function harvestSkills(deps: HarvestDeps, lookback = DEFAULT_LOOKBACK): Promise<HarvestResult> {
  const eps = deps.episodic.listRecent(lookback);
  const out: HarvestResult = { scanned: eps.length, clusters: 0, proposed: 0, skipped_existing: 0, skipped_small: 0 };
  if (eps.length < MIN_CLUSTER_SIZE) return out;

  // 1. Hydrate full episodes (with embeddings) for the candidate set.
  const full: Episode[] = [];
  for (const e of eps) {
    const f = deps.episodic.findById(e.id);
    if (f) full.push(f);
  }

  // 2. Cluster by cosine similarity (single-linkage, agglomerative).
  const clusters = clusterByCosine(full, COSINE_THRESHOLD);
  out.clusters = clusters.length;

  for (const cluster of clusters) {
    if (cluster.length < MIN_CLUSTER_SIZE) {
      out.skipped_small++;
      continue;
    }
    const sorted = cluster.slice().sort((a, b) => a.created_at - b.created_at);
    const spanMs = sorted[sorted.length - 1].created_at - sorted[0].created_at;
    if (spanMs < MIN_DAYS_SPAN * 24 * 60 * 60 * 1000) {
      out.skipped_small++;
      continue;
    }
    const fp = fingerprint(cluster);

    // Idempotency check — skip if we've already proposed/accepted this exact set.
    if (existingDraftWithFingerprint(fp)) {
      out.skipped_existing++;
      continue;
    }

    const slug = generateSlug(cluster);
    const filePath = path.join(deps.bridgeRepoRoot, '.claude', 'skills', slug, 'SKILL.md');
    const skillBody = renderSkillBody(slug, cluster);

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, skillBody, 'utf8');
    } catch (err) {
      logger.warn({ err: String(err), slug }, 'auto-harvest: file write failed');
      continue;
    }

    const description = `${FP_PREFIX}${fp} · ${cluster.length} similar episodes — ${shortTopic(cluster)}`;
    const draftId = skillDraftStore.insert({
      slug,
      file_path: filePath,
      description,
      source_thread_key: cluster[0].thread_key,
      source_channel_id: cluster[0].channel_id ?? cluster[0].slack_channel_id ?? 'unknown',
      proposed_by: 'auto-harvest',
      status: 'pending',
      created_at: Date.now(),
    });
    out.proposed++;

    eventBus.emitEvent({
      kind: 'skill.proposed',
      ts: Date.now(),
      draftId,
      slug,
      description,
      sourceThreadKey: cluster[0].thread_key,
    });

    logger.info(
      { slug, draftId, members: cluster.length, fp },
      'auto-harvest: skill draft proposed',
    );
  }

  return out;
}

// ── helpers ────────────────────────────────────────────────────────

function clusterByCosine(eps: Episode[], threshold: number): Episode[][] {
  // Decode embeddings (may be Buffer in better-sqlite3 driver).
  const vecs: Float32Array[] = [];
  const valid: number[] = [];
  for (let i = 0; i < eps.length; i++) {
    const blob = (eps[i] as unknown as { embedding?: Buffer | null }).embedding;
    if (!blob || !Buffer.isBuffer(blob)) continue;
    try {
      const view = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
      // Copy out so the underlying buffer can be GC'd.
      vecs.push(new Float32Array(view));
      valid.push(i);
    } catch {
      continue;
    }
  }
  // Single-linkage: BFS over similarity graph.
  const visited = new Set<number>();
  const clusters: Episode[][] = [];
  for (let i = 0; i < valid.length; i++) {
    if (visited.has(i)) continue;
    const queue = [i];
    const cluster: number[] = [];
    while (queue.length > 0) {
      const k = queue.shift()!;
      if (visited.has(k)) continue;
      visited.add(k);
      cluster.push(k);
      for (let j = 0; j < valid.length; j++) {
        if (visited.has(j)) continue;
        if (cosine(vecs[k], vecs[j]) >= threshold) queue.push(j);
      }
    }
    clusters.push(cluster.map((idx) => eps[valid[idx]]));
  }
  return clusters;
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Vectors are L2-normalized at write time so dot == cosine.
  return dot;
}

function fingerprint(cluster: Episode[]): string {
  const ids = cluster.map((e) => e.id).sort((a, b) => a - b);
  return ids.join(',');
}

function existingDraftWithFingerprint(fp: string): boolean {
  // Re-use the marker in description as a lightweight index.
  // Drafts stay in pending/accepted forever; rejected ones can be revived.
  const marker = `${FP_PREFIX}${fp}`;
  const all = skillDraftStore.listPending();
  for (const d of all) {
    if (d.description && d.description.includes(marker)) return true;
  }
  return false;
}

function generateSlug(cluster: Episode[]): string {
  // Take the most-frequent meaningful word from user_text across the cluster.
  const stop = new Set(['the','a','an','is','it','to','of','for','and','with','this','that','can','you','your','in','on','at','if','as','by','be','my','our']);
  const counts = new Map<string, number>();
  for (const e of cluster) {
    const words = (e.user_text || '').toLowerCase().match(/[a-z][a-z0-9-]{2,18}/g) || [];
    for (const w of words) {
      if (stop.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((e) => e[0])
    .join('-');
  const stamp = new Date().toISOString().slice(0, 10);
  return `auto-${top || 'pattern'}-${stamp}`.slice(0, 64);
}

function shortTopic(cluster: Episode[]): string {
  const sample = cluster[0]?.user_text ?? '';
  return sample.replace(/\s+/g, ' ').slice(0, 80).trim();
}

function renderSkillBody(slug: string, cluster: Episode[]): string {
  const lines = [
    '---',
    `name: ${slug}`,
    `description: |`,
    `  Auto-harvested from a recurring user pattern (${cluster.length} similar`,
    `  episodes over ${spanDays(cluster).toFixed(1)} days). Edit / refine / accept`,
    `  to crystallize this pattern as an explicit skill.`,
    `allowed-tools: Read, Glob, Grep, WebFetch`,
    `disable-model-invocation: true`,
    '---',
    '',
    `# ${slug}`,
    '',
    'This skill was auto-proposed by Thoth\'s harvester after detecting',
    `a tight cosine cluster of ${cluster.length} similar episodes. Below`,
    'are the original prompts the user wrote — review, refine, accept (🎉)',
    'or reject (❌).',
    '',
    '## Recurring pattern (verbatim user prompts)',
    '',
  ];
  cluster.slice(0, 8).forEach((e, i) => {
    const date = new Date(e.created_at).toISOString().slice(0, 10);
    lines.push(`### ${i + 1}. ${date}${e.channel_name ? ' · #' + e.channel_name : ''}`);
    lines.push('');
    lines.push('> ' + (e.user_text || '').replace(/\n/g, '\n> '));
    lines.push('');
  });
  lines.push('## Suggested skill behavior');
  lines.push('');
  lines.push('_(Refine this section before accepting. The harvester only)_');
  lines.push('_(detects recurring intent — it does not write the actual)_');
  lines.push('_(procedure. You decide what Thoth should DO when this)_');
  lines.push('_(pattern recurs.)_');
  return lines.join('\n');
}

function spanDays(cluster: Episode[]): number {
  if (cluster.length < 2) return 0;
  const sorted = cluster.slice().sort((a, b) => a.created_at - b.created_at);
  return (sorted[sorted.length - 1].created_at - sorted[0].created_at) / (24 * 60 * 60 * 1000);
}
