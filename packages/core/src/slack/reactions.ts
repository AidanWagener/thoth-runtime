import type { App } from '@slack/bolt';
import { skillDraftStore } from '../skills/store';
import { acceptSkillDraft, rejectSkillDraft } from '../skills/manager';
import type { Allowlist } from '../policy/allowlist';
import type { EpisodicStore } from '../memory/episodic';
import type { HonchoClient } from '../memory/honcho';
import { writeMemoryNotes } from '../reflection/writers/memory';
import { redact } from '../security/redact';
import { logger } from '../logger';
import { eventBus } from '../dashboard/event-bus';
import { partyStore } from '../party/store';
import { compilePartyToSkill } from '../skills/compile-from-party';
import { publishSkill } from '../skills/marketplace';

/**
 * `reaction_added` listener — the live-feedback surface.
 *
 * On skill-draft messages:
 *   ✅  → accept (commit to git)
 *   ❌  → reject (delete file)
 *
 * On regular Thoth reply messages (matched via episodic.findBySlackMessage):
 *   ✅  → mark verified=success (boosts skill-compile signal)
 *   ❌  → mark verified=failure (next reflection writes a strong what_didnt)
 *   🧠  → write the reply text verbatim into MEMORY.md (after redaction)
 *   🗑️  → mark episode outdated (excluded from future recall)
 *   👤  → push as user-feedback observation to Honcho
 */

const ACCEPT_REACTIONS = new Set(['white_check_mark', '+1', 'heavy_check_mark']);
const REJECT_REACTIONS = new Set(['x', 'no_entry', '-1']);
const REMEMBER_REACTIONS = new Set(['brain']);
const FORGET_REACTIONS = new Set(['wastebasket']);
const FEEDBACK_REACTIONS = new Set(['bust_in_silhouette', 'point_up']);
const AUTO_SKILL_REACTIONS = new Set(['tada', 'confetti_ball']);
const PUBLISH_REACTIONS = new Set(['earth_americas', 'earth_africa', 'earth_asia', 'globe_with_meridians']);

export interface ReactionHandlerDeps {
  app: App;
  allowlist: Allowlist;
  episodic?: EpisodicStore;
  honcho?: HonchoClient;
  bridgeRepoRoot: string;
}

export function registerReactionHandlers(deps: ReactionHandlerDeps): void {
  const { app, allowlist, episodic, honcho, bridgeRepoRoot } = deps;

  app.event('reaction_added', async ({ event, client }) => {
    const e = event as unknown as Record<string, unknown>;
    const userId = e.user as string | undefined;
    const reaction = e.reaction as string | undefined;
    const item = e.item as
      | { type?: string; channel?: string; ts?: string }
      | undefined;

    if (!userId || !reaction || !item || item.type !== 'message') return;
    if (!item.channel || !item.ts) return;
    if (!allowlist.has(userId)) {
      logger.debug({ userId, reaction }, 'reaction from non-allowlisted user, ignoring');
      return;
    }

    // ── 1) Skill-draft approval flow ──────────────────────────────────
    const draft = skillDraftStore.findBySlackMessage(item.channel, item.ts);
    if (draft && draft.status === 'pending') {
      eventBus.emitEvent({
        kind: 'reaction.received',
        ts: Date.now(),
        reaction,
        episodeId: null,
        draftId: draft.id,
        peer: userId,
        verb: ACCEPT_REACTIONS.has(reaction) ? 'skill-accept'
            : REJECT_REACTIONS.has(reaction) ? 'skill-reject'
            : 'unknown',
      });
      if (ACCEPT_REACTIONS.has(reaction)) {
        const r = await acceptSkillDraft(draft.id, userId);
        const text = r.ok
          ? `:white_check_mark: skill *${draft.slug}* committed (\`${r.sha?.slice(0, 7)}\`).`
          : `:warning: could not accept skill *${draft.slug}*: ${r.reason ?? 'unknown'}`;
        await client.chat
          .postMessage({ channel: item.channel, thread_ts: item.ts, text })
          .catch((err) => logger.warn({ err: String(err) }, 'skill accept reply failed'));
        return;
      }
      if (REJECT_REACTIONS.has(reaction)) {
        const r = await rejectSkillDraft(draft.id, userId);
        const text = r.ok
          ? `:x: skill *${draft.slug}* discarded.`
          : `:warning: could not reject skill *${draft.slug}*: ${r.reason ?? 'unknown'}`;
        await client.chat
          .postMessage({ channel: item.channel, thread_ts: item.ts, text })
          .catch((err) => logger.warn({ err: String(err) }, 'skill reject reply failed'));
        return;
      }
      if (PUBLISH_REACTIONS.has(reaction)) {
        await client.chat.postMessage({
          channel: item.channel,
          thread_ts: item.ts,
          text: `:earth_americas: publishing *${draft.slug}* to the public registry…`,
        }).catch(() => undefined);
        const r = await publishSkill(draft.id, userId, bridgeRepoRoot);
        const text = r.ok
          ? `:white_check_mark: *${r.slug}* published. Browse: ${r.url}`
          : `:warning: publish failed: ${r.reason ?? 'unknown'}`;
        await client.chat
          .postMessage({ channel: item.channel, thread_ts: item.ts, text })
          .catch((err) => logger.warn({ err: String(err) }, 'skill publish reply failed'));
        return;
      }
    }

    // ── 1.5) Party-message reactions ─────────────────────────────────
    // Look up if this Slack message ts corresponds to a party agent
    // contribution. If so, route reactions per the party-feedback table:
    //   ✅/❌ on any agent → Honcho user-feedback observation tagged with
    //                       the agent role (so Honcho can build per-role
    //                       preference for this peer)
    //   🧠   on agent     → save the agent's content verbatim (redacted)
    //   🎉   on master    → trigger auto-compile to emerald-tablets
    //   🗑️   on agent     → mark party message hidden (annotation only)
    let partyMessageHandled = false;
    let partyOfMessage: ReturnType<typeof partyStore.getRun> | null = null;
    {
      // Linear scan over recent parties — N parties × M messages is small.
      const recents = (() => {
        try { return partyStore.listRecent(60); } catch { return []; }
      })();
      for (const p of recents) {
        const msgs = partyStore.listMessages(p.id);
        const match = msgs.find((m) => m.slack_message_ts === item.ts);
        if (match) {
          partyMessageHandled = true;
          partyOfMessage = p;
          if (FEEDBACK_REACTIONS.has(reaction) || ACCEPT_REACTIONS.has(reaction) || REJECT_REACTIONS.has(reaction)) {
            if (honcho?.enabled) {
              const verb =
                ACCEPT_REACTIONS.has(reaction) ? 'liked'
                : REJECT_REACTIONS.has(reaction) ? 'disliked'
                : 'feedback';
              const observation =
                `[party-feedback] ${userId} ${verb} agent=${match.agent_role} ` +
                `in party=${p.id} (template=${p.template}, mode=${p.mode}). ` +
                `Their contribution: ${match.content.slice(0, 240)}`;
              honcho.ingest(p.thread_key, 'apex', observation);
              logger.info(
                { partyId: p.id, role: match.agent_role, userId, reaction, verb },
                'party-message feedback queued to honcho',
              );
            }
          } else if (REMEMBER_REACTIONS.has(reaction)) {
            const r = redact(match.content);
            const note = `verbatim from ${match.agent_role} in party ${p.id}: ${r.text.slice(0, 800)}`;
            try {
              await writeMemoryNotes([note], {
                threadKey: p.thread_key,
                senderPeerId: userId,
                senderDisplayName: userId,
                channelName: 'party',
                recordedAt: Date.now(),
              });
              await client.chat.postMessage({
                channel: item.channel,
                thread_ts: item.ts,
                text: ':brain: party agent verbatim saved to MEMORY.md.',
              }).catch(() => undefined);
            } catch (err) {
              logger.warn({ err: String(err) }, '🧠 party-message write failed');
            }
          } else if (AUTO_SKILL_REACTIONS.has(reaction) && match.agent_role === 'master') {
            // 🎉 on master synthesis → auto-compile party to skill on emerald-tablets
            await client.chat.postMessage({
              channel: item.channel,
              thread_ts: item.ts,
              text: ':sparkles: auto-compiling party as a skill on `emerald-tablets`…',
            }).catch(() => undefined);
            const r = await compilePartyToSkill(p.id, userId, bridgeRepoRoot).catch((err) => ({
              ok: false as const,
              reason: String(err).slice(0, 200),
            }));
            const text = r.ok
              ? `:white_check_mark: skill *${r.slug}* committed to \`${r.branch}\` (${r.sha?.slice(0, 7) ?? '?'}). review on github.`
              : `:warning: auto-compile failed: ${r.reason ?? 'unknown'}`;
            await client.chat.postMessage({
              channel: item.channel,
              thread_ts: item.ts,
              text,
            }).catch(() => undefined);
          }
          break;
        }
      }
    }
    if (partyMessageHandled) return;

    // ── 2) Episode-level live feedback ────────────────────────────────
    if (!episodic) return;
    const episode = episodic.findBySlackMessage(item.channel, item.ts);
    if (!episode) return; // reaction on a non-Thoth message — ignore

    const verb =
      ACCEPT_REACTIONS.has(reaction) ? 'verify-success'
      : REJECT_REACTIONS.has(reaction) ? 'verify-failure'
      : REMEMBER_REACTIONS.has(reaction) ? 'remember'
      : FORGET_REACTIONS.has(reaction) ? 'forget'
      : FEEDBACK_REACTIONS.has(reaction) ? 'feedback'
      : 'unknown';
    eventBus.emitEvent({
      kind: 'reaction.received',
      ts: Date.now(),
      reaction,
      episodeId: episode.id,
      draftId: null,
      peer: userId,
      verb,
    });

    if (ACCEPT_REACTIONS.has(reaction)) {
      episodic.setVerified(episode.id, 'success', userId);
      logger.info(
        { episodeId: episode.id, userId, threadKey: episode.thread_key },
        'episode verified=success',
      );
      return;
    }

    if (REJECT_REACTIONS.has(reaction)) {
      episodic.setVerified(episode.id, 'failure', userId);
      logger.info(
        { episodeId: episode.id, userId, threadKey: episode.thread_key },
        'episode verified=failure',
      );
      return;
    }

    if (FORGET_REACTIONS.has(reaction)) {
      episodic.markOutdated(episode.id);
      logger.info(
        { episodeId: episode.id, userId, threadKey: episode.thread_key },
        'episode marked outdated (recall-excluded)',
      );
      await client.chat
        .postMessage({
          channel: item.channel,
          thread_ts: item.ts,
          text: ':wastebasket: this episode is excluded from future recall.',
        })
        .catch(() => undefined);
      return;
    }

    if (REMEMBER_REACTIONS.has(reaction)) {
      const verbatim = `${episode.user_text}\n\n→ ${episode.apex_summary}`;
      const r = redact(verbatim);
      const note = `verbatim memory: ${r.text.slice(0, 800)}`;
      try {
        const w = await writeMemoryNotes([note], {
          threadKey: episode.thread_key,
          senderPeerId: userId,
          senderDisplayName: userId,
          channelName: episode.channel_name ?? episode.channel_id ?? 'unknown',
          recordedAt: Date.now(),
        });
        const reply = r.redacted
          ? `:brain: saved to MEMORY.md (with ${r.replacements
              .map((x) => `${x.count}× ${x.kind}`)
              .join(', ')} redacted).`
          : `:brain: saved to MEMORY.md.`;
        logger.info(
          {
            episodeId: episode.id,
            userId,
            appended: w.appended,
            redacted: r.redacted,
            replacements: r.replacements,
          },
          'episode remembered verbatim',
        );
        await client.chat
          .postMessage({ channel: item.channel, thread_ts: item.ts, text: reply })
          .catch(() => undefined);
      } catch (err) {
        logger.warn({ err: String(err), episodeId: episode.id }, '🧠 write failed');
      }
      return;
    }

    if (FEEDBACK_REACTIONS.has(reaction) && honcho?.enabled) {
      const observation = `[user-feedback :${reaction}: from ${userId}] reacted to apex's reply: ${episode.apex_summary.slice(0, 240)}`;
      honcho.ingest(episode.thread_key, 'apex', observation);
      logger.info(
        { episodeId: episode.id, userId, reaction },
        'user-feedback queued to honcho',
      );
      return;
    }
  });
}
