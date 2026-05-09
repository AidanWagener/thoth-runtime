import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import fs from 'fs/promises';
import path from 'path';
import type { Config } from '../config';
import { SessionStore } from '../session/store';
import { Allowlist } from '../policy/allowlist';
import { spawnClaude } from '../claude/spawn';
import {
  parseStream,
  extractStreamingText,
  extractFinalAssistantText,
  extractInitSessionId,
  extractResult,
} from '../claude/stream-parser';
import { SlackStreamer } from './streaming';
import { fingerprint as personaFingerprint } from '../bootstrap/persona-loader';
import { logger } from '../logger';
import {
  resolveIdentity,
  formatSlackMeta,
  type SlackIdentity,
} from './identity';
import type { HonchoClient } from '../memory/honcho';
import { buildUserModelBlock } from '../memory/recall';
import {
  EpisodicStore,
  formatRelatedEpisodesBlock,
} from '../memory/episodic';
import {
  orchestrateReflection,
  type OrchestratorDeps,
} from '../reflection/orchestrator';
import { scheduledRunStore } from '../scheduling/store';
import type { SyntheticDispatchFn } from '../scheduling/poller';
import { provenanceStore } from '../provenance/store';
import { eventBus } from '../dashboard/event-bus';
import type { PartyOrchestrator } from '../party/orchestrator';
import { partyStore } from '../party/store';
import { parseRoster, AGENTS, type AgentRole } from '../party/agents';

export interface HandlerDeps {
  app: App;
  config: Config;
  store: SessionStore;
  allowlist: Allowlist;
  personaPrompt: string;
  honcho?: HonchoClient;
  episodic?: EpisodicStore;
  /** When set, /done and idle-fire trigger this orchestrator. */
  orchestratorDeps?: OrchestratorDeps;
  /** When set, /party and /party-stop commands are handled. */
  partyOrchestrator?: PartyOrchestrator;
}

export interface HandlerExports {
  /** Synthetic dispatch — used by the scheduler to fire self-spawns. */
  dispatch: SyntheticDispatchFn;
}

export function registerHandlers(deps: HandlerDeps): HandlerExports {
  const { app, config, store, allowlist, personaPrompt, honcho, episodic, orchestratorDeps, partyOrchestrator } = deps;
  const active = new Set<string>();
  const activeParties = new Map<string, string>(); // threadKey -> partyId

  // -------- DM events --------
  app.event('message', async ({ event, client }) => {
    // Only direct messages from real humans. Filter all the noise.
    const e = event as unknown as Record<string, unknown>;
    if (e.channel_type !== 'im') return;
    if (e.bot_id) return;
    if (e.subtype) return; // message_changed, message_deleted, etc.
    if (typeof e.user !== 'string' || typeof e.text !== 'string') return;

    await dispatch(client, {
      userId: e.user,
      channel: e.channel as string,
      text: e.text,
      ts: e.ts as string,
      threadTs: (e.thread_ts as string) ?? (e.ts as string),
      isDm: true,
    });
  });

  // -------- Channel @-mentions --------
  app.event('app_mention', async ({ event, client }) => {
    const e = event as unknown as Record<string, unknown>;
    if (typeof e.user !== 'string' || typeof e.text !== 'string') return;
    await dispatch(client, {
      userId: e.user,
      channel: e.channel as string,
      text: stripMentions(e.text),
      ts: e.ts as string,
      threadTs: (e.thread_ts as string) ?? (e.ts as string),
      isDm: false,
    });
  });

  interface DispatchEvent {
    userId: string;
    channel: string;
    text: string;
    ts: string;
    threadTs: string;
    isDm: boolean;
  }

  async function dispatch(client: WebClient, ev: DispatchEvent): Promise<void> {
    const threadKey = `${ev.channel}:${ev.threadTs}`;

    if (!allowlist.has(ev.userId)) {
      logger.warn(
        { userId: ev.userId, channel: ev.channel },
        'denied: user not in allowlist',
      );
      return; // silent — no reply
    }

    if (active.has(threadKey)) {
      logger.warn({ threadKey }, 'thread already running, dropping duplicate');
      return;
    }
    if (active.size >= config.CONCURRENCY_CAP) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: `:hourglass: at capacity — ${active.size}/${config.CONCURRENCY_CAP} threads running. retry in a moment.`,
      });
      return;
    }
    if (!ev.text.trim()) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':information_source: empty message — say what you want me to do.',
      });
      return;
    }

    // ---- Magic command interception (handled before claude spawn) ----
    const trimmed = ev.text.trim();
    if (/^\/whoami(\s|$)/i.test(trimmed)) {
      await handleWhoami(client, ev);
      return;
    }
    const recallMatch = /^\/recall\s+(.+)$/i.exec(trimmed);
    if (recallMatch) {
      await handleRecall(client, ev, recallMatch[1]);
      return;
    }
    if (/^\/done(\s|$)/i.test(trimmed)) {
      await handleDone(client, ev);
      return;
    }
    if (/^\/help(\s|$)/i.test(trimmed)) {
      await handleHelp(client, ev);
      return;
    }
    if (/^\/loop-stop(\s|$)/i.test(trimmed)) {
      await handleLoopStop(client, ev);
      return;
    }
    if (/^\/party-stop(\s|$)/i.test(trimmed)) {
      await handlePartyStop(client, ev);
      return;
    }
    if (/^\/party-list(\s|$)/i.test(trimmed)) {
      await handlePartyList(client, ev);
      return;
    }
    const partySaveMatch = /^\/party-save\s+(\S+)(?:\s+(.+))?$/i.exec(trimmed);
    if (partySaveMatch) {
      await handlePartySave(client, ev, partySaveMatch[1], partySaveMatch[2] || '');
      return;
    }
    const partySpecMatch = /^\/party-spec(?:\s+(.+))?$/i.exec(trimmed);
    if (partySpecMatch) {
      await handleParty(client, ev, partySpecMatch[1] || '', { template: 'spec' });
      return;
    }
    const partyDecideMatch = /^\/party-decide(?:\s+(.+))?$/i.exec(trimmed);
    if (partyDecideMatch) {
      await handleParty(client, ev, partyDecideMatch[1] || '', { template: 'decision' });
      return;
    }
    const partyRetroMatch = /^\/party-retro(?:\s+(.+))?$/i.exec(trimmed);
    if (partyRetroMatch) {
      await handleParty(client, ev, partyRetroMatch[1] || '', { template: 'retro' });
      return;
    }
    const partyMatch = /^\/party(?:\s+(.+))?$/i.exec(trimmed);
    if (partyMatch) {
      await handleParty(client, ev, partyMatch[1] || '');
      return;
    }

    active.add(threadKey);
    try {
      const identity = await resolveIdentity(
        client,
        ev.userId,
        ev.channel,
        ev.isDm,
      );
      const existing = store.get(threadKey);
      eventBus.emitEvent({
        kind: 'message.received',
        ts: Date.now(),
        peer: ev.userId,
        peerName: identity.user.displayName,
        channel: ev.channel,
        channelName: identity.channel.name,
        threadKey,
        isResume: !!existing?.claude_session_id,
        preview: ev.text.slice(0, 200),
      });
      await runTurn(
        client,
        threadKey,
        ev.channel,
        ev.threadTs,
        ev.text,
        identity,
      );
    } catch (err) {
      logger.error({ err: String(err), threadKey }, 'turn failed');
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: `:x: error: \`${truncate(String(err), 500)}\``,
      });
    } finally {
      active.delete(threadKey);
    }
  }

  async function runTurn(
    client: WebClient,
    threadKey: string,
    channel: string,
    threadTs: string,
    prompt: string,
    identity: SlackIdentity,
  ): Promise<void> {
    const existing = store.get(threadKey);
    const currentFingerprint = await personaFingerprint(
      config.PERSONA_DIR,
      config.AETHER_RULES_PATH,
    );
    const personaChanged =
      !!existing && existing.persona_fingerprint !== currentFingerprint;

    // Resolve cwd: reuse the existing per-thread sandbox, else create one.
    let cwd: string;
    if (existing) {
      cwd = existing.cwd;
      try {
        await fs.access(cwd);
      } catch {
        await fs.mkdir(cwd, { recursive: true });
      }
    } else {
      const safe = threadKey.replace(/[^a-zA-Z0-9]/g, '_');
      cwd = path.join(config.SANDBOX_ROOT, safe);
      await fs.mkdir(cwd, { recursive: true });
    }

    // Resume? Only if we have a session id AND persona hasn't drifted.
    const resumeId =
      existing && !personaChanged ? existing.claude_session_id : undefined;

    if (existing && personaChanged) {
      logger.info({ threadKey }, 'persona drift — forking session');
    }

    // Provenance trail capture — every memory source that seeds the
    // context window gets logged here. Bound to the episode_id once
    // the episode is written. spawnStartedAt acts as the join key.
    const spawnStartedAt = Date.now();

    // Persona stack provenance (constant per-spawn — captured once).
    if (personaPrompt) {
      provenanceStore.insert({
        thread_key: threadKey,
        spawn_started_at: spawnStartedAt,
        kind: 'persona-stack',
        source_id: 'persona/apex',
        label: 'Thoth persona stack',
        chars: personaPrompt.length,
        score: null,
        payload_json: JSON.stringify({ fingerprint: currentFingerprint }),
      });
    }

    // Slack-context provenance (always present).
    const slackContext = formatSlackMeta(identity, threadTs);
    provenanceStore.insert({
      thread_key: threadKey,
      spawn_started_at: spawnStartedAt,
      kind: 'slack-context',
      source_id: identity.channel.id,
      label: `Slack context — ${identity.channel.name ?? identity.channel.id}`,
      chars: slackContext.length,
      score: null,
      payload_json: JSON.stringify({ peer: identity.user.id }),
    });

    // Honcho dialectic enrichment — bounded, soft-fail. Skip on resumes.
    let userModelBlock = '';
    if (honcho?.enabled) {
      userModelBlock = await buildUserModelBlock(honcho, identity, prompt, {
        isResume: !!resumeId,
      });
      if (userModelBlock) {
        logger.debug(
          { threadKey, peer: identity.user.id, chars: userModelBlock.length },
          'honcho user-model injected',
        );
        provenanceStore.insert({
          thread_key: threadKey,
          spawn_started_at: spawnStartedAt,
          kind: 'user-model',
          source_id: identity.user.id,
          label: `Honcho user-model for ${identity.user.id}`,
          chars: userModelBlock.length,
          score: null,
          payload_json: JSON.stringify({ preview: userModelBlock.slice(0, 240) }),
        });
      }
    }

    // Episodic recall — only on the first turn of a fresh thread. On
    // resumes, Thoth already has full context via --resume.
    let relatedBlock = '';
    if (episodic && !resumeId && prompt.trim().length >= 12) {
      try {
        const hits = await episodic.recall(prompt, {
          peerId: identity.user.id,
          topK: 3,
        });
        if (hits.length > 0) {
          relatedBlock = formatRelatedEpisodesBlock(hits);
          logger.debug(
            {
              threadKey,
              peer: identity.user.id,
              hits: hits.length,
              topScore: hits[0]?.score.toFixed(2),
            },
            'episodic related-episodes injected',
          );
          for (const hit of hits) {
            provenanceStore.insert({
              thread_key: threadKey,
              spawn_started_at: spawnStartedAt,
              kind: 'related-episode',
              source_id: String(hit.episode.id),
              label: `Episode #${hit.episode.id} — ${hit.episode.user_text.slice(0, 60).replace(/\n/g, ' ')}`,
              chars: (hit.episode.apex_summary || '').length + (hit.episode.user_text || '').length,
              score: hit.score,
              payload_json: JSON.stringify({
                rawScore: hit.rawScore,
                channelName: hit.episode.channel_name,
                createdAt: hit.episode.created_at,
              }),
            });
          }
        }
      } catch (err) {
        logger.warn({ err: String(err), threadKey }, 'episodic recall failed (soft)');
      }
    }

    // Prepend Slack metadata so Claude knows who is talking, in which
    // channel, on every turn — works on both fresh and resumed sessions.
    // Order: <slack-context> first (objective facts), then <user-model>
    // (Honcho enrichment), then <related-episodes> (cross-thread recall),
    // then the user's literal message.
    const wrappedPrompt = [
      formatSlackMeta(identity, threadTs),
      userModelBlock,
      relatedBlock,
      prompt,
    ]
      .filter((s) => s.length > 0)
      .join('\n\n');

    eventBus.emitEvent({
      kind: 'spawn.start',
      ts: Date.now(),
      threadKey,
      sandbox: cwd,
      isResume: !!resumeId,
    });
    const child = spawnClaude({
      prompt: wrappedPrompt,
      cwd,
      systemPrompt: resumeId ? undefined : personaPrompt,
      resumeSessionId: resumeId,
      maxTurns: config.MAX_TURNS,
      maxBudgetUsd: config.MAX_BUDGET_USD,
      claudeBin: config.CLAUDE_BIN,
    });

    const streamer = new SlackStreamer(client, channel, threadTs);
    await streamer.start();

    let sessionId: string | undefined = resumeId;
    let totalCost = existing?.total_cost_usd ?? 0;
    let numTurns = existing?.num_turns ?? 0;
    let assembled = '';
    let sawStreamingDelta = false;
    let stderr = '';

    child.stderr.on('data', (d: Buffer | string) => {
      stderr += typeof d === 'string' ? d : d.toString('utf8');
    });

    try {
      for await (const event of parseStream(child.stdout)) {
        const initSid = extractInitSessionId(event);
        if (initSid) sessionId = initSid;

        // Prefer streaming deltas. Fall back to the final assistant
        // envelope only if we never saw a delta (avoids duplicate text).
        const delta = extractStreamingText(event);
        if (delta) {
          sawStreamingDelta = true;
          assembled += delta;
          await streamer.append(delta);
        } else if (!sawStreamingDelta) {
          const finalText = extractFinalAssistantText(event);
          if (finalText) {
            assembled += finalText;
            await streamer.append(finalText);
          }
        }

        const result = extractResult(event);
        if (result) {
          if (result.sessionId) sessionId = result.sessionId;
          if (typeof result.totalCostUsd === 'number') {
            totalCost = result.totalCostUsd;
          }
          if (typeof result.numTurns === 'number') {
            numTurns = result.numTurns;
          }
          if (result.isError) {
            await streamer.error(result.errorText ?? 'claude reported error');
          }
        }
      }
    } catch (err) {
      logger.error({ err: String(err), threadKey }, 'stream parse failed');
      await streamer.error(`stream parse failed: ${truncate(String(err), 200)}`);
      try {
        child.kill();
      } catch {
        // ignore
      }
      return;
    }

    const exitCode = await waitExit(child);
    if (exitCode !== 0) {
      logger.error(
        { threadKey, exitCode, stderr: truncate(stderr, 2000) },
        'claude exited non-zero',
      );
      await streamer.error(
        `claude exited code ${exitCode}\n\`\`\`\n${truncate(stderr, 1500) || '(no stderr)'}\n\`\`\``,
      );
      return;
    }

    // If we never saw any assistant text, surface that explicitly.
    if (assembled.length === 0) {
      await streamer.error('claude produced no output (check logs)');
      return;
    }

    const footer =
      `:white_check_mark: ` +
      `_session ${sessionId ? '`' + sessionId.slice(0, 8) + '`' : '(unknown)'}_ · ` +
      `_${numTurns} turns_ · ` +
      `_$${totalCost.toFixed(4)}_`;
    await streamer.finalize(footer);

    if (sessionId) {
      store.upsert({
        thread_key: threadKey,
        claude_session_id: sessionId,
        cwd,
        created_at: existing?.created_at ?? Date.now(),
        last_used: Date.now(),
        total_cost_usd: totalCost,
        num_turns: numTurns,
        persona_fingerprint: currentFingerprint,
        reflection_run_at: existing?.reflection_run_at ?? null,
        reflection_cost_usd: existing?.reflection_cost_usd ?? null,
        first_peer_id: existing?.first_peer_id ?? identity.user.id,
        channel_id: existing?.channel_id ?? identity.channel.id,
        channel_name: existing?.channel_name ?? identity.channel.name,
        thread_ts: existing?.thread_ts ?? threadTs,
      });
      // Coalesced metadata write — covers the resume path where upsert
      // doesn't run for cold starts.
      store.setMetadata(threadKey, {
        first_peer_id: identity.user.id,
        channel_id: identity.channel.id,
        channel_name: identity.channel.name,
        thread_ts: threadTs,
      });
    }

    eventBus.emitEvent({
      kind: 'spawn.exit',
      ts: Date.now(),
      threadKey,
      exitCode,
      costUsd: totalCost,
      numTurns,
      sessionId: sessionId ?? null,
      durationMs: Date.now() - spawnStartedAt,
    });

    // Honcho ingest — fire-and-forget, after Slack has the reply.
    // Both sides of the turn (user message + apex response) are tagged
    // with their respective peer IDs so the Deriver can build separate
    // representations.
    if (honcho?.enabled) {
      honcho.ingest(threadKey, identity.user.id, prompt);
      honcho.ingest(threadKey, 'thoth', assembled);
      eventBus.emitEvent({ kind: 'honcho.ingest', ts: Date.now(), threadKey, peer: identity.user.id });
    }

    // Episodic write — fire-and-forget so the Slack reply has already
    // landed before we pay the embed cost. Includes the Slack message
    // ts of Thoth's reply so reaction-driven feedback (Phase 4) can
    // route ✅/❌/🧠/🗑️ events back to the right episode row.
    if (episodic) {
      void episodic
        .write({
          thread_key: threadKey,
          sender_peer: identity.user.id,
          channel_name: identity.channel.name,
          channel_id: identity.channel.id,
          thread_ts: threadTs,
          user_text: prompt,
          apex_summary: assembled,
          num_turns: numTurns,
          total_cost_usd: totalCost,
          slack_message_ts: streamer.postedMessageTs ?? undefined,
          slack_channel_id: channel,
        })
        .then((episodeId) => {
          // Bind provenance trail to the now-written episode.
          if (episodeId > 0) {
            provenanceStore.bindToEpisode(threadKey, spawnStartedAt, episodeId);
          }
          eventBus.emitEvent({
            kind: 'episode.write',
            ts: Date.now(),
            episodeId,
            threadKey,
            peer: identity.user.id,
            userPreview: prompt.slice(0, 200),
            apexPreview: assembled.slice(0, 200),
            costUsd: totalCost,
          });
        })
        .catch((err) => {
          logger.warn(
            { err: String(err), threadKey },
            'episodic write failed (soft)',
          );
        });
    }

    if (!sessionId) {
      logger.warn({ threadKey }, 'no session_id captured — will not resume next turn');
    }
  }

  // ---- Magic command: /whoami ---------------------------------------
  async function handleWhoami(
    client: WebClient,
    ev: DispatchEvent,
  ): Promise<void> {
    if (!honcho?.enabled) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text:
          ':information_source: Honcho is disabled — no user-model to query. ' +
          'Set `HONCHO_API_KEY` in `.env` and restart.',
      });
      return;
    }

    const identity = await resolveIdentity(
      client,
      ev.userId,
      ev.channel,
      ev.isDm,
    );

    const result = await honcho.dialectic(
      ev.userId,
      [
        `Tell me what you know about this user. Cover:`,
        `- communication preferences (terse vs detailed, formal vs casual)`,
        `- domain context (what they work on)`,
        `- recurring patterns (what they often ask, what they avoid)`,
        `- anything I should know to respond well to them next time`,
        ``,
        `Be honest about what you don't yet know — say "no signal yet" for any`,
        `dimension where there isn't enough data.`,
      ].join('\n'),
    );

    const stats = honcho.getStats();
    const statsLine = `_dialectic calls: ${stats.dialecticCalls} (failures: ${stats.dialecticFailures}, avg ${stats.dialecticAvgLatencyMs}ms) · ingests: ${stats.ingestCalls} (failures: ${stats.ingestFailures})_`;

    if (!result) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: `:thinking_face: Honcho returned nothing for \`${identity.user.displayName}\` (peer \`${ev.userId}\`).\n${statsLine}`,
      });
      return;
    }

    await client.chat.postMessage({
      channel: ev.channel,
      thread_ts: ev.threadTs,
      text: [
        `:brain: *Honcho says about ${identity.user.displayName}* (peer \`${ev.userId}\`)`,
        '',
        result.content,
        '',
        statsLine,
      ].join('\n'),
    });
  }

  // ---- Magic command: /help -----------------------------------------
  async function handleHelp(
    client: WebClient,
    ev: DispatchEvent,
  ): Promise<void> {
    const allowed = allowlist.has(ev.userId);
    const episodeCount = episodic?.count() ?? 0;
    const honchoOnline = honcho?.enabled ?? false;
    const reflectionOnline = !!orchestratorDeps;
    const pendingSpawns = scheduledRunStore.countPendingForThread(
      `${ev.channel}:${ev.threadTs}`,
    );

    const lines: string[] = [
      `:bird: *Thoth* — Slack ↔ Claude Code via the Thoth persona`,
      `_5-layer memory · single host · runs on the team's Max subscription_`,
      ``,
      `*Talking to me*`,
      `• DM me directly — any message ≥ 12 chars triggers identity + episodic recall.`,
      `• \`@apex\` me in an allowlisted channel.`,
      `• Reply *in a thread* to continue the same Claude Code session (\`--resume\`).`,
      `• Top-level message in a new thread = fresh session, with cross-thread recall pre-injected.`,
      ``,
      `*Magic commands* (paste anywhere I can see)`,
      '`/help` — this card',
      '`/whoami` — what Honcho says about you',
      '`/recall <query>` — semantic search across past conversations',
      '`/done` — close this thread for reflection (otherwise auto-fires after 30 min idle)',
      '`/loop-stop` — cancel any pending self-spawn follow-ups in this thread',
      ``,
      `*Reactions on my replies* (live learning signals)`,
      '• :white_check_mark: — verified success (boosts skill-compile signal)',
      '• :x: — verified failure (writes a strong what-didnt note)',
      '• :brain: — remember verbatim into MEMORY.md (auto-redacts secrets)',
      '• :wastebasket: — exclude this episode from future recall',
      '• :bust_in_silhouette: — record as user-feedback observation in Honcho',
      ``,
      `*Memory layers*`,
      '• L1 Working — Claude Code session state + Auto Memory',
      '• L2 Identity — Honcho theory-of-mind on each peer',
      '• L3 Episodic — embeddings + cosine recall across all past threads',
      '• L4 Procedural — persona stack + `.claude/skills/`',
      '• L5 Reflection — self-critique at session end → fans out 4 writers',
      ``,
      `*Status right now*`,
      `• you: ${allowed ? `:white_check_mark: allowlisted as \`${ev.userId}\`` : `:x: not on the allowlist`}`,
      `• honcho: ${honchoOnline ? ':white_check_mark: online' : ':x: offline'}`,
      `• episodic: ${episodic ? `:white_check_mark: ${episodeCount} episodes` : ':x: offline'}`,
      `• reflection: ${reflectionOnline ? ':white_check_mark: online (idle ' + config.REFLECTION_IDLE_MIN + ' min, $' + config.REFLECTION_DAILY_CAP_USD.toFixed(2) + '/day cap)' : ':x: offline'}`,
      `• pending self-spawns in this thread: ${pendingSpawns}`,
      ``,
      `_Source: <https://github.com/AidanWagener/Thoth>_`,
    ];

    await client.chat.postMessage({
      channel: ev.channel,
      thread_ts: ev.threadTs,
      text: lines.join('\n'),
    });
  }

  // ---- Magic command: /party ----------------------------------------
  async function handleParty(
    client: WebClient,
    ev: DispatchEvent,
    rest: string,
    overrides?: { template?: string; mode?: string },
  ): Promise<void> {
    if (!partyOrchestrator) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':information_source: party mode is disabled — set `PARTY_DISABLED=false` and restart.',
      });
      return;
    }

    const threadKey = `${ev.channel}:${ev.threadTs}`;
    if (activeParties.has(threadKey)) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':no_entry: a party is already running in this thread. `/party-stop` first.',
      });
      return;
    }

    // Parse flag-style args:
    //   --with role,role,role
    //   --rounds 1|2|3
    //   --mode sequential|parallel|adversarial|quick
    //   --template freeform|prd|decision|retro|spec
    let roster: AgentRole[] | undefined;
    let rounds: number | undefined;
    let mode: 'sequential' | 'parallel' | 'adversarial' | 'quick' | undefined;
    let template: string | undefined = overrides?.template;
    let allowSubparties = false;
    let topic = rest.trim();
    {
      // Boolean flags pre-pass: `--allow-subparties` (no value).
      topic = topic.replace(/(?:^|\s)--allow-subparties\b/g, () => {
        allowSubparties = true;
        return ' ';
      }).trim();
      const flagRe = /(?:^|\s)--(\w[\w-]*)(?:[= ]|\s+)("[^"]+"|\S+)/g;
      let m: RegExpExecArray | null;
      while ((m = flagRe.exec(topic)) !== null) {
        const flag = m[1].toLowerCase();
        const val = m[2].replace(/^"|"$/g, '');
        if (flag === 'with') {
          const parsed = parseRoster(val);
          if (!parsed) {
            await client.chat.postMessage({
              channel: ev.channel,
              thread_ts: ev.threadTs,
              text: `:x: invalid roster: \`${val}\`. valid roles: ${Object.keys(AGENTS).filter((r) => r !== 'master').join(', ')}`,
            });
            return;
          }
          roster = parsed;
        } else if (flag === 'rounds') {
          const n = parseInt(val, 10);
          if (Number.isFinite(n) && n >= 1 && n <= 3) rounds = n;
        } else if (flag === 'mode') {
          const v = val.toLowerCase();
          if (v === 'sequential' || v === 'parallel' || v === 'adversarial' || v === 'quick') {
            mode = v;
          }
        } else if (flag === 'template') {
          if (['freeform', 'prd', 'decision', 'retro', 'spec'].includes(val.toLowerCase())) {
            template = val.toLowerCase();
          }
        }
      }
      topic = topic.replace(flagRe, ' ').trim();
    }

    // If user invoked `/party <template-name>` with a stored template name,
    // resolve it. (Stored templates take priority over flag overrides.)
    if (topic.length > 0) {
      const firstWord = topic.split(/\s+/)[0];
      const stored = (await import('../party/store')).partyStore.getTemplate(firstWord);
      if (stored) {
        try {
          const cfg = typeof stored.config_json === 'string'
            ? JSON.parse(stored.config_json)
            : stored.config_json;
          if (cfg.roster) roster = cfg.roster;
          if (cfg.rounds) rounds = cfg.rounds;
          if (cfg.mode) mode = cfg.mode;
          if (cfg.template) template = cfg.template;
          // Strip the template name from topic so the rest is the actual prompt.
          topic = topic.slice(firstWord.length).trim();
          (await import('../party/store')).partyStore.bumpTemplateInvocations(firstWord);
        } catch (err) {
          logger.warn({ err: String(err), template: firstWord }, 'party template parse failed');
        }
      }
    }

    if (!topic || topic.length < 5) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':information_source: usage: `/party <topic>` (≥ 5 chars). Optional: `--with role,role` `--rounds 1|2|3`.',
      });
      return;
    }

    activeParties.set(threadKey, '_pending_'); // placeholder before orchestrator returns the id

    void (async () => {
      try {
        const result = await partyOrchestrator.run({
          threadKey,
          channelId: ev.channel,
          threadTs: ev.threadTs,
          initiatorPeerId: ev.userId,
          topic,
          roster,
          rounds,
          mode: mode as 'sequential' | 'parallel' | 'adversarial' | 'quick' | undefined,
          template,
          allowSubparties,
          client,
        });
        activeParties.set(threadKey, result.partyId);
        // Once complete, drop the active marker so a new /party can start.
        activeParties.delete(threadKey);
      } catch (err) {
        logger.error({ err: String(err), threadKey }, 'party orchestrator threw');
        activeParties.delete(threadKey);
        await client.chat
          .postMessage({
            channel: ev.channel,
            thread_ts: ev.threadTs,
            text: `:x: party crashed: \`${truncate(String(err), 200)}\``,
          })
          .catch(() => undefined);
      }
    })();
  }

  // ---- Magic command: /party-list ----------------------------------
  async function handlePartyList(
    client: WebClient,
    ev: DispatchEvent,
  ): Promise<void> {
    const tpls = partyStore.listTemplates();
    const lines: string[] = [
      `:performing_arts: *Party templates* — ${tpls.length} saved`,
      '',
      `*Built-in slash commands:*`,
      '• `/party <topic>` — sequential debate, 6 agents, freeform synthesis',
      '• `/party-spec <topic>` — output as 12-section spec',
      '• `/party-decide <topic>` — output as ADR (decision record)',
      '• `/party-retro <topic>` — output as retrospective',
      '',
      '*Modes (--mode flag):* `sequential` (default) · `parallel` · `adversarial` · `quick`',
      '*Roster (--with flag):* analyst, pm, architect, dev, qa, ux',
      '*Rounds (--rounds 1|2|3):* default 2',
      '',
    ];
    if (tpls.length === 0) {
      lines.push(`_no saved templates yet — use \`/party-save <name>\` after a party to capture its config_`);
    } else {
      lines.push('*Saved templates:*');
      for (const t of tpls.slice(0, 20)) {
        const cfg = typeof t.config_json === 'string' ? JSON.parse(t.config_json) : t.config_json;
        const summary = [
          cfg.template ? `template=${cfg.template}` : '',
          cfg.mode ? `mode=${cfg.mode}` : '',
          cfg.rounds ? `rounds=${cfg.rounds}` : '',
        ].filter(Boolean).join(' · ');
        lines.push(`• \`/party ${t.name} <topic>\` — ${t.description || '_(no description)_'}  _(${summary} · ${t.invocations}× used)_`);
      }
    }
    await client.chat.postMessage({
      channel: ev.channel,
      thread_ts: ev.threadTs,
      text: lines.join('\n'),
    });
  }

  // ---- Magic command: /party-save -----------------------------------
  async function handlePartySave(
    client: WebClient,
    ev: DispatchEvent,
    name: string,
    description: string,
  ): Promise<void> {
    const threadKey = `${ev.channel}:${ev.threadTs}`;
    // Find the most recent party in this thread to capture as template.
    const recent = partyStore.listRecent(20).filter((p) => p.thread_key === threadKey);
    if (recent.length === 0) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: `:thinking_face: no recent party in this thread to save. run a \`/party\` first.`,
      });
      return;
    }
    const last = recent[0];
    if (!/^[a-z][a-z0-9-]{1,30}$/i.test(name)) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: `:x: invalid template name. use kebab-case, 2-30 chars, starting with a letter.`,
      });
      return;
    }
    const config = {
      roster: JSON.parse(last.roster_json),
      rounds: last.rounds,
      mode: last.mode,
      template: last.template,
    };
    partyStore.saveTemplate({
      name: name.toLowerCase(),
      description: description || null,
      config_json: JSON.stringify(config),
      created_by: ev.userId,
      created_at: Date.now(),
      invocations: 0,
    });
    await client.chat.postMessage({
      channel: ev.channel,
      thread_ts: ev.threadTs,
      text: `:white_check_mark: saved template *${name}* — invoke as \`/party ${name} <topic>\`.\n_config: ${JSON.stringify(config)}_`,
    });
  }

  // ---- Magic command: /party-stop -----------------------------------
  async function handlePartyStop(
    client: WebClient,
    ev: DispatchEvent,
  ): Promise<void> {
    if (!partyOrchestrator) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':information_source: party mode is disabled.',
      });
      return;
    }
    const threadKey = `${ev.channel}:${ev.threadTs}`;
    const dbActive = partyStore.activeForThread(threadKey);
    if (!dbActive) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':information_source: no active party in this thread.',
      });
      return;
    }
    partyOrchestrator.abort(dbActive.id);
    await client.chat.postMessage({
      channel: ev.channel,
      thread_ts: ev.threadTs,
      text: `:wave: abort signal sent to party \`${dbActive.id}\` — finishing the current agent then halting.`,
    });
  }

  // ---- Magic command: /loop-stop ------------------------------------
  async function handleLoopStop(
    client: WebClient,
    ev: DispatchEvent,
  ): Promise<void> {
    const threadKey = `${ev.channel}:${ev.threadTs}`;
    const cancelled = scheduledRunStore.cancelPendingForThread(threadKey);
    const text = cancelled === 0
      ? ':information_source: nothing to cancel — no pending self-spawns in this thread.'
      : `:no_entry: cancelled ${cancelled} pending self-spawn${cancelled === 1 ? '' : 's'} for this thread.`;
    await client.chat.postMessage({
      channel: ev.channel,
      thread_ts: ev.threadTs,
      text,
    });
  }

  // ---- Magic command: /done -----------------------------------------
  async function handleDone(
    client: WebClient,
    ev: DispatchEvent,
  ): Promise<void> {
    const threadKey = `${ev.channel}:${ev.threadTs}`;
    if (!orchestratorDeps) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':information_source: reflection is disabled — `/done` has nothing to trigger.',
      });
      return;
    }

    const session = store.get(threadKey);
    if (!session) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':thinking_face: no session found for this thread — nothing to reflect on.',
      });
      return;
    }
    if (!session.first_peer_id || !session.channel_id || !session.thread_ts) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':thinking_face: this session has no captured metadata yet — try sending one real message first.',
      });
      return;
    }

    await client.chat.postMessage({
      channel: ev.channel,
      thread_ts: ev.threadTs,
      text: ':wave: closing this thread for reflection — back in a moment.',
    });

    void orchestrateReflection(orchestratorDeps, {
      threadKey,
      channelId: session.channel_id,
      channelName: session.channel_name ?? session.channel_id,
      threadTs: session.thread_ts,
      senderPeerId: session.first_peer_id,
      senderDisplayName: session.first_peer_id,
      numTurns: session.num_turns,
      totalCostUsd: session.total_cost_usd,
      startedAt: session.created_at,
      endedAt: session.last_used,
    })
      .then(async (r) => {
        const summary = r.ran
          ? `:white_check_mark: reflection complete · cost $${(r.costUsd ?? 0).toFixed(4)} · notes ${r.notesAppended ?? 0} · skill ${r.skillProposed ? '✅ proposed' : '–'} · persona obs ${r.personaObservations ?? 0} · honcho updates ${r.honchoUpdates ?? 0}`
          : `:no_entry_sign: reflection skipped · ${r.reason ?? 'unknown'}`;
        await client.chat
          .postMessage({
            channel: ev.channel,
            thread_ts: ev.threadTs,
            text: summary,
          })
          .catch((err) =>
            logger.warn({ err: String(err) }, '/done summary post failed'),
          );
      })
      .catch((err) => {
        logger.error({ err: String(err), threadKey }, '/done orchestrator threw');
      });
  }

  // ---- Magic command: /recall <query> -------------------------------
  async function handleRecall(
    client: WebClient,
    ev: DispatchEvent,
    query: string,
  ): Promise<void> {
    if (!episodic) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':information_source: episodic memory is disabled — no recall available.',
      });
      return;
    }

    const q = query.trim();
    if (!q) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: ':information_source: usage: `/recall <query>` — searches your past conversations.',
      });
      return;
    }

    let hits;
    try {
      hits = await episodic.recall(q, { topK: 10 });
    } catch (err) {
      logger.error({ err: String(err) }, '/recall failed');
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: `:x: recall failed: \`${truncate(String(err), 200)}\``,
      });
      return;
    }

    if (hits.length === 0) {
      await client.chat.postMessage({
        channel: ev.channel,
        thread_ts: ev.threadTs,
        text: `:thinking_face: no related episodes found for: _${truncate(q, 200)}_\n_total episodes in store: ${episodic.count()}_`,
      });
      return;
    }

    const lines: string[] = [
      `:books: *Recall for:* _${truncate(q, 200)}_  · _${hits.length} hit${hits.length === 1 ? '' : 's'} of ${episodic.count()} episodes_`,
    ];
    for (const hit of hits) {
      const ep = hit.episode;
      const date = new Date(ep.created_at).toISOString().slice(0, 16).replace('T', ' ');
      const channel = ep.channel_name ?? ep.channel_id ?? 'unknown';
      const link =
        ep.channel_id && ep.thread_ts
          ? `<https://slack.com/archives/${ep.channel_id}/p${ep.thread_ts.replace('.', '')}|jump>`
          : '';
      lines.push('');
      lines.push(
        `*${date}* · ${channel} · _score ${hit.score.toFixed(2)}_ · peer \`${ep.sender_peer}\` ${link}`,
      );
      lines.push(`> ${truncate(ep.user_text, 200).replace(/\n/g, ' ')}`);
      lines.push(`_apex:_ ${truncate(ep.apex_summary, 220).replace(/\n/g, ' ')}`);
    }

    await client.chat.postMessage({
      channel: ev.channel,
      thread_ts: ev.threadTs,
      text: lines.join('\n'),
    });
  }

  // ---- Synthetic dispatch entry (used by the scheduling poller) -----
  // Wraps the closure-scoped `dispatch` as a typed SyntheticDispatchFn
  // so the scheduler can fire turns without going through Slack's
  // event router.
  const synthetic: SyntheticDispatchFn = async (params) => {
    await dispatch(app.client, params);
  };

  return { dispatch: synthetic };
}

function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function waitExit(child: import('child_process').ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once('exit', (code) => resolve(code ?? 0));
    child.once('error', () => resolve(1));
  });
}
