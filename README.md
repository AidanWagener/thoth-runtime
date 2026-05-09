<div align="center">

<img src="docs/public/logo.svg" alt="Thoth" width="280" />

# Thoth

### The lifelong-learning agent runtime.

*Five composed memory layers. Reflexion at session-end. Voyager-style skill compilation.<br/>Multi-agent debate. Mythic dashboard. MIT-licensed. Built in Frankfurt.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-116%20passing-success)](packages/core/src)
[![Memory layers](https://img.shields.io/badge/memory_layers-5-d4af37)](#five-layer-memory)
[![Status](https://img.shields.io/badge/status-pre--launch-orange)](#status)

**[ Quickstart ](https://docs.thoth-runtime.dev/quickstart) · [ Documentation ](https://docs.thoth-runtime.dev) · [ Discord ](https://discord.gg/thoth-runtime) · [ Roadmap ](docs/specs)**

</div>

---

> *Thoth — Egyptian god of writing, wisdom, and the moon.<br/>Patron of scribes. Recorder of words.<br/>Weighed each soul against a feather and wrote the verdict.*

Thoth is an **open-source agent runtime** for the long game. While other agent
frameworks treat memory as RAG and reflection as an afterthought, Thoth composes
five distinct memory layers, runs Reflexion at every session-end, and crystallizes
durable wisdom into a versioned skill library — all behind a Slack-native chat
surface and a dashboard built on the Sefirot Tree of Life.

You run it on your own subscription, your own hardware, your own terms.

```bash
npx @thoth-runtime/cli init my-thoth && cd my-thoth && pnpm install && pnpm dev
```

---

## ✦ Why Thoth exists

Off-the-shelf agent infrastructure in 2026 is one of three flavors:

|   | What it is | What's missing |
|---|---|---|
| **Agent libraries** (LangChain, CrewAI, AutoGen, smolagents) | Building blocks you assemble per project | Stateless by default. No reflection. No persistent memory layers. |
| **Memory products** (Letta, Mem0, zep, Honcho) | Drop-in memory you bolt on | Memory only. No agency, no skills, no reflection loop. |
| **Closed hosted agents** (Devin, Cursor agents, Replit Agents) | Polished products | Locked inside one vendor's walls. Not composable. Not yours. |

None ship a **composed runtime** — memory + reflection + skills + multi-agent
debate + provenance + chat-native UX as one organism, with strong opinions
about how the parts compose.

That's the gap Thoth fills.

## ✦ Five-layer memory

```
┌──────────────────────────────────────────────────────────────────┐
│  L5  REFLECTION  · Reflexion at session-end → 4 fan-out writers  │
│       memory · skill draft · persona observation · Honcho        │
├──────────────────────────────────────────────────────────────────┤
│  L4  PROCEDURAL  · skills, persona files, hard rules             │
│       Voyager-style skill compilation, founder-gated             │
├──────────────────────────────────────────────────────────────────┤
│  L3  EPISODIC    · cosine recall over local embeddings           │
│       Xenova MiniLM 384-dim · recency-weighted · $0/encode       │
├──────────────────────────────────────────────────────────────────┤
│  L2  IDENTITY    · theory-of-mind on each peer (Honcho)          │
│       Workspace · Peer · Session · Message                       │
├──────────────────────────────────────────────────────────────────┤
│  L1  WORKING     · current session state                         │
│       Auto Memory at ~/.claude/projects/.../MEMORY.md            │
└──────────────────────────────────────────────────────────────────┘
```

**Each layer has its own writer, its own cadence, its own kind of truth.**
None can collapse into the others without losing what makes a mind a mind.

→ Read the cornerstone post: [**Why memory is five layers, not one**](https://docs.thoth-runtime.dev/concepts/memory/)

## ✦ What you get

<table>
<tr>
<td width="50%" valign="top">

### 🜍 Reflection at session-end
Reflexion-style critique with four fan-out writers (auto-memory, skill drafts, persona observations, Honcho updates). Founder-gated; nothing auto-applies.

### 🜔 Voyager-style skills
Patterns that recur become candidate skills. Approve with a single ✅. Skill genealogy + RL refinement land in v0.6.

### 🜂 Reactions as training signals
✅❌🧠🗑️👤 on the bot's replies feed reflection, skill drafts, identity model updates. The chat surface IS the labelling surface.

### 🜄 Multi-agent council
Convene a debate of personas. v0.5 homogeneous; v0.6 mixes models — Mary on GPT-5, John on Claude Opus, Winston on Gemini.

</td>
<td width="50%" valign="top">

### 🜃 Ambient agents
Daily budget envelope. Scheduled self-spawn so the agent returns to follow up at a future time. *Visible* autonomy via real-time burndown.

### 🜍 Memory provenance
Every Apex action emits a structured decision-record. Replay player ships in v0.6. EU AI Act compliant from launch.

### 🜐 Mythic dashboard
Tree of Life · Akashic Records · Council · Firmament · 3D Cosmos. Every internal state inspectable. Built on the Sefirot.

### 🜚 Slack-native
Threaded sessions, magic commands, ephemeral debug, reactions as labels. Discord ships Q3. Webhook + Teams later.

</td>
</tr>
</table>

## ✦ Quickstart

**Three minutes to a Slack bot replying:**

```bash
# 1. Scaffold
npx @thoth-runtime/cli init my-thoth
cd my-thoth && pnpm install

# 2. Configure
cp .env.example .env
# → fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, ALLOWED_USERS
# → ensure `claude /status` shows your Max subscription

# 3. Run
pnpm dev
```

DM the bot. Reply in the same Slack thread. The first turn loads your persona
stack; replies in the same thread continue the same Claude session via
`claude --resume`.

→ Full walkthrough: [**docs.thoth-runtime.dev/quickstart**](https://docs.thoth-runtime.dev/quickstart/)

## ✦ Architecture

```
                    your laptop OR a single VPS
   ┌────────────────────────────────────────────────────────────┐
   │                                                            │
   │   ┌──────────────────────────────────────────┐             │
   │   │  thoth (Node)                            │             │
   │   │   • Socket Mode WebSocket                │             │
   │   │   • Honcho dialectic (pre-spawn)         │             │
   │   │   • Episodic recall (cosine)             │             │
   │   │   • stream-json event parser             │             │
   │   │   • Reflexion at session-end             │             │
   │   │   • Reaction handler · Idle detector     │             │
   │   └────┬─────────────────────────┬───────────┘             │
   │        │ stdout (stream-json)    │ spawn (env scrubbed)    │
   │        ▼                         ▼                         │
   │   ┌──────────────────────────────────────────┐             │
   │   │  claude CLI  (your local install)        │ ◄── ~/.claude/.credentials.json
   │   └─────────────────┬────────────────────────┘     (Max OAuth)
   │                     │ HTTPS (subscription, NOT API)        │
   └─────────────────────┼─────────────────────────────────────┘
                         ▼
                    api.anthropic.com

      ▲ outbound WS only             ▲ outbound HTTPS only
      │ wss://wss-primary.slack.com  │ api.honcho.dev
   ┌──┴────────┐                  ┌──┴────────┐
   │   Slack   │                  │  Honcho   │
   └───────────┘                  └───────────┘
```

The runtime **never calls the Anthropic API directly.** It spawns the local
`claude` CLI binary you'd run in your terminal. Subscription billing wins
because env vars that would route through the API are scrubbed at the spawn
boundary. See [ADR-0002](docs/src/content/docs/adr/0002-subprocess-delegation.md)
for the full rationale.

## ✦ vs. agent libraries — honest comparison

|   | LangChain / CrewAI | Letta / Mem0 | Devin / Replit | **Thoth** |
|---|---|---|---|---|
| **Stateful by default** | ✗ | partial | ✓ | ✓ |
| **5-layer composed memory** | ✗ | partial (memory only) | opaque | ✓ |
| **Reflection at session-end** | ✗ | ✗ | opaque | ✓ |
| **Voyager-style skill compilation** | ✗ | ✗ | ✗ | ✓ |
| **Reaction-as-training-signal** | ✗ | ✗ | ✗ | ✓ |
| **Multi-agent debate** | ✓ | ✗ | ✗ | ✓ |
| **Inspectable dashboard** | LangSmith (paid) | dashboard | ✓ | ✓ (open) |
| **Open source** | ✓ | ✓ | ✗ | ✓ (MIT) |
| **Multi-model** | ✓ | ✓ | ✗ | v0.6 |
| **Subscription-friendly billing** | ✗ (API rates) | ✗ | N/A | ✓ (subprocess) |
| **Slack-native** | bolt-on | ✗ | ✗ | ✓ |

## ✦ Architecture decision: monolithic v0.5

For shipping speed, **v0.5 ships as a monolith.** All runtime code lives in
[`@thoth-runtime/core`](packages/core) — memory, reflection, skills, party,
ambient, Slack adapter, dashboard. The packages `@thoth-runtime/transport-slack`,
`@thoth-runtime/transport-discord`, and `@thoth-runtime/dashboard` are
**placeholders** in v0.5 and split out as peer packages in v0.6 when Discord
transport lands per [SPEC-discord-transport](docs/specs/).

This is honest about the current architecture and avoids ~30 hours of
import-surgery during launch crunch. The `Transport` interface in
[`@thoth-runtime/sdk`](packages/sdk) is published from day one so external
transport authors can target the v0.6 shape ahead of time.

## ✦ Roadmap

The next 12 months are publicly specced in [`docs/specs/`](docs/specs/).
Each spec is a 12-section commitment with acceptance criteria, risks, and
success metrics.

<details>
<summary><b>Q3 2026 — Cloud + first differentiators</b></summary>

| Spec | What |
|---|---|
| [SPEC-cloud](docs/specs/) | Hosted multi-tenant runtime, EU-residency |
| [SPEC-skill-format-compat](docs/specs/) | agentskills.io standard adoption |
| [SPEC-discord-transport](docs/specs/) | First-class Discord transport |
| [SPEC-a-mem-auto-linking](docs/specs/) | A-MEM Zettelkasten auto-linking |
| [SPEC-slack-blockkit-2026](docs/specs/) | New Slack components |

</details>

<details>
<summary><b>Q4 2026 — Standards + provenance</b></summary>

| Spec | What |
|---|---|
| [SPEC-marketplace](docs/specs/) | Skill marketplace + Stripe Connect |
| [SPEC-mcp-integration](docs/specs/) | MCP server + client + MCP-Box |
| [SPEC-bitemporal-memory](docs/specs/) | Time-scrubber on memory |
| [SPEC-decision-records](docs/specs/) | Replay player + audit traces |

</details>

<details>
<summary><b>Q1–Q2 2027 — Multi-LLM + frontier features</b></summary>

| Spec | What |
|---|---|
| [SPEC-multi-llm-party](docs/specs/) | Heterogeneous-model debate (GPT/Claude/Gemini) |
| [SPEC-skill-genealogy](docs/specs/) | Skill evolution tree visualization |
| [SPEC-drains](docs/specs/) | Pipe traces to your observability |
| [SPEC-yaml-dashboard-sync](docs/specs/) | Two-way config sync |
| [SPEC-sleep-cycles](docs/specs/) | NREM consolidation + REM dreams (publishable) |

</details>

## ✦ Examples

| Example | What |
|---|---|
| [`examples/minimal/`](examples/minimal/) | Smallest config that boots — ~20 lines, two-file persona |
| [`examples/operator-agent/`](examples/operator-agent/) | Full operator-grade persona pack — 7 persona files + 15 hard rules. **Read this to learn how to build a serious agent.** |
| [`examples/multi-llm-party/`](examples/multi-llm-party/) | (stub for v0.6) |

## ✦ Status

**v0.5.0 — pre-launch.** Public release: 2026-07-22.

```
Source TS files       :  56
Tests                 :  116 passing (8 suites)
Docs pages            :  17 built
Specs                 :  15 published
Architecture decisions:  3 ADRs
```

→ Star to follow: [github.com/thoth-runtime/thoth](https://github.com/thoth-runtime/thoth)

## ✦ License

[MIT](LICENSE). Use it. Fork it. Ship it.

## ✦ Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md). DCO sign-off
required on every commit (`git commit -s`).

## ✦ A note on this repo

This is the **public open-source runtime.** The author maintains a separate
private operator workspace running a private fork of Thoth as part of a
different production system. The two are deliberately unlinked. See
[SEPARATION.md](SEPARATION.md) for the full rule.

---

<div align="center">

**Built with care, in Frankfurt. Mythology over marketing.**

🜂 🜃 🜁 🜄 🜍

</div>
