import path from 'path';
import fs from 'fs/promises';
import type { SessionStore, Session } from '../session/store';
import type { EpisodicStore, Episode } from '../memory/episodic';
import { partyStore, type PartyRunRow, type PartyMessageRow } from '../party/store';
import { AGENTS, type AgentRole } from '../party/agents';

/**
 * The universal entity model that drives the dashboard's recursive
 * EntityCard primitive. One resolver per entity type, all the same
 * shape. The frontend treats every node as type-agnostic; this file
 * is where each type knows itself.
 *
 * Step 1 covers four types: session, episode, party (placeholder),
 * skill. Later steps add party-agent-message, scheduled-run,
 * skill-draft, reflection, memory-note, persona-file, tool-call,
 * reaction. Each new type just registers a renderer; the EntityCard
 * component itself never changes.
 */

export type EntityType =
  | 'session'
  | 'episode'
  | 'party'
  | 'party-message'
  | 'skill'
  | 'persona-file'
  | 'memory-note';

export interface EntityRef {
  type: EntityType;
  id: string;
}

export type StatusTone = 'good' | 'warn' | 'bad' | 'dim';

export interface EntityMeta {
  type: EntityType;
  id: string;
  /** Single-glyph icon — emoji or unicode. Cheap to render, instantly readable. */
  icon: string;
  title: string;
  statusPill?: { text: string; tone: StatusTone };
  metaStrip: { key: string; value: string }[];
  /** Long-form preview text. Rendered with whitespace preserved. */
  preview: string;
  actions: { label: string; href?: string }[];
}

export interface ChildGroup {
  /** Display label for this group, e.g. "episodes" or "agent messages". */
  label: string;
  refs: EntityRef[];
}

/** Search hit — a typed reference plus a relevance hint for sorting/UI. */
export interface SearchHit {
  ref: EntityRef;
  /** Optional preview snippet (first 200 chars where the match was). */
  snippet?: string;
}

export interface SearchResults {
  query: string;
  /** Hits grouped by type, in fixed order. */
  groups: { type: EntityType; hits: SearchHit[] }[];
  total: number;
}

/**
 * Type-dispatched resolver. The dashboard server calls these three
 * methods over HTTP per entity. Each method soft-fails to null/[]
 * rather than throwing so the dashboard can render an "unknown" card
 * gracefully instead of breaking the whole tab.
 */
export class EntityResolver {
  constructor(
    private readonly session: SessionStore,
    private readonly episodic: EpisodicStore | undefined,
    private readonly bridgeRepoRoot: string,
  ) {}

  async meta(ref: EntityRef): Promise<EntityMeta | null> {
    try {
      switch (ref.type) {
        case 'session':         return this.sessionMeta(ref.id);
        case 'episode':         return this.episodeMeta(parseInt(ref.id, 10));
        case 'party':           return this.partyMeta(ref.id);
        case 'party-message':   return this.partyMessageMeta(parseInt(ref.id, 10));
        case 'skill':           return this.skillMeta(ref.id);
        case 'persona-file':    return this.personaFileMeta(ref.id);
        case 'memory-note':     return this.memoryNoteMeta(ref.id);
        default:                return null;
      }
    } catch {
      return null;
    }
  }

  async children(ref: EntityRef): Promise<ChildGroup[]> {
    try {
      switch (ref.type) {
        case 'session':         return this.sessionChildren(ref.id);
        case 'episode':         return this.episodeChildren(parseInt(ref.id, 10));
        case 'party':           return this.partyChildren(ref.id);
        case 'party-message':   return [];
        case 'skill':           return [];
        case 'persona-file':    return [];
        case 'memory-note':     return [];
        default:                return [];
      }
    } catch {
      return [];
    }
  }

  async parents(ref: EntityRef): Promise<EntityRef[]> {
    try {
      switch (ref.type) {
        case 'episode': {
          if (!this.episodic) return [];
          const ep = this.episodic.findById(parseInt(ref.id, 10));
          return ep ? [{ type: 'session', id: ep.thread_key }] : [];
        }
        case 'party': {
          const p = partyStore.getRun(ref.id);
          if (!p) return [];
          const out: EntityRef[] = [{ type: 'session', id: p.thread_key }];
          if (p.parent_party_id) out.unshift({ type: 'party', id: p.parent_party_id });
          return out;
        }
        case 'memory-note': {
          // Memory notes carry a "_(via X in Y)_" trailer where Y is a
          // channel name. Best-effort link to most recent session in
          // that channel.
          const meta = await this.memoryNoteMeta(ref.id);
          if (!meta) return [];
          const channelMatch = meta.preview.match(/_\(via [^ ]+ in ([^)]+)\)_/);
          if (!channelMatch) return [];
          const channelName = channelMatch[1].trim();
          const candidates = this.session
            .listIdleNeedingReflection(0)
            .filter((s) => (s.channel_name ?? '').toLowerCase() === channelName.toLowerCase());
          if (candidates.length === 0) return [];
          // newest first
          candidates.sort((a, b) => b.last_used - a.last_used);
          return [{ type: 'session', id: candidates[0].thread_key }];
        }
        default: return [];
      }
    } catch {
      return [];
    }
  }

  /**
   * Backlinks — what references this entity. Returns the same ChildGroup
   * shape so the dashboard renders backlinks with recursive EntityCards
   * just like children.
   */
  async backlinks(ref: EntityRef): Promise<ChildGroup[]> {
    try {
      switch (ref.type) {
        case 'session':  return this.sessionBacklinks(ref.id);
        case 'episode':  return this.episodeBacklinks(parseInt(ref.id, 10));
        case 'party':    return this.partyBacklinks(ref.id);
        case 'skill':    return [];
        default:         return [];
      }
    } catch {
      return [];
    }
  }

  /**
   * Universal search across all entity types. Filters via `types` if
   * provided. Returns up to 20 hits per type, ordered by recency.
   */
  async search(opts: {
    query: string;
    types?: EntityType[];
    perTypeLimit?: number;
  }): Promise<SearchResults> {
    const q = opts.query.trim();
    const types = opts.types ?? ['session', 'episode', 'party', 'skill'];
    const perType = opts.perTypeLimit ?? 20;
    const groups: SearchResults['groups'] = [];
    let total = 0;
    for (const t of types) {
      let hits: SearchHit[] = [];
      try {
        if (t === 'session') hits = this.searchSessions(q, perType);
        else if (t === 'episode') hits = this.searchEpisodes(q, perType);
        else if (t === 'party') hits = this.searchParties(q, perType);
        else if (t === 'skill') hits = await this.searchSkills(q, perType);
      } catch {
        hits = [];
      }
      if (hits.length > 0) {
        groups.push({ type: t, hits });
        total += hits.length;
      }
    }
    return { query: q, groups, total };
  }

  // ── backlinks resolvers ────────────────────────────────────────────

  private sessionBacklinks(threadKey: string): ChildGroup[] {
    const groups: ChildGroup[] = [];
    // Parties that ran in this thread.
    try {
      const parties = partyStore
        .listRecent(200)
        .filter((p) => p.thread_key === threadKey);
      if (parties.length > 0) {
        groups.push({
          label: 'parties in this thread',
          refs: parties.map((p) => ({ type: 'party' as const, id: p.id })),
        });
      }
    } catch {
      /* table may not exist on older bridges */
    }
    return groups;
  }

  private episodeBacklinks(id: number): ChildGroup[] {
    const groups: ChildGroup[] = [];
    if (!this.episodic) return groups;
    const ep = this.episodic.findById(id);
    if (!ep) return groups;

    // Same-thread sibling episodes (read as "context: other turns in
    // this thread"). Cheap and useful — embedding-similarity neighbors
    // would be richer but we'd need to load the model here; the
    // dashboard server is not the place. Defer to a later step if
    // founder finds the absence painful.
    const siblings = this.episodic
      .listByThread(ep.thread_key)
      .filter((e) => e.id !== id);
    if (siblings.length > 0) {
      groups.push({
        label: 'siblings in same thread',
        refs: siblings.map((e) => ({
          type: 'episode' as const,
          id: String(e.id),
        })),
      });
    }
    return groups;
  }

  private partyBacklinks(id: string): ChildGroup[] {
    const groups: ChildGroup[] = [];
    const p = partyStore.getRun(id);
    if (!p) return groups;
    return groups;
  }

  // ── search resolvers ───────────────────────────────────────────────

  private searchSessions(q: string, limit: number): SearchHit[] {
    if (!q) return [];
    const recent = this.session
      .listIdleNeedingReflection(0)
      .slice(0, 200);
    const lc = q.toLowerCase();
    const hits: SearchHit[] = [];
    for (const s of recent) {
      const blob =
        `${s.thread_key} ${s.first_peer_id ?? ''} ${s.channel_name ?? ''} ${s.channel_id ?? ''}`.toLowerCase();
      if (blob.includes(lc)) {
        hits.push({
          ref: { type: 'session', id: s.thread_key },
          snippet: `${s.channel_name ?? s.channel_id ?? '?'} · ${s.first_peer_id ?? '?'}`,
        });
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  private searchEpisodes(q: string, limit: number): SearchHit[] {
    if (!q || !this.episodic) return [];
    const recent = this.episodic.listRecent(500);
    const lc = q.toLowerCase();
    const hits: SearchHit[] = [];
    for (const e of recent) {
      const u = (e.user_text || '').toLowerCase();
      const a = (e.apex_summary || '').toLowerCase();
      if (u.includes(lc) || a.includes(lc)) {
        const matchInUser = u.includes(lc);
        const src = matchInUser ? e.user_text : e.apex_summary;
        const idx = src.toLowerCase().indexOf(lc);
        const start = Math.max(0, idx - 50);
        const end = Math.min(src.length, idx + lc.length + 100);
        const snippet =
          (start > 0 ? '…' : '') +
          src.slice(start, end).replace(/\s+/g, ' ').trim() +
          (end < src.length ? '…' : '');
        hits.push({
          ref: { type: 'episode', id: String(e.id) },
          snippet,
        });
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  private searchParties(q: string, limit: number): SearchHit[] {
    if (!q) return [];
    let recent: PartyRunRow[];
    try {
      recent = partyStore.listRecent(200);
    } catch {
      return [];
    }
    const lc = q.toLowerCase();
    const hits: SearchHit[] = [];
    for (const p of recent) {
      const blob = `${p.id} ${p.topic} ${p.template} ${p.mode}`.toLowerCase();
      if (blob.includes(lc)) {
        hits.push({
          ref: { type: 'party', id: p.id },
          snippet: p.topic.slice(0, 200),
        });
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  private async searchSkills(q: string, limit: number): Promise<SearchHit[]> {
    if (!q) return [];
    const skillsDir = path.join(this.bridgeRepoRoot, '.claude', 'skills');
    let entries: string[];
    try {
      entries = await fs.readdir(skillsDir);
    } catch {
      return [];
    }
    const lc = q.toLowerCase();
    const hits: SearchHit[] = [];
    for (const slug of entries) {
      if (hits.length >= limit) break;
      if (slug.toLowerCase().includes(lc)) {
        hits.push({ ref: { type: 'skill', id: slug } });
        continue;
      }
      // Search inside SKILL.md
      try {
        const filePath = path.join(skillsDir, slug, 'SKILL.md');
        const content = await fs.readFile(filePath, 'utf8');
        const lcContent = content.toLowerCase();
        const idx = lcContent.indexOf(lc);
        if (idx >= 0) {
          const start = Math.max(0, idx - 50);
          const end = Math.min(content.length, idx + lc.length + 100);
          const snippet =
            (start > 0 ? '…' : '') +
            content.slice(start, end).replace(/\s+/g, ' ').trim() +
            (end < content.length ? '…' : '');
          hits.push({ ref: { type: 'skill', id: slug }, snippet });
        }
      } catch {
        /* skill dir might not have a SKILL.md; skip */
      }
    }
    return hits;
  }

  // ── per-type renderers ─────────────────────────────────────────

  private sessionMeta(threadKey: string): EntityMeta | null {
    const s = this.session.get(threadKey);
    if (!s) return null;
    const channelLabel = s.channel_name ?? s.channel_id ?? 'unknown';
    const peer = s.first_peer_id ?? '?';
    const reflectedTone: StatusTone = s.reflection_run_at ? 'dim' : 'good';
    const reflectedText = s.reflection_run_at ? 'reflected' : 'live';
    return {
      type: 'session',
      id: threadKey,
      icon: '💬',
      title: `${channelLabel} · ${peer}`,
      statusPill: { text: reflectedText, tone: reflectedTone },
      metaStrip: [
        { key: 'turns', value: String(s.num_turns) },
        { key: 'cost', value: `$${s.total_cost_usd.toFixed(4)}` },
        { key: 'last', value: relTime(s.last_used) },
      ],
      preview: this.firstUserText(threadKey),
      actions: slackActions(s.channel_id, s.thread_ts),
    };
  }

  private firstUserText(threadKey: string): string {
    if (!this.episodic) return '';
    const eps = this.episodic.listByThread(threadKey);
    if (eps.length === 0) return '';
    const first = eps[0];
    return `${first.user_text.slice(0, 240)}${first.user_text.length > 240 ? '…' : ''}`;
  }

  private sessionChildren(threadKey: string): ChildGroup[] {
    if (!this.episodic) return [];
    const eps = this.episodic.listByThread(threadKey);
    if (eps.length === 0) return [];
    return [{
      label: 'episodes',
      refs: eps.map((e) => ({ type: 'episode' as const, id: String(e.id) })),
    }];
  }

  private episodeMeta(id: number): EntityMeta | null {
    if (!this.episodic) return null;
    const ep = this.episodic.findById(id);
    if (!ep) return null;
    const verifiedTone: StatusTone =
      ep.outdated ? 'dim'
      : ep.verified_status === 'success' ? 'good'
      : ep.verified_status === 'failure' ? 'bad'
      : 'dim';
    const verifiedText =
      ep.outdated ? '🗑️ outdated'
      : ep.verified_status === 'success' ? '✅ verified'
      : ep.verified_status === 'failure' ? '❌ failed'
      : '—';
    const cleanText = (ep.user_text || '').replace(/\s+/g, ' ').trim();
    return {
      type: 'episode',
      id: String(id),
      icon: '📝',
      title: cleanText.slice(0, 80) || `episode #${id}`,
      statusPill: { text: verifiedText, tone: verifiedTone },
      metaStrip: [
        { key: 'peer', value: ep.sender_peer },
        { key: 'turns', value: String(ep.num_turns) },
        { key: 'cost', value: `$${ep.total_cost_usd.toFixed(4)}` },
        { key: 'time', value: relTime(ep.created_at) },
      ],
      preview:
        `user: ${ep.user_text.slice(0, 320)}` +
        (ep.user_text.length > 320 ? '…' : '') +
        '\n\n' +
        `apex: ${ep.apex_summary.slice(0, 320)}` +
        (ep.apex_summary.length > 320 ? '…' : ''),
      actions: slackActions(ep.slack_channel_id, ep.slack_message_ts),
    };
  }

  private partyMeta(id: string): EntityMeta | null {
    let p: PartyRunRow | null;
    try {
      p = partyStore.getRun(id);
    } catch {
      p = null;
    }
    if (!p) return null;
    const tone: StatusTone =
      p.outcome === 'success' ? 'good'
      : p.outcome === 'running' ? 'warn'
      : p.outcome === 'over_budget' || p.outcome === 'aborted' ? 'dim'
      : 'bad';
    let roster: AgentRole[] = [];
    try {
      const parsed = JSON.parse(p.roster_json);
      if (Array.isArray(parsed)) roster = parsed as AgentRole[];
    } catch { /* ignore */ }
    const rosterStr = roster.map((r) => AGENTS[r]?.display ?? r).join(', ');
    return {
      type: 'party',
      id,
      icon: '🎭',
      title: p.topic.slice(0, 80),
      statusPill: { text: p.outcome, tone },
      metaStrip: [
        { key: 'mode', value: p.mode },
        { key: 'template', value: p.template },
        { key: 'rounds', value: String(p.rounds) },
        { key: 'cost', value: `$${p.total_cost_usd.toFixed(4)}` },
        { key: 'time', value: relTime(p.started_at) },
      ],
      preview: `roster: ${rosterStr || '(unknown)'}\ntopic: ${p.topic}`,
      actions: [],
    };
  }

  private partyChildren(id: string): ChildGroup[] {
    const groups: ChildGroup[] = [];
    let messages: PartyMessageRow[] = [];
    try { messages = partyStore.listMessages(id); } catch { messages = []; }
    if (messages.length > 0) {
      groups.push({
        label: 'agent messages',
        refs: messages.map((m) => ({
          type: 'party-message' as const,
          id: String(m.id),
        })),
      });
    }
    // Sub-parties spawned by master synthesis (Phase D)
    let children: PartyRunRow[] = [];
    try { children = partyStore.listChildren(id); } catch { children = []; }
    if (children.length > 0) {
      groups.push({
        label: 'sub-parties',
        refs: children.map((p) => ({ type: 'party' as const, id: p.id })),
      });
    }
    return groups;
  }

  /** Neighbors-by-cosine for episode children; lazy K=5. */
  private episodeChildren(id: number): ChildGroup[] {
    if (!this.episodic) return [];
    try {
      const neighbors = this.episodic.nearestForEpisode(id, 5);
      if (neighbors.length === 0) return [];
      return [{
        label: 'cosine-similar episodes',
        refs: neighbors.map((n) => ({ type: 'episode' as const, id: String(n.id) })),
      }];
    } catch {
      return [];
    }
  }

  private partyMessageMeta(id: number): EntityMeta | null {
    // Single-row lookup by scanning recent parties' messages.
    // Cheap because party_messages.id is small-cardinality. If this
    // gets slow, add a direct findById to the party store.
    const recent = partyStore.listRecent(60);
    for (const p of recent) {
      const msgs = partyStore.listMessages(p.id);
      const m = msgs.find((x) => x.id === id);
      if (m) {
        const a = AGENTS[m.agent_role as AgentRole];
        const display = a?.display ?? m.agent_role;
        const icon = a?.emoji ? mapEmojiToGlyph(a.emoji) : '🎭';
        const conf = m.confidence !== null
          ? { text: `conf ${m.confidence.toFixed(2)}`, tone: m.confidence > 0.7 ? 'good' : m.confidence > 0.4 ? 'warn' : 'bad' as const }
          : undefined;
        return {
          type: 'party-message',
          id: String(id),
          icon,
          title: `${display} — round ${m.round_number}`,
          statusPill: conf as StatusTone extends never ? never : { text: string; tone: StatusTone } | undefined,
          metaStrip: [
            { key: 'cost', value: `$${m.cost_usd.toFixed(4)}` },
            { key: 'duration', value: `${(m.duration_ms / 1000).toFixed(1)}s` },
            { key: 'time', value: relTime(m.created_at) },
          ],
          preview: m.content,
          actions: m.slack_message_ts
            ? slackActions(p.thread_key.split(':')[0], m.slack_message_ts)
            : [],
        };
      }
    }
    return null;
  }

  // ── persona-file ──────────────────────────────────────────────────
  // id = `<group>/<filename>` e.g. `apex/SOUL.md` or `aether/RULES.md`.

  private async personaFileMeta(id: string): Promise<EntityMeta | null> {
    // Defensive: only allow safe relative paths inside persona/.
    if (id.includes('..') || path.isAbsolute(id)) return null;
    const filePath = path.join(this.bridgeRepoRoot, '..', '..', 'persona', id);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
    const firstLine = (content.split('\n').find((l) => l.trim().length > 0) ?? '').trim();
    const stripped = firstLine.replace(/^#+\s*/, '');
    const preview = content.split('\n').slice(0, 30).join('\n');
    const segments = id.split('/');
    const group = segments[0] ?? 'persona';
    return {
      type: 'persona-file',
      id,
      icon: '📜',
      title: stripped || segments[segments.length - 1],
      statusPill: { text: group, tone: 'dim' },
      metaStrip: [
        { key: 'lines', value: String(content.split('\n').length) },
        { key: 'bytes', value: String(content.length) },
      ],
      preview: preview + (content.length > preview.length ? '\n…' : ''),
      actions: [],
    };
  }

  /** Top-level browse helper for the explorer: list all persona files. */
  async listPersonaFiles(): Promise<EntityRef[]> {
    const personaRoot = path.join(this.bridgeRepoRoot, '..', '..', 'persona');
    const out: EntityRef[] = [];
    let groups: string[];
    try { groups = await fs.readdir(personaRoot); } catch { return []; }
    for (const g of groups) {
      let entries: string[];
      try { entries = await fs.readdir(path.join(personaRoot, g)); } catch { continue; }
      for (const f of entries) {
        if (f.endsWith('.md')) out.push({ type: 'persona-file', id: `${g}/${f}` });
      }
    }
    return out;
  }

  // ── memory-note ───────────────────────────────────────────────────
  // id = a base64url-encoded line index into MEMORY.md, prefixed with
  // line number for stability across rotation. Cheap and stateless.

  private async memoryNoteMeta(id: string): Promise<EntityMeta | null> {
    const memoryFile = path.join(
      // ~/.claude/projects/Thoth/memory/MEMORY.md — matches writers/memory.ts
      process.env.HOME || process.env.USERPROFILE || '',
      '.claude', 'projects', 'Thoth', 'memory', 'MEMORY.md',
    );
    let text: string;
    try { text = await fs.readFile(memoryFile, 'utf8'); } catch { return null; }
    const lines = text.split('\n').filter((l) => l.startsWith('- ['));
    const idx = parseInt(id, 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length) return null;
    const line = lines[idx];
    const dateMatch = line.match(/^- \[([^\]]+)\]\s+([\s\S]*)$/);
    const date = dateMatch ? dateMatch[1] : '?';
    const body = dateMatch ? dateMatch[2] : line;
    const channelMatch = body.match(/_\(via [^ ]+ in ([^)]+)\)_$/);
    return {
      type: 'memory-note',
      id,
      icon: '🧠',
      title: body.replace(/_\(via [^)]+\)_$/, '').trim().slice(0, 80) || `note ${idx}`,
      statusPill: { text: date, tone: 'dim' },
      metaStrip: channelMatch ? [{ key: 'channel', value: channelMatch[1].trim() }] : [],
      preview: body,
      actions: [],
    };
  }

  /** All memory-note refs in the current MEMORY.md file. */
  async listMemoryNotes(): Promise<EntityRef[]> {
    const memoryFile = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.claude', 'projects', 'Thoth', 'memory', 'MEMORY.md',
    );
    let text: string;
    try { text = await fs.readFile(memoryFile, 'utf8'); } catch { return []; }
    const lines = text.split('\n').filter((l) => l.startsWith('- ['));
    return lines.map((_, i) => ({ type: 'memory-note' as const, id: String(i) }));
  }

  private async skillMeta(slug: string): Promise<EntityMeta | null> {
    const filePath = path.join(
      this.bridgeRepoRoot,
      '.claude',
      'skills',
      slug,
      'SKILL.md',
    );
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
    // Parse minimal frontmatter — `description: …` line.
    const descMatch = content.match(/^description:\s*(.+)$/m);
    const description = descMatch ? descMatch[1].trim() : '';
    const allowedToolsMatch = content.match(/^allowed-tools:\s*(.+)$/m);
    const allowedTools = allowedToolsMatch ? allowedToolsMatch[1].trim() : '';
    return {
      type: 'skill',
      id: slug,
      icon: '🛠️',
      title: slug,
      metaStrip: allowedTools
        ? [{ key: 'tools', value: allowedTools.slice(0, 60) }]
        : [],
      preview: description || '_(no description in frontmatter)_',
      actions: [],
    };
  }
}

// ── helpers ────────────────────────────────────────────────────────

function relTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function slackActions(
  channelId: string | null,
  ts: string | null,
): EntityMeta['actions'] {
  if (!channelId || !ts) return [];
  return [
    {
      label: 'view in Slack',
      href: `https://slack.com/archives/${channelId}/p${ts.replace('.', '')}`,
    },
  ];
}

/** Convert a Slack-emoji shortcode to a single Unicode glyph for the dashboard. */
function mapEmojiToGlyph(slackName: string): string {
  const m: Record<string, string> = {
    bar_chart: '📊',
    clipboard: '📋',
    classical_building: '🏛️',
    hammer_and_pick: '⚒️',
    test_tube: '🧪',
    art: '🎨',
    performing_arts: '🎭',
  };
  return m[slackName] ?? '🎭';
}
