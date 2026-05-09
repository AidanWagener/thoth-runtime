import fs from 'fs/promises';
import path from 'path';
import { eventBus } from '../dashboard/event-bus';
import { logger } from '../logger';

/**
 * Polls https://status.claude.com (StatusPage.io-hosted) every 60s and
 * emits eventBus transitions when:
 *   - the overall indicator changes (none → minor → major → critical)
 *   - a new incident appears
 *   - an existing incident's status changes (investigating → identified
 *     → monitoring → resolved → postmortem)
 *   - an incident resolves
 *
 * State is persisted to runtime/anthropic-status.json so that bridge
 * restarts during an active incident don't re-fire "new incident"
 * notifications.
 *
 * The fetch uses a 5s AbortController timeout; on failure we keep the
 * last known good snapshot and mark `staleSince` so the dashboard can
 * show a "(stale)" badge if the upstream page is itself unreachable.
 */

const STATUS_URL = 'https://status.claude.com/api/v2/summary.json';
const POLL_INTERVAL_MS = 60_000;
const POLL_JITTER_MS = 8_000; // ±4s to desynchronize across instances
const FETCH_TIMEOUT_MS = 5_000;
const STALE_AFTER_MS = 3 * 60_000;
const RESOLVED_BANNER_TTL_MS = 30 * 60_000;

export type StatusIndicator =
  | 'none'
  | 'minor'
  | 'major'
  | 'critical'
  | 'maintenance';

export type IncidentStatus =
  | 'investigating'
  | 'identified'
  | 'monitoring'
  | 'resolved'
  | 'postmortem'
  | 'scheduled'
  | 'in_progress'
  | 'verifying'
  | 'completed';

export type IncidentImpact = 'none' | 'minor' | 'major' | 'critical';

export interface IncidentSnapshot {
  id: string;
  name: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  shortlink: string;
  latestUpdate: string;
}

export interface StatusSnapshot {
  indicator: StatusIndicator;
  description: string;
  fetchedAt: number;
  staleSince: number | null;
  /** Active incidents (not resolved, not postmortem-closed). */
  active: IncidentSnapshot[];
  /** Recently-resolved incidents within the last RESOLVED_BANNER_TTL_MS. */
  recentlyResolved: IncidentSnapshot[];
}

interface PersistedState {
  lastIndicator: StatusIndicator;
  lastIncidents: Record<string, { status: IncidentStatus; impact: IncidentImpact; resolvedAt: number | null }>;
}

interface StatusPageSummary {
  status: { indicator: StatusIndicator; description: string };
  incidents: Array<{
    id: string;
    name: string;
    status: IncidentStatus;
    impact: IncidentImpact;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
    shortlink: string;
    incident_updates?: Array<{ body: string; created_at: string }>;
  }>;
}

export class AnthropicStatusMonitor {
  private timer: NodeJS.Timeout | null = null;
  private current: StatusSnapshot;
  private persisted: PersistedState;
  private statePath: string;

  constructor(runtimeDir: string) {
    this.statePath = path.join(runtimeDir, 'anthropic-status.json');
    this.current = {
      indicator: 'none',
      description: 'unknown',
      fetchedAt: 0,
      staleSince: null,
      active: [],
      recentlyResolved: [],
    };
    this.persisted = { lastIndicator: 'none', lastIncidents: {} };
  }

  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed && typeof parsed === 'object' && parsed.lastIncidents) {
        this.persisted = parsed;
        logger.info(
          {
            indicator: parsed.lastIndicator,
            knownIncidents: Object.keys(parsed.lastIncidents).length,
          },
          'anthropic status: restored persisted state',
        );
      }
    } catch {
      // first boot — fine, write on first poll
    }
  }

  start(): void {
    if (this.timer) return;
    // Fire once immediately, then jittered interval.
    this.poll().catch((err) =>
      logger.warn({ err: String(err) }, 'anthropic status: initial poll failed'),
    );
    const tick = (): void => {
      const jitter = (Math.random() - 0.5) * POLL_JITTER_MS;
      this.timer = setTimeout(() => {
        this.poll().catch((err) =>
          logger.warn({ err: String(err) }, 'anthropic status: poll failed'),
        );
        tick();
      }, POLL_INTERVAL_MS + jitter);
    };
    tick();
    logger.info(
      { url: STATUS_URL, intervalSec: POLL_INTERVAL_MS / 1000 },
      'anthropic status monitor started',
    );
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Synchronous read for the dashboard's initial GET. */
  getCurrent(): StatusSnapshot {
    // Lazy stale-marking: if we've gone too long without a fresh fetch,
    // surface that to the UI so users know our cache is old.
    if (
      this.current.fetchedAt > 0 &&
      Date.now() - this.current.fetchedAt > STALE_AFTER_MS &&
      !this.current.staleSince
    ) {
      this.current.staleSince = this.current.fetchedAt;
    }
    // Also age out resolved incidents past their TTL.
    const cutoff = Date.now() - RESOLVED_BANNER_TTL_MS;
    this.current.recentlyResolved = this.current.recentlyResolved.filter(
      (i) => (i.resolvedAt ?? i.updatedAt) >= cutoff,
    );
    return this.current;
  }

  private async poll(): Promise<void> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let summary: StatusPageSummary;
    try {
      const r = await fetch(STATUS_URL, {
        signal: ctl.signal,
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) {
        throw new Error(`http ${r.status}`);
      }
      summary = (await r.json()) as StatusPageSummary;
    } catch (err) {
      // Mark stale; don't clobber last good state.
      if (this.current.fetchedAt > 0 && !this.current.staleSince) {
        this.current.staleSince = Date.now();
      }
      logger.debug(
        { err: String(err) },
        'anthropic status: fetch failed (keeping last known good)',
      );
      return;
    } finally {
      clearTimeout(t);
    }

    const now = Date.now();
    const indicator = summary.status.indicator ?? 'none';
    const description = summary.status.description ?? '';

    // Build active + recentlyResolved snapshots.
    const active: IncidentSnapshot[] = [];
    const recentlyResolvedMap = new Map<string, IncidentSnapshot>();
    for (const inc of summary.incidents ?? []) {
      const snap: IncidentSnapshot = {
        id: inc.id,
        name: inc.name,
        status: inc.status,
        impact: inc.impact,
        createdAt: Date.parse(inc.created_at) || now,
        updatedAt: Date.parse(inc.updated_at) || now,
        resolvedAt: inc.resolved_at ? Date.parse(inc.resolved_at) : null,
        shortlink: inc.shortlink,
        latestUpdate: (inc.incident_updates?.[0]?.body ?? '').trim(),
      };
      const isResolved =
        inc.status === 'resolved' ||
        inc.status === 'postmortem' ||
        inc.status === 'completed';
      if (!isResolved) {
        active.push(snap);
      } else if (snap.resolvedAt && now - snap.resolvedAt < RESOLVED_BANNER_TTL_MS) {
        recentlyResolvedMap.set(snap.id, snap);
      }
    }

    // Diff against persisted state and emit transitions.
    const prevIndicator = this.persisted.lastIndicator;
    if (prevIndicator !== indicator) {
      eventBus.emitEvent({
        kind: 'anthropic.status.indicator_changed',
        ts: now,
        from: prevIndicator,
        to: indicator,
        description,
      });
      logger.warn(
        { from: prevIndicator, to: indicator, description },
        'anthropic status indicator changed',
      );
    }

    const seenIds = new Set<string>();
    for (const inc of active) {
      seenIds.add(inc.id);
      const prev = this.persisted.lastIncidents[inc.id];
      if (!prev) {
        eventBus.emitEvent({
          kind: 'anthropic.status.incident_new',
          ts: now,
          incidentId: inc.id,
          name: inc.name,
          status: inc.status,
          impact: inc.impact,
          shortlink: inc.shortlink,
          latestUpdate: inc.latestUpdate,
        });
        logger.warn(
          { id: inc.id, name: inc.name, impact: inc.impact, status: inc.status },
          'anthropic status: NEW incident',
        );
      } else if (prev.status !== inc.status || prev.impact !== inc.impact) {
        eventBus.emitEvent({
          kind: 'anthropic.status.incident_updated',
          ts: now,
          incidentId: inc.id,
          name: inc.name,
          status: inc.status,
          impact: inc.impact,
          shortlink: inc.shortlink,
          latestUpdate: inc.latestUpdate,
          previousStatus: prev.status,
        });
        logger.warn(
          { id: inc.id, status: inc.status, prev: prev.status },
          'anthropic status: incident updated',
        );
      }
    }

    // Detect resolutions: previously-tracked active incident now absent or resolved.
    for (const [id, prev] of Object.entries(this.persisted.lastIncidents)) {
      if (prev.resolvedAt) continue; // already resolved last cycle
      const stillActive = seenIds.has(id);
      if (stillActive) continue;
      // Was active, now no longer active. Look up the resolution snapshot.
      const resolution =
        recentlyResolvedMap.get(id) ??
        (summary.incidents ?? [])
          .map((inc): IncidentSnapshot | null => {
            if (inc.id !== id) return null;
            return {
              id: inc.id,
              name: inc.name,
              status: inc.status,
              impact: inc.impact,
              createdAt: Date.parse(inc.created_at) || now,
              updatedAt: Date.parse(inc.updated_at) || now,
              resolvedAt: inc.resolved_at ? Date.parse(inc.resolved_at) : now,
              shortlink: inc.shortlink,
              latestUpdate: (inc.incident_updates?.[0]?.body ?? '').trim(),
            };
          })
          .find((x): x is IncidentSnapshot => x !== null);
      if (!resolution) continue;
      const durationMs = (resolution.resolvedAt ?? now) - resolution.createdAt;
      eventBus.emitEvent({
        kind: 'anthropic.status.incident_resolved',
        ts: now,
        incidentId: resolution.id,
        name: resolution.name,
        impact: resolution.impact,
        shortlink: resolution.shortlink,
        durationMs,
        finalUpdate: resolution.latestUpdate,
      });
      logger.info(
        { id: resolution.id, name: resolution.name, durationMs },
        'anthropic status: incident RESOLVED',
      );
      // Make sure it's surfaced to the dashboard banner for the TTL window.
      if (!recentlyResolvedMap.has(id)) {
        recentlyResolvedMap.set(id, resolution);
      }
    }

    // Update the in-memory current snapshot.
    this.current = {
      indicator,
      description,
      fetchedAt: now,
      staleSince: null,
      active,
      recentlyResolved: Array.from(recentlyResolvedMap.values()).sort(
        (a, b) => (b.resolvedAt ?? b.updatedAt) - (a.resolvedAt ?? a.updatedAt),
      ),
    };

    // Update + persist state.
    const nextIncidents: PersistedState['lastIncidents'] = {};
    for (const inc of active) {
      nextIncidents[inc.id] = {
        status: inc.status,
        impact: inc.impact,
        resolvedAt: null,
      };
    }
    for (const inc of recentlyResolvedMap.values()) {
      nextIncidents[inc.id] = {
        status: inc.status,
        impact: inc.impact,
        resolvedAt: inc.resolvedAt,
      };
    }
    this.persisted = { lastIndicator: indicator, lastIncidents: nextIncidents };
    await this.persist().catch((err) =>
      logger.warn({ err: String(err) }, 'anthropic status: persist failed'),
    );
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.writeFile(
      this.statePath,
      JSON.stringify(this.persisted, null, 2),
      'utf8',
    );
  }
}
