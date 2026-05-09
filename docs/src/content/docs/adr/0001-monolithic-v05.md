---
title: ADR-0001 — Monolithic v0.5 release
description: Why v0.5 ships as a single @thoth-runtime/core package despite the monorepo shape.
---

**Status:** Accepted · **Date:** 2026-05-09 · **Decider:** maintainer · **Verification:** B (recoverable in v0.6)

## Context

The OSS skeleton was scaffolded with the multi-package shape we want
long-term: `@thoth-runtime/core`, `@thoth-runtime/sdk`,
`@thoth-runtime/transport-slack`, `@thoth-runtime/transport-discord`,
`@thoth-runtime/dashboard`, `@thoth-runtime/cli`.

The migrated code (~9,700 LOC dashboard, 50+ TS modules) is tightly
coupled — `slack/handler.ts` directly imports from
`memory/`, `reflection/`, `skills/`, etc. Splitting these into peer
packages requires refactoring every cross-cutting import to use a
public `Transport` interface and would block launch by ~30 hours.

We need to launch fast (target 2026-07-22) without compromising the
long-term architecture.

## Decision

**v0.5 ships as a monolith.** All runtime code lives inside
`@thoth-runtime/core`. The other packages exist as **placeholders**:

- `@thoth-runtime/sdk` — real, contains type definitions only
- `@thoth-runtime/cli` — real, hosts the CLI bootstrap
- `@thoth-runtime/transport-slack` — placeholder (Slack code is in core/src/slack/)
- `@thoth-runtime/transport-discord` — placeholder (no implementation yet)
- `@thoth-runtime/dashboard` — placeholder (dashboard code is in core/src/dashboard/)

The `Transport` interface is published in the SDK from day one, so
external authors can target the v0.6 shape early.

## v0.6 plan

When the Discord transport ships (Q3 2026 per
[SPEC-discord-transport](../specs)), the necessary refactor includes:

1. Define the `Transport` interface concretely in SDK
2. Refactor `slack/handler.ts` etc. to use that interface (no direct
   memory/skills imports)
3. Move `core/src/slack/` → `transport-slack/src/`
4. Move `core/src/dashboard/` → `dashboard/src/`
5. Add Discord adapter at `transport-discord/src/`
6. Bump core to v0.6 with breaking-change note in CHANGELOG
7. Provide migration guide

## Consequences

### Positive

- **Ship in 6 weeks instead of 10**
- **Honest about current coupling** — no fake abstractions hiding it
- **Clean v0.6 narrative**: "Discord landed; we split transports"

### Negative

- **External transport authors can't target the v0.5 shape directly** —
  they need to wait for v0.6 OR fork the core package
- **Internal coupling is visible to OSS readers** — some will judge it
- **Breaking change in v0.6** — package boundary moves; consumers
  need to update imports

### Mitigation

- Document the trade-off explicitly in README + CHANGELOG (done)
- Publish the `Transport` interface in SDK so authors can prep against
  the v0.6 shape (done)
- Reserve npm scope for transport packages so v0.6 transition is
  drop-in (done)

## Alternatives considered

### Alternative 1 — Full multi-package shape at v0.5

**Pros:** Architecturally clean from day 1; external authors can target.

**Cons:** ~30 hours of import-surgery before launch; risk of bugs during
the refactor; delays launch by 2-4 weeks.

**Rejected because:** speed-to-market matters more than architectural
purity at this stage. Better to ship and iterate.

### Alternative 2 — Single-package with no monorepo shape

**Pros:** Even simpler.

**Cons:** Loses the v0.6 split path; would require restructuring later.

**Rejected because:** the monorepo shape is cheap and the v0.6 narrative
requires it.

### Alternative 3 — Punt the launch by a month

**Pros:** Cleaner architecture at v0.5.

**Cons:** Misses the August window; launch lands during EU vacation
season; competitors may absorb the niche.

**Rejected because:** timing matters more than architecture.

## Review trigger

Revisit this decision when:
- Discord transport ships (Q3 2026)
- An external author requests the v0.5 transport surface
- A bug surfaces from the coupled architecture that wouldn't have
  occurred in the split shape
