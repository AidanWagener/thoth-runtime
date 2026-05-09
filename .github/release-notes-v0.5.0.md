# 🜂 Thoth v0.5.0 — first public release

**The lifelong-learning agent runtime is open source.**

> *Thoth — Egyptian god of writing, wisdom, and the moon. Patron of scribes. Recorder of words.*

After ~3 months of intentional building, Thoth is publicly available under MIT
license. This is the first release.

## What's inside

A composed runtime with **five memory layers** working in concert:

- **L5 Reflection** — Reflexion at session-end, fanning out to four writers
- **L4 Procedural** — Voyager-style skills, persona files, hard rules
- **L3 Episodic** — cosine recall over local Xenova embeddings ($0/encode)
- **L2 Identity** — Honcho-backed theory-of-mind per peer
- **L1 Working** — Claude session state with auto-memory file

Plus: multi-agent council, ambient agents with daily budget envelope, scheduled
self-spawn, reactions as training signals, and a mythic dashboard built on the
Kabbalistic Tree of Life with Egyptian neteru as Sefirot.

## Highlights

### Composed runtime

5 packages (`@thoth-runtime/core`, `sdk`, `cli`, plus placeholders for
`transport-slack`, `transport-discord`, `dashboard`) — though v0.5 ships as a
**monolith** (everything in `core`) with v0.6 splitting transports + dashboard
into peers when Discord lands. See [ADR-0001](docs/src/content/docs/adr/0001-monolithic-v05.md).

### Subprocess delegation, not API

The runtime **never calls `api.anthropic.com` directly.** It spawns your local
`claude` CLI binary so every turn bills against your Max subscription. Env vars
that would override this (`ANTHROPIC_API_KEY`, etc.) are refused at boot.
See [ADR-0002](docs/src/content/docs/adr/0002-subprocess-delegation.md).

### Open standards

- `agentskills.io/v1`-compatible skill format from day one
- MCP server + client integration ships in v0.6
- A2A agent cards ship in v0.6

### Honest about what's not yet here

Things deferred to v0.6 or beyond, all publicly specced:

- Discord transport (Q3 2026)
- Multi-LLM heterogeneous party (Q1 2027)
- Skill genealogy graph (Q2 2027)
- Sleep cycles + dream synthesis (Q2 2027 — publishable architecture)
- Decision records + replay player (Q4 2026)
- Cloud product (Q3 2026 private beta → Q4 public)
- Skill marketplace (Q1 2027)

15 specs published at [docs.thoth-runtime.dev/specs](https://docs.thoth-runtime.dev/specs/).

## What's working today

- ✅ 56 TypeScript modules migrated, all typecheck clean
- ✅ 116 unit tests passing across security, parsing, storage, bootstrap layers
- ✅ Full Slack transport with reactions + magic commands + threaded sessions
- ✅ Reflexion at session-end with 4 fan-out writers
- ✅ Voyager-style skill compilation (founder-gated)
- ✅ 5-layer memory composed and inspectable
- ✅ Multi-agent council orchestrator (homogeneous models in v0.5)
- ✅ Ambient agents with daily budget envelope
- ✅ Scheduled self-spawn with `/loop-stop` cancellation
- ✅ Mythic dashboard — Tree of Life, Akashic Records, Council, Firmament, 3D Cosmos
- ✅ 17 docs pages built, 2,298 words searchable

## Quickstart

```bash
npx @thoth-runtime/cli init my-thoth && cd my-thoth && pnpm install && pnpm dev
```

Full quickstart at [docs.thoth-runtime.dev/quickstart](https://docs.thoth-runtime.dev/quickstart/).

## What you'll need

- Node 20+
- pnpm 9+
- A Slack workspace where you can install a custom app
- Claude CLI logged in to your Max subscription
- (Optional) Honcho API key for L2 identity layer — free tier at [app.honcho.dev](https://app.honcho.dev/)

## Architecture decisions documented

Three load-bearing decisions, each with full rationale + alternatives considered:

1. [Monolithic v0.5, split in v0.6](docs/src/content/docs/adr/0001-monolithic-v05.md)
2. [Subprocess delegation over API](docs/src/content/docs/adr/0002-subprocess-delegation.md)
3. [5-layer memory composition](docs/src/content/docs/adr/0003-five-layer-memory.md)

## License

MIT. Use it, fork it, study it, ship it.

## Acknowledgements

Thoth stands on:

- [Voyager](https://voyager.minedojo.org/) (Wang et al., NVIDIA, 2023) — skill libraries indexed by description
- [Reflexion](https://arxiv.org/abs/2303.11366) (Shinn et al., 2023) — verbal self-feedback for LLM agents
- [A-MEM](https://arxiv.org/abs/2502.12110) (NeurIPS 2025) — Zettelkasten auto-linking memory
- [Honcho](https://github.com/plastic-labs/honcho) — theory-of-mind identity layer
- [Anthropic Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) + [agentskills.io](https://agentskills.io/) — open skill standard
- [MCP](https://modelcontextprotocol.io/) — Model Context Protocol
- [Astro Starlight](https://starlight.astro.build/) — docs site
- [Plausible Analytics](https://plausible.io/) — cookie-free analytics

## Community

- **GitHub Discussions** for design questions and feature proposals
- **Discord** at [discord.gg/thoth-runtime](https://discord.gg/thoth-runtime) for real-time
- **Issues** for bugs and concrete feature requests
- **Twitter/X** at [@thothruntime](https://twitter.com/thothruntime)

## Roadmap

The honest, public, dated roadmap is [in the specs directory](docs/specs/).
Every spec follows a canonical 12-section template (Context, Goal, Non-goals,
Acceptance criteria, Approach, Files, Data/migrations, Tests, Rollout, Risks,
Success metrics, Open questions). No feature ships without a spec.

---

🜂 🜃 🜁 🜄 🜍

**Built with care, in Frankfurt. Mythology over marketing.**

— ArchiTech AI UG (haftungsbeschränkt)
