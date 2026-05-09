# Operator-agent skills

> Sample skills demonstrating Voyager-style compilation in Thoth.

This directory contains the skill library for the operator-agent example.
Each subdirectory is one skill following the
[agentskills.io v1](https://agentskills.io/) format with Thoth extensions.

## Skills shipped with this example

| Skill | What | Version | Provenance |
|---|---|---|---|
| [`sentry-triage/`](sentry-triage/) | Triage Sentry issues, propose actions | 1.2.0 | Compiled from 4 reflection sessions; refined twice via reactions |

## Skill structure

```
sentry-triage/
├── SKILL.md          # human description (canonical entry)
├── manifest.json     # machine-readable metadata
├── tests/            # optional self-tests (none yet)
└── README.md         # optional longer doc
```

## How skills get added (the loop)

1. **Pattern detected by reflection.** When the same kind of work
   recurs, the reflection subprocess proposes a skill in its
   structured JSON output.

2. **Skill draft posted to Slack.** The bot DMs the founder a draft
   approval card with the proposed `SKILL.md` content.

3. **Founder approves with ✅.** The skill is `git add`+`git commit`'d
   to this directory.

4. **Subsequent sessions use it.** When intent matches the skill's
   description, the runtime loads the full SKILL.md into context and
   the agent invokes it.

## Skill genealogy (v0.6+)

Skills evolve. The `thoth.evolution_history` field in each manifest
records:

- **compose** — combined with another skill (e.g., sentry-triage v1.2 = v1.1 + jira-link)
- **refine** — same intent, better execution (driven by reaction signals)
- **fork** — branch for divergent purpose
- **merge** — combine forks back together

When a refinement regresses (negative reward delta), you can roll
back: `thoth skill rollback sentry-triage --to 1.1.0`.

See [Skills concept docs](https://docs.thoth-runtime.dev/concepts/skills/)
for the full picture.

## What's NOT in this directory

- The `jira-link` skill referenced by `sentry-triage` v1.2.0
  (intentionally — shows that skills can compose with skills you
  haven't yet built)
- Marketplace-purchased skills (Cloud feature, v0.6+)

## Cross-ecosystem skills

These skills are `agentskills.io/v1`-compliant. To export for use in
Claude Code, Cursor, or OpenAI agents:

```bash
thoth skill export sentry-triage --format agentskills --out sentry-triage.tar.gz
```

The export strips `thoth.*` extensions; the result runs in any
agentskills.io-compatible runtime.

## License

MIT.
