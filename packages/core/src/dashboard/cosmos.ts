import { AGENTS, type AgentRole } from '../party/agents';
import type { EpisodicStore, Episode } from '../memory/episodic';
import { partyStore, type PartyRunRow } from '../party/store';
import { scheduledRunStore } from '../scheduling/store';
import { sigilForName } from './sigils';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../logger';

/**
 * The Firmament — living-cosmos snapshot builder.
 *
 * Returns everything the canvas needs to render Thoth's sun, the
 * Council in orbit, peer binary stars, episode/party/skill stars,
 * scheduled-run comets, constellations (cosine clusters), and metadata
 * for verification glow + peer auras.
 *
 * One round-trip per cosmos render. Frontend caches client-side.
 */

export interface CosmosPoint {
  type: 'episode' | 'party' | 'skill' | 'memory-note' | 'persona';
  id: string;
  x: number;
  y: number;
  z: number;
  title: string;
  kind: string;
  brightness: number;
  /** Owning peer (Slack user id or role for council) — for aura color. */
  peer?: string | null;
  verifiedStatus?: string | null;
  numTurns?: number;
  costUsd?: number;
  isSupernova?: boolean;
  /** Cluster id this point belongs to (or null). */
  cluster?: number | null;
  createdAt?: number;
  channel?: string | null;
}

export interface CosmosCluster {
  id: number;
  /** Index of point at the cluster centroid. */
  centroidIdx: number;
  /** Procedural lore name. */
  name: string;
  /** Member point indices. */
  members: number[];
  /** Adjacency edges (MST-ish). */
  edges: Array<[number, number]>;
}

export interface CosmosAgent {
  role: AgentRole;
  name: string;
  title: string;
  accent: string;
  glyph: string;
  invocations: number;
  /** Orbital radius in cosmos units. */
  orbitR: number;
  /** Orbital phase offset in radians. */
  phase: number;
  sigilSvg: string;
}

export interface CosmosPeer {
  id: string;
  hue: string;
  /** Number of episodes attributed to this peer. */
  count: number;
  /** Sun position in cosmos units. */
  x: number;
  y: number;
  z: number;
}

export interface CosmosComet {
  /** Scheduled run id. */
  id: number;
  /** Anchor: target peer or "apex". */
  anchor: string;
  /** When it'll fire. */
  runAt: number;
  reason: string;
}

export interface CosmosSkill {
  slug: string;
  description: string;
  /** Hue derived from slug hash. */
  hue: string;
  /** Indices of episodes this skill covers (best-effort). */
  memberIndices: number[];
  /** Centroid for the nebula. */
  cx: number; cy: number; cz: number;
}

export interface CosmosSnapshot {
  /** All renderable stars. */
  points: CosmosPoint[];
  /** Auto-detected constellations. */
  clusters: CosmosCluster[];
  /** The Council planets. */
  agents: CosmosAgent[];
  /** Allowlisted peers with personal hues. */
  peers: CosmosPeer[];
  /** Scheduled-run comets. */
  comets: CosmosComet[];
  /** Accepted skills as nebulae. */
  skills: CosmosSkill[];
  /** Time bounds. */
  earliestTs: number;
  latestTs: number;
  generatedAt: number;
  /** Anthropic status indicator for sky weather. */
  sky_weather: string; // 'none' | 'minor' | 'major' | 'critical' | 'maintenance'
}

const TIME_SPAN_MS = 14 * 24 * 60 * 60 * 1000;
// Distinct, vibey hue palette for peer auras.
const PEER_HUES = [
  '#ffd166', '#06d6a0', '#118ab2', '#ef476f',
  '#a78bfa', '#fb923c', '#46d3ff', '#f472b6',
];

export async function buildCosmosSnapshot(opts: {
  episodic: EpisodicStore | undefined;
  bridgeRepoRoot: string;
  allowlistedUserIds: string[];
  skyWeather?: string;
}): Promise<CosmosSnapshot> {
  const now = Date.now();
  const points: CosmosPoint[] = [];
  const peers: CosmosPeer[] = [];
  const clusters: CosmosCluster[] = [];
  const comets: CosmosComet[] = [];
  const skillsOut: CosmosSkill[] = [];
  const agents: CosmosAgent[] = [];

  if (!opts.episodic) {
    return finalize(points, clusters, agents, peers, comets, skillsOut, now, opts);
  }

  // 1. Pull recent episodes with embeddings.
  const recent = opts.episodic.listRecent(400);
  const fullEps = recent
    .map((e) => opts.episodic!.findById(e.id))
    .filter((e): e is Episode => e !== null);

  const vecs: { id: number; vec: Float32Array; ep: Episode }[] = [];
  for (const e of fullEps) {
    const blob = (e as unknown as { embedding?: Buffer | null }).embedding;
    if (!blob || !Buffer.isBuffer(blob)) continue;
    try {
      const view = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
      vecs.push({ id: e.id, vec: new Float32Array(view), ep: e });
    } catch {
      // ignore
    }
  }

  // 2. Project to 2D via deterministic random projection.
  let earliest = now;
  let latest = 0;
  if (vecs.length > 0) {
    const dim = vecs[0].vec.length;
    const rand = mulberryRand(42);
    const ax = randomUnit(dim, rand);
    const ay = randomUnit(dim, rand);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const v of vecs) {
      let dx = 0, dy = 0;
      for (let i = 0; i < dim; i++) { dx += v.vec[i] * ax[i]; dy += v.vec[i] * ay[i]; }
      xs.push(dx); ys.push(dy);
    }
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xSpan = (xMax - xMin) || 1, ySpan = (yMax - yMin) || 1;

    // Project into a torus around the sun: avoid the origin (where Thoth
    // and the planets live) by adding a min radial offset.
    for (let i = 0; i < vecs.length; i++) {
      const v = vecs[i];
      const xN = ((xs[i] - xMin) / xSpan) * 2 - 1;
      const yN = ((ys[i] - yMin) / ySpan) * 2 - 1;
      const ageMs = Math.max(0, now - v.ep.created_at);
      const z = 1 - Math.min(1, ageMs / TIME_SPAN_MS) * 2;
      // Push points away from origin so council orbit zone stays clear.
      let xx = xN, yy = yN;
      const r = Math.sqrt(xx * xx + yy * yy);
      const minR = 0.45;
      if (r < minR) {
        const ang = Math.atan2(yy, xx) || 0;
        xx = Math.cos(ang) * (minR + r * 0.5);
        yy = Math.sin(ang) * (minR + r * 0.5);
      }

      const verifiedBoost = v.ep.verified_status === 'success' ? 0.25 : 0;
      const brightness = Math.max(0.2, 1 - ageMs / TIME_SPAN_MS) + verifiedBoost;
      const cleanTitle = (v.ep.user_text || '').replace(/\s+/g, ' ').slice(0, 80);
      const isSupernova = (v.ep.total_cost_usd ?? 0) > 1.0 || (v.ep.num_turns ?? 0) > 50;
      points.push({
        type: 'episode',
        id: String(v.id),
        x: xx, y: yy, z,
        title: cleanTitle || `episode #${v.id}`,
        kind: 'episode',
        brightness: Math.min(1, brightness),
        peer: v.ep.sender_peer ?? null,
        verifiedStatus: v.ep.verified_status ?? null,
        numTurns: v.ep.num_turns ?? 0,
        costUsd: v.ep.total_cost_usd ?? 0,
        isSupernova,
        cluster: null,
        createdAt: v.ep.created_at,
        channel: v.ep.channel_name ?? null,
      });
      if (v.ep.created_at < earliest) earliest = v.ep.created_at;
      if (v.ep.created_at > latest) latest = v.ep.created_at;
    }

    // 3. Cluster detection — single-linkage agglomerative on cosine ≥ 0.78.
    const clusterIds = clusterByCosine(vecs, 0.78);
    const groups = new Map<number, number[]>();
    for (let i = 0; i < clusterIds.length; i++) {
      if (clusterIds[i] === -1) continue;
      const g = groups.get(clusterIds[i]) ?? [];
      g.push(i);
      groups.set(clusterIds[i], g);
    }
    let cId = 0;
    for (const [, members] of groups) {
      if (members.length < 3) continue;
      // Centroid = nearest-to-mean episode.
      let cx = 0, cy = 0;
      for (const idx of members) { cx += points[idx].x; cy += points[idx].y; }
      cx /= members.length; cy /= members.length;
      let bestIdx = members[0];
      let bestD = Infinity;
      for (const idx of members) {
        const dx = points[idx].x - cx, dy = points[idx].y - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestIdx = idx; }
      }
      // MST edges within cluster (fan-out from centroid is cheap and good).
      const edges: Array<[number, number]> = members
        .filter((m) => m !== bestIdx)
        .map((m) => [bestIdx, m]);
      const name = generateConstellationName(members.map((idx) => fullEps[idx]?.user_text ?? ''));
      points.forEach((p, i) => {
        if (members.includes(i)) p.cluster = cId;
      });
      clusters.push({ id: cId, centroidIdx: bestIdx, name, members, edges });
      cId++;
    }

    // 4. Skills as nebulae — one per accepted skill in .claude/skills/.
    try {
      const skillsDir = path.join(opts.bridgeRepoRoot, '.claude', 'skills');
      const entries = await fs.readdir(skillsDir).catch(() => []);
      for (const slug of entries) {
        if (skillsOut.length >= 12) break;
        try {
          const text = await fs.readFile(path.join(skillsDir, slug, 'SKILL.md'), 'utf8');
          const desc = (text.match(/^description:\s*(.+)$/m)?.[1] ?? '').trim().slice(0, 120);
          // Best-effort member match: episodes whose user_text shares >2 keywords.
          const skillWords = new Set(
            (text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [])
              .filter((w) => !STOP_WORDS.has(w))
              .slice(0, 80),
          );
          const memberIndices: number[] = [];
          for (let i = 0; i < points.length; i++) {
            const txt = (fullEps[i]?.user_text ?? '').toLowerCase();
            const w = (txt.match(/[a-z][a-z0-9-]{3,}/g) ?? []).filter((x) => skillWords.has(x));
            if (w.length >= 3) memberIndices.push(i);
            if (memberIndices.length >= 30) break;
          }
          if (memberIndices.length === 0) continue;
          let cx2 = 0, cy2 = 0, cz2 = 0;
          for (const i of memberIndices) {
            cx2 += points[i].x;
            cy2 += points[i].y;
            cz2 += points[i].z;
          }
          cx2 /= memberIndices.length; cy2 /= memberIndices.length; cz2 /= memberIndices.length;
          skillsOut.push({
            slug,
            description: desc,
            hue: hueFromString(slug),
            memberIndices,
            cx: cx2, cy: cy2, cz: cz2,
          });
        } catch {
          // ignore unreadable skills
        }
      }
    } catch (err) {
      logger.debug({ err: String(err) }, 'cosmos: skills scan failed');
    }
  }

  // 5. Parties — anchor near their thread's most recent episode.
  try {
    const parties = partyStore.listRecent(50);
    for (const p of parties) {
      const anchorIdx = points.findIndex((pt) => pt.type === 'episode' && fullEps.find((e, i) => points[i] === pt && e.thread_key === p.thread_key));
      if (anchorIdx < 0) continue;
      const a = points[anchorIdx];
      const ageMs = Math.max(0, now - p.started_at);
      const z = 1 - Math.min(1, ageMs / TIME_SPAN_MS) * 2;
      const jx = a.x + (Math.random() - 0.5) * 0.10;
      const jy = a.y + (Math.random() - 0.5) * 0.10;
      points.push({
        type: 'party',
        id: p.id,
        x: jx, y: jy, z,
        title: p.topic.slice(0, 80),
        kind: 'party',
        brightness: 0.85,
        peer: p.initiator_peer ?? null,
        cluster: a.cluster ?? null,
        createdAt: p.started_at,
        costUsd: p.total_cost_usd ?? 0,
      });
    }
  } catch {
    // table may not exist
  }

  // 6. Council in orbit — invocations from party_messages roll-up.
  const invByRole: Record<string, number> = {};
  try {
    for (const p of partyStore.listRecent(200)) {
      const msgs = partyStore.listMessages(p.id);
      for (const m of msgs) {
        invByRole[m.agent_role] = (invByRole[m.agent_role] ?? 0) + 1;
      }
    }
  } catch {
    // ignore
  }
  const orderedRoles: AgentRole[] = ['analyst', 'pm', 'architect', 'dev', 'qa', 'ux'];
  const maxInv = Math.max(1, ...orderedRoles.map((r) => invByRole[r] ?? 0));
  orderedRoles.forEach((role, idx) => {
    const a = AGENTS[role];
    const inv = invByRole[role] ?? 0;
    // Radius scales with invocations (busy agents drift outward).
    const orbitR = 0.25 + (inv / maxInv) * 0.25;
    const phase = (idx / orderedRoles.length) * Math.PI * 2;
    agents.push({
      role,
      name: a.name,
      title: a.title,
      accent: a.accent,
      glyph: a.glyph,
      invocations: inv,
      orbitR,
      phase,
      sigilSvg: sigilForName(a.name, '#' + a.accent, { size: 64, ring: false }),
    });
  });

  // 7. Peers — allowlisted users as binary stars.
  const epCountByPeer: Record<string, number> = {};
  for (const e of fullEps) {
    if (e.sender_peer) epCountByPeer[e.sender_peer] = (epCountByPeer[e.sender_peer] ?? 0) + 1;
  }
  opts.allowlistedUserIds.forEach((userId, idx) => {
    const angle = (idx / Math.max(1, opts.allowlistedUserIds.length)) * Math.PI * 2;
    const r = 0.7;
    peers.push({
      id: userId,
      hue: PEER_HUES[idx % PEER_HUES.length],
      count: epCountByPeer[userId] ?? 0,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      z: 0,
    });
  });

  // 8. Comets — scheduled future runs.
  try {
    const futures = scheduledRunStore.listPending().slice(0, 20);
    for (const r of futures) {
      comets.push({
        id: r.id,
        anchor: r.thread_key,
        runAt: r.run_at,
        reason: r.reason ?? '',
      });
    }
  } catch {
    // ignore
  }

  return finalize(points, clusters, agents, peers, comets, skillsOut, now, opts, earliest, latest);
}

function finalize(
  points: CosmosPoint[],
  clusters: CosmosCluster[],
  agents: CosmosAgent[],
  peers: CosmosPeer[],
  comets: CosmosComet[],
  skills: CosmosSkill[],
  now: number,
  opts: { skyWeather?: string },
  earliest = now,
  latest = now,
): CosmosSnapshot {
  return {
    points,
    clusters,
    agents,
    peers,
    comets,
    skills,
    earliestTs: earliest,
    latestTs: latest,
    generatedAt: now,
    sky_weather: opts.skyWeather ?? 'none',
  };
}

// ── helpers ────────────────────────────────────────────────────────

function clusterByCosine(
  vecs: Array<{ id: number; vec: Float32Array; ep: Episode }>,
  threshold: number,
): number[] {
  const n = vecs.length;
  const out = new Array(n).fill(-1);
  let cId = 0;
  for (let i = 0; i < n; i++) {
    if (out[i] !== -1) continue;
    const queue = [i];
    while (queue.length > 0) {
      const k = queue.shift()!;
      if (out[k] !== -1) continue;
      out[k] = cId;
      for (let j = 0; j < n; j++) {
        if (out[j] !== -1) continue;
        if (cosine(vecs[k].vec, vecs[j].vec) >= threshold) queue.push(j);
      }
    }
    cId++;
  }
  return out;
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d; // L2-normalized
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'have', 'are', 'was', 'were',
  'has', 'will', 'would', 'should', 'could', 'them', 'they', 'their', 'about',
  'from', 'into', 'over', 'just', 'like', 'than', 'then', 'when', 'where',
  'what', 'which', 'while', 'because', 'going', 'want', 'need', 'really',
  'still', 'maybe', 'also', 'some', 'many', 'much', 'more', 'less', 'good',
  'bad', 'okay', 'yeah', 'thats', 'lets',
]);

const LORE_TEMPLATES = [
  'The {a} of {b}',
  '{a}’s Argument',          // Ana­log apostrophe avoiding outer quote issues
  'Verses of {a}',
  'The {a}-Wake',
  '{a}-{b} Convergence',
  'The {b} Gate',
  '{a} Fragments',
  'The {a} Dialogue',
  '{a}-{b} Remnant',
  'The Ledger of {a}',
];

function generateConstellationName(texts: string[]): string {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const words = (t.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []);
    for (const w of words) {
      if (STOP_WORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => cap(w));
  if (top.length === 0) return 'Unnamed Cluster';
  if (top.length === 1) return `The ${top[0]} Cluster`;
  // Pick template deterministically by hash of joined keys.
  const seed = hashCode(top.join(''));
  const tpl = LORE_TEMPLATES[Math.abs(seed) % LORE_TEMPLATES.length];
  return tpl.replace('{a}', top[0]).replace('{b}', top[1]);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return h;
}

function hueFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

function mulberryRand(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnit(dim: number, rand: () => number): Float32Array {
  const v = new Float32Array(dim);
  let mag = 0;
  for (let i = 0; i < dim; i++) {
    const u1 = Math.max(1e-10, rand());
    const u2 = rand();
    v[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    mag += v[i] * v[i];
  }
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) v[i] /= mag;
  return v;
}
