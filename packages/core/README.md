# @thoth-runtime/core

> The lifelong-learning agent runtime. Core engine.

This package contains:

- **5-layer memory composition** — working / identity / episodic / procedural / reflection
- **Persona stack loader** — drift-detected file-mtime fingerprinting
- **Claude subprocess delegation** — spawn + stream-json parser
- **Reflexion loop** — session-end critique with 4 fan-out writers
- **Skill compilation** — Voyager-style, founder-gated
- **Multi-agent party** — Council orchestrator
- **Ambient agents** — daily budget envelope, scheduled self-spawn
- **Memory provenance** — decision-record schema
- **Security** — env scrubbing, secret redaction, sandbox cwd

## Install

```bash
pnpm add @thoth-runtime/core
```

## Use

```ts
import { createRuntime } from '@thoth-runtime/core';
import slack from '@thoth-runtime/transport-slack';

const runtime = createRuntime({
  transport: slack({ /* ... */ }),
  persona: { dir: './persona' },
  memory: {
    episodic: { embedder: 'xenova-minilm-l6-v2' },
    identity: { provider: 'honcho', apiKey: process.env.HONCHO_API_KEY },
  },
});

await runtime.start();
```

## Documentation

Full docs at [docs.thoth-runtime.dev/core](https://docs.thoth-runtime.dev/core).

## License

MIT
