import type { Episode } from '../memory/episodic';

export interface ReflectionContext {
  threadKey: string;
  channelName: string;
  channelId: string;
  threadTs: string;
  senderPeerId: string;
  senderDisplayName: string;
  episodes: Episode[];
  numTurns: number;
  totalCostUsd: number;
  startedAt: number;
  endedAt: number;
}

/**
 * The strict-JSON shape Thoth must emit. Mirrored exactly in parser.ts.
 *
 * Bound the model so it can't drift: enumerate keys, give each a hint,
 * forbid commentary outside the object.
 */
export const REFLECTION_JSON_SCHEMA_HINT = `{
  "outcome": "success" | "partial" | "failure",
  "what_worked": "<1-3 sentences, concrete>",
  "what_didnt": "<1-3 sentences, concrete, or null if outcome=success>",
  "should_skill": <true | false>,
  "skill_slug": "<kebab-case-name>" | null,
  "skill_description": "<one-line, when to use this skill>" | null,
  "skill_body": "<full SKILL.md markdown body, or null>",
  "memory_notes": ["<short note worth retaining for future sessions>", ...],
  "persona_observations": ["<observation about Thoth's behavior worth flagging to founder>", ...],
  "next_check_at": "<ISO-8601 datetime if a follow-up is genuinely warranted>" | null,
  "user_model_updates": {
    "<peer_id>": ["<observation about this user worth feeding to Honcho>", ...]
  }
}`;

const RULES = [
  'Be honest. If outcome was failure, say so plainly.',
  'Do NOT propose skills for one-off requests. The bar is "this will recur and a skill saves time".',
  'Do NOT propose persona_observations that contradict the existing rules in RULES.md.',
  'Do NOT include any string matching /hermes|openclaw|nanoclaw|claw/i in any field — those trigger Anthropic harness detection.',
  'Output strictly one JSON object. No prose before or after. No code fences. No commentary.',
  'If you have nothing for an array field, use [] (empty). If a field is null-able and you have nothing, use null.',
  'memory_notes should be short imperative facts, e.g. "Aidan prefers no preamble; jump to the answer".',
  'skill_body, when proposed, MUST be valid SKILL.md content with YAML frontmatter (description, allowed-tools optional).',
] as const;

/** Build the full reflection prompt to feed to a fresh `claude -p`. */
export function buildReflectionPrompt(ctx: ReflectionContext): string {
  const transcript = formatTranscript(ctx.episodes);
  const startedIso = new Date(ctx.startedAt).toISOString();
  const endedIso = new Date(ctx.endedAt).toISOString();

  return [
    '# Reflection task',
    '',
    'You are Thoth reviewing a Slack-driven session you just completed. Critique it.',
    'Output ONE strict JSON object that matches this schema EXACTLY:',
    '',
    '```json',
    REFLECTION_JSON_SCHEMA_HINT,
    '```',
    '',
    '## Rules',
    ...RULES.map((r) => `- ${r}`),
    '',
    '## Session metadata',
    `- thread_key: ${ctx.threadKey}`,
    `- channel: ${ctx.channelName} (${ctx.channelId})`,
    `- thread_ts: ${ctx.threadTs}`,
    `- sender_peer: ${ctx.senderPeerId} (${ctx.senderDisplayName})`,
    `- num_turns: ${ctx.numTurns}`,
    `- total_cost_usd: ${ctx.totalCostUsd.toFixed(4)}`,
    `- started_at: ${startedIso}`,
    `- ended_at: ${endedIso}`,
    `- duration_min: ${Math.round((ctx.endedAt - ctx.startedAt) / 60000)}`,
    '',
    '## Transcript',
    '',
    transcript,
    '',
    '## Your output',
    '',
    'Emit the JSON object now. Nothing else.',
  ].join('\n');
}

function formatTranscript(episodes: Episode[]): string {
  if (episodes.length === 0) {
    return '_(no episodes recorded for this session — reflect on the metadata only)_';
  }
  const lines: string[] = [];
  let i = 1;
  for (const ep of episodes) {
    const ts = new Date(ep.created_at).toISOString().slice(11, 19);
    lines.push(`### Turn ${i} · ${ts} · peer=${ep.sender_peer}`);
    lines.push('');
    lines.push(`**user:** ${ep.user_text}`);
    lines.push('');
    lines.push(`**apex:** ${ep.apex_summary}`);
    lines.push('');
    i++;
  }
  return lines.join('\n');
}
