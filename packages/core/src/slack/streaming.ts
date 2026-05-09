import type { WebClient } from '@slack/web-api';
import { logger } from '../logger';

const MIN_UPDATE_INTERVAL_MS = 1000;

/**
 * Per-message text cap. Slack returns `msg_too_long` for chat.postMessage
 * / chat.update payloads where `text` exceeds ~4,000 characters in
 * practice (despite older docs citing 40k). 3,500 leaves headroom for
 * the continuation footer + Slack's own rendering quirks. When a stream
 * grows past this cap, the streamer finalizes the current chunk with a
 * "(continued ↓)" footer and opens a fresh threaded message for the
 * remainder, transparent to callers.
 */
const SLACK_CHUNK_LIMIT = 3500;
const CONTINUE_FOOTER = '\n\n_(continued ↓)_';
const CONTINUE_HEADER = '_(continued from ↑)_\n\n';

/**
 * Posts a placeholder message in the target Slack channel/thread, then
 * progressively updates it (chat.update) as text arrives. Throttled to
 * one update per ~second to stay under Tier 3 rate limits.
 *
 * For long outputs (> ~3.5k chars) the streamer rolls over into one or
 * more continuation messages within the same thread. Episode storage
 * keeps the FIRST chunk's ts as the canonical reply ts (used by reaction
 * routing), but `allPostedTsList()` exposes the full chain.
 *
 * NOTE: this uses chat.postMessage + chat.update — the proven pattern
 * across all Slack workspace tiers. The newer chat.startStream API
 * (Oct 2025) is a future upgrade.
 */
export class SlackStreamer {
  /** All text streamed so far (full transcript across chunks). */
  private fullText = '';
  /** How many chars of fullText have been "committed" to prior chunks. */
  private committedLen = 0;
  /** Timestamps of all messages posted so far, in order (chunk 0 first). */
  private postedTsList: string[] = [];
  private lastUpdateAt = 0;
  private finalized = false;
  private pendingUpdate: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: WebClient,
    private readonly channel: string,
    private readonly threadTs: string,
  ) {}

  async start(initial = ':hourglass_flowing_sand: thinking…'): Promise<void> {
    const r = await this.client.chat.postMessage({
      channel: this.channel,
      thread_ts: this.threadTs,
      text: initial,
    });
    if (!r.ts) throw new Error('chat.postMessage returned no ts');
    this.postedTsList.push(r.ts);
  }

  /** ts of the FIRST chunk's message — used to anchor reactions/episodes. */
  get postedMessageTs(): string | null {
    return this.postedTsList[0] ?? null;
  }

  /** All message ts values posted by this streamer, oldest first. */
  allPostedTsList(): string[] {
    return [...this.postedTsList];
  }

  async append(text: string): Promise<void> {
    if (this.finalized || this.postedTsList.length === 0) return;
    this.fullText += text;
    const now = Date.now();
    const elapsed = now - this.lastUpdateAt;
    if (elapsed >= MIN_UPDATE_INTERVAL_MS) {
      await this.flush();
    } else if (!this.pendingUpdate) {
      this.pendingUpdate = setTimeout(() => {
        this.pendingUpdate = null;
        void this.flush();
      }, MIN_UPDATE_INTERVAL_MS - elapsed);
    }
  }

  private currentMessageTs(): string | null {
    return this.postedTsList[this.postedTsList.length - 1] ?? null;
  }

  private currentChunkText(): string {
    return this.fullText.slice(this.committedLen);
  }

  /**
   * If the current chunk's text plus any header overhead would exceed
   * the per-message cap, "roll over" by:
   *   1. Updating the current message with the head + CONTINUE_FOOTER
   *   2. Marking that head as committed
   *   3. Posting a fresh threaded message to receive subsequent text
   *
   * Repeats if a single append straddled multiple chunk boundaries.
   */
  private async maybeRollover(): Promise<void> {
    while (this.currentChunkText().length > SLACK_CHUNK_LIMIT) {
      const cts = this.currentMessageTs();
      if (!cts) return;
      const isFirstChunk = this.postedTsList.length === 1;
      const header = isFirstChunk ? '' : CONTINUE_HEADER;
      // Headroom for the header that lives in the chunk text vs the
      // footer that lives outside it. We need: header + body + footer
      // <= SLACK_CHUNK_LIMIT. body = chunkText.slice(0, headLen).
      const budget = SLACK_CHUNK_LIMIT - header.length - CONTINUE_FOOTER.length;
      const headLen = Math.max(0, budget);
      const head = this.currentChunkText().slice(0, headLen);
      const closingText = header + head + CONTINUE_FOOTER;

      try {
        await this.client.chat.update({
          channel: this.channel,
          ts: cts,
          text: closingText,
        });
      } catch (err) {
        logger.warn(
          { err: String(err), ts: cts, len: closingText.length },
          'rollover: closing chat.update failed',
        );
        // Stop rolling — surface the original failure rather than spin.
        return;
      }
      // Commit the head so the next chunk starts after it.
      this.committedLen += head.length;

      // Open the next message in the same thread.
      try {
        const r = await this.client.chat.postMessage({
          channel: this.channel,
          thread_ts: this.threadTs,
          text: CONTINUE_HEADER + '_…_',
        });
        if (!r.ts) {
          logger.warn('rollover: chat.postMessage returned no ts');
          return;
        }
        this.postedTsList.push(r.ts);
      } catch (err) {
        logger.warn({ err: String(err) }, 'rollover: chat.postMessage failed');
        return;
      }
    }
  }

  private async flush(): Promise<void> {
    if (this.finalized || this.postedTsList.length === 0) return;
    this.lastUpdateAt = Date.now();

    // Spill into continuation messages if the buffer overflowed.
    await this.maybeRollover();

    const cts = this.currentMessageTs();
    if (!cts) return;
    const text = this.renderCurrentChunkBody();

    try {
      await this.client.chat.update({
        channel: this.channel,
        ts: cts,
        text,
      });
    } catch (err) {
      logger.warn(
        { err: String(err), len: text.length, ts: cts },
        'chat.update failed; retrying on next tick',
      );
    }
  }

  async finalize(footer: string): Promise<void> {
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }
    if (this.postedTsList.length === 0) return;
    this.finalized = true;

    // Last spill before the footer goes on.
    await this.maybeRollover();

    const cts = this.currentMessageTs();
    if (!cts) return;
    const body = this.renderCurrentChunkBody();
    const text = footer ? `${body}\n\n${footer}` : body;
    // Even with rollover, the final chunk + footer can still get close
    // to the cap. Hard-clip as a last line of defense.
    const safe = text.length > SLACK_CHUNK_LIMIT
      ? text.slice(0, SLACK_CHUNK_LIMIT - 24) + '… _(clipped)_'
      : text;
    try {
      await this.client.chat.update({
        channel: this.channel,
        ts: cts,
        text: safe,
      });
    } catch (err) {
      logger.error(
        { err: String(err), len: safe.length, ts: cts },
        'finalize chat.update failed',
      );
    }
  }

  /** Append a transient status line below the streaming body. */
  async error(message: string): Promise<void> {
    if (this.postedTsList.length === 0) {
      await this.client.chat.postMessage({
        channel: this.channel,
        thread_ts: this.threadTs,
        text: `:x: ${message}`,
      });
      return;
    }
    this.finalized = true;
    const cts = this.currentMessageTs();
    if (!cts) return;
    try {
      await this.client.chat.update({
        channel: this.channel,
        ts: cts,
        text: `${this.renderCurrentChunkBody()}\n\n:x: ${message}`,
      });
    } catch (err) {
      logger.error({ err: String(err) }, 'error chat.update failed');
    }
  }

  /**
   * Body of the *currently-active* chunk only — i.e. everything since
   * the last rollover boundary. Earlier chunks are already finalized
   * with their own continuation footers and are not re-rendered.
   */
  private renderCurrentChunkBody(): string {
    const chunkText = this.currentChunkText();
    const isFirstChunk = this.postedTsList.length === 1;
    if (chunkText.length === 0) return '_…_';
    return (isFirstChunk ? '' : CONTINUE_HEADER) + chunkText;
  }
}
