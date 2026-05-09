# TOOLS.md — External services available

> Runtime resolves credentials from env vars. Don't ask the founder for credentials — request them via the appropriate vendor's web UI if missing.

## Code + repos

### GitHub

- **Token env:** `GITHUB_TOKEN` (fine-grained PAT, scoped to Helios org)
- **Org:** `helios-tools`
- **Active repos:** `helios-tools/helios-app`, `helios-tools/helios-cli`, `helios-tools/docs`
- **Capabilities:** read PRs, create comments, create issues, read commits, read workflow runs
- **Limits:** cannot merge PRs, cannot delete branches, cannot push to protected branches

## Hosting + ops

### Vercel

- **Token env:** `VERCEL_TOKEN`
- **Production project:** `helios-prod` (project ID `prj_helios_prod_id_here`)
- **Staging project:** `helios-staging`
- **Capabilities:** deploy status, env var listing, build logs, recent deployments, redeploy
- **Limits:** cannot create new projects, cannot change billing, cannot delete deploys

### Sentry

- **Token env:** `SENTRY_API_TOKEN`
- **Org:** `helios-tools`
- **Projects:** `helios-app`, `helios-cli`
- **Capabilities:** list issues, group by severity, mark resolved, comment on issues, fetch event details

## Databases

### Postgres (Helios prod)

- **Host:** `helios-prod-db.us-east.helios-internal.dev` (private VPC)
- **Username env:** `HELIOS_PG_USER` (read-only role for diagnostics)
- **Password env:** `HELIOS_PG_PASSWORD`
- **Read-only access only.** Schema queries, row counts, recent data inspection.
- **Cannot run DDL or DML.** For migrations, route through the staged-migration runbook.

## Communication

### Slack

- **Bot already running** (this is the bridge)
- **Channels:** `#ops`, `#oncall`, `#product`, `#customer-support`
- **Capabilities:** post messages, react, fetch user info, fetch channel info

### Email (transactional)

- **Resend** for outbound transactional email
- **Token env:** `RESEND_API_KEY`
- **From address:** `noreply@helios-tools.dev`
- **Use sparingly.** Customer-facing emails go through human review.

## Tracking

### Linear

- **Token env:** `LINEAR_API_KEY`
- **Workspace:** `helios-tools`
- **Capabilities:** create issues, update status, comment, fetch project state

## Status pages + monitoring

### Status page

- **URL:** `status.helios-tools.dev`
- **Token env:** `STATUSPAGE_TOKEN`
- **Capabilities:** read incident state, post incident updates (founder-gated)

### Grafana (read-only dashboard)

- **URL:** `grafana.helios-internal.dev` (private)
- **Token env:** `GRAFANA_API_KEY`
- **Capabilities:** fetch dashboard JSON, query Prometheus metrics
- **Cannot edit dashboards.** Read-only.

## What's NOT available

- **Stripe API** — billing changes require human review; route to Maya
- **AWS/GCP root access** — not delegated; route to Maya
- **DNS changes** — route to Maya
- **Customer PII queries** — route to support team via Linear ticket
- **External email-sending campaigns** — Marketing team's domain

## Tool-call discipline

- **Read first, decide second.** Before issuing a write, read the current state.
- **Idempotent operations preferred.** Posting the same Slack message twice is acceptable; deleting a Sentry issue twice is fine; running a SQL UPDATE twice is fine if WHERE-clause is precise.
- **Surface tool failures with the next step proposed.** "Sentry API returned 503; will retry in 60s" is the right shape. Don't retry forever.
