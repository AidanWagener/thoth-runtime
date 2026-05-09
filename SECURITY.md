# Security policy

## Reporting a vulnerability

**Please do not report security issues via public GitHub issues.**

Email **security@thoth-runtime.dev** with:

- A description of the vulnerability
- Steps to reproduce
- Impact assessment (what an attacker could do)
- Affected versions (`thoth --version`)
- Your contact information

Include `[SECURITY]` in the subject line for fast triage.

For sensitive disclosures, request our PGP key in your initial email and
follow up with an encrypted message. The key fingerprint will be published
at `thoth-runtime.dev/security` once available.

## Response timeline

| Stage | Target |
|---|---|
| Acknowledgement of receipt | Within 24 hours |
| Initial assessment + severity classification | Within 72 hours |
| Status update if investigation ongoing | Weekly |
| Patch released for critical vulnerabilities | Within 7 days of confirmation |
| Patch released for non-critical | Within 30 days of confirmation |
| Public disclosure | After patch is available + a 30-day grace period for users to upgrade |

## Severity classification

We use a four-tier classification:

- **Critical:** Remote code execution, authentication bypass, exposure of
  customer credentials or PII at scale, supply-chain compromise.
- **High:** Privilege escalation, sensitive-data leak, denial of service
  affecting all users.
- **Medium:** Information disclosure with limited scope, denial of service
  with limited scope.
- **Low:** Minor information disclosure, edge-case behavior.

## Scope

In-scope:

- Code in `packages/*` of this repository
- Official Docker images published from this repository
- Hosted Cloud at `app.thoth-runtime.dev` (when launched)

Out-of-scope:

- Third-party MCP servers consumed via `thoth mcp install`
- Third-party Slack apps that integrate with Thoth
- Self-hosted instances misconfigured by operator (e.g., exposing
  dashboard to public internet without auth)
- The `thoth-workspace` private fork (separate codebase)

## Safe-harbor statement

We will not pursue legal action against researchers who:

- Make a good-faith effort to follow this policy
- Avoid privacy violations, data destruction, or service degradation
- Do not exploit vulnerabilities beyond what is necessary to demonstrate
  the issue
- Give us reasonable time to respond before public disclosure
- Do not use vulnerabilities to access customer data

## Recognition

With your consent, we credit responsible disclosures in:

- The patch release notes
- A security advisory on the GitHub repo
- Annual security report (when published)

## Known third-party dependencies

We pin all production dependencies and run `pnpm audit` + Snyk in CI.
Critical CVE in a dependency triggers an immediate patch release.

For our SBOM (Software Bill of Materials), see `dist/sbom.cdx.json` in
each release.

## Out-of-scope reports

Reports for any of the following will be acknowledged but typically not
acted on:

- Missing security headers on docs site
- Lack of rate-limiting on public read-only demo
- Self-XSS without elevation
- Reports without reproducible steps
- Issues requiring physical access to a victim's device
- Vulnerabilities in unsupported versions (>2 major versions behind)

## Last updated

2026-05-08
