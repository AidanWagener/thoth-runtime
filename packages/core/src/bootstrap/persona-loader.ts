import fs from 'fs/promises';
import path from 'path';
import { logger } from '../logger';

const APEX_FILES = [
  'IDENTITY.md',
  'SOUL.md',
  'RULES.md',
  'AGENTS.md',
  'USER.md',
  'MEMORY.md',
] as const;

export interface PersonaStack {
  prompt: string;
  loadedFiles: string[];
  totalChars: number;
}

/**
 * Read the Thoth persona stack from disk and concatenate into a single
 * system-prompt string suitable for `claude --append-system-prompt`.
 *
 * Soft-fails on missing files (logs a warning, omits the file). Returns
 * an empty stack if everything is missing — caller decides whether to
 * proceed in vanilla mode.
 */
export async function loadPersonaStack(
  personaDir: string,
  aetherRulesPath?: string,
): Promise<PersonaStack> {
  const parts: string[] = [];
  const loaded: string[] = [];

  for (const file of APEX_FILES) {
    const full = path.join(personaDir, file);
    try {
      const text = await fs.readFile(full, 'utf8');
      parts.push(`# ===== ${file} =====\n\n${text.trim()}`);
      loaded.push(full);
    } catch (err) {
      logger.warn({ file: full, err: String(err) }, 'persona file missing — skipping');
    }
  }

  if (aetherRulesPath) {
    try {
      const text = await fs.readFile(aetherRulesPath, 'utf8');
      parts.push(`# ===== AETHER RULES =====\n\n${text.trim()}`);
      loaded.push(aetherRulesPath);
    } catch (err) {
      logger.warn(
        { path: aetherRulesPath, err: String(err) },
        'aether rules file missing — skipping',
      );
    }
  }

  const prompt =
    parts.length > 0
      ? `You are Thoth. The following persona stack defines your identity, soul, hard rules, agents, user, and memory. Honor it on every turn.\n\n` +
        parts.join('\n\n---\n\n')
      : '';

  return {
    prompt,
    loadedFiles: loaded,
    totalChars: prompt.length,
  };
}

/**
 * Snapshot persona file mtimes. Used to detect mid-session edits and
 * trigger --fork-session. v1: returns a single string fingerprint; if
 * it changes, fork.
 */
export async function fingerprint(
  personaDir: string,
  aetherRulesPath?: string,
): Promise<string> {
  const targets = [
    ...APEX_FILES.map((f) => path.join(personaDir, f)),
    ...(aetherRulesPath ? [aetherRulesPath] : []),
  ];
  const stats = await Promise.all(
    targets.map((p) =>
      fs.stat(p).then(
        (s) => `${p}:${s.mtimeMs}`,
        () => `${p}:missing`,
      ),
    ),
  );
  return stats.join('|');
}
