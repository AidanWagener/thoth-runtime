import type { Readable } from 'stream';

export interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  // Loose: stream-json events vary widely across versions.
  [key: string]: unknown;
}

/**
 * Parse claude's --output-format stream-json output.
 *
 * The output is newline-delimited JSON: each line is a complete event.
 * This iterator buffers across chunk boundaries (a chunk may split a
 * line) and silently skips malformed lines so a single bad event can't
 * abort the whole stream.
 */
export async function* parseStream(
  stdout: Readable,
): AsyncGenerator<StreamEvent, void, void> {
  let buffer = '';
  for await (const chunk of stdout) {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = tryParse(line);
      if (event) yield event;
    }
  }
  const tail = buffer.trim();
  if (tail) {
    const event = tryParse(tail);
    if (event) yield event;
  }
}

function tryParse(line: string): StreamEvent | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed as StreamEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract token-level text from a `stream_event` content_block_delta.
 *
 * Shape: { type: "stream_event", event: { type: "content_block_delta",
 *           delta: { type: "text_delta", text: "..." } } }
 */
export function extractStreamingText(event: StreamEvent): string | null {
  if (event.type !== 'stream_event') return null;
  const inner = (event as any).event;
  if (
    !inner ||
    typeof inner !== 'object' ||
    inner.type !== 'content_block_delta'
  ) {
    return null;
  }
  const delta = inner.delta;
  if (delta && typeof delta === 'object' && typeof delta.text === 'string') {
    return delta.text as string;
  }
  return null;
}

/**
 * Extract text from the consolidated final `assistant` envelope.
 *
 * Use this only as a fallback when no streaming deltas were observed
 * (i.e., --include-partial-messages wasn't honored, or the model
 * returned via a non-streaming path). Otherwise the text duplicates
 * what we already streamed.
 *
 * Shape: { type: "assistant", message: { content: [{ type: "text",
 *           text: "..." }] } }
 */
export function extractFinalAssistantText(
  event: StreamEvent,
): string | null {
  if (event.type !== 'assistant') return null;
  const msg = (event as any).message;
  const blocks = msg?.content;
  if (!Array.isArray(blocks)) return null;
  const out: string[] = [];
  for (const b of blocks) {
    if (b && b.type === 'text' && typeof b.text === 'string') {
      out.push(b.text);
    }
  }
  return out.length > 0 ? out.join('') : null;
}

export interface ResultSummary {
  sessionId?: string;
  totalCostUsd?: number;
  numTurns?: number;
  isError?: boolean;
  errorText?: string;
}

export function extractResult(event: StreamEvent): ResultSummary | null {
  if (event.type !== 'result') return null;
  const e = event as any;
  return {
    sessionId: typeof e.session_id === 'string' ? e.session_id : undefined,
    totalCostUsd:
      typeof e.total_cost_usd === 'number' ? e.total_cost_usd : undefined,
    numTurns: typeof e.num_turns === 'number' ? e.num_turns : undefined,
    isError: e.subtype === 'error_max_turns' || e.is_error === true,
    errorText: typeof e.error === 'string' ? e.error : undefined,
  };
}

export function extractInitSessionId(event: StreamEvent): string | null {
  if (event.type !== 'system') return null;
  if ((event as any).subtype !== 'init') return null;
  const sid = (event as any).session_id;
  return typeof sid === 'string' ? sid : null;
}
