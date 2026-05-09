# Thoth marketing site

Single-file static landing page for `thoth-runtime.dev`.

## What's here

- `index.html` — the entire marketing site, single file, no build step
- `public/` — static assets (logo, OG image, favicon — populated when designer delivers)

## Why static HTML, not a framework?

The marketing site is the first thing a launch visitor sees. It must
load in <1s on cold-start, render correctly without JavaScript, and be
trivially deployable to any static host (Cloudflare Pages, Vercel,
Netlify, GitHub Pages, even a CDN bucket).

Single-file HTML wins on:
- **Time to first byte:** ~10ms from edge cache
- **Total weight:** ~25 KB gzipped (HTML+inline CSS, no images yet)
- **Zero build step:** `git push` deploys directly
- **No framework drift:** no Next.js / Astro / React version to update
- **Works without JS:** every link works, every section renders

For the docs site (which needs search, navigation, versioning) we use
Astro Starlight. The marketing site is intentionally simpler.

## Deploy

### Cloudflare Pages (recommended)

```bash
# In Cloudflare dashboard → Pages → Connect to Git
# Build command: (none)
# Build output directory: marketing
# Custom domain: thoth-runtime.dev
```

Auto-deploys on every push to `main`.

### Manually

Any static host. Just upload `marketing/` contents to web root.

## Edits

To change copy, edit `index.html` directly. No template engine, no
component framework. The HTML is hand-written for clarity.

CSS is inline (single `<style>` block in `<head>`) — load-time matters
more than CSS organization for a landing page.

## Brand assets needed (waiting on designer)

- `public/favicon.svg` — vector favicon
- `public/favicon.ico` — fallback
- `public/apple-touch-icon.png` — 180×180
- `public/og-image.png` — 1200×630 social card image
- `public/logo.svg` — full logo (currently text-only "THOTH" placeholder)

When designer delivers (week 3), drop files into `public/` and update
`<img>` tags accordingly. No other code changes needed.
