# USER.md — Founder Profile

## Maya Kepler — co-founder, CEO of Helios Tools

- **Role:** Product + dev. Final say on Helios direction.
- **Timezone:** UTC-5 (US East). Roughly working 09:00–22:00 local with breaks.
- **Background:** ex-systems engineer, came up through Linux + open-source. Strong distrust of closed-source dev tools.

## Communication style

- Reads fast. Skips preambles. Replies in short sentences ("yes", "ok", "no, do this instead").
- Uses `lol` to indicate surprise rather than humor. Don't interpret as humor.
- Prefers terse answers when stressed; expansive when exploring.
- Switches to mythological language when discussing system design — intentional, not performative. Match the register.
- Doesn't sugarcoat. Expects the same.

## Decision-making

- **Bias toward action.** Faster decisions even when reversible.
- **Verify before commit.** No production change without explicit go-ahead, even from her.
- **Trust earned via consistency.** A bot that gets it right 9 times in a row earns more autonomy on the 10th.
- **Bug reports from her are gospel.** When she says something is broken, it's broken — investigate, don't argue.

## What she values

- Clarity over completeness. A short partial answer with explicit gaps beats a long answer that pretends to be complete.
- Speed of correct answers. Not speed of any answers.
- Aesthetic discipline. The bot's outputs should look as crafted as her own writing.
- Honesty about limits. "I don't know" is the right answer when you don't know.

## What annoys her

- Filler ("Sure!", "Great question", "I'd be happy to help")
- Excessive hedging ("This might possibly potentially be the case…")
- Restating her question back to her ("So you're asking about…")
- Overlong replies when a sentence would do
- Emojis in body text (reactions are fine; emojis IN replies are not)
- Tool calls that fail silently with no recovery path proposed

## Operating rhythms

- **Morning (09:00):** opens Slack, expects `/morning` digest if she asked for one
- **Afternoon (14:00–18:00):** focus block, prefers async DMs over interrupts
- **Evening (20:00–22:00):** strategic / planning work, expansive answers welcome
- **Weekends:** mostly off; ambient agents should NOT DM her unless P0

## Honcho integration

This file is the *initial* model of Maya. Honcho's identity layer evolves it
across sessions — derived facts (explicit + deductive) are stored separately
and surfaced via the Dialectic call before each spawn.

When you notice something *new* about Maya that should inform future
interactions, mention it in your reflection's `user_model_updates` so Honcho
ingests it as an Apex-authored observation.

Never auto-update this file. Persona observations get DM'd to Maya for review
via 🧠 reaction; only she edits this file directly.
