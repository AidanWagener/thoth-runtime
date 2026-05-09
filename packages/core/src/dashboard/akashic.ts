import type { EpisodicStore } from '../memory/episodic';
import { provenanceStore } from '../provenance/store';
import { logger } from '../logger';

/**
 * Akashic Records — the library of every entity in the bridge.
 * Backend builders for: semantic search, formative-episode rollups,
 * milestones, on-this-day, forgotten threads, topic emergence/decay.
 */

export interface SemanticHit {
  episodeId: number;
  score: number;
  threadKey: string;
  channel: string | null;
  peer: string;
  userText: string;
  apexSummary: string;
  createdAt: number;
}

export async function semanticSearch(
  ep: EpisodicStore,
  query: string,
  k = 20,
): Promise<SemanticHit[]> {
  if (!query || query.trim().length < 2) return [];
  const hits = await ep.recall(query, { topK: k, minScore: 0 }).catch(() => []);
  return hits.map((h) => ({
    episodeId: h.episode.id,
    score: Math.round(h.score * 1000) / 1000,
    threadKey: h.episode.thread_key,
    channel: h.episode.channel_name ?? null,
    peer: h.episode.sender_peer,
    userText: (h.episode.user_text || '').slice(0, 240),
    apexSummary: (h.episode.apex_summary || '').slice(0, 240),
    createdAt: h.episode.created_at,
  }));
}

/**
 * Formative episodes: those that appear most often as related-episode
 * source rows in the provenance store. The bridge's load-bearing memories.
 */
export function formativeEpisodes(limit = 10): Array<{ episodeId: number; citations: number }> {
  try {
    // Direct DB query against provenance — count by source_id where
    // kind='related-episode'. Provenance store doesn't have a method
    // for this, so we attach via its private db via index access. Same
    // pattern as council.ts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (provenanceStore as any).db;
    if (!db) return [];
    const rows = db
      .prepare(
        `SELECT source_id, COUNT(*) AS n
            FROM provenance
            WHERE kind = 'related-episode' AND source_id IS NOT NULL
            GROUP BY source_id
            ORDER BY n DESC
            LIMIT ?`,
      )
      .all(limit) as Array<{ source_id: string; n: number }>;
    return rows
      .map((r: { source_id: string; n: number }) => ({ episodeId: parseInt(r.source_id, 10), citations: r.n }))
      .filter((r: { episodeId: number; citations: number }) => Number.isFinite(r.episodeId));
  } catch (err) {
    logger.debug({ err: String(err) }, 'formativeEpisodes failed');
    return [];
  }
}

/**
 * On-this-day: episodes from N years/months ago today.
 * Returns up to limit results sorted by anniversary distance.
 */
export function onThisDay(ep: EpisodicStore, limit = 5): Array<{ episodeId: number; createdAt: number; agoLabel: string }> {
  const now = new Date();
  const today = now.getDate();
  const month = now.getMonth();
  const eps = ep.listRecent(2000); // pull a wide window to find anniversaries
  const out: Array<{ episodeId: number; createdAt: number; agoLabel: string }> = [];
  for (const e of eps) {
    const d = new Date(e.created_at);
    if (d.getMonth() === month && d.getDate() === today) {
      const yearsAgo = now.getFullYear() - d.getFullYear();
      if (yearsAgo === 0) continue; // not really "on this day past"
      out.push({
        episodeId: e.id,
        createdAt: e.created_at,
        agoLabel: yearsAgo + 'y ago',
      });
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/**
 * Forgotten threads: high-value episodes (verified, costly, multi-turn)
 * not touched in 60+ days.
 */
export function forgottenThreads(ep: EpisodicStore, limit = 5): Array<{ episodeId: number; createdAt: number; reason: string; cost: number; turns: number }> {
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const eps = ep.listRecent(2000);
  const candidates = eps.filter((e) =>
    e.created_at < cutoff &&
    !e.outdated &&
    (e.verified_status === 'success' || (e.total_cost_usd ?? 0) > 0.10 || (e.num_turns ?? 0) > 5),
  );
  return candidates
    .sort((a, b) => (b.total_cost_usd || 0) - (a.total_cost_usd || 0))
    .slice(0, limit)
    .map((e) => ({
      episodeId: e.id,
      createdAt: e.created_at,
      reason:
        e.verified_status === 'success' ? 'verified ✓'
        : (e.total_cost_usd || 0) > 0.10 ? '$' + (e.total_cost_usd || 0).toFixed(2)
        : (e.num_turns || 0) + ' turns',
      cost: e.total_cost_usd ?? 0,
      turns: e.num_turns ?? 0,
    }));
}

/**
 * Random pull: a single random non-outdated episode.
 */
export function randomEpisode(ep: EpisodicStore): { episodeId: number } | null {
  const eps = ep.listRecent(500).filter((e) => !e.outdated);
  if (eps.length === 0) return null;
  const pick = eps[Math.floor(Math.random() * eps.length)];
  return { episodeId: pick.id };
}

/** TF-IDF deltas — emerging vs decaying terms. */
export function topicTrends(ep: EpisodicStore): { emerging: Array<{ term: string; recent: number; baseline: number }>; decaying: Array<{ term: string; recent: number; baseline: number }> } {
  const eps = ep.listRecent(800);
  const cutoffRecent = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recentDocs: string[] = [];
  const baselineDocs: string[] = [];
  for (const e of eps) {
    const txt = (e.user_text || '') + ' ' + (e.apex_summary || '');
    if (e.created_at >= cutoffRecent) recentDocs.push(txt);
    else baselineDocs.push(txt);
  }
  if (recentDocs.length < 3 || baselineDocs.length < 3) return { emerging: [], decaying: [] };
  const recentCounts = wordCounts(recentDocs);
  const baseCounts = wordCounts(baselineDocs);
  const emerging: Array<{ term: string; recent: number; baseline: number }> = [];
  const decaying: Array<{ term: string; recent: number; baseline: number }> = [];
  // Emerging: terms with high recent count and zero/low baseline
  for (const [term, n] of Array.from(recentCounts.entries()).sort((a, b) => b[1] - a[1])) {
    if (emerging.length >= 10) break;
    const base = baseCounts.get(term) ?? 0;
    if (n >= 3 && base <= n * 0.2) emerging.push({ term, recent: n, baseline: base });
  }
  for (const [term, n] of Array.from(baseCounts.entries()).sort((a, b) => b[1] - a[1])) {
    if (decaying.length >= 10) break;
    const recent = recentCounts.get(term) ?? 0;
    if (n >= 6 && recent <= n * 0.1) decaying.push({ term, recent, baseline: n });
  }
  return { emerging, decaying };
}

const STOP_WORDS = new Set([
  'the','a','an','and','or','of','in','on','at','to','for','with','by',
  'is','are','was','were','be','been','being','have','has','had','do',
  'does','did','can','could','should','would','will','shall','may','might',
  'must','if','then','else','than','that','this','these','those','it','its',
  'i','you','he','she','we','they','me','him','her','us','them','my','your',
  'his','its','our','their','what','which','who','whom','whose','where',
  'when','why','how','as','about','from','into','through','during','before',
  'after','above','below','between','under','over','because','since','while',
  'though','although','also','too','very','just','quite','really','only',
  'even','still','yet','already','always','never','often','sometimes','usually',
]);

function wordCounts(docs: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set<string>(); // count once per doc
    const words = (d.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []);
    for (const w of words) {
      if (STOP_WORDS.has(w) || seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return counts;
}

/** Persona-observation timeline from MEMORY.md notes. */
export interface PersonaObs {
  date: string;
  text: string;
  source: string;
}

export async function personaTimeline(homeMemoryFile: string): Promise<PersonaObs[]> {
  const fs = await import('fs/promises');
  try {
    const text = await fs.readFile(homeMemoryFile, 'utf8');
    const lines = text.split(/\r?\n/);
    const out: PersonaObs[] = [];
    for (const line of lines) {
      const m = line.match(/^- \[([^\]]+)\]\s+([\s\S]*?)(?:\s+_\(via .*?\)_)?$/);
      if (!m) continue;
      const [, date, body] = m;
      out.push({ date, text: body.trim(), source: 'MEMORY.md' });
    }
    return out;
  } catch {
    return [];
  }
}

/** Auto-bind episodes/parties into Volumes (one per UTC month). */
export interface Volume {
  id: string;             // YYYY-MM
  title: string;          // "Volume N · Month YYYY — <theme>"
  monthLabel: string;     // "April 2026"
  episodeIds: number[];
  partyIds: string[];
  startTs: number;
  endTs: number;
  topThemes: string[];
}

export function buildVolumes(ep: EpisodicStore): Volume[] {
  const eps = ep.listRecent(5000); // wide window for volumes
  const byMonth = new Map<string, { eps: typeof eps; min: number; max: number; texts: string[] }>();
  for (const e of eps) {
    const d = new Date(e.created_at);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const cur = byMonth.get(key) ?? { eps: [] as typeof eps, min: Infinity, max: -Infinity, texts: [] };
    cur.eps.push(e);
    cur.min = Math.min(cur.min, e.created_at);
    cur.max = Math.max(cur.max, e.created_at);
    cur.texts.push((e.user_text || '') + ' ' + (e.apex_summary || ''));
    byMonth.set(key, cur);
  }
  const out: Volume[] = [];
  let n = 0;
  const sorted = Array.from(byMonth.keys()).sort();
  for (const key of sorted) {
    n++;
    const v = byMonth.get(key)!;
    const themes = topThemes(v.texts, 3);
    const monthName = new Date(v.min).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    const themeStr = themes.length > 0 ? ' — *' + themes[0] + '*' : '';
    out.push({
      id: key,
      title: 'Volume ' + n + ' · ' + monthName + themeStr,
      monthLabel: monthName,
      episodeIds: v.eps.map((e) => e.id),
      partyIds: [],
      startTs: v.min,
      endTs: v.max,
      topThemes: themes,
    });
  }
  return out.reverse(); // newest first
}

function topThemes(docs: string[], k: number): string[] {
  const counts = wordCounts(docs);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));
}

/** Milestones: 1st, 100th, 1000th of various entity types. */
export function milestones(ep: EpisodicStore): Array<{ kind: string; ordinal: number; episodeId?: number; ts: number; label: string }> {
  const eps = ep.listRecent(5000).slice().reverse(); // oldest first
  const out: Array<{ kind: string; ordinal: number; episodeId?: number; ts: number; label: string }> = [];
  const targets = [1, 100, 1000, 10000];
  for (const t of targets) {
    if (eps.length >= t) {
      const e = eps[t - 1];
      out.push({
        kind: 'episode',
        ordinal: t,
        episodeId: e.id,
        ts: e.created_at,
        label: ordinalLabel(t) + ' episode',
      });
    }
  }
  return out;
}

function ordinalLabel(n: number): string {
  if (n === 1) return '1st';
  if (n === 100) return '100th';
  if (n === 1000) return '1000th';
  return n + 'th';
}
