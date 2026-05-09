// Unit tests for stream-parser. High value because Anthropic's
// stream-json output format can change between Claude CLI versions —
// these tests catch regressions in our parser before they hit production.

import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import { parseStream, extractStreamingText, type StreamEvent } from './stream-parser';

function streamFrom(...chunks: string[]): Readable {
  return Readable.from(chunks);
}

async function collect(stream: Readable): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of parseStream(stream)) out.push(e);
  return out;
}

describe('parseStream', () => {
  it('parses a single complete event on one line', async () => {
    const stream = streamFrom('{"type":"system","subtype":"init"}\n');
    const events = await collect(stream);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'system', subtype: 'init' });
  });

  it('parses multiple events separated by newlines', async () => {
    const stream = streamFrom(
      '{"type":"system","subtype":"init"}\n' +
        '{"type":"assistant","content":[]}\n' +
        '{"type":"result","total_cost_usd":0.123}\n',
    );
    const events = await collect(stream);
    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe('system');
    expect(events[1]?.type).toBe('assistant');
    expect(events[2]?.type).toBe('result');
  });

  it('handles a chunk boundary mid-line', async () => {
    // Same payload, but split awkwardly
    const stream = streamFrom(
      '{"type":"system","sub',
      'type":"init"}\n{"type":"result"}',
    );
    const events = await collect(stream);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('system');
    expect(events[1]?.type).toBe('result');
  });

  it('handles trailing event with no terminating newline', async () => {
    const stream = streamFrom('{"type":"result","status":"ok"}');
    const events = await collect(stream);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'result', status: 'ok' });
  });

  it('skips empty lines silently', async () => {
    const stream = streamFrom(
      '\n\n{"type":"system"}\n\n\n{"type":"result"}\n\n',
    );
    const events = await collect(stream);
    expect(events).toHaveLength(2);
  });

  it('skips malformed JSON lines without aborting', async () => {
    const stream = streamFrom(
      '{"type":"system"}\n' +
        '{not valid json}\n' +
        '{"type":"result"}\n',
    );
    const events = await collect(stream);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('system');
    expect(events[1]?.type).toBe('result');
  });

  it('skips lines that parse but lack `type` field', async () => {
    const stream = streamFrom(
      '{"type":"system"}\n' +
        '{"only_data":"no_type_field"}\n' +
        '{"type":"result"}\n',
    );
    const events = await collect(stream);
    expect(events).toHaveLength(2);
  });

  it('handles Buffer chunks (not just strings)', async () => {
    const stream = Readable.from([
      Buffer.from('{"type":"system"}\n', 'utf8'),
      Buffer.from('{"type":"result"}\n', 'utf8'),
    ]);
    const events = await collect(stream);
    expect(events).toHaveLength(2);
  });

  it('handles a long event split across many small chunks', async () => {
    const big = '{"type":"assistant","content":"' + 'a'.repeat(500) + '"}';
    const chunks: string[] = [];
    for (let i = 0; i < big.length; i += 50) {
      chunks.push(big.slice(i, i + 50));
    }
    chunks.push('\n');
    const stream = streamFrom(...chunks);
    const events = await collect(stream);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('assistant');
  });
});

describe('extractStreamingText', () => {
  it('returns text from a content_block_delta', () => {
    const event: StreamEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hello' },
      },
    } as unknown as StreamEvent;
    expect(extractStreamingText(event)).toBe('hello');
  });

  it('returns null for non-stream_event types', () => {
    expect(extractStreamingText({ type: 'system' } as StreamEvent)).toBeNull();
    expect(extractStreamingText({ type: 'result' } as StreamEvent)).toBeNull();
  });

  it('returns null when inner event is missing', () => {
    expect(extractStreamingText({ type: 'stream_event' } as StreamEvent)).toBeNull();
  });

  it('returns null when delta has no text field', () => {
    const event: StreamEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'something_else' },
      },
    } as unknown as StreamEvent;
    expect(extractStreamingText(event)).toBeNull();
  });
});
