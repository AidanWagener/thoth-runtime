# operator-agent example

> A complete persona stack demonstrating production-grade Thoth usage.
> Setting: a fictional company called **Helios Tools** (open-source devtools SaaS) with a fictional founder **Maya Kepler**.

## What this example is

This is a **rich, opinionated persona pack** — what a mature Thoth agent looks like
after months of operational tuning. It demonstrates:

- **The full 7-file persona stack** (IDENTITY, SOUL, RULES, AGENTS, USER, MEMORY, TOOLS)
- **The aether sub-stack** with 15 incident-driven hard rules
- **A specific founder communication style** encoded in USER.md
- **A real subagent roster** showing how to delegate
- **Tool discipline** — what's available externally and how to use it

You can:
- **Read it** as a teaching example for designing your own persona
- **Copy + adapt** the structure for your own agent
- **Run it as-is** to play with a fictional but realistic operator agent

## What this example is NOT

A persona for *your* business. The fictional Helios Tools setup will not match
your actual company. To use Thoth in production, fork this directory and replace:

- Helios Tools → your company
- Maya Kepler → you (founder)
- The 15 hard rules → your incident-driven rules
- The tools list → your actual external services
- The communication-style notes → how you actually communicate

## Files in this example

```
operator-agent/
├── README.md                ← (you are here)
├── thoth.config.ts          ← runtime configuration
├── .env.example             ← env vars to fill in
└── persona/
    ├── IDENTITY.md          ← one-liner: "Thoth — Virtual Chief Architect of Helios Tools"
    ├── SOUL.md              ← voice, mission, 10 axioms
    ├── RULES.md             ← operational rules
    ├── AGENTS.md            ← subagent roster
    ├── USER.md              ← Maya's profile + communication style
    ├── MEMORY.md            ← long-term memory (mostly empty — reflection populates)
    ├── TOOLS.md             ← external services available
    └── aether/
        └── RULES.md         ← 15 hard rules with incident references
```

## Try it

```bash
cd examples/operator-agent
cp .env.example .env
# Fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, ALLOWED_USERS
pnpm dev
```

Then DM the bot in Slack as if you're Maya at Helios Tools.

## What you'll learn from running it

- **Voice consistency** — every reply matches the SOUL.md voice rules
- **Hard-rule refusals** — try asking the bot to deploy without going through the staging process; it refuses with a clear citation to the relevant aether/RULES.md rule
- **Subagent delegation** — ask "find all files matching X"; the bot delegates to the Explore subagent rather than reading files itself
- **Memory accumulation** — over multiple sessions, MEMORY.md grows with reflection-derived notes (you'll see the file change in your editor)

## When to graduate from this example

Once you understand how the pieces fit together (~3–5 sessions of playing with it),
fork the directory under your own company name and start replacing files one at a time.
Don't try to rewrite everything at once — incremental replacement is the path of least
disruption.

The order I recommend rewriting:

1. **IDENTITY.md** + **USER.md** first (you, your company)
2. **SOUL.md** mission paragraph (what does your agent exist to do)
3. **TOOLS.md** (your actual external services)
4. **RULES.md** (your operational rules)
5. **AGENTS.md** (your subagent roster, if different)
6. **aether/RULES.md** (replace fictional incidents with your real ones, over time)
7. **SOUL.md** axioms (the most carefully tuned section — leave for last)

## The mythic register

You'll notice this persona uses Egyptian + Kabbalistic vocabulary throughout:
"Sefirot", "neteru", "Akashic", "Council", "Tree of Life". This is intentional
and not decorative — see [The Sefirot as system architecture](https://docs.thoth-runtime.dev/blog/sefirot-architecture)
for the rationale.

If the mythic vocabulary doesn't fit your company's culture, you can rewrite
without it. The system works either way; the mythology is opt-in (but
recommended — names that survive 4,000 years tend to age better than tech jargon).

## License

MIT. Use it, fork it, learn from it.
