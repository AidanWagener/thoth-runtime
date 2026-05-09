import type { PeerSpec } from './honcho';
import type { Allowlist } from '../policy/allowlist';

/**
 * Build the static peer roster: every allowlisted Slack user + the apex
 * self-peer. Called once at boot to ensure peers exist in Honcho before
 * any traffic flows.
 *
 * Metadata is intentionally light — Honcho's Deriver builds the rich
 * representation from message content over time. We only seed identity
 * stubs here.
 */
export function buildPeerRoster(allowlist: Allowlist): PeerSpec[] {
  const humans: PeerSpec[] = allowlist.list().map((id) => ({
    id,
    metadata: {
      kind: 'human',
      slack_user_id: id,
      registered_by: 'thoth',
      registered_at: new Date().toISOString(),
    },
  }));

  const apex: PeerSpec = {
    id: 'apex',
    metadata: {
      kind: 'agent',
      role: 'unified_operator',
      persona_repo: 'apex-workspace/persona/apex',
      registered_at: new Date().toISOString(),
    },
  };

  return [...humans, apex];
}
