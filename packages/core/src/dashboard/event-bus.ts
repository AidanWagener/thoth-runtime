import { EventEmitter } from 'events';

/**
 * Typed in-process event bus for the dashboard.
 *
 * Modules across the bridge call eventBus.emit(...) at key moments;
 * the dashboard's HTTP server fans those out to connected SSE clients
 * AND keeps a rolling buffer of the last N events so a freshly-loaded
 * dashboard tab can show recent history without reloading the world.
 *
 * Strict zero-dep — Node's built-in EventEmitter only.
 */

export type DashboardEvent =
  | { kind: 'message.received'; ts: number; peer: string; peerName: string; channel: string; channelName: string; threadKey: string; isResume: boolean; preview: string }
  | { kind: 'spawn.start'; ts: number; threadKey: string; sandbox: string; isResume: boolean }
  | { kind: 'spawn.exit'; ts: number; threadKey: string; exitCode: number; costUsd: number; numTurns: number; sessionId: string | null; durationMs: number }
  | { kind: 'episode.write'; ts: number; episodeId: number; threadKey: string; peer: string; userPreview: string; apexPreview: string; costUsd: number }
  | { kind: 'honcho.dialectic'; ts: number; peer: string; latencyMs: number; hadResponse: boolean }
  | { kind: 'honcho.ingest'; ts: number; threadKey: string; peer: string }
  | { kind: 'reflection.start'; ts: number; threadKey: string; episodeCount: number }
  | { kind: 'reflection.complete'; ts: number; threadKey: string; costUsd: number; outcome: string | null; notesAppended: number; skillProposed: boolean; personaObservations: number; honchoUpdates: number }
  | { kind: 'skill.proposed'; ts: number; draftId: number; slug: string; description: string | null; sourceThreadKey: string }
  | { kind: 'skill.decided'; ts: number; draftId: number; slug: string; status: 'accepted' | 'rejected' | 'expired'; decidedBy: string | null; sha: string | null }
  | { kind: 'schedule.created'; ts: number; id: number; threadKey: string; reason: string; runAt: number; source: string }
  | { kind: 'schedule.fired'; ts: number; id: number; threadKey: string; reason: string }
  | { kind: 'reaction.received'; ts: number; reaction: string; episodeId: number | null; draftId: number | null; peer: string; verb: 'verify-success' | 'verify-failure' | 'remember' | 'forget' | 'feedback' | 'skill-accept' | 'skill-reject' | 'unknown' }
  | { kind: 'party.started'; ts: number; partyId: string; topic: string; roster: string[]; threadKey: string }
  | { kind: 'party.agent_spoke'; ts: number; partyId: string; role: string; round: number; confidence: number | null; costUsd: number }
  | { kind: 'party.synthesis'; ts: number; partyId: string; costUsd: number }
  | { kind: 'party.complete'; ts: number; partyId: string; outcome: string; totalCostUsd: number; contributions: number }
  | { kind: 'anthropic.status.indicator_changed'; ts: number; from: string; to: string; description: string }
  | { kind: 'anthropic.status.incident_new'; ts: number; incidentId: string; name: string; status: string; impact: string; shortlink: string; latestUpdate: string }
  | { kind: 'anthropic.status.incident_updated'; ts: number; incidentId: string; name: string; status: string; impact: string; shortlink: string; latestUpdate: string; previousStatus: string }
  | { kind: 'anthropic.status.incident_resolved'; ts: number; incidentId: string; name: string; impact: string; shortlink: string; durationMs: number; finalUpdate: string };

const BUFFER_SIZE = 500;

class TypedEventBus extends EventEmitter {
  private buffer: DashboardEvent[] = [];

  emitEvent(event: DashboardEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - BUFFER_SIZE);
    }
    this.emit('event', event);
  }

  recent(limit = 100): DashboardEvent[] {
    return this.buffer.slice(-limit);
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

export const eventBus = new TypedEventBus();
