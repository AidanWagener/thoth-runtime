import { spawnClaudeOneshot } from '../claude/spawn';
import { buildReflectionPrompt, type ReflectionContext } from './prompts';
import { parseReflection, type Reflection } from './parser';
import { logger } from '../logger';

export interface ReflectionRunResult {
  reflection: Reflection | null;
  costUsd: number;
  durationMs: number;
  rawOutput: string;
  exitCode: number;
}

/**
 * Run the reflection subprocess and parse its output.
 *
 * Cost discipline: --effort low keeps token spend down; --max-budget-usd
 * caps the worst case. Persona is omitted (saves ~30 KB tokens per
 * session-end). The persona file is path-loaded by claude only if the
 * cwd is inside apex-workspace, which it is for our sandboxes.
 *
 * NOTE: cwd is set to a *fresh* temp dir, not the session's worktree,
 * so reflection sees the metadata + transcript prompt and nothing else.
 */
export async function runReflection(
  cwd: string,
  ctx: ReflectionContext,
  claudeBin: string,
  maxBudgetUsd: number,
): Promise<ReflectionRunResult> {
  const prompt = buildReflectionPrompt(ctx);

  const result = await spawnClaudeOneshot({
    prompt,
    cwd,
    claudeBin,
    effort: 'low',
    maxBudgetUsd,
    maxTurns: 5,
  });

  if (result.exitCode !== 0) {
    logger.warn(
      {
        threadKey: ctx.threadKey,
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 500),
      },
      'reflection subprocess failed',
    );
    return {
      reflection: null,
      costUsd: result.envelope?.total_cost_usd ?? 0,
      durationMs: result.durationMs,
      rawOutput: result.stdout,
      exitCode: result.exitCode,
    };
  }

  // claude -p --output-format=json wraps the assistant's reply in
  // envelope.result. That's where our JSON lives.
  const inner = result.envelope?.result ?? result.stdout;
  const reflection = parseReflection(inner);

  return {
    reflection,
    costUsd: result.envelope?.total_cost_usd ?? 0,
    durationMs: result.durationMs,
    rawOutput: inner,
    exitCode: result.exitCode,
  };
}
