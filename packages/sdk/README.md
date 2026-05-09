# @thoth-runtime/sdk

> Thoth SDK — types, interfaces, and plugin lifecycle hooks.

If you're building a Thoth plugin (transport adapter, memory adapter,
custom skill, reflection writer, dashboard panel), this is the package
you import types from.

## Install

```bash
pnpm add @thoth-runtime/sdk
```

## Public surface

- `Transport` — interface for chat transports (Slack, Discord, webhook)
- `MemoryAdapter` — interface for episodic / identity / procedural backends
- `ReflectionWriter` — interface for session-end fan-out writers
- `Skill` — type definitions for the agentskills.io-compatible format
- `EventBus` — typed event subscriptions
- `PluginLifecycle` — `onPreSpawn`, `onPostSpawn`, `onReaction`, `onReflection` hooks

## Stability

The SDK follows semver. Breaking changes only at major version boundaries.
Refer to per-version migration guides in `docs/migration/` at launch.

## Documentation

[docs.thoth-runtime.dev/sdk](https://docs.thoth-runtime.dev/sdk)

## License

MIT
