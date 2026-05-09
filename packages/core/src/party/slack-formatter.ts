import type { AgentRole } from './agents';
import { AGENTS } from './agents';

/**
 * Render an agent's contribution as a Slack message body. Bot is always
 * the same `apex` identity — the agent persona is purely visual via emoji
 * prefix + bold name + a thin metadata footer. Slack's deprecated
 * `username` override is intentionally NOT used.
 */
export function formatAgentMessage(opts: {
  role: AgentRole;
  round: number;
  totalRounds: number;
  content: string;       // already stripped of the confidence line
  confidence: number | null;
  costUsd: number;
}): string {
  const a = AGENTS[opts.role];
  const confSegment =
    opts.confidence !== null ? ` · conf ${opts.confidence.toFixed(2)}` : '';
  const header = `:${a.emoji}: *${a.display}* — round ${opts.round}/${opts.totalRounds}${confSegment}`;
  const footer = `_$${opts.costUsd.toFixed(4)}_`;
  return `${header}\n\n${opts.content.trim()}\n\n${footer}`;
}

/**
 * Render BMad-Master's synthesis at the end of a party. Includes the
 * full cost summary + reaction-prompt footer.
 */
export function formatSynthesisMessage(opts: {
  partyId: string;
  content: string;
  totalCostUsd: number;
  rounds: number;
  agentCount: number;
  contributions: number;
  outcome: 'success' | 'aborted' | 'over_budget' | 'failed';
}): string {
  const m = AGENTS.master;
  const outcomeStr =
    opts.outcome === 'success'
      ? ':white_check_mark: complete'
      : opts.outcome === 'over_budget'
        ? ':moneybag: halted at budget cap'
        : opts.outcome === 'aborted'
          ? ':no_entry: aborted'
          : ':warning: failed';
  return [
    `:${m.emoji}: *${m.display} — synthesis*  · ${outcomeStr}`,
    '',
    opts.content.trim(),
    '',
    `_party \`${opts.partyId}\` · ${opts.rounds} round${opts.rounds === 1 ? '' : 's'} · ${opts.agentCount} agent${opts.agentCount === 1 ? '' : 's'} · ${opts.contributions} contribution${opts.contributions === 1 ? '' : 's'} · $${opts.totalCostUsd.toFixed(4)}_`,
    '',
    `_react :white_check_mark: to keep · :x: to discard · :tada: to compile to skill_`,
  ].join('\n');
}

/** Initial party-start announcement posted into the thread. */
export function formatPartyOpening(opts: {
  topic: string;
  roster: AgentRole[];
  rounds: number;
  partyId: string;
  initiator: string;
  budgetUsd: number;
}): string {
  const rosterStr = opts.roster
    .map((r) => `:${AGENTS[r].emoji}: ${AGENTS[r].display}`)
    .join(' · ');
  return [
    `:performing_arts: *Party started* — \`${opts.partyId}\``,
    `> ${opts.topic.replace(/\n+/g, ' ').slice(0, 240)}`,
    '',
    `*Roster:* ${rosterStr}`,
    `*Rounds:* ${opts.rounds} · *Budget:* $${opts.budgetUsd.toFixed(2)} · *Initiator:* <@${opts.initiator}>`,
    `_each agent will speak in turn; BMad-Master synthesizes at the end._`,
  ].join('\n');
}
