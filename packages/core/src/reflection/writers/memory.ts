import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from '../../logger';

/**
 * Append memory_notes from a reflection into Claude Code's Auto Memory
 * directory: ~/.claude/projects/<project>/memory/MEMORY.md.
 *
 * The directory is per-git-project. For Thoth's bridge we use the
 * stable name "Thoth" so notes survive across worktree changes.
 *
 * Policy:
 *   - Cap at 5 notes per session (avoid flooding).
 *   - Cap MEMORY.md at 50 lines of recent notes; older entries get
 *     archived into ./memory/archive-<YYYY-MM-DD>.md when we hit the
 *     ceiling. (Phase 5's Dream pass replaces this with smarter
 *     consolidation.)
 *   - Each note line is timestamped + sender-tagged so a future
 *     reader knows when and why it landed.
 */

const MAX_NOTES_PER_SESSION = 5;
const MAX_RECENT_LINES = 50;

export interface MemoryWriteContext {
  threadKey: string;
  senderPeerId: string;
  senderDisplayName: string;
  channelName: string;
  recordedAt: number;
}

export interface MemoryWriteResult {
  appended: number;
  archived: number;
  filePath: string;
}

export async function writeMemoryNotes(
  notes: readonly string[],
  ctx: MemoryWriteContext,
  memoryDirOverride?: string,
): Promise<MemoryWriteResult> {
  const dir =
    memoryDirOverride ??
    path.join(os.homedir(), '.claude', 'projects', 'Thoth', 'memory');
  const file = path.join(dir, 'MEMORY.md');
  await fs.mkdir(dir, { recursive: true });

  const trimmed = notes
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, MAX_NOTES_PER_SESSION);

  if (trimmed.length === 0) {
    return { appended: 0, archived: 0, filePath: file };
  }

  const dateIso = new Date(ctx.recordedAt).toISOString().slice(0, 10);
  const header = await ensureHeader(file);

  const newLines = trimmed.map(
    (note) =>
      `- [${dateIso}] ${note}  _(via ${ctx.senderDisplayName} in ${ctx.channelName})_`,
  );

  const existing = await fs.readFile(file, 'utf8').catch(() => '');
  const updated = (existing.endsWith('\n') ? existing : existing + '\n') + newLines.join('\n') + '\n';
  await fs.writeFile(file, header ? ensurePrefix(updated, header) : updated, 'utf8');

  // Apply 50-line ceiling: rotate oldest into archive if we're over.
  const archived = await maybeArchive(dir, file);

  logger.info(
    {
      threadKey: ctx.threadKey,
      appended: newLines.length,
      archived,
      file,
    },
    'memory_notes written to Auto Memory',
  );

  return { appended: newLines.length, archived, filePath: file };
}

async function ensureHeader(file: string): Promise<string | null> {
  try {
    const exists = await fs.stat(file);
    if (exists.size > 0) return null;
  } catch {
    // file missing — give it a header
  }
  return [
    '# Thoth — auto-curated memory',
    '',
    'Notes written by Thoth during reflection at session end.',
    'Edit freely; `/memory` opens this file. Older entries rotate into',
    'archive-YYYY-MM-DD.md when the recent list exceeds 50 lines.',
    '',
    '## Recent notes',
    '',
  ].join('\n');
}

function ensurePrefix(content: string, prefix: string): string {
  return content.startsWith(prefix) ? content : prefix + content;
}

async function maybeArchive(dir: string, file: string): Promise<number> {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  const lines = text.split('\n');
  const entryLines = lines.filter((l) => l.startsWith('- ['));
  if (entryLines.length <= MAX_RECENT_LINES) return 0;

  const overflow = entryLines.slice(0, entryLines.length - MAX_RECENT_LINES);
  const dateIso = new Date().toISOString().slice(0, 10);
  const archivePath = path.join(dir, `archive-${dateIso}.md`);
  const archiveHeader =
    `# Archived memory notes — rotated ${dateIso}\n\n`;
  const archiveExisting = await fs.readFile(archivePath, 'utf8').catch(() => '');
  const archiveBody = (archiveExisting || archiveHeader) + overflow.join('\n') + '\n';
  await fs.writeFile(archivePath, archiveBody, 'utf8');

  // Rewrite MEMORY.md with header + remaining entries.
  const remaining = entryLines.slice(entryLines.length - MAX_RECENT_LINES);
  const header = await ensureHeader(file);
  const newContent = (header ?? '') + remaining.join('\n') + '\n';
  await fs.writeFile(file, newContent, 'utf8');
  return overflow.length;
}
