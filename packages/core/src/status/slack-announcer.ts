import type { WebClient } from '@slack/web-api';
import { eventBus, type DashboardEvent } from '../dashboard/event-bus';
import { logger } from '../logger';

/**
 * Subscribes to anthropic.status.* events and posts Slack messages.
 *
 * Targets:
 *   - If ANTHROPIC_STATUS_ANNOUNCE_CHANNEL env var is set, post there.
 *   - Otherwise DM each allowlisted user (one DM per user, per event).
 *
 * Posts only on transitions, not on every poll. The event bus already
 * dedupes — if an incident's status hasn't changed between polls, no
 * event is emitted, no message is sent.
 */

export interface AnnouncerDeps {
  client: WebClient;
  allowlistUserIds: string[];
  announceChannelId: string | null;
}

export function startStatusAnnouncer(deps: AnnouncerDeps): void {
  const dmCache = new Map<string, string>(); // userId -> DM channel id

  async function targetChannels(): Promise<string[]> {
    if (deps.announceChannelId) return [deps.announceChannelId];
    const out: string[] = [];
    for (const u of deps.allowlistUserIds) {
      let dm = dmCache.get(u);
      if (!dm) {
        try {
          const r = await deps.client.conversations.open({ users: u });
          dm = (r.channel as { id?: string } | undefined)?.id ?? '';
          if (dm) dmCache.set(u, dm);
        } catch (err) {
          logger.warn({ err: String(err), userId: u }, 'status announcer: DM open failed');
          continue;
        }
      }
      if (dm) out.push(dm);
    }
    return out;
  }

  async function post(text: string): Promise<void> {
    const channels = await targetChannels();
    for (const ch of channels) {
      try {
        await deps.client.chat.postMessage({
          channel: ch,
          text,
          unfurl_links: false,
          unfurl_media: false,
        });
      } catch (err) {
        logger.warn(
          { err: String(err), channel: ch },
          'status announcer: post failed',
        );
      }
    }
  }

  eventBus.on('event', (e: DashboardEvent) => {
    if (e.kind === 'anthropic.status.incident_new') {
      const sev = severityEmoji(e.impact);
      const lines = [
        `${sev} *Anthropic API incident — ${formatImpact(e.impact)}*`,
        `*${e.name}*`,
        `Status: \`${e.status}\``,
        e.latestUpdate ? `> ${trim(e.latestUpdate, 600)}` : '',
        `Track: ${e.shortlink}`,
      ].filter(Boolean);
      post(lines.join('\n')).catch(() => undefined);
      return;
    }
    if (e.kind === 'anthropic.status.incident_updated') {
      const sev = severityEmoji(e.impact);
      const lines = [
        `${sev} *Incident update — ${e.name}*`,
        `\`${e.previousStatus}\` → \`${e.status}\` · impact: ${formatImpact(e.impact)}`,
        e.latestUpdate ? `> ${trim(e.latestUpdate, 600)}` : '',
        `Track: ${e.shortlink}`,
      ].filter(Boolean);
      post(lines.join('\n')).catch(() => undefined);
      return;
    }
    if (e.kind === 'anthropic.status.incident_resolved') {
      const lines = [
        `:large_green_circle: *Resolved — ${e.name}*`,
        `Was: ${formatImpact(e.impact)} · duration: ${formatDuration(e.durationMs)}`,
        e.finalUpdate ? `> ${trim(e.finalUpdate, 600)}` : '',
        `Postmortem: ${e.shortlink}`,
      ].filter(Boolean);
      post(lines.join('\n')).catch(() => undefined);
      return;
    }
    if (e.kind === 'anthropic.status.indicator_changed') {
      // Only announce indicator changes when they cross to/from "none".
      // Otherwise the per-incident events carry enough signal.
      if (e.from === 'none' || e.to === 'none') {
        const text =
          e.to === 'none'
            ? `:large_green_circle: *Anthropic status: all systems operational* (was: ${e.from})`
            : `${severityEmoji(e.to)} *Anthropic status: ${e.description}* (${e.from} → ${e.to})`;
        post(text).catch(() => undefined);
      }
    }
  });

  logger.info(
    {
      target: deps.announceChannelId
        ? `channel:${deps.announceChannelId}`
        : `dm:${deps.allowlistUserIds.length} users`,
    },
    'anthropic status announcer subscribed',
  );
}

function severityEmoji(impact: string): string {
  switch (impact) {
    case 'critical': return ':rotating_light:';
    case 'major':    return ':red_circle:';
    case 'minor':    return ':large_yellow_circle:';
    case 'maintenance': return ':wrench:';
    default:         return ':information_source:';
  }
}

function formatImpact(impact: string): string {
  if (!impact) return 'unknown';
  return impact.charAt(0).toUpperCase() + impact.slice(1);
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function trim(s: string, n: number): string {
  const cleaned = s.replace(/\s+/g, ' ').trim();
  return cleaned.length <= n ? cleaned : cleaned.slice(0, n) + '…';
}
