---
title: ADR-0003 — Five-layer memory composition
description: Why memory is split into five layers instead of a single vector store.
---

**Status:** Accepted · **Date:** 2026-05-09 · **Decider:** maintainer · **Verification:** A (architectural foundation)

## Context

Most agent frameworks treat memory as RAG: a vector store + a retriever.
You jam relevant chunks into context per turn, hope the model picks the
right ones, and call it memory.

This is insufficient for agents that grow over time:

- **No identity layer** — the agent has no model of *who you are* across
  threads, only what you said in retrieved chunks
- **No procedural distinction** — code/skill knowledge mixes with
  episodic conversation in the same vector space, polluting both
- **No reflection** — there's no place for the agent to *think about*
  past sessions and synthesize what was learned
- **No working memory** — the current turn's context is undifferentiated
  from long-term memory; everything is "context"

A composed-runtime architecture wants all five of these as separate
concerns with separate writers, retention policies, and access patterns.

## Decision

Memory composes as **five layers**:

| Layer | Storage | Writer | Cadence | Read by |
|---|---|---|---|---|
| **L1 Working** | Claude session state + Auto Memory file | Claude itself | Implicit per turn | Claude every boot |
| **L2 Identity** | Honcho (Workspace > Peer > Session) | Bridge per-turn | 1.5s dialectic + async ingest | Per turn (pre-spawn) |
| **L3 Episodic** | SQLite `episodes` table + Float32 BLOB embeddings | Bridge post-success | Per turn (after reply sent) | First turn of new threads |
| **L4 Procedural** | `.claude/skills/<slug>/SKILL.md` git-tracked + persona files | Reflection writer (drafts) → founder ✅ | At session boot | Claude Code skill auto-discovery |
| **L5 Reflection** | Drafts to disk + Slack DMs | `claude -p --effort low` at session end | At session end + nightly | Founder review, then layer-4 + identity update |

Each layer is **independently writable, queryable, and revocable**.

## Consequences

### Positive

- **Layered concerns**: identity changes don't pollute episodic; skills
  don't pollute persona; reflection has its own surface
- **Different retention per layer**: episodes can age out; persona is
  permanent; identity slowly evolves
- **Different writers**: Claude writes its own working memory; the
  bridge writes episodic; reflection writes skills (founder-gated);
  Honcho derives identity facts
- **Replayability**: episodes can be rewound (per
  [SPEC-bitemporal-memory](../specs)); identity can be exported (per
  Honcho's API)
- **Mythic mapping**: the layers map to roles in the Sefirot tree
  (Working = Malkuth, Identity = Binah, Episodic = Chokmah,
  Procedural = Yesod, Reflection = Kether), making the architecture
  visually legible in the dashboard

### Negative

- **More complex than RAG** — new readers must understand all five
  layers
- **More moving parts** — each layer is a potential failure point
- **Migration cost** — switching to Thoth requires mapping existing
  memory to the layered shape

### Mitigation

- Layers are **optional** — Honcho can be disabled via
  `HONCHO_DISABLED=true`, episodic via `EPISODIC_DISABLED=true`,
  reflection via `REFLECTION_DISABLED=true`. The runtime degrades
  gracefully to fewer layers.
- Documentation explains each layer with diagrams + use cases
- Each layer's write/read patterns are documented in
  [docs/concepts/memory](../concepts/memory)

## Alternatives considered

### Alternative 1 — Single vector store (RAG)

**Pros:** Simple, well-understood, easy to swap providers.

**Cons:** Fails to distinguish identity from episode from skill; no
clear path for reflection; no founder-gated procedural growth.

**Rejected because:** this is the failure mode we're trying to escape.

### Alternative 2 — Just Honcho + skills

**Pros:** Lighter, two well-defined layers.

**Cons:** No episodic recall; no reflection writers; no working memory
distinction. Loses cross-thread continuity.

**Rejected because:** the cross-thread story is core to the value.

### Alternative 3 — Three layers (working, episodic, procedural)

**Pros:** Simpler than five.

**Cons:** Conflates identity (per-peer model) with episodic (per-turn
record); loses the reflection-as-its-own-layer surface.

**Rejected because:** the per-peer identity model is a real and
distinct concern; reflection needs its own writers.

### Alternative 4 — Letta-style hierarchical memory

**Pros:** OS-inspired, well-researched.

**Cons:** Single hierarchy doesn't cleanly express the cross-cutting
concerns (identity is cross-cutting; reflection is cross-cutting).

**Rejected because:** we want the agent to grow, not just to swap
context blocks in/out.

## Review trigger

Revisit this decision when:
- Research demonstrates a 6th layer is fundamental (e.g., a "world
  model" layer per [Dreamer-style approaches](https://arxiv.org/abs/2509.24527))
- A specific layer is consistently disabled by users (signal we should
  restructure)
- A new memory backend ships that subsumes multiple layers (unlikely
  in 2-3 year horizon)
