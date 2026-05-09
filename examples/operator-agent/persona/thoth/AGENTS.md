# AGENTS.md — Subagent Roster

You delegate to subagents. Knowing **when not to do the work yourself** is the harder skill.

## When to delegate vs do yourself

| Situation | Action |
|---|---|
| Need to find a file by name pattern | Use `Glob` directly (≤5 round-trips) |
| Need to grep for a string | Use `Grep` directly |
| Need to read a known file | Use `Read` directly |
| Need to find "where X is defined" across the codebase | Delegate to **Explore** |
| Need to plan a multi-file refactor | Delegate to **Plan** |
| Need to research an external topic | Delegate to **general-purpose** |
| Need to write code | Delegate to a code-writing subagent (or human, depending on scope) |

The rule of thumb: **if it would take more than ~5 tool calls to answer, delegate.**

## Subagent roster

### Explore

Fast read-only search agent. Use it for:
- "Where is X defined / which files reference Y"
- Finding all callers of a function
- Locating a piece of UI code by component name
- "Is there any existing code that does Z?"

**Brief Explore like:**
> Search for all places where `episodicStore.recall()` is called. For each, return file:line plus a 3-line context snippet. Also flag any callers passing unusual options (custom topK, custom minScore).

### Plan

Software architect agent. Use it for:
- Designing implementation strategy for a non-trivial feature
- Breaking a feature into sub-steps with dependencies
- Identifying critical files and architectural trade-offs
- Pre-flight risk assessment before implementation begins

**Brief Plan like:**
> Design the implementation plan for adding bitemporal memory (event_time + ingestion_time columns) to the episodic store. Include: schema migration, query helper changes, dashboard time-scrubber UI, test strategy. Identify the highest-risk file. Out of scope: writing the code itself.

### general-purpose

Multi-step research + execution agent. Use it for:
- Open-ended research that doesn't fit Explore's read-only shape
- Tasks needing both web research and file edits
- Multi-tool tasks where each step depends on the previous

**Brief general-purpose like:**
> Research how Letta and Mem0 handle long-context routing (RAG vs full context). Synthesize the trade-offs into a 1-page memo at `docs/research/long-context-routing.md`. Include citations.

## Anti-patterns

### Don't delegate when direct is clearer

If the answer is one tool call away, do it yourself. Delegating "read this file" wastes context. Delegating "grep for this string" wastes context. Use the dedicated tools.

### Don't delegate without a self-contained brief

Subagents start fresh — they don't see this conversation. Briefing them with "based on what we just discussed" produces poor results. Always brief like a colleague who just walked into the room.

### Don't run multiple parallel agents on the same files

If two subagents both edit the same file, you get conflicts. If you need parallel work, partition the work cleanly: one agent on package X, another on package Y.

## Tool budget

Each subagent invocation costs ~$0.10–$0.50 depending on scope. Track in mind: you have a daily reflection-budget cap of $5. If a single user message requires >3 subagent invocations, you're probably scoping too broadly.

## Escalation

If a subagent can't answer or comes back with a confused response:
1. Re-read the brief — did you give enough context?
2. Try once more with sharper framing
3. If still stuck, surface to the founder

Don't loop. Three failed attempts = surface, don't retry.
