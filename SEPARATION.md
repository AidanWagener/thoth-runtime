# SEPARATION — Thoth OSS vs thoth-workspace

> Read me before any code work. Two workspaces. Read-only ancestry. No live linkage.

## What this is

This directory (`C:\Users\aidan\Desktop\thoth\`) is the **public open-source Thoth runtime**. It will become `github.com/thoth-runtime/thoth`. MIT-licensed.

## What this is NOT

This is NOT the operator infrastructure for any specific business. The author's working operator workspace lives elsewhere (`thoth-workspace/services/slack-bridge/`), runs continuously, and is **never modified** by work in this repo.

## The rule

**One direction only:** content flows from `thoth-workspace/services/slack-bridge/` → COPY → `thoth/packages/...` (manual, one-shot, with scrubbing). Never the reverse. Never via symlink, submodule, or shared dependency.

The original `thoth-workspace` instance keeps running its private fork forever. The two codebases diverge as siblings with shared ancestry.

## Why it matters

The author's day job uses Thoth (a persona running on the original Thoth bridge) to operate a production system. Breaking that bridge would interrupt real revenue. Extraction is one-time copy-with-scrub; original stays intact.

## What lives where

| Concern | thoth-workspace | thoth (this repo) |
|---|---|---|
| Source of truth for the runtime | Initially yes; eventually a private fork of public OSS | Will become canonical OSS source post-launch |
| Persona files | `persona/thoth/`, `persona/aether/` (private, Tutel-Thoth working set) | `examples/operator-agent/persona/` (sanitized demo) |
| Spec documents | `services/slack-bridge/SPEC-*.md` (planning) | `docs/specs/` (public roadmap) |
| Customer data | `services/slack-bridge/bridge.db` (real sessions) | None — fresh install |
| Credentials | `.env`, `persona/thoth/credentials.md` (private) | None — never in repo |

## How to work in this repo

```bash
cd C:\Users\aidan\Desktop\thoth   # this repo, public OSS
# work happens here
```

## How to work on the operator (Tutel)

```bash
cd C:\Users\aidan\Desktop\thoth-workspace\services\slack-bridge
pnpm dev   # the running bridge — leave running
```

**Do not run `pnpm install` or `pnpm dev` simultaneously in both directories using the same ports.** The Thoth dashboard listens on `:8787` by default in both. If you need both running, change port in one via `thoth.config.ts`.

## Future divergence

Once `thoth-runtime/thoth` is public:

- New features ship to OSS first; cherry-pick into thoth-workspace if useful for Thoth's day job
- thoth-workspace can pin to a specific OSS Thoth version forever; never required to upgrade
- Major version-skew is fine; the two are independent products

## Last updated

2026-05-08, at start of OSS extraction.
