/**
 * Smoke test the full claude pipeline end-to-end without Slack.
 *
 * Validates:
 *   1. Auth probe passes (no API-routing env vars).
 *   2. Persona stack loads from disk.
 *   3. spawn() spawns claude with our exact flag set.
 *   4. Stream parser handles the actual event shapes claude emits.
 *   5. We extract assistant text, session_id, cost, num_turns.
 *
 * Run: pnpm smoke
 */
import 'dotenv/config';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { authProbe } from '../src/auth/probe';
import { loadPersonaStack } from '../src/bootstrap/persona-loader';
import { spawnClaude } from '../src/claude/spawn';
import {
  parseStream,
  extractStreamingText,
  extractFinalAssistantText,
  extractInitSessionId,
  extractResult,
} from '../src/claude/stream-parser';

const PERSONA_DIR =
  process.env.PERSONA_DIR ??
  path.resolve(__dirname, '../../../persona/apex');
const AETHER_RULES_PATH =
  process.env.AETHER_RULES_PATH ??
  path.resolve(__dirname, '../../../persona/aether/RULES.md');
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';

const TEST_PROMPT =
  'Identify yourself in one sentence. Then list one rule from RULES.md by number. Total response under 60 words.';

async function main() {
  console.log('━━━ slack-bridge smoke test ━━━\n');

  // Step 1: auth probe
  console.log('[1/5] auth probe...');
  authProbe();
  console.log('      ok\n');

  // Step 2: persona stack
  console.log('[2/5] loading persona stack...');
  console.log(`      PERSONA_DIR=${PERSONA_DIR}`);
  console.log(`      AETHER_RULES=${AETHER_RULES_PATH}`);
  const persona = await loadPersonaStack(PERSONA_DIR, AETHER_RULES_PATH);
  if (persona.totalChars < 1000) {
    console.error(
      `      FAIL — persona is too short (${persona.totalChars} chars). loaded files:`,
      persona.loadedFiles,
    );
    process.exit(1);
  }
  console.log(
    `      ok — ${persona.totalChars.toLocaleString()} chars across ${persona.loadedFiles.length} files`,
  );
  for (const f of persona.loadedFiles) console.log(`        · ${f}`);
  console.log();

  // Step 3: sandbox dir
  const sandbox = path.join(os.tmpdir(), `slack-bridge-smoke-${Date.now()}`);
  await fs.mkdir(sandbox, { recursive: true });
  console.log(`[3/5] sandbox cwd: ${sandbox}\n`);

  // Step 4: spawn + stream
  console.log('[4/5] spawning claude with persona + test prompt...');
  console.log(`      prompt: "${TEST_PROMPT}"\n`);
  const t0 = Date.now();
  const child = spawnClaude({
    prompt: TEST_PROMPT,
    cwd: sandbox,
    systemPrompt: persona.prompt,
    maxTurns: 5,
    maxBudgetUsd: 1.0,
    claudeBin: CLAUDE_BIN,
  });

  const eventTypeCounts = new Map<string, number>();
  let assembled = '';
  let sessionId: string | undefined;
  let totalCost: number | undefined;
  let numTurns: number | undefined;
  let stderr = '';
  let firstTextAt: number | undefined;
  let sawStreamingDelta = false;

  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString('utf8');
  });

  try {
    for await (const ev of parseStream(child.stdout)) {
      eventTypeCounts.set(ev.type, (eventTypeCounts.get(ev.type) ?? 0) + 1);

      const initSid = extractInitSessionId(ev);
      if (initSid) sessionId = initSid;

      const delta = extractStreamingText(ev);
      if (delta) {
        sawStreamingDelta = true;
        if (firstTextAt === undefined) firstTextAt = Date.now() - t0;
        assembled += delta;
      } else if (!sawStreamingDelta) {
        const finalText = extractFinalAssistantText(ev);
        if (finalText) {
          if (firstTextAt === undefined) firstTextAt = Date.now() - t0;
          assembled += finalText;
        }
      }

      const r = extractResult(ev);
      if (r) {
        if (r.sessionId) sessionId = r.sessionId;
        if (typeof r.totalCostUsd === 'number') totalCost = r.totalCostUsd;
        if (typeof r.numTurns === 'number') numTurns = r.numTurns;
      }
    }
  } catch (err) {
    console.error('      stream parse error:', err);
    child.kill();
    process.exit(1);
  }

  const exitCode: number = await new Promise((res) => {
    if (child.exitCode !== null) return res(child.exitCode);
    child.once('exit', (c) => res(c ?? 0));
  });
  const elapsedMs = Date.now() - t0;

  console.log(`[5/5] result\n`);
  console.log(`      exit code:        ${exitCode}`);
  console.log(`      total time:       ${elapsedMs}ms`);
  console.log(
    `      first text in:    ${firstTextAt !== undefined ? `${firstTextAt}ms` : 'never'}`,
  );
  console.log(`      session_id:       ${sessionId ?? '(missing)'}`);
  console.log(
    `      total_cost_usd:   ${totalCost !== undefined ? `$${totalCost.toFixed(6)}` : '(missing)'}`,
  );
  console.log(`      num_turns:        ${numTurns ?? '(missing)'}`);
  console.log(`      assistant chars:  ${assembled.length}\n`);

  console.log(`      event types observed:`);
  for (const [t, n] of [...eventTypeCounts.entries()].sort()) {
    console.log(`        · ${t}: ${n}`);
  }
  console.log();

  console.log(`      assistant text:`);
  console.log(`      ────────────────────────────────────────`);
  console.log(
    assembled
      .split('\n')
      .map((l) => `      ${l}`)
      .join('\n'),
  );
  console.log(`      ────────────────────────────────────────\n`);

  if (stderr.trim()) {
    console.log(`      stderr:`);
    console.log(
      stderr
        .split('\n')
        .map((l) => `      ${l}`)
        .join('\n'),
    );
    console.log();
  }

  // Pass/fail
  const failures: string[] = [];
  if (exitCode !== 0) failures.push(`exit code ${exitCode}`);
  if (!sessionId) failures.push('no session_id captured');
  if (assembled.length === 0) failures.push('no assistant text');
  if (totalCost === undefined) failures.push('no total_cost_usd');
  const lower = assembled.toLowerCase();
  if (!lower.includes('apex')) failures.push('persona not honored (no "apex" in response)');

  if (failures.length > 0) {
    console.error(`FAIL: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('PASS turn 1 — full pipeline works end-to-end\n');

  // ──────────────────────────────────────────────────────────────────
  // Turn 2: --resume the captured session_id and verify context flows.
  // ──────────────────────────────────────────────────────────────────
  console.log('━━━ resume test (turn 2) ━━━\n');
  const resumePrompt =
    'In ten words or fewer, what was the rule number you just cited?';
  console.log(`      resuming session: ${sessionId}`);
  console.log(`      prompt: "${resumePrompt}"\n`);

  const child2 = spawnClaude({
    prompt: resumePrompt,
    cwd: sandbox,
    resumeSessionId: sessionId,
    maxTurns: 2,
    maxBudgetUsd: 1.0,
    claudeBin: CLAUDE_BIN,
  });

  let assembled2 = '';
  let sawDelta2 = false;
  let stderr2 = '';
  child2.stderr.on('data', (d: Buffer) => {
    stderr2 += d.toString('utf8');
  });

  for await (const ev of parseStream(child2.stdout)) {
    const delta = extractStreamingText(ev);
    if (delta) {
      sawDelta2 = true;
      assembled2 += delta;
    } else if (!sawDelta2) {
      const finalText = extractFinalAssistantText(ev);
      if (finalText) assembled2 += finalText;
    }
  }
  const exitCode2: number = await new Promise((res) => {
    if (child2.exitCode !== null) return res(child2.exitCode);
    child2.once('exit', (c) => res(c ?? 0));
  });

  console.log(`      exit code: ${exitCode2}`);
  console.log(`      response:`);
  console.log(`      ────────────────────────────────────────`);
  console.log(
    assembled2
      .split('\n')
      .map((l) => `      ${l}`)
      .join('\n'),
  );
  console.log(`      ────────────────────────────────────────\n`);
  if (stderr2.trim()) {
    console.log('      stderr:', stderr2.slice(0, 500));
  }

  const resumeFails: string[] = [];
  if (exitCode2 !== 0) resumeFails.push(`turn 2 exit ${exitCode2}`);
  if (assembled2.length === 0) resumeFails.push('no turn-2 text');
  if (!/2|two/i.test(assembled2)) {
    resumeFails.push('turn 2 did not recall "Rule 2" from turn 1 context');
  }
  if (resumeFails.length > 0) {
    console.error(`FAIL: ${resumeFails.join('; ')}`);
    process.exit(1);
  }
  console.log('PASS turn 2 — session resume works');
  process.exit(0);
}

main().catch((err) => {
  console.error('uncaught error in smoke:', err);
  process.exit(1);
});
