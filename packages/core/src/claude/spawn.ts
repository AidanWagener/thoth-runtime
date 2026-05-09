import { spawn, ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { SCRUBBED_ENV_KEYS } from '../auth/probe';
import { logger } from '../logger';

export interface SpawnOptions {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  resumeSessionId?: string;
  maxTurns: number;
  maxBudgetUsd: number;
  claudeBin: string;
}

export interface OneshotSpawnOptions {
  prompt: string;
  cwd: string;
  claudeBin: string;
  /** "low" | "medium" | "high" | "max" — defaults to inheriting session. */
  effort?: 'low' | 'medium' | 'high' | 'max';
  /** Hard ceiling on this single invocation's cost. */
  maxBudgetUsd: number;
  /** Hard ceiling on agentic turns. */
  maxTurns?: number;
  /**
   * Persona / system-prompt file to layer over Thoth base. Used by party
   * agents to layer in role-specific framing without inlining ~30KB of
   * persona text on the command line (Windows cmdline cap is ~32KB).
   */
  systemPromptFile?: string;
  /**
   * Tool whitelist passed via --allowedTools. Party agents use
   * "Read,Glob,Grep,WebFetch" so they can debate but not execute.
   */
  allowedTools?: string;
}

export interface OneshotResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Parsed `result` envelope from --output-format=json, if available. */
  envelope: ResultEnvelope | null;
  durationMs: number;
}

/** Subset of fields claude emits in --output-format=json result envelope. */
export interface ResultEnvelope {
  type: 'result';
  subtype?: string;
  session_id?: string;
  total_cost_usd?: number;
  num_turns?: number;
  result?: string;
  is_error?: boolean;
  error?: string;
}

export type ClaudeChild = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Spawn `claude -p` for a single turn, configured for stream-json output
 * and bypass-permissions, with all API-routing env vars stripped.
 *
 * The caller consumes child.stdout via the stream parser and child.stderr
 * for diagnostics. The child runs to completion on its own; the caller
 * does NOT pipe further input on stdin.
 */
export function spawnClaude(opts: SpawnOptions): ClaudeChild {
  const args: string[] = [
    '-p',
    opts.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--max-turns',
    String(opts.maxTurns),
    '--max-budget-usd',
    String(opts.maxBudgetUsd),
    '--permission-mode',
    'bypassPermissions',
  ];

  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  } else if (opts.systemPrompt) {
    // Windows CreateProcess caps the entire command line at ~32KB. The full
    // persona stack is ~30-80KB, so we always write it to a file and use
    // --append-system-prompt-file. The file lives inside the sandbox cwd
    // so it's cleaned up alongside the session.
    const bridgeDir = path.join(opts.cwd, '.bridge');
    fs.mkdirSync(bridgeDir, { recursive: true });
    const promptFile = path.join(bridgeDir, 'system-prompt.md');
    fs.writeFileSync(promptFile, opts.systemPrompt, 'utf8');
    args.push('--append-system-prompt-file', promptFile);
  }

  // Scrub env: rebuild from process.env minus the API-routing keys.
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SCRUBBED_ENV_KEYS.includes(k)) continue;
    env[k] = v;
  }

  logger.debug(
    {
      bin: opts.claudeBin,
      cwd: opts.cwd,
      resume: opts.resumeSessionId ?? null,
      promptLen: opts.prompt.length,
      systemPromptLen: opts.systemPrompt?.length ?? 0,
    },
    'spawning claude',
  );

  const child = spawn(opts.claudeBin, args, {
    cwd: opts.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  }) as ClaudeChild;

  return child;
}

/**
 * Run claude as a one-shot subprocess that returns the full final-result
 * envelope in a single JSON object. No streaming, no partial messages,
 * no persona stack, no resume — used by the reflection loop and any
 * other "ask claude one question, get one answer back" workflow.
 *
 * Returns when the subprocess exits. The caller can then JSON.parse
 * envelope.result to extract structured output.
 */
export async function spawnClaudeOneshot(
  opts: OneshotSpawnOptions,
): Promise<OneshotResult> {
  const args: string[] = [
    '-p',
    opts.prompt,
    '--output-format',
    'json',
    '--permission-mode',
    'bypassPermissions',
    '--max-budget-usd',
    String(opts.maxBudgetUsd),
  ];
  if (opts.effort) {
    args.push('--effort', opts.effort);
  }
  if (typeof opts.maxTurns === 'number') {
    args.push('--max-turns', String(opts.maxTurns));
  }
  if (opts.systemPromptFile) {
    args.push('--append-system-prompt-file', opts.systemPromptFile);
  }
  if (opts.allowedTools) {
    args.push('--allowedTools', opts.allowedTools);
  }

  // Same env-scrub as the streaming spawn — never let API-routing keys
  // override the Max subscription.
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SCRUBBED_ENV_KEYS.includes(k)) continue;
    env[k] = v;
  }

  logger.debug(
    {
      bin: opts.claudeBin,
      cwd: opts.cwd,
      effort: opts.effort ?? '(inherit)',
      maxBudgetUsd: opts.maxBudgetUsd,
      promptLen: opts.prompt.length,
    },
    'spawning claude (oneshot)',
  );

  const t0 = Date.now();
  const child = spawn(opts.claudeBin, args, {
    cwd: opts.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: Buffer) => {
    stdout += d.toString('utf8');
  });
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString('utf8');
  });

  const exitCode: number = await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    child.once('exit', (code) => resolve(code ?? 0));
    child.once('error', () => resolve(1));
  });

  let envelope: ResultEnvelope | null = null;
  // Strategy: --output-format json prints a single JSON object to stdout
  // on success. On failure, stderr usually has the error and stdout is
  // empty/partial. Try to parse stdout as JSON; if that fails, look for
  // the last well-formed JSON object in stdout.
  const trimmed = stdout.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as ResultEnvelope;
      if (parsed && typeof parsed === 'object' && parsed.type === 'result') {
        envelope = parsed;
      }
    } catch {
      // Try to find the last complete JSON object in stdout.
      const lastBrace = trimmed.lastIndexOf('{');
      if (lastBrace >= 0) {
        try {
          const tail = trimmed.slice(lastBrace);
          const parsed = JSON.parse(tail) as ResultEnvelope;
          if (parsed && parsed.type === 'result') envelope = parsed;
        } catch {
          // give up; envelope stays null
        }
      }
    }
  }

  return {
    stdout,
    stderr,
    exitCode,
    envelope,
    durationMs: Date.now() - t0,
  };
}
