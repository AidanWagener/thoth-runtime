import path from 'path';

/**
 * Static roster definition for party agents. Each role:
 *   - has a stable id used as DB key + URL slug + Slack emoji prefix
 *   - resolves to a persona file in persona/apex/party/<ROLE>.md
 *
 * Order in DEFAULT_ROSTER is the speaking order in sequential mode.
 * Master is NOT in the roster — it's invoked separately at synthesis.
 */

export type AgentRole =
  | 'analyst'
  | 'pm'
  | 'architect'
  | 'dev'
  | 'qa'
  | 'ux'
  | 'master';

export interface AgentSpec {
  role: AgentRole;
  /** First name only — used in @-mentions and short references. */
  name: string;
  /** Human-readable title, e.g. "the Recorder". */
  title: string;
  /** Full display string, "<Name>, <Title>" — used in transcripts and Slack. */
  display: string;
  /** Hex accent color for the dashboard (no #). */
  accent: string;
  /** Single Unicode glyph for compact UI use (favicons, footer chips). */
  glyph: string;
  emoji: string;       // single Slack emoji shortcode (no colons)
  personaFileName: string;  // basename inside party/ persona dir
}

// Egyptian-syncretic council. Anubis weighs hearts against Maat's feather —
// the adversarial / synthesis pair has a literal mythological reason to coexist.
// Role keys (analyst, pm, …) are stable IDs across DB + flags; only the
// display identity changes.
export const AGENTS: Record<AgentRole, AgentSpec> = {
  analyst:   { role: 'analyst',   name: 'Seshat', title: 'the Recorder',     display: 'Seshat, the Recorder',     accent: '46d3ff', glyph: '𓎬', emoji: 'scroll',              personaFileName: 'SESHAT.md' },
  pm:        { role: 'pm',        name: 'Hermes', title: 'the Herald',       display: 'Hermes, the Herald',       accent: 'ffd166', glyph: '𓅮', emoji: 'mailbox_with_mail',   personaFileName: 'HERMES.md' },
  architect: { role: 'architect', name: 'Ptah',   title: 'the Architect',    display: 'Ptah, the Architect',      accent: '60a5fa', glyph: '𓉴', emoji: 'classical_building',  personaFileName: 'PTAH.md' },
  dev:       { role: 'dev',       name: 'Khnum',  title: 'the Smith',        display: 'Khnum, the Smith',         accent: 'fb923c', glyph: '𓏏', emoji: 'hammer_and_pick',     personaFileName: 'KHNUM.md' },
  qa:        { role: 'qa',        name: 'Anubis', title: 'the Weigher',      display: 'Anubis, the Weigher',      accent: 'a78bfa', glyph: '𓃢', emoji: 'balance_scale',       personaFileName: 'ANUBIS.md' },
  ux:        { role: 'ux',        name: 'Hathor', title: 'the Empath',       display: 'Hathor, the Empath',       accent: 'f472b6', glyph: '𓁥', emoji: 'sparkles',            personaFileName: 'HATHOR.md' },
  master:    { role: 'master',    name: 'Maat',   title: 'the Harmonizer',   display: 'Maat, the Harmonizer',     accent: 'fbbf24', glyph: '𓆄', emoji: 'feather',             personaFileName: 'MAAT.md' },
};

/** The default roster invoked by `/party <topic>` with no flags. */
export const DEFAULT_ROSTER: AgentRole[] = [
  'analyst',
  'pm',
  'architect',
  'dev',
  'qa',
  'ux',
];

/**
 * Resolve a role to its absolute persona-file path. partyDir is
 * persona/apex/party/. Validates the file exists is callers' job.
 */
export function personaFilePath(partyDir: string, role: AgentRole): string {
  return path.join(partyDir, AGENTS[role].personaFileName);
}

/** Parse `--with analyst,pm,architect` into a roster. */
export function parseRoster(input: string): AgentRole[] | null {
  const parts = input
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: AgentRole[] = [];
  for (const p of parts) {
    if (!(p in AGENTS) || p === 'master') return null;
    out.push(p as AgentRole);
  }
  return out;
}
