import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import { AGENTS, type AgentRole } from '../party/agents';
import { partyStore } from '../party/store';
import { sigilSvg, councilSealSvg } from './sigils';
import { logger } from '../logger';

/**
 * Council snapshot builder. Rolls up per-agent stats from the
 * party_messages table + lore from the persona files. Used by
 * the dashboard's Council tab control room.
 */

export interface AgentBattleStats {
  invocations: number;
  avg_confidence: number | null;
  total_cost_usd: number;
  avg_duration_ms: number;
  last_invoked_at: number | null;
  /** Most-frequent template they appear in. */
  top_template: string | null;
  /** Top 3 most-frequent co-roster members. */
  familiars: Array<{ role: AgentRole; co_appearances: number }>;
  /** 5 most recent contributions, slim shape. */
  recent: Array<{
    party_id: string;
    party_topic: string;
    round_number: number;
    confidence: number | null;
    cost_usd: number;
    created_at: number;
    party_message_id: number;
  }>;
}

export interface AgentEnvelope {
  role: AgentRole;
  name: string;
  title: string;
  display: string;
  accent: string;
  glyph: string;
  emoji: string;
  sigilSvg: string;
  loreFilePath: string;
  loreText: string;
  stats: AgentBattleStats;
}

export interface CouncilSnapshot {
  members: AgentEnvelope[];
  seal_svg: string;
  total_invocations: number;
  total_cost_usd: number;
  active_party_id: string | null;
  daily_cap_usd: number;
  daily_today: { todayUsd: number; todayCount: number };
}

/**
 * Build the full council snapshot. Single round-trip; the dashboard
 * caches it client-side for a few seconds.
 */
export async function buildCouncilSnapshot(opts: {
  bridgeRepoRoot: string;
  partyDailyCapUsd: number;
  partyDailyToday: { todayUsd: number; todayCount: number };
}): Promise<CouncilSnapshot> {
  const personaDir = path.join(opts.bridgeRepoRoot, '..', '..', 'persona', 'apex', 'party');
  const allRoles = Object.keys(AGENTS) as AgentRole[];
  // Order: BMAD speaking order + Master last (synthesis position).
  const orderedRoles: AgentRole[] = ['analyst', 'pm', 'architect', 'dev', 'qa', 'ux', 'master'];

  // Pull all stats in one DB shot.
  const statsByRole = perRoleStats();
  const familiarsByRole = perRoleFamiliars(orderedRoles);
  const recentByRole = perRoleRecent(orderedRoles);

  const members: AgentEnvelope[] = [];
  for (const role of orderedRoles) {
    const agent = AGENTS[role];
    const loreFilePath = path.join(personaDir, agent.personaFileName);
    let loreText = '';
    try {
      loreText = await fs.readFile(loreFilePath, 'utf8');
    } catch (err) {
      logger.debug({ err: String(err), file: loreFilePath }, 'persona lore file missing');
      loreText = '_(lore file missing — copy persona/apex/party/' + agent.personaFileName + ' to disk to populate)_';
    }
    const base = statsByRole.get(role) ?? emptyStats();
    members.push({
      role,
      name: agent.name,
      title: agent.title,
      display: agent.display,
      accent: agent.accent,
      glyph: agent.glyph,
      emoji: agent.emoji,
      sigilSvg: sigilSvg(role, { size: 96, glow: true }),
      loreFilePath,
      loreText,
      stats: {
        ...base,
        familiars: familiarsByRole.get(role) ?? [],
        recent: recentByRole.get(role) ?? [],
      },
    });
  }

  let totalInvocations = 0;
  let totalCost = 0;
  for (const m of members) {
    totalInvocations += m.stats.invocations;
    totalCost += m.stats.total_cost_usd;
  }

  const activePartyId = findActivePartyId();
  const sealRoles = orderedRoles.filter((r) => r !== 'master');

  return {
    members,
    seal_svg: councilSealSvg(sealRoles, { size: 320 }),
    total_invocations: totalInvocations,
    total_cost_usd: totalCost,
    active_party_id: activePartyId,
    daily_cap_usd: opts.partyDailyCapUsd,
    daily_today: opts.partyDailyToday,
  };
}

// ── stat builders ────────────────────────────────────────────────

interface RawStats {
  invocations: number;
  avg_confidence: number | null;
  total_cost_usd: number;
  avg_duration_ms: number;
  last_invoked_at: number | null;
  top_template: string | null;
}

function emptyStats(): RawStats {
  return {
    invocations: 0,
    avg_confidence: null,
    total_cost_usd: 0,
    avg_duration_ms: 0,
    last_invoked_at: null,
    top_template: null,
  };
}

function getDb(): Database.Database | null {
  // partyStore exposes its DB via internal _db getter (not public), but
  // we can re-open the same file as needed in queries. Safer: have
  // partyStore expose the raw DB. For now, attach via internal access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (partyStore as any)['db'] as Database.Database | null;
  return db ?? null;
}

function perRoleStats(): Map<AgentRole, RawStats> {
  const out = new Map<AgentRole, RawStats>();
  const db = getDb();
  if (!db) return out;
  try {
    const rows = db
      .prepare<[], { agent_role: string; n: number; avg_conf: number | null; total_cost: number; avg_dur: number; last_at: number | null }>(
        `SELECT
            agent_role,
            COUNT(*) AS n,
            AVG(confidence) AS avg_conf,
            SUM(cost_usd) AS total_cost,
            AVG(duration_ms) AS avg_dur,
            MAX(created_at) AS last_at
          FROM party_messages
          GROUP BY agent_role`,
      )
      .all();
    for (const r of rows) {
      out.set(r.agent_role as AgentRole, {
        invocations: r.n,
        avg_confidence: r.avg_conf,
        total_cost_usd: r.total_cost ?? 0,
        avg_duration_ms: r.avg_dur ?? 0,
        last_invoked_at: r.last_at ?? null,
        top_template: null, // filled below
      });
    }
    const tplRows = db
      .prepare<[], { agent_role: string; template: string; n: number }>(
        `SELECT pm.agent_role, pr.template, COUNT(*) AS n
            FROM party_messages pm
            JOIN party_runs pr ON pr.id = pm.party_id
            GROUP BY pm.agent_role, pr.template
            ORDER BY pm.agent_role ASC, n DESC`,
      )
      .all();
    const seen = new Set<string>();
    for (const r of tplRows) {
      if (seen.has(r.agent_role)) continue;
      seen.add(r.agent_role);
      const cur = out.get(r.agent_role as AgentRole);
      if (cur) cur.top_template = r.template;
    }
  } catch (err) {
    logger.debug({ err: String(err) }, 'council stats query failed (table may be empty)');
  }
  return out;
}

function perRoleFamiliars(roles: AgentRole[]): Map<AgentRole, Array<{ role: AgentRole; co_appearances: number }>> {
  const out = new Map<AgentRole, Array<{ role: AgentRole; co_appearances: number }>>();
  const db = getDb();
  if (!db) return out;
  try {
    // For each pair (a, b), count distinct parties where both appeared.
    const rows = db
      .prepare<[], { a: string; b: string; n: number }>(
        `SELECT a.agent_role AS a, b.agent_role AS b, COUNT(DISTINCT a.party_id) AS n
            FROM party_messages a
            JOIN party_messages b ON a.party_id = b.party_id AND a.agent_role <> b.agent_role
            GROUP BY a.agent_role, b.agent_role`,
      )
      .all();
    for (const role of roles) {
      const list = rows
        .filter((r) => r.a === role)
        .map((r) => ({ role: r.b as AgentRole, co_appearances: r.n }))
        .sort((x, y) => y.co_appearances - x.co_appearances)
        .slice(0, 3);
      out.set(role, list);
    }
  } catch (err) {
    logger.debug({ err: String(err) }, 'familiars query failed');
  }
  return out;
}

function perRoleRecent(roles: AgentRole[]): Map<AgentRole, AgentBattleStats['recent']> {
  const out = new Map<AgentRole, AgentBattleStats['recent']>();
  const db = getDb();
  if (!db) return out;
  for (const role of roles) {
    try {
      const rows = db
        .prepare<[string], {
          party_message_id: number;
          party_id: string;
          round_number: number;
          confidence: number | null;
          cost_usd: number;
          created_at: number;
          party_topic: string;
        }>(
          `SELECT pm.id AS party_message_id, pm.party_id, pm.round_number, pm.confidence, pm.cost_usd, pm.created_at, pr.topic AS party_topic
              FROM party_messages pm
              JOIN party_runs pr ON pr.id = pm.party_id
              WHERE pm.agent_role = ?
              ORDER BY pm.created_at DESC
              LIMIT 5`,
        )
        .all(role);
      out.set(role, rows);
    } catch {
      out.set(role, []);
    }
  }
  return out;
}

function findActivePartyId(): string | null {
  const db = getDb();
  if (!db) return null;
  try {
    const r = db
      .prepare<[], { id: string }>(
        `SELECT id FROM party_runs WHERE outcome = 'running' ORDER BY started_at DESC LIMIT 1`,
      )
      .get();
    return r?.id ?? null;
  } catch {
    return null;
  }
}

/** Pairwise affinity matrix — γ.2 */
export interface AffinityCell {
  a: AgentRole;
  b: AgentRole;
  co_parties: number;
  /** Pearson-ish correlation of confidence within shared parties (-1 to 1). */
  conf_correlation: number | null;
}

export function buildAffinityMatrix(): { cells: AffinityCell[]; max_co: number } {
  const out: AffinityCell[] = [];
  const db = getDb();
  if (!db) return { cells: out, max_co: 0 };

  const roles: AgentRole[] = ['analyst', 'pm', 'architect', 'dev', 'qa', 'ux', 'master'];
  let max = 0;
  try {
    for (const a of roles) {
      for (const b of roles) {
        if (a === b) {
          out.push({ a, b, co_parties: 0, conf_correlation: null });
          continue;
        }
        const co = db
          .prepare<[string, string], { n: number }>(
            `SELECT COUNT(DISTINCT pm1.party_id) AS n
              FROM party_messages pm1
              JOIN party_messages pm2 ON pm1.party_id = pm2.party_id
              WHERE pm1.agent_role = ? AND pm2.agent_role = ?`,
          )
          .get(a, b);
        const coCount = co?.n ?? 0;
        if (coCount > max) max = coCount;

        // Confidence correlation across shared parties.
        let corr: number | null = null;
        if (coCount >= 2) {
          const pair = db
            .prepare<[string, string], { ca: number | null; cb: number | null }>(
              `SELECT pm1.confidence AS ca, pm2.confidence AS cb
                FROM party_messages pm1
                JOIN party_messages pm2 ON pm1.party_id = pm2.party_id
                WHERE pm1.agent_role = ? AND pm2.agent_role = ?`,
            )
            .all(a, b);
          const valid = pair.filter((p) => typeof p.ca === 'number' && typeof p.cb === 'number') as Array<{ ca: number; cb: number }>;
          if (valid.length >= 2) {
            corr = pearson(valid.map((v) => v.ca), valid.map((v) => v.cb));
          }
        }
        out.push({ a, b, co_parties: coCount, conf_correlation: corr });
      }
    }
  } catch (err) {
    logger.debug({ err: String(err) }, 'affinity query failed');
  }
  return { cells: out, max_co: max };
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return null;
  return num / denom;
}
