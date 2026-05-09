# @thoth-runtime/dashboard

> The mythic dashboard — make every layer of memory legible.

## Tabs

- **Live** — real-time event console with fractal-time scrubber
- **Sessions** — past Slack threads with full transcripts
- **Tree of Life** — 10 Sefirot / Egyptian neteru as agent anatomy
- **Council** — multi-agent debates (BMAD party orchestrator)
- **Akashic Records** — searchable memory archive
- **Firmament** — living-cosmos visualization
- **Cosmos** — 3D star map of every entity (skills, episodes, sessions, parties)

## Run standalone

The dashboard is bundled with `@thoth-runtime/core` by default; runs at
`http://localhost:8787` when the runtime starts.

To run the dashboard server detached from a runtime (read-only mode):

```bash
pnpm --filter @thoth-runtime/dashboard start --db ./bridge.db
```

## Custom theming

Point at your own brand assets via `thoth.config.ts`:

```ts
dashboard: {
  brand: {
    name: 'My Bot',
    logo: './assets/logo.svg',
    palette: { primary: '#1E3A8A', accent: '#D4AF37' }
  }
}
```

## Documentation

[docs.thoth-runtime.dev/dashboard](https://docs.thoth-runtime.dev/dashboard)

## License

MIT
