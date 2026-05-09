import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import type { WebClient } from '@slack/web-api';
import { spawnClaudeOneshot } from '../claude/spawn';
import {
  AGENTS,
  DEFAULT_ROSTER,
  type AgentRole,
  personaFilePath,
} from './agents';
import { parseConfidence, stripConfidenceLine } from './confidence';
import {
  partyStore,
  nanoid,
  type PartyOutcome,
} from './store';
import {
  formatAgentMessage,
  formatPartyOpening,
  formatSynthesisMessage,
} from './slack-formatter';
import { partyDailyCap } from './budget';
import { eventBus } from '../dashboard/event-bus';
import { logger } from '../logger';

/**
 * Sequential-mode orchestrator. Each agent in the roster speaks in turn,
 * one round at a time, seeing the transcript so far. Master synthesizes
 * at the end.
 *
 * Soft-fails everywhere. A single agent's failure does not halt the
 * party — orchestrator records the failure as a system note and moves
 * on. Total cost is capped per party; daily cost is capped across all
 * parties.
 */

export const PERSONA_DIR_DEFAULT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'persona',
  'thoth',
  'party',
);

const AGENT_BUDGET_USD = 0.30;
const SYNTH_BUDGET_USD = 0.45;
const AGENT_MAX_TURNS = 3;
const SYNTH_MAX_TURNS = 4;
const ALLOWED_TOOLS = 'Read,Glob,Grep,WebFetch';

/** Hard cap on party recursion depth. 0 = top-level only, 2 = grandchildren. */
export const MAX_PARTY_DEPTH = 2;
/** Max sub-parties spawned per parent (regardless of how many directives master emits). */
const MAX_SUBPARTIES_PER_PARENT = 2;

export type PartyMode = 'sequential' | 'parallel' | 'adversarial' | 'quick';

export interface PartyInput {
  threadKey: string;
  channelId: string;
  threadTs: string;
  initiatorPeerId: string;
  topic: string;
  roster?: AgentRole[];   // defaults to DEFAULT_ROSTER
  rounds?: number;        // defaults to 2
  template?: string;      // 'freeform' | 'prd' | 'decision' | 'retro' | 'spec'
  mode?: PartyMode;       // defaults to 'sequential'
  budgetUsd?: number;     // defaults to 1.50
  client: WebClient;
  /** Parent party id if this is a sub-party. Default null (top-level). */
  parentPartyId?: string | null;
  /** Recursion depth, 0 = top-level. Default 0. Capped at MAX_PARTY_DEPTH. */
  depth?: number;
  /** Whether master is allowed to emit <spawn-subparty> directives. Default false at depth 0; ignored when depth>=MAX. */
  allowSubparties?: boolean;
}

export const VALID_TEMPLATES = ['freeform', 'prd', 'decision', 'retro', 'spec'] as const;
export type PartyTemplate = typeof VALID_TEMPLATES[number];

export interface PartyDeps {
  claudeBin: string;
  personaDir: string;          // persona/apex/party/
  sandboxRoot: string;         // .thoth/parties/ — gitignored
  dailyCapUsd: number;         // default $10
}

export interface PartyResult {
  partyId: string;
  outcome: PartyOutcome;
  contributions: number;
  totalCostUsd: number;
}

interface AgentContribution {
  role: AgentRole;
  round: number;
  rawContent: string;     // original from claude
  cleanContent: string;   // confidence line stripped
  confidence: number | null;
  costUsd: number;
  durationMs: number;
}

export class PartyOrchestrator {
  private aborted = new Set<string>();

  constructor(private readonly deps: PartyDeps) {}

  /** Mark a party as aborted by id. The orchestrator polls this. */
  abort(partyId: string): void {
    this.aborted.add(partyId);
    logger.info({ partyId }, 'party abort requested');
  }

  isAborted(partyId: string): boolean {
    return this.aborted.has(partyId);
  }

  async run(input: PartyInput): Promise<PartyResult> {
    const partyId = nanoid(10);
    const roster = input.roster ?? DEFAULT_ROSTER;
    const mode: PartyMode = input.mode ?? 'sequential';
    // Quick mode forces 1 round regardless of caller request.
    const rounds = mode === 'quick' ? 1 : Math.max(1, Math.min(3, input.rounds ?? 2));
    const budgetUsd = Math.max(0.30, Math.min(5.0, input.budgetUsd ?? 1.5));
    const template = input.template ?? 'freeform';
    const depth = Math.max(0, Math.min(MAX_PARTY_DEPTH, input.depth ?? 0));
    const parentPartyId = input.parentPartyId ?? null;
    // Master may emit <spawn-subparty> if explicitly allowed AND we're below max depth.
    const subpartiesAllowed = (input.allowSubparties ?? false) && depth < MAX_PARTY_DEPTH;

    // Per-day cap check up front — refuse to start if we'd blow it.
    if (!partyDailyCap.underCap(this.deps.dailyCapUsd)) {
      const msg = `:no_entry: party refused — daily party-cost cap of $${this.deps.dailyCapUsd.toFixed(2)} reached. Try again after midnight UTC.`;
      await input.client.chat.postMessage({
        channel: input.channelId,
        thread_ts: input.threadTs,
        text: msg,
      });
      return {
        partyId,
        outcome: 'over_budget',
        contributions: 0,
        totalCostUsd: 0,
      };
    }

    partyStore.createRun({
      id: partyId,
      thread_key: input.threadKey,
      initiator_peer: input.initiatorPeerId,
      topic: input.topic,
      template,
      mode,
      roster_json: JSON.stringify(roster),
      rounds,
      started_at: Date.now(),
      parent_party_id: parentPartyId,
      depth,
    });

    eventBus.emitEvent({
      kind: 'party.started',
      ts: Date.now(),
      partyId,
      topic: input.topic,
      roster,
      threadKey: input.threadKey,
    });

    // Sandbox dir for this party run.
    const sandbox = path.join(
      this.deps.sandboxRoot,
      partyId.replace(/[^a-zA-Z0-9_-]/g, '-'),
    );
    await fs.mkdir(sandbox, { recursive: true });

    // Opening announcement.
    try {
      await input.client.chat.postMessage({
        channel: input.channelId,
        thread_ts: input.threadTs,
        text: formatPartyOpening({
          topic: input.topic,
          roster,
          rounds,
          partyId,
          initiator: input.initiatorPeerId,
          budgetUsd,
        }),
      });
    } catch (err) {
      logger.warn({ err: String(err) }, 'party opening post failed');
    }

    const transcript: AgentContribution[] = [];
    let totalCost = 0;
    let outcome: PartyOutcome = 'success';

    // Per-mode agent budget: quick mode is 80-token-ish cheap turns.
    const perAgentBudget = mode === 'quick' ? 0.10 : AGENT_BUDGET_USD;

    outer: for (let round = 1; round <= rounds; round++) {
      if (this.isAborted(partyId)) {
        outcome = 'aborted';
        break;
      }
      if (totalCost >= budgetUsd) {
        outcome = 'over_budget';
        break;
      }

      // Mode dispatch — sequential / adversarial run agents one-at-a-time
      // (so each can see the prior agent's output); parallel / quick fan
      // them out with Promise.all.
      let roundContributions: AgentContribution[] = [];

      if (mode === 'parallel' || mode === 'quick') {
        const promises = roster.map((role) =>
          this.runAgent({
            partyId, role, round, totalRounds: rounds,
            topic: input.topic, transcript, sandbox,
            perAgentBudget, adversarial: false, quick: mode === 'quick',
          }),
        );
        const results = await Promise.all(promises);
        roundContributions = results.filter((r): r is AgentContribution => r !== null);
      } else {
        // sequential or adversarial — agents see prior in-round contributions
        for (const role of roster) {
          if (this.isAborted(partyId)) { outcome = 'aborted'; break outer; }
          if (totalCost >= budgetUsd) { outcome = 'over_budget'; break outer; }
          const c = await this.runAgent({
            partyId, role, round, totalRounds: rounds,
            topic: input.topic, transcript, sandbox,
            perAgentBudget,
            adversarial: mode === 'adversarial',
            quick: false,
          });
          if (c) {
            roundContributions.push(c);
            transcript.push(c);
            totalCost += c.costUsd;
            await this.persistAndPost({
              input, partyId, contribution: c, round, totalRounds: rounds,
            });
          }
        }
        continue; // sequential/adversarial path is done — skip parallel persist below
      }

      // parallel/quick: persist + post all results in roster order
      const byRole = new Map(roundContributions.map((c) => [c.role, c]));
      for (const role of roster) {
        const c = byRole.get(role);
        if (!c) continue;
        transcript.push(c);
        totalCost += c.costUsd;
        await this.persistAndPost({
          input, partyId, contribution: c, round, totalRounds: rounds,
        });
      }
    }

    // Master synthesis (always runs, even on partial transcripts).
    let synthCost = 0;
    let synthContent = '';
    if (transcript.length > 0) {
      const synth = await this.runMaster({
        partyId,
        topic: input.topic,
        transcript,
        rounds,
        sandbox,
        outcome,
        template,
        subpartiesAllowed,
      });
      if (synth) {
        synthContent = synth.cleanContent;
        synthCost = synth.costUsd;
        partyStore.addMessage({
          party_id: partyId,
          round_number: rounds + 1,
          agent_role: 'master',
          content: synthContent,
          confidence: synth.confidence,
          cost_usd: synth.costUsd,
          duration_ms: synth.durationMs,
          created_at: Date.now(),
          slack_message_ts: null,
        });
      }
    }

    const grandTotal = totalCost + synthCost;
    partyStore.endRun(partyId, outcome, grandTotal, null);
    partyDailyCap.record(grandTotal);

    // Post synthesis to Slack.
    try {
      const synthBody = formatSynthesisMessage({
        partyId,
        content: synthContent || '_(no synthesis — party produced no contributions)_',
        totalCostUsd: grandTotal,
        rounds,
        agentCount: roster.length,
        contributions: transcript.length,
        outcome:
          outcome === 'success' || outcome === 'aborted' || outcome === 'over_budget' || outcome === 'failed'
            ? outcome
            : 'success',
      });
      await input.client.chat.postMessage({
        channel: input.channelId,
        thread_ts: input.threadTs,
        text: synthBody,
      });
    } catch (err) {
      logger.warn({ err: String(err), partyId }, 'synthesis slack post failed');
    }

    // Persist transcript to disk for Step 4's output-template work.
    try {
      const transcriptMd = this.renderTranscriptMd({
        partyId,
        topic: input.topic,
        roster,
        rounds,
        contributions: transcript,
        synthContent,
        grandTotal,
      });
      await fs.writeFile(path.join(sandbox, 'transcript.md'), transcriptMd, 'utf8');
      await fs.writeFile(
        path.join(sandbox, 'metadata.json'),
        JSON.stringify(
          {
            partyId,
            topic: input.topic,
            roster,
            rounds,
            outcome,
            totalCostUsd: grandTotal,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch (err) {
      logger.warn({ err: String(err), partyId }, 'transcript persist failed');
    }

    eventBus.emitEvent({
      kind: 'party.complete',
      ts: Date.now(),
      partyId,
      outcome,
      totalCostUsd: grandTotal,
      contributions: transcript.length,
    });

    // ── Sub-party spawn loop (Phase D) ─────────────────────────────
    // Master may have emitted <spawn-subparty topic="…" with="role,role"/>
    // directives in its synthesis. Parse, cap, and recurse — strictly
    // depth+1, max MAX_SUBPARTIES_PER_PARENT.
    if (subpartiesAllowed && synthContent && outcome === 'success') {
      const directives = parseSubpartyDirectives(synthContent).slice(0, MAX_SUBPARTIES_PER_PARENT);
      if (directives.length > 0) {
        try {
          await input.client.chat.postMessage({
            channel: input.channelId,
            thread_ts: input.threadTs,
            text:
              `:nesting_dolls: master requested ${directives.length} sub-part${directives.length === 1 ? 'y' : 'ies'} ` +
              `(depth ${depth + 1}/${MAX_PARTY_DEPTH}). Spawning…`,
          });
        } catch { /* non-fatal */ }
        for (const d of directives) {
          if (this.isAborted(partyId)) break;
          const childRoster = d.with.length > 0
            ? d.with.filter((r) => (r in AGENTS)) as AgentRole[]
            : roster;
          if (childRoster.length === 0) continue;
          // Deduct half remaining of original budget for the child, conservatively.
          const childBudget = Math.max(0.30, Math.min(1.5, budgetUsd * 0.5));
          await this.run({
            ...input,
            topic: d.topic,
            roster: childRoster,
            // Children get freeform unless template stuck; quick mode is fine for follow-ups.
            template: 'freeform',
            mode: mode === 'quick' ? 'quick' : 'sequential',
            rounds: 1,
            budgetUsd: childBudget,
            parentPartyId: partyId,
            depth: depth + 1,
            allowSubparties: false, // grandchildren forbidden by default
          }).catch((err) => {
            logger.warn({ err: String(err), parent: partyId, topic: d.topic }, 'sub-party spawn failed');
          });
        }
      }
    }

    this.aborted.delete(partyId);

    logger.info(
      {
        partyId,
        outcome,
        contributions: transcript.length,
        totalCostUsd: grandTotal,
      },
      'party complete',
    );

    return {
      partyId,
      outcome,
      contributions: transcript.length,
      totalCostUsd: grandTotal,
    };
  }

  // ── per-agent / per-master spawn helpers ──────────────────────────

  private async persistAndPost(opts: {
    input: PartyInput;
    partyId: string;
    contribution: AgentContribution;
    round: number;
    totalRounds: number;
  }): Promise<void> {
    const c = opts.contribution;
    const messageId = partyStore.addMessage({
      party_id: opts.partyId,
      round_number: opts.round,
      agent_role: c.role,
      content: c.cleanContent,
      confidence: c.confidence,
      cost_usd: c.costUsd,
      duration_ms: c.durationMs,
      created_at: Date.now(),
      slack_message_ts: null,
    });
    try {
      const slackBody = formatAgentMessage({
        role: c.role,
        round: opts.round,
        totalRounds: opts.totalRounds,
        content: c.cleanContent,
        confidence: c.confidence,
        costUsd: c.costUsd,
      });
      const r = await opts.input.client.chat.postMessage({
        channel: opts.input.channelId,
        thread_ts: opts.input.threadTs,
        text: slackBody,
      });
      if (r.ts) partyStore.setSlackTs(messageId, r.ts);
    } catch (err) {
      logger.warn({ err: String(err), partyId: opts.partyId, role: c.role }, 'agent slack post failed');
    }
    eventBus.emitEvent({
      kind: 'party.agent_spoke',
      ts: Date.now(),
      partyId: opts.partyId,
      role: c.role,
      round: opts.round,
      confidence: c.confidence,
      costUsd: c.costUsd,
    });
  }

  private async runAgent(opts: {
    partyId: string;
    role: AgentRole;
    round: number;
    totalRounds: number;
    topic: string;
    transcript: AgentContribution[];
    sandbox: string;
    perAgentBudget: number;
    adversarial: boolean;
    quick: boolean;
  }): Promise<AgentContribution | null> {
    const personaPath = personaFilePath(this.deps.personaDir, opts.role);
    const prompt = this.buildAgentPrompt(opts);

    const result = await spawnClaudeOneshot({
      prompt,
      cwd: opts.sandbox,
      claudeBin: this.deps.claudeBin,
      effort: opts.quick ? 'low' : 'medium',
      maxBudgetUsd: opts.perAgentBudget,
      maxTurns: opts.quick ? 1 : AGENT_MAX_TURNS,
      systemPromptFile: personaPath,
      allowedTools: ALLOWED_TOOLS,
    });

    if (result.exitCode !== 0) {
      logger.warn(
        {
          partyId: opts.partyId,
          role: opts.role,
          exitCode: result.exitCode,
          stderr: result.stderr.slice(0, 400),
        },
        'agent spawn exited non-zero',
      );
      return null;
    }
    const raw = result.envelope?.result ?? '';
    if (!raw.trim()) return null;
    return {
      role: opts.role,
      round: opts.round,
      rawContent: raw,
      cleanContent: stripConfidenceLine(raw),
      confidence: parseConfidence(raw),
      costUsd: result.envelope?.total_cost_usd ?? 0,
      durationMs: result.durationMs,
    };
  }

  private async runMaster(opts: {
    partyId: string;
    topic: string;
    transcript: AgentContribution[];
    rounds: number;
    sandbox: string;
    outcome: PartyOutcome;
    template: string;
    subpartiesAllowed: boolean;
  }): Promise<AgentContribution | null> {
    const personaPath = personaFilePath(this.deps.personaDir, 'master');
    const prompt = await this.buildSynthesisPrompt(opts);

    const result = await spawnClaudeOneshot({
      prompt,
      cwd: opts.sandbox,
      claudeBin: this.deps.claudeBin,
      effort: 'medium',
      maxBudgetUsd: SYNTH_BUDGET_USD,
      maxTurns: SYNTH_MAX_TURNS,
      systemPromptFile: personaPath,
      allowedTools: ALLOWED_TOOLS,
    });

    if (result.exitCode !== 0) {
      logger.warn({ partyId: opts.partyId, exitCode: result.exitCode }, 'master synth failed');
      return null;
    }
    const raw = result.envelope?.result ?? '';
    if (!raw.trim()) return null;
    return {
      role: 'master',
      round: opts.rounds + 1,
      rawContent: raw,
      cleanContent: stripConfidenceLine(raw),
      confidence: parseConfidence(raw),
      costUsd: result.envelope?.total_cost_usd ?? 0,
      durationMs: result.durationMs,
    };
  }

  // ── prompt builders ───────────────────────────────────────────────

  private buildAgentPrompt(opts: {
    role: AgentRole;
    round: number;
    totalRounds: number;
    topic: string;
    transcript: AgentContribution[];
    adversarial: boolean;
    quick: boolean;
  }): string {
    const transcriptStr = opts.transcript
      .map((c) => {
        const a = AGENTS[c.role];
        const conf = c.confidence !== null ? ` · conf ${c.confidence.toFixed(2)}` : '';
        return `### ${a.display} — round ${c.round}${conf}\n${c.cleanContent.trim()}`;
      })
      .join('\n\n');

    const adversarialNote = opts.adversarial
      ? `\n\n**ADVERSARIAL MODE:** Your job this round is to actively look for flaws, gaps, or unsupported claims in what previous agents said. Push back hard. Don't be agreeable. If you genuinely agree, say so once and move on — but don't smooth over real disagreement.`
      : '';
    const quickNote = opts.quick
      ? `\n\n**QUICK MODE:** Keep your contribution to 2-3 short sentences. One key point only. End with the confidence line.`
      : '';

    return [
      `# Party debate — round ${opts.round} of ${opts.totalRounds}`,
      '',
      `You are speaking as **${AGENTS[opts.role].display}**. Stay in character per your persona file.${adversarialNote}${quickNote}`,
      '',
      '## Topic',
      opts.topic,
      '',
      '## Transcript so far',
      transcriptStr || '_(no contributions yet — you go first)_',
      '',
      '## Your task',
      opts.quick
        ? `Add ONE short contribution (2-3 sentences). Speak in your role's voice.`
        : `Add ONE contribution. 3-6 sentences. Speak in your role's voice.`,
      `End with the confidence line as your persona requires:`,
      '',
      '```',
      'confidence: 0.74',
      '```',
      '',
      'Do NOT use the Bash tool. You can use Read/Glob/Grep/WebFetch only.',
      'Do NOT use the words "hermes", "openclaw", "claw", or "nanoclaw" in any field.',
    ].join('\n');
  }

  private async buildSynthesisPrompt(opts: {
    topic: string;
    transcript: AgentContribution[];
    rounds: number;
    outcome: PartyOutcome;
    template: string;
    subpartiesAllowed: boolean;
  }): Promise<string> {
    const transcriptStr = opts.transcript
      .map((c) => {
        const a = AGENTS[c.role];
        const conf = c.confidence !== null ? ` · conf ${c.confidence.toFixed(2)}` : '';
        return `### ${a.display} — round ${c.round}${conf}\n${c.cleanContent.trim()}`;
      })
      .join('\n\n');

    // Load the output template file. If it's freeform OR file missing,
    // use the persona-default synthesis structure.
    let templateBody = '';
    if (opts.template && opts.template !== 'freeform') {
      const tplPath = path.join(
        this.deps.personaDir,
        'templates',
        `${opts.template}.md`,
      );
      try {
        templateBody = await fs.readFile(tplPath, 'utf8');
      } catch {
        templateBody = '';
      }
    }
    if (!templateBody) {
      try {
        templateBody = await fs.readFile(
          path.join(this.deps.personaDir, 'templates', 'freeform.md'),
          'utf8',
        );
      } catch {
        templateBody = '';
      }
    }

    const subpartyNote = opts.subpartiesAllowed
      ? [
          '',
          '## Optional: spawn sub-parties',
          'If — and only if — the synthesis exposes a clearly-scoped follow-up question that genuinely benefits from a fresh debate (not just more elaboration), you MAY emit up to 2 sub-party directives at the END of your output:',
          '',
          '    <spawn-subparty topic="should we use redis or postgres for X" with="architect,dev"/>',
          '    <spawn-subparty topic="latency budget for the embedding path"/>',
          '',
          'Rules:',
          '- topic: required, plain text, no nested quotes',
          '- with: optional comma-separated subset of {analyst, pm, architect, dev, qa, ux} — empty = inherit parent roster',
          '- Do NOT emit a sub-party for "needs more research" — that is the parent\'s job',
          '- Do NOT emit a sub-party for trivial follow-ups',
          '- Each sub-party costs real money (~$0.50). Emit zero if uncertain.',
        ].join('\n')
      : '';

    return [
      '# Party synthesis',
      '',
      'You are BMad-Master. The agents have just finished debating the topic below. Synthesize per your persona file AND the output template provided.',
      '',
      '## Topic',
      opts.topic,
      '',
      '## Full transcript',
      transcriptStr,
      '',
      '## Output template (FOLLOW THIS STRUCTURE EXACTLY)',
      templateBody || '_(no template — use your persona\'s default synthesis structure)_',
      subpartyNote,
      '',
      '## Output rules',
      '- Stay under the word limit specified in the template (or 600 if unspecified).',
      '- Be opinionated where the evidence supports it; honest about gaps.',
      '- Cite agents by name in [brackets] when their position drove a decision.',
      '- End with one overall `confidence: 0.XX` line.',
      '- Do NOT use the Bash tool. Read/Glob/Grep/WebFetch only.',
      '- Do NOT use the words "hermes", "openclaw", "claw", or "nanoclaw" anywhere.',
    ].join('\n');
  }

  // ── sub-party directive parser ────────────────────────────────────


  private renderTranscriptMd(opts: {
    partyId: string;
    topic: string;
    roster: AgentRole[];
    rounds: number;
    contributions: AgentContribution[];
    synthContent: string;
    grandTotal: number;
  }): string {
    const rosterStr = opts.roster.map((r) => AGENTS[r].display).join(', ');
    const lines: string[] = [
      `# Party transcript — ${opts.partyId}`,
      '',
      `**Topic:** ${opts.topic}`,
      `**Roster:** ${rosterStr}`,
      `**Rounds:** ${opts.rounds}`,
      `**Total cost:** $${opts.grandTotal.toFixed(4)}`,
      '',
      '---',
      '',
    ];
    for (const c of opts.contributions) {
      const a = AGENTS[c.role];
      const conf = c.confidence !== null ? ` · conf ${c.confidence.toFixed(2)}` : '';
      lines.push(`## ${a.display} — round ${c.round}${conf}`);
      lines.push('');
      lines.push(c.cleanContent.trim());
      lines.push('');
    }
    if (opts.synthContent) {
      lines.push('---');
      lines.push('');
      lines.push('## BMad-Master synthesis');
      lines.push('');
      lines.push(opts.synthContent.trim());
    }
    return lines.join('\n');
  }
}

/**
 * Parse `<spawn-subparty topic="…" with="role,role"/>` self-closing tags
 * out of a synthesis blob. Tolerant of single/double quotes and surrounding
 * whitespace. Returns at most 4 directives (caller will further cap).
 */
export function parseSubpartyDirectives(text: string): { topic: string; with: string[] }[] {
  const out: { topic: string; with: string[] }[] = [];
  const tagRe = /<spawn-subparty\b([^>]*?)\/>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    if (out.length >= 4) break;
    const attrs = m[1] ?? '';
    const topicMatch = attrs.match(/topic\s*=\s*"([^"]+)"/i)
      ?? attrs.match(/topic\s*=\s*'([^']+)'/i);
    if (!topicMatch) continue;
    const topic = topicMatch[1].trim();
    if (!topic) continue;
    const withMatch = attrs.match(/with\s*=\s*"([^"]*)"/i)
      ?? attrs.match(/with\s*=\s*'([^']*)'/i);
    const withList = withMatch
      ? withMatch[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];
    out.push({ topic, with: withList });
  }
  return out;
}
