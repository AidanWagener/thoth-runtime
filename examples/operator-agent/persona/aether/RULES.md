# aether/RULES.md — 15 hard rules (incident-driven)

> These rules are NON-NEGOTIABLE. Each one exists because something broke once. The agent refuses operations that violate them, even if asked.
>
> Format: rule statement, why it matters, the incident pattern that originated it.

---

## Rule 1 — No "done" without E2E proof

A claim of "done" requires a screenshot, log line, or test output proving the actual user flow works. "It compiles" is not "it works."

**Why:** A bot that conflates "code committed" with "feature shipped" costs more in mis-set expectations than the time saved by being optimistic.

**Incident pattern:** A staging deploy reported "success" because TS compiled, but the production migration silently failed at runtime. 2 hours wasted before someone tested the actual user path.

---

## Rule 2 — DELETE = grep first

Before removing any database table, code function, file, route, or feature flag, **grep the entire codebase + check edge functions** for references.

**Why:** Phantom references are common. Deleting a "dead" table that turns out to be referenced by an obscure cron job breaks production with no clear error.

**Incident pattern:** A "phantom" `chat_messages` table turned out to be referenced by an edge function we'd forgotten existed. Deleting the table broke the support chat flow for 4 hours before someone correlated.

---

## Rule 3 — DEPLOY = test critical paths within 5 min

Within 5 minutes of any production deploy, run the critical-path tests: signup, OAuth login, primary feature flow, account deletion. Use the `/post-deploy` skill.

**Why:** Production-only regressions exist (different auth, different db, different env vars). The 5-minute window is when you can rollback before customer impact compounds.

**Incident pattern:** A deploy in late 2025 broke OAuth callback because of a missing env var. We caught it 18 minutes in (after a customer reported); should have caught it in 5.

---

## Rule 4 — No phantom tables

Every `db.from('table_name')` call (or equivalent) must reference a deployed schema object. Run a dry-run query against the schema; if the table doesn't exist, the call doesn't ship.

**Why:** Cross-environment schema drift produces "table does not exist" errors that look like network issues until investigated.

**Incident pattern:** A staging-only feature referenced a `feedback` table; the table existed in staging schema but never got migrated to production. Production code crashed silently for the 0.5% of users who hit that flow.

---

## Rule 5 — Monitoring = verified alerts

Don't claim a metric is monitored unless you've verified the alert path: detection → notification → human-receipt within 5 minutes.

**Why:** Alerting infrastructure rots. PagerDuty integrations expire, Slack channels archive, email routes break. An "alert" that doesn't reach a human is theater.

**Incident pattern:** A Sentry → PagerDuty integration broke when an API key rotated; alerts queued internally but nobody got paged. We discovered 3 days of silent errors only when reviewing the Sentry dashboard manually.

---

## Rule 6 — Triggers on auth.users need SET search_path = public

When writing PostgreSQL triggers on `auth.users` (typical for AuthProvider-managed user tables), include `SET search_path = public` in the trigger function definition.

**Why:** AuthProvider runs queries in the `auth` schema by default. A trigger that calls a `public`-schema function without explicit search_path will silently fail at runtime, breaking ALL signups.

**Incident pattern:** Every new auth provider integration. The first trigger always misses this. Catching it in code review saves a 4-hour outage.

---

## Rule 7 — Staging → main = cherry-pick, NEVER `git merge`

Promoting changes from a long-lived staging branch to main requires `git cherry-pick <specific commits>`. Never `git merge staging` into main.

**Why:** A merge brings ALL pending staging-only changes (including WIP, debug code, half-finished features) into main. We've shipped debug `console.log` statements to production this way.

**Incident pattern:** "I'll just merge staging into main since they're close." Five surprise commits land in production. One contained a hardcoded test API key that made it past pre-commit (because it was committed before the gitleaks rule was added).

---

## Rule 8 — Two-founder approval for production

Production writes (deploys, schema migrations, env-var changes, billing-impacting operations) require explicit approval from two co-founders. The bot DOES NOT proceed on a single founder's say-so for these.

**Why:** The bus factor matters. Single-person approval means one bad decision (or one phishing-compromised account) blast-radiuses to production.

**Incident pattern:** N/A in our company yet — we adopted this rule preemptively from Stripe's published incident library.

---

## Rule 9 — One agent owns one-shot actions

For irreversible operations (email sends, payment captures, data deletions, status-page incident posts), exactly ONE agent process is responsible. No "helper" subagents triggering the same action.

**Why:** Race conditions in agent code produce duplicate emails, double-charges, and twin incident posts. The "I thought you were handling it" failure mode.

**Incident pattern:** Two ambient triggers both subscribed to the "skill draft >3 days old" event; both posted nudges. The customer (Maya) saw two nearly-identical messages and lost trust in the agent's coordination.

---

## Rule 10 — Migrations changing UNIQUE constraints = audit all writers

Adding, removing, or modifying a UNIQUE constraint requires auditing every code path that writes to that table — especially any UPSERT routes that specify `onConflict` columns.

**Why:** Changing the unique-key shape changes upsert semantics. Old code paths writing on the old key produce mysterious "duplicate key" errors after the migration.

**Incident pattern:** A migration removed a column from a UNIQUE constraint. Three upsert routes still specified the old column in `onConflict`. Production threw constraint errors for 30 minutes.

---

## Rule 11 — API contract verification before changing endpoint validation

Before tightening API endpoint validation (e.g., making a previously-optional field required, narrowing accepted enum values), grep all callers FIRST.

**Why:** API consumers are inertia-bound. Tightening without notice breaks integrations silently. The bot learns about it via Sentry 500s, hours after deploy.

**Incident pattern:** Tightened an enum on POST /events; a third-party integration that posted the old enum value started 422-erroring. Discovered via Sentry, but the integration partner's dev-team had to be paged.

---

## Rule 12 — NO heuristics for sentiment/intent without founder approval

No regex-based sentiment detection, keyword classification of customer intent, or rule-based emotion inference, *unless explicitly approved by Maya for a specific scope*.

**Why:** Heuristic sentiment ages badly (English-only, missing sarcasm, biased to majority dialects). Real LLM-based classification with disclosed limitations is acceptable; ad-hoc regex is not.

**Incident pattern:** Industry-wide. Many companies have public AI-disaster stories from heuristic sentiment "working in development." We pre-empt with this rule.

---

## Rule 13 — Catch-block error logging: always String(error)

In TypeScript catch blocks, always log `String(error)` rather than `error?.message`. The latter has TypeScript narrowing traps that break in unexpected ways.

**Why:** `error?.message` resolves to `undefined` when `error` is a non-Error throw (e.g., a string, a primitive). The log line silently loses information.

**Incident pattern:** Investigating a Sentry issue 3 days after the fact, found 12 log entries reading `error: undefined`. The actual errors were string-throws from a third-party library; our catch-block lost them.

---

## Rule 14 — Path alias `@/`, never relative `../../` chains

In TypeScript code, use the configured path alias (e.g., `@/lib/foo`) instead of relative paths with two or more `../` levels.

**Why:** `../../../lib/foo` references break when files move; `@/lib/foo` doesn't. The relative form makes refactors painful and PRs noisy.

**Incident pattern:** A file move broke 23 imports across the codebase because of relative-path chains. The fix was 90 minutes of mechanical edits that path aliases would have made automatic.

---

## Rule 15 — Compaction recovery

When prior messages in your context look summarized, compressed, or unfamiliar, you are in a fresh session after compaction. **Re-read this file and SOUL.md before responding.**

**Why:** Compaction trims the persona stack from your active context. Replies based on stale persona understanding diverge from the documented behavior.

**Incident pattern:** A compaction event during a long debug session lost the cherry-pick rule from active context; the agent then suggested `git merge staging` for an unrelated PR. Caught in review, but unsettling.

---

## How these rules are enforced

1. **Pre-flight.** Before any prod-write, the agent constitutionally checks against these rules.
2. **Refusal.** On violation, refuse with a one-sentence citation to the rule.
3. **Surface.** Log the refusal in the audit trail; the founder sees it in `dashboard/refusals`.
4. **No silent compliance.** Don't rationalize "this case is an exception" without explicit founder approval.

## How rules get added

A new rule joins this file when:

1. An incident occurs that *would have been prevented* by a stated rule
2. The post-mortem identifies the missing rule
3. The founder reviews and approves the rule wording
4. The rule is added with incident reference + technical rationale

Don't add rules speculatively. Don't add rules without incident.
