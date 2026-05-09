# Changelog

All notable changes to **Thoth** are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- (in progress) Public OSS launch preparation per `docs/specs/SPEC-oss-extraction.md`
- Code migration from private working repo: 55 TypeScript modules ported, scrub clean (0 violations), typecheck clean across `@thoth-runtime/sdk`, `@thoth-runtime/core`, `@thoth-runtime/cli`.

### Architecture decision: monolithic v0.5

For shipping speed, **v0.5 ships as a monolith**. All runtime code lives in `@thoth-runtime/core` (memory, reflection, skills, party, ambient, Slack adapter, dashboard). The packages `@thoth-runtime/transport-slack`, `@thoth-runtime/transport-discord`, and `@thoth-runtime/dashboard` exist as **placeholders** in v0.5 and split out as peer packages in v0.6 when the Discord transport lands per [SPEC-discord-transport](../docs/specs/SPEC-discord-transport.md).

This is honest about the current architecture and avoids ~30 hours of import-surgery during launch crunch. The `Transport` interface in `@thoth-runtime/sdk` is published from day one so external transport authors can target the v0.6 shape ahead of time.

## [0.5.0] — 2026-07-22 — *Public OSS launch (planned)*

### Added
- **Public release.** MIT license. `github.com/thoth-runtime/thoth`.
- **Monorepo structure.** `@thoth-runtime/core`, `@thoth-runtime/transport-slack`, `@thoth-runtime/dashboard`, `@thoth-runtime/cli`, `@thoth-runtime/sdk`.
- **CLI:** `thoth init`, `thoth start`, `thoth dev`, `thoth doctor`, `thoth smoke`, `thoth migrate`.
- **Five-layer memory** stack composed: working / identity (Honcho) / episodic (cosine) / procedural (skills + persona) / reflection (Reflexion + 4 writers).
- **Slack transport** (`@thoth-runtime/transport-slack`) with reactions (✅❌🧠🗑️👤), magic commands (`/help`, `/whoami`, `/recall`, `/done`, `/loop-stop`), session continuity per thread.
- **Dashboard** (`@thoth-runtime/dashboard`) with Live, Sessions, Cosmos, Akashic Records, Tree of Life, Council, Firmament tabs.
- **Persona stack loader** with file-mtime drift detection.
- **Reflexion loop** at session-end with four fan-out writers.
- **Voyager-style skill compilation** (founder-gated via reaction).
- **Ambient agents** with daily budget envelope.
- **Scheduled self-spawn** + `/loop-stop`.
- **Memory provenance** scaffold.
- **Multi-agent party** orchestrator (BMAD-style).
- **Examples:**
  - `examples/minimal/` — smallest config that boots
  - `examples/operator-agent/` — full persona pack demonstrating production usage
  - `examples/multi-llm-party/` — stub (full implementation in v0.6, see `docs/specs/SPEC-multi-llm-party.md`)
- **Docs site** at [docs.thoth-runtime.dev](https://docs.thoth-runtime.dev) with quickstart, architecture, all subsystems documented.

### Pre-0.5.0 history

Thoth's pre-public history (May–July 2026, ~9,700 LOC dashboard, 50+ TS modules) lived in a private working repo and was extracted to this OSS project per `docs/specs/SPEC-oss-extraction.md`. Earlier internal milestones:

- **0.4.0 (2026-05-06):** Phase 4 — reactions + self-spawn + `/help`
- **0.3.0 (2026-05-06):** Phase 3 — reflection + skill compilation
- **0.2.0 (2026-05-06):** Phase 2 — episodic cross-thread recall
- **0.1.1 (2026-05-06):** Phase 1 — Honcho identity layer
- **0.1.0 (2026-05-05):** First end-to-end working bridge

These versions were never publicly released; 0.5.0 is the first public release.

[Unreleased]: https://github.com/thoth-runtime/thoth/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/thoth-runtime/thoth/releases/tag/v0.5.0
