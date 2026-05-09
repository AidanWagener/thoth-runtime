// Unit tests for bootstrap/persona-loader. Uses tmp filesystem for
// fixtures so we can exercise the file-mtime fingerprint detection and
// soft-fail-on-missing-file behavior precisely.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadPersonaStack, fingerprint } from './persona-loader';

let tmpRoot: string;
let personaDir: string;

const APEX_FILES = [
  'IDENTITY.md',
  'SOUL.md',
  'RULES.md',
  'AGENTS.md',
  'USER.md',
  'MEMORY.md',
];

function writeFile(name: string, content: string): string {
  const full = path.join(personaDir, name);
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

beforeEach(() => {
  tmpRoot = path.join(os.tmpdir(), `thoth-persona-test-${randomUUID()}`);
  personaDir = path.join(tmpRoot, 'apex');
  fs.mkdirSync(personaDir, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('loadPersonaStack', () => {
  describe('full stack', () => {
    it('concatenates all 6 Thoth files in order', async () => {
      writeFile('IDENTITY.md', '# Thoth — operator\n');
      writeFile('SOUL.md', '## SOUL\nVoice + axioms\n');
      writeFile('RULES.md', '## RULES\nOperational rules\n');
      writeFile('AGENTS.md', '## AGENTS\nSubagents roster\n');
      writeFile('USER.md', '## USER\nFounder profile\n');
      writeFile('MEMORY.md', '## MEMORY\nSnapshot\n');

      const stack = await loadPersonaStack(personaDir);

      expect(stack.loadedFiles).toHaveLength(6);
      // Order matters — IDENTITY first, MEMORY last
      expect(stack.prompt).toContain('===== IDENTITY.md =====');
      expect(stack.prompt).toContain('===== SOUL.md =====');
      expect(stack.prompt).toContain('===== MEMORY.md =====');
      expect(stack.totalChars).toBe(stack.prompt.length);

      const identityIdx = stack.prompt.indexOf('IDENTITY.md');
      const memoryIdx = stack.prompt.indexOf('MEMORY.md');
      expect(identityIdx).toBeLessThan(memoryIdx);
    });

    it('prepends the "You are Thoth" preamble when files are present', async () => {
      writeFile('SOUL.md', 'soul content');
      const stack = await loadPersonaStack(personaDir);
      expect(stack.prompt).toMatch(/^You are Thoth\./);
    });
  });

  describe('partial stack (missing files)', () => {
    it('soft-fails on missing files (does not throw)', async () => {
      writeFile('IDENTITY.md', '# only identity exists');
      // No other files

      const stack = await loadPersonaStack(personaDir);
      expect(stack.loadedFiles).toHaveLength(1);
      expect(stack.prompt).toContain('IDENTITY.md');
    });

    it('returns empty stack when persona dir is empty', async () => {
      const stack = await loadPersonaStack(personaDir);
      expect(stack.prompt).toBe('');
      expect(stack.totalChars).toBe(0);
      expect(stack.loadedFiles).toEqual([]);
    });

    it('returns empty stack when persona dir does not exist', async () => {
      const nonExistent = path.join(tmpRoot, 'no-such-dir');
      const stack = await loadPersonaStack(nonExistent);
      expect(stack.prompt).toBe('');
      expect(stack.loadedFiles).toEqual([]);
    });
  });

  describe('aether rules', () => {
    it('appends aether rules when path provided + file exists', async () => {
      writeFile('SOUL.md', 'apex soul');
      const aetherPath = path.join(tmpRoot, 'aether-rules.md');
      fs.writeFileSync(aetherPath, '## Hard Rule 1: ...', 'utf8');

      const stack = await loadPersonaStack(personaDir, aetherPath);
      expect(stack.prompt).toContain('AETHER RULES');
      expect(stack.prompt).toContain('Hard Rule 1');
      expect(stack.loadedFiles).toContain(aetherPath);
    });

    it('soft-fails when aether path is provided but file is missing', async () => {
      writeFile('SOUL.md', 'apex soul');
      const stack = await loadPersonaStack(personaDir, '/non/existent/aether.md');
      expect(stack.prompt).not.toContain('AETHER RULES');
      expect(stack.loadedFiles).not.toContain('/non/existent/aether.md');
    });

    it('does not append aether section when path is omitted', async () => {
      writeFile('SOUL.md', 'apex soul');
      const stack = await loadPersonaStack(personaDir);
      expect(stack.prompt).not.toContain('AETHER RULES');
    });
  });

  describe('content trimming', () => {
    it('trims whitespace from individual file contents', async () => {
      writeFile('SOUL.md', '\n\n   apex soul   \n\n');
      const stack = await loadPersonaStack(personaDir);
      // The trim happens before injection
      expect(stack.prompt).not.toMatch(/=====\n\n\n\nMUST_NOT_HAVE_LEADING_WHITESPACE/);
      expect(stack.prompt).toContain('apex soul');
    });
  });
});

describe('fingerprint', () => {
  it('returns a string with all target paths', async () => {
    writeFile('IDENTITY.md', 'a');
    writeFile('SOUL.md', 'b');

    const fp = await fingerprint(personaDir);
    expect(fp).toContain('IDENTITY.md');
    expect(fp).toContain('SOUL.md');
    // All files in APEX_FILES are in the fingerprint, even if missing
    for (const f of APEX_FILES) {
      expect(fp).toContain(f);
    }
  });

  it('changes when a file mtime changes', async () => {
    writeFile('SOUL.md', 'v1');
    const fp1 = await fingerprint(personaDir);

    // Touch the file (different mtime)
    await new Promise((r) => setTimeout(r, 50));
    writeFile('SOUL.md', 'v2');
    const fp2 = await fingerprint(personaDir);

    expect(fp1).not.toBe(fp2);
  });

  it('marks missing files as "missing" rather than throwing', async () => {
    // Don't create any files
    const fp = await fingerprint(personaDir);
    expect(fp).toContain('missing');
    expect(fp).toContain('IDENTITY.md:missing');
  });

  it('is identical when files have not changed', async () => {
    writeFile('SOUL.md', 'stable content');
    const fp1 = await fingerprint(personaDir);
    const fp2 = await fingerprint(personaDir);
    expect(fp1).toBe(fp2);
  });

  it('includes aether path in fingerprint when provided', async () => {
    writeFile('SOUL.md', 'soul');
    const aetherPath = path.join(tmpRoot, 'aether.md');
    fs.writeFileSync(aetherPath, 'rules');
    const fp = await fingerprint(personaDir, aetherPath);
    expect(fp).toContain(aetherPath);
  });

  it('detects changes to aether rules independently', async () => {
    writeFile('SOUL.md', 'soul');
    const aetherPath = path.join(tmpRoot, 'aether.md');
    fs.writeFileSync(aetherPath, 'v1');
    const fp1 = await fingerprint(personaDir, aetherPath);

    await new Promise((r) => setTimeout(r, 50));
    fs.writeFileSync(aetherPath, 'v2');
    const fp2 = await fingerprint(personaDir, aetherPath);

    expect(fp1).not.toBe(fp2);
  });
});
