import { z } from 'zod';
import { logger } from '../logger';

/**
 * Strict zod schema mirroring REFLECTION_JSON_SCHEMA_HINT in prompts.ts.
 *
 * Permissive on what it accepts (`null` and `undefined` interchangeable
 * for nullable fields), strict on what it produces — every field is
 * either present and well-formed or normalized to a sentinel.
 */
const NullableString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : null));

const StringList = z
  .union([z.array(z.string()), z.null(), z.undefined()])
  .transform((v) => (Array.isArray(v) ? v.map((s) => s.trim()).filter(Boolean) : []));

const Iso8601 = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (typeof v !== 'string') return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  });

export const reflectionSchema = z.object({
  outcome: z.enum(['success', 'partial', 'failure']),
  what_worked: NullableString,
  what_didnt: NullableString,
  should_skill: z.boolean().default(false),
  skill_slug: NullableString.refine(
    (s) => s === null || /^[a-z][a-z0-9-]{1,49}$/.test(s),
    'skill_slug must be kebab-case, 2-50 chars, starting with a letter',
  ),
  skill_description: NullableString,
  skill_body: NullableString,
  memory_notes: StringList,
  persona_observations: StringList,
  next_check_at: Iso8601,
  user_model_updates: z
    .union([z.record(z.string(), z.array(z.string())), z.null(), z.undefined()])
    .transform((v) => {
      if (!v || typeof v !== 'object') return {};
      const out: Record<string, string[]> = {};
      for (const [peerId, notes] of Object.entries(v)) {
        if (Array.isArray(notes)) {
          const cleaned = notes.map((s) => String(s).trim()).filter(Boolean);
          if (cleaned.length > 0) out[peerId] = cleaned;
        }
      }
      return out;
    }),
});

export type Reflection = z.infer<typeof reflectionSchema>;

/**
 * Parse Thoth's reflection output. The model occasionally wraps JSON in
 * ```json fences or adds prose; we strip those before parsing.
 *
 * Returns null if parsing or schema validation fails. Caller treats
 * null as "no reflection writes this session — log and move on".
 */
export function parseReflection(rawOutput: string): Reflection | null {
  const stripped = stripCodeFences(rawOutput).trim();
  if (!stripped) {
    logger.warn('reflection output is empty');
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch {
    // Recover by scanning for the largest JSON object substring.
    const candidate = extractLargestJsonObject(stripped);
    if (!candidate) {
      logger.warn(
        { previewLen: stripped.length, preview: stripped.slice(0, 200) },
        'reflection: no parseable JSON object in output',
      );
      return null;
    }
    try {
      json = JSON.parse(candidate);
    } catch (err) {
      logger.warn(
        { err: String(err), candidatePreview: candidate.slice(0, 200) },
        'reflection: JSON object recovery failed',
      );
      return null;
    }
  }

  const parsed = reflectionSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.format() },
      'reflection: schema validation failed',
    );
    return null;
  }

  // Final harness-keyword guard. Reject the whole reflection if any
  // field contains a banned token — never write those into our memory.
  const banned = /\b(hermes|openclaw|nanoclaw|claw)\b/i;
  const allText = JSON.stringify(parsed.data);
  if (banned.test(allText)) {
    logger.warn(
      { match: banned.exec(allText)?.[0] },
      'reflection: banned keyword found, rejecting whole reflection',
    );
    return null;
  }

  return parsed.data;
}

function stripCodeFences(s: string): string {
  // Remove leading ```json / ```jsonl etc. and trailing ```
  return s
    .replace(/^\s*```(?:json|jsonl)?\s*\n?/, '')
    .replace(/\n?\s*```\s*$/, '');
}

function extractLargestJsonObject(s: string): string | null {
  // Find { ... } pair with balanced braces. Walk the string once.
  let depth = 0;
  let start = -1;
  let bestStart = -1;
  let bestEnd = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const len = i - start + 1;
        if (len > bestEnd - bestStart) {
          bestStart = start;
          bestEnd = i + 1;
        }
      }
    }
  }
  if (bestStart < 0) return null;
  return s.slice(bestStart, bestEnd);
}
