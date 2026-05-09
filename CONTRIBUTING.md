# Contributing to Thoth

Thank you for considering a contribution. This document is the working
agreement between you and the project.

## Three things to know first

1. **DCO sign-off is required on every commit.** Sign each commit with
   `git commit -s`. The Developer Certificate of Origin text is at
   [developercertificate.org](https://developercertificate.org/). No CLA.
2. **MIT-licensed inbound = MIT-licensed outbound.** By contributing, you
   agree your changes are MIT-licensed.
3. **Mythic register matters.** Thoth's voice is Egyptian-mythological. Code
   identifiers like `Sefirot`, `Akashic`, `Council`, `Tree`, `Cosmos` are
   load-bearing; please don't rename them to `MemoryStore` or `AgentSet`
   in PRs unless you're proposing a deliberate rebrand.

## How to contribute

### Bug reports

Open a GitHub issue using the **Bug** template. Include:
- Thoth version (`thoth --version`)
- Node version, OS
- Steps to reproduce
- What you expected
- What you observed
- Logs (`LOG_LEVEL=debug pnpm dev` output)

### Feature proposals

Open a GitHub issue using the **Feature** template **before** writing code
for non-trivial features. Most agent infra features have nuanced
trade-offs; alignment up front saves rework. For trivial changes (typos,
small bug fixes, doc improvements), feel free to PR directly.

### Pull requests

1. Fork the repo
2. Create a feature branch from `main`
3. Make your changes
4. Add tests (no `.skip()`, no stubbing the path under test)
5. Run `pnpm typecheck && pnpm test && pnpm lint` — all must pass
6. Commit with DCO sign-off (`git commit -s -m "..."`)
7. Add a changeset (`pnpm changeset`) if your change is user-visible
8. Open a PR with a clear description

### Tests

We use Vitest. Unit tests live next to source as `*.test.ts`. Integration
tests live in each package's `tests/` directory.

**Hard rule per `services/slack-bridge/persona/aether/RULES.md`:** no
`.skip()` on a flaky test, no stubbing the path under test. If a test
needs the real Claude CLI, use `pnpm smoke` to validate.

### Code style

- TypeScript with `strict: true` (already configured in `tsconfig.base.json`)
- Biome for formatting + linting (`pnpm format`, `pnpm lint`)
- Single-quote strings, trailing commas, semicolons
- 100-char line width
- One concept per file; >1k LOC files get split

### Commit messages

Follow Conventional Commits:

```
feat(memory): add bitemporal event_time column
fix(slack): handle empty message_ts in reaction handler
docs(quickstart): clarify Slack OAuth flow
refactor(party): extract orchestrator from monolithic file
test(skills): add genealogy round-trip test
```

## Architecture decisions

Significant architectural changes need an ADR (Architecture Decision Record)
in `docs/adr/`. Use the template at `docs/adr/0000-template.md`.

## Reviewing process

- One maintainer review minimum
- For changes affecting `packages/core/`, two reviews
- CI must be green
- DCO sign-off verified
- Merge: squash-and-merge by default

## Code of conduct

We follow the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Be kind,
disagreement is welcome, contempt is not.

## Saying no

Maintainers reserve the right to decline contributions that conflict with
the project's thesis (cultivation over extraction, mythic register, open
core). Such decisions come with explanation. They are not personal.

## Questions

- General: GitHub Discussions
- Real-time: Discord (link in README once launched)
- Security: see [SECURITY.md](SECURITY.md)

## Thank you

Every contribution — code, docs, bug reports, feature ideas — is welcome.
