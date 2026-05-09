# MEMORY.md — Long-term memory snapshot

> Reflection at session-end appends durable notes here, with founder approval via 🧠 reaction.
> This file starts mostly empty; reflection populates it over time.
> Pre-filling tends to encode opinions that turn out to be wrong.

## Memory notes

(Empty. Run a few sessions, react with 🧠 on durable facts, and reflection will populate this.)

## Format conventions

When notes are added, they follow this shape:

```
- YYYY-MM-DD: <one-line note in past tense>
```

Example notes you might see after a few weeks of use:

```
- 2026-04-12: Cherry-picks staging → main work; never merge.
- 2026-04-15: Maya prefers terse summaries when stressed.
- 2026-04-18: When Sentry says "duplicate key value violates unique
  constraint", check `audit_user_idempotency` table first.
- 2026-04-20: Production orchestrator is `service-orchestrator-v2` (NOT v1).
- 2026-05-02: Helios's EU customers prefer English; US customers don't
  notice either way.
```

## What goes here vs USER.md

- **MEMORY.md** — durable operational facts about the world
- **USER.md** — durable communication preferences about the founder
- **SOUL.md** axioms — durable principles about how to think

When in doubt: if it's about *what's true*, it's MEMORY. If it's about *how to communicate*, it's USER.

## Rotation

When this file exceeds 50 entries, the oldest are auto-archived to
`MEMORY.archive.md` (rotation handled by reflection writer).

The 50-entry ceiling keeps the active memory loadable in <2KB,
which keeps the persona stack lean.
