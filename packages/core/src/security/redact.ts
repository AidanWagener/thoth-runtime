/**
 * Redaction pass for any text we're about to write to durable storage
 * (MEMORY.md via 🧠 reaction, persona DMs, log lines, etc.).
 *
 * Patterns are intentionally conservative — false positives are fine,
 * false negatives are not. Each match is replaced with [REDACTED:<kind>]
 * so a future reader can tell what kind of secret was elided without
 * exposing the value.
 */

interface RedactionRule {
  kind: string;
  pattern: RegExp;
}

const RULES: RedactionRule[] = [
  // Slack tokens
  { kind: 'slack-bot-token', pattern: /xoxb-[A-Za-z0-9-]{20,}/g },
  { kind: 'slack-app-token', pattern: /xapp-[A-Za-z0-9-]{20,}/g },
  { kind: 'slack-user-token', pattern: /xoxp-[A-Za-z0-9-]{20,}/g },
  { kind: 'slack-config-token', pattern: /xoxe\.[A-Za-z0-9-]{20,}/g },

  // GitHub tokens
  { kind: 'github-pat-fine', pattern: /github_pat_[A-Za-z0-9_]{50,}/g },
  { kind: 'github-pat-classic', pattern: /ghp_[A-Za-z0-9]{30,}/g },
  { kind: 'github-oauth', pattern: /gho_[A-Za-z0-9]{30,}/g },
  { kind: 'github-app-server', pattern: /ghs_[A-Za-z0-9]{30,}/g },
  { kind: 'github-app-user', pattern: /ghu_[A-Za-z0-9]{30,}/g },

  // Anthropic / Honcho / OpenAI / OpenRouter / generic API keys
  { kind: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{30,}/g },
  { kind: 'honcho-key', pattern: /hch-v\d+-[A-Za-z0-9]{30,}/g },
  { kind: 'openai-key', pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{30,}/g },
  { kind: 'openrouter-key', pattern: /sk-or-v\d+-[A-Za-z0-9]{30,}/g },

  // AWS-style
  { kind: 'aws-access', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'aws-secret', pattern: /\b[A-Za-z0-9/+]{40}\b(?=[^A-Za-z0-9/+])/g },

  // Generic .env-style assignments containing the words KEY/SECRET/TOKEN/PASSWORD
  // (matches the value, leaves the variable name intact)
  {
    kind: 'env-secret',
    pattern:
      /([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PWD)[A-Z0-9_]*)\s*=\s*["']?([^"'\s]{8,})["']?/g,
  },
];

export interface RedactionResult {
  text: string;
  replacements: { kind: string; count: number }[];
  redacted: boolean;
}

/**
 * Redact any matched secrets in `input`. Returns the cleaned text plus
 * a count of how many of each kind were elided so callers can log or
 * surface that to the user without leaking the values.
 */
export function redact(input: string): RedactionResult {
  if (!input) {
    return { text: input, replacements: [], redacted: false };
  }
  let text = input;
  const counts = new Map<string, number>();
  for (const rule of RULES) {
    if (rule.kind === 'env-secret') {
      // Special case: keep the env-var name, replace only the value.
      text = text.replace(rule.pattern, (_match, name: string) => {
        counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
        return `${name}=[REDACTED:${rule.kind}]`;
      });
    } else {
      text = text.replace(rule.pattern, () => {
        counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
        return `[REDACTED:${rule.kind}]`;
      });
    }
  }
  const replacements = [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  return {
    text,
    replacements,
    redacted: replacements.length > 0,
  };
}

/** Convenience: returns true if any rule would match `input`. */
export function containsSecrets(input: string): boolean {
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(input)) return true;
  }
  return false;
}
