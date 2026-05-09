# Changesets

This directory uses [changesets](https://github.com/changesets/changesets) to manage releases.

## When to add a changeset

Add one whenever your PR introduces a user-visible change in any
`packages/*` package — features, breaking changes, fixes, perf
improvements, doc updates that change recommendations.

You do **not** need a changeset for:
- Internal refactors with no API change
- Doc-only changes that don't affect public guidance
- Test changes
- CI / build changes

## How to add one

```bash
pnpm changeset
```

Follow the prompt. Choose the impact level per package:
- **patch** — backwards-compatible bug fix
- **minor** — backwards-compatible new feature
- **major** — breaking change

Write a clear, user-facing summary. This text will appear in the
release notes.

## How releases happen

The `release` GitHub workflow runs on push to `main`:

1. If unreleased changesets exist, opens or updates a "Version Packages" PR
2. Merging that PR triggers `pnpm changeset publish` which:
   - Bumps versions per the changesets
   - Updates `CHANGELOG.md` per package
   - Tags releases in git
   - Publishes to npm

## Edge cases

- **Examples** are ignored from versioning (`config.json` `ignore` list).
- **Internal dependencies** auto-bump at patch level when their dependency moves.
- **Pre-releases** can be opened with `pnpm changeset pre enter alpha`.
