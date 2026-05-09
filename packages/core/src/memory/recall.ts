import { HonchoClient, type DialecticResult } from './honcho';
import type { SlackIdentity } from '../slack/identity';
import { logger } from '../logger';
import { eventBus } from '../dashboard/event-bus';

/**
 * Build the <user-model> block injected into Thoth's user prompt.
 *
 * Skip rules (avoid burning tokens / latency on enrichments unlikely to
 * pay off):
 *   1. Resumed sessions — Thoth already has the user's prior context
 *      via --resume; another dialectic dump would be redundant.
 *   2. Trivial messages (under 20 chars) — usually 'ok', 'thanks',
 *      one-word follow-ups; not enough surface for the dialectic to
 *      add signal.
 *   3. Per-peer cooldown — last query for the same peer was within
 *      the cooldown window (default 60s).
 */
export interface RecallOptions {
  isResume: boolean;
  cooldownMs?: number;
  minMessageChars?: number;
}

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MIN_CHARS = 20;

const lastQueryAt = new Map<string, number>();

/**
 * Probe Honcho for a per-turn user-model and format an XML-ish block
 * suitable for prepending to the user prompt.
 *
 * Returns an empty string when no enrichment is warranted or available.
 * Never throws.
 */
export async function buildUserModelBlock(
  honcho: HonchoClient,
  identity: SlackIdentity,
  userMessage: string,
  opts: RecallOptions,
): Promise<string> {
  if (!honcho.enabled) return '';
  if (opts.isResume) return '';

  const minChars = opts.minMessageChars ?? DEFAULT_MIN_CHARS;
  if (userMessage.trim().length < minChars) return '';

  const cooldown = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const peerId = identity.user.id;
  const last = lastQueryAt.get(peerId) ?? 0;
  if (Date.now() - last < cooldown) return '';
  lastQueryAt.set(peerId, Date.now());

  const query = buildDialecticQuery(identity, userMessage);
  let result: DialecticResult | null;
  try {
    result = await honcho.dialectic(peerId, query);
  } catch (err) {
    logger.debug({ err: String(err), peerId }, 'recall dialectic threw (soft)');
    eventBus.emitEvent({ kind: 'honcho.dialectic', ts: Date.now(), peer: peerId, latencyMs: 0, hadResponse: false });
    return '';
  }
  eventBus.emitEvent({
    kind: 'honcho.dialectic',
    ts: Date.now(),
    peer: peerId,
    latencyMs: result?.latencyMs ?? 0,
    hadResponse: !!result,
  });
  if (!result) return '';

  return formatUserModelBlock(result, identity);
}

function buildDialecticQuery(identity: SlackIdentity, userMessage: string): string {
  // Concise, model-specific framing. The dialectic agent reads this as
  // a natural-language question about the peer's representation.
  return [
    `In one short paragraph, tell me what's most relevant about this user`,
    `for responding to their next message. Cover: communication preferences,`,
    `domain context, tone, anything they recently struggled with or liked.`,
    `If you don't have signal yet, say "no signal" — do not invent.`,
    ``,
    `User display name: ${identity.user.displayName}`,
    `Their current message (for context only — answer about THEM, not the message):`,
    `> ${userMessage.slice(0, 500)}`,
  ].join('\n');
}

function formatUserModelBlock(result: DialecticResult, identity: SlackIdentity): string {
  // Filter no-signal responses so we don't pollute the prompt.
  const c = result.content.trim();
  if (/^no signal\b/i.test(c)) return '';
  if (c.length < 20) return '';

  return [
    `<user-model source="honcho" peer="${identity.user.id}" latency_ms="${result.latencyMs}">`,
    indent(c, 2),
    `</user-model>`,
  ].join('\n');
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s
    .split('\n')
    .map((l) => (l.length > 0 ? pad + l : l))
    .join('\n');
}
