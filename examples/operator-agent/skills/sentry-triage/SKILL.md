---
name: sentry-triage
description: Triage recent Sentry issues for the Helios production project, group by severity + frequency, propose actions
version: 1.2.0
author: "@operator-agent-example"
license: MIT
tags: [ops, sentry, triage, incident-response]
language: en
entry: SKILL.md
tools_allowed: [Read, WebFetch, Bash]
context: fork
thoth:
  persona: thoth
  required_layers: [episodic, procedural]
  estimated_cost_usd: 0.08
  evolution_history:
    - version: "1.0.0"
      parent: null
      mutation: null
      reason: "Initial skill compiled by reflection from 4 successful triage sessions"
      reward_delta: null
      created_at: "2026-04-15"
    - version: "1.1.0"
      parent: "1.0.0"
      mutation: refine
      reason: "Reaction-driven: 8 ✓ vs 1 ✗ over 30d → tightened severity heuristic"
      reward_delta: 0.34
      created_at: "2026-04-30"
    - version: "1.2.0"
      parent: "1.1.0"
      mutation: compose
      reason: "Composed with @operator-agent-example/jira-link skill to auto-link issues to tickets"
      reward_delta: 0.12
      created_at: "2026-05-08"
---

# Sentry Triage

When invoked, this skill triages recent Sentry issues for the Helios
production project: groups them by severity and frequency, identifies
patterns across error fingerprints, and proposes specific actions for
each high-priority cluster.

## When to invoke

- Maya asks "what's broken in prod?" or similar
- Morning digest is being assembled
- A spike in error rate is detected
- Ad-hoc when investigating a specific incident

## Steps

### 1. Pull recent Sentry data

Fetch the last 24 hours of unresolved issues from the
`helios-tools/helios-app` Sentry project, ordered by `freshness` then
`event_count`.

```bash
curl -s -H "Authorization: Bearer $SENTRY_API_TOKEN" \
  "https://sentry.io/api/0/projects/helios-tools/helios-app/issues/?statsPeriod=24h&query=is:unresolved&sort=freshness&limit=50"
```

### 2. Categorize by severity

Apply this heuristic (refined per v1.1.0 reaction signals):

- **Critical** (must respond <1h): error count >100/h **AND** affecting
  >5% of users **AND** in production
- **High** (must respond <4h): error count >20/h **AND** affecting
  >1% of users
- **Medium** (must respond <24h): error count >5/h **AND** affecting
  >0.1% of users
- **Low** (batch weekly): everything else

### 3. Cluster by error fingerprint

Group issues by their Sentry `culprit` field (file:line:function).
Issues sharing a culprit usually share a root cause; address them
together.

### 4. For each cluster, propose actions

Per cluster, emit a structured triage entry:

```markdown
**Critical** · 247 events · 7.3% of users · started 2026-05-08T14:23

`auth/oauth-callback.ts:142:handleSlackOAuth`
TypeError: Cannot read properties of undefined (reading 'redirect_uri')

→ **Action:** Likely missing the `redirect_uri` env var in production.
   Check Vercel env vars; redeploy if missing.
→ **Linked Jira:** HELIOS-1247 (auto-linked via jira-link composition)
→ **Similar past issue:** [Episode #2891](app://memory/2891) — same
   pattern in 2026-03; resolved by updating env var
```

### 5. Sentry summary card

After triage, post a compact summary card to Slack:

```
┌─ Helios Production · last 24h ──────────────┐
│  CRIT  1  ·  HIGH  3  ·  MED  12  ·  LOW  41 │
│                                              │
│  → CRIT: oauth-callback (likely env var)     │
│  → HIGH (3): same root cause; one fix        │
│                                              │
│  Triage doc: <link>                          │
└──────────────────────────────────────────────┘
```

## Hard rules (per persona/aether/RULES.md)

- **Verify before claiming.** Don't assert "this is fixed" without checking
  the Sentry issue is actually marked resolved.
- **Don't auto-resolve.** Mark issues as triaged in your output, but the
  human marks them resolved in Sentry.
- **EU AI Act compliance.** Don't infer affect/sentiment from error
  messages even when tempting (e.g., "user seems frustrated by this
  error" — out of bounds).

## Composition notes (v1.2.0)

This skill now composes with `@operator-agent-example/jira-link`:

1. After step 4 (proposing actions), this skill calls `jira-link.search`
   with the Sentry issue's culprit
2. If a related Jira ticket exists, it's auto-linked in the output
3. If no ticket exists and severity is Critical/High, this skill
   proposes creating one but does NOT create it (founder-gated)

## Reaction patterns

This skill is mature. Expected reactions on its output:

- ✅ on accurate triage = boost confidence; reflection writes positive note
- ❌ on wrong action proposal = reflection writes "what_didnt"; severity
  heuristic re-evaluated next refinement cycle
- 🧠 on a particularly good triage entry → save verbatim to MEMORY.md
  as a "good triage example" reference

## What's known to fail

- **Sentry rate limit.** If we triage too frequently, Sentry's API rate
  limits kick in. Mitigation: skill caches results for 5 minutes per
  session.
- **Stale issues.** Issues that have been "unresolved" for >7 days
  often aren't actually still happening; they're just not closed.
  Mitigation: skill weights `last_seen` heavily.
- **Custom fingerprints.** Some Helios services use custom Sentry
  fingerprints; clustering may over-aggregate. Mitigation: skill
  flags clusters >5 issues for human review.

## Lineage

This skill descends from a reflection in 2026-04 that observed:
*"Maya asked 'what's broken in prod' four times this week with similar
context. The reply pattern is consistent. Skill candidate."*

After founder ✅, the skill was committed at v1.0.0. Refinement cycles
have improved the severity heuristic and added jira-link composition.

See [Skills](/concepts/skills/) for how skill compilation works.
