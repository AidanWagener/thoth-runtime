// Unit tests for memory/peers.ts — peer roster builder.

import { describe, it, expect } from 'vitest';
import { buildPeerRoster } from './peers';
import { Allowlist } from '../policy/allowlist';

describe('buildPeerRoster', () => {
  it('returns the agent self-peer plus one entry per allowlisted user', () => {
    const allowlist = new Allowlist(['U001', 'U002']);
    const peers = buildPeerRoster(allowlist);
    expect(peers).toHaveLength(3); // 2 humans + thoth
  });

  it('always includes the agent self-peer with id "thoth"', () => {
    const allowlist = new Allowlist([]);
    const peers = buildPeerRoster(allowlist);
    expect(peers).toHaveLength(1);
    expect(peers[0]?.id).toBe('thoth');
  });

  it('marks the self-peer with kind=agent metadata', () => {
    const peers = buildPeerRoster(new Allowlist([]));
    const self = peers.find((p) => p.id === 'thoth');
    expect(self?.metadata?.kind).toBe('agent');
    expect(self?.metadata?.role).toBe('unified_operator');
  });

  it('marks human peers with kind=human metadata', () => {
    const peers = buildPeerRoster(new Allowlist(['U_HUMAN_1']));
    const human = peers.find((p) => p.id === 'U_HUMAN_1');
    expect(human?.metadata?.kind).toBe('human');
    expect(human?.metadata?.slack_user_id).toBe('U_HUMAN_1');
    expect(human?.metadata?.registered_by).toBe('thoth');
  });

  it('preserves the allowlist user IDs verbatim', () => {
    const ids = ['U_ABC', 'U_DEF', 'U_GHI'];
    const peers = buildPeerRoster(new Allowlist(ids));
    const humans = peers.filter((p) => p.id !== 'thoth').map((p) => p.id);
    expect(humans.sort()).toEqual([...ids].sort());
  });

  it('records ISO-8601 registration timestamps on every peer', () => {
    const peers = buildPeerRoster(new Allowlist(['U001']));
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    for (const p of peers) {
      expect(p.metadata?.registered_at).toMatch(isoPattern);
    }
  });

  it('returns just the agent peer when allowlist is empty', () => {
    const peers = buildPeerRoster(new Allowlist([]));
    expect(peers).toEqual([
      expect.objectContaining({
        id: 'thoth',
        metadata: expect.objectContaining({ kind: 'agent' }),
      }),
    ]);
  });

  it('does NOT include "apex" as a peer ID anywhere (post-rename guard)', () => {
    // Regression guard: the bulk Apex→Thoth rename should have eliminated
    // 'apex' as the agent self-peer ID. Locks the new behavior in place.
    const peers = buildPeerRoster(new Allowlist(['U001', 'U002']));
    expect(peers.find((p) => p.id === 'apex')).toBeUndefined();
  });
});
