import { logger } from '../logger';

/**
 * Thin client for Honcho v3 (https://api.honcho.dev).
 *
 * Design decisions baked in:
 *   - Every external call has a hard timeout (default 1.5s for dialectic,
 *     5s for writes). Honcho is *enrichment*, never the critical path.
 *   - All operations soft-fail. ingest() returns void and never throws;
 *     dialectic() returns null on failure or timeout.
 *   - ensure*() calls are idempotent and memoized in-process; we never
 *     pay a roundtrip twice for the same workspace/peer/session.
 *   - We avoid the official SDK to keep the dependency footprint tight
 *     and the timeout/abort semantics predictable.
 */

export interface HonchoClientConfig {
  apiKey: string;
  workspaceId: string;
  baseUrl?: string;
  dialecticTimeoutMs?: number;
  writeTimeoutMs?: number;
  disabled?: boolean;
}

export interface DialecticResult {
  content: string;
  latencyMs: number;
}

export interface PeerSpec {
  id: string;
  metadata?: Record<string, unknown>;
}

export class HonchoClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly workspaceId: string;
  private readonly dialecticTimeoutMs: number;
  private readonly writeTimeoutMs: number;
  private readonly disabled: boolean;

  // In-process idempotency caches. Cleared on restart.
  private readonly ensuredPeers = new Set<string>();
  private readonly ensuredSessions = new Set<string>();
  private workspaceEnsured = false;

  // Cost telemetry — accumulated across the bridge's lifetime.
  public stats = {
    ingestCalls: 0,
    ingestFailures: 0,
    dialecticCalls: 0,
    dialecticFailures: 0,
    dialecticTotalLatencyMs: 0,
  };

  constructor(cfg: HonchoClientConfig) {
    this.apiKey = cfg.apiKey;
    this.workspaceId = cfg.workspaceId;
    this.baseUrl = cfg.baseUrl ?? 'https://api.honcho.dev';
    this.dialecticTimeoutMs = cfg.dialecticTimeoutMs ?? 1500;
    this.writeTimeoutMs = cfg.writeTimeoutMs ?? 5000;
    this.disabled = cfg.disabled ?? false;

    if (this.disabled) {
      logger.warn('honcho client constructed in DISABLED mode — all calls will no-op');
    }
  }

  get enabled(): boolean {
    return !this.disabled;
  }

  // --- HTTP plumbing -------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const url = `${this.baseUrl}${path}`;
    try {
      const r = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`Honcho ${method} ${path} -> ${r.status}: ${text.slice(0, 200)}`);
      }
      // Some POSTs (e.g., session create on duplicate) may return empty bodies.
      const ct = r.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) return undefined as unknown as T;
      return (await r.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Bootstrap -----------------------------------------------------------

  async ensureWorkspace(metadata?: Record<string, unknown>): Promise<void> {
    if (this.disabled || this.workspaceEnsured) return;
    try {
      await this.request<unknown>(
        'POST',
        '/v3/workspaces',
        { id: this.workspaceId, ...(metadata ? { metadata } : {}) },
        this.writeTimeoutMs,
      );
      this.workspaceEnsured = true;
      logger.info({ workspaceId: this.workspaceId }, 'honcho workspace ensured');
    } catch (err) {
      // POSTing an existing workspace is a no-op semantically; tolerate.
      this.workspaceEnsured = true;
      logger.debug(
        { err: String(err), workspaceId: this.workspaceId },
        'honcho ensureWorkspace soft-tolerated',
      );
    }
  }

  async ensurePeer(spec: PeerSpec): Promise<void> {
    if (this.disabled) return;
    if (this.ensuredPeers.has(spec.id)) return;
    try {
      await this.request<unknown>(
        'POST',
        `/v3/workspaces/${this.workspaceId}/peers`,
        { id: spec.id, ...(spec.metadata ? { metadata: spec.metadata } : {}) },
        this.writeTimeoutMs,
      );
    } catch (err) {
      logger.debug(
        { err: String(err), peerId: spec.id },
        'honcho ensurePeer soft-tolerated (likely existing)',
      );
    }
    this.ensuredPeers.add(spec.id);
  }

  async ensurePeers(specs: PeerSpec[]): Promise<void> {
    await Promise.all(specs.map((s) => this.ensurePeer(s)));
  }

  /**
   * Honcho rejects session IDs containing `:` or `.` (returns 422 on
   * create, 500 on subsequent message POST). Slack thread keys in our
   * codebase look like `C0AD…:1778000000.123456`. Convert to
   * Honcho-safe form by replacing the offending chars with `-`.
   * Lossless and reversible enough for human inspection.
   */
  private normalizeSessionId(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  private async ensureSession(sessionId: string): Promise<string> {
    const safe = this.normalizeSessionId(sessionId);
    if (this.disabled) return safe;
    if (this.ensuredSessions.has(safe)) return safe;
    try {
      await this.request<unknown>(
        'POST',
        `/v3/workspaces/${this.workspaceId}/sessions`,
        { id: safe },
        this.writeTimeoutMs,
      );
    } catch (err) {
      logger.debug(
        { err: String(err), sessionId: safe },
        'honcho ensureSession soft-tolerated (likely existing)',
      );
    }
    this.ensuredSessions.add(safe);
    return safe;
  }

  // --- Hot-path operations -------------------------------------------------

  /**
   * Fire-and-forget ingest. Never throws, never blocks the caller.
   *
   * Each call ensures the session lazily on first use. Subsequent calls in
   * the same process skip the session-create roundtrip.
   */
  ingest(sessionId: string, peerId: string, content: string): void {
    if (this.disabled) return;
    if (!content.trim()) return;
    this.stats.ingestCalls++;
    void this.doIngest(sessionId, peerId, content).catch((err) => {
      this.stats.ingestFailures++;
      logger.warn(
        { err: String(err), sessionId, peerId },
        'honcho ingest failed (soft)',
      );
    });
  }

  private async doIngest(sessionId: string, peerId: string, content: string): Promise<void> {
    const safe = await this.ensureSession(sessionId);
    await this.request<unknown>(
      'POST',
      `/v3/workspaces/${this.workspaceId}/sessions/${encodeURIComponent(safe)}/messages`,
      { messages: [{ peer_id: peerId, content }] },
      this.writeTimeoutMs,
    );
  }

  /**
   * Bounded dialectic query. Returns null on disabled, empty query, timeout,
   * or any failure mode. Caller should treat null as "no enrichment available
   * this turn" and continue.
   */
  async dialectic(peerId: string, query: string): Promise<DialecticResult | null> {
    if (this.disabled) return null;
    const trimmed = query.trim();
    if (!trimmed) return null;
    this.stats.dialecticCalls++;
    const t0 = Date.now();
    try {
      const r = await this.request<{ content?: string }>(
        'POST',
        `/v3/workspaces/${this.workspaceId}/peers/${encodeURIComponent(peerId)}/chat`,
        { query: trimmed },
        this.dialecticTimeoutMs,
      );
      const latencyMs = Date.now() - t0;
      this.stats.dialecticTotalLatencyMs += latencyMs;
      const content = r?.content?.trim();
      if (!content) return null;
      return { content, latencyMs };
    } catch (err) {
      this.stats.dialecticFailures++;
      logger.debug(
        { err: String(err), peerId, latencyMs: Date.now() - t0 },
        'honcho dialectic failed (soft)',
      );
      return null;
    }
  }

  /** Snapshot of current cost telemetry; safe to print to Slack. */
  getStats(): typeof this.stats & { dialecticAvgLatencyMs: number } {
    const dialecticAvgLatencyMs = this.stats.dialecticCalls
      ? Math.round(this.stats.dialecticTotalLatencyMs / this.stats.dialecticCalls)
      : 0;
    return { ...this.stats, dialecticAvgLatencyMs };
  }
}
