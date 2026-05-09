/**
 * Confidence-protocol parsing.
 *
 * Each party agent ends every contribution with a fenced or inline
 * confidence line in the form:
 *
 *   confidence: 0.74
 *
 * Loose match — accepts variations like "Confidence: 0.74", "**confidence:**
 * 0.74", or a fenced code block. Returns null when no match found.
 *
 * Reflexively clamped to [0, 1] in case the model emits 1.5 or -0.1.
 */

const CONFIDENCE_PATTERNS: RegExp[] = [
  /confidence\s*[:=]\s*([01](?:\.\d+)?)/i,
  /\*\*confidence\*\*\s*[:=]\s*([01](?:\.\d+)?)/i,
  /^[> ]*confidence:\s*([01](?:\.\d+)?)\s*$/im,
];

export function parseConfidence(text: string): number | null {
  if (!text) return null;
  for (const pat of CONFIDENCE_PATTERNS) {
    const m = pat.exec(text);
    if (m && m[1]) {
      const v = parseFloat(m[1]);
      if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
    }
  }
  return null;
}

/**
 * Strip the trailing confidence line from a contribution before storing
 * or rendering. Keeps transcripts cleaner — the parsed value is stored
 * in a separate column.
 */
export function stripConfidenceLine(text: string): string {
  if (!text) return text;
  return text
    .replace(/\n+\s*\**\s*confidence\s*[:=]\s*[01](?:\.\d+)?\s*\**\s*$/i, '')
    .trimEnd();
}

/** Average confidence across an array, ignoring nulls. */
export function avgConfidence(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null);
  if (real.length === 0) return null;
  return real.reduce((a, b) => a + b, 0) / real.length;
}
