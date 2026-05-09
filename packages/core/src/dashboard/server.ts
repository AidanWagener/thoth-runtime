import http from 'http';
import { eventBus, type DashboardEvent } from './event-bus';
import { renderDashboardHtml } from './ui';
import { EntityResolver, type EntityType, type EntityRef } from './entity';
import type { SessionStore } from '../session/store';
import type { EpisodicStore } from '../memory/episodic';
import type { HonchoClient } from '../memory/honcho';
import type { Allowlist } from '../policy/allowlist';
import { skillDraftStore, type SkillDraftRow } from '../skills/store';
import { scheduledRunStore, type ScheduledRunRow } from '../scheduling/store';
import { dailyCostCap } from '../reflection/daily-cap';
import { partyStore } from '../party/store';
import { partyDailyCap } from '../party/budget';
import type { AnthropicStatusMonitor } from '../status/anthropic-status';
import type { AmbientAgent } from '../ambient/triggers';
import type { PartyOrchestrator, PartyMode } from '../party/orchestrator';
import type { AgentRole } from '../party/agents';
import { AGENTS, parseRoster as parseAgentRoster } from '../party/agents';
import { buildCouncilSnapshot, buildAffinityMatrix } from './council';
import { buildCosmosSnapshot } from './cosmos';
import {
  semanticSearch,
  formativeEpisodes,
  onThisDay,
  forgottenThreads,
  randomEpisode,
  topicTrends,
  buildVolumes,
  milestones,
  personaTimeline,
} from './akashic';
import { eventArchive } from './event-archive';
import { provenanceStore } from '../provenance/store';
import { logger } from '../logger';

const VALID_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  'session',
  'episode',
  'party',
  'party-message',
  'skill',
  'persona-file',
  'memory-note',
]);

/**
 * Local-only HTTP dashboard for Thoth.
 *
 * Hard-bound to 127.0.0.1 — no external attack surface. Runs Node's
 * built-in `http`, no extra deps. Routes:
 *
 *   GET /                   → embedded HTML SPA (renderDashboardHtml)
 *   GET /api/status         → snapshot JSON: layers, today, counts, peers
 *   GET /api/sessions       → currently-active sessions (with metadata)
 *   GET /api/episodes/recent → last 30 episodes (lightweight projection)
 *   GET /api/drafts         → skill_drafts (pending + recent decisions)
 *   GET /api/scheduled      → scheduled_runs (pending + recently fired)
 *   GET /api/events         → SSE stream of live DashboardEvents
 *   GET /api/events/recent  → last 100 buffered DashboardEvents
 */

export interface DashboardDeps {
  bridgeVersion: string;
  startedAt: number;
  config: {
    HONCHO_WORKSPACE_ID: string;
    HONCHO_DISABLED: boolean;
    EPISODIC_DISABLED: boolean;
    REFLECTION_DISABLED: boolean;
    REFLECTION_IDLE_MIN: number;
    REFLECTION_DAILY_CAP_USD: number;
    DASHBOARD_PORT: number;
    DASHBOARD_BIND: string;
  };
  sessionStore: SessionStore;
  episodic?: EpisodicStore;
  honcho?: HonchoClient;
  allowlist: Allowlist;
  bridgeRepoRoot: string;
  anthropicStatus?: AnthropicStatusMonitor;
  ambientAgent?: AmbientAgent;
  partyOrchestrator?: PartyOrchestrator;
  /** Slack WebClient — used by /api/council/convene to fire a party. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slackClient?: any;
  /** Channel ID where dashboard-fired parties land (env var). */
  councilChannelId?: string | null;
  partyDailyCapUsd?: number;
}

const SSE_RETRY_MS = 5000;

export class DashboardServer {
  private server: http.Server | null = null;
  private sseClients = new Set<http.ServerResponse>();
  private busHandler: ((e: DashboardEvent) => void) | null = null;
  private readonly entityResolver: EntityResolver;

  constructor(private readonly deps: DashboardDeps) {
    this.entityResolver = new EntityResolver(
      deps.sessionStore,
      deps.episodic,
      deps.bridgeRepoRoot,
    );
  }

  async start(): Promise<void> {
    if (this.server) return;

    this.server = http.createServer((req, res) => this.handle(req, res));

    // Subscribe to the event bus once and fan out to all connected SSE clients.
    this.busHandler = (e: DashboardEvent) => {
      const payload = `data: ${JSON.stringify(e)}\n\n`;
      for (const client of this.sseClients) {
        try {
          client.write(payload);
        } catch {
          // dead socket; will be cleaned up on close
        }
      }
    };
    eventBus.on('event', this.busHandler);

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(
        this.deps.config.DASHBOARD_PORT,
        this.deps.config.DASHBOARD_BIND,
        () => {
          this.server!.removeListener('error', reject);
          resolve();
        },
      );
    });

    logger.info(
      {
        url: this.url(),
        clients: 0,
        sseRetryMs: SSE_RETRY_MS,
      },
      'dashboard online',
    );
  }

  async stop(): Promise<void> {
    if (this.busHandler) {
      eventBus.off('event', this.busHandler);
      this.busHandler = null;
    }
    for (const c of this.sseClients) {
      try {
        c.end();
      } catch {
        // ignore
      }
    }
    this.sseClients.clear();
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }

  url(): string {
    return `http://${this.deps.config.DASHBOARD_BIND}:${this.deps.config.DASHBOARD_PORT}`;
  }

  // ── Routing ─────────────────────────────────────────────────────────

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Defensive — only accept loopback. Even though we bind 127.0.0.1,
    // belt-and-suspenders.
    const remote = req.socket.remoteAddress ?? '';
    if (!remote.includes('127.0.0.1') && !remote.includes('::1')) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }

    const url = req.url ?? '/';
    const method = req.method ?? 'GET';
    // POST is allowed for convene + narrate; everything else GET-only.
    if (method !== 'GET' && !(method === 'POST' && (url === '/api/council/convene' || url === '/api/akashic/narrate'))) {
      res.statusCode = 405;
      res.end('method not allowed');
      return;
    }

    try {
      if (url === '/' || url === '/index.html') return this.serveHtml(res);
      if (url === '/api/status') return this.serveJson(res, this.snapshotStatus());
      if (url === '/api/sessions') return this.serveJson(res, this.snapshotSessions());
      if (url === '/api/episodes/recent') return this.serveJson(res, this.snapshotRecentEpisodes());
      if (url === '/api/drafts') return this.serveJson(res, this.snapshotDrafts());
      if (url === '/api/scheduled') return this.serveJson(res, this.snapshotScheduled());
      if (url === '/api/events/recent') return this.serveJson(res, eventBus.recent(200));
      if (url === '/api/events') return this.serveSse(req, res);
      if (url.startsWith('/api/entity/')) return void this.serveEntity(url, res);
      if (url.startsWith('/api/search')) return void this.serveSearch(url, res);
      if (url === '/api/parties/recent') return this.serveJson(res, this.snapshotRecentParties());
      if (url === '/api/personas') return void this.servePersonas(res);
      if (url === '/api/memory-notes') return void this.serveMemoryNotes(res);
      if (url === '/api/anthropic-status') return this.serveJson(res, this.snapshotAnthropicStatus());
      if (url.startsWith('/api/events/aggregate')) return this.serveEventAggregate(url, res);
      if (url.startsWith('/api/provenance/episode/')) return this.serveProvenance(url, res);
      if (url === '/api/cosmos') return void this.serveCosmos(res);
      if (url === '/api/ambient') return this.serveJson(res, this.snapshotAmbient());
      if (url === '/api/skills/registry') return void this.serveSkillsRegistry(res);
      if (url === '/api/council/snapshot') return void this.serveCouncilSnapshot(res);
      if (url.startsWith('/api/akashic/semantic-search')) return void this.serveAkashicSemanticSearch(url, res);
      if (url === '/api/akashic/digest') return this.serveJson(res, this.snapshotAkashicDigest());
      if (url === '/api/akashic/random') return this.serveJson(res, this.deps.episodic ? randomEpisode(this.deps.episodic) ?? { episodeId: null } : { episodeId: null });
      if (url === '/api/akashic/volumes') return this.serveJson(res, this.deps.episodic ? { volumes: buildVolumes(this.deps.episodic) } : { volumes: [] });
      if (url === '/api/akashic/persona-timeline') return void this.serveAkashicPersonaTimeline(res);
      if (url === '/api/akashic/narrate' && method === 'POST') return void this.serveAkashicNarrate(req, res);
      if (url === '/api/council/affinity') return this.serveJson(res, buildAffinityMatrix());
      if (url === '/api/council/convene' && method === 'POST') return void this.serveCouncilConvene(req, res);
      if (url === '/api/events/heatmap') return this.serveJson(res, { days: eventArchive.dailyActivity(365) });
      if (url.startsWith('/api/persona-stack')) return void this.servePersonaStack(url, res);
      if (url.startsWith('/assets/')) return void this.serveAsset(url, res);
      res.statusCode = 404;
      res.end('not found');
    } catch (err) {
      logger.error({ err: String(err), url }, 'dashboard handler threw');
      res.statusCode = 500;
      res.end('internal error');
    }
  }

  private serveHtml(res: http.ServerResponse): void {
    const html = renderDashboardHtml({
      bridgeVersion: this.deps.bridgeVersion,
    });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(html);
  }

  private serveJson(res: http.ServerResponse, body: unknown): void {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify(body));
  }

  /**
   * Static-asset route. Serves files from `services/slack-bridge/assets/`,
   * whitelisted by extension and with hard path-traversal protection.
   * Caches aggressively (assets are content-hashed by virtue of being
   * checked into git — bumping a logo is a deploy, not a hotfix).
   */
  private async serveAsset(url: string, res: http.ServerResponse): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const requested = url.replace(/^\/assets\//, '').split('?')[0];
    if (
      !requested ||
      requested.includes('..') ||
      requested.includes('/') ||
      requested.includes('\\') ||
      !/^[a-zA-Z0-9._-]+\.(png|svg|webp|ico)$/.test(requested)
    ) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const fp = path.join(this.deps.bridgeRepoRoot, 'assets', requested);
    let buf: Buffer;
    try {
      buf = await fs.readFile(fp);
    } catch {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const ext = requested.slice(requested.lastIndexOf('.') + 1).toLowerCase();
    const mime: Record<string, string> = {
      png: 'image/png',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      ico: 'image/x-icon',
    };
    res.writeHead(200, {
      'Content-Type': mime[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400, immutable',
      'Content-Length': String(buf.length),
    });
    res.end(buf);
  }

  /**
   * Routes:
   *   GET /api/entity/:type/:id           → meta
   *   GET /api/entity/:type/:id/children  → ChildGroup[]
   *   GET /api/entity/:type/:id/parents   → EntityRef[]
   */
  private async serveEntity(url: string, res: http.ServerResponse): Promise<void> {
    const noQuery = url.split('?')[0];
    const parts = noQuery.split('/').filter(Boolean); // ['api','entity',type,id,sub?]
    if (parts.length < 4) {
      res.statusCode = 400;
      res.end('bad entity url');
      return;
    }
    const typeRaw = parts[2];
    if (!VALID_ENTITY_TYPES.has(typeRaw as EntityType)) {
      res.statusCode = 400;
      res.end('unknown entity type');
      return;
    }
    const ref: EntityRef = {
      type: typeRaw as EntityType,
      id: decodeURIComponent(parts[3]),
    };
    const sub = parts[4];

    let body: unknown;
    if (sub === 'children') body = await this.entityResolver.children(ref);
    else if (sub === 'parents') body = await this.entityResolver.parents(ref);
    else if (sub === 'backlinks') body = await this.entityResolver.backlinks(ref);
    else if (!sub) body = await this.entityResolver.meta(ref);
    else {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    if (body === null) {
      res.statusCode = 404;
      res.end('entity not found');
      return;
    }
    this.serveJson(res, body);
  }

  /**
   * Universal search endpoint.
   *   GET /api/search?q=foo&types=session,episode,party,skill
   * Empty `q` short-circuits to empty results.
   */
  private async serveSearch(url: string, res: http.ServerResponse): Promise<void> {
    const queryStr = url.split('?')[1] ?? '';
    const params = new URLSearchParams(queryStr);
    const q = (params.get('q') ?? '').trim();
    const typesRaw = (params.get('types') ?? '').trim();
    const types = typesRaw
      ? typesRaw
          .split(',')
          .map((t) => t.trim())
          .filter((t): t is EntityType => VALID_ENTITY_TYPES.has(t as EntityType))
      : undefined;
    if (!q) {
      this.serveJson(res, { query: q, groups: [], total: 0 });
      return;
    }
    const out = await this.entityResolver.search({ query: q, types });
    this.serveJson(res, out);
  }

  private serveSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Tell the browser how long to wait before reconnecting after a drop.
    res.write(`retry: ${SSE_RETRY_MS}\n\n`);
    // Replay the buffer so the page has context immediately.
    for (const ev of eventBus.recent(100)) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }

    this.sseClients.add(res);
    const cleanup = () => {
      this.sseClients.delete(res);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);

    // Heartbeat every 25s to keep proxies / kernels from dropping idle conns.
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);
    req.on('close', () => clearInterval(heartbeat));
  }

  // ── Snapshot builders ───────────────────────────────────────────────

  private snapshotStatus(): unknown {
    const now = Date.now();
    const uptimeMs = now - this.deps.startedAt;
    const todayCost = dailyCostCap.todaySnapshot();
    const honchoStats = this.deps.honcho?.getStats();
    const episodeCount = this.deps.episodic?.count() ?? 0;

    return {
      bridge: {
        version: this.deps.bridgeVersion,
        startedAt: this.deps.startedAt,
        uptimeMs,
        repoRoot: this.deps.bridgeRepoRoot,
      },
      layers: {
        l1_working: { online: true, label: 'Working — Claude Code session state + Auto Memory' },
        l2_identity: {
          online: !this.deps.config.HONCHO_DISABLED && (this.deps.honcho?.enabled ?? false),
          label: `Identity — Honcho (${this.deps.config.HONCHO_WORKSPACE_ID})`,
          stats: honchoStats ?? null,
        },
        l3_episodic: {
          online: !this.deps.config.EPISODIC_DISABLED && !!this.deps.episodic,
          label: 'Episodic — embeddings + cosine recall',
          episodes: episodeCount,
        },
        l4_procedural: {
          online: true,
          label: 'Procedural — persona stack + .claude/skills/',
        },
        l5_reflection: {
          online: !this.deps.config.REFLECTION_DISABLED,
          label: 'Reflection — Reflexion at session end',
          idleMin: this.deps.config.REFLECTION_IDLE_MIN,
        },
      },
      today: {
        reflectionCostUsd: todayCost.todayUsd,
        reflectionCount: todayCost.todayCount,
        capUsd: this.deps.config.REFLECTION_DAILY_CAP_USD,
        capPct:
          this.deps.config.REFLECTION_DAILY_CAP_USD > 0
            ? Math.min(100, (todayCost.todayUsd / this.deps.config.REFLECTION_DAILY_CAP_USD) * 100)
            : 0,
      },
      allowlist: {
        userIds: this.deps.allowlist.list(),
      },
    };
  }

  private snapshotSessions(): unknown {
    return {
      // Note: SessionStore doesn't expose a `listAll` — we pull recent
      // active ones (those with last_used in the past 6h) by scanning
      // the idle list with a long threshold. The dashboard's "active"
      // is "any session touched recently".
      recent: this.deps.sessionStore
        .listIdleNeedingReflection(0)
        .filter((s) => s.last_used > Date.now() - 6 * 60 * 60_000)
        .slice(0, 20)
        .map((s) => ({
          threadKey: s.thread_key,
          claudeSessionId: s.claude_session_id,
          firstPeerId: s.first_peer_id,
          channelName: s.channel_name,
          channelId: s.channel_id,
          numTurns: s.num_turns,
          totalCostUsd: s.total_cost_usd,
          createdAt: s.created_at,
          lastUsed: s.last_used,
          reflected: !!s.reflection_run_at,
          reflectionCostUsd: s.reflection_cost_usd,
        })),
    };
  }

  /**
   * GET /api/persona-stack
   *   → { layers: [{ name, path, chars, mtime, preview }], total }
   * Reads the Thoth persona files (and aether rules if present) directly
   * from disk so the dashboard reflects the live state.
   */
  private async servePersonaStack(_url: string, res: http.ServerResponse): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const personaDir = path.join(this.deps.bridgeRepoRoot, '..', '..', 'persona', 'apex');
    const aetherRulesPath = path.join(this.deps.bridgeRepoRoot, '..', '..', 'persona', 'aether', 'RULES.md');
    const files = [
      { name: 'IDENTITY', file: 'IDENTITY.md' },
      { name: 'SOUL', file: 'SOUL.md' },
      { name: 'RULES', file: 'RULES.md' },
      { name: 'AGENTS', file: 'AGENTS.md' },
      { name: 'USER', file: 'USER.md' },
      { name: 'MEMORY', file: 'MEMORY.md' },
    ];
    const layers: Array<{ name: string; path: string; chars: number; mtime: number | null; preview: string }> = [];
    for (const f of files) {
      const fp = path.join(personaDir, f.file);
      try {
        const [text, stat] = await Promise.all([
          fs.readFile(fp, 'utf8'),
          fs.stat(fp),
        ]);
        layers.push({
          name: f.name,
          path: `apex/${f.file}`,
          chars: text.length,
          mtime: stat.mtimeMs,
          preview: text.slice(0, 220),
        });
      } catch {
        layers.push({ name: f.name, path: `apex/${f.file}`, chars: 0, mtime: null, preview: '_(missing)_' });
      }
    }
    try {
      const [text, stat] = await Promise.all([
        fs.readFile(aetherRulesPath, 'utf8'),
        fs.stat(aetherRulesPath),
      ]);
      layers.push({
        name: 'AETHER RULES',
        path: 'aether/RULES.md',
        chars: text.length,
        mtime: stat.mtimeMs,
        preview: text.slice(0, 220),
      });
    } catch {
      // optional layer
    }
    const total = layers.reduce((acc, l) => acc + l.chars, 0);
    this.serveJson(res, { layers, total });
  }

  private async servePersonas(res: http.ServerResponse): Promise<void> {
    const refs = await this.entityResolver.listPersonaFiles();
    this.serveJson(res, { refs });
  }

  private async serveMemoryNotes(res: http.ServerResponse): Promise<void> {
    const refs = await this.entityResolver.listMemoryNotes();
    this.serveJson(res, { refs });
  }

  /**
   * GET /api/cosmos — entity positions for the 3D constellation view.
   *
   * Strategy: pull the last ~300 episodes with embeddings + recent parties
   * + skill drafts. Project episodes to 2D via lightweight random-projection
   * PCA-ish (deterministic, no extra deps). Time becomes the Z axis,
   * normalized to [-1, 1] over the last 14 days.
   *
   * Other entity types (parties, skills) are anchored relative to their
   * dominant cluster member.
   */
  private async serveCosmos(res: http.ServerResponse): Promise<void> {
    const skyWeather = this.deps.anthropicStatus
      ? this.deps.anthropicStatus.getCurrent().indicator
      : 'none';
    const snap = await buildCosmosSnapshot({
      episodic: this.deps.episodic,
      bridgeRepoRoot: this.deps.bridgeRepoRoot,
      allowlistedUserIds: this.deps.allowlist.list(),
      skyWeather,
    });
    this.serveJson(res, snap);
  }

  /**
   * GET /api/provenance/episode/<id>
   *   → { episodeId, rows: [{ kind, label, chars, score, payload }] }
   */
  private serveProvenance(url: string, res: http.ServerResponse): void {
    const idStr = url.split('/').pop()?.split('?')[0] ?? '';
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.statusCode = 400;
      res.end('bad episode id');
      return;
    }
    const rows = provenanceStore.forEpisode(id);
    this.serveJson(res, {
      episodeId: id,
      rows: rows.map((r) => ({
        kind: r.kind,
        sourceId: r.source_id,
        label: r.label,
        chars: r.chars,
        score: r.score,
        payload: (() => { try { return JSON.parse(r.payload_json); } catch { return {}; } })(),
      })),
    });
  }

  /**
   * GET /api/events/aggregate?window=1h|1d|1w
   *   → { window, since, count, events: [{kind, ts}, ...] }
   * Frontend buckets by kind→edge using the same map renderFlow uses
   * for live pulses, so the heatmap is consistent with the animation.
   */
  private serveEventAggregate(url: string, res: http.ServerResponse): void {
    const queryStr = url.split('?')[1] ?? '';
    const params = new URLSearchParams(queryStr);
    const w = (params.get('window') ?? '1h').toLowerCase();
    const windowMs: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    };
    const ms = windowMs[w];
    if (!ms) {
      this.serveJson(res, { error: 'invalid window — use 1h|1d|1w' });
      return;
    }
    const since = Date.now() - ms;
    const events = eventArchive.since(since);
    this.serveJson(res, {
      window: w,
      since,
      count: events.length,
      events,
    });
  }

  private async serveAkashicSemanticSearch(url: string, res: http.ServerResponse): Promise<void> {
    if (!this.deps.episodic) {
      this.serveJson(res, { hits: [] });
      return;
    }
    const params = new URLSearchParams(url.split('?')[1] || '');
    const q = (params.get('q') || '').trim();
    const k = Math.max(1, Math.min(50, parseInt(params.get('k') || '20', 10)));
    const hits = await semanticSearch(this.deps.episodic, q, k);
    this.serveJson(res, { query: q, hits });
  }

  private snapshotAkashicDigest(): unknown {
    const ep = this.deps.episodic;
    if (!ep) return { onThisDay: [], forgotten: [], formative: [], trends: { emerging: [], decaying: [] }, milestones: [] };
    return {
      onThisDay: onThisDay(ep, 5),
      forgotten: forgottenThreads(ep, 5),
      formative: formativeEpisodes(10),
      trends: topicTrends(ep),
      milestones: milestones(ep),
    };
  }

  /**
   * POST /api/akashic/narrate
   * body: { period: '7d' | '30d' | '90d' }
   * Spawns Claude (Haiku) with a system prompt to write a chronological
   * narrative of the user's history in Seshat's voice. Cached per period
   * (24h staleness). Costs ~$0.10-0.30 depending on episode count.
   */
  private async serveAkashicNarrate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.deps.episodic) {
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, reason: 'episodic memory unavailable' }));
      return;
    }
    const body = await this.readJsonBody(req).catch(() => null);
    const b = (body || {}) as Record<string, unknown>;
    const period = typeof b.period === 'string' ? b.period : '7d';
    const ranges: Record<string, number> = { '7d': 7*86400000, '30d': 30*86400000, '90d': 90*86400000 };
    const ms = ranges[period];
    if (!ms) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, reason: 'invalid period (use 7d/30d/90d)' }));
      return;
    }
    const cutoff = Date.now() - ms;
    const eps = this.deps.episodic.listRecent(500).filter((e) => e.created_at >= cutoff && !e.outdated);
    if (eps.length === 0) {
      this.serveJson(res, { ok: true, narrative: '_(no episodes in this period)_' });
      return;
    }

    // Build a compact transcript for Claude.
    const lines = eps.slice().reverse().map((e) => {
      const date = new Date(e.created_at).toISOString().slice(0, 16).replace('T', ' ');
      const u = (e.user_text || '').replace(/\s+/g, ' ').slice(0, 240);
      const a = (e.apex_summary || '').replace(/\s+/g, ' ').slice(0, 240);
      return `[ep#${e.id}] ${date} (${e.channel_name ?? '?'} · ${e.sender_peer})
  user: ${u}
  apex: ${a}`;
    }).join('\n\n');

    const systemPrompt = `You are Seshat, the Recorder — Egyptian goddess of writing, archives, "Mistress of the House of Books." Your voice is precise, observant, and quietly reverent. You are reading the user's bridge history aloud, transcribing the patterns and through-lines you observe.

You will narrate the user's history for the requested period in second person ("You returned to the OAuth question on the 12th…"). Cite specific episodes with [ep#N] markers. Highlight:
  - Recurring themes
  - Decisions made
  - Things the user worked through and resolved
  - Things still in flight
  - Patterns the user might not have noticed

Format as Markdown with sections. Keep under 600 words. Never invent — narrate only what the transcript shows. End with one short reflective line ("These were the records of [period]").`;

    // Spawn Claude with -p (one-shot). We'll use the existing claude bin
    // and a simple subprocess like the bridge does for spawnClaudeOneshot
    // but inline here to avoid the streaming complexity.
    const childProcess = await import('child_process');
    const promisify = (await import('util')).promisify;
    const execFileP = promisify(childProcess.execFile);

    const userPrompt = `Narrate my last ${period} of bridge history. ${eps.length} episodes follow:

${lines}`;

    try {
      const { stdout } = await execFileP(
        'claude',
        [
          '-p',
          '--output-format', 'json',
          '--append-system-prompt', systemPrompt,
          '--max-turns', '1',
          userPrompt,
        ],
        { maxBuffer: 4 * 1024 * 1024, timeout: 120_000 },
      );
      const env = JSON.parse(stdout) as { result?: string; total_cost_usd?: number };
      const narrative = env.result ?? '_(no output)_';
      this.serveJson(res, { ok: true, narrative, cost: env.total_cost_usd ?? 0, episodeCount: eps.length });
    } catch (err) {
      logger.warn({ err: String(err) }, 'narrate spawn failed');
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, reason: 'narrate spawn failed: ' + String(err).slice(0, 240) }));
    }
  }

  private async serveAkashicPersonaTimeline(res: http.ServerResponse): Promise<void> {
    const path = await import('path');
    const memoryFile = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.claude', 'projects', 'Thoth', 'memory', 'MEMORY.md',
    );
    const obs = await personaTimeline(memoryFile);
    this.serveJson(res, { observations: obs });
  }

  private async serveCouncilSnapshot(res: http.ServerResponse): Promise<void> {
    const dailyToday = (() => {
      try { return partyDailyCap.todaySnapshot(); } catch { return { todayUsd: 0, todayCount: 0 }; }
    })();
    const snap = await buildCouncilSnapshot({
      bridgeRepoRoot: this.deps.bridgeRepoRoot,
      partyDailyCapUsd: this.deps.partyDailyCapUsd ?? 10,
      partyDailyToday: dailyToday,
    });
    this.serveJson(res, snap);
  }

  /**
   * POST /api/council/convene
   * body: { topic, mode, template, roster?, rounds?, allowSubparties? }
   * Resolves a target Slack channel/thread (COUNCIL_CHANNEL_ID env or
   * most-recent active session), fires a party, returns { partyId,
   * threadKey } on success.
   */
  private async serveCouncilConvene(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.deps.partyOrchestrator || !this.deps.slackClient) {
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, reason: 'party orchestrator or slack client not available' }));
      return;
    }
    const body = await this.readJsonBody(req).catch(() => null);
    if (!body || typeof body !== 'object') {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, reason: 'invalid JSON body' }));
      return;
    }
    const b = body as Record<string, unknown>;
    const topic = typeof b.topic === 'string' ? b.topic.trim() : '';
    if (topic.length < 5) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, reason: 'topic ≥ 5 chars required' }));
      return;
    }
    const mode = (b.mode as PartyMode) ?? 'sequential';
    const template = typeof b.template === 'string' ? b.template : 'freeform';
    const rounds = typeof b.rounds === 'number' ? b.rounds : undefined;
    const allowSubparties = b.allowSubparties === true;
    // Dashboard convenes are deliberate; default per-party cap is the
    // orchestrator's $1.50, which is too tight for a 6-agent 2-round PRD.
    // Bump default to $3 here, allow caller override via budgetUsd.
    const budgetUsd = typeof b.budgetUsd === 'number'
      ? Math.max(0.30, Math.min(5.0, b.budgetUsd))
      : 3.0;
    let roster: AgentRole[] | undefined;
    if (Array.isArray(b.roster)) {
      const list = (b.roster as unknown[]).filter((s): s is string => typeof s === 'string');
      const parsed = parseAgentRoster(list.join(','));
      if (!parsed) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, reason: 'invalid roster' }));
        return;
      }
      roster = parsed;
    }

    // Resolve target channel + thread. Fallback chain (in priority order):
    //   1. COUNCIL_CHANNEL_ID env var (explicit configuration)
    //   2. Most recent session with a channel_id (any reflection state)
    //   3. DM with the most-recently-active allowlisted user
    //   4. DM with the first allowlisted user
    let channelId = this.deps.councilChannelId ?? '';
    let threadTs: string | undefined;
    let initiatorPeerId = 'dashboard';

    if (!channelId) {
      // 2. Any recent session with a channel_id (don't filter on reflected
      //    status — we just need a real Slack channel).
      const allSessions = this.deps.sessionStore
        .listIdleNeedingReflection(0)
        .sort((a, b) => b.last_used - a.last_used);
      const recentWithChannel = allSessions.find((s) => !!s.channel_id);
      if (recentWithChannel && recentWithChannel.channel_id) {
        channelId = recentWithChannel.channel_id;
        threadTs = recentWithChannel.thread_ts ?? undefined;
        initiatorPeerId = recentWithChannel.first_peer_id ?? 'dashboard';
      }
    }

    if (!channelId) {
      // 3 + 4. DM the most-recently-active allowlisted user (or first if
      //        no recent activity). Every allowlisted user has a DM with
      //        the bot — this fallback should always succeed.
      //
      // Use the episodic store (not session store) for "most recent" —
      // episodes capture every user turn regardless of reflection state,
      // whereas listIdleNeedingReflection filters out already-reflected
      // sessions, which is the WRONG signal for "who's actually active".
      const allowlisted = this.deps.allowlist.list();
      let preferredUser = allowlisted[0];
      if (this.deps.episodic) {
        const recentEps = this.deps.episodic.listRecent(40);
        const recentEp = recentEps.find((e) => e.sender_peer && allowlisted.includes(e.sender_peer));
        if (recentEp && recentEp.sender_peer) preferredUser = recentEp.sender_peer;
      }
      if (!preferredUser) {
        res.statusCode = 503;
        res.end(JSON.stringify({ ok: false, reason: 'no COUNCIL_CHANNEL_ID set, no recent session, and no allowlisted users to DM' }));
        return;
      }
      try {
        const r = await this.deps.slackClient.conversations.open({ users: preferredUser });
        const dmId = (r.channel as { id?: string } | undefined)?.id;
        if (!dmId) throw new Error('no DM channel returned from conversations.open');
        channelId = dmId;
        initiatorPeerId = preferredUser;
      } catch (err) {
        res.statusCode = 503;
        res.end(JSON.stringify({ ok: false, reason: 'fallback DM open failed: ' + String(err).slice(0, 200) }));
        return;
      }
    }

    // We have channelId — post a fresh top-level message as the thread anchor
    // (unless we inherited a session's existing thread_ts).
    if (!threadTs) {
      try {
        const r = await this.deps.slackClient.chat.postMessage({
          channel: channelId,
          text: `:scroll: *The Council convenes* — ${topic.slice(0, 200)}`,
        });
        threadTs = r.ts;
      } catch (err) {
        res.statusCode = 503;
        res.end(JSON.stringify({ ok: false, reason: 'failed to post anchor message: ' + String(err).slice(0, 200) }));
        return;
      }
    }
    if (!threadTs) {
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, reason: 'no thread to host the party' }));
      return;
    }
    const threadKey = `${channelId}:${threadTs}`;

    // Fire async — return immediately with the partyId.
    void this.deps.partyOrchestrator.run({
      threadKey,
      channelId,
      threadTs,
      initiatorPeerId,
      topic,
      roster,
      rounds,
      mode,
      template,
      budgetUsd,
      allowSubparties,
      client: this.deps.slackClient,
    }).catch((err: unknown) => {
      logger.error({ err: String(err), threadKey }, 'council convene threw');
    });

    this.serveJson(res, { ok: true, threadKey, channel: channelId, threadTs });
  }

  private readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let buf = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { buf += c; if (buf.length > 64 * 1024) reject(new Error('body too large')); });
      req.on('end', () => {
        try { resolve(JSON.parse(buf || '{}')); } catch (err) { reject(err); }
      });
      req.on('error', reject);
    });
  }

  private async serveSkillsRegistry(res: http.ServerResponse): Promise<void> {
    const { fetchRegistryIndex } = await import('../skills/marketplace');
    const idx = await fetchRegistryIndex();
    this.serveJson(res, idx);
  }

  private snapshotAmbient(): unknown {
    const a = this.deps.ambientAgent;
    if (!a) return { enabled: false };
    return { enabled: true, ...a.snapshot() };
  }

  private snapshotAnthropicStatus(): unknown {
    const m = this.deps.anthropicStatus;
    if (!m) {
      return { enabled: false };
    }
    return { enabled: true, ...m.getCurrent() };
  }

  private snapshotRecentParties(): unknown {
    let parties: Array<Record<string, unknown>> = [];
    try {
      parties = partyStore.listRecent(30).map((p) => ({
        id: p.id,
        topic: p.topic,
        mode: p.mode,
        template: p.template,
        rounds: p.rounds,
        outcome: p.outcome,
        startedAt: p.started_at,
        endedAt: p.ended_at,
        totalCostUsd: p.total_cost_usd,
        threadKey: p.thread_key,
        initiatorPeer: p.initiator_peer,
      }));
    } catch {
      /* table may not exist */
    }
    let templateCount = 0;
    try {
      templateCount = partyStore.listTemplates().length;
    } catch {
      /* table may not exist */
    }
    let dailyToday = { todayUsd: 0, todayCount: 0 };
    try {
      dailyToday = partyDailyCap.todaySnapshot();
    } catch {
      /* not initialized */
    }
    return { parties, templates: templateCount, dailyToday };
  }

  private snapshotRecentEpisodes(): unknown {
    if (!this.deps.episodic) return { episodes: [], count: 0 };
    return {
      episodes: this.deps.episodic.listRecent(30),
      count: this.deps.episodic.count(),
    };
  }

  private snapshotDrafts(): unknown {
    // Use the existing helper that returns pending drafts older than 0ms = all pending.
    const pending = skillDraftStore.listPendingOlderThan(0);
    return {
      pending: pending.map(projectDraft),
    };
  }

  private snapshotScheduled(): unknown {
    const due = scheduledRunStore.due(Date.now() + 24 * 60 * 60_000); // pending in next 24h
    return {
      pending: due.map(projectScheduled),
    };
  }
}

function projectDraft(d: SkillDraftRow) {
  return {
    id: d.id,
    slug: d.slug,
    description: d.description,
    sourceThreadKey: d.source_thread_key,
    proposedBy: d.proposed_by,
    status: d.status,
    createdAt: d.created_at,
    decidedAt: d.decided_at,
    decidedBy: d.decided_by,
    slackChannel: d.slack_channel,
    slackMessageTs: d.slack_message_ts,
    filePath: d.file_path,
  };
}

function projectScheduled(r: ScheduledRunRow) {
  return {
    id: r.id,
    threadKey: r.thread_key,
    channelId: r.channel_id,
    threadTs: r.thread_ts,
    peerId: r.peer_id,
    reason: r.reason,
    runAt: r.run_at,
    status: r.status,
    createdAt: r.created_at,
    firedAt: r.fired_at,
    source: r.source,
  };
}

// ── cosmos projection helpers ─────────────────────────────────────

/** Tiny deterministic PRNG so cosmos projections are reproducible across reloads. */
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
    // Box-Muller transform for normal-ish distribution
    const u1 = Math.max(1e-10, rand());
    const u2 = rand();
    v[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    mag += v[i] * v[i];
  }
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) v[i] /= mag;
  return v;
}
