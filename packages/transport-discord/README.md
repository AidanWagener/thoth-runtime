# @thoth-runtime/transport-discord

> Discord transport for Thoth — **stub package**, full implementation in v0.6.

## Status

This package is a placeholder. The Discord transport ships in v0.6
per [SPEC-discord-transport](../../docs/specs/SPEC-discord-transport.md).

Target: 2026-10-31. Track progress at
[github.com/thoth-runtime/thoth/issues](https://github.com/thoth-runtime/thoth/issues)
under the `transport-discord` label.

## Planned features (parity with Slack)

- Discord Gateway WebSocket connection (no public ingress)
- DM and channel-mention dispatching
- Reactions: ✅❌🧠🗑️👤
- Magic slash commands: `/help`, `/whoami`, `/recall`, `/done`, `/loop-stop`
- Streaming replies via message edits
- Per-thread session continuity
- Slack/Discord cross-transport identity (Y2; via Honcho)

## License

MIT
