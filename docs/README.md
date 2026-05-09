# Thoth documentation site

Astro + Starlight. Hosted at [docs.thoth-runtime.dev](https://docs.thoth-runtime.dev).

## Structure

```
docs/
├── astro.config.mjs            (Starlight config + nav)
├── src/
│   └── content/
│       └── docs/
│           ├── index.mdx       (landing page)
│           ├── quickstart/
│           ├── concepts/
│           │   ├── memory.mdx
│           │   ├── persona-stack.mdx
│           │   ├── reflection.mdx
│           │   ├── skills.mdx
│           │   └── reactions.mdx
│           ├── transports/
│           │   ├── slack.mdx
│           │   ├── discord.mdx
│           │   └── webhook.mdx
│           ├── packages/
│           │   ├── core.mdx
│           │   ├── sdk.mdx
│           │   ├── dashboard.mdx
│           │   └── cli.mdx
│           ├── specs/
│           │   └── README.md   (links to all SPEC-*.md)
│           ├── adr/
│           │   └── 0000-template.md
│           └── changelog.mdx
└── public/
    └── (logos, OG images, screenshots)
```

## Run locally

```bash
pnpm dev
```

Opens at `http://localhost:4321`.

## Build

```bash
pnpm build
```

Output: `dist/`. Deployed to Cloudflare Pages on every push to `main`.

## Content philosophy

- **Quickstart loads in <2 minutes.** Anything that takes longer goes
  in concepts.
- **Every concept has a diagram.** Mermaid or Excalidraw, committed.
- **Every code snippet runs.** No pseudo-code unless explicitly marked.
- **Mythic vocabulary preserved.** Sefirot, neteru, Akashic — these are
  not metaphors, they are the spec language.

## Status

Pre-launch. Most pages are stubs until launch (2026-07-22).
