/**
 * Embedded single-file dashboard UI. Vanilla HTML/CSS/JS — no build
 * step, no React, no external CDN. Loads /api/status on a 3s tick,
 * subscribes to /api/events as an SSE stream for live updates.
 *
 * The HTML is returned as a single string from renderDashboardHtml().
 */

export interface UiContext {
  bridgeVersion: string;
}

export function renderDashboardHtml(ctx: UiContext): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Thoth · The Watch</title>
<link rel="icon" type="image/png" href="/assets/logo-icon.png">
<style>
  :root {
    --bg-0: #07090c;
    --bg-1: #0c1117;
    --bg-2: #131a23;
    --bg-3: #1a2330;
    --line: #1f2a3a;
    --line-soft: #182232;
    --text: #e7edf5;
    --text-dim: #8a99ad;
    --text-mute: #5c6b80;
    --accent: #5fc9ff;
    --accent-2: #b288ff;
    --good: #5dd39e;
    --warn: #ffb86c;
    --bad: #ff6b8b;
    --skill: #ffd166;
    --pulse: 0 0 0 0 rgba(95, 201, 255, 0.6);
    --mono: 'JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --sans: ui-sans-serif,system-ui,-apple-system,'Segoe UI',Inter,sans-serif;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: radial-gradient(ellipse at top, #0e1620 0%, var(--bg-0) 60%);
    color: var(--text);
    font-family: var(--sans);
    font-size: 14px;
    min-height: 100vh;
  }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--bg-3); }

  /* Anthropic status banner — top-of-page, severity-tinted. Not sticky:
     it sits above the header in document flow and scrolls with the page,
     so it never fights header.bar for the top:0 slot. */
  .anthropic-banner {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--line);
    background: rgba(220, 80, 80, 0.10);
    color: #ffd9d9;
    font-family: var(--mono);
    font-size: 13px;
    position: relative;
    z-index: 5;
  }
  /* The class selector beats the UA [hidden]{display:none} rule, so we
     restate it here. !important so future class additions can't regress. */
  .anthropic-banner[hidden] { display: none !important; }
  .anthropic-banner[data-severity="critical"] {
    background: linear-gradient(90deg, rgba(220,40,40,0.30) 0%, rgba(220,40,40,0.18) 100%);
    border-bottom-color: rgba(220, 40, 40, 0.6);
    color: #ffe1e1;
  }
  .anthropic-banner[data-severity="major"] {
    background: rgba(255, 120, 60, 0.16);
    border-bottom-color: rgba(255, 120, 60, 0.5);
    color: #ffd6c4;
  }
  .anthropic-banner[data-severity="minor"] {
    background: rgba(255, 200, 80, 0.13);
    border-bottom-color: rgba(255, 200, 80, 0.45);
    color: #ffe7b8;
  }
  .anthropic-banner[data-severity="maintenance"] {
    background: rgba(80, 140, 220, 0.13);
    border-bottom-color: rgba(80, 140, 220, 0.5);
    color: #cfe1ff;
  }
  .anthropic-banner[data-severity="resolved"] {
    background: rgba(60, 180, 110, 0.14);
    border-bottom-color: rgba(60, 180, 110, 0.5);
    color: #c8f0d6;
  }
  .anthropic-banner .ab-icon {
    font-size: 18px;
    line-height: 1;
    flex: 0 0 auto;
  }
  .anthropic-banner .ab-body { flex: 1 1 auto; min-width: 0; }
  .anthropic-banner .ab-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-weight: 600;
    line-height: 1.2;
  }
  .anthropic-banner .ab-stale {
    color: var(--text-mute);
    font-weight: 400;
    font-size: 11px;
    font-style: italic;
  }
  .anthropic-banner .ab-update {
    margin-top: 2px;
    color: rgba(255,255,255,0.78);
    font-size: 12px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .anthropic-banner .ab-link {
    flex: 0 0 auto;
    color: inherit;
    text-decoration: underline;
    font-size: 12px;
    opacity: 0.85;
  }
  .anthropic-banner .ab-link:hover { opacity: 1; }
  .anthropic-banner .ab-dismiss {
    flex: 0 0 auto;
    background: transparent;
    border: 1px solid currentColor;
    color: inherit;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0.7;
    font-size: 12px;
    line-height: 1;
    padding: 0;
  }
  .anthropic-banner .ab-dismiss:hover { opacity: 1; }

  header.bar {
    position: sticky;
    top: 0;
    z-index: 10;
    backdrop-filter: blur(12px);
    background: linear-gradient(180deg, rgba(7,9,12,.92), rgba(7,9,12,.6));
    border-bottom: 1px solid var(--line);
    padding: 14px 24px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .logo-mark {
    height: 40px;
    width: auto;
    display: block;
    image-rendering: -webkit-optimize-contrast;
    flex: 0 0 auto;
    margin: -4px 0;  /* lets the icon breathe past header padding */
    /* subtle aura that picks up the cyan accents in the logo without
       changing the asset itself */
    filter: drop-shadow(0 0 6px rgba(64, 220, 220, 0.18));
  }
  .logo {
    font-family: var(--mono);
    font-weight: 700;
    font-size: 18px;
    letter-spacing: 0.18em;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .tag {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
    padding: 3px 8px;
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .uptime {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text-dim);
  }
  .pulse {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--good);
    box-shadow: var(--pulse);
    animation: pulse 1.6s ease-out infinite;
    display: inline-block;
    vertical-align: middle;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(93, 211, 158, .6); }
    100% { box-shadow: 0 0 0 12px rgba(93, 211, 158, 0); }
  }

  main {
    padding: 22px 24px 80px 24px;
    max-width: 1480px;
    margin: 0 auto;
  }

  .grid-top {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 18px;
    margin-bottom: 18px;
  }
  .grid-mid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 18px;
    margin-bottom: 18px;
  }
  .grid-bottom {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    margin-bottom: 18px;
  }

  .card {
    background: linear-gradient(180deg, var(--bg-1) 0%, var(--bg-2) 100%);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 18px 14px 18px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 30px rgba(0,0,0,0.25);
    overflow: hidden;
  }
  .card h2 {
    margin: 0 0 12px 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-mute);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card h2 .count {
    font-family: var(--mono);
    color: var(--text-dim);
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }
  .layer-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line-soft);
    font-size: 13px;
  }
  .layer-row:last-child { border-bottom: 0; }
  .layer-row .dot {
    width: 8px; height: 8px; border-radius: 50%;
    flex-shrink: 0;
  }
  .layer-row .dot.on  { background: var(--good); box-shadow: 0 0 8px var(--good); }
  .layer-row .dot.off { background: var(--bad); }
  .layer-row .lbl {
    color: var(--text-dim);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .layer-row .lvl {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
    width: 28px;
    flex-shrink: 0;
  }
  .layer-row .extra {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent);
    flex-shrink: 0;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 8px 0;
    font-size: 13px;
  }
  .stat-row .key { color: var(--text-dim); }
  .stat-row .val { font-family: var(--mono); color: var(--text); }

  .progress {
    width: 100%;
    height: 6px;
    background: var(--bg-3);
    border-radius: 3px;
    overflow: hidden;
    margin-top: 6px;
  }
  .progress > div {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    transition: width 250ms ease;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  th {
    text-align: left;
    color: var(--text-mute);
    font-weight: 500;
    padding: 8px 6px;
    border-bottom: 1px solid var(--line);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  td {
    padding: 9px 6px;
    border-bottom: 1px solid var(--line-soft);
    color: var(--text-dim);
    vertical-align: top;
  }
  tr:hover td { background: rgba(95,201,255,0.03); color: var(--text); }
  td.mono, th.mono { font-family: var(--mono); }
  td.peer { color: var(--accent); }
  td.cost { color: var(--good); }
  td.bad  { color: var(--bad); }
  td.warn { color: var(--warn); }
  td.dim  { color: var(--text-mute); }
  td.t-good { color: var(--good); }
  td.t-bad  { color: var(--bad); }

  .empty {
    padding: 32px 16px;
    text-align: center;
    color: var(--text-mute);
    font-size: 13px;
  }

  .events {
    max-height: 540px;
    overflow-y: auto;
    font-family: var(--mono);
    font-size: 12px;
    border-radius: 8px;
    background: var(--bg-0);
    border: 1px solid var(--line);
  }
  .events .row {
    display: grid;
    grid-template-columns: 80px 130px 1fr;
    gap: 12px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--line-soft);
    align-items: baseline;
  }
  .events .row:nth-child(even) { background: rgba(255,255,255,0.012); }
  .events .row .t { color: var(--text-mute); }
  .events .row .k {
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .events .row .k.spawn   { color: var(--accent-2); }
  .events .row .k.honcho  { color: #b288ff; }
  .events .row .k.episode { color: var(--good); }
  .events .row .k.refl    { color: var(--skill); }
  .events .row .k.skill   { color: var(--skill); }
  .events .row .k.sched   { color: var(--warn); }
  .events .row .k.react   { color: #ff8db4; }
  .events .row .k.msg     { color: var(--accent); }
  .events .row .v {
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .events .row.fade-in { animation: fadein .35s ease; }
  @keyframes fadein {
    from { background: rgba(95,201,255,0.18); }
    to   { background: transparent; }
  }

  .pill {
    font-family: var(--mono);
    font-size: 10.5px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--text-dim);
    border: 1px solid var(--line);
  }
  .pill.on  { color: var(--good); border-color: rgba(93,211,158,0.4); }
  .pill.off { color: var(--bad);  border-color: rgba(255,107,139,0.4); }

  .footer-note {
    margin-top: 24px;
    text-align: center;
    color: var(--text-mute);
    font-size: 11px;
    font-family: var(--mono);
  }
  .footer-note a { color: var(--accent); text-decoration: none; }
  .footer-note a:hover { text-decoration: underline; }

  /* Tabs */
  .tabs {
    display: flex;
    gap: 4px;
    padding: 0 24px;
    border-bottom: 1px solid var(--line);
    background: rgba(7,9,12,0.6);
    backdrop-filter: blur(12px);
    position: sticky;
    top: 50px;
    z-index: 9;
  }
  .tab {
    padding: 11px 18px 9px 18px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text-mute);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 150ms ease, border-color 150ms ease;
    user-select: none;
    letter-spacing: 0.04em;
  }
  .tab:hover { color: var(--text-dim); }
  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  /* ── The Firmament — Living Cosmos ──────────────────────────── */
  .cosmos-stage {
    position: relative;
    width: 100%;
  }
  .cosmos-canvas {
    width: 100%;
    height: calc(100vh - 280px);
    min-height: 520px;
    background: radial-gradient(ellipse at center, #050810 0%, #000 100%);
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
    cursor: grab;
    position: relative;
  }
  .cosmos-canvas:active { cursor: grabbing; }
  .cosmos-canvas canvas { display: block; }
  .cosmos-canvas.warping {
    animation: cosmosWarp 600ms ease;
  }
  @keyframes cosmosWarp {
    0%   { filter: hue-rotate(0deg) saturate(1) blur(0); }
    40%  { filter: hue-rotate(30deg) saturate(1.6) blur(2px); }
    100% { filter: hue-rotate(0deg) saturate(1) blur(0); }
  }
  .cosmos-canvas.weather-minor::after,
  .cosmos-canvas.weather-major::after,
  .cosmos-canvas.weather-critical::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .cosmos-canvas.weather-minor::after {
    background: radial-gradient(ellipse at top, rgba(255,200,80,0.08) 0%, transparent 50%);
  }
  .cosmos-canvas.weather-major::after {
    background: radial-gradient(ellipse at top, rgba(255,120,60,0.18) 0%, transparent 60%);
  }
  .cosmos-canvas.weather-critical::after {
    background: radial-gradient(ellipse at top, rgba(220,40,40,0.30) 0%, transparent 60%);
    animation: cosmosLightning 4.5s ease-in-out infinite;
  }
  @keyframes cosmosLightning {
    0%, 95%, 100% { opacity: 1; }
    96%, 98% { opacity: 0.4; }
    97% { opacity: 1.5; }
  }
  .cosmos-hud {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 10px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text-mute);
    flex-wrap: wrap;
  }
  .cosmos-stats { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
  .cosmos-stats strong { color: var(--accent-2); }
  .cosmos-legend { display: inline-flex; align-items: center; gap: 6px; }
  .cl-dot { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 6px currentColor; display: inline-block; }
  .cosmos-toolbar {
    display: flex; gap: 6px; align-items: center;
  }
  .cosmos-search-input {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--text-dim);
    padding: 4px 10px;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 11px;
    width: 220px;
    transition: border-color 120ms ease, width 120ms ease;
  }
  .cosmos-search-input:focus {
    border-color: var(--accent-2);
    outline: none;
    width: 280px;
  }
  .cosmos-tool {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--text-mute);
    width: 28px; height: 28px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .cosmos-tool:hover { color: var(--accent-2); border-color: var(--accent-2); }
  .cosmos-tool.on { color: var(--accent); border-color: var(--accent); background: rgba(40,200,200,0.07); }

  .cosmos-tooltip {
    position: absolute;
    background: rgba(7,9,12,0.92);
    border: 1px solid var(--accent);
    color: var(--text-dim);
    padding: 8px 12px;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 12px;
    pointer-events: none;
    backdrop-filter: blur(8px);
    z-index: 50;
    max-width: 320px;
    box-shadow: 0 4px 20px rgba(40, 200, 200, 0.25);
  }
  .cosmos-tooltip strong { color: var(--accent-2); }
  .cosmos-tooltip .tt-line { color: var(--text-mute); font-size: 11px; margin-top: 2px; }
  .cosmos-tooltip .tt-pill {
    display: inline-block;
    padding: 1px 7px;
    margin-right: 4px;
    border-radius: 8px;
    font-size: 10px;
    background: rgba(40,200,200,0.12);
    color: var(--accent-2);
  }

  /* Mini-map (corner) */
  .cosmos-minimap {
    position: absolute;
    right: 12px;
    bottom: 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: rgba(7,9,12,0.7);
    backdrop-filter: blur(6px);
    pointer-events: none;
    z-index: 20;
  }

  /* Bookmarks bar */
  .cosmos-bookmarks {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 220px;
    z-index: 20;
  }
  .cosmos-bookmark {
    background: rgba(7,9,12,0.85);
    border: 1px solid var(--line);
    color: var(--text-dim);
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 10px;
    text-align: left;
    transition: border-color 120ms ease;
    backdrop-filter: blur(6px);
  }
  .cosmos-bookmark:hover { border-color: var(--accent-2); }
  .cosmos-bookmark .cb-x {
    margin-left: 6px; opacity: 0.5; cursor: pointer;
  }
  .cosmos-bookmark .cb-x:hover { opacity: 1; color: #ef4444; }

  /* FPS + perf indicator */
  .cosmos-fps {
    position: absolute;
    bottom: 10px;
    left: 12px;
    font-family: var(--mono);
    font-size: 10px;
    color: rgba(255,255,255,0.25);
    pointer-events: none;
    z-index: 20;
  }
  .cosmos-perf-warn {
    position: absolute;
    bottom: 10px; left: 90px;
    font-family: var(--mono);
    font-size: 10px;
    color: #fbbf24;
    pointer-events: none;
    z-index: 20;
  }

  /* Radial menu */
  .cosmos-radial {
    position: absolute;
    width: 200px; height: 200px;
    margin-left: -100px; margin-top: -100px;
    z-index: 60;
    pointer-events: none;
  }
  .cosmos-radial[hidden] { display: none; }
  .cosmos-radial .cr-item {
    position: absolute;
    background: rgba(7,9,12,0.95);
    border: 1px solid var(--accent-2);
    color: var(--text-dim);
    padding: 6px 12px;
    border-radius: 16px;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11px;
    pointer-events: auto;
    white-space: nowrap;
    backdrop-filter: blur(8px);
    transition: transform 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .cosmos-radial .cr-item:hover {
    transform: scale(1.06);
    color: var(--accent);
    border-color: var(--accent);
  }

  /* Time river */
  .cosmos-time-river {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    padding: 8px 14px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
  }
  .ctr-btn {
    background: var(--bg-1);
    border: 1px solid var(--line);
    color: var(--text-dim);
    width: 30px; height: 26px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .ctr-btn:hover { color: var(--accent-2); border-color: var(--accent-2); }
  .ctr-btn.on { color: var(--accent); border-color: var(--accent); }
  #cosmos-time-scrubber {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    background: linear-gradient(to right, rgba(40,200,200,0.4) 0%, var(--accent) 100%);
    border-radius: 3px;
    outline: none;
  }
  #cosmos-time-scrubber::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px; height: 16px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px rgba(40,200,200,0.6);
    cursor: pointer;
  }
  .ctr-label { color: var(--text-dim); min-width: 80px; text-align: right; }

  /* Help overlay */
  .cosmos-help {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(8px);
    z-index: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cosmos-help[hidden] { display: none; }
  .ch-card {
    background: var(--bg-1);
    border: 1px solid var(--accent);
    border-radius: 12px;
    padding: 28px 32px;
    max-width: 520px;
    position: relative;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 13px;
  }
  .ch-card h2 { color: var(--accent-2); margin-top: 0; }
  .ch-grid {
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 8px 18px;
    margin-top: 14px;
  }
  .ch-grid kbd {
    padding: 1px 6px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 11px;
  }
  .ch-close {
    position: absolute;
    top: 12px; right: 12px;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--text-mute);
    width: 28px; height: 28px;
    border-radius: 4px;
    cursor: pointer;
  }

  .tab-pane { display: none; }
  .tab-pane.active { display: block; animation: fadein 200ms ease; }

  /* EntityCard — recursive primitive used by live console + explorer + party tabs */
  .ec-card {
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px 8px 8px;
    margin: 6px 0;
    font-size: 13px;
    transition: border-color 200ms ease, background 200ms ease;
  }
  .ec-card:hover { border-color: rgba(95,201,255,0.45); }
  .ec-card.ec-d1 { background: var(--bg-3); }
  .ec-card.ec-d2 { background: rgba(95,201,255,0.045); }
  .ec-card.ec-d3,
  .ec-card.ec-d4,
  .ec-card.ec-d5 { background: rgba(178,136,255,0.04); }
  .ec-head {
    display: flex; align-items: center; gap: 8px;
    min-height: 22px;
  }
  .ec-chev {
    background: transparent;
    border: 0;
    color: var(--text-mute);
    cursor: pointer;
    font-size: 9px;
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 4px;
    transition: color 150ms ease, background 150ms ease;
    line-height: 1;
  }
  .ec-chev:hover { color: var(--accent); background: var(--bg-3); }
  .ec-chev[aria-expanded="true"] { color: var(--accent); }
  .ec-chev.ec-leaf { opacity: 0.25; cursor: default; pointer-events: none; }
  .ec-icon { font-size: 14px; line-height: 1; }
  .ec-title {
    color: var(--text);
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .ec-pill {
    font-family: var(--mono);
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--text-mute);
    flex-shrink: 0;
  }
  .ec-pill-good { color: var(--good); border-color: rgba(93,211,158,0.35); }
  .ec-pill-warn { color: var(--warn); border-color: rgba(255,184,108,0.35); }
  .ec-pill-bad  { color: var(--bad);  border-color: rgba(255,107,139,0.35); }
  .ec-pill-dim  { color: var(--text-mute); }
  .ec-meta {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
    margin-left: auto;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 50%;
  }
  .ec-mk { color: var(--text-mute); }
  .ec-mv { color: var(--text-dim); margin-right: 6px; }
  .ec-preview {
    color: var(--text-dim);
    font-size: 12px;
    margin-top: 4px;
    padding-left: 30px;
    white-space: pre-wrap;
    font-family: var(--mono);
    max-height: 110px;
    overflow: hidden;
    line-height: 1.4;
    border-left: 2px solid transparent;
  }
  .ec-card:hover > .ec-preview { border-left-color: rgba(95,201,255,0.2); }
  .ec-acts {
    margin-top: 4px;
    padding-left: 30px;
    font-size: 11px;
    font-family: var(--mono);
  }
  .ec-act {
    color: var(--accent);
    margin-right: 12px;
    text-decoration: none;
  }
  .ec-act:hover { text-decoration: underline; }
  .ec-children {
    margin-top: 8px;
    padding-left: 24px;
    border-left: 2px solid var(--line-soft);
    animation: ec-slide 220ms ease;
  }
  @keyframes ec-slide {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ec-cgroup { margin: 8px 0; }
  .ec-clbl {
    font-size: 10px;
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: 0.10em;
    margin-bottom: 4px;
    font-family: var(--mono);
  }
  .ec-skeleton {
    color: var(--text-mute);
    font-style: italic;
    padding: 6px 12px;
    font-size: 12px;
    font-family: var(--mono);
  }
  .ec-empty {
    color: var(--text-mute);
    font-size: 12px;
    padding: 6px 12px;
    font-style: italic;
  }
  .ec-error {
    color: var(--bad);
    padding: 6px 12px;
    font-size: 12px;
    font-family: var(--mono);
  }
  .ec-cycle {
    color: var(--warn);
    padding: 6px 12px;
    font-size: 12px;
    font-family: var(--mono);
    background: rgba(255,184,108,0.05);
    border-radius: 4px;
    border-left: 2px solid var(--warn);
  }
  .ec-more {
    cursor: pointer;
    color: var(--accent);
    font-size: 11px;
    padding: 6px 12px;
    font-family: var(--mono);
    user-select: none;
    border-radius: 4px;
    margin-top: 4px;
  }
  .ec-more:hover { background: rgba(95,201,255,0.08); text-decoration: underline; }
  /* ─────────────────────────────────────────────────────────────────
     The Council — chamber, liturgy, chronicle, drawer, lore book
     ───────────────────────────────────────────────────────────────── */
  .council-statusbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 12px 18px;
    background: linear-gradient(135deg, rgba(40,200,200,0.06), rgba(178,136,255,0.04));
    border: 1px solid var(--line);
    border-radius: 8px;
    margin-bottom: 14px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text-dim);
  }
  .council-status-stats { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .council-status-stats strong { color: var(--accent-2); }
  .council-sep { color: var(--text-mute); }
  .council-statusbar-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .council-btn {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--text-dim);
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11px;
    transition: border-color 120ms ease, color 120ms ease;
  }
  .council-btn:hover { color: var(--accent-2); border-color: var(--accent-2); }
  .council-btn.on { color: var(--accent); border-color: var(--accent); background: rgba(40,200,200,0.07); }

  .council-section { margin-bottom: 18px; }
  .council-section-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 10px;
  }
  .council-section-head h2 { margin: 0; color: var(--text-dim); font-size: 16px; letter-spacing: 0.04em; }
  .council-hint { color: var(--text-mute); font-style: italic; font-size: 12px; }

  /* The Chamber — agent grid */
  .council-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }
  .agent-card {
    position: relative;
    padding: 14px;
    background: linear-gradient(160deg, var(--bg-2) 0%, var(--bg-1) 100%);
    border: 1px solid var(--line);
    border-radius: 10px;
    cursor: pointer;
    transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
    font-family: var(--mono);
    overflow: hidden;
  }
  .agent-card:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
    box-shadow: 0 6px 20px rgba(40, 200, 200, 0.16);
  }
  .agent-card.in-roster { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(40,200,200,0.18); }
  .agent-card.is-master { background: linear-gradient(160deg, rgba(251,191,36,0.06), rgba(251,191,36,0.02)); border-color: rgba(251,191,36,0.3); }
  .agent-card.is-master.in-roster { box-shadow: 0 0 0 2px rgba(251,191,36,0.22); }
  .agent-card.speaking::before {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: 12px;
    background: conic-gradient(from var(--ag-spin, 0deg), var(--ag-color, var(--accent)) 0deg, transparent 90deg, var(--ag-color, var(--accent)) 360deg);
    z-index: -1;
    animation: spinBorder 2s linear infinite;
  }
  @keyframes spinBorder { to { --ag-spin: 360deg; } }
  .agent-card .ag-sigil {
    width: 80px; height: 80px;
    margin: 0 auto 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: filter 200ms ease;
  }
  .agent-card .ag-sigil svg { width: 100%; height: 100%; }
  .agent-card.summoned .ag-sigil { animation: sigilSpin 6s linear infinite; }
  .agent-card.speaking .ag-sigil { filter: drop-shadow(0 0 12px var(--ag-color, var(--accent))); }
  @keyframes sigilSpin { to { transform: rotate(360deg); } }
  .agent-card .ag-name {
    text-align: center;
    color: var(--text-dim);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.06em;
  }
  .agent-card .ag-title {
    text-align: center;
    color: var(--text-mute);
    font-size: 11px;
    font-style: italic;
    margin-bottom: 10px;
  }
  .agent-card .ag-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    font-size: 10px;
  }
  .agent-card .ag-stat-key { color: var(--text-mute); }
  .agent-card .ag-stat-val { color: var(--text-dim); text-align: right; }
  .agent-card .ag-bar {
    grid-column: 1 / -1;
    height: 4px;
    background: rgba(255,255,255,0.06);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 4px;
  }
  .agent-card .ag-bar-fill {
    height: 100%;
    background: var(--ag-color, var(--accent));
    transition: width 600ms ease;
  }
  .agent-card .ag-toggle {
    position: absolute;
    top: 8px; right: 8px;
    width: 22px; height: 22px;
    background: rgba(0,0,0,0.4);
    border: 1px solid var(--line);
    border-radius: 50%;
    color: var(--text-mute);
    cursor: pointer;
    font-size: 11px;
    line-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .agent-card .ag-toggle:hover { color: var(--accent); border-color: var(--accent); }
  .agent-card.in-roster .ag-toggle { color: var(--accent); border-color: var(--accent); }

  /* The Liturgy form */
  .liturgy-card {
    padding: 18px;
    background: linear-gradient(135deg, rgba(178,136,255,0.05), rgba(40,200,200,0.03));
    border: 1px solid var(--line);
    border-radius: 10px;
    font-family: var(--mono);
    font-size: 12px;
  }
  .liturgy-row {
    display: grid;
    grid-template-columns: 110px 1fr;
    align-items: center;
    gap: 14px;
    margin-bottom: 12px;
  }
  .liturgy-row label { color: var(--text-mute); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
  .liturgy-row input[type="text"] {
    width: 100%;
    background: var(--bg-1);
    border: 1px solid var(--line);
    color: var(--text-dim);
    padding: 8px 12px;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 13px;
  }
  .liturgy-row input[type="text"]:focus { border-color: var(--accent-2); outline: none; }
  .liturgy-pills { display: flex; gap: 6px; flex-wrap: wrap; }
  .liturgy-pills .lp {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--text-mute);
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11px;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .liturgy-pills .lp:hover { color: var(--text-dim); }
  .liturgy-pills .lp.on { color: var(--accent); border-color: var(--accent); background: rgba(40,200,200,0.07); }
  .liturgy-roster {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    min-height: 28px;
  }
  .liturgy-roster .lr-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--bg-2);
    border: 1px solid currentColor;
    border-radius: 14px;
    font-size: 11px;
  }
  .liturgy-roster .lr-chip-x {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    font-size: 11px;
    opacity: 0.6;
  }
  .liturgy-roster .lr-chip-x:hover { opacity: 1; }
  .liturgy-cost-row {
    grid-template-columns: 110px 1fr 1fr;
    color: var(--text-mute);
    font-size: 11px;
  }
  .liturgy-cost strong { color: var(--accent-2); }
  .liturgy-warn { color: #f97316; }
  .liturgy-actions { text-align: center; margin-top: 18px; }
  .liturgy-convene {
    background: linear-gradient(135deg, rgba(40,200,200,0.18), rgba(178,136,255,0.18));
    border: 1px solid var(--accent);
    color: var(--accent);
    padding: 12px 36px;
    border-radius: 8px;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.08em;
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .liturgy-convene:not([disabled]):hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(40, 200, 200, 0.30);
  }
  .liturgy-convene[disabled] { opacity: 0.4; cursor: not-allowed; }
  .liturgy-convene.firing {
    animation: convenePulse 1.2s ease;
  }
  @keyframes convenePulse {
    0%   { transform: scale(1);   box-shadow: 0 0 0 0 rgba(40,200,200,0.6); }
    40%  { transform: scale(1.04); box-shadow: 0 0 30px 8px rgba(40,200,200,0.4); }
    100% { transform: scale(1);   box-shadow: 0 0 0 0 rgba(40,200,200,0); }
  }
  .lc-glyph { color: #fbbf24; margin-right: 6px; }

  /* Affinity matrix */
  .affinity-matrix {
    display: grid;
    grid-template-columns: 100px repeat(7, 1fr);
    gap: 2px;
    font-family: var(--mono);
    font-size: 10px;
  }
  .am-corner { background: transparent; }
  .am-label {
    padding: 6px 4px;
    color: var(--text-mute);
    text-align: center;
  }
  .am-row-label {
    padding: 6px 8px;
    color: var(--text-mute);
    text-align: right;
    background: var(--bg-2);
    border-radius: 4px;
  }
  .am-cell {
    aspect-ratio: 1 / 1;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.7);
    transition: outline 100ms ease;
    background: rgba(40, 70, 90, 0.4);
  }
  .am-cell:hover { outline: 1px solid var(--accent); }
  .am-cell.diag { background: rgba(255,255,255,0.04); cursor: default; }
  .am-cell.diag:hover { outline: none; }

  /* Council seal */
  .council-seal-host {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px;
    background: radial-gradient(ellipse at center, rgba(40,200,200,0.04) 0%, transparent 60%);
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  .council-seal-host svg {
    filter: drop-shadow(0 0 24px rgba(251, 191, 36, 0.18));
    transition: transform 220ms ease;
  }
  .council-seal-host:hover svg { transform: rotate(2deg) scale(1.02); }
  .council-seal-host .seal-caption {
    margin-top: 14px;
    color: var(--text-mute);
    font-family: var(--mono);
    font-size: 11px;
    font-style: italic;
  }

  /* Side drawer */
  .council-drawer {
    position: fixed;
    top: 0; right: 0;
    width: min(520px, 100vw);
    height: 100vh;
    background: var(--bg-1);
    border-left: 1px solid var(--line);
    box-shadow: -10px 0 36px rgba(0,0,0,0.55);
    z-index: 600;
    overflow-y: auto;
    padding: 28px;
    transform: translateX(0);
    transition: transform 240ms ease;
  }
  .council-drawer[hidden] { display: block; transform: translateX(100%); pointer-events: none; }
  .council-drawer .cd-close {
    position: absolute;
    top: 14px; right: 14px;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--text-mute);
    width: 28px; height: 28px;
    border-radius: 4px;
    cursor: pointer;
  }
  .cd-head { display: flex; gap: 16px; align-items: center; margin-bottom: 18px; }
  .cd-sigil { width: 80px; height: 80px; flex: 0 0 auto; }
  .cd-name { color: var(--text-dim); font-size: 22px; font-weight: 600; letter-spacing: 0.04em; }
  .cd-title { color: var(--text-mute); font-size: 13px; font-style: italic; }
  .cd-section { margin-top: 20px; }
  .cd-section-h {
    color: var(--accent-2);
    font-family: var(--mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 8px;
  }
  .cd-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 14px;
    font-family: var(--mono);
    font-size: 12px;
  }
  .cd-stats .key { color: var(--text-mute); }
  .cd-stats .val { color: var(--text-dim); text-align: right; }
  .cd-familiars { display: flex; gap: 6px; flex-wrap: wrap; }
  .cd-familiar {
    padding: 4px 10px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 11px;
  }
  .cd-recent {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: var(--mono);
    font-size: 11px;
  }
  .cd-recent .cdr {
    padding: 6px 10px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    cursor: pointer;
  }
  .cd-recent .cdr:hover { border-color: var(--accent-2); }
  .cd-actions { display: flex; gap: 8px; margin-top: 18px; }
  .cd-action {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--text-dim);
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 12px;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .cd-action:hover { color: var(--accent); border-color: var(--accent); }

  /* Lore book modal */
  .lore-book {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(8px);
    z-index: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    overflow-y: auto;
  }
  .lore-book[hidden] { display: none; }
  .lore-page {
    position: relative;
    max-width: 760px;
    width: 100%;
    background: linear-gradient(180deg, #1c1408 0%, #16110a 100%);
    border: 1px solid #574122;
    border-radius: 12px;
    padding: 40px 48px;
    color: #e6d4a8;
    font-family: 'Iowan Old Style', 'Palatino', Georgia, serif;
    line-height: 1.7;
    box-shadow: 0 24px 64px rgba(0,0,0,0.7), inset 0 0 80px rgba(120,90,40,0.1);
  }
  .lore-page::before {
    content: '';
    position: absolute;
    inset: 14px;
    border: 1px solid rgba(174, 132, 60, 0.3);
    border-radius: 8px;
    pointer-events: none;
  }
  .lore-page h1 { color: #fbbf24; font-family: 'Iowan Old Style', Georgia, serif; }
  .lore-page h2 { color: rgba(212,165,99,1); font-size: 14px; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 18px; }
  .lore-page p, .lore-page li { font-size: 15px; }
  .lore-page code { background: rgba(255,255,255,0.06); color: #e6d4a8; padding: 2px 6px; border-radius: 3px; }
  .lore-close {
    position: absolute;
    top: 14px; right: 14px;
    background: transparent;
    border: 1px solid rgba(212,165,99,0.4);
    color: rgba(212,165,99,0.8);
    width: 28px; height: 28px;
    border-radius: 4px;
    cursor: pointer;
  }

  /* Adjudicator's Verdict — colored agent mentions in synthesis */
  .verdict-mention {
    color: var(--vm-color, var(--accent));
    font-weight: 600;
    cursor: pointer;
    border-bottom: 1px dashed currentColor;
  }
  .verdict-mention:hover { text-shadow: 0 0 8px currentColor; }

  /* sigil base */
  .sigil { display: block; }
  .sigil-spin { animation: sigilSpin 6s linear infinite; }

  /* Heads-up lists (recent turns, active sessions, party tab) — clamp
     height so a busy bridge doesn't push the rest of The Watch off-screen.
     Internal scroll, fade-out at the bottom edge as a hint there's more. */
  .grid-mid .ec-list,
  #party-list.ec-list {
    max-height: 520px;
    overflow-y: auto;
    padding-right: 4px;
    /* subtle bottom-fade so users know to scroll */
    -webkit-mask-image: linear-gradient(to bottom, #000 92%, transparent 100%);
            mask-image: linear-gradient(to bottom, #000 92%, transparent 100%);
  }
  .grid-mid .ec-list::-webkit-scrollbar,
  #party-list.ec-list::-webkit-scrollbar { width: 6px; }
  .grid-mid .ec-list::-webkit-scrollbar-thumb,
  #party-list.ec-list::-webkit-scrollbar-thumb {
    background: var(--line);
    border-radius: 3px;
  }
  .grid-mid .ec-list::-webkit-scrollbar-thumb:hover,
  #party-list.ec-list::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
  .see-all-link {
    display: block;
    margin-top: 8px;
    padding: 6px 10px;
    text-align: center;
    color: var(--text-mute);
    font-family: var(--mono);
    font-size: 11px;
    background: transparent;
    border: 1px dashed var(--line);
    border-radius: 6px;
    cursor: pointer;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .see-all-link:hover { color: var(--accent-2); border-color: var(--accent-2); }

  .ec-list-empty {
    text-align: center;
    color: var(--text-mute);
    font-size: 12px;
    padding: 26px 12px;
    font-style: italic;
  }
  .ec-backlinks-wrap {
    margin-top: 6px;
  }
  /* ── A3: provenance trail UI ─────────────────────────────────── */
  .ec-prov-wrap { margin-top: 10px; padding: 0 12px 10px; }
  .ec-prov-toggle {
    background: transparent;
    border: 1px dashed var(--line);
    color: var(--text-mute);
    cursor: pointer;
    padding: 5px 12px;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 11px;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .ec-prov-toggle:hover { color: var(--accent-2); border-color: var(--accent-2); }
  .ec-prov-toggle[aria-expanded="true"] { color: var(--accent); border-color: var(--accent); border-style: solid; }
  .ec-provenance {
    margin-top: 10px;
    padding: 10px 14px;
    background: rgba(40, 200, 200, 0.04);
    border: 1px solid var(--line);
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 12px;
  }
  .prov-row {
    display: grid;
    grid-template-columns: 22px 1fr 100px 220px;
    align-items: center;
    gap: 10px;
    padding: 5px 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .prov-row:last-of-type { border-bottom: 0; }
  .prov-row .prov-glyph { font-size: 14px; text-align: center; }
  .prov-row .prov-label { color: var(--text-dim); }
  .prov-row .prov-score { color: var(--accent-2); margin-left: 6px; font-size: 10px; }
  .prov-row .prov-bar {
    height: 6px;
    background: rgba(40,70,90,0.4);
    border-radius: 3px;
    overflow: hidden;
  }
  .prov-row .prov-fill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
  }
  .prov-row .prov-chars {
    font-size: 11px;
    color: var(--text-mute);
    text-align: right;
  }
  .prov-row .prov-link { color: var(--accent); text-decoration: none; margin-left: 6px; }
  .prov-row .prov-link:hover { color: var(--accent-2); text-decoration: underline; }
  .prov-row[data-kind="persona-stack"] .prov-glyph { color: #ffd166; }
  .prov-row[data-kind="related-episode"] .prov-glyph { color: var(--accent-2); }
  .prov-row[data-kind="user-model"] .prov-glyph { color: #a855f7; }
  .prov-total {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--line-soft);
    color: var(--text-mute);
    font-size: 11px;
    text-align: right;
  }
  .prov-popover {
    position: fixed;
    inset: 0;
    background: rgba(7,9,12,0.85);
    backdrop-filter: blur(6px);
    z-index: 1000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 80px 24px;
    overflow-y: auto;
  }
  .prov-popover > .ec-card {
    max-width: 800px;
    width: 100%;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  }

  .ec-bl-toggle {
    background: transparent;
    border: 0;
    color: var(--text-mute);
    cursor: pointer;
    font-size: 11px;
    font-family: var(--mono);
    padding: 4px 8px 4px 30px;
    border-radius: 4px;
    transition: color 150ms ease, background 150ms ease;
  }
  .ec-bl-toggle:hover { color: var(--accent-2); background: rgba(178,136,255,0.08); }
  .ec-bl-toggle[aria-expanded="true"] { color: var(--accent-2); }
  .ec-backlinks {
    margin-top: 4px;
    padding-left: 24px;
    border-left: 2px dashed rgba(178,136,255,0.3);
    animation: ec-slide 220ms ease;
  }

  /* Explorer tab */
  .explorer-search-wrap {
    margin-bottom: 16px;
  }
  .explorer-search {
    width: 100%;
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 18px;
    color: var(--text);
    font-size: 15px;
    font-family: var(--sans);
    transition: border-color 200ms ease, background 200ms ease;
    outline: none;
  }
  .explorer-search:focus {
    border-color: var(--accent);
    background: var(--bg-2);
  }
  .explorer-search::placeholder { color: var(--text-mute); }

  .explorer-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 8px;
    margin-left: 4px;
  }
  .explorer-chip {
    font-family: var(--mono);
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--bg-2);
    color: var(--text-mute);
    cursor: pointer;
    user-select: none;
    transition: all 150ms ease;
  }
  .explorer-chip:hover { color: var(--text-dim); border-color: var(--accent); }
  .explorer-chip.on {
    color: var(--bg-0);
    background: var(--accent);
    border-color: var(--accent);
  }
  /* ── B10: heatmap calendar ─────────────────────────────────────── */
  .heatmap-wrap { padding: 4px 0; }
  .heatmap-grid {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(7, 11px);
    grid-auto-columns: 11px;
    gap: 2px;
    overflow-x: auto;
    padding-bottom: 6px;
  }
  .hm-cell {
    width: 11px; height: 11px;
    background: rgba(40, 70, 90, 0.45);
    border-radius: 2px;
    cursor: pointer;
    transition: outline 100ms ease;
  }
  .hm-cell[data-l="0"] { background: rgba(40, 70, 90, 0.45); }
  .hm-cell[data-l="1"] { background: rgba(40, 200, 200, 0.30); }
  .hm-cell[data-l="2"] { background: rgba(40, 200, 200, 0.55); }
  .hm-cell[data-l="3"] { background: rgba(40, 200, 200, 0.75); }
  .hm-cell[data-l="4"] { background: rgba(178, 136, 255, 0.85); }
  .hm-cell:hover { outline: 1px solid var(--accent-2); }
  .hm-cell.active { outline: 2px solid var(--accent); }
  .heatmap-legend {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
  }
  .heatmap-legend .hm-cell { cursor: default; }
  .heatmap-detail {
    margin-left: 14px;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 11px;
  }

  /* ── A14: marketplace listing ──────────────────────────────────── */
  .mk-row {
    display: grid;
    grid-template-columns: 22px 180px 1fr 200px;
    align-items: center;
    gap: 12px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--line-soft);
    font-family: var(--mono);
    font-size: 12px;
  }
  .mk-row:last-of-type { border-bottom: 0; }
  .mk-row .mk-glyph { font-size: 14px; text-align: center; }
  .mk-row .mk-slug { color: var(--accent-2); font-weight: 600; }
  .mk-row .mk-desc { color: var(--text-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mk-row .mk-meta { color: var(--text-mute); font-size: 11px; text-align: right; }
  .mk-total {
    margin-top: 8px;
    padding: 8px 14px;
    color: var(--accent);
    font-family: var(--mono);
    font-size: 11px;
    text-align: right;
  }

  /* ── B6: persona stack visualizer ──────────────────────────────── */
  .persona-stack { display: flex; flex-direction: column; gap: 6px; padding: 4px 0; }
  .ps-layer {
    display: grid;
    grid-template-columns: 110px 1fr 80px;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: linear-gradient(135deg, rgba(40,200,200,0.08), rgba(178,136,255,0.05));
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 12px;
    transition: transform 120ms ease, border-color 120ms ease;
  }
  .ps-layer:hover { transform: translateX(3px); border-left-color: var(--accent-2); }
  .ps-layer[data-name="IDENTITY"]   { border-left-color: #ffd166; }
  .ps-layer[data-name="SOUL"]       { border-left-color: #ef4444; }
  .ps-layer[data-name="RULES"]      { border-left-color: #f97316; }
  .ps-layer[data-name="AGENTS"]     { border-left-color: #3b82f6; }
  .ps-layer[data-name="USER"]       { border-left-color: #10b981; }
  .ps-layer[data-name="MEMORY"]     { border-left-color: #a855f7; }
  .ps-layer[data-name="AETHER RULES"] { border-left-color: #06b6d4; }
  .ps-layer .ps-name { color: var(--text-dim); font-weight: 600; letter-spacing: 0.06em; }
  .ps-layer .ps-preview {
    color: var(--text-mute);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono);
    font-size: 11px;
  }
  .ps-layer .ps-meta {
    color: var(--text-mute);
    font-size: 11px;
    text-align: right;
  }
  .ps-total {
    margin-top: 6px;
    padding: 8px 14px;
    color: var(--accent-2);
    font-family: var(--mono);
    font-size: 11px;
    text-align: right;
  }

  /* ── Phase 7: The Manuscript ───────────────────────────────────
     Toggle .manuscript-theme on body to flip Records into a medieval
     scriptorium look. .manuscript-dark layers a midnight palette on
     top. Persists via localStorage. */

  /* B1 — Manuscript theme */
  body.manuscript-theme #tab-explorer {
    background:
      radial-gradient(ellipse 80% 60% at center top, rgba(212, 165, 99, 0.06) 0%, transparent 60%),
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.6 0 0 0 0 0.5 0 0 0 0 0.3 0 0 0 0.06 0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E"),
      linear-gradient(180deg, #28200f 0%, #1a1308 100%);
    padding: 24px;
    border-radius: 8px;
    color: #e6d4a8;
  }
  body.manuscript-theme #tab-explorer h2,
  body.manuscript-theme #tab-explorer summary,
  body.manuscript-theme .explorer-group-h,
  body.manuscript-theme .av-num,
  body.manuscript-theme .ad-h {
    background: linear-gradient(135deg, #c9a14b 0%, #f4d77f 50%, #b8902f 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    font-family: 'Iowan Old Style', 'Palatino', Georgia, serif;
    letter-spacing: 0.04em;
  }
  body.manuscript-theme #tab-explorer .explorer-browse {
    background: rgba(40, 28, 14, 0.7);
    border: 1px solid rgba(212, 165, 99, 0.35);
  }
  body.manuscript-theme #tab-explorer .ad-card,
  body.manuscript-theme #tab-explorer .akashic-pinned,
  body.manuscript-theme #tab-explorer .at-col,
  body.manuscript-theme #tab-explorer .akashic-saved,
  body.manuscript-theme #tab-explorer .saved-pill {
    background: rgba(40, 28, 14, 0.7);
    border-color: rgba(212, 165, 99, 0.35);
    color: #e6d4a8;
    font-family: 'Iowan Old Style', Georgia, serif;
  }
  body.manuscript-theme #tab-explorer .ad-row,
  body.manuscript-theme #tab-explorer .at-term,
  body.manuscript-theme #tab-explorer .saved-pill {
    color: rgba(230, 212, 168, 0.85);
  }
  body.manuscript-theme #tab-explorer input[type="search"],
  body.manuscript-theme #tab-explorer .af-select {
    background: rgba(26, 19, 8, 0.85);
    border-color: rgba(212, 165, 99, 0.45);
    color: #e6d4a8;
    font-family: 'Iowan Old Style', Georgia, serif;
  }
  body.manuscript-theme #tab-explorer .akashic-tool {
    background: rgba(40, 28, 14, 0.85);
    border-color: rgba(212, 165, 99, 0.45);
    color: rgba(230, 212, 168, 0.85);
    font-family: var(--mono);
  }
  body.manuscript-theme #tab-explorer .akashic-tool:hover {
    color: #fbbf24;
    border-color: #fbbf24;
  }
  /* Drop-cap on first cluster heading inside results */
  body.manuscript-theme .explorer-group:first-of-type .explorer-group-h::first-letter {
    font-size: 3em;
    float: left;
    line-height: 0.85;
    margin-right: 8px;
    color: #fbbf24;
    -webkit-text-fill-color: #fbbf24;
    font-family: 'Iowan Old Style', Georgia, serif;
    text-shadow: 0 2px 4px rgba(0,0,0,0.5);
  }

  /* N6 — Dark variant of the manuscript */
  body.manuscript-theme.manuscript-dark #tab-explorer {
    background:
      radial-gradient(ellipse 80% 60% at center top, rgba(150, 180, 220, 0.05) 0%, transparent 60%),
      linear-gradient(180deg, #0a0e1c 0%, #050810 100%);
    color: #c8d4e8;
  }
  body.manuscript-theme.manuscript-dark #tab-explorer h2,
  body.manuscript-theme.manuscript-dark #tab-explorer summary,
  body.manuscript-theme.manuscript-dark .av-num {
    background: linear-gradient(135deg, #c0c8d6 0%, #e8eaf0 50%, #98a4b8 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  body.manuscript-theme.manuscript-dark .explorer-browse,
  body.manuscript-theme.manuscript-dark .ad-card,
  body.manuscript-theme.manuscript-dark .akashic-pinned,
  body.manuscript-theme.manuscript-dark .at-col {
    background: rgba(15, 22, 38, 0.7);
    border-color: rgba(150, 180, 220, 0.25);
  }

  /* B6 — Genesis card */
  .genesis-card {
    margin-bottom: 14px;
    padding: 24px 28px;
    background: linear-gradient(135deg, #1c1408 0%, #16110a 100%);
    border: 1px solid #574122;
    border-radius: 8px;
    color: #e6d4a8;
    font-family: 'Iowan Old Style', Georgia, serif;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4), inset 0 0 60px rgba(120,90,40,0.15);
    position: relative;
  }
  .genesis-card[hidden] { display: none; }
  .genesis-card .gc-header {
    color: rgba(212, 165, 99, 0.85);
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }
  .genesis-card .gc-title {
    font-size: 28px;
    font-weight: 600;
    color: #fbbf24;
    margin-bottom: 6px;
    letter-spacing: 0.02em;
  }
  .genesis-card .gc-title::first-letter {
    font-size: 1.6em;
    color: #fbbf24;
    text-shadow: 0 0 12px rgba(251, 191, 36, 0.45);
  }
  .genesis-card .gc-meta {
    font-family: var(--mono);
    font-size: 11px;
    color: rgba(230, 212, 168, 0.6);
    margin-bottom: 18px;
  }
  .genesis-card .gc-body { font-size: 15px; line-height: 1.7; }
  .genesis-card .gc-body .gc-prompt { color: #f4d77f; font-style: italic; margin-bottom: 12px; }
  .genesis-card .gc-body .gc-reply { color: #e6d4a8; }
  .genesis-card .gc-counter {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid rgba(212,165,99,0.2);
    font-family: var(--mono);
    font-size: 11px;
    color: rgba(212, 165, 99, 0.7);
    text-align: right;
    font-style: italic;
  }

  /* B2 — Bookshelf */
  .akashic-bookshelf {
    display: flex;
    gap: 6px;
    align-items: flex-end;
    padding: 16px 14px 10px;
    margin-bottom: 14px;
    background: linear-gradient(180deg, transparent 80%, rgba(76, 51, 24, 0.4) 80%, rgba(48, 32, 16, 0.85) 100%);
    border-bottom: 4px solid rgba(48, 32, 16, 0.9);
    border-radius: 4px 4px 0 0;
    overflow-x: auto;
    perspective: 1200px;
  }
  .akashic-bookshelf:empty::before {
    content: '_(no volumes yet — keep using Thoth; volumes auto-bind by month)_';
    color: var(--text-mute);
    font-style: italic;
    font-family: var(--mono);
    font-size: 11px;
    padding: 16px;
  }
  .book-spine {
    flex: 0 0 auto;
    width: 38px;
    height: 200px;
    background: linear-gradient(180deg,
      var(--spine-top, #5a3920) 0%,
      var(--spine-mid, #7a4f30) 50%,
      var(--spine-top, #5a3920) 100%);
    border-radius: 2px 2px 0 0;
    border: 1px solid rgba(0,0,0,0.4);
    box-shadow:
      inset 1px 0 0 rgba(255,255,255,0.06),
      inset -1px 0 0 rgba(0,0,0,0.3),
      2px 4px 6px rgba(0,0,0,0.4);
    position: relative;
    cursor: pointer;
    transition: transform 220ms ease, box-shadow 220ms ease;
    transform-origin: bottom center;
  }
  .book-spine:hover {
    transform: translateY(-12px) scale(1.03);
    box-shadow:
      inset 1px 0 0 rgba(255,255,255,0.1),
      inset -1px 0 0 rgba(0,0,0,0.3),
      4px 8px 16px rgba(0,0,0,0.6);
  }
  /* Gold band on the spine */
  .book-spine::before {
    content: '';
    position: absolute;
    top: 12%;
    left: 0;
    right: 0;
    height: 6px;
    background: linear-gradient(180deg, #c9a14b, #8a6f30);
    box-shadow: 0 1px 0 rgba(0,0,0,0.3);
  }
  .book-spine::after {
    content: '';
    position: absolute;
    bottom: 12%;
    left: 0;
    right: 0;
    height: 6px;
    background: linear-gradient(180deg, #c9a14b, #8a6f30);
    box-shadow: 0 1px 0 rgba(0,0,0,0.3);
  }
  .book-spine .bs-text {
    position: absolute;
    top: 30px;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%) rotate(180deg);
    writing-mode: vertical-rl;
    text-align: center;
    color: #fbbf24;
    font-family: 'Iowan Old Style', Georgia, serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-shadow: 0 1px 1px rgba(0,0,0,0.6);
    overflow: hidden;
    white-space: nowrap;
  }
  .book-spine[data-color="0"] { --spine-top: #5a2828; --spine-mid: #7a3838; }
  .book-spine[data-color="1"] { --spine-top: #2c4a3e; --spine-mid: #3d6452; }
  .book-spine[data-color="2"] { --spine-top: #3a3270; --spine-mid: #4d4288; }
  .book-spine[data-color="3"] { --spine-top: #5a3920; --spine-mid: #7a4f30; }
  .book-spine[data-color="4"] { --spine-top: #4a2e6c; --spine-mid: #6a458c; }

  /* Inside-volume modal */
  .volume-modal {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(8px);
    z-index: 800;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 60px 24px;
    overflow-y: auto;
    perspective: 1600px;
  }
  .volume-modal[hidden] { display: none; }
  .vm-card {
    position: relative;
    max-width: 760px;
    width: 100%;
    background: linear-gradient(180deg, #1c1408 0%, #16110a 100%);
    border: 1px solid #574122;
    border-radius: 6px;
    padding: 36px 44px;
    color: #e6d4a8;
    font-family: 'Iowan Old Style', Georgia, serif;
    box-shadow: 0 24px 64px rgba(0,0,0,0.7), inset 0 0 80px rgba(120,90,40,0.10);
    animation: bookOpen 480ms cubic-bezier(0.2, 0.8, 0.4, 1);
    transform-origin: left center;
  }
  @keyframes bookOpen {
    0% { transform: rotateY(-90deg) scale(0.6); opacity: 0; }
    60% { opacity: 1; }
    100% { transform: rotateY(0deg) scale(1); opacity: 1; }
  }
  .vm-close {
    position: absolute;
    top: 14px; right: 14px;
    background: transparent;
    border: 1px solid rgba(212,165,99,0.4);
    color: rgba(212,165,99,0.8);
    width: 28px; height: 28px;
    border-radius: 4px;
    cursor: pointer;
  }
  .vm-body h1 {
    color: #fbbf24;
    font-size: 32px;
    margin: 0 0 4px;
    letter-spacing: 0.02em;
  }
  .vm-body h1::first-letter {
    font-size: 1.4em;
    color: #fbbf24;
    text-shadow: 0 0 12px rgba(251, 191, 36, 0.45);
  }
  .vm-body .vm-subtitle {
    color: rgba(230, 212, 168, 0.6);
    font-size: 12px;
    font-family: var(--mono);
    margin-bottom: 24px;
    letter-spacing: 0.06em;
  }
  .vm-body .vm-entry {
    padding: 12px 16px;
    margin-bottom: 8px;
    background: rgba(40, 28, 14, 0.5);
    border-left: 3px solid rgba(212,165,99,0.35);
    border-radius: 2px;
    cursor: pointer;
    transition: border-color 120ms ease;
  }
  .vm-body .vm-entry:hover { border-left-color: #fbbf24; }
  .vm-body .vm-entry .vm-date {
    font-family: var(--mono);
    font-size: 10px;
    color: rgba(212, 165, 99, 0.7);
    letter-spacing: 0.06em;
    margin-bottom: 4px;
  }
  .vm-body .vm-entry .vm-text { color: #e6d4a8; font-size: 14px; line-height: 1.5; }

  /* B3 — Stained-glass milestones (real SVG aesthetic) */
  .akashic-milestones .am-stained.glass {
    padding: 0;
    border: 0;
    background: transparent;
    overflow: visible;
  }
  .akashic-milestones .am-stained.glass svg {
    width: 100%;
    height: auto;
    display: block;
    filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4));
  }
  .akashic-milestones .am-stained.glass:hover svg {
    filter: drop-shadow(0 6px 14px rgba(251,191,36,0.5));
  }

  /* ── The Akashic Records — additions ──────────────────────── */
  .akashic-digest {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  .ad-card {
    padding: 10px 14px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    font-family: var(--mono);
    font-size: 11px;
  }
  .ad-card.ad-otd { border-left-color: #fbbf24; }
  .ad-card.ad-forgotten { border-left-color: #a78bfa; }
  .ad-card.ad-formative { border-left-color: #fbbf24; }
  .ad-h {
    color: var(--text-dim);
    font-weight: 600;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
  }
  .ad-body { color: var(--text-mute); }
  .ad-body .ad-row {
    padding: 3px 0;
    cursor: pointer;
    transition: color 120ms ease;
  }
  .ad-body .ad-row:hover { color: var(--accent-2); }

  .akashic-tool {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--text-mute);
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11px;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .akashic-tool:hover { color: var(--accent-2); border-color: var(--accent-2); }
  .akashic-tool.on { color: var(--accent); border-color: var(--accent); background: rgba(40,200,200,0.07); }

  .akashic-filters {
    display: flex;
    gap: 8px;
    margin: 10px 0;
    align-items: center;
    font-family: var(--mono);
    font-size: 11px;
    flex-wrap: wrap;
  }
  .af-label { color: var(--text-mute); padding-right: 4px; }
  .af-select {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--text-dim);
    padding: 5px 10px;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 11px;
    cursor: pointer;
  }

  .akashic-saved {
    display: flex;
    gap: 6px;
    margin: 8px 0;
    align-items: center;
    flex-wrap: wrap;
  }
  .as-label { color: var(--text-mute); font-family: var(--mono); font-size: 11px; padding-right: 6px; }
  .saved-list { display: flex; gap: 6px; flex-wrap: wrap; }
  .saved-list .saved-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .saved-list .saved-pill:hover { border-color: var(--accent-2); color: var(--accent-2); }
  .saved-list .saved-pill .sp-x { opacity: 0.5; cursor: pointer; }
  .saved-list .saved-pill .sp-x:hover { opacity: 1; color: #ef4444; }

  .akashic-pinned {
    margin: 12px 0;
    padding: 10px 14px;
    background: linear-gradient(135deg, rgba(251,191,36,0.06), rgba(178,136,255,0.04));
    border: 1px solid var(--line);
    border-left: 3px solid #fbbf24;
    border-radius: 8px;
  }
  .ap-h { color: var(--text-dim); font-family: var(--mono); font-size: 11px; margin-bottom: 8px; font-weight: 600; }

  /* Topic trends */
  .akashic-trends { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 4px 0; }
  .at-col { padding: 8px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 6px; }
  .at-h { color: var(--accent-2); font-family: var(--mono); font-size: 11px; margin-bottom: 6px; font-weight: 600; }
  .at-list { display: flex; flex-direction: column; gap: 3px; }
  .at-list .at-term {
    display: flex; justify-content: space-between;
    padding: 4px 8px;
    background: var(--bg-1);
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 11px;
    cursor: pointer;
    color: var(--text-dim);
    transition: color 120ms ease;
  }
  .at-list .at-term:hover { color: var(--accent-2); }
  .at-list .at-cnt { color: var(--text-mute); }

  /* Volumes (Phase 3) */
  .akashic-volumes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
    padding: 4px 0;
  }
  .av-card {
    padding: 14px;
    background: linear-gradient(135deg, #1c1408 0%, #16110a 100%);
    border: 1px solid #574122;
    border-radius: 6px;
    color: #e6d4a8;
    font-family: 'Iowan Old Style', Georgia, serif;
    cursor: pointer;
    transition: transform 200ms ease, border-color 200ms ease;
    min-height: 100px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .av-card:hover { transform: translateY(-2px); border-color: #fbbf24; }
  .av-card .av-num { font-size: 10px; color: rgba(212,165,99,0.85); letter-spacing: 0.1em; text-transform: uppercase; }
  .av-card .av-title { font-size: 14px; color: #fbbf24; font-weight: 600; line-height: 1.2; }
  .av-card .av-meta { font-size: 10px; color: rgba(230,212,168,0.6); margin-top: auto; font-family: var(--mono); }

  /* Milestones */
  .akashic-milestones {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
    padding: 4px 0;
  }
  .am-stained {
    padding: 12px;
    background: linear-gradient(135deg, rgba(251,191,36,0.10), rgba(178,136,255,0.06));
    border: 1px solid rgba(251,191,36,0.4);
    border-radius: 4px;
    color: var(--text-dim);
    font-family: 'Iowan Old Style', Georgia, serif;
    cursor: pointer;
    transition: border-color 200ms ease;
  }
  .am-stained:hover { border-color: #fbbf24; }
  .am-stained .ams-glyph { font-size: 18px; color: #fbbf24; }
  .am-stained .ams-label { font-weight: 600; margin-top: 4px; }
  .am-stained .ams-date { font-size: 10px; color: var(--text-mute); font-family: var(--mono); }

  /* Thoth narrates modal */
  .akashic-narrate-modal {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(8px);
    z-index: 800;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 60px 24px;
    overflow-y: auto;
  }
  .akashic-narrate-modal[hidden] { display: none; }
  .anm-card {
    position: relative;
    max-width: 760px;
    width: 100%;
    background: linear-gradient(180deg, #1c1408 0%, #16110a 100%);
    border: 1px solid #574122;
    border-radius: 12px;
    padding: 32px 40px;
    color: #e6d4a8;
    font-family: 'Iowan Old Style', Georgia, serif;
    box-shadow: 0 24px 64px rgba(0,0,0,0.7), inset 0 0 80px rgba(120,90,40,0.10);
  }
  .anm-h {
    color: #fbbf24;
    font-family: var(--mono);
    font-size: 13px;
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 14px;
  }
  .anm-h select { background: var(--bg-2); border: 1px solid var(--line); color: var(--text-dim); padding: 4px 8px; border-radius: 4px; font-family: var(--mono); font-size: 11px; }
  .anm-body { font-size: 15px; line-height: 1.7; }
  .anm-body h2 { color: rgba(212,165,99,1); font-size: 14px; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 18px; }
  .anm-body code { background: rgba(255,255,255,0.06); color: #e6d4a8; padding: 2px 6px; border-radius: 3px; }
  .anm-close {
    position: absolute;
    top: 14px; right: 14px;
    background: transparent;
    border: 1px solid rgba(212,165,99,0.4);
    color: rgba(212,165,99,0.8);
    width: 28px; height: 28px;
    border-radius: 4px;
    cursor: pointer;
  }

  .explorer-browse {
    margin-top: 18px;
    padding: 10px 12px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    font-family: var(--mono);
    font-size: 12px;
  }
  .explorer-browse summary {
    cursor: pointer;
    color: var(--text-dim);
    user-select: none;
    padding: 2px 0;
    transition: color 150ms ease;
  }
  .explorer-browse[open] summary { color: var(--accent-2); }
  .explorer-browse summary:hover { color: var(--accent); }
  .explorer-browse-list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .explorer-results {
    margin-top: 18px;
  }
  .explorer-group {
    margin-bottom: 22px;
  }
  .explorer-group-h {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: 0.10em;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--line-soft);
  }
  .explorer-snippet {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
    margin-top: -4px;
    margin-bottom: 6px;
    padding-left: 30px;
  }
  .explorer-snippet mark {
    background: rgba(95,201,255,0.2);
    color: var(--accent);
    padding: 0 2px;
    border-radius: 2px;
  }
  .explorer-hint {
    color: var(--text-mute);
    font-size: 13px;
    text-align: center;
    padding: 60px 20px;
    line-height: 1.6;
  }
  .explorer-hint kbd {
    background: var(--bg-3);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 1px 6px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
  }

  /* Nested live-flow zoom controls */
  .flow-nav {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 8px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text-mute);
  }
  .flow-back {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--text-dim);
    cursor: pointer;
    padding: 4px 12px;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 11px;
    transition: color 150ms ease, border-color 150ms ease;
  }
  .flow-back:hover { color: var(--accent); border-color: var(--accent); }
  .flow-back[hidden] { display: none; }
  .flow-zoom-title {
    color: var(--accent-2);
    font-weight: 600;
  }
  .flow-zoom-hint {
    color: var(--text-mute);
    font-style: italic;
    font-size: 11px;
  }
  .fl-node { cursor: pointer; }
  .fl-node:hover rect {
    stroke: var(--accent-2);
    filter: drop-shadow(0 0 6px rgba(178,136,255,0.6));
  }
  .fl-subnode rect {
    stroke: rgba(178,136,255,0.45);
  }
  .fl-subnode-detail {
    fill: rgba(178,136,255,0.08);
    stroke: rgba(178,136,255,0.3);
    stroke-dasharray: 4 3;
    rx: 6;
  }
  /* fractal-time slider — segmented buttons (live | 1h | 1d | 1w) */
  .flow-time {
    margin-left: auto;
    display: inline-flex;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
  }
  .flow-time button {
    background: transparent;
    border: 0;
    color: var(--text-mute);
    padding: 4px 11px;
    font-family: var(--mono);
    font-size: 11px;
    cursor: pointer;
    border-right: 1px solid var(--line);
    transition: background 120ms ease, color 120ms ease;
  }
  .flow-time button:last-child { border-right: 0; }
  .flow-time button:hover { color: var(--text-dim); background: var(--bg-3); }
  .flow-time button.on {
    color: var(--accent-2);
    background: rgba(178,136,255,0.13);
  }
  /* heat-mode edges (counts displayed instead of pulses) */
  .fl-edge.heat {
    stroke: rgba(255,180,80,0.85);
    transition: stroke-width 600ms ease, stroke 600ms ease, opacity 600ms ease;
    opacity: 1;
  }
  .fl-heat-label {
    fill: var(--text-dim);
    font-family: var(--mono);
    font-size: 10px;
    pointer-events: none;
    text-shadow: 0 0 4px var(--bg-0);
  }
  .flow-time-summary {
    margin-left: 14px;
    color: var(--text-mute);
    font-family: var(--mono);
    font-size: 11px;
  }
  .flow-time-summary strong { color: var(--text-dim); font-weight: 600; }

  /* Live flow tab — animated SVG */
  .flow-wrap {
    background: var(--bg-0);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 14px;
    overflow: auto;
    margin-bottom: 18px;
  }
  .flow-svg {
    width: 100%;
    height: auto;
    min-height: 720px;
    display: block;
    user-select: none;
  }
  /* nodes */
  .fl-node rect {
    fill: var(--bg-2);
    stroke: var(--line);
    stroke-width: 1.5;
    rx: 7; ry: 7;
    transition: stroke 320ms ease, filter 320ms ease;
  }
  .fl-node text {
    font-family: var(--mono);
    fill: var(--text);
    font-size: 12px;
    pointer-events: none;
  }
  .fl-node text.sub {
    fill: var(--text-mute);
    font-size: 10px;
  }
  .fl-node.kind-ext rect { stroke: rgba(95,201,255,0.35); }
  .fl-node.kind-br  rect { stroke: rgba(178,136,255,0.30); }
  .fl-node.kind-lc  rect { stroke: rgba(255,209,102,0.30); }
  .fl-node.kind-bus rect { stroke: rgba(255,141,180,0.40); }
  /* Sefirot nodes — Tree of Life */
  .fl-node.kind-sf rect {
    stroke: rgba(251, 191, 36, 0.55);
    fill: rgba(20, 30, 45, 0.85);
    filter: drop-shadow(0 0 6px rgba(251, 191, 36, 0.18));
  }
  .fl-node.kind-sf:hover rect {
    stroke: rgba(251, 191, 36, 0.95);
    filter: drop-shadow(0 0 14px rgba(251, 191, 36, 0.45));
  }
  .sefira-hebrew {
    fill: rgba(251, 191, 36, 0.85);
    font-family: 'Noto Sans Egyptian Hieroglyphs', 'Aegyptus', 'Segoe UI Historic', 'Times New Roman', serif;
    font-size: 22px;
    font-weight: 600;
  }
  .sefira-label {
    fill: rgba(255, 255, 255, 0.95);
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .fl-letter { cursor: help; }
  .fl-letter-halo {
    fill: rgba(7, 9, 12, 0.85);
    stroke: rgba(251, 191, 36, 0.35);
    stroke-width: 1;
    transition: stroke 150ms ease;
  }
  .fl-letter:hover .fl-letter-halo {
    stroke: rgba(251, 191, 36, 0.9);
    stroke-width: 1.5;
  }
  .fl-letter-glyph {
    fill: rgba(251, 191, 36, 0.85);
    font-family: 'David', 'Times New Roman', serif;
    font-size: 14px;
    font-weight: 600;
    pointer-events: none;
  }
  .fl-trunk { opacity: 0.85; transition: opacity 200ms ease; cursor: help; }
  .fl-trunk:hover { opacity: 1; }
  /* Phase 3.1 — Sefira inspector drawer */
  .sefira-inspector {
    position: fixed;
    top: 0; right: 0;
    width: min(480px, 100vw);
    height: 100vh;
    background: var(--bg-1);
    border-left: 1px solid var(--line);
    box-shadow: -10px 0 36px rgba(0,0,0,0.55);
    z-index: 600;
    overflow-y: auto;
    padding: 28px;
    transform: translateX(0);
    transition: transform 240ms ease;
  }
  .sefira-inspector[hidden] { display: block; transform: translateX(100%); pointer-events: none; }
  .sefira-inspector .si-close {
    position: absolute;
    top: 14px; right: 14px;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--text-mute);
    width: 28px; height: 28px;
    border-radius: 4px;
    cursor: pointer;
  }
  .si-head { margin-bottom: 18px; }
  .si-hebrew { color: rgba(251, 191, 36, 0.95); font-family: 'Noto Sans Egyptian Hieroglyphs', 'Aegyptus', 'Segoe UI Historic', 'Times New Roman', serif; font-size: 32px; }
  .si-title { color: var(--text-dim); font-size: 22px; font-weight: 600; margin-top: 4px; }
  .si-sub { color: var(--text-mute); font-size: 13px; margin-top: 2px; font-style: italic; }
  .si-section { margin-top: 20px; }
  .si-section-h {
    color: var(--accent-2);
    font-family: var(--mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 8px;
  }
  .si-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 14px;
    font-family: var(--mono);
    font-size: 12px;
  }
  .si-stats .key { color: var(--text-mute); }
  .si-stats .val { color: var(--text-dim); text-align: right; }
  .si-spark {
    margin-top: 8px;
    width: 100%;
    height: 28px;
  }
  .si-recent {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--mono);
    font-size: 11px;
  }
  .si-recent .sir {
    padding: 5px 8px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 4px;
    color: var(--text-dim);
  }
  .flow-filter-row {
    display: flex;
    gap: 6px;
    margin: 10px 0;
    flex-wrap: wrap;
    font-family: var(--mono);
    font-size: 11px;
  }
  .flow-filter-row .ff-label { color: var(--text-mute); padding: 4px 4px 0 0; }
  .ff-pill {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--text-mute);
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11px;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .ff-pill:hover { color: var(--text-dim); }
  .ff-pill.on { color: var(--accent); border-color: var(--accent); background: rgba(40,200,200,0.07); }
  /* Phase 3.2 — phantom (silent) edges */
  .fl-edge.phantom {
    stroke-dasharray: 6 6;
    opacity: 0.45;
    animation: phantomFlicker 4s ease-in-out infinite;
  }
  @keyframes phantomFlicker {
    0%, 100% { opacity: 0.30; }
    50% { opacity: 0.55; }
  }
  /* Phase 3.4 — bottleneck path glow */
  .fl-edge.bottleneck {
    stroke: rgba(239, 68, 68, 0.85);
    stroke-width: 2.5;
    filter: drop-shadow(0 0 6px rgba(239, 68, 68, 0.5));
  }
  /* Phase 4.4 — anomaly corona on a sefira */
  .fl-node.anomaly rect {
    animation: anomalyCorona 2s ease-in-out infinite;
  }
  @keyframes anomalyCorona {
    0%, 100% { stroke: rgba(251, 191, 36, 0.85); filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.5)); }
    50% { stroke: rgba(251, 191, 36, 1); filter: drop-shadow(0 0 24px rgba(251, 191, 36, 0.95)); }
  }

  /* Phase 2.2 — health rings around sefirot */
  .fl-node.health-good rect { stroke: rgba(74, 222, 128, 0.85); filter: drop-shadow(0 0 8px rgba(74, 222, 128, 0.35)); }
  .fl-node.health-warn rect { stroke: rgba(251, 191, 36, 0.85); filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.35)); }
  .fl-node.health-bad  rect { stroke: rgba(239, 68, 68, 0.95);  filter: drop-shadow(0 0 12px rgba(239, 68, 68, 0.55)); animation: pulse-bad 1.6s ease-in-out infinite; }
  .fl-node.health-cold rect { stroke: rgba(120, 120, 130, 0.45); }
  @keyframes pulse-bad {
    0%, 100% { filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.45)); }
    50% { filter: drop-shadow(0 0 18px rgba(239, 68, 68, 0.85)); }
  }
  .fl-mote { pointer-events: none; }
  .fl-ornament { font-family: serif; pointer-events: none; }

  /* Phase 5.2 — theme variants */
  .flow-wrap.theme-bioluminescent .flow-svg {
    background: radial-gradient(ellipse at center, #061418 0%, #02060a 100%);
  }
  .flow-wrap.theme-bioluminescent .fl-node.kind-sf rect {
    stroke: rgba(74, 222, 128, 0.7);
    fill: rgba(8, 24, 30, 0.85);
    filter: drop-shadow(0 0 12px rgba(74, 222, 128, 0.45));
  }
  .flow-wrap.theme-bioluminescent .fl-edge {
    stroke: rgba(74, 222, 128, 0.30);
  }
  .flow-wrap.theme-bioluminescent .fl-letter-glyph,
  .flow-wrap.theme-bioluminescent .sefira-hebrew { fill: rgba(74, 222, 128, 0.85); }
  .flow-wrap.theme-bioluminescent .fl-letter-halo { stroke: rgba(74, 222, 128, 0.4); }

  .flow-wrap.theme-manuscript .flow-svg {
    background: radial-gradient(ellipse at center, #28200f 0%, #1a1308 100%);
  }
  .flow-wrap.theme-manuscript .fl-node.kind-sf rect {
    stroke: rgba(212, 165, 99, 0.85);
    fill: rgba(40, 28, 14, 0.9);
    filter: drop-shadow(0 0 8px rgba(212, 165, 99, 0.35));
  }
  .flow-wrap.theme-manuscript .fl-edge {
    stroke: rgba(212, 165, 99, 0.35);
  }
  .flow-wrap.theme-manuscript .fl-letter-glyph,
  .flow-wrap.theme-manuscript .sefira-hebrew { fill: rgba(251, 191, 36, 0.95); }
  .flow-wrap.theme-manuscript .sefira-label { fill: rgba(230, 212, 168, 0.95); }
  .flow-wrap.theme-manuscript .fl-letter-halo { fill: rgba(26, 19, 8, 0.9); stroke: rgba(212, 165, 99, 0.55); }

  /* Phase 5.6 — what-if armed sefirot */
  .fl-node.whatif-armed rect {
    stroke-dasharray: 6 4;
    cursor: crosshair;
  }
  .flow-tooltip {
    position: absolute;
    z-index: 100;
    background: rgba(7, 9, 12, 0.95);
    border: 1px solid rgba(251, 191, 36, 0.55);
    color: rgba(255, 255, 255, 0.92);
    padding: 8px 12px;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 11px;
    pointer-events: none;
    backdrop-filter: blur(8px);
    max-width: 320px;
    white-space: pre-wrap;
    box-shadow: 0 4px 20px rgba(251, 191, 36, 0.18);
  }
  .flow-tools {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
  .flow-toolbtn {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--text-mute);
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11px;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .flow-toolbtn:hover { color: var(--accent-2); border-color: var(--accent-2); }
  .flow-toolbtn.on { color: var(--accent); border-color: var(--accent); background: rgba(40,200,200,0.07); }

  .fl-node.warm rect {
    stroke: var(--accent);
    filter: drop-shadow(0 0 6px rgba(95,201,255,0.6));
  }
  .fl-node.hot rect {
    stroke: var(--accent);
    filter: drop-shadow(0 0 14px rgba(95,201,255,0.85));
  }
  .fl-node.err rect {
    stroke: var(--bad);
    filter: drop-shadow(0 0 14px rgba(255,107,139,0.85));
  }

  /* edges */
  .fl-edge {
    fill: none;
    stroke: var(--line);
    stroke-width: 1.4;
    transition: stroke 800ms ease, opacity 800ms ease;
    opacity: 0.5;
  }
  .fl-edge.warm { stroke: var(--accent); opacity: 0.9; }
  .fl-edge-arrow { fill: var(--line); transition: fill 800ms ease; }
  .fl-edge.warm + .fl-edge-arrow,
  .fl-edge.warm ~ .fl-edge-arrow { fill: var(--accent); }

  /* moving pulse dot */
  .fl-pulse {
    filter: drop-shadow(0 0 4px currentColor);
  }

  /* legend */
  .flow-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
    margin-top: 10px;
    padding: 10px 14px;
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  .flow-legend .lk {
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--text-dim);
  }
  .flow-legend .swatch {
    width: 14px; height: 4px; border-radius: 2px; display: inline-block;
  }

  .flow-counter {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    font-family: var(--mono);
    font-size: 12px;
    margin-top: 12px;
  }
  .flow-counter .stat {
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 12px;
  }
  .flow-counter .stat .n {
    color: var(--accent);
    font-weight: 600;
  }
  .flow-counter .stat .l {
    color: var(--text-mute);
    margin-left: 6px;
  }

  .flow-hint {
    color: var(--text-mute);
    font-size: 12px;
    margin: 0 0 10px 4px;
    line-height: 1.5;
  }

  /* Architecture tab */
  .arch-section {
    margin-bottom: 28px;
  }
  .arch-section h3 {
    margin: 0 0 6px 0;
    font-size: 13px;
    color: var(--text);
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .arch-section p {
    margin: 0 0 14px 0;
    font-size: 13px;
    color: var(--text-dim);
    max-width: 800px;
    line-height: 1.55;
  }
  .arch-section .diagram {
    background: var(--bg-0);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 22px 18px;
    overflow: auto;
  }
  .arch-section .mermaid {
    text-align: center;
    min-height: 80px;
  }
  .arch-section .mermaid svg {
    max-width: 100%;
    height: auto !important;
  }
  .arch-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: 12px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
  }
  .arch-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .arch-legend .swatch {
    width: 10px; height: 10px; border-radius: 2px;
  }

  .dim { color: var(--text-mute); }
  .ok  { color: var(--good); }
  .bad { color: var(--bad); }
</style>
</head>
<body>

<div id="anthropic-status-banner" class="anthropic-banner" hidden>
  <span class="ab-icon" id="ab-icon">⚠️</span>
  <div class="ab-body">
    <div class="ab-title">
      <strong id="ab-title">Anthropic API issue</strong>
      <span class="ab-stale" id="ab-stale" hidden>(stale)</span>
    </div>
    <div class="ab-update" id="ab-update"></div>
  </div>
  <a id="ab-link" class="ab-link" href="https://status.claude.com/" target="_blank" rel="noopener">view status →</a>
  <button id="ab-dismiss" class="ab-dismiss" type="button" title="dismiss for this session">✕</button>
</div>

<header class="bar">
  <img class="logo-mark" src="/assets/logo-icon.png" alt="" aria-hidden="true">
  <span class="logo">THOTH</span>
  <span class="tag" id="version">v${ctx.bridgeVersion}</span>
  <span class="tag"><span class="pulse"></span> &nbsp;live</span>
  <span class="uptime" id="uptime">connecting…</span>
</header>

<nav class="tabs" role="tablist">
  <div class="tab active" data-tab="live" role="tab" tabindex="0">The Watch</div>
  <div class="tab" data-tab="flow" role="tab" tabindex="0">Tree of Life</div>
  <div class="tab" data-tab="party" role="tab" tabindex="0">The Council</div>
  <div class="tab" data-tab="explorer" role="tab" tabindex="0">Akashic Records</div>
  <div class="tab" data-tab="cosmos" role="tab" tabindex="0">The Firmament</div>
  <div class="tab" data-tab="arch" role="tab" tabindex="0">The Monolith</div>
</nav>

<main>

<div class="tab-pane active" id="tab-live">
  <section class="grid-top">
    <div class="card">
      <h2>memory layers</h2>
      <div id="layers"></div>
    </div>

    <div class="card">
      <h2>today</h2>
      <div class="stat-row">
        <span class="key">reflection cost</span>
        <span class="val" id="cost-today">$0.00</span>
      </div>
      <div class="progress"><div id="cost-bar" style="width:0%"></div></div>
      <div class="stat-row" style="margin-top:8px">
        <span class="key">cap</span>
        <span class="val dim" id="cost-cap">$5.00 / day</span>
      </div>
      <div class="stat-row">
        <span class="key">reflections fired</span>
        <span class="val" id="refl-count">0</span>
      </div>
      <div class="stat-row">
        <span class="key">episodes total</span>
        <span class="val" id="episodes-count">0</span>
      </div>
    </div>

    <div class="card">
      <h2>allowlist</h2>
      <div id="allowlist"></div>
    </div>
  </section>

  <section class="grid-mid">
    <div class="card">
      <h2>recent turns <span class="count" id="recent-count"></span></h2>
      <div id="recent-cards" class="ec-list"></div>
      <button class="see-all-link" data-jump-tab="explorer">open in Akashic Records →</button>
    </div>

    <div class="card">
      <h2>active sessions <span class="count" id="sessions-count"></span></h2>
      <div id="sessions-cards" class="ec-list"></div>
      <button class="see-all-link" data-jump-tab="explorer">open in Akashic Records →</button>
    </div>
  </section>

  <section class="grid-bottom">
    <div class="card">
      <h2>skill drafts <span class="count" id="drafts-count"></span></h2>
      <div id="drafts"></div>
    </div>
    <div class="card">
      <h2>scheduled self-spawns <span class="count" id="scheduled-count"></span></h2>
      <div id="scheduled"></div>
    </div>
  </section>

  <section>
    <div class="card">
      <h2>live event stream</h2>
      <div class="events" id="events"></div>
    </div>
  </section>

  <div class="footer-note">
    thoth · Slack ↔ Claude Code · Thoth persona ·
    <a href="https://github.com/AidanWagener/Thoth" target="_blank" rel="noopener">github</a>
  </div>
</div><!-- /#tab-live -->

<div class="tab-pane" id="tab-flow">
  <p class="flow-hint">
    The Tree of Life — anatomy of Thoth's living mind, mapped onto the Egyptian neteru.
    Ten gods connected by twenty-two hieroglyphic paths. Real events traverse the paths as
    they fire; hover a god or path for its lore. Click any node to drill in.
  </p>
  <div class="flow-nav">
    <button id="flow-back" class="flow-back" hidden>← back to overview</button>
    <span id="flow-title" class="flow-zoom-title"></span>
    <div class="flow-tools">
      <div class="flow-time" id="flow-time" role="tablist" aria-label="time aggregation">
        <button class="on" data-mode="live" type="button" title="live pulse animation">live</button>
        <button data-mode="1h" type="button" title="last 1 hour — edge heat by event count">1h</button>
        <button data-mode="1d" type="button" title="last 24 hours">1d</button>
        <button data-mode="1w" type="button" title="last 7 days">1w</button>
      </div>
      <button class="flow-toolbtn" id="flow-letters-toggle" type="button" title="toggle hieroglyph labels">𓇳 glyphs</button>
      <button class="flow-toolbtn" id="flow-timelapse" type="button" title="replay last 24h compressed">⏵ replay 24h</button>
      <button class="flow-toolbtn" id="flow-audio" type="button" title="toggle branch tones">♪ tones</button>
      <button class="flow-toolbtn" id="flow-theme" type="button" title="cycle theme: mechanical / bioluminescent / manuscript">◉ theme</button>
      <button class="flow-toolbtn" id="flow-whatif" type="button" title="what-if simulation mode">⚗ what-if</button>
    </div>
    <span class="flow-time-summary" id="flow-time-summary"></span>
  </div>
  <div class="flow-wrap">
    <svg id="flow-canvas" class="flow-svg" viewBox="0 0 1300 800" preserveAspectRatio="xMidYMid meet" aria-label="Thoth Tree of Life — Egyptian neteru anatomy">
      <defs>
        <marker id="fl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="fl-edge-arrow"/>
        </marker>
      </defs>
      <g id="fl-edges"></g>
      <g id="fl-paths-letters"></g>
      <g id="fl-nodes"></g>
      <g id="fl-trunk"></g>
      <g id="fl-pulses"></g>
    </svg>
  </div>
  <div id="flow-tooltip" class="flow-tooltip" hidden></div>

  <!-- Phase 3 — Sefira inspector drawer -->
  <aside id="sefira-inspector" class="sefira-inspector" hidden>
    <button class="si-close" type="button" title="close (esc)">✕</button>
    <div id="si-body"></div>
  </aside>

  <!-- Phase 3.3 — filter by event kind -->
  <div class="flow-filter-row">
    <span class="ff-label">filter:</span>
    <button class="ff-pill on" data-ff="all" type="button">all</button>
    <button class="ff-pill" data-ff="message.received" type="button">messages</button>
    <button class="ff-pill" data-ff="spawn" type="button">spawns</button>
    <button class="ff-pill" data-ff="episode.write" type="button">episodes</button>
    <button class="ff-pill" data-ff="party" type="button">party</button>
    <button class="ff-pill" data-ff="reflection" type="button">reflection</button>
    <button class="ff-pill" data-ff="skill" type="button">skill</button>
    <button class="ff-pill" data-ff="reaction" type="button">reactions</button>
  </div>
  <div class="flow-legend">
    <span class="lk"><span class="swatch" style="background:#5fc9ff"></span> message / spawn</span>
    <span class="lk"><span class="swatch" style="background:#b288ff"></span> honcho · understanding</span>
    <span class="lk"><span class="swatch" style="background:#5dd39e"></span> episode · wisdom</span>
    <span class="lk"><span class="swatch" style="background:#ffd166"></span> reflection · mercy</span>
    <span class="lk"><span class="swatch" style="background:#ffb86c"></span> skill · victory</span>
    <span class="lk"><span class="swatch" style="background:#a78bfa"></span> council · beauty</span>
    <span class="lk"><span class="swatch" style="background:#ff8db4"></span> reaction · feedback</span>
    <span class="lk"><span class="swatch" style="background:#ff6b8b"></span> error</span>
  </div>
  <div class="flow-counter">
    <div class="stat"><span class="n" id="fl-stat-events">0</span><span class="l">events streamed</span></div>
    <div class="stat"><span class="n" id="fl-stat-pulses">0</span><span class="l">pulses fired</span></div>
    <div class="stat"><span class="n" id="fl-stat-warm">0</span><span class="l">nodes warm</span></div>
    <div class="stat"><span class="n" id="fl-stat-last">—</span><span class="l">last event</span></div>
  </div>
</div><!-- /#tab-flow -->

<div class="tab-pane" id="tab-party">
  <!-- ── Status bar ────────────────────────────────────────────── -->
  <div class="council-statusbar">
    <div class="council-status-stats">
      <span><strong id="council-member-count">7</strong> members convened</span>
      <span class="council-sep">·</span>
      <span><strong id="council-active-count">0</strong> in session</span>
      <span class="council-sep">·</span>
      <span>daily <strong id="council-daily-spent">$0.00</strong> / <span id="council-daily-cap">$10.00</span></span>
      <span class="council-sep">·</span>
      <span>total <strong id="council-total-inv">0</strong> invocations</span>
    </div>
    <div class="council-statusbar-actions">
      <button class="council-btn" data-show-section="chamber" type="button">⚜ Chamber</button>
      <button class="council-btn" data-show-section="liturgy" type="button">⚱ Liturgy</button>
      <button class="council-btn" data-show-section="affinity" type="button">⊛ Affinities</button>
      <button class="council-btn" data-show-section="seal" type="button">⚙ Seal</button>
    </div>
  </div>

  <!-- ── Section: The Chamber (agent grid) ──────────────────── -->
  <section id="council-section-chamber" class="council-section">
    <div class="council-section-head">
      <h2>The Chamber</h2>
      <span class="council-hint">click any member to open their dossier</span>
    </div>
    <div id="council-grid" class="council-grid">
      <div class="explorer-hint">_(loading…)_</div>
    </div>
  </section>

  <!-- ── Section: The Liturgy (convene form) ────────────────── -->
  <section id="council-section-liturgy" class="council-section" hidden>
    <div class="council-section-head">
      <h2>The Liturgy</h2>
      <span class="council-hint">summon a sitting from the dashboard</span>
    </div>
    <div class="liturgy-card">
      <div class="liturgy-row">
        <label>Topic</label>
        <input id="liturgy-topic" type="text" placeholder="should we ship X · what's the right architecture for Y · …" />
      </div>
      <div class="liturgy-row liturgy-modes">
        <label>Mode</label>
        <div class="liturgy-pills" id="liturgy-mode">
          <button class="lp on" data-mode="sequential" type="button">sequential</button>
          <button class="lp" data-mode="parallel" type="button">parallel</button>
          <button class="lp" data-mode="adversarial" type="button">adversarial</button>
          <button class="lp" data-mode="quick" type="button">quick</button>
        </div>
      </div>
      <div class="liturgy-row liturgy-modes">
        <label>Form</label>
        <div class="liturgy-pills" id="liturgy-template">
          <button class="lp on" data-template="freeform" type="button">freeform</button>
          <button class="lp" data-template="prd" type="button">PRD</button>
          <button class="lp" data-template="decision" type="button">decision</button>
          <button class="lp" data-template="retro" type="button">retro</button>
          <button class="lp" data-template="spec" type="button">spec</button>
        </div>
      </div>
      <div class="liturgy-row liturgy-modes">
        <label>Rounds</label>
        <div class="liturgy-pills" id="liturgy-rounds">
          <button class="lp" data-rounds="1" type="button">1</button>
          <button class="lp on" data-rounds="2" type="button">2</button>
          <button class="lp" data-rounds="3" type="button">3</button>
        </div>
      </div>
      <div class="liturgy-row liturgy-roster-row">
        <label>Roster</label>
        <div id="liturgy-roster" class="liturgy-roster">
          <span class="explorer-hint">_(toggle members in The Chamber to add/remove)_</span>
        </div>
      </div>
      <div class="liturgy-row liturgy-cost-row">
        <span class="liturgy-cost">est cost: <strong id="liturgy-cost">$—</strong></span>
        <span class="liturgy-cost">est duration: <strong id="liturgy-duration">~—</strong></span>
        <span class="liturgy-warn" id="liturgy-warn"></span>
      </div>
      <div class="liturgy-actions">
        <button id="liturgy-convene" class="liturgy-convene" type="button" disabled>
          <span class="lc-glyph">⚜</span> Convene the Council
        </button>
      </div>
    </div>
  </section>

  <!-- ── Section: Affinities (matrix) ───────────────────────── -->
  <section id="council-section-affinity" class="council-section" hidden>
    <div class="council-section-head">
      <h2>Affinities</h2>
      <span class="council-hint">co-occurrence + confidence correlation between members</span>
    </div>
    <div id="affinity-matrix" class="affinity-matrix">
      <div class="explorer-hint">_(loading…)_</div>
    </div>
  </section>

  <!-- ── Section: The Seal ──────────────────────────────────── -->
  <section id="council-section-seal" class="council-section" hidden>
    <div class="council-section-head">
      <h2>The Seal</h2>
      <span class="council-hint">your council's emblem — composite of every member's sigil</span>
    </div>
    <div id="council-seal-host" class="council-seal-host">
      <div class="explorer-hint">_(loading…)_</div>
    </div>
  </section>

  <!-- ── The Chronicle (always visible at bottom) ──────────── -->
  <section class="council-section">
    <div class="council-section-head">
      <h2>The Chronicle</h2>
      <span class="count" id="party-list-count"></span>
    </div>
    <div id="party-list" class="ec-list"></div>
  </section>

  <!-- ── Side drawer (slides in from the right) ───────────── -->
  <aside id="council-drawer" class="council-drawer" hidden>
    <button class="cd-close" type="button" title="close">✕</button>
    <div id="council-drawer-body"></div>
  </aside>

  <!-- ── Lore book modal ──────────────────────────────────── -->
  <div id="lore-book" class="lore-book" hidden>
    <div class="lore-page">
      <button class="lore-close" type="button" title="close">✕</button>
      <div id="lore-content"></div>
    </div>
  </div>
</div><!-- /#tab-party -->

<div class="tab-pane" id="tab-explorer">
  <!-- ── Daily resurfaces (Phase 2.1) ────────────────────────── -->
  <div class="akashic-digest" id="akashic-digest">
    <div class="ad-card ad-otd">
      <div class="ad-h">📜 On this day</div>
      <div id="otd-body" class="ad-body"><span class="explorer-hint">_(loading…)_</span></div>
    </div>
    <div class="ad-card ad-forgotten">
      <div class="ad-h">🕯️ Forgotten threads</div>
      <div id="forgotten-body" class="ad-body"><span class="explorer-hint">_(loading…)_</span></div>
    </div>
    <div class="ad-card ad-formative">
      <div class="ad-h">★ Formative records</div>
      <div id="formative-body" class="ad-body"><span class="explorer-hint">_(loading…)_</span></div>
    </div>
  </div>

  <div class="explorer-search-wrap">
    <input
      id="explorer-input"
      class="explorer-search"
      type="search"
      placeholder="Search across sessions, episodes, parties, skills…"
      autocomplete="off"
      spellcheck="false"
    >
    <button class="akashic-tool" id="akashic-search-mode" data-mode="text" title="toggle search mode">⌕ text</button>
    <button class="akashic-tool" id="akashic-random" title="random pull (rediscovery)">🎲 surprise me</button>
    <button class="akashic-tool" id="akashic-narrate" title="Thoth narrates a period of your history">📜 narrate</button>
    <button class="akashic-tool" id="akashic-theme" title="toggle illuminated manuscript theme">◉ theme</button>
    <button class="akashic-tool" id="akashic-dark" title="toggle midnight scriptorium" hidden>◐ dark</button>
    <div class="explorer-chips" id="explorer-chips">
      <span class="explorer-chip on" data-type="all">all</span>
      <span class="explorer-chip" data-type="session">sessions</span>
      <span class="explorer-chip" data-type="episode">episodes</span>
      <span class="explorer-chip" data-type="party">parties</span>
      <span class="explorer-chip" data-type="skill">skills</span>
    </div>
  </div>

  <!-- ── Multi-faceted filters (Phase 1.2) ──────────────────── -->
  <div class="akashic-filters" id="akashic-filters">
    <span class="af-label">filter:</span>
    <select class="af-select" id="af-date">
      <option value="all">all time</option>
      <option value="1d">last 24h</option>
      <option value="7d">last 7d</option>
      <option value="30d">last 30d</option>
      <option value="90d">last 90d</option>
      <option value="1y">last year</option>
    </select>
    <select class="af-select" id="af-peer">
      <option value="">any peer</option>
    </select>
    <select class="af-select" id="af-channel">
      <option value="">any channel</option>
    </select>
    <select class="af-select" id="af-verified">
      <option value="">any status</option>
      <option value="success">✓ verified</option>
      <option value="failure">✗ failed</option>
      <option value="outdated">🗑️ outdated</option>
    </select>
    <button class="akashic-tool" id="af-save" title="save current search + filter combo">★ save</button>
    <button class="akashic-tool" id="af-clear" title="clear all filters">✕ clear</button>
  </div>

  <!-- Saved searches + history -->
  <div class="akashic-saved" id="akashic-saved" hidden>
    <span class="as-label">saved:</span>
    <div id="saved-list" class="saved-list"></div>
  </div>

  <!-- Pinned records (Phase 1.5) -->
  <div class="akashic-pinned" id="akashic-pinned" hidden>
    <div class="ap-h">📌 pinned</div>
    <div id="pinned-list" class="explorer-browse-list"></div>
  </div>

  <div class="explorer-results" id="explorer-results">
    <div class="explorer-hint">
      Type a query above. Toggle 🔀 mode for semantic similarity search.<br>
      Filters compose with the query.
    </div>
  </div>

  <details class="explorer-browse" open>
    <summary>📅 Activity heatmap — last 365 days of bridge events</summary>
    <div id="heatmap-wrap" class="heatmap-wrap">
      <div id="heatmap-grid" class="heatmap-grid"></div>
      <div class="heatmap-legend">
        <span>less</span>
        <span class="hm-cell" data-l="0"></span>
        <span class="hm-cell" data-l="1"></span>
        <span class="hm-cell" data-l="2"></span>
        <span class="hm-cell" data-l="3"></span>
        <span class="hm-cell" data-l="4"></span>
        <span>more</span>
        <span id="heatmap-detail" class="heatmap-detail"></span>
      </div>
    </div>
  </details>

  <details class="explorer-browse">
    <summary>🪔 Persona stack — see your prompt</summary>
    <div id="persona-stack" class="persona-stack">
      <div class="explorer-hint">_(loading…)_</div>
    </div>
  </details>

  <details class="explorer-browse">
    <summary>🌍 Skill marketplace — published skills from the registry</summary>
    <div id="explorer-marketplace" class="explorer-browse-list">
      <div class="explorer-hint">_(loading…)_</div>
    </div>
  </details>

  <details class="explorer-browse">
    <summary>📜 Persona stack files — browse all role files</summary>
    <div id="explorer-persona-list" class="explorer-browse-list">
      <div class="explorer-hint">_(loading…)_</div>
    </div>
  </details>

  <details class="explorer-browse">
    <summary>🧠 Auto memory — recent MEMORY.md notes</summary>
    <div id="explorer-memory-list" class="explorer-browse-list">
      <div class="explorer-hint">_(loading…)_</div>
    </div>
  </details>

  <details class="explorer-browse">
    <summary>📈 Topic trends — what's emerging vs decaying</summary>
    <div class="akashic-trends">
      <div class="at-col">
        <div class="at-h">↗ emerging</div>
        <div id="trends-emerging" class="at-list"><span class="explorer-hint">_(loading…)_</span></div>
      </div>
      <div class="at-col">
        <div class="at-h">↘ decaying</div>
        <div id="trends-decaying" class="at-list"><span class="explorer-hint">_(loading…)_</span></div>
      </div>
    </div>
  </details>

  <details class="explorer-browse">
    <summary>🪞 Persona drift — how Thoth's understanding of you has changed</summary>
    <div id="persona-drift" class="explorer-browse-list">
      <span class="explorer-hint">_(loading…)_</span>
    </div>
  </details>

  <details class="explorer-browse" open>
    <summary>📚 Volumes — your bridge's history bound by month</summary>
    <!-- B6 — Origin / Genesis panel -->
    <div id="genesis-card" class="genesis-card" hidden></div>
    <!-- B2 — Bookshelf -->
    <div id="akashic-bookshelf" class="akashic-bookshelf"></div>
    <div id="akashic-volumes" class="akashic-volumes">
      <span class="explorer-hint">_(loading…)_</span>
    </div>
    <!-- Inside-volume modal (3D flip target) -->
    <div id="volume-modal" class="volume-modal" hidden>
      <div class="vm-card">
        <button class="vm-close" type="button" title="close">✕</button>
        <div id="vm-body" class="vm-body"></div>
      </div>
    </div>
  </details>

  <details class="explorer-browse">
    <summary>🏛️ Milestones — formative moments in this archive</summary>
    <div id="akashic-milestones" class="akashic-milestones">
      <span class="explorer-hint">_(loading…)_</span>
    </div>
  </details>

  <!-- ── Thoth narrates: modal with rendered narrative ────────── -->
  <div id="akashic-narrate-modal" class="akashic-narrate-modal" hidden>
    <div class="anm-card">
      <button class="anm-close" type="button" title="close">✕</button>
      <div class="anm-h">Thoth narrates · <select id="anm-period"><option value="7d">last 7 days</option><option value="30d">last 30 days</option><option value="90d">last 90 days</option></select> · <button id="anm-go" class="akashic-tool" type="button">read the records</button></div>
      <div id="anm-body" class="anm-body"><span class="explorer-hint">_(pick a period and click "read the records"; Seshat will write a chronicle in her voice)_</span></div>
    </div>
  </div>
</div><!-- /#tab-explorer -->

<div class="tab-pane" id="tab-cosmos">
  <div class="cosmos-hud">
    <div class="cosmos-stats">
      <span><strong id="cosmos-count">0</strong> stars</span>
      <span class="cosmos-legend"><span class="cl-dot" style="background:#fbbf24"></span> sun</span>
      <span class="cosmos-legend"><span class="cl-dot" style="background:#46d3ff"></span> episodes</span>
      <span class="cosmos-legend"><span class="cl-dot" style="background:#a78bfa"></span> parties</span>
      <span class="cosmos-legend" id="cosmos-cluster-count"></span>
    </div>
    <div class="cosmos-toolbar">
      <input id="cosmos-search" type="search" placeholder="search the firmament…" class="cosmos-search-input">
      <button class="cosmos-tool" data-tool="reset" type="button" title="reset view">⌂</button>
      <button class="cosmos-tool" data-tool="bookmark" type="button" title="bookmark current view (B)">★</button>
      <button class="cosmos-tool" data-tool="tour" type="button" title="auto-tour (T)">⟳</button>
      <button class="cosmos-tool" data-tool="mute" type="button" title="toggle sound (M)">♪</button>
      <button class="cosmos-tool" data-tool="help" type="button" title="help (?)">?</button>
    </div>
  </div>

  <div class="cosmos-stage">
    <div id="cosmos-canvas" class="cosmos-canvas"></div>
    <div id="cosmos-tooltip" class="cosmos-tooltip" hidden></div>
    <div id="cosmos-bookmarks" class="cosmos-bookmarks"></div>
    <canvas id="cosmos-minimap" class="cosmos-minimap" width="160" height="160"></canvas>
    <div id="cosmos-radial" class="cosmos-radial" hidden></div>
    <div id="cosmos-fps" class="cosmos-fps"></div>
    <div id="cosmos-perf-warn" class="cosmos-perf-warn" hidden>perf mode · reduced detail</div>
  </div>

  <div class="cosmos-time-river">
    <button class="ctr-btn" data-tr="play" type="button" title="play timeline">▶</button>
    <button class="ctr-btn" data-tr="speed" type="button" title="cycle playback speed">1×</button>
    <input id="cosmos-time-scrubber" type="range" min="0" max="1000" value="1000" step="1">
    <span id="cosmos-time-label" class="ctr-label">now</span>
  </div>

  <div id="cosmos-help" class="cosmos-help" hidden>
    <div class="ch-card">
      <button class="ch-close" type="button">✕</button>
      <h2>The Firmament — controls</h2>
      <div class="ch-grid">
        <span>drag</span><span>rotate the cosmos</span>
        <span>scroll</span><span>zoom</span>
        <span>click star</span><span>open in side panel</span>
        <span>shift-drag</span><span>lasso select</span>
        <span>right-click</span><span>radial menu</span>
        <span><kbd>/</kbd></span><span>focus search</span>
        <span><kbd>B</kbd></span><span>bookmark current view</span>
        <span><kbd>T</kbd></span><span>auto-tour</span>
        <span><kbd>P</kbd></span><span>pause/resume timeline</span>
        <span><kbd>M</kbd></span><span>toggle sound</span>
        <span><kbd>?</kbd></span><span>this help</span>
        <span><kbd>esc</kbd></span><span>close overlays</span>
      </div>
    </div>
  </div>
</div>

<div class="tab-pane" id="tab-arch">

  <div class="arch-section">
    <h3>System architecture</h3>
    <p>Every component in the live bridge process and how it connects to external services and the local host. Solid edges = always-active wiring; dashed edges = on-demand or event-driven.</p>
    <div class="diagram">
      <div class="mermaid" id="diag-arch">
flowchart TB
    classDef external fill:#1a2330,stroke:#5fc9ff,color:#e7edf5
    classDef bridge fill:#131a23,stroke:#b288ff,color:#e7edf5
    classDef store fill:#0c1117,stroke:#5dd39e,color:#e7edf5
    classDef local fill:#1a2330,stroke:#ffd166,color:#e7edf5
    classDef bus fill:#0c1117,stroke:#ff8db4,color:#e7edf5

    subgraph EXT [external]
        SLACK[Slack workspace<br/>The Close Agency]
        HONCHO[(Honcho cloud<br/>thoth-prod)]
        ANTHROPIC[Anthropic<br/>via Max OAuth]
    end

    subgraph BRIDGE [thoth bridge — Node.js]
        direction TB

        subgraph IO [I/O surface]
            BOLT[Bolt SocketMode]
            HANDLER[Slack handler<br/>magic commands]
            STREAMER[chat.update streamer]
            REACT[reactions handler<br/>✅❌🧠🗑️👤]
            DASH[dashboard HTTP<br/>127.0.0.1:8787]
        end

        subgraph MEM [memory layer]
            HONCHOC[HonchoClient<br/>1.5s timeout]
            EMBED[embeddings ONNX<br/>all-MiniLM-L6-v2 384d]
            EPISODIC[EpisodicStore<br/>cosine + recency decay]
            RECALL[recall orchestrator]
        end

        subgraph REFL [reflection]
            ORCH[orchestrator]
            RUNNER[runner<br/>claude -p --effort low]
            PARSER[zod JSON parser<br/>+ keyword guard]
            DAILY[daily $ cap]
            IDLE[idle detector 60s]
        end

        subgraph SK [skills + scheduling]
            DRAFTS[skill_drafts]
            SKILLMGR[skill manager<br/>git commit]
            SCHED[scheduling poller<br/>60s tick]
            SCHEDST[scheduled_runs]
        end

        BUS[(event bus<br/>500-event ring)]
    end

    subgraph LOCAL [local host]
        CLAUDE[claude CLI<br/>--permission-mode<br/>bypassPermissions]
        PERSONA[persona/apex/<br/>34KB stack]
        DB[(bridge.db SQLite)]
        SKILLS[.claude/skills/<br/>git-tracked]
        AUTOMEM[Auto Memory<br/>~/.claude/projects/Thoth/]
    end

    BROWSER([your browser])

    SLACK ===|wss outbound only| BOLT
    BOLT --> HANDLER
    BOLT --> REACT
    HANDLER --> STREAMER
    STREAMER ==>|chat.update| SLACK

    HANDLER --> RECALL
    RECALL --> HONCHOC
    RECALL --> EPISODIC
    HONCHOC <==>|HTTPS| HONCHO
    EPISODIC --> EMBED
    EPISODIC <--> DB

    HANDLER ==>|spawn -p<br/>env scrubbed| CLAUDE
    CLAUDE ==>|HTTPS Max| ANTHROPIC
    CLAUDE -.->|reads| PERSONA
    CLAUDE -.->|reads/writes| AUTOMEM

    HANDLER -.->|/done| ORCH
    IDLE -.->|polls idle threads| ORCH
    ORCH --> RUNNER
    RUNNER -->|spawn claude -p<br/>--effort low| CLAUDE
    RUNNER --> PARSER
    ORCH --> DAILY
    DAILY <--> DB

    ORCH -->|on should_skill| SKILLMGR
    SKILLMGR --> DRAFTS
    DRAFTS <--> DB
    SKILLMGR -->|git commit| SKILLS

    ORCH -->|on next_check_at| SCHED
    SCHED --> SCHEDST
    SCHEDST <--> DB
    SCHED -.->|synthetic dispatch| HANDLER

    REACT -->|approve/reject| SKILLMGR
    REACT -->|verified flag| EPISODIC
    REACT -->|verbatim| AUTOMEM
    REACT -->|user-feedback| HONCHOC

    HANDLER --> BUS
    HONCHOC --> BUS
    EPISODIC --> BUS
    ORCH --> BUS
    SKILLMGR --> BUS
    REACT --> BUS
    SCHED --> BUS

    BUS ==>|SSE stream| DASH
    DASH ==>|HTTP loopback| BROWSER

    class SLACK,HONCHO,ANTHROPIC external
    class BOLT,HANDLER,STREAMER,REACT,DASH,HONCHOC,EMBED,EPISODIC,RECALL,ORCH,RUNNER,PARSER,DAILY,IDLE,DRAFTS,SKILLMGR,SCHED,SCHEDST bridge
    class CLAUDE,PERSONA,SKILLS,AUTOMEM local
    class DB store
    class BUS bus
      </div>
    </div>
    <div class="arch-legend">
      <span><span class="swatch" style="background:#5fc9ff"></span> external surface</span>
      <span><span class="swatch" style="background:#b288ff"></span> bridge module</span>
      <span><span class="swatch" style="background:#5dd39e"></span> data store</span>
      <span><span class="swatch" style="background:#ffd166"></span> local host</span>
      <span><span class="swatch" style="background:#ff8db4"></span> event bus</span>
    </div>
  </div>

  <div class="arch-section">
    <h3>Memory layer model</h3>
    <p>Five composed layers, each with a distinct writer and read-trigger. Higher layers carry less data but more abstraction; lower layers handle the bulk fast.</p>
    <div class="diagram">
      <div class="mermaid" id="diag-mem">
flowchart LR
    classDef l1 fill:#1a2330,stroke:#5fc9ff,color:#e7edf5
    classDef l2 fill:#131a23,stroke:#b288ff,color:#e7edf5
    classDef l3 fill:#0c1117,stroke:#5dd39e,color:#e7edf5
    classDef l4 fill:#131a23,stroke:#ffd166,color:#e7edf5
    classDef l5 fill:#1a2330,stroke:#ff8db4,color:#e7edf5

    L1["L1 · WORKING<br/>Claude Code session state<br/>Auto Memory MEMORY.md"]
    L2["L2 · IDENTITY<br/>Honcho theory-of-mind<br/>per peer · 1.5s dialectic"]
    L3["L3 · EPISODIC<br/>SQLite + 384d Float32 BLOB<br/>cosine recall · τ=14d decay"]
    L4["L4 · PROCEDURAL<br/>persona stack +<br/>.claude/skills/ Voyager-style"]
    L5["L5 · REFLECTION<br/>Reflexion at session end<br/>fans out 4 writers"]

    L5 --> |memory_notes| L1
    L5 --> |should_skill| L4
    L5 --> |user_model_updates| L2
    L5 --> |verified flags| L3

    L1 -.persists.-> L1S[(per-project<br/>~/.claude/projects/Thoth)]
    L2 -.persists.-> L2S[(api.honcho.dev<br/>thoth-prod)]
    L3 -.persists.-> L3S[(bridge.db<br/>SQLite)]
    L4 -.persists.-> L4S[(git-tracked<br/>repo files)]
    L5 -.runs in.-> L5S[claude -p --effort low<br/>$0.50 cap · $5/day]

    class L1 l1
    class L2 l2
    class L3 l3
    class L4 l4
    class L5 l5
    class L1S,L2S,L3S,L4S l3
    class L5S l5
      </div>
    </div>
  </div>

  <div class="arch-section">
    <h3>Per-turn message flow</h3>
    <p>The full timeline of a single Slack message from arrival to reply, including every memory-layer touch.</p>
    <div class="diagram">
      <div class="mermaid" id="diag-turn">
sequenceDiagram
    autonumber
    participant U as User (Slack)
    participant B as Bolt SocketMode
    participant H as handler.ts
    participant R as recall.ts
    participant HC as Honcho
    participant E as Episodic
    participant C as claude CLI
    participant S as Streamer
    participant DB as bridge.db
    participant BUS as EventBus

    U->>B: message.im / app_mention
    B->>H: dispatch event
    H->>H: allowlist check
    H->>BUS: message.received
    H->>R: build context
    R->>HC: dialectic chat (1.5s timeout)
    HC-->>R: user-model snippet
    R->>E: cosine recall (fresh threads)
    E-->>R: top-3 episodes
    R-->>H: <slack-context> + <user-model> + <related-episodes>
    H->>BUS: spawn.start
    H->>C: spawn -p stream-json (env scrubbed)
    C->>S: chat.postMessage placeholder
    loop streaming
        C->>S: stream-json delta
        S->>U: chat.update (1s throttle)
    end
    C-->>H: result envelope
    H->>BUS: spawn.exit (cost, turns)
    H->>DB: upsert session
    H-)HC: ingest user + apex (fire-and-forget)
    H-)E: write episode + embedding
    H-)BUS: episode.write
      </div>
    </div>
  </div>

  <div class="arch-section">
    <h3>Reflection lifecycle</h3>
    <p>What happens when a thread closes — either via <code>/done</code> or after 30 minutes of silence. The orchestrator runs Reflexion-style critique on a fresh subprocess and fans the structured-JSON output to four writers.</p>
    <div class="diagram">
      <div class="mermaid" id="diag-refl">
sequenceDiagram
    autonumber
    participant T as trigger<br/>(/done OR idle 30m)
    participant ID as IdleDetector
    participant O as Orchestrator
    participant CAP as DailyCostCap
    participant R as Runner
    participant C as claude -p<br/>--effort low
    participant P as Parser (zod)
    participant WM as MemoryWriter
    participant WS as SkillWriter
    participant WP as PersonaWriter
    participant WH as HonchoWriter
    participant SCH as Scheduler
    participant U as Slack
    participant BUS as EventBus

    alt /done
        T->>O: handleDone
    else idle 30m
        ID->>O: tick fires
    end
    O->>CAP: under cap?
    CAP-->>O: yes
    O->>BUS: reflection.start
    O->>R: build prompt + transcript
    R->>C: spawn -p --output-format json<br/>$0.50 cap · no persona
    C-->>R: JSON envelope
    R->>P: parse + validate + keyword-guard
    P-->>R: Reflection object
    R-->>O: reflection
    par fan-out (all soft-fail)
        O->>WM: append memory_notes
        WM->>WM: write MEMORY.md<br/>50-line ceiling
    and
        O->>WS: write SKILL.md draft
        WS->>U: post approval card<br/>(✅❌ pre-attached)
        WS->>BUS: skill.proposed
    and
        O->>WP: DM persona observations<br/>(NEVER auto-apply)
        WP->>U: founder DM
    and
        O->>WH: feed user_model_updates
        WH->>WH: ingest as apex peer
    and
        O->>SCH: schedule next_check_at
        SCH->>BUS: schedule.created
    end
    O->>BUS: reflection.complete
    O->>O: markReflected (idempotent)
      </div>
    </div>
  </div>

  <div class="arch-section">
    <h3>Reactions ↔ writers</h3>
    <p>How each emoji on an Thoth reply routes through the system. The redaction filter on 🧠 is the load-bearing safety pass.</p>
    <div class="diagram">
      <div class="mermaid" id="diag-react">
flowchart LR
    classDef emoji fill:#1a2330,stroke:#ff8db4,color:#e7edf5
    classDef fn fill:#131a23,stroke:#b288ff,color:#e7edf5
    classDef store fill:#0c1117,stroke:#5dd39e,color:#e7edf5
    classDef block fill:#0c1117,stroke:#ff6b8b,color:#e7edf5

    R1[":white_check_mark:<br/>verified=success"]:::emoji
    R2[":x:<br/>verified=failure"]:::emoji
    R3[":brain:<br/>remember verbatim"]:::emoji
    R4[":wastebasket:<br/>outdated"]:::emoji
    R5[":bust_in_silhouette:<br/>user feedback"]:::emoji

    REDACT["redact()<br/>xoxb · ghp_* · sk-*<br/>github_pat_* · AWS"]:::block

    EP1[setVerified]:::fn
    EP2[setVerified]:::fn
    EP3[writeMemoryNotes]:::fn
    EP4[markOutdated]:::fn
    EP5[honcho.ingest]:::fn

    EPDB[(episodes table)]:::store
    MEMFILE[(MEMORY.md)]:::store
    HONCHODB[(Honcho<br/>apex peer)]:::store

    R1 --> EP1 --> EPDB
    R2 --> EP2 --> EPDB
    R3 --> REDACT --> EP3 --> MEMFILE
    R4 --> EP4 --> EPDB
    R5 --> EP5 --> HONCHODB
      </div>
    </div>
  </div>

  <div class="footer-note">
    architecture · all five memory layers · 4 phases shipped ·
    <a href="https://github.com/AidanWagener/Thoth" target="_blank" rel="noopener">github</a>
  </div>

</div><!-- /#tab-arch -->

</main>

<script type="module">
// Mermaid for the architecture tab. Loads from CDN — the dashboard is
// loopback-only and the user's browser has internet, so this is fine.
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
  fontFamily: 'JetBrains Mono, Fira Code, ui-monospace, monospace',
  themeVariables: {
    background: '#0c1117',
    primaryColor: '#1a2330',
    primaryTextColor: '#e7edf5',
    primaryBorderColor: '#5fc9ff',
    lineColor: '#8a99ad',
    secondaryColor: '#131a23',
    tertiaryColor: '#07090c',
    mainBkg: '#1a2330',
    secondBkg: '#131a23',
    tertiaryBkg: '#0c1117',
    nodeBorder: '#5fc9ff',
    clusterBkg: '#0c1117',
    clusterBorder: '#1f2a3a',
    edgeLabelBackground: '#0c1117',
    titleColor: '#e7edf5',
    actorBkg: '#1a2330',
    actorBorder: '#5fc9ff',
    actorTextColor: '#e7edf5',
    actorLineColor: '#8a99ad',
    signalColor: '#b288ff',
    signalTextColor: '#e7edf5',
    labelBoxBkgColor: '#1a2330',
    labelBoxBorderColor: '#5fc9ff',
    labelTextColor: '#e7edf5',
    loopTextColor: '#5fc9ff',
    activationBkgColor: '#131a23',
    activationBorderColor: '#b288ff',
    sequenceNumberColor: '#0c1117',
    noteBkgColor: '#1a2330',
    noteTextColor: '#e7edf5',
    noteBorderColor: '#5fc9ff',
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis',
    padding: 18,
  },
  sequence: {
    actorMargin: 60,
    boxMargin: 12,
    messageMargin: 38,
    mirrorActors: false,
  },
});

// Render diagrams once on first switch to the architecture tab,
// then never again — they're static.
let archRendered = false;
async function renderArch() {
  if (archRendered) return;
  archRendered = true;
  const nodes = document.querySelectorAll('#tab-arch .mermaid');
  for (const node of nodes) {
    const code = node.textContent.trim();
    node.textContent = '';
    try {
      const id = 'm_' + Math.random().toString(36).slice(2);
      const { svg } = await mermaid.render(id, code);
      node.innerHTML = svg;
    } catch (err) {
      node.innerHTML = '<pre style="color:var(--bad); text-align:left">mermaid render failed: ' +
        (err && err.message ? err.message : String(err)) + '</pre>';
      console.error('mermaid render', err);
    }
  }
}
window.__renderArch = renderArch;

// If the page loaded with the architecture tab already active (URL hash
// = #arch, refresh while on arch), the regular tab-switch script ran
// before Mermaid finished loading. Auto-render here once the module
// is ready.
if (document.getElementById('tab-arch')?.classList.contains('active')) {
  renderArch();
}
</script>
<script>
// ─── EntityCard: recursive primitive ────────────────────────────────────
// Renders any entity (session, episode, party, skill) as a card that can
// expand to show children, which are themselves EntityCards. Same shape
// every level. Cycle detection via ancestor stack. Lazy children fetch.
window.__EntityCard = (function () {
  const CHILD_PAGE = 30;

  function escAttr(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function escHtml(s) { return escAttr(s); }

  async function fetchEntity(type, id, sub) {
    const path = '/api/entity/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + (sub ? '/' + sub : '');
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  function refKey(ref) { return ref.type + ':' + ref.id; }

  // ── γ.1: Adjudicator's Verdict — color [Name] mentions in
  // party-message previews using each agent's accent. Triggered for
  // master messages (synthesis) where citations appear, but applied to
  // all party-messages so any cross-agent reference gets visual weight.
  const COUNCIL_NAME_COLORS = {
    Seshat: '#46d3ff', Hermes: '#ffd166', Ptah:   '#60a5fa',
    Khnum:  '#fb923c', Anubis: '#a78bfa', Hathor: '#f472b6',
    Maat:   '#fbbf24',
  };
  function renderEcPreview(ref, meta) {
    const raw = meta.preview || '';
    if (ref.type !== 'party-message') return escHtml(raw);
    // Replace [Name] with a colored span. Also support **Name** when used
    // for headings inside Maat's synthesis.
    let html = escHtml(raw);
    for (const [name, color] of Object.entries(COUNCIL_NAME_COLORS)) {
      const re = new RegExp('\\[' + name + '\\]', 'g');
      html = html.replace(re, '<span class="verdict-mention" style="--vm-color:' + color + ';color:' + color + '">' + name + '</span>');
      const reBold = new RegExp('\\*\\*' + name + '([^*]*)\\*\\*', 'g');
      html = html.replace(reBold, '<span class="verdict-mention" style="--vm-color:' + color + ';color:' + color + '"><strong>' + name + '$1</strong></span>');
    }
    return html;
  }

  // ── A3: provenance trail renderer ────────────────────────────────
  function renderProvenance(host, data) {
    const rows = (data && data.rows) || [];
    if (rows.length === 0) {
      host.innerHTML = '<div class="ec-empty">no provenance recorded for this episode</div>';
      return;
    }
    const KIND_GLYPH = {
      'persona-stack': '🪔',
      'slack-context': '💬',
      'user-model': '🧠',
      'related-episode': '📝',
      'skill': '🛠️',
    };
    const totalChars = rows.reduce((acc, r) => acc + (r.chars || 0), 0);
    const items = rows.map(r => {
      const glyph = KIND_GLYPH[r.kind] || '•';
      const pct = totalChars > 0 ? Math.round((r.chars / totalChars) * 100) : 0;
      const scoreStr = r.score != null ? '<span class="prov-score">cosine ' + r.score.toFixed(2) + '</span>' : '';
      const sourceLink = (r.kind === 'related-episode' && r.sourceId)
        ? ' · <a class="prov-link" href="javascript:void(0)" data-ref-type="episode" data-ref-id="' + escAttr(r.sourceId) + '">open episode</a>'
        : '';
      return '<div class="prov-row" data-kind="' + escAttr(r.kind) + '">' +
        '<span class="prov-glyph">' + glyph + '</span>' +
        '<span class="prov-label">' + escHtml(r.label) + scoreStr + '</span>' +
        '<span class="prov-bar"><span class="prov-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="prov-chars">' + r.chars.toLocaleString() + ' chars · ' + pct + '%' + sourceLink + '</span>' +
      '</div>';
    }).join('');
    host.innerHTML = items + '<div class="prov-total">trail: <strong>' + rows.length + '</strong> sources · <strong>' + totalChars.toLocaleString() + '</strong> chars total</div>';
    // Wire intra-tree drilldowns
    host.querySelectorAll('.prov-link').forEach(a => {
      a.addEventListener('click', (e) => {
        const t = e.target;
        const targetRef = { type: t.dataset.refType, id: t.dataset.refId };
        const overlay = document.createElement('div');
        overlay.className = 'prov-popover';
        overlay.appendChild(window.__EntityCard.render(targetRef, { depth: 0 }));
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
        document.addEventListener('keydown', function esc(ev) {
          if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
        });
      });
    });
  }

  function render(ref, opts) {
    opts = opts || {};
    const depth = opts.depth || 0;
    const ancestors = opts.ancestors || new Set();

    const root = document.createElement('div');
    root.className = 'ec-card ec-d' + Math.min(depth, 5);
    root.dataset.ecType = ref.type;
    root.dataset.ecId = ref.id;

    const key = refKey(ref);
    if (ancestors.has(key)) {
      root.innerHTML = '<div class="ec-cycle">↺ cycle: ancestor of <code>' + escHtml(ref.type + '/' + ref.id) + '</code> already on stack</div>';
      return root;
    }

    root.innerHTML = '<div class="ec-skeleton">loading ' + escHtml(ref.type) + '/' + escHtml(ref.id.slice(0, 12)) + '…</div>';
    fetchEntity(ref.type, ref.id).then(meta => {
      if (!meta) {
        root.innerHTML = '<div class="ec-error">' + escHtml(ref.type) + '/' + escHtml(ref.id) + ' not found</div>';
        return;
      }
      hydrate(root, meta, ref, depth, ancestors);
    });
    return root;
  }

  function hydrate(root, meta, ref, depth, ancestors) {
    const pillHtml = meta.statusPill
      ? '<span class="ec-pill ec-pill-' + escAttr(meta.statusPill.tone || 'dim') + '">' + escHtml(meta.statusPill.text) + '</span>'
      : '';
    const metaStripHtml = (meta.metaStrip || []).map(m =>
      '<span class="ec-mk">' + escHtml(m.key) + '</span> <span class="ec-mv">' + escHtml(m.value) + '</span>'
    ).join(' · ');
    const actionsHtml = (meta.actions || []).map(a =>
      a.href
        ? '<a class="ec-act" href="' + escAttr(a.href) + '" target="_blank" rel="noopener">' + escHtml(a.label) + ' ↗</a>'
        : '<span class="ec-act">' + escHtml(a.label) + '</span>'
    ).join('');

    root.innerHTML =
      '<div class="ec-head">' +
        '<button class="ec-chev" aria-expanded="false" title="expand">▶</button>' +
        '<span class="ec-icon">' + escHtml(meta.icon || '') + '</span>' +
        '<span class="ec-title">' + escHtml(meta.title || '') + '</span>' +
        pillHtml +
        '<span class="ec-meta">' + metaStripHtml + '</span>' +
      '</div>' +
      (meta.preview ? '<div class="ec-preview">' + renderEcPreview(ref, meta) + '</div>' : '') +
      (actionsHtml ? '<div class="ec-acts">' + actionsHtml + '</div>' : '') +
      '<div class="ec-children" style="display:none"></div>' +
      (ref.type === 'episode'
        ? '<div class="ec-prov-wrap"><button class="ec-prov-toggle" aria-expanded="false">🪜 why does Thoth think this?</button><div class="ec-provenance" style="display:none"></div></div>'
        : '') +
      '<div class="ec-backlinks-wrap"><button class="ec-bl-toggle" aria-expanded="false">↺ what links here</button><div class="ec-backlinks" style="display:none"></div></div>';

    const chev = root.querySelector('.ec-chev');
    const childrenEl = root.querySelector('.ec-children');
    const blToggle = root.querySelector('.ec-bl-toggle');
    const blEl = root.querySelector('.ec-backlinks');
    let loaded = false;
    let blLoaded = false;

    // Provenance trail (episodes only)
    const provToggle = root.querySelector('.ec-prov-toggle');
    const provEl = root.querySelector('.ec-provenance');
    let provLoaded = false;
    if (provToggle && provEl) {
      provToggle.addEventListener('click', async () => {
        const expanded = provToggle.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          provToggle.setAttribute('aria-expanded', 'false');
          provEl.style.display = 'none';
          return;
        }
        provToggle.setAttribute('aria-expanded', 'true');
        provEl.style.display = 'block';
        if (!provLoaded) {
          provLoaded = true;
          provEl.innerHTML = '<div class="ec-skeleton">tracing memory sources…</div>';
          try {
            const r = await fetch('/api/provenance/episode/' + encodeURIComponent(ref.id), { cache: 'no-store' });
            if (!r.ok) throw new Error('http ' + r.status);
            const data = await r.json();
            renderProvenance(provEl, data);
          } catch (err) {
            provEl.innerHTML = '<div class="ec-error">failed to load provenance: ' + escHtml(String(err)) + '</div>';
          }
        }
      });
    }

    if (blToggle && blEl) {
      blToggle.addEventListener('click', async () => {
        const expanded = blToggle.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          blToggle.setAttribute('aria-expanded', 'false');
          blEl.style.display = 'none';
          return;
        }
        blToggle.setAttribute('aria-expanded', 'true');
        blEl.style.display = 'block';
        if (!blLoaded) {
          blLoaded = true;
          blEl.innerHTML = '<div class="ec-skeleton">loading backlinks…</div>';
          const groups = await fetchEntity(ref.type, ref.id, 'backlinks');
          if (!groups || !Array.isArray(groups) || groups.length === 0) {
            blEl.innerHTML = '<div class="ec-empty">no incoming references</div>';
            return;
          }
          blEl.innerHTML = '';
          const newAncestors = new Set(ancestors);
          newAncestors.add(refKey(ref));
          for (const g of groups) {
            if (!g.refs || g.refs.length === 0) continue;
            const groupEl = document.createElement('div');
            groupEl.className = 'ec-cgroup';
            groupEl.innerHTML = '<div class="ec-clbl">⤺ ' + escHtml(g.label) + ' (' + g.refs.length + ')</div>';
            const refsEl = document.createElement('div');
            refsEl.className = 'ec-crefs';
            for (const cref of g.refs.slice(0, 30)) {
              refsEl.appendChild(render(cref, { depth: depth + 1, ancestors: newAncestors }));
            }
            if (g.refs.length > 30) {
              const more = document.createElement('div');
              more.className = 'ec-more';
              more.textContent = '+ show ' + (g.refs.length - 30) + ' more';
              more.addEventListener('click', () => {
                for (const cref of g.refs.slice(30)) {
                  refsEl.appendChild(render(cref, { depth: depth + 1, ancestors: newAncestors }));
                }
                more.remove();
              });
              refsEl.appendChild(more);
            }
            groupEl.appendChild(refsEl);
            blEl.appendChild(groupEl);
          }
        }
      });
    }

    chev.addEventListener('click', async () => {
      const expanded = chev.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        chev.setAttribute('aria-expanded', 'false');
        chev.textContent = '▶';
        childrenEl.style.display = 'none';
        return;
      }
      chev.setAttribute('aria-expanded', 'true');
      chev.textContent = '▼';
      childrenEl.style.display = 'block';
      if (!loaded) {
        loaded = true;
        childrenEl.innerHTML = '<div class="ec-skeleton">loading children…</div>';
        const groups = await fetchEntity(ref.type, ref.id, 'children');
        if (!groups || !Array.isArray(groups) || groups.length === 0 || groups.every(g => !g.refs || g.refs.length === 0)) {
          childrenEl.innerHTML = '<div class="ec-empty">no children</div>';
          chev.classList.add('ec-leaf');
          return;
        }
        childrenEl.innerHTML = '';
        const newAncestors = new Set(ancestors);
        newAncestors.add(refKey(ref));
        for (const g of groups) {
          if (!g.refs || g.refs.length === 0) continue;
          const groupEl = document.createElement('div');
          groupEl.className = 'ec-cgroup';
          groupEl.innerHTML = '<div class="ec-clbl">' + escHtml(g.label) + ' (' + g.refs.length + ')</div>';
          const refsEl = document.createElement('div');
          refsEl.className = 'ec-crefs';
          const visible = g.refs.slice(0, CHILD_PAGE);
          for (const cref of visible) {
            refsEl.appendChild(render(cref, { depth: depth + 1, ancestors: newAncestors }));
          }
          if (g.refs.length > CHILD_PAGE) {
            const more = document.createElement('div');
            more.className = 'ec-more';
            const remaining = g.refs.length - CHILD_PAGE;
            more.textContent = '+ show ' + remaining + ' more';
            more.addEventListener('click', () => {
              for (const cref of g.refs.slice(CHILD_PAGE)) {
                refsEl.appendChild(render(cref, { depth: depth + 1, ancestors: newAncestors }));
              }
              more.remove();
            });
            refsEl.appendChild(more);
          }
          groupEl.appendChild(refsEl);
          childrenEl.appendChild(groupEl);
        }
      }
    });
  }

  /**
   * Mount a list of refs into a container element, replacing any prior
   * content. Used by the live-console tab to render recent turns + active
   * sessions as flat top-level lists of EntityCards.
   */
  function mountList(container, refs, emptyText) {
    if (!container) return;
    container.innerHTML = '';
    if (!refs || refs.length === 0) {
      container.innerHTML = '<div class="ec-list-empty">' + escHtml(emptyText || 'nothing yet') + '</div>';
      return;
    }
    for (const ref of refs) {
      container.appendChild(render(ref, { depth: 0 }));
    }
  }

  return { render: render, mountList: mountList };
})();
</script>

<script>
(() => {
  // hoisted early so any helper invoked at IIFE top-level (e.g. explorer
  // tab init or party-tab interval setup) can use \$ without TDZ-erroring.
  const $ = (id) => document.getElementById(id);

  // --- tab switching ----------------------------------------------------
  const tabs = document.querySelectorAll('.tab');
  const panes = document.querySelectorAll('.tab-pane');
  function activate(name) {
    tabs.forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    panes.forEach((p) => {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
    if (name === 'arch' && typeof window.__renderArch === 'function') {
      window.__renderArch();
    }
    if (name === 'flow' && typeof window.__renderFlow === 'function') {
      window.__renderFlow();
    }
    if (name === 'explorer') {
      // Focus the search input on tab activation. Soft-fail if not yet rendered.
      setTimeout(() => { try { $('explorer-input').focus(); } catch {} }, 60);
      if (typeof window.__renderExplorerBrowse === 'function') window.__renderExplorerBrowse();
    }
    if (name === 'party' && typeof window.__renderParty === 'function') {
      window.__renderParty();
    }
    if (name === 'cosmos' && typeof window.__renderCosmos === 'function') {
      window.__renderCosmos();
    }
    try { history.replaceState({}, '', '#' + name); } catch {}
  }
  tabs.forEach((t) => {
    t.addEventListener('click', () => activate(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t.dataset.tab); }
    });
  });
  // Any element with data-jump-tab="<name>" activates that tab on click.
  // Used by "open in Akashic Records →" links beneath the heads-up lists.
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.jumpTab) {
      activate(t.dataset.jumpTab);
    }
  });
  // Honor URL hash so reloads stay on the same tab.
  const initial = (location.hash || '#live').slice(1);
  if (['live', 'flow', 'party', 'explorer', 'cosmos', 'arch'].includes(initial)) activate(initial);

  // ── The Council — control room engine ─────────────────────────
  let councilSnap = null;
  // Roster the user has currently selected for the next sitting.
  let liturgyRoster = ['analyst', 'pm', 'architect', 'dev', 'qa', 'ux'];
  let liturgyMode = 'sequential';
  let liturgyTemplate = 'freeform';
  let liturgyRounds = 2;

  window.__renderParty = async function renderParty() {
    // Pull the council snapshot + recent parties in parallel.
    let snap, parties;
    try {
      const [s, p] = await Promise.all([
        fetch('/api/council/snapshot', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/parties/recent', { cache: 'no-store' }).then(r => r.json()),
      ]);
      snap = s;
      parties = p;
    } catch (err) {
      const el = $('council-grid');
      if (el) el.innerHTML = '<div class="ec-error">failed to load council: ' + esc(String(err)) + '</div>';
      return;
    }
    councilSnap = snap;
    renderCouncilStatus(snap);
    renderCouncilGrid(snap);
    renderLiturgyRoster();
    updateLiturgyEstimate();
    renderChronicle(parties);
    renderCouncilSeal(snap);
  };

  function renderCouncilStatus(snap) {
    $('council-member-count').textContent = String(snap.members ? snap.members.length : 0);
    $('council-active-count').textContent = snap.active_party_id ? '1' : '0';
    $('council-daily-spent').textContent = '$' + (snap.daily_today.todayUsd || 0).toFixed(2);
    $('council-daily-cap').textContent = '$' + (snap.daily_cap_usd || 10).toFixed(2);
    $('council-total-inv').textContent = String(snap.total_invocations || 0);
  }

  function renderCouncilGrid(snap) {
    const host = $('council-grid');
    if (!host || !snap.members) return;
    host.innerHTML = snap.members.map((m) => {
      const inRoster = liturgyRoster.includes(m.role);
      const isMaster = m.role === 'master';
      const conf = m.stats.avg_confidence != null
        ? '<div class="ag-bar"><div class="ag-bar-fill" style="width:' + Math.round(m.stats.avg_confidence * 100) + '%"></div></div>'
        : '<div class="ag-bar"></div>';
      return '<div class="agent-card ' + (inRoster ? 'in-roster ' : '') + (isMaster ? 'is-master ' : '') + '" ' +
        'data-role="' + esc(m.role) + '" ' +
        'style="--ag-color:#' + esc(m.accent) + '">' +
        '<button class="ag-toggle" data-toggle="' + esc(m.role) + '" type="button" title="' +
        (inRoster ? 'remove from roster' : 'add to roster') + '">' +
        (inRoster ? '✓' : '+') + '</button>' +
        '<div class="ag-sigil">' + m.sigilSvg + '</div>' +
        '<div class="ag-name">' + esc(m.name) + '</div>' +
        '<div class="ag-title">' + esc(m.title) + '</div>' +
        '<div class="ag-stats">' +
          '<span class="ag-stat-key">invocations</span><span class="ag-stat-val">' + (m.stats.invocations || 0) + '</span>' +
          '<span class="ag-stat-key">avg conf</span><span class="ag-stat-val">' + (m.stats.avg_confidence != null ? m.stats.avg_confidence.toFixed(2) : '—') + '</span>' +
          '<span class="ag-stat-key">total</span><span class="ag-stat-val">$' + (m.stats.total_cost_usd || 0).toFixed(2) + '</span>' +
          conf +
        '</div>' +
      '</div>';
    }).join('');
    // Wire card click → drawer; toggle click → roster
    host.querySelectorAll('.agent-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.dataset && t.dataset.toggle) return; // toggle has its own handler
        const role = card.dataset.role;
        if (role) openCouncilDrawer(role);
      });
    });
    host.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const role = btn.dataset.toggle;
        const idx = liturgyRoster.indexOf(role);
        if (idx >= 0) liturgyRoster.splice(idx, 1);
        else liturgyRoster.push(role);
        renderCouncilGrid(councilSnap);
        renderLiturgyRoster();
        updateLiturgyEstimate();
      });
    });
  }

  function renderLiturgyRoster() {
    const host = $('liturgy-roster');
    if (!host || !councilSnap) return;
    if (liturgyRoster.length === 0) {
      host.innerHTML = '<span class="explorer-hint">_(no members selected — toggle in The Chamber)_</span>';
      return;
    }
    host.innerHTML = liturgyRoster.map(role => {
      const m = councilSnap.members.find(x => x.role === role);
      if (!m) return '';
      return '<span class="lr-chip" style="color:#' + esc(m.accent) + '">' +
        esc(m.name) + ' <button class="lr-chip-x" data-remove-role="' + esc(role) + '" type="button">✕</button>' +
      '</span>';
    }).join('');
    host.querySelectorAll('[data-remove-role]').forEach(btn => {
      btn.addEventListener('click', () => {
        const role = btn.dataset.removeRole;
        const idx = liturgyRoster.indexOf(role);
        if (idx >= 0) liturgyRoster.splice(idx, 1);
        renderCouncilGrid(councilSnap);
        renderLiturgyRoster();
        updateLiturgyEstimate();
      });
    });
  }

  function updateLiturgyEstimate() {
    // Heuristic: ~$0.10 per agent per round + ~$0.20 for synthesis.
    // Quick mode scales down; adversarial doesn't change cost; PRD/spec
    // templates make synthesis a touch heavier.
    const agentBudget = liturgyMode === 'quick' ? 0.05 : 0.10;
    const synthCost = (liturgyTemplate === 'spec' || liturgyTemplate === 'prd') ? 0.30 : 0.20;
    const est = (liturgyRoster.length * agentBudget * (liturgyMode === 'quick' ? 1 : liturgyRounds)) + synthCost;
    const dur = liturgyMode === 'parallel' || liturgyMode === 'quick'
      ? Math.max(20, 10 + 6 * liturgyRoster.length)
      : Math.max(40, 8 * liturgyRoster.length * liturgyRounds + 30);
    $('liturgy-cost').textContent = '$' + est.toFixed(2);
    $('liturgy-duration').textContent = '~' + dur + 's';
    const topic = ($('liturgy-topic').value || '').trim();
    const valid = topic.length >= 5 && liturgyRoster.length >= 1;
    $('liturgy-convene').disabled = !valid;
    const warn = $('liturgy-warn');
    if (warn) {
      if (!valid) warn.textContent = topic.length < 5 ? 'topic ≥ 5 chars' : 'roster needs ≥ 1 member';
      else warn.textContent = '';
    }
  }

  function openCouncilDrawer(role) {
    if (!councilSnap) return;
    const m = councilSnap.members.find(x => x.role === role);
    if (!m) return;
    const drawer = $('council-drawer');
    const body = $('council-drawer-body');
    if (!drawer || !body) return;
    const lastInv = m.stats.last_invoked_at ? new Date(m.stats.last_invoked_at).toLocaleString() : '—';
    const familiars = (m.stats.familiars || []).map((f) => {
      const fa = councilSnap.members.find(x => x.role === f.role);
      return fa
        ? '<span class="cd-familiar" style="color:#' + esc(fa.accent) + '">' + esc(fa.name) + ' · ' + f.co_appearances + '×</span>'
        : '';
    }).join('') || '<span class="explorer-hint">_(no co-appearances yet)_</span>';
    const recent = (m.stats.recent || []).length === 0
      ? '<span class="explorer-hint">_(no contributions yet)_</span>'
      : (m.stats.recent || []).map(r =>
          '<div class="cdr" data-pmid="' + r.party_message_id + '" data-pid="' + esc(r.party_id) + '">' +
            esc(r.party_topic.slice(0, 80)) +
            ' · round ' + r.round_number +
            (r.confidence != null ? ' · conf ' + r.confidence.toFixed(2) : '') +
            ' · $' + r.cost_usd.toFixed(4) +
          '</div>'
        ).join('');
    body.innerHTML =
      '<div class="cd-head">' +
        '<div class="cd-sigil" style="color:#' + esc(m.accent) + '">' + m.sigilSvg + '</div>' +
        '<div>' +
          '<div class="cd-name">' + esc(m.name) + '</div>' +
          '<div class="cd-title">' + esc(m.title) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="cd-actions">' +
        '<button class="cd-action" data-cd-roster="' + esc(role) + '">' +
          (liturgyRoster.includes(role) ? 'remove from next sitting' : 'add to next sitting') +
        '</button>' +
        '<button class="cd-action" data-cd-lore="' + esc(role) + '">read lore</button>' +
      '</div>' +
      '<div class="cd-section">' +
        '<div class="cd-section-h">battle stats</div>' +
        '<div class="cd-stats">' +
          '<span class="key">invocations</span><span class="val">' + m.stats.invocations + '</span>' +
          '<span class="key">avg confidence</span><span class="val">' + (m.stats.avg_confidence != null ? m.stats.avg_confidence.toFixed(2) : '—') + '</span>' +
          '<span class="key">total cost</span><span class="val">$' + m.stats.total_cost_usd.toFixed(4) + '</span>' +
          '<span class="key">avg duration</span><span class="val">' + (m.stats.avg_duration_ms / 1000).toFixed(1) + 's</span>' +
          '<span class="key">last invoked</span><span class="val">' + lastInv + '</span>' +
          '<span class="key">top template</span><span class="val">' + (m.stats.top_template ? esc(m.stats.top_template) : '—') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="cd-section">' +
        '<div class="cd-section-h">familiars</div>' +
        '<div class="cd-familiars">' + familiars + '</div>' +
      '</div>' +
      '<div class="cd-section">' +
        '<div class="cd-section-h">recent contributions</div>' +
        '<div class="cd-recent">' + recent + '</div>' +
      '</div>';
    drawer.hidden = false;
    body.querySelectorAll('[data-cd-roster]').forEach(b => b.addEventListener('click', () => {
      const r = b.dataset.cdRoster;
      const idx = liturgyRoster.indexOf(r);
      if (idx >= 0) liturgyRoster.splice(idx, 1); else liturgyRoster.push(r);
      renderCouncilGrid(councilSnap);
      renderLiturgyRoster();
      updateLiturgyEstimate();
      drawer.hidden = true;
    }));
    body.querySelectorAll('[data-cd-lore]').forEach(b => b.addEventListener('click', () => {
      openLoreBook(b.dataset.cdLore);
    }));
    body.querySelectorAll('[data-pmid]').forEach(d => d.addEventListener('click', () => {
      const pmid = d.dataset.pmid;
      const overlay = document.createElement('div');
      overlay.className = 'prov-popover';
      overlay.appendChild(window.__EntityCard.render({ type: 'party-message', id: pmid }, { depth: 0 }));
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }));
  }

  function openLoreBook(role) {
    if (!councilSnap) return;
    const m = councilSnap.members.find(x => x.role === role);
    if (!m) return;
    const book = $('lore-book');
    const content = $('lore-content');
    if (!book || !content) return;
    // Render markdown loosely — convert headings + bullets + paragraphs.
    const html = renderLoreMarkdown(m.loreText);
    content.innerHTML = html;
    book.hidden = false;
  }

  function renderLoreMarkdown(text) {
    if (!text) return '<p>_(no lore)_</p>';
    // Whole UI is one outer template literal: escape sequences inside
    // strings, comments, and regex literals get expanded. Build via
    // char codes to dodge it.
    const NL = String.fromCharCode(10);
    const CR = String.fromCharCode(13);
    const lines = text.replace(new RegExp(CR, 'g'), '').split(NL);
    let html = '';
    let inList = false;
    let inCode = false;
    let para = [];
    const flushPara = () => {
      if (para.length > 0) {
        html += '<p>' + escForDom(para.join(' ')) + '</p>';
        para = [];
      }
    };
    const FENCE = String.fromCharCode(96, 96, 96); // '\` \` \`' — escape so the outer template literal doesn't terminate
    for (const line of lines) {
      if (line.startsWith(FENCE)) {
        flushPara();
        if (!inCode) { html += '<pre><code>'; inCode = true; }
        else { html += '</code></pre>'; inCode = false; }
        continue;
      }
      if (inCode) { html += escForDom(line) + NL; continue; }
      if (line.startsWith('# ')) { flushPara(); if (inList) { html += '</ul>'; inList = false; } html += '<h1>' + escForDom(line.slice(2)) + '</h1>'; continue; }
      if (line.startsWith('## ')) { flushPara(); if (inList) { html += '</ul>'; inList = false; } html += '<h2>' + escForDom(line.slice(3)) + '</h2>'; continue; }
      if (line.startsWith('- ')) { flushPara(); if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + escForDom(line.slice(2)) + '</li>'; continue; }
      if (line.trim() === '') { flushPara(); if (inList) { html += '</ul>'; inList = false; } continue; }
      para.push(line);
    }
    flushPara();
    if (inList) html += '</ul>';
    if (inCode) html += '</code></pre>';
    return html;
  }

  function renderChronicle(snap) {
    if (!snap || !snap.parties) return;
    const lc = $('party-list-count');
    if (lc) lc.textContent = '(' + snap.parties.length + ')';
    const refs = (snap.parties || []).map(p => ({ type: 'party', id: p.id }));
    if (window.__EntityCard) {
      window.__EntityCard.mountList(
        $('party-list'),
        refs,
        'no sittings yet — convene the council above or run /party in Slack',
      );
    }
  }

  function renderCouncilSeal(snap) {
    const host = $('council-seal-host');
    if (!host) return;
    host.innerHTML = (snap.seal_svg || '') +
      '<div class="seal-caption">composite of ' + (snap.members.length - 1) + ' councilors · Maat&#39;s feather at the heart</div>';
  }

  function renderAffinityMatrix(data) {
    const host = $('affinity-matrix');
    if (!host) return;
    const cells = data.cells || [];
    const max = Math.max(1, data.max_co || 1);
    const roles = ['analyst', 'pm', 'architect', 'dev', 'qa', 'ux', 'master'];
    const nameOf = (r) => {
      if (!councilSnap) return r;
      const m = councilSnap.members.find(x => x.role === r);
      return m ? m.name : r;
    };
    let html = '<div class="am-corner"></div>';
    for (const c of roles) html += '<div class="am-label">' + esc(nameOf(c)) + '</div>';
    for (const r of roles) {
      html += '<div class="am-row-label">' + esc(nameOf(r)) + '</div>';
      for (const c of roles) {
        const cell = cells.find(x => x.a === r && x.b === c);
        if (!cell || r === c) {
          html += '<div class="am-cell diag" title="—"></div>';
          continue;
        }
        const intensity = cell.co_parties / max; // 0..1
        const corr = cell.conf_correlation;
        // Color by correlation (warm = agreement, cool = disagreement, neutral = teal)
        let color;
        if (corr == null) color = 'rgba(40, 70, 90, ' + (0.3 + intensity * 0.5) + ')';
        else if (corr > 0.2) color = 'rgba(255, 180, 80, ' + (0.3 + intensity * 0.6) + ')';
        else if (corr < -0.2) color = 'rgba(120, 180, 255, ' + (0.3 + intensity * 0.6) + ')';
        else color = 'rgba(40, 200, 200, ' + (0.3 + intensity * 0.5) + ')';
        html += '<div class="am-cell" style="background:' + color + '" ' +
          'title="' + esc(nameOf(r)) + ' × ' + esc(nameOf(c)) + ': ' + cell.co_parties + ' parties' +
          (corr != null ? ', conf-corr ' + corr.toFixed(2) : '') + '">' +
          (cell.co_parties > 0 ? cell.co_parties : '') +
        '</div>';
      }
    }
    host.innerHTML = html;
  }

  // Wire section toggles
  document.querySelectorAll('[data-show-section]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const which = btn.dataset.showSection;
      ['chamber', 'liturgy', 'affinity', 'seal'].forEach(s => {
        const sec = $('council-section-' + s);
        if (sec) sec.hidden = (s !== which);
      });
      document.querySelectorAll('[data-show-section]').forEach(b => b.classList.toggle('on', b.dataset.showSection === which));
      if (which === 'affinity') {
        try {
          const r = await fetch('/api/council/affinity', { cache: 'no-store' });
          if (r.ok) renderAffinityMatrix(await r.json());
        } catch {}
      }
    });
  });
  // Default: chamber visible
  document.querySelector('[data-show-section="chamber"]')?.classList.add('on');

  // Liturgy form interactivity
  $('liturgy-topic')?.addEventListener('input', updateLiturgyEstimate);
  document.querySelectorAll('#liturgy-mode .lp').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#liturgy-mode .lp').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    liturgyMode = b.dataset.mode;
    updateLiturgyEstimate();
  }));
  document.querySelectorAll('#liturgy-template .lp').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#liturgy-template .lp').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    liturgyTemplate = b.dataset.template;
    updateLiturgyEstimate();
  }));
  document.querySelectorAll('#liturgy-rounds .lp').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#liturgy-rounds .lp').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    liturgyRounds = parseInt(b.dataset.rounds, 10);
    updateLiturgyEstimate();
  }));

  // Convene button
  $('liturgy-convene')?.addEventListener('click', async () => {
    const btn = $('liturgy-convene');
    if (!btn || btn.disabled) return;
    const topic = ($('liturgy-topic').value || '').trim();
    btn.classList.add('firing');
    btn.disabled = true;
    // Conjure animation: pulse each in-roster sigil
    document.querySelectorAll('.agent-card.in-roster').forEach(c => c.classList.add('summoned'));
    try {
      const r = await fetch('/api/council/convene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          mode: liturgyMode,
          template: liturgyTemplate,
          rounds: liturgyRounds,
          roster: liturgyRoster,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        $('liturgy-warn').textContent = '⚠ ' + (data.reason || 'convene failed');
      } else {
        $('liturgy-warn').textContent = '';
        $('liturgy-topic').value = '';
        // Refresh after a beat
        setTimeout(() => window.__renderParty(), 1500);
      }
    } catch (err) {
      $('liturgy-warn').textContent = '⚠ ' + String(err);
    } finally {
      setTimeout(() => {
        btn.classList.remove('firing');
        btn.disabled = false;
        document.querySelectorAll('.agent-card.summoned').forEach(c => c.classList.remove('summoned'));
        updateLiturgyEstimate();
      }, 1500);
    }
  });

  // Drawer close
  $('council-drawer')?.querySelector('.cd-close')?.addEventListener('click', () => {
    $('council-drawer').hidden = true;
  });
  $('council-drawer')?.addEventListener('click', (e) => {
    if (e.target === $('council-drawer')) $('council-drawer').hidden = true;
  });
  // Lore book close
  $('lore-book')?.querySelector('.lore-close')?.addEventListener('click', () => {
    $('lore-book').hidden = true;
  });
  $('lore-book')?.addEventListener('click', (e) => {
    if (e.target === $('lore-book')) $('lore-book').hidden = true;
  });

  // Auto-refresh council every 8s when active
  setInterval(() => {
    if (location.hash === '#party' && typeof window.__renderParty === 'function') {
      window.__renderParty();
    }
  }, 8000);

  // Live status indicators — react to party SSE events
  function applyAgentStateFromEvent(ev) {
    if (!councilSnap) return;
    if (ev.kind === 'party.started') {
      // Mark all summoned agents as summoned
      const roster = ev.roster || [];
      document.querySelectorAll('.agent-card').forEach(c => {
        if (roster.includes(c.dataset.role)) c.classList.add('summoned');
      });
    } else if (ev.kind === 'party.agent_spoke') {
      const card = document.querySelector('.agent-card[data-role="' + ev.role + '"]');
      if (card) {
        card.classList.add('speaking');
        setTimeout(() => card.classList.remove('speaking'), 4000);
      }
    } else if (ev.kind === 'party.synthesis') {
      const card = document.querySelector('.agent-card[data-role="master"]');
      if (card) {
        card.classList.add('speaking');
        setTimeout(() => card.classList.remove('speaking'), 6000);
      }
    } else if (ev.kind === 'party.complete') {
      document.querySelectorAll('.agent-card').forEach(c => {
        c.classList.remove('summoned');
        c.classList.remove('speaking');
      });
      // Refresh stats once a party finishes
      window.__renderParty();
    }
  }
  // Subscribe to existing event stream
  window.__councilApplyEvent = applyAgentStateFromEvent;

  // ── The Firmament — Living Cosmos ──────────────────────────────
  // Dependency-free 2D canvas with manual perspective projection.
  // Living: shooting stars stream in via SSE. Time machine: scrubber
  // rewinds visibility. Cartographer: search, lasso, radial menu,
  // bookmarks, minimap. Inhabitants: provenance threads, skill
  // nebulae, Thoth sun + Council orbit. Wow: weather tints, supernovae,
  // hyperjump warp, Thoth's Eye, sound design.
  let cosmosState = null;

  window.__renderCosmos = async function renderCosmos() {
    if (cosmosState) {
      await loadCosmosData(cosmosState);
      return;
    }
    const host = $('cosmos-canvas');
    const tooltip = $('cosmos-tooltip');
    if (!host) return;
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    cosmosState = {
      host, canvas, ctx, tooltip,
      // data
      snapshot: null,
      points: [],
      // camera
      yaw: 0.4, pitch: 0.3, zoom: 1.0,
      camTargetYaw: null, camTargetPitch: null, camTargetZoom: null,
      // interaction
      dragging: false,
      lastX: 0, lastY: 0,
      hoverIdx: -1, mx: null, my: null,
      selectedIdx: -1,
      lassoStart: null, lassoEnd: null, lassoSet: new Set(),
      // time
      timePos: 1, // 0..1 (fraction of full window)
      timePlay: false, timeSpeedIdx: 0, // 1x/8x/60x
      // shooting stars (live events)
      shootingStars: [],
      // bookmarks
      bookmarks: loadBookmarks(),
      // search
      searchQuery: '',
      // tour
      tourActive: false, tourTarget: null,
      // perf
      frameTimes: [],
      perfMode: false,
      // sound (off by default)
      audioEnabled: false, audioCtx: null,
      // provenance threads
      provenanceLines: null,
      // animation t
      t0: performance.now(),
    };
    fitCosmos(cosmosState);
    const onResize = () => fitCosmos(cosmosState);
    window.addEventListener('resize', onResize);

    // ── input wiring ────────────────────────────────────────────
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (cosmosState.hoverIdx >= 0) showRadial(e);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) return;
      const rect = canvas.getBoundingClientRect();
      cosmosState.lastX = e.clientX;
      cosmosState.lastY = e.clientY;
      if (e.shiftKey) {
        cosmosState.lassoStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        cosmosState.lassoEnd = { ...cosmosState.lassoStart };
      } else {
        cosmosState.dragging = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (cosmosState.lassoStart) finishLasso();
      cosmosState.dragging = false;
      cosmosState.lassoStart = null;
      cosmosState.lassoEnd = null;
    });
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      cosmosState.mx = e.clientX - rect.left;
      cosmosState.my = e.clientY - rect.top;
      if (cosmosState.lassoStart) {
        cosmosState.lassoEnd = { x: cosmosState.mx, y: cosmosState.my };
      } else if (cosmosState.dragging) {
        const dx = e.clientX - cosmosState.lastX;
        const dy = e.clientY - cosmosState.lastY;
        cosmosState.yaw += dx * 0.01;
        cosmosState.pitch = Math.max(-1.4, Math.min(1.4, cosmosState.pitch + dy * 0.01));
        cosmosState.lastX = e.clientX;
        cosmosState.lastY = e.clientY;
      }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      cosmosState.zoom = Math.max(0.3, Math.min(4, cosmosState.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    }, { passive: false });
    canvas.addEventListener('click', (e) => {
      if (cosmosState.hoverIdx < 0) return;
      const p = cosmosState.points[cosmosState.hoverIdx];
      if (!p) return;
      cosmosState.selectedIdx = cosmosState.hoverIdx;
      // Hyperjump animation
      cosmosState.canvas.classList.add('warping');
      setTimeout(() => cosmosState.canvas.classList.remove('warping'), 600);
      // Open in side panel
      const overlay = document.createElement('div');
      overlay.className = 'prov-popover';
      overlay.appendChild(window.__EntityCard.render({ type: p.type, id: p.id }, { depth: 0 }));
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
      // Pull provenance for episodes
      if (p.type === 'episode') loadProvenance(p.id);
      else cosmosState.provenanceLines = null;
      playChime('select');
    });

    // Search input
    const search = $('cosmos-search');
    if (search) {
      search.addEventListener('input', () => {
        cosmosState.searchQuery = search.value.trim().toLowerCase();
      });
    }

    // Toolbar buttons
    document.querySelectorAll('.cosmos-tool').forEach((b) => {
      b.addEventListener('click', () => {
        const t = b.dataset.tool;
        if (t === 'reset') {
          cosmosState.yaw = 0.4; cosmosState.pitch = 0.3; cosmosState.zoom = 1.0;
          cosmosState.timePos = 1; updateTimeLabel();
          if ($('cosmos-time-scrubber')) $('cosmos-time-scrubber').value = 1000;
        } else if (t === 'bookmark') saveBookmark();
        else if (t === 'tour') toggleTour();
        else if (t === 'mute') toggleAudio(b);
        else if (t === 'help') {
          const help = $('cosmos-help'); if (help) help.hidden = false;
        }
      });
    });

    // Help modal close
    $('cosmos-help')?.querySelector('.ch-close')?.addEventListener('click', () => {
      $('cosmos-help').hidden = true;
    });
    $('cosmos-help')?.addEventListener('click', (e) => {
      if (e.target === $('cosmos-help')) $('cosmos-help').hidden = true;
    });

    // Time river
    $('cosmos-time-scrubber')?.addEventListener('input', (e) => {
      cosmosState.timePos = parseInt(e.target.value, 10) / 1000;
      updateTimeLabel();
    });
    document.querySelector('.ctr-btn[data-tr="play"]')?.addEventListener('click', (e) => {
      cosmosState.timePlay = !cosmosState.timePlay;
      e.target.textContent = cosmosState.timePlay ? '❚❚' : '▶';
      e.target.classList.toggle('on', cosmosState.timePlay);
    });
    document.querySelector('.ctr-btn[data-tr="speed"]')?.addEventListener('click', (e) => {
      cosmosState.timeSpeedIdx = (cosmosState.timeSpeedIdx + 1) % 4;
      const labels = ['1×', '8×', '60×', '300×'];
      e.target.textContent = labels[cosmosState.timeSpeedIdx];
    });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (location.hash !== '#cosmos') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '/') { e.preventDefault(); $('cosmos-search')?.focus(); }
      else if (e.key.toLowerCase() === 'b') saveBookmark();
      else if (e.key.toLowerCase() === 't') toggleTour();
      else if (e.key.toLowerCase() === 'p') {
        cosmosState.timePlay = !cosmosState.timePlay;
        const btn = document.querySelector('.ctr-btn[data-tr="play"]');
        if (btn) { btn.textContent = cosmosState.timePlay ? '❚❚' : '▶'; btn.classList.toggle('on', cosmosState.timePlay); }
      }
      else if (e.key.toLowerCase() === 'm') {
        const mute = document.querySelector('.cosmos-tool[data-tool="mute"]');
        if (mute) toggleAudio(mute);
      }
      else if (e.key === '?') { const h = $('cosmos-help'); if (h) h.hidden = false; }
      else if (e.key === 'Escape') {
        $('cosmos-help').hidden = true;
        cosmosState.provenanceLines = null;
        cosmosState.selectedIdx = -1;
        hideRadial();
      }
    });

    await loadCosmosData(cosmosState);
    renderBookmarks();
    requestAnimationFrame(cosmosTick);
  };

  async function loadCosmosData(s) {
    try {
      const r = await fetch('/api/cosmos', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      s.snapshot = data;
      s.points = data.points || [];
      const cnt = $('cosmos-count');
      if (cnt) cnt.textContent = String(s.points.length);
      const ccc = $('cosmos-cluster-count');
      if (ccc) ccc.textContent = '· ' + ((data.clusters || []).length) + ' constellations';
      // Apply weather class
      s.canvas.classList.remove('weather-minor', 'weather-major', 'weather-critical');
      if (data.sky_weather && data.sky_weather !== 'none') {
        s.canvas.classList.add('weather-' + data.sky_weather);
      }
    } catch {}
  }

  function fitCosmos(s) {
    const r = s.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    s.canvas.width = r.width * dpr;
    s.canvas.height = r.height * dpr;
    s.canvas.style.width = r.width + 'px';
    s.canvas.style.height = r.height + 'px';
    s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.w = r.width;
    s.h = r.height;
  }

  function project(s, x, y, z) {
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    let x1 = cy * x + sy * z;
    let z1 = -sy * x + cy * z;
    let y1 = cp * y - sp * z1;
    let z2 = sp * y + cp * z1;
    const persp = 1 / (3.0 - z2 * 0.9);
    const scale = Math.min(s.w, s.h) * 0.40 * s.zoom;
    return {
      sx: s.w / 2 + x1 * scale * persp,
      sy: s.h / 2 + y1 * scale * persp,
      depth: z2,
      persp,
    };
  }

  function visibleByTime(s, p) {
    if (!s.snapshot) return true;
    const earliest = s.snapshot.earliestTs;
    const latest = s.snapshot.latestTs;
    const span = Math.max(1, latest - earliest);
    const cutoff = earliest + span * s.timePos;
    return !p.createdAt || p.createdAt <= cutoff;
  }

  function cosmosTick(now) {
    if (!cosmosState) return;
    const s = cosmosState;
    const ctx = s.ctx;
    const w = s.w, h = s.h;
    // FPS sampling
    const dt = now ? (now - s.t0) : 16;
    s.t0 = now || performance.now();
    s.frameTimes.push(dt);
    if (s.frameTimes.length > 30) s.frameTimes.shift();
    const avgFrame = s.frameTimes.reduce((a,b)=>a+b,0) / s.frameTimes.length;
    const fps = Math.round(1000 / Math.max(1, avgFrame));
    const fpsEl = $('cosmos-fps');
    if (fpsEl) fpsEl.textContent = fps + ' fps';
    // Performance mode auto-engage
    if (!s.perfMode && s.frameTimes.length >= 30 && avgFrame > 33) {
      s.perfMode = true;
      const pw = $('cosmos-perf-warn'); if (pw) pw.hidden = false;
    }

    // Auto-tour camera glide
    if (s.tourActive) {
      // Pick next interesting cluster every ~5s
      if (!s.tourTarget || (s.tourTargetUntil && now > s.tourTargetUntil)) {
        const clusters = (s.snapshot && s.snapshot.clusters) || [];
        if (clusters.length > 0) {
          const c = clusters[Math.floor(Math.random() * clusters.length)];
          s.tourTarget = c;
          s.tourTargetUntil = (now || performance.now()) + 5000;
          s.camTargetYaw = (Math.random() - 0.5) * Math.PI;
          s.camTargetPitch = 0.2 + (Math.random() - 0.5) * 0.5;
          s.camTargetZoom = 1.4 + Math.random() * 0.6;
        }
      }
    }
    // Camera lerp toward target
    if (s.camTargetYaw !== null) {
      s.yaw += (s.camTargetYaw - s.yaw) * 0.04;
      s.pitch += (s.camTargetPitch - s.pitch) * 0.04;
      s.zoom += (s.camTargetZoom - s.zoom) * 0.04;
    }

    // Time playback
    if (s.timePlay && s.snapshot) {
      const speeds = [1, 8, 60, 300];
      const span = Math.max(1, s.snapshot.latestTs - s.snapshot.earliestTs);
      const dx = (dt / 1000) * speeds[s.timeSpeedIdx] * 60_000 / span;
      s.timePos = Math.min(1, s.timePos + dx);
      const sl = $('cosmos-time-scrubber'); if (sl) sl.value = String(Math.round(s.timePos * 1000));
      updateTimeLabel();
      if (s.timePos >= 1) {
        s.timePlay = false;
        const btn = document.querySelector('.ctr-btn[data-tr="play"]');
        if (btn) { btn.textContent = '▶'; btn.classList.remove('on'); }
      }
    }

    // ── Backdrop ─────────────────────────────────────────────
    ctx.fillStyle = '#03050a';
    ctx.fillRect(0, 0, w, h);
    // Background star field — denser unless perf mode
    const bgCount = s.perfMode ? 90 : 220;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < bgCount; i++) {
      const x = ((i * 2654435761) >>> 0) % w;
      const y = ((i * 1664525) >>> 0) % h;
      ctx.fillRect(x, y, 1, 1);
    }

    // ── Sky weather (over backdrop, under stars) ─────────────
    const wz = s.snapshot && s.snapshot.sky_weather;
    if (wz === 'minor' || wz === 'major' || wz === 'critical') {
      ctx.save();
      ctx.fillStyle = wz === 'critical' ? 'rgba(220,40,40,0.10)' : wz === 'major' ? 'rgba(255,120,60,0.07)' : 'rgba(255,200,80,0.05)';
      ctx.fillRect(0, h * 0.6, w, h * 0.4);
      ctx.restore();
    }

    if (!s.snapshot) {
      requestAnimationFrame(cosmosTick);
      return;
    }
    const snap = s.snapshot;

    // ── Skill nebulae (drawn under everything) ───────────────
    if (!s.perfMode) {
      for (const sk of snap.skills || []) {
        const p = project(s, sk.cx, sk.cy, sk.cz);
        const radius = Math.min(140, 30 + sk.memberIndices.length * 6);
        const grd = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, radius);
        grd.addColorStop(0, sk.hue.replace(')', ',0.25)').replace('hsl', 'hsla'));
        grd.addColorStop(1, sk.hue.replace(')', ',0)').replace('hsl', 'hsla'));
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ── Constellation lines ──────────────────────────────────
    for (const cl of snap.clusters || []) {
      ctx.strokeStyle = 'rgba(120, 200, 220, 0.18)';
      ctx.lineWidth = 0.7;
      for (const [a, b] of cl.edges) {
        const pa = snap.points[a]; const pb = snap.points[b];
        if (!pa || !pb) continue;
        if (!visibleByTime(s, pa) || !visibleByTime(s, pb)) continue;
        const A = project(s, pa.x, pa.y, pa.z);
        const B = project(s, pb.x, pb.y, pb.z);
        ctx.beginPath();
        ctx.moveTo(A.sx, A.sy);
        ctx.lineTo(B.sx, B.sy);
        ctx.stroke();
      }
    }

    // ── Anniversary rays ─────────────────────────────────────
    const dayMs = 24 * 60 * 60 * 1000;
    if (!s.perfMode) {
      for (let i = 0; i < snap.points.length; i++) {
        const a = snap.points[i];
        if (!a.createdAt) continue;
        const dayA = Math.floor(a.createdAt / dayMs);
        for (let j = i + 1; j < Math.min(snap.points.length, i + 30); j++) {
          const b = snap.points[j];
          if (!b.createdAt) continue;
          const dayB = Math.floor(b.createdAt / dayMs);
          // Same day-of-year, different year
          const da = new Date(a.createdAt);
          const db = new Date(b.createdAt);
          if (da.getMonth() === db.getMonth() && da.getDate() === db.getDate() && Math.abs(dayA - dayB) > 300) {
            const A = project(s, a.x, a.y, a.z);
            const B = project(s, b.x, b.y, b.z);
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.20)';
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(A.sx, A.sy); ctx.lineTo(B.sx, B.sy); ctx.stroke();
          }
        }
      }
    }

    // ── Project all points + sort by depth ──────────────────
    const projected = [];
    for (let i = 0; i < snap.points.length; i++) {
      const p = snap.points[i];
      if (!visibleByTime(s, p)) continue;
      const pr = project(s, p.x, p.y, p.z);
      const baseR = (3 + p.brightness * 4) * pr.persp * 1.2;
      const matchSearch = s.searchQuery && (p.title || '').toLowerCase().includes(s.searchQuery);
      const dim = s.searchQuery && !matchSearch;
      const r = matchSearch ? baseR * 1.6 : baseR;
      projected.push({ i, sx: pr.sx, sy: pr.sy, r, depth: pr.depth, p, dim, matchSearch });
    }
    projected.sort((a, b) => a.depth - b.depth);

    // Hover
    let hover = -1;
    if (typeof s.mx === 'number' && typeof s.my === 'number') {
      let bestD = 9999;
      for (let k = projected.length - 1; k >= 0; k--) {
        const pr = projected[k];
        const dx = pr.sx - s.mx, dy = pr.sy - s.my;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < pr.r + 6 && d < bestD) { hover = pr.i; bestD = d; break; }
      }
    }
    s.hoverIdx = hover;

    // ── Provenance threads (selected episode) ──────────────
    if (s.provenanceLines && s.selectedIdx >= 0 && s.points[s.selectedIdx]) {
      const focal = s.points[s.selectedIdx];
      const F = project(s, focal.x, focal.y, focal.z);
      ctx.lineWidth = 1.0;
      for (const link of s.provenanceLines) {
        ctx.strokeStyle = link.color;
        const T = link.target;
        ctx.beginPath();
        ctx.moveTo(F.sx, F.sy);
        // bezier control point for an arc
        const midX = (F.sx + T.sx) / 2;
        const midY = (F.sy + T.sy) / 2 - 40;
        ctx.quadraticCurveTo(midX, midY, T.sx, T.sy);
        ctx.stroke();
      }
    }

    // ── Stars ───────────────────────────────────────────────
    for (const pr of projected) {
      const p = pr.p;
      // Color: peer hue if peer matches; otherwise type default
      let baseRGB = peerColorRGB(snap, p.peer) || (p.kind === 'party' ? '178, 136, 255' : p.kind === 'skill' ? '52, 211, 153' : '70, 211, 255');
      // Verification glow
      if (p.verifiedStatus === 'success') baseRGB = '74, 222, 128';
      else if (p.verifiedStatus === 'failure') baseRGB = '239, 68, 68';
      else if (p.verifiedStatus === 'outdated') baseRGB = '120, 120, 130';
      const alphaMul = pr.dim ? 0.18 : 1;
      const supernova = p.isSupernova ? 1 + 0.5 * Math.sin((s.t0 / 600) + pr.i) : 1;
      // Outer glow
      const grd = ctx.createRadialGradient(pr.sx, pr.sy, 0, pr.sx, pr.sy, pr.r * 6 * supernova);
      grd.addColorStop(0, 'rgba(' + baseRGB + ',' + (0.55 * p.brightness * alphaMul).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(' + baseRGB + ',0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, pr.r * 6 * supernova, 0, Math.PI * 2); ctx.fill();
      // Core
      ctx.fillStyle = 'rgba(255,255,255,' + (0.6 + 0.4 * p.brightness) * alphaMul + ')';
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, pr.r, 0, Math.PI * 2); ctx.fill();
      // Lasso highlight
      if (s.lassoSet.has(pr.i) || pr.i === hover) {
        ctx.strokeStyle = pr.i === hover ? 'rgba(255,255,255,0.95)' : 'rgba(40, 200, 200, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(pr.sx, pr.sy, pr.r + 4, 0, Math.PI * 2); ctx.stroke();
      }
      // Search match corona
      if (pr.matchSearch) {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(pr.sx, pr.sy, pr.r + 6, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // ── Constellation labels ────────────────────────────────
    for (const cl of snap.clusters || []) {
      const cP = snap.points[cl.centroidIdx];
      if (!cP) continue;
      if (!visibleByTime(s, cP)) continue;
      const C = project(s, cP.x, cP.y, cP.z);
      ctx.fillStyle = 'rgba(180, 220, 230, 0.55)';
      ctx.font = '10px var(--mono, monospace)';
      ctx.textAlign = 'center';
      ctx.fillText(cl.name, C.sx, C.sy - 18);
    }

    // ── The Sun (Thoth) + Council planets + Pole star ─────────
    drawApexSystem(s, ctx, snap);

    // ── Live shooting stars (event meteors) ─────────────────
    drawShootingStars(s, ctx);

    // ── Lasso rectangle ─────────────────────────────────────
    if (s.lassoStart && s.lassoEnd) {
      const x = Math.min(s.lassoStart.x, s.lassoEnd.x);
      const y = Math.min(s.lassoStart.y, s.lassoEnd.y);
      const w2 = Math.abs(s.lassoEnd.x - s.lassoStart.x);
      const h2 = Math.abs(s.lassoEnd.y - s.lassoStart.y);
      ctx.strokeStyle = 'rgba(40, 200, 200, 0.6)';
      ctx.fillStyle = 'rgba(40, 200, 200, 0.08)';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, w2, h2);
      ctx.strokeRect(x, y, w2, h2);
    }

    // ── Tooltip ─────────────────────────────────────────────
    if (s.tooltip) {
      if (hover >= 0) {
        const pr = projected.find(x => x.i === hover);
        const p = s.points[hover];
        const verifyTxt = p.verifiedStatus ? '<span class="tt-pill">' + p.verifiedStatus + '</span>' : '';
        const peerTxt = p.peer ? '<div class="tt-line">peer: ' + escForDom(p.peer) + '</div>' : '';
        const costTxt = p.costUsd ? '<div class="tt-line">$' + p.costUsd.toFixed(4) + ' · ' + (p.numTurns || 0) + ' turns</div>' : '';
        s.tooltip.hidden = false;
        s.tooltip.innerHTML =
          '<strong>' + (p.kind === 'party' ? '🎭' : p.kind === 'skill' ? '🛠️' : '✦') + ' ' + p.kind + '</strong> ' + verifyTxt +
          '<br>' + escForDom(p.title) + peerTxt + costTxt;
        s.tooltip.style.left = (pr.sx + 14) + 'px';
        s.tooltip.style.top = (pr.sy + 14) + 'px';
      } else {
        s.tooltip.hidden = true;
      }
    }

    // ── Minimap ─────────────────────────────────────────────
    drawMinimap(s, snap, projected);

    requestAnimationFrame(cosmosTick);
  }

  function drawApexSystem(s, ctx, snap) {
    const cx0 = s.w / 2, cy0 = s.h / 2;
    // Pole star (Maat's feather) — fixed position upper area
    const pole = project(s, 0, -1.4, 0.2);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.7)';
    ctx.font = '24px serif';
    ctx.textAlign = 'center';
    ctx.fillText('𓆄', pole.sx, pole.sy);
    ctx.font = '9px var(--mono, monospace)';
    ctx.fillStyle = 'rgba(251, 191, 36, 0.55)';
    ctx.fillText('Maat’s feather', pole.sx, pole.sy + 14);

    // Thoth sun at origin
    const sun = project(s, 0, 0, 0);
    const corona = ctx.createRadialGradient(sun.sx, sun.sy, 0, sun.sx, sun.sy, 60);
    corona.addColorStop(0, 'rgba(251, 191, 36, 0.95)');
    corona.addColorStop(0.4, 'rgba(251, 191, 36, 0.30)');
    corona.addColorStop(1, 'rgba(251, 191, 36, 0.0)');
    ctx.fillStyle = corona;
    ctx.beginPath(); ctx.arc(sun.sx, sun.sy, 60, 0, Math.PI * 2); ctx.fill();
    // Thoth's Eye (iris that watches recent shooting stars)
    const eyeAngle = s.eyeAngle || 0;
    const ex = sun.sx + Math.cos(eyeAngle) * 4;
    const ey = sun.sy + Math.sin(eyeAngle) * 4;
    ctx.fillStyle = 'rgba(30, 30, 30, 1)';
    ctx.beginPath(); ctx.arc(ex, ey, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(40, 200, 200, 0.85)';
    ctx.beginPath(); ctx.arc(ex, ey, 4, 0, Math.PI * 2); ctx.fill();

    // Council planets in orbit
    if (snap.agents) {
      const t = (s.t0 || performance.now()) / 6000;
      for (const a of snap.agents) {
        const angle = a.phase + t * 0.6;
        const ox = Math.cos(angle) * a.orbitR;
        const oy = Math.sin(angle) * a.orbitR;
        const proj = project(s, ox, oy, 0);
        // Soft halo
        const halo = ctx.createRadialGradient(proj.sx, proj.sy, 0, proj.sx, proj.sy, 18);
        halo.addColorStop(0, 'rgba(' + hexToRgb('#' + a.accent) + ',0.5)');
        halo.addColorStop(1, 'rgba(' + hexToRgb('#' + a.accent) + ',0)');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(proj.sx, proj.sy, 18, 0, Math.PI * 2); ctx.fill();
        // Planet
        ctx.fillStyle = '#' + a.accent;
        ctx.beginPath(); ctx.arc(proj.sx, proj.sy, 6, 0, Math.PI * 2); ctx.fill();
        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '9px var(--mono, monospace)';
        ctx.textAlign = 'center';
        ctx.fillText(a.name, proj.sx, proj.sy + 18);
      }
    }

    // Peer binary stars
    if (snap.peers) {
      for (const peer of snap.peers) {
        const proj = project(s, peer.x, peer.y, peer.z);
        const grd = ctx.createRadialGradient(proj.sx, proj.sy, 0, proj.sx, proj.sy, 24);
        grd.addColorStop(0, peer.hue);
        grd.addColorStop(1, peer.hue.replace(')', ',0)').replace('rgb', 'rgba').replace('hsl', 'hsla'));
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(proj.sx, proj.sy, 24, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.arc(proj.sx, proj.sy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '9px var(--mono, monospace)';
        ctx.textAlign = 'center';
        ctx.fillText(peer.id.slice(0, 11), proj.sx, proj.sy + 18);
      }
    }
  }

  function drawShootingStars(s, ctx) {
    const now = performance.now();
    const live = [];
    for (const sh of s.shootingStars) {
      const t = (now - sh.startedAt) / sh.duration;
      if (t > 1) continue;
      live.push(sh);
      // Position
      const x1 = sh.x1, y1 = sh.y1, x2 = sh.x2, y2 = sh.y2;
      const cx = x1 + (x2 - x1) * t;
      const cy = y1 + (y2 - y1) * t;
      // Trail
      ctx.strokeStyle = 'rgba(' + sh.rgb + ',' + (1 - t).toFixed(2) + ')';
      ctx.lineWidth = 2.5 * (1 - t * 0.5);
      ctx.beginPath();
      ctx.moveTo(x1 + (x2 - x1) * Math.max(0, t - 0.1), y1 + (y2 - y1) * Math.max(0, t - 0.1));
      ctx.lineTo(cx, cy);
      ctx.stroke();
      // Head
      ctx.fillStyle = 'rgba(' + sh.rgb + ',1)';
      ctx.beginPath(); ctx.arc(cx, cy, 3 * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
    }
    s.shootingStars = live;
    // Thoth's Eye watches the latest shooting star
    if (live.length > 0) {
      const last = live[live.length - 1];
      s.eyeAngle = Math.atan2((last.y2 - s.h/2), (last.x2 - s.w/2));
    }
  }

  function drawMinimap(s, snap, projected) {
    const mm = $('cosmos-minimap');
    if (!mm) return;
    const c = mm.getContext('2d');
    const W = mm.width, H = mm.height;
    c.fillStyle = 'rgba(7, 9, 12, 0.9)';
    c.fillRect(0, 0, W, H);
    // Plot all points by raw x/y (no rotation)
    c.fillStyle = 'rgba(120, 220, 220, 0.8)';
    for (const p of snap.points) {
      const mx = (p.x + 1.6) / 3.2 * W;
      const my = (p.y + 1.6) / 3.2 * H;
      c.fillRect(mx, my, 1, 1);
    }
    // Draw Thoth sun
    c.fillStyle = '#fbbf24';
    c.beginPath(); c.arc(W / 2, H / 2, 3, 0, Math.PI * 2); c.fill();
    // Frustum approximation: a circle showing camera focus
    c.strokeStyle = 'rgba(40, 200, 200, 0.7)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(W / 2, H / 2, 30 / s.zoom, 0, Math.PI * 2);
    c.stroke();
  }

  function peerColorRGB(snap, peerId) {
    if (!peerId || !snap || !snap.peers) return null;
    const p = snap.peers.find(x => x.id === peerId);
    if (!p) return null;
    return hueStringToRgb(p.hue);
  }

  function hueStringToRgb(hue) {
    if (hue.startsWith('#')) return hexToRgb(hue);
    if (hue.startsWith('hsl')) {
      // Outer template literal collapses regex-literal escapes — use RegExp ctor.
      const re = new RegExp('hsl\\((\\d+),');
      const m = hue.match(re);
      if (!m) return null;
      const h = parseInt(m[1], 10);
      // Quick HSL→RGB at 70% sat, 60% light
      const c = hslToRgb(h, 70, 60);
      return c[0] + ',' + c[1] + ',' + c[2];
    }
    return null;
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return r + ',' + g + ',' + b;
  }
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r=0,g=0,b=0;
    if (h < 60) { r=c; g=x; b=0; }
    else if (h < 120) { r=x; g=c; b=0; }
    else if (h < 180) { r=0; g=c; b=x; }
    else if (h < 240) { r=0; g=x; b=c; }
    else if (h < 300) { r=x; g=0; b=c; }
    else { r=c; g=0; b=x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function updateTimeLabel() {
    const lbl = $('cosmos-time-label');
    if (!lbl || !cosmosState || !cosmosState.snapshot) return;
    const earliest = cosmosState.snapshot.earliestTs;
    const latest = cosmosState.snapshot.latestTs;
    const span = latest - earliest;
    const t = earliest + span * cosmosState.timePos;
    if (cosmosState.timePos >= 0.998) lbl.textContent = 'now';
    else lbl.textContent = new Date(t).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
  }

  function finishLasso() {
    const s = cosmosState;
    if (!s || !s.lassoStart || !s.lassoEnd) return;
    const x = Math.min(s.lassoStart.x, s.lassoEnd.x);
    const y = Math.min(s.lassoStart.y, s.lassoEnd.y);
    const x2 = Math.max(s.lassoStart.x, s.lassoEnd.x);
    const y2 = Math.max(s.lassoStart.y, s.lassoEnd.y);
    s.lassoSet = new Set();
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i];
      const pr = project(s, p.x, p.y, p.z);
      if (pr.sx >= x && pr.sx <= x2 && pr.sy >= y && pr.sy <= y2) s.lassoSet.add(i);
    }
  }

  function showRadial(e) {
    const r = $('cosmos-radial');
    if (!r) return;
    r.style.left = (e.offsetX || 0) + 'px';
    r.style.top = (e.offsetY || 0) + 'px';
    const items = ['open', 'similar', 'summon', 'copy ID'];
    const html = items.map((label, i) => {
      const angle = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
      const dx = Math.cos(angle) * 70;
      const dy = Math.sin(angle) * 70;
      return '<button class="cr-item" data-act="' + label.replace(/ /g, '-') + '" type="button" style="left:calc(100px + ' + dx + 'px - 30px); top:calc(100px + ' + dy + 'px - 12px);">' + label + '</button>';
    }).join('');
    r.innerHTML = html;
    r.hidden = false;
    r.querySelectorAll('.cr-item').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.act;
      const idx = cosmosState.hoverIdx;
      const p = idx >= 0 ? cosmosState.points[idx] : null;
      if (act === 'open' && p) {
        const overlay = document.createElement('div');
        overlay.className = 'prov-popover';
        overlay.appendChild(window.__EntityCard.render({ type: p.type, id: p.id }, { depth: 0 }));
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
      } else if (act === 'copy-ID' && p) {
        navigator.clipboard?.writeText(p.id).catch(() => {});
      }
      hideRadial();
    }));
  }
  function hideRadial() {
    const r = $('cosmos-radial');
    if (r) r.hidden = true;
  }
  document.addEventListener('click', (e) => {
    const r = $('cosmos-radial');
    if (r && !r.hidden && !r.contains(e.target)) hideRadial();
  });

  function saveBookmark() {
    if (!cosmosState) return;
    const bm = {
      yaw: cosmosState.yaw,
      pitch: cosmosState.pitch,
      zoom: cosmosState.zoom,
      timePos: cosmosState.timePos,
      label: 'view ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      ts: Date.now(),
    };
    cosmosState.bookmarks.push(bm);
    cosmosState.bookmarks = cosmosState.bookmarks.slice(-8);
    persistBookmarks();
    renderBookmarks();
  }
  function loadBookmarks() {
    try { return JSON.parse(localStorage.getItem('cosmos-bookmarks') || '[]'); } catch { return []; }
  }
  function persistBookmarks() {
    try { localStorage.setItem('cosmos-bookmarks', JSON.stringify(cosmosState.bookmarks)); } catch {}
  }
  function renderBookmarks() {
    const host = $('cosmos-bookmarks');
    if (!host) return;
    host.innerHTML = (cosmosState.bookmarks || []).map((b, i) =>
      '<button class="cosmos-bookmark" data-bm-idx="' + i + '" type="button">' + escForDom(b.label) + ' <span class="cb-x" data-bm-rm="' + i + '">✕</span></button>'
    ).join('');
    host.querySelectorAll('[data-bm-idx]').forEach(b => b.addEventListener('click', (e) => {
      if (e.target.dataset.bmRm !== undefined) return;
      const idx = parseInt(b.dataset.bmIdx, 10);
      const bm = cosmosState.bookmarks[idx];
      if (!bm) return;
      cosmosState.camTargetYaw = bm.yaw;
      cosmosState.camTargetPitch = bm.pitch;
      cosmosState.camTargetZoom = bm.zoom;
      cosmosState.timePos = bm.timePos;
      const sl = $('cosmos-time-scrubber'); if (sl) sl.value = String(Math.round(bm.timePos * 1000));
      updateTimeLabel();
    }));
    host.querySelectorAll('[data-bm-rm]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(b.dataset.bmRm, 10);
      cosmosState.bookmarks.splice(idx, 1);
      persistBookmarks();
      renderBookmarks();
    }));
  }

  function toggleTour() {
    if (!cosmosState) return;
    cosmosState.tourActive = !cosmosState.tourActive;
    cosmosState.tourTarget = null;
    const btn = document.querySelector('.cosmos-tool[data-tool="tour"]');
    if (btn) btn.classList.toggle('on', cosmosState.tourActive);
    if (!cosmosState.tourActive) {
      cosmosState.camTargetYaw = null;
      cosmosState.camTargetPitch = null;
      cosmosState.camTargetZoom = null;
    }
  }

  function toggleAudio(btn) {
    if (!cosmosState) return;
    cosmosState.audioEnabled = !cosmosState.audioEnabled;
    if (btn) btn.classList.toggle('on', cosmosState.audioEnabled);
    if (cosmosState.audioEnabled && !cosmosState.audioCtx) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AC = window.AudioContext || window.webkitAudioContext;
        cosmosState.audioCtx = new AC();
      } catch {}
    }
  }

  function playChime(kind) {
    if (!cosmosState || !cosmosState.audioEnabled || !cosmosState.audioCtx) return;
    const ac = cosmosState.audioCtx;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    const freqMap = { select: 880, party: 660, episode: 440, reflection: 220 };
    osc.frequency.value = freqMap[kind] || 440;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ac.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.6);
    osc.start();
    osc.stop(ac.currentTime + 0.6);
  }

  async function loadProvenance(episodeId) {
    try {
      const r = await fetch('/api/provenance/episode/' + encodeURIComponent(episodeId), { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const lines = [];
      for (const row of (data.rows || [])) {
        // For related-episode rows, find the target point and add a line.
        if (row.kind === 'related-episode' && row.sourceId) {
          const idx = cosmosState.points.findIndex(p => p.id === String(row.sourceId) && p.type === 'episode');
          if (idx >= 0) {
            const t = project(cosmosState, cosmosState.points[idx].x, cosmosState.points[idx].y, cosmosState.points[idx].z);
            lines.push({ target: t, color: 'rgba(70, 211, 255, 0.5)' });
          }
        } else if (row.kind === 'persona-stack') {
          // Project to a high "anchor" point above the cosmos
          const t = project(cosmosState, 0, -1.4, 0.3);
          lines.push({ target: t, color: 'rgba(255, 213, 100, 0.4)' });
        } else if (row.kind === 'user-model') {
          // Project to the matching peer star
          const peer = cosmosState.snapshot && cosmosState.snapshot.peers.find(p => p.id === row.sourceId);
          if (peer) {
            const t = project(cosmosState, peer.x, peer.y, peer.z);
            lines.push({ target: t, color: 'rgba(168, 139, 250, 0.45)' });
          }
        }
      }
      cosmosState.provenanceLines = lines;
    } catch {}
  }

  function escForDom(s) {
    const div = document.createElement('div');
    div.textContent = String(s ?? '');
    return div.innerHTML;
  }

  // Push a shooting star into the firmament when an event arrives.
  function pushShootingStar(kind, peer) {
    if (!cosmosState || !cosmosState.host) return;
    const w = cosmosState.w, h = cosmosState.h;
    if (!w || !h) return;
    // Origin off-screen, target = sun (or a peer star if known)
    const angle = Math.random() * Math.PI * 2;
    const startR = Math.max(w, h) * 0.6;
    const startX = w / 2 + Math.cos(angle) * startR;
    const startY = h / 2 + Math.sin(angle) * startR;
    const targetX = w / 2;
    const targetY = h / 2;
    const colorMap = {
      'message.received': '70, 211, 255',
      'episode.write':    '74, 222, 128',
      'spawn.start':      '251, 191, 36',
      'reflection.start': '178, 136, 255',
      'reflection.complete': '178, 136, 255',
      'party.started':    '178, 136, 255',
      'party.agent_spoke': '178, 136, 255',
      'party.complete':   '74, 222, 128',
    };
    cosmosState.shootingStars.push({
      x1: startX, y1: startY, x2: targetX, y2: targetY,
      rgb: colorMap[kind] || '180, 220, 230',
      startedAt: performance.now(),
      duration: 1500,
    });
    if (kind === 'episode.write') playChime('episode');
    else if (kind === 'reflection.complete') playChime('reflection');
    else if (kind && kind.indexOf('party.') === 0) playChime('party');
  }
  // Expose so SSE handler can push events into the cosmos.
  window.__cosmosShootingStar = pushShootingStar;

  // ---- explorer browse: heatmap + persona stack + persona files + memory ----
  let explorerBrowseLoaded = false;
  let akashicSemanticMode = false;
  let akashicPinned = loadPinned();
  let akashicSavedSearches = loadSavedSearches();
  let akashicFilters = { date: 'all', peer: '', channel: '', verified: '' };

  window.__renderExplorerBrowse = async function renderExplorerBrowse() {
    if (explorerBrowseLoaded) {
      // Re-fetch the lightweight digest each time the tab opens.
      loadAkashicDigest();
      return;
    }
    explorerBrowseLoaded = true;
    const personaList = $('explorer-persona-list');
    const memoryList = $('explorer-memory-list');
    const personaStack = $('persona-stack');
    const heatmapGrid = $('heatmap-grid');
    try {
      const [pr, mr, ps, hm, mk] = await Promise.all([
        fetch('/api/personas', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ refs: [] })),
        fetch('/api/memory-notes', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ refs: [] })),
        fetch('/api/persona-stack', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ layers: [], total: 0 })),
        fetch('/api/events/heatmap', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ days: [] })),
        fetch('/api/skills/registry', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ entries: [] })),
      ]);
      if (window.__EntityCard) {
        if (personaList) window.__EntityCard.mountList(personaList, (pr.refs || []).slice(0, 50),
          'no persona files found at persona/');
        if (memoryList) window.__EntityCard.mountList(memoryList, (mr.refs || []).slice(0, 50),
          'MEMORY.md is empty — write some notes via reflection or 🧠 reactions');
      }
      if (personaStack) renderPersonaStack(personaStack, ps);
      if (heatmapGrid) renderHeatmap(heatmapGrid, hm);
      const marketplace = $('explorer-marketplace');
      if (marketplace) renderMarketplace(marketplace, mk);
    } catch (err) {
      if (personaList) personaList.innerHTML = '<div class="ec-error">failed to load: ' + esc(String(err)) + '</div>';
    }
    // Akashic-specific surfaces
    loadAkashicDigest();
    loadAkashicVolumes();
    loadAkashicMilestones();
    loadAkashicTrends();
    loadAkashicPersonaDrift();
    populateAkashicFilters();
    renderAkashicPinned();
    renderAkashicSaved();
    wireAkashicTools();
    renderGenesis();           // B6
    loadManuscriptThemeState(); // B1 + N6 — restore last theme choice
  };

  // ── Daily digest (on this day + forgotten + formative) ──────────
  async function loadAkashicDigest() {
    try {
      const r = await fetch('/api/akashic/digest', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      renderDigestList($('otd-body'), (d.onThisDay || []).map(x => ({ id: x.episodeId, label: x.agoLabel, ts: x.createdAt })));
      renderDigestList($('forgotten-body'), (d.forgotten || []).map(x => ({ id: x.episodeId, label: x.reason + ' · ' + new Date(x.createdAt).toISOString().slice(0,10), ts: x.createdAt })));
      renderDigestList($('formative-body'), (d.formative || []).map(x => ({ id: x.episodeId, label: '★ cited ' + x.citations + '×', ts: 0 })));
      window.__akashicFormativeIds = new Set((d.formative || []).map(x => x.episodeId));
      window.__akashicTrends = d.trends || { emerging: [], decaying: [] };
      renderTrends();
      window.__akashicMilestones = d.milestones || [];
      // Skip — milestones rendered via /api/akashic/digest already
    } catch {}
  }

  function renderDigestList(host, items) {
    if (!host) return;
    if (!items || items.length === 0) {
      host.innerHTML = '<span class="explorer-hint">_(no entries)_</span>';
      return;
    }
    host.innerHTML = items.map(it =>
      '<div class="ad-row" data-ep-id="' + it.id + '">ep#' + it.id + ' · ' + esc(it.label) + '</div>'
    ).join('');
    host.querySelectorAll('[data-ep-id]').forEach(el => el.addEventListener('click', () => {
      openEntityModal({ type: 'episode', id: el.dataset.epId });
    }));
  }

  function renderTrends() {
    const t = window.__akashicTrends || { emerging: [], decaying: [] };
    const emerge = $('trends-emerging');
    const decay = $('trends-decaying');
    if (emerge) {
      emerge.innerHTML = (t.emerging || []).slice(0, 10).map(x =>
        '<div class="at-term" data-term="' + esc(x.term) + '">' + esc(x.term) + '<span class="at-cnt">' + x.recent + ' · was ' + x.baseline + '</span></div>'
      ).join('') || '<span class="explorer-hint">_(no trends yet)_</span>';
      emerge.querySelectorAll('[data-term]').forEach(el => el.addEventListener('click', () => {
        $('explorer-input').value = el.dataset.term;
        $('explorer-input').dispatchEvent(new Event('input'));
      }));
    }
    if (decay) {
      decay.innerHTML = (t.decaying || []).slice(0, 10).map(x =>
        '<div class="at-term" data-term="' + esc(x.term) + '">' + esc(x.term) + '<span class="at-cnt">' + x.recent + ' · was ' + x.baseline + '</span></div>'
      ).join('') || '<span class="explorer-hint">_(no trends yet)_</span>';
      decay.querySelectorAll('[data-term]').forEach(el => el.addEventListener('click', () => {
        $('explorer-input').value = el.dataset.term;
        $('explorer-input').dispatchEvent(new Event('input'));
      }));
    }
  }

  async function loadAkashicVolumes() {
    try {
      const r = await fetch('/api/akashic/volumes', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const host = $('akashic-volumes');
      if (!host) return;
      const volumes = d.volumes || [];
      renderBookshelf(volumes);
      if (volumes.length === 0) {
        host.innerHTML = '<span class="explorer-hint">_(no volumes yet — keep using the bridge and they&#39;ll bind by month)_</span>';
        return;
      }
      host.innerHTML = volumes.map((v, i) =>
        '<div class="av-card" data-vol="' + esc(v.id) + '">' +
          '<div class="av-num">Volume ' + (volumes.length - i) + '</div>' +
          '<div class="av-title">' + esc(v.monthLabel) + '</div>' +
          (v.topThemes && v.topThemes.length > 0 ? '<div class="av-meta" style="font-style:italic">' + esc(v.topThemes.join(' · ')) + '</div>' : '') +
          '<div class="av-meta">' + v.episodeIds.length + ' entries</div>' +
        '</div>'
      ).join('');
      host.querySelectorAll('[data-vol]').forEach(el => el.addEventListener('click', () => {
        const v = volumes.find(x => x.id === el.dataset.vol);
        if (v) openVolumeModal(v);
      }));
    } catch {}
  }

  async function loadAkashicMilestones() {
    try {
      const r = await fetch('/api/akashic/digest', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const host = $('akashic-milestones');
      if (!host) return;
      const ms = d.milestones || [];
      if (ms.length === 0) {
        host.innerHTML = '<span class="explorer-hint">_(no milestones yet)_</span>';
        return;
      }
      host.innerHTML = ms.map(m => {
        const date = new Date(m.ts).toISOString().slice(0,10);
        const glyph = m.ordinal === 1 ? '✦' : m.ordinal >= 1000 ? '✸' : '★';
        const seed = m.kind + '-' + m.ordinal;
        return '<div class="am-stained glass" data-ep-id="' + (m.episodeId || '') + '">' +
          stainedGlassSvg(m.label, date, glyph, seed) +
          '</div>';
      }).join('');
      host.querySelectorAll('[data-ep-id]').forEach(el => el.addEventListener('click', () => {
        if (el.dataset.epId) openEntityModal({ type: 'episode', id: el.dataset.epId });
      }));
    } catch {}
  }

  async function loadAkashicTrends() { /* digest handles it */ }

  async function loadAkashicPersonaDrift() {
    try {
      const r = await fetch('/api/akashic/persona-timeline', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const host = $('persona-drift');
      if (!host) return;
      const obs = d.observations || [];
      if (obs.length === 0) {
        host.innerHTML = '<span class="explorer-hint">_(MEMORY.md is empty — observations build over time as you use Thoth)_</span>';
        return;
      }
      host.innerHTML = obs.slice(-30).reverse().map(o =>
        '<div class="ad-row" style="padding:6px 8px; background:var(--bg-2); border-radius:4px; margin-bottom:4px;">' +
          '<span style="color:var(--accent-2); font-size:10px; margin-right:8px;">' + esc(o.date) + '</span>' +
          '<span style="color:var(--text-dim); font-size:11px;">' + esc(o.text) + '</span>' +
        '</div>'
      ).join('');
    } catch {}
  }

  async function populateAkashicFilters() {
    // Populate peer + channel dropdowns from sessions
    try {
      const r = await fetch('/api/sessions', { cache: 'no-store' });
      const d = await r.json();
      const peers = new Set();
      const channels = new Set();
      for (const s of (d.recent || [])) {
        if (s.firstPeerId) peers.add(s.firstPeerId);
        if (s.channelName) channels.add(s.channelName);
      }
      const peerSel = $('af-peer');
      if (peerSel) {
        Array.from(peers).forEach(p => {
          const opt = document.createElement('option');
          opt.value = p; opt.textContent = p;
          peerSel.appendChild(opt);
        });
      }
      const chSel = $('af-channel');
      if (chSel) {
        Array.from(channels).forEach(c => {
          const opt = document.createElement('option');
          opt.value = c; opt.textContent = '#' + c;
          chSel.appendChild(opt);
        });
      }
    } catch {}
  }

  // ── Phase 7: The Manuscript — theme + dark + Genesis + bookshelf ──

  function applyManuscriptTheme(on, dark) {
    const body = document.body;
    body.classList.toggle('manuscript-theme', !!on);
    body.classList.toggle('manuscript-dark', !!(on && dark));
    const tBtn = $('akashic-theme');
    const dBtn = $('akashic-dark');
    if (tBtn) {
      tBtn.classList.toggle('on', !!on);
      tBtn.textContent = on ? '◉ manuscript' : '◉ theme';
    }
    if (dBtn) {
      dBtn.hidden = !on;
      dBtn.classList.toggle('on', !!dark);
      dBtn.textContent = dark ? '◐ midnight' : '◐ light';
    }
    try {
      localStorage.setItem('akashic-theme', on ? '1' : '0');
      localStorage.setItem('akashic-dark', dark ? '1' : '0');
    } catch {}
  }

  function loadManuscriptThemeState() {
    let on = false, dark = false;
    try {
      on = localStorage.getItem('akashic-theme') === '1';
      dark = localStorage.getItem('akashic-dark') === '1';
    } catch {}
    applyManuscriptTheme(on, dark);
  }

  // ── Mock-books toggle (TEMPORARY for screenshot mockups) ─────
  // Call window.__akashicMockBooks(true) in DevTools console to fill
  // the shelf with 14 procedural fake volumes for screenshot. Refresh
  // the page to clear. NOT persisted, NOT committed to default state.
  window.__akashicShowMockBooks = false;
  window.__akashicMockBooks = function(on) {
    window.__akashicShowMockBooks = on !== false;
    if (window.__akashicLastVolumes) renderBookshelf(window.__akashicLastVolumes);
    return window.__akashicShowMockBooks ? 'mock books ON · refresh page to clear' : 'mock books OFF';
  };

  function buildMockVolumes() {
    const themes = [
      ['OAuth', 'Pact'], ['Persona', 'Drift'], ['Volumetric', 'Memory'],
      ['Sefirot', 'Foundation'], ['Council', 'Convocation'], ['Ambient', 'Watch'],
      ['Reflection', 'Loop'], ['Service', 'Migration'], ['Skill', 'Crystallization'],
      ['Honcho', 'Dialectic'], ['Episodic', 'Garden'], ['Maat', 'Verdict'],
    ];
    const months = [
      'August 2025', 'September 2025', 'October 2025', 'November 2025',
      'December 2025', 'January 2026', 'February 2026', 'March 2026',
      'April 2026', 'May 2026', 'June 2026', 'July 2026',
    ];
    return months.map((m, i) => ({
      id: 'mock-' + i,
      monthLabel: m,
      title: 'Volume ' + (i + 1) + ' · ' + m + ' — *the ' + themes[i % themes.length][0] + ' ' + themes[i % themes.length][1] + '*',
      topThemes: [themes[i % themes.length][0], themes[i % themes.length][1]],
      episodeIds: Array.from({ length: 12 + Math.floor(Math.random() * 80) }, (_, n) => 1000 + i * 100 + n),
      partyIds: [],
      startTs: Date.now() - (12 - i) * 30 * 86400000,
      endTs: Date.now() - (11 - i) * 30 * 86400000,
    }));
  }

  // Render the bookshelf alongside the volumes grid.
  function renderBookshelf(volumes) {
    const host = $('akashic-bookshelf');
    if (!host) return;
    window.__akashicLastVolumes = volumes;
    let display = volumes || [];
    if (window.__akashicShowMockBooks) {
      // Prepend mock volumes so they appear next to (or replace) real ones.
      display = buildMockVolumes().concat(display);
    }
    if (display.length === 0) {
      host.innerHTML = '';
      return;
    }
    const limited = display.slice(0, 16); // bookshelf row holds ~16 spines
    host.innerHTML = limited.map((v, i) => {
      const totalIdx = volumes.length - i;
      const colorIdx = (totalIdx - 1) % 5;
      const labelText = v.monthLabel + (v.topThemes && v.topThemes[0] ? ' · ' + v.topThemes[0] : '');
      return '<div class="book-spine" data-vol="' + esc(v.id) + '" data-color="' + colorIdx + '" title="' + esc(labelText) + '">' +
        '<div class="bs-text">Vol ' + totalIdx + ' · ' + esc(v.monthLabel.replace(' ', ' ')) + '</div>' +
      '</div>';
    }).join('');
    host.querySelectorAll('[data-vol]').forEach(el => el.addEventListener('click', () => {
      const v = volumes.find(x => x.id === el.dataset.vol);
      if (v) openVolumeModal(v);
    }));
  }

  function openVolumeModal(volume) {
    const modal = $('volume-modal');
    const body = $('vm-body');
    if (!modal || !body) return;
    const subtitle = volume.episodeIds.length + ' entries · ' +
      new Date(volume.startTs).toLocaleDateString('en-GB') + ' → ' +
      new Date(volume.endTs).toLocaleDateString('en-GB');
    body.innerHTML =
      '<h1>' + esc(volume.monthLabel) + '</h1>' +
      '<div class="vm-subtitle">' + esc(subtitle) + '</div>' +
      (volume.topThemes && volume.topThemes.length > 0
        ? '<p style="font-style:italic;color:rgba(230,212,168,0.7);margin-bottom:24px">themes — ' + esc(volume.topThemes.join(' · ')) + '</p>'
        : '') +
      '<div id="vm-entries"></div>';
    modal.hidden = false;
    // Render entries via EntityCard list (one per episode).
    const entriesHost = $('vm-entries');
    if (entriesHost && window.__EntityCard) {
      const refs = volume.episodeIds.slice(0, 80).map(id => ({ type: 'episode', id: String(id) }));
      window.__EntityCard.mountList(entriesHost, refs, '_(no entries)_');
    }
  }

  // Wire close + click-outside
  setTimeout(() => {
    const modal = $('volume-modal');
    if (modal) {
      modal.querySelector('.vm-close')?.addEventListener('click', () => { modal.hidden = true; });
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && location.hash === '#explorer') {
        const m = $('volume-modal');
        if (m && !m.hidden) m.hidden = true;
      }
    });
  }, 200);

  // B6 — Genesis card. Renders the bridge's first episode permanently.
  async function renderGenesis() {
    const card = $('genesis-card');
    if (!card) return;
    try {
      const r = await fetch('/api/episodes/recent', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const eps = d.episodes || [];
      if (eps.length === 0) { card.hidden = true; return; }
      // The "first" is the one with the smallest id (or earliest created_at)
      const first = eps.slice().sort((a, b) => a.id - b.id)[0];
      const date = new Date(first.created_at);
      const daysSince = Math.max(1, Math.floor((Date.now() - first.created_at) / (24 * 3600 * 1000)));
      const userText = (first.user_text || '').replace(/\s+/g, ' ').slice(0, 360);
      const apexText = (first.apex_summary || '').replace(/\s+/g, ' ').slice(0, 400);
      card.innerHTML =
        '<div class="gc-header">⚜ Genesis · the first record ⚜</div>' +
        '<div class="gc-title">In the beginning, you wrote…</div>' +
        '<div class="gc-meta">' + date.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }) +
          ' · ep#' + first.id + ' · ' + esc(first.channel_name || first.channel_id || '?') + '</div>' +
        '<div class="gc-body">' +
          '<div class="gc-prompt">"' + esc(userText) + (first.user_text && first.user_text.length > 360 ? '…"' : '"') + '</div>' +
          '<div class="gc-reply">' + esc(apexText) + (first.apex_summary && first.apex_summary.length > 400 ? '…' : '') + '</div>' +
        '</div>' +
        '<div class="gc-counter">' + daysSince + ' day' + (daysSince === 1 ? '' : 's') + ' have passed since Thoth first answered you.</div>';
      card.hidden = false;
      card.addEventListener('click', () => openEntityModal({ type: 'episode', id: String(first.id) }));
    } catch {}
  }

  // B3 — Stained-glass SVG milestone tile generator
  function stainedGlassSvg(label, dateStr, glyph, seed) {
    const w = 200, h = 110;
    // Procedural lead lines based on seed
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    const rng = () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 16) / 65535; };
    const palettes = [
      ['#7a1f1f', '#3a5d8c', '#7a5a1f', '#3a6b3a'],
      ['#5a2870', '#1f5a7a', '#7a3a1f', '#6e6e1f'],
      ['#1f3a7a', '#7a1f5a', '#5a7a1f', '#7a4a1f'],
    ];
    const pal = palettes[Math.floor(rng() * palettes.length)];
    // 4 panels (top-L, top-R, bottom-L, bottom-R) plus center medallion
    const tlX = 8 + Math.floor(rng() * 6);
    const midX = w / 2 + (rng() - 0.5) * 8;
    const tbY = h / 2 + (rng() - 0.5) * 6;
    const cells = [
      '<polygon points="' + tlX + ',8 ' + midX + ',8 ' + midX + ',' + tbY + ' ' + tlX + ',' + tbY + '" fill="' + pal[0] + '"/>',
      '<polygon points="' + midX + ',8 ' + (w-8) + ',8 ' + (w-8) + ',' + tbY + ' ' + midX + ',' + tbY + '" fill="' + pal[1] + '"/>',
      '<polygon points="' + tlX + ',' + tbY + ' ' + midX + ',' + tbY + ' ' + midX + ',' + (h-8) + ' ' + tlX + ',' + (h-8) + '" fill="' + pal[2] + '"/>',
      '<polygon points="' + midX + ',' + tbY + ' ' + (w-8) + ',' + tbY + ' ' + (w-8) + ',' + (h-8) + ' ' + midX + ',' + (h-8) + '" fill="' + pal[3] + '"/>',
    ];
    const lead = [
      '<rect x="6" y="6" width="' + (w-12) + '" height="' + (h-12) + '" fill="none" stroke="#1a1308" stroke-width="3" rx="2"/>',
      '<line x1="' + midX + '" y1="8" x2="' + midX + '" y2="' + (h-8) + '" stroke="#1a1308" stroke-width="2.5"/>',
      '<line x1="' + tlX + '" y1="' + tbY + '" x2="' + (w-8) + '" y2="' + tbY + '" stroke="#1a1308" stroke-width="2.5"/>',
    ];
    // Center medallion with glyph
    const cx = w/2, cy = h/2;
    const medallion = [
      '<circle cx="' + cx + '" cy="' + cy + '" r="22" fill="#fbbf24" stroke="#1a1308" stroke-width="2.5"/>',
      '<text x="' + cx + '" y="' + (cy+7) + '" text-anchor="middle" font-family="serif" font-weight="700" font-size="20" fill="#1a1308">' + glyph + '</text>',
    ];
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" aria-label="' + esc(label) + '">' +
      '<defs><filter id="sg-' + seed + '"><feGaussianBlur stdDeviation="0.4"/></filter></defs>' +
      '<g filter="url(#sg-' + seed + ')">' + cells.join('') + '</g>' +
      lead.join('') + medallion.join('') +
      '<text x="' + cx + '" y="' + (h-2) + '" text-anchor="middle" font-family="Iowan Old Style, Georgia, serif" font-size="9" fill="#fbbf24" font-style="italic">' + esc(label) + ' · ' + esc(dateStr) + '</text>' +
      '</svg>';
  }

  function wireAkashicTools() {
    // Manuscript theme toggle
    const themeBtn = $('akashic-theme');
    if (themeBtn && !themeBtn.dataset.wired) {
      themeBtn.dataset.wired = '1';
      themeBtn.addEventListener('click', () => {
        const on = !document.body.classList.contains('manuscript-theme');
        const dark = document.body.classList.contains('manuscript-dark');
        applyManuscriptTheme(on, dark);
      });
    }
    const darkBtn = $('akashic-dark');
    if (darkBtn && !darkBtn.dataset.wired) {
      darkBtn.dataset.wired = '1';
      darkBtn.addEventListener('click', () => {
        const on = document.body.classList.contains('manuscript-theme');
        const dark = !document.body.classList.contains('manuscript-dark');
        applyManuscriptTheme(on, dark);
      });
    }

    // Search mode toggle
    const modeBtn = $('akashic-search-mode');
    if (modeBtn && !modeBtn.dataset.wired) {
      modeBtn.dataset.wired = '1';
      modeBtn.addEventListener('click', () => {
        akashicSemanticMode = !akashicSemanticMode;
        modeBtn.classList.toggle('on', akashicSemanticMode);
        modeBtn.textContent = akashicSemanticMode ? '🔀 semantic' : '⌕ text';
        const q = ($('explorer-input').value || '').trim();
        if (q) $('explorer-input').dispatchEvent(new Event('input'));
      });
    }
    // Random pull
    const rand = $('akashic-random');
    if (rand && !rand.dataset.wired) {
      rand.dataset.wired = '1';
      rand.addEventListener('click', async () => {
        try {
          const r = await fetch('/api/akashic/random', { cache: 'no-store' });
          const d = await r.json();
          if (d.episodeId) openEntityModal({ type: 'episode', id: String(d.episodeId) });
        } catch {}
      });
    }
    // Narrate
    const nar = $('akashic-narrate');
    if (nar && !nar.dataset.wired) {
      nar.dataset.wired = '1';
      nar.addEventListener('click', () => {
        const m = $('akashic-narrate-modal');
        if (m) m.hidden = false;
      });
    }
    // Narrate close + go
    $('akashic-narrate-modal')?.querySelector('.anm-close')?.addEventListener('click', () => {
      $('akashic-narrate-modal').hidden = true;
    });
    $('akashic-narrate-modal')?.addEventListener('click', (e) => {
      if (e.target === $('akashic-narrate-modal')) $('akashic-narrate-modal').hidden = true;
    });
    $('anm-go')?.addEventListener('click', async () => {
      const period = $('anm-period').value;
      const body = $('anm-body');
      if (!body) return;
      body.innerHTML = '<span class="explorer-hint">_(Seshat is reading the records… this takes ~10-30s)_</span>';
      try {
        const r = await fetch('/api/akashic/narrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ period }),
        });
        if (!r.ok) throw new Error('http ' + r.status);
        const d = await r.json();
        if (!d.ok) throw new Error(d.reason || 'failed');
        body.innerHTML = renderLoreMarkdown(d.narrative || '');
      } catch (err) {
        body.innerHTML = '<span class="explorer-hint" style="color:#ef4444">narrate failed: ' + esc(String(err)) + '</span>';
      }
    });
    // Filters
    ['af-date', 'af-peer', 'af-channel', 'af-verified'].forEach(id => {
      const el = $(id);
      if (!el || el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('change', () => {
        akashicFilters = {
          date: $('af-date').value,
          peer: $('af-peer').value,
          channel: $('af-channel').value,
          verified: $('af-verified').value,
        };
        const q = ($('explorer-input').value || '').trim();
        if (q || akashicFilters.date !== 'all' || akashicFilters.peer || akashicFilters.channel || akashicFilters.verified) {
          $('explorer-input').dispatchEvent(new Event('input'));
        }
      });
    });
    // Save / clear
    $('af-save')?.addEventListener('click', () => {
      const q = ($('explorer-input').value || '').trim();
      if (!q) return;
      const label = q.slice(0, 32);
      akashicSavedSearches.unshift({ label, q, filters: { ...akashicFilters } });
      akashicSavedSearches = akashicSavedSearches.slice(0, 12);
      saveSavedSearches();
      renderAkashicSaved();
    });
    $('af-clear')?.addEventListener('click', () => {
      akashicFilters = { date: 'all', peer: '', channel: '', verified: '' };
      $('af-date').value = 'all';
      $('af-peer').value = '';
      $('af-channel').value = '';
      $('af-verified').value = '';
      $('explorer-input').value = '';
      $('explorer-input').dispatchEvent(new Event('input'));
    });
  }

  function loadPinned() {
    try { return JSON.parse(localStorage.getItem('akashic-pinned') || '[]'); } catch { return []; }
  }
  function savePinned() {
    try { localStorage.setItem('akashic-pinned', JSON.stringify(akashicPinned)); } catch {}
  }
  function loadSavedSearches() {
    try { return JSON.parse(localStorage.getItem('akashic-saved-searches') || '[]'); } catch { return []; }
  }
  function saveSavedSearches() {
    try { localStorage.setItem('akashic-saved-searches', JSON.stringify(akashicSavedSearches)); } catch {}
  }

  function renderAkashicPinned() {
    const host = $('akashic-pinned');
    const list = $('pinned-list');
    if (!host || !list) return;
    if (akashicPinned.length === 0) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    if (window.__EntityCard) {
      window.__EntityCard.mountList(list, akashicPinned, '_(no pinned records)_');
    }
  }
  function renderAkashicSaved() {
    const host = $('akashic-saved');
    const list = $('saved-list');
    if (!host || !list) return;
    if (akashicSavedSearches.length === 0) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    list.innerHTML = akashicSavedSearches.map((s, i) =>
      '<span class="saved-pill" data-saved-i="' + i + '">' + esc(s.label) + '<span class="sp-x" data-saved-rm="' + i + '">✕</span></span>'
    ).join('');
    list.querySelectorAll('[data-saved-i]').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.dataset.savedRm !== undefined) return;
      const i = parseInt(el.dataset.savedI, 10);
      const s = akashicSavedSearches[i];
      if (!s) return;
      $('explorer-input').value = s.q;
      $('af-date').value = s.filters.date || 'all';
      $('af-peer').value = s.filters.peer || '';
      $('af-channel').value = s.filters.channel || '';
      $('af-verified').value = s.filters.verified || '';
      akashicFilters = s.filters;
      $('explorer-input').dispatchEvent(new Event('input'));
    }));
    list.querySelectorAll('[data-saved-rm]').forEach(el => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(el.dataset.savedRm, 10);
      akashicSavedSearches.splice(i, 1);
      saveSavedSearches();
      renderAkashicSaved();
    }));
  }

  function openEntityModal(ref) {
    const overlay = document.createElement('div');
    overlay.className = 'prov-popover';
    overlay.appendChild(window.__EntityCard.render(ref, { depth: 0 }));
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  }

  function renderLoreMarkdown(text) {
    if (!text) return '<p>_(no narrative)_</p>';
    const NL = String.fromCharCode(10);
    const lines = text.replace(new RegExp(String.fromCharCode(13), 'g'), '').split(NL);
    let html = '';
    let para = [];
    const flushPara = () => {
      if (para.length > 0) {
        html += '<p>' + escForDom(para.join(' ')) + '</p>';
        para = [];
      }
    };
    for (const line of lines) {
      if (line.startsWith('## ')) { flushPara(); html += '<h2>' + escForDom(line.slice(3)) + '</h2>'; continue; }
      if (line.startsWith('# ')) { flushPara(); html += '<h1>' + escForDom(line.slice(2)) + '</h1>'; continue; }
      if (line.trim() === '') { flushPara(); continue; }
      para.push(line);
    }
    flushPara();
    return html;
  }

  function renderMarketplace(host, data) {
    const entries = (data && data.entries) || [];
    if (entries.length === 0) {
      host.innerHTML = '<div class="explorer-hint">_(registry empty or unreachable — react 🌍 on a skill draft to publish)_</div>';
      return;
    }
    const html = entries.slice(0, 50).map(e => {
      const date = new Date(e.publishedAt).toISOString().slice(0, 10);
      return '<div class="mk-row" title="' + esc(e.description) + '">' +
        '<span class="mk-glyph">🛠️</span>' +
        '<span class="mk-slug">' + esc(e.slug) + '</span>' +
        '<span class="mk-desc">' + esc(e.description.slice(0, 100)) + '</span>' +
        '<span class="mk-meta">' + esc(e.publishedBy) + ' · ' + date + '</span>' +
        '</div>';
    }).join('');
    host.innerHTML = html + '<div class="mk-total">' + entries.length + ' published skill' + (entries.length === 1 ? '' : 's') + ' from the public registry</div>';
  }

  function renderPersonaStack(host, data) {
    const layers = (data && data.layers) || [];
    if (layers.length === 0) {
      host.innerHTML = '<div class="explorer-hint">_(no persona files found)_</div>';
      return;
    }
    const html = layers.map(l => {
      const mtimeStr = l.mtime ? new Date(l.mtime).toISOString().slice(0, 10) : '_(missing)_';
      return '<div class="ps-layer" data-name="' + esc(l.name) + '" title="' + esc(l.path) + ' · ' + esc(l.preview) + '">' +
             '<span class="ps-name">' + esc(l.name) + '</span>' +
             '<span class="ps-preview">' + esc(l.preview.replace(/\\n/g, ' ')) + '</span>' +
             '<span class="ps-meta">' + l.chars.toLocaleString() + ' chars · ' + mtimeStr + '</span>' +
             '</div>';
    }).join('');
    const total = (data.total || 0).toLocaleString();
    host.innerHTML = html + '<div class="ps-total">total: <strong>' + total + '</strong> chars across ' + layers.length + ' layers</div>';
  }

  function renderHeatmap(host, data) {
    const days = (data && data.days) || [];
    // Build a map for fast day lookup
    const map = new Map(days.map(d => [d.day, d]));
    // Compute thresholds (quintile-style based on actual data)
    const counts = days.map(d => d.total).filter(n => n > 0).sort((a,b) => a-b);
    const q = (p) => counts.length === 0 ? 0 : counts[Math.min(counts.length-1, Math.floor(counts.length * p))];
    const t1 = q(0.25), t2 = q(0.50), t3 = q(0.75), t4 = q(0.92);
    function level(n) {
      if (n === 0) return 0;
      if (n <= t1) return 1;
      if (n <= t2) return 2;
      if (n <= t3) return 3;
      return 4;
    }
    // Render 53 weeks × 7 days, ending today, in column-major order
    const today = new Date();
    today.setUTCHours(0,0,0,0);
    const cells = [];
    // Start: today - 365 days, snapped backwards to a Sunday
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 364);
    const startDow = start.getUTCDay(); // 0=Sun
    start.setUTCDate(start.getUTCDate() - startDow);
    for (let i = 0; i <= 365 + startDow; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const data = map.get(iso);
      const count = data ? data.total : 0;
      const lvl = level(count);
      cells.push('<span class="hm-cell" data-l="' + lvl + '" data-day="' + iso + '" data-count="' + count + '" title="' + iso + ': ' + count + ' events"></span>');
    }
    host.innerHTML = cells.join('');
    host.addEventListener('click', (e) => {
      const cell = e.target;
      if (!cell || !cell.dataset || !cell.dataset.day) return;
      host.querySelectorAll('.hm-cell.active').forEach(c => c.classList.remove('active'));
      cell.classList.add('active');
      const detail = $('heatmap-detail');
      if (detail) {
        const d = map.get(cell.dataset.day);
        if (d) {
          const kinds = Object.entries(d.byKind).sort((a,b)=>b[1]-a[1]).slice(0,5);
          const kindStr = kinds.map(([k,n]) => k + ':' + n).join(' · ');
          detail.textContent = cell.dataset.day + ' — ' + d.total + ' events (' + kindStr + ')';
        } else {
          detail.textContent = cell.dataset.day + ' — no activity';
        }
      }
    });
  }

  // ---- explorer tab: universal search ---------------------------------
  const explorerInput = $('explorer-input');
  const explorerResults = $('explorer-results');
  const explorerChips = $('explorer-chips');
  let explorerType = 'all';
  let explorerDebounce = null;
  let explorerLastQuery = '';

  function setExplorerType(t) {
    explorerType = t;
    if (explorerChips) {
      explorerChips.querySelectorAll('.explorer-chip').forEach(c => {
        c.classList.toggle('on', c.dataset.type === t);
      });
    }
    if (explorerLastQuery) runExplorerSearch(explorerLastQuery, true);
  }

  if (explorerChips) {
    explorerChips.addEventListener('click', (e) => {
      const t = e.target && e.target.dataset && e.target.dataset.type;
      if (t) setExplorerType(t);
    });
  }

  if (explorerInput) {
    explorerInput.addEventListener('input', () => {
      const q = explorerInput.value.trim();
      if (explorerDebounce) clearTimeout(explorerDebounce);
      if (!q) {
        explorerResults.innerHTML =
          '<div class="explorer-hint">' +
          'Type a query above. Results group by type — each result is an ' +
          'EntityCard you can drill into. <br><br>' +
          'Try <kbd>deploy</kbd>, <kbd>checkout</kbd>, or any peer/channel name.' +
          '</div>';
        return;
      }
      explorerDebounce = setTimeout(() => runExplorerSearch(q, false), 250);
    });
  }

  async function runExplorerSearch(q, force) {
    if (!force && q === explorerLastQuery && !window.__akashicForceRefresh) return;
    window.__akashicForceRefresh = false;
    explorerLastQuery = q;
    explorerResults.innerHTML = '<div class="ec-skeleton">searching' + (akashicSemanticMode ? ' (semantic)' : '') + '…</div>';

    if (akashicSemanticMode && q) {
      // Semantic search via /api/akashic/semantic-search
      try {
        const r = await fetch('/api/akashic/semantic-search?q=' + encodeURIComponent(q) + '&k=20', { cache: 'no-store' });
        if (!r.ok) throw new Error('http ' + r.status);
        const data = await r.json();
        const hits = applyAkashicFilters(data.hits || []);
        if (hits.length === 0) {
          explorerResults.innerHTML = '<div class="explorer-hint">no semantic matches for <kbd>' + esc(q) + '</kbd></div>';
          return;
        }
        explorerResults.innerHTML = '';
        const groupEl = document.createElement('div');
        groupEl.className = 'explorer-group';
        groupEl.innerHTML = '<div class="explorer-group-h">🔀 semantic · ' + hits.length + ' match' + (hits.length === 1 ? '' : 'es') + '</div>';
        const refsEl = document.createElement('div');
        for (const h of hits) {
          const card = window.__EntityCard.render({ type: 'episode', id: String(h.episodeId) }, { depth: 0 });
          // Score badge
          const sn = document.createElement('div');
          sn.className = 'explorer-snippet';
          sn.innerHTML = '<span style="color:var(--accent-2)">cosine ' + h.score.toFixed(2) + '</span> · ' + esc(h.userText.slice(0, 160));
          refsEl.appendChild(card);
          refsEl.appendChild(sn);
        }
        groupEl.appendChild(refsEl);
        explorerResults.appendChild(groupEl);
        return;
      } catch (err) {
        explorerResults.innerHTML = '<div class="ec-error">semantic search failed: ' + esc(String(err)) + '</div>';
        return;
      }
    }

    // Substring search (existing behavior, with filter post-processing)
    const types = explorerType === 'all' ? '' : '&types=' + encodeURIComponent(explorerType);
    let r;
    try {
      r = await fetch('/api/search?q=' + encodeURIComponent(q) + types, { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
    } catch (err) {
      explorerResults.innerHTML = '<div class="ec-error">search failed: ' + esc(String(err)) + '</div>';
      return;
    }
    let data;
    try { data = await r.json(); } catch { data = null; }
    if (!data || data.total === 0) {
      explorerResults.innerHTML =
        '<div class="explorer-hint">no results for <kbd>' + esc(q) + '</kbd>' +
        (explorerType !== 'all' ? ' in <kbd>' + esc(explorerType) + 's</kbd>' : '') +
        '</div>';
      return;
    }
    explorerResults.innerHTML = '';
    for (const group of data.groups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'explorer-group';
      groupEl.innerHTML =
        '<div class="explorer-group-h">' + esc(group.type) + 's · ' + group.hits.length + ' result' + (group.hits.length === 1 ? '' : 's') + '</div>';
      const refsEl = document.createElement('div');
      for (const hit of group.hits) {
        const card = window.__EntityCard.render(hit.ref, { depth: 0 });
        refsEl.appendChild(card);
        if (hit.snippet) {
          const sn = document.createElement('div');
          sn.className = 'explorer-snippet';
          sn.innerHTML = highlightSnippet(hit.snippet, q);
          refsEl.appendChild(sn);
        }
      }
      groupEl.appendChild(refsEl);
      explorerResults.appendChild(groupEl);
    }
  }

  // Apply date / verified filters to a list of {episodeId, createdAt, ...} hits.
  function applyAkashicFilters(hits) {
    const f = akashicFilters;
    const ranges = { '1d': 86400000, '7d': 7*86400000, '30d': 30*86400000, '90d': 90*86400000, '1y': 365*86400000 };
    const cutoff = ranges[f.date];
    const now = Date.now();
    return hits.filter(h => {
      if (cutoff && h.createdAt && (now - h.createdAt) > cutoff) return false;
      if (f.peer && h.peer && h.peer !== f.peer) return false;
      if (f.channel && h.channel !== f.channel) return false;
      // verified: would need extra data — skip for semantic results for now
      return true;
    });
  }

  function highlightSnippet(s, q) {
    const safe = esc(s);
    if (!q) return safe;
    const lcS = safe.toLowerCase();
    const lcQ = q.toLowerCase();
    const idx = lcS.indexOf(lcQ);
    if (idx < 0) return safe;
    return (
      safe.slice(0, idx) +
      '<mark>' + safe.slice(idx, idx + q.length) + '</mark>' +
      safe.slice(idx + q.length)
    );
  }

  // --- helpers ----------------------------------------------------------
  // ($ is hoisted to the top of the IIFE — see line right after the IIFE opens)
  function fmtTime(ms) {
    const d = new Date(ms);
    return d.toLocaleTimeString('en-GB', { hour12: false });
  }
  function fmtUptime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + (s % 60) + 's';
    return s + 's';
  }
  function fmtAge(ms) {
    const now = Date.now();
    const diff = Math.max(0, now - ms);
    if (diff < 60000) return Math.floor(diff/1000) + 's ago';
    if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
    return Math.floor(diff/86400000) + 'd ago';
  }
  function fmtFuture(ms) {
    const diff = ms - Date.now();
    if (diff < 0) return 'overdue';
    if (diff < 60000) return 'in ' + Math.floor(diff/1000) + 's';
    if (diff < 3600000) return 'in ' + Math.floor(diff/60000) + 'm';
    if (diff < 86400000) return 'in ' + Math.floor(diff/3600000) + 'h';
    return 'in ' + Math.floor(diff/86400000) + 'd';
  }
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function trunc(s, n) {
    if (!s) return '';
    s = String(s).replace(/\\s+/g, ' ').trim();
    return s.length <= n ? s : s.slice(0, n) + '…';
  }

  // --- snapshot polling --------------------------------------------------
  let lastStatus = null;
  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ': ' + r.status);
    return r.json();
  }
  async function pollStatus() {
    try {
      const [status, sessions, episodes, drafts, scheduled] = await Promise.all([
        fetchJson('/api/status'),
        fetchJson('/api/sessions'),
        fetchJson('/api/episodes/recent'),
        fetchJson('/api/drafts'),
        fetchJson('/api/scheduled'),
      ]);
      lastStatus = status;
      renderStatus(status);
      renderSessions(sessions, status.bridge.startedAt);
      renderEpisodes(episodes);
      renderDrafts(drafts);
      renderScheduled(scheduled);
    } catch (err) {
      console.error('snapshot poll failed', err);
    }
  }

  function renderStatus(s) {
    const layers = [
      ['L1', s.layers.l1_working,    s.layers.l1_working.label, ''],
      ['L2', s.layers.l2_identity,   s.layers.l2_identity.label, s.layers.l2_identity.stats ? (s.layers.l2_identity.stats.dialecticCalls + ' calls / ' + s.layers.l2_identity.stats.dialecticAvgLatencyMs + 'ms avg') : ''],
      ['L3', s.layers.l3_episodic,   s.layers.l3_episodic.label, s.layers.l3_episodic.episodes !== undefined ? (s.layers.l3_episodic.episodes + ' episodes') : ''],
      ['L4', s.layers.l4_procedural, s.layers.l4_procedural.label, ''],
      ['L5', s.layers.l5_reflection, s.layers.l5_reflection.label, s.layers.l5_reflection.idleMin ? ('idle ' + s.layers.l5_reflection.idleMin + 'm') : ''],
    ];
    $('layers').innerHTML = layers.map(([lvl, layer, label, extra]) =>
      '<div class="layer-row">' +
        '<span class="dot ' + (layer.online ? 'on' : 'off') + '"></span>' +
        '<span class="lvl">' + lvl + '</span>' +
        '<span class="lbl">' + esc(label) + '</span>' +
        '<span class="extra">' + esc(extra) + '</span>' +
      '</div>'
    ).join('');

    $('cost-today').textContent = '$' + s.today.reflectionCostUsd.toFixed(4);
    $('cost-cap').textContent   = '$' + s.today.capUsd.toFixed(2) + ' / UTC day';
    $('cost-bar').style.width   = s.today.capPct.toFixed(1) + '%';
    $('refl-count').textContent = s.today.reflectionCount;
    $('episodes-count').textContent = (s.layers.l3_episodic.episodes ?? 0).toLocaleString();
    $('uptime').textContent = 'up ' + fmtUptime(s.bridge.uptimeMs);
    $('version').textContent = 'v' + s.bridge.version;

    $('allowlist').innerHTML = (s.allowlist.userIds.length === 0)
      ? '<div class="empty">no users allowlisted</div>'
      : s.allowlist.userIds.map(u =>
          '<div class="layer-row"><span class="dot on"></span><span class="lbl mono" style="font-family:var(--mono);font-size:12px">' + esc(u) + '</span></div>'
        ).join('');
  }

  function renderSessions(s) {
    const r = (s.recent || []).slice(0, LIVE_HEADS_UP_LIMIT);
    const total = (s.recent || []).length;
    const cnt = $('sessions-count');
    if (cnt) cnt.textContent = '(' + r.length + ' of ' + total + ')';
    const refs = r.map(sess => ({ type: 'session', id: sess.threadKey }));
    if (window.__EntityCard) {
      window.__EntityCard.mountList(
        $('sessions-cards'),
        refs,
        'no recent sessions yet — DM the bot to wake it up',
      );
    }
  }

  // Cap the live console heads-up panel. The full archive lives in
  // Akashic Records — this panel is for situational awareness, not
  // exhaustive browsing. 12 fits one screen at typical card heights.
  const LIVE_HEADS_UP_LIMIT = 12;

  function renderEpisodes(e) {
    const eps = (e.episodes || []).slice(0, LIVE_HEADS_UP_LIMIT);
    const total = e.count != null ? e.count : (e.episodes || []).length;
    const cnt = $('recent-count');
    if (cnt) cnt.textContent = '(' + Math.min(eps.length, LIVE_HEADS_UP_LIMIT) + ' of ' + total + ')';
    const refs = eps.map(ep => ({ type: 'episode', id: String(ep.id) }));
    if (window.__EntityCard) {
      window.__EntityCard.mountList(
        $('recent-cards'),
        refs,
        'no episodes yet — DM the bot to start a session',
      );
    }
  }

  function renderDrafts(d) {
    const p = d.pending || [];
    const pendingOnly = p.filter(x => x.status === 'pending');
    $('drafts-count').textContent = '(' + pendingOnly.length + ' pending)';
    if (p.length === 0) {
      $('drafts').innerHTML = '<div class="empty">no skill drafts yet — proposed by reflection when patterns repeat</div>';
      return;
    }
    $('drafts').innerHTML = p.map(d => {
      const statusColor = d.status === 'pending' ? 'on' : 'off';
      const statusEmoji = d.status === 'pending' ? '⏳' : d.status === 'accepted' ? '✅' : d.status === 'rejected' ? '❌' : '⌛';
      return (
        '<div class="layer-row" style="padding:10px 0">' +
          '<span class="dot ' + statusColor + '"></span>' +
          '<div style="flex:1; min-width:0">' +
            '<div style="display:flex; gap:8px; align-items:baseline">' +
              '<span style="color:var(--skill); font-family:var(--mono); font-size:12.5px">' + esc(d.slug) + '</span>' +
              '<span class="pill">' + statusEmoji + ' ' + d.status + '</span>' +
            '</div>' +
            '<div class="dim" style="font-size:12px; margin-top:2px">' +
              esc(trunc(d.description, 100)) +
            '</div>' +
            '<div class="dim" style="font-family:var(--mono); font-size:11px; margin-top:2px">' +
              fmtAge(d.createdAt) + ' · proposed by ' + esc(d.proposedBy) +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderScheduled(s) {
    const p = s.pending || [];
    $('scheduled-count').textContent = '(' + p.length + ')';
    if (p.length === 0) {
      $('scheduled').innerHTML = '<div class="empty">no follow-ups queued</div>';
      return;
    }
    $('scheduled').innerHTML = p.map(r =>
      '<div class="layer-row" style="padding:10px 0">' +
        '<span class="dot on"></span>' +
        '<div style="flex:1; min-width:0">' +
          '<div style="display:flex; gap:8px; align-items:baseline">' +
            '<span style="color:var(--warn); font-family:var(--mono); font-size:12.5px">#' + r.id + '</span>' +
            '<span class="dim" style="font-size:12px">' + esc(r.reason || '—') + '</span>' +
            '<span class="pill">' + esc(r.status) + '</span>' +
          '</div>' +
          '<div class="dim" style="font-family:var(--mono); font-size:11px; margin-top:2px">' +
            fmtFuture(r.runAt) + ' · ' + esc(r.peerId) + ' · src=' + esc(r.source || '—') +
          '</div>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  // --- live event stream -------------------------------------------------
  const eventsEl = $('events');
  const MAX_EVENTS_VISIBLE = 200;
  let pendingFadeIn = true;

  function eventClass(kind) {
    if (kind.startsWith('message')) return 'msg';
    if (kind.startsWith('spawn'))   return 'spawn';
    if (kind.startsWith('honcho'))  return 'honcho';
    if (kind.startsWith('episode')) return 'episode';
    if (kind.startsWith('reflection')) return 'refl';
    if (kind.startsWith('skill'))   return 'skill';
    if (kind.startsWith('schedule')) return 'sched';
    if (kind.startsWith('reaction')) return 'react';
    return '';
  }
  function eventSummary(e) {
    switch (e.kind) {
      case 'message.received':
        return esc(e.peerName || e.peer) + ' in ' + esc(e.channelName || e.channel) +
          (e.isResume ? ' [resume]' : ' [new]') + ' · "' + esc(trunc(e.preview, 80)) + '"';
      case 'spawn.start':
        return esc(e.threadKey.split(':')[0]) + ' · ' + (e.isResume ? 'resume' : 'fresh');
      case 'spawn.exit':
        return 'exit=' + e.exitCode + ' · ' + e.numTurns + ' turn(s) · $' + e.costUsd.toFixed(4) +
          ' · ' + (e.durationMs/1000).toFixed(1) + 's';
      case 'honcho.dialectic':
        return esc(e.peer) + ' · ' + e.latencyMs + 'ms · ' + (e.hadResponse ? 'hit' : 'no signal');
      case 'honcho.ingest':
        return esc(e.peer) + ' → ' + esc(e.threadKey.split(':')[0]);
      case 'episode.write':
        return '#' + e.episodeId + ' · ' + esc(e.peer) + ' · ' + esc(trunc(e.userPreview, 60));
      case 'reflection.start':
        return esc(e.threadKey.split(':')[0]) + ' · ' + e.episodeCount + ' episodes';
      case 'reflection.complete':
        return (e.outcome || '?') + ' · $' + e.costUsd.toFixed(4) +
          ' · notes ' + e.notesAppended +
          (e.skillProposed ? ' · 🛠 skill proposed' : '') +
          (e.personaObservations ? ' · 💭 ' + e.personaObservations + ' persona obs' : '') +
          (e.honchoUpdates ? ' · 🧠 ' + e.honchoUpdates + ' honcho' : '');
      case 'skill.proposed':
        return '#' + e.draftId + ' ' + esc(e.slug) + (e.description ? ' · ' + esc(trunc(e.description, 60)) : '');
      case 'skill.decided':
        return '#' + e.draftId + ' ' + esc(e.slug) + ' → ' + e.status +
          (e.sha ? ' · ' + e.sha.slice(0,7) : '') +
          (e.decidedBy ? ' by ' + esc(e.decidedBy) : '');
      case 'schedule.created':
        return '#' + e.id + ' ' + esc(e.reason) + ' · ' + fmtFuture(e.runAt);
      case 'schedule.fired':
        return '#' + e.id + ' ' + esc(e.reason) + ' · firing';
      case 'reaction.received':
        return ':' + e.reaction + ': by ' + esc(e.peer) + ' · ' + e.verb +
          (e.episodeId ? ' · ep#' + e.episodeId : '') +
          (e.draftId ? ' · draft#' + e.draftId : '');
      default:
        return JSON.stringify(e).slice(0, 120);
    }
  }
  function appendEvent(e, animate) {
    const row = document.createElement('div');
    row.className = 'row' + (animate ? ' fade-in' : '');
    row.innerHTML =
      '<span class="t">' + fmtTime(e.ts) + '</span>' +
      '<span class="k ' + eventClass(e.kind) + '">' + esc(e.kind) + '</span>' +
      '<span class="v">' + eventSummary(e) + '</span>';
    eventsEl.insertBefore(row, eventsEl.firstChild);
    while (eventsEl.children.length > MAX_EVENTS_VISIBLE) {
      eventsEl.removeChild(eventsEl.lastChild);
    }
  }

  // ---- live flow renderer (data-driven SVG) ----------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Node definitions — id → layout + label.
  // Lanes: ext (left, x≈40-220), bridge (mid, x≈340-720), local (right, x≈800-980),
  //        edge surface (far right, x≈1080-1240).
  // ── The Tree of Life — Sefirot mapping ──────────────────────────
  // 10 sefirot in classic 3-pillar Kabbalistic arrangement, each
  // anchoring a real Thoth subsystem. 22 paths between them carry
  // Hebrew letters and represent real event flows. Operators learn
  // anatomy + lore simultaneously.
  //
  // Pillars:
  //   LEFT  (Severity):  Isis → Sekhmet → Hu
  //   RIGHT (Mercy):     Sia → Hapy → Khepri
  //   MIDDLE (Mildness): Ra → Horus → Tatenen → Geb
  const NODES = {
    keter:    { x: 650, y:  80, w: 160, h: 70, kind: 'sf', label: 'Ra',       sub: 'Thoth',          hebrew: '𓇳',  meaning: 'The Sun · the bot identity, source of all light' },
    chokmah:  { x:1000, y: 200, w: 160, h: 70, kind: 'sf', label: 'Sia',      sub: 'Episodic',      hebrew: '𓊨',  meaning: 'Perception · cosine recall + embeddings' },
    binah:    { x: 300, y: 200, w: 160, h: 70, kind: 'sf', label: 'Isis',     sub: 'Honcho',        hebrew: '𓊨',  meaning: 'Knower of Names · theory-of-mind user-model' },
    chesed:   { x:1000, y: 380, w: 160, h: 70, kind: 'sf', label: 'Hapy',     sub: 'Reflection',    hebrew: '𓎛',  meaning: 'The Flood · what-worked notes, future-self gifts' },
    geburah:  { x: 300, y: 380, w: 160, h: 70, kind: 'sf', label: 'Sekhmet',  sub: 'Hard rules',    hebrew: '𓃬',  meaning: 'The Lioness · refusal logic, daily caps' },
    tiferet:  { x: 650, y: 380, w: 160, h: 70, kind: 'sf', label: 'Horus',    sub: 'The Council',   hebrew: '𓅃',  meaning: 'The Falcon · party mode, Maat’s synthesis' },
    netzach:  { x:1000, y: 560, w: 160, h: 70, kind: 'sf', label: 'Khepri',   sub: 'Skills',        hebrew: '𓆣',  meaning: 'The Becoming · earned + crystallized procedures' },
    hod:      { x: 300, y: 560, w: 160, h: 70, kind: 'sf', label: 'Hu',       sub: 'Slack handler', hebrew: '𓀞',  meaning: 'Authoritative Speech · stream, render, identity' },
    yesod:    { x: 650, y: 560, w: 160, h: 70, kind: 'sf', label: 'Tatenen',  sub: 'Persona stack', hebrew: '𓊽',  meaning: 'The Primordial Mound · the system prompt itself' },
    malkuth:  { x: 650, y: 720, w: 160, h: 70, kind: 'sf', label: 'Geb',      sub: 'The user',      hebrew: '𓅬',  meaning: 'The Earth · Slack workspace, manifestation' },
  };

  // The 22 paths of the Tree of Life. Each carries a Hebrew letter +
  // the Thoth event-kind it ferries. Some paths have no live event
  // mapping yet; they're drawn for tree completeness and lore.
  // Format: [from, to, hebrewLetter, transliteration, traditional meaning,
  //         carriesEventKindOrLabel]
  // Each path carries an Egyptian hieroglyph (replacing the previous
  // Hebrew letter) + a transliteration + a meaning grounded in the
  // hieroglyph's traditional sense.
  const PATHS = [
    ['keter','chokmah',  '𓇳','Ra',       'sun-disc · the origin of perception', 'spawn.start'],
    ['keter','binah',    '𓉐','Per',      'house · the seat of identity',        'honcho.ingest'],
    ['keter','tiferet',  '𓂻','Iw',       'walking legs · the journey down',     'spawn.exit'],
    ['chokmah','binah',  '𓉔','Heh',      'reed shelter · threshold of memory',  'episode.write'],
    ['chokmah','tiferet','𓂀','Wedjat',   'eye of Horus · revelation',           'episode.write'],
    ['chokmah','chesed', '𓍿','Tjet',     'rope · the bridge between',           null],
    ['binah','tiferet',  '𓌖','Khepesh',  'scimitar · discernment',              'honcho.dialectic'],
    ['binah','geburah',  '𓏞','Sesh',     'scribe-palette · boundary, order',    null],
    ['chesed','geburah', '𓆙','Hefau',    'cobra · coiled tension',              null],
    ['chesed','tiferet', '𓂝','Aa',       'forearm · the smallest spark',        'reflection.complete'],
    ['chesed','netzach', '𓂧',  'Djer',   'open palm · receiving',               'skill.proposed'],
    ['geburah','tiferet','𓌃','Sheser',   'arrow · the goad, the instruction',   'rule.refusal'],
    ['geburah','hod',    '𓈖','Nu',       'water · depth, severity-tempered',    null],
    ['tiferet','netzach','𓆟','Rem',      'fish · the movement',                 'party.complete'],
    ['tiferet','yesod',  '𓊽','Djed',     'pillar · support, scaffold',          'spawn.start'],
    ['tiferet','hod',    '𓁷','Hra',      'face · perception manifest',          'message.received'],
    ['netzach','hod',    '𓂋','Ra-mouth', 'mouth · the utterance',               'skill.decided'],
    ['netzach','yesod',  '𓋖','Tjet-knot','knot · pulling-down, anchoring',      'skill.decided'],
    ['netzach','malkuth','𓁶','Tep',      'head · mystery, what is hidden',      null],
    ['hod','yesod',      '𓁹','Iret',     'eye · the face that watches',         'reaction.received'],
    ['hod','malkuth',    '𓎢','Qau',      'wick · fire, the spark',              'message.received'],
    ['yesod','malkuth',  '𓋹','Ankh',     'life · the mark, the culmination',    'spawn.exit'],
  ];

  // EDGES — derived from PATHS, plus reverse pairs for bidirectional flows.
  const EDGES = (() => {
    const out = [];
    for (const [a, b] of PATHS) {
      out.push([a, b]);
      out.push([b, a]);
    }
    return out;
  })();

  // Quick-lookup: edge "a-b" → path metadata
  const PATH_META = (() => {
    const m = {};
    for (const p of PATHS) {
      const [a, b, letter, translit, meaning, carries] = p;
      m[a + '-' + b] = { letter, translit, meaning, carries };
      m[b + '-' + a] = { letter, translit, meaning, carries }; // mirrored for reverse pulses
    }
    return m;
  })();

  // Colors per event class.
  const COLOR = {
    msg:   '#5fc9ff',
    spawn: '#5fc9ff',
    honcho:'#b288ff',
    epi:   '#5dd39e',
    refl:  '#ffd166',
    skill: '#ffb86c',
    sched: '#ff8866',
    react: '#ff8db4',
    err:   '#ff6b8b',
  };

  // Map an event kind → list of sefirot-path segments to pulse + color.
  // Each event flows along the Tree of Life, transformed through the
  // sefirot it touches.
  function eventToPulses(e) {
    const k = e.kind;
    if (k === 'message.received') {
      // User → Slack handler → heart of the system
      return { color: COLOR.msg, edges: [['malkuth','hod'], ['hod','tiferet']] };
    }
    if (k === 'spawn.start') {
      // Foundation → heart → Crown (the prompt becomes Thoth's voice)
      return { color: COLOR.spawn, edges: [['yesod','tiferet'], ['tiferet','keter']] };
    }
    if (k === 'spawn.exit') {
      const errored = (e.exitCode ?? 0) !== 0;
      // Crown returns through heart, foundation, manifestation
      return { color: errored ? COLOR.err : COLOR.spawn,
               edges: [['keter','tiferet'], ['tiferet','yesod'], ['yesod','malkuth']],
               errorNodes: errored ? ['keter'] : [] };
    }
    if (k === 'honcho.dialectic') {
      const errored = !e.hadResponse;
      // Heart queries Understanding (theory-of-mind)
      return { color: errored ? COLOR.err : COLOR.honcho,
               edges: [['tiferet','binah'], ['binah','tiferet']] };
    }
    if (k === 'honcho.ingest') {
      // Crown → Understanding (the system feeds into who-the-user-is)
      return { color: COLOR.honcho, edges: [['keter','binah']] };
    }
    if (k === 'episode.write') {
      // Heart → Wisdom (the moment gets recorded as memory)
      return { color: COLOR.epi, edges: [['tiferet','chokmah']] };
    }
    if (k === 'reflection.start') {
      // Heart calls Mercy (the future-self gift begins)
      return { color: COLOR.refl, edges: [['tiferet','chesed']] };
    }
    if (k === 'reflection.complete') {
      const edges = [['chesed','tiferet']]; // Mercy returns to the heart
      if (e.skillProposed) edges.push(['chesed','netzach']); // gives a victory to Skills
      if (e.honchoUpdates > 0) edges.push(['chesed','tiferet'], ['tiferet','binah']);
      return { color: COLOR.refl, edges };
    }
    if (k === 'skill.proposed') {
      // Mercy → Victory (a gift toward an earned procedure)
      return { color: COLOR.skill, edges: [['chesed','netzach']] };
    }
    if (k === 'skill.decided') {
      const accepted = e.status === 'accepted';
      // Victory → Foundation (anchored) / Splendor (announced)
      const edges = accepted
        ? [['netzach','yesod'], ['yesod','malkuth']]
        : [['netzach','hod']];
      const errored = e.status === 'rejected' || e.status === 'expired';
      return { color: errored ? COLOR.err : COLOR.skill, edges };
    }
    if (k === 'schedule.created') {
      // Mercy → heart (a future-self gift scheduled)
      return { color: COLOR.sched, edges: [['chesed','tiferet']] };
    }
    if (k === 'schedule.fired') {
      // Heart → Manifestation (the scheduled spawn arrives)
      return { color: COLOR.sched, edges: [['tiferet','yesod'], ['yesod','malkuth']] };
    }
    if (k === 'reaction.received') {
      // User → Splendor (always); then to the affected sefira
      const edges = [['malkuth','hod']];
      switch (e.verb) {
        case 'verify-success':
        case 'verify-failure':
        case 'forget':
          edges.push(['hod','tiferet'], ['tiferet','chokmah']); break;
        case 'remember':
          edges.push(['hod','tiferet'], ['tiferet','keter']); break;
        case 'feedback':
          edges.push(['hod','tiferet'], ['tiferet','binah']); break;
        case 'skill-accept':
          edges.push(['hod','netzach'], ['netzach','yesod']); break;
        case 'skill-reject':
          edges.push(['hod','netzach']); break;
      }
      return { color: COLOR.react, edges };
    }
    if (k && k.indexOf('party.') === 0) {
      // The Council convenes at Horus (the falcon, the harmonizer)
      const edges = [['yesod','tiferet']];
      if (k === 'party.complete') edges.push(['tiferet','netzach']);
      return { color: COLOR.party || '#a78bfa', edges };
    }
    if (k && k.indexOf('anthropic.status.') === 0) {
      // External weather flows through Crown
      return { color: '#fbbf24', edges: [['keter','tiferet']] };
    }
    return null;
  }

  // ---- SVG rendering ----------------------------------------------------
  const flowEdgesG = $('fl-edges');
  const flowNodesG = $('fl-nodes');
  const flowPulsesG = $('fl-pulses');
  const edgePathById = new Map();
  const nodeGById = new Map();

  function edgeKey(a, b) { return a + '→' + b; }
  function buildPath(from, to) {
    const a = NODES[from], b = NODES[to];
    if (!a || !b) return null;
    // Connect right edge of A to left edge of B (most common case),
    // or bottom→top / top→bottom if the lanes overlap horizontally.
    const ax = a.x + a.w, ay = a.y + a.h / 2;
    const bx = b.x,        by = b.y + b.h / 2;
    // If the source is horizontally to the right of target, route from left edge of A to right edge of B.
    let fx = ax, fy = ay, tx = bx, ty = by;
    if (b.x + b.w <= a.x) {
      fx = a.x;       fy = a.y + a.h / 2;
      tx = b.x + b.w; ty = b.y + b.h / 2;
    }
    // Same lane → vertical curve.
    const sameLane = Math.abs((a.x + a.w/2) - (b.x + b.w/2)) < 60;
    if (sameLane) {
      fx = a.x + a.w/2; fy = a.y + a.h;
      tx = b.x + b.w/2; ty = b.y;
      if (b.y < a.y) { fy = a.y; ty = b.y + b.h; }
      const midY = (fy + ty) / 2;
      return 'M ' + fx + ' ' + fy + ' C ' + fx + ' ' + midY + ' ' + tx + ' ' + midY + ' ' + tx + ' ' + ty;
    }
    const midX = (fx + tx) / 2;
    return 'M ' + fx + ' ' + fy + ' C ' + midX + ' ' + fy + ' ' + midX + ' ' + ty + ' ' + tx + ' ' + ty;
  }

  function renderFlow() {
    if (flowEdgesG.children.length > 0) return; // already rendered
    const lettersG = $('fl-paths-letters');
    const trunkG = $('fl-trunk');
    // edges first (so nodes draw on top). Only draw the FORWARD edge per
    // path so the Hebrew-letter label sits cleanly without overlap.
    for (const p of PATHS) {
      const [from, to] = p;
      // Render BOTH directions but layer them under one shared label
      [[from, to], [to, from]].forEach(([a, b]) => {
        const d = buildPath(a, b);
        if (!d) return;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', 'fl-edge');
        path.setAttribute('id', 'fl-' + a + '-' + b);
        path.setAttribute('marker-end', 'url(#fl-arrow)');
        flowEdgesG.appendChild(path);
        edgePathById.set(edgeKey(a, b), path);
      });
      // Hebrew letter label at midpoint of the from→to path
      const A = NODES[from], B = NODES[to];
      if (A && B && lettersG) {
        const midX = ((A.x + A.w / 2) + (B.x + B.w / 2)) / 2;
        const midY = ((A.y + A.h / 2) + (B.y + B.h / 2)) / 2;
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'fl-letter');
        g.setAttribute('transform', 'translate(' + midX + ',' + midY + ')');
        // Hebrew letter halo
        const halo = document.createElementNS(SVG_NS, 'circle');
        halo.setAttribute('r', 14);
        halo.setAttribute('class', 'fl-letter-halo');
        g.appendChild(halo);
        // Letter glyph
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('class', 'fl-letter-glyph');
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('y', '5');
        t.textContent = p[2]; // hebrew letter
        g.appendChild(t);
        // Hover tooltip
        const carries = p[5];
        const _NL = String.fromCharCode(10);
        const tooltipText =
          p[2] + ' · ' + p[3] + '  —  ' + p[4] +
          (carries ? _NL + _NL + 'Carries: ' + carries : '');
        g.addEventListener('mouseenter', (ev) => showFlowTip(ev, tooltipText));
        g.addEventListener('mouseleave', hideFlowTip);
        lettersG.appendChild(g);
      }
    }
    // sefirot nodes
    for (const [id, n] of Object.entries(NODES)) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'fl-node kind-' + n.kind);
      g.setAttribute('id', 'fl-node-' + id);
      g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('width', n.w);
      rect.setAttribute('height', n.h);
      rect.setAttribute('rx', '12');
      g.appendChild(rect);
      // Hebrew name above English label
      if (n.hebrew) {
        const tHeb = document.createElementNS(SVG_NS, 'text');
        tHeb.setAttribute('x', n.w / 2);
        tHeb.setAttribute('y', 18);
        tHeb.setAttribute('text-anchor', 'middle');
        tHeb.setAttribute('class', 'sefira-hebrew');
        tHeb.textContent = n.hebrew;
        g.appendChild(tHeb);
      }
      const t1 = document.createElementNS(SVG_NS, 'text');
      t1.setAttribute('x', n.w / 2);
      t1.setAttribute('y', n.h / 2 + 4);
      t1.setAttribute('text-anchor', 'middle');
      t1.setAttribute('class', 'sefira-label');
      t1.textContent = n.label;
      g.appendChild(t1);
      if (n.sub) {
        const t2 = document.createElementNS(SVG_NS, 'text');
        t2.setAttribute('x', n.w / 2);
        t2.setAttribute('y', n.h - 12);
        t2.setAttribute('text-anchor', 'middle');
        t2.setAttribute('class', 'sub');
        t2.textContent = n.sub;
        g.appendChild(t2);
      }
      // Tooltip on hover for sefirot
      if (n.hebrew) {
        const _NL2 = String.fromCharCode(10);
        const tip = n.hebrew + ' · ' + n.label + _NL2 + n.meaning;
        g.addEventListener('mouseenter', (ev) => showFlowTip(ev, tip));
        g.addEventListener('mouseleave', hideFlowTip);
      }
      // Click → zoom into sub-flow if defined; else open inspector (Phase 3)
      if (SUBFLOWS[id]) {
        g.addEventListener('click', () => zoomIntoSubflow(id));
      } else {
        g.addEventListener('click', () => openSefiraInspector(id));
      }
      flowNodesG.appendChild(g);
      nodeGById.set(id, g);
    }
    // Persona stack as the trunk — small horizontal stripes just below Yesod.
    if (trunkG) {
      const yesod = NODES.yesod;
      const tx = yesod.x;
      const ty = yesod.y + yesod.h + 6;
      const stripeWidth = yesod.w;
      const stripeHeight = 4;
      const layers = [
        { name: 'IDENTITY', color: '#ffd166' },
        { name: 'SOUL',     color: '#ef4444' },
        { name: 'RULES',    color: '#f97316' },
        { name: 'AGENTS',   color: '#3b82f6' },
        { name: 'USER',     color: '#10b981' },
        { name: 'MEMORY',   color: '#a855f7' },
        { name: 'AETHER',   color: '#06b6d4' },
      ];
      const trunkRect = document.createElementNS(SVG_NS, 'g');
      trunkRect.setAttribute('class', 'fl-trunk');
      trunkRect.setAttribute('transform', 'translate(' + tx + ',' + ty + ')');
      layers.forEach((l, i) => {
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', '0');
        r.setAttribute('y', String(i * (stripeHeight + 1)));
        r.setAttribute('width', String(stripeWidth));
        r.setAttribute('height', String(stripeHeight));
        r.setAttribute('rx', '1');
        r.setAttribute('fill', l.color);
        r.setAttribute('opacity', '0.55');
        trunkRect.appendChild(r);
      });
      const tipText = 'Persona stack — 7 layers feeding into every spawn';
      trunkRect.addEventListener('mouseenter', (ev) => showFlowTip(ev, tipText));
      trunkRect.addEventListener('mouseleave', hideFlowTip);
      trunkG.appendChild(trunkRect);
    }
  }

  // ── Tooltip helpers (paths + sefirot) ─────────────────────────
  function showFlowTip(ev, text) {
    const tip = $('flow-tooltip');
    if (!tip) return;
    tip.textContent = text;
    const rect = tip.getBoundingClientRect();
    const wrapRect = ev.currentTarget.ownerSVGElement?.getBoundingClientRect?.() || { left: 0, top: 0 };
    tip.hidden = false;
    tip.style.left = (ev.clientX - wrapRect.left + 12) + 'px';
    tip.style.top  = (ev.clientY - wrapRect.top + 12) + 'px';
  }
  function hideFlowTip() {
    const tip = $('flow-tooltip');
    if (tip) tip.hidden = true;
  }

  // Phase 3 inspector — defined later; for now noop fallback so renderFlow
  // can wire the click handler at boot without ordering dependence.
  function openSefiraInspector(id) {
    if (typeof window.__openSefiraInspector === 'function') {
      window.__openSefiraInspector(id);
    }
  }

  // ── nested live-flow: per-node sub-flow definitions ─────────────────
  const SUBFLOWS = {
    keter: {
      title: 'Ra · Thoth — claude CLI subprocess internal stream',
      nodes: {
        ccli_init:    { x:  60, y: 200, w: 200, h: 56, kind: 'br',  label: 'spawn(-p, env)',          sub: 'system:init event' },
        ccli_persona: { x: 320, y: 110, w: 200, h: 50, kind: 'lc',  label: 'reads persona stack',     sub: '34 KB system prompt' },
        ccli_tool:    { x: 320, y: 200, w: 200, h: 56, kind: 'br',  label: 'tool calls',              sub: 'Read · Glob · Grep · Edit · Bash' },
        ccli_assistant: { x: 580, y: 200, w: 200, h: 56, kind: 'br', label: 'assistant text',         sub: 'stream_event deltas' },
        ccli_result:  { x: 840, y: 200, w: 200, h: 56, kind: 'br',  label: 'result envelope',         sub: 'cost · turns · sid' },
        ccli_anthropic: { x: 1080, y: 200, w: 180, h: 56, kind: 'ext', label: 'Anthropic',            sub: 'Max OAuth' },
      },
      edges: [
        ['ccli_init','ccli_persona'], ['ccli_init','ccli_tool'],
        ['ccli_tool','ccli_assistant'], ['ccli_assistant','ccli_result'],
        ['ccli_assistant','ccli_anthropic'], ['ccli_anthropic','ccli_assistant'],
      ],
    },
    chokmah: {
      title: 'Sia · Perception — EpisodicStore embed + cosine recall',
      nodes: {
        ep_in:       { x:  60, y: 200, w: 200, h: 56, kind: 'br',  label: 'turn input',         sub: 'user_text + apex_summary' },
        ep_truncate: { x: 320, y: 120, w: 200, h: 50, kind: 'br',  label: 'truncate / summarize', sub: '~600 char ceiling' },
        ep_embed:    { x: 320, y: 240, w: 200, h: 56, kind: 'br',  label: 'embed (ONNX)',        sub: 'all-MiniLM-L6-v2 · 384d' },
        ep_blob:     { x: 580, y: 200, w: 200, h: 56, kind: 'lc',  label: 'Float32 BLOB',        sub: 'SQLite episodes table' },
        ep_recall:   { x: 840, y: 120, w: 200, h: 50, kind: 'br',  label: 'cosine recall',       sub: 'top-K candidate window' },
        ep_decay:    { x: 840, y: 240, w: 200, h: 50, kind: 'br',  label: 'recency decay',       sub: 'τ=14 days exp' },
        ep_block:    { x: 1080, y: 200, w: 180, h: 56, kind: 'br', label: '<related-episodes>', sub: 'XML block to prompt' },
      },
      edges: [
        ['ep_in','ep_truncate'], ['ep_in','ep_embed'],
        ['ep_truncate','ep_blob'], ['ep_embed','ep_blob'],
        ['ep_blob','ep_recall'], ['ep_recall','ep_decay'],
        ['ep_decay','ep_block'],
      ],
    },
    binah: {
      title: 'Isis · Knower of Names — HonchoClient dialectic + ingest',
      nodes: {
        hc_in:        { x:  60, y: 200, w: 200, h: 56, kind: 'br',  label: 'turn',          sub: 'pre-spawn enrichment' },
        hc_skip:      { x: 320, y: 120, w: 200, h: 50, kind: 'br',  label: 'skip rules',    sub: 'resume · short msg · cooldown' },
        hc_dialectic: { x: 320, y: 240, w: 200, h: 56, kind: 'br',  label: 'dialectic',     sub: '/peers/{id}/chat · 1.5s timeout' },
        hc_cloud:     { x: 580, y: 200, w: 200, h: 56, kind: 'ext', label: 'Honcho cloud',  sub: 'Deriver + Dreamer' },
        hc_block:     { x: 840, y: 120, w: 200, h: 50, kind: 'br',  label: '<user-model>',  sub: 'block injected' },
        hc_ingest:    { x: 840, y: 240, w: 200, h: 50, kind: 'br',  label: 'ingest (async)', sub: 'fire-and-forget' },
      },
      edges: [
        ['hc_in','hc_skip'], ['hc_in','hc_dialectic'],
        ['hc_dialectic','hc_cloud'], ['hc_cloud','hc_dialectic'],
        ['hc_dialectic','hc_block'],
        ['hc_in','hc_ingest'], ['hc_ingest','hc_cloud'],
      ],
    },
    chesed: {
      title: 'Hapy · The Flood — reflection orchestrator fan-out',
      nodes: {
        rf_trigger: { x:  60, y: 200, w: 200, h: 56, kind: 'br',  label: '/done OR idle 30m', sub: 'trigger' },
        rf_runner:  { x: 320, y: 200, w: 200, h: 56, kind: 'br',  label: 'spawn claude -p',   sub: '--effort low · $0.50 cap' },
        rf_parse:   { x: 580, y: 200, w: 200, h: 56, kind: 'br',  label: 'zod parse',         sub: 'strict JSON + recover' },
        rf_mem:     { x: 840, y:  80, w: 200, h: 50, kind: 'lc',  label: 'MEMORY.md append',  sub: 'memory_notes writer' },
        rf_skill:   { x: 840, y: 160, w: 200, h: 50, kind: 'lc',  label: 'skill draft',       sub: 'skill writer · Slack DM' },
        rf_persona: { x: 840, y: 240, w: 200, h: 50, kind: 'br',  label: 'persona DM',        sub: 'NEVER auto-apply' },
        rf_honcho:  { x: 840, y: 320, w: 200, h: 50, kind: 'br',  label: 'honcho updates',    sub: 'user_model_updates' },
        rf_sched:   { x: 840, y: 400, w: 200, h: 50, kind: 'br',  label: 'schedule run',      sub: 'next_check_at' },
      },
      edges: [
        ['rf_trigger','rf_runner'], ['rf_runner','rf_parse'],
        ['rf_parse','rf_mem'], ['rf_parse','rf_skill'],
        ['rf_parse','rf_persona'], ['rf_parse','rf_honcho'],
        ['rf_parse','rf_sched'],
      ],
    },
    hod: {
      title: 'Hu · Authoritative Speech — Slack handler magic command dispatch',
      nodes: {
        h_event:    { x:  60, y: 200, w: 200, h: 56, kind: 'br',  label: 'incoming event',     sub: 'message.im / app_mention' },
        h_allow:    { x: 320, y: 120, w: 200, h: 50, kind: 'br',  label: 'allowlist gate',      sub: '⛔ silent drop' },
        h_magic:    { x: 320, y: 240, w: 200, h: 56, kind: 'br',  label: 'magic command?',     sub: '/help /party /done /recall …' },
        h_resolve:  { x: 580, y: 120, w: 200, h: 50, kind: 'br',  label: 'identity resolve',    sub: 'users.info · cached' },
        h_recall:   { x: 580, y: 200, w: 200, h: 56, kind: 'br',  label: 'recall block build', sub: '<user-model> + <related>' },
        h_spawn:    { x: 580, y: 280, w: 200, h: 50, kind: 'br',  label: 'spawn claude -p',     sub: 'wrappedPrompt' },
        h_stream:   { x: 840, y: 200, w: 200, h: 56, kind: 'br',  label: 'chat.update stream',  sub: '~1s throttle' },
      },
      edges: [
        ['h_event','h_allow'], ['h_event','h_magic'],
        ['h_event','h_resolve'], ['h_resolve','h_recall'],
        ['h_recall','h_spawn'], ['h_spawn','h_stream'],
      ],
    },
  };

  let zoomedNode = null; // 'claude_cli' | null
  function zoomIntoSubflow(nodeId) {
    const sf = SUBFLOWS[nodeId];
    if (!sf) return;
    zoomedNode = nodeId;
    // Hide overview, render sub-flow.
    flowNodesG.innerHTML = '';
    flowEdgesG.innerHTML = '';
    flowPulsesG.innerHTML = '';
    edgePathById.clear();
    nodeGById.clear();
    // Inject sub-flow nodes with the SAME render code path.
    for (const [from, to] of sf.edges) {
      const a = sf.nodes[from], b = sf.nodes[to];
      if (!a || !b) continue;
      const d = buildPathInline(a, b);
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'fl-edge');
      path.setAttribute('id', 'fl-' + from + '-' + to);
      path.setAttribute('marker-end', 'url(#fl-arrow)');
      flowEdgesG.appendChild(path);
      edgePathById.set(edgeKey(from, to), path);
    }
    for (const [id, n] of Object.entries(sf.nodes)) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'fl-node fl-subnode kind-' + n.kind);
      g.setAttribute('id', 'fl-node-' + id);
      g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('width', n.w);
      rect.setAttribute('height', n.h);
      g.appendChild(rect);
      const t1 = document.createElementNS(SVG_NS, 'text');
      t1.setAttribute('x', n.w/2);
      t1.setAttribute('y', n.sub ? n.h/2 - 2 : n.h/2 + 4);
      t1.setAttribute('text-anchor', 'middle');
      t1.textContent = n.label;
      g.appendChild(t1);
      if (n.sub) {
        const t2 = document.createElementNS(SVG_NS, 'text');
        t2.setAttribute('x', n.w/2);
        t2.setAttribute('y', n.h/2 + 14);
        t2.setAttribute('text-anchor', 'middle');
        t2.setAttribute('class', 'sub');
        t2.textContent = n.sub;
        g.appendChild(t2);
      }
      flowNodesG.appendChild(g);
      nodeGById.set(id, g);
    }
    // Toggle UI chrome.
    const back = $('flow-back');
    const title = $('flow-title');
    if (back) back.hidden = false;
    if (title) title.textContent = '↳ ' + sf.title;
  }
  function buildPathInline(a, b) {
    const ax = a.x + a.w, ay = a.y + a.h / 2;
    const bx = b.x,        by = b.y + b.h / 2;
    const midX = (ax + bx) / 2;
    return 'M ' + ax + ' ' + ay + ' C ' + midX + ' ' + ay + ' ' + midX + ' ' + by + ' ' + bx + ' ' + by;
  }
  function zoomOut() {
    zoomedNode = null;
    flowNodesG.innerHTML = '';
    flowEdgesG.innerHTML = '';
    flowPulsesG.innerHTML = '';
    edgePathById.clear();
    nodeGById.clear();
    // Re-render the overview.
    renderFlow();
    const back = $('flow-back');
    const title = $('flow-title');
    if (back) back.hidden = true;
    if (title) title.textContent = '';
  }
  // Wire the back button.
  setTimeout(() => {
    const back = $('flow-back');
    if (back) back.addEventListener('click', zoomOut);
  }, 100);

  // ---- pulse animation --------------------------------------------------
  let pulseCount = 0;
  let warmCount = 0;
  const nodeWarmth = new Map(); // node id → last touched ms
  function touchNode(id) {
    nodeWarmth.set(id, Date.now());
    const g = nodeGById.get(id);
    if (g) {
      g.classList.add('hot');
      g.classList.remove('warm');
      clearTimeout(g.__warmDecay);
      g.__warmDecay = setTimeout(() => {
        g.classList.remove('hot');
        g.classList.add('warm');
        clearTimeout(g.__coolDecay);
        g.__coolDecay = setTimeout(() => g.classList.remove('warm'), 25_000);
      }, 4_000);
    }
  }
  function flagError(id) {
    const g = nodeGById.get(id);
    if (g) {
      g.classList.add('err');
      setTimeout(() => g.classList.remove('err'), 8_000);
    }
  }
  function pulseEdge(from, to, color, delayMs) {
    const path = edgePathById.get(edgeKey(from, to));
    if (!path) return;
    path.classList.add('warm');
    setTimeout(() => path.classList.remove('warm'), 1200);

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '4.5');
    dot.setAttribute('fill', color);
    dot.setAttribute('class', 'fl-pulse');
    // make filter use the color via currentColor
    dot.style.color = color;

    const anim = document.createElementNS(SVG_NS, 'animateMotion');
    anim.setAttribute('dur', '0.8s');
    anim.setAttribute('begin', (delayMs / 1000) + 's');
    anim.setAttribute('fill', 'remove');
    anim.setAttribute('rotate', 'auto');
    const mp = document.createElementNS(SVG_NS, 'mpath');
    mp.setAttribute('href', '#fl-' + from + '-' + to);
    anim.appendChild(mp);
    dot.appendChild(anim);

    flowPulsesG.appendChild(dot);
    pulseCount++;

    // Touch endpoints when the pulse arrives.
    setTimeout(() => touchNode(from), delayMs);
    setTimeout(() => touchNode(to), delayMs + 800);
    setTimeout(() => dot.remove(), delayMs + 850);
  }

  function applyEvent(e) {
    const m = eventToPulses(e);
    if (!m) return;
    let stagger = 0;
    for (const [from, to] of m.edges) {
      pulseEdge(from, to, m.color, stagger);
      stagger += 80;
    }
    if (m.errorNodes) m.errorNodes.forEach(flagError);
  }

  // ── Phase 2.3: photosynthesis — golden motes drift down from Keter ──
  function emitPhotosynthesisMote() {
    const keter = NODES.keter;
    if (!keter || !flowPulsesG) return;
    const startX = keter.x + keter.w / 2 + (Math.random() - 0.5) * keter.w * 0.6;
    const startY = keter.y + keter.h;
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(startX));
    dot.setAttribute('cy', String(startY));
    dot.setAttribute('r', '1.5');
    dot.setAttribute('fill', '#fbbf24');
    dot.setAttribute('opacity', '0.55');
    dot.setAttribute('class', 'fl-mote');
    flowPulsesG.appendChild(dot);
    const animY = document.createElementNS(SVG_NS, 'animate');
    animY.setAttribute('attributeName', 'cy');
    animY.setAttribute('from', String(startY));
    animY.setAttribute('to', String(startY + 600));
    animY.setAttribute('dur', '8s');
    animY.setAttribute('fill', 'remove');
    dot.appendChild(animY);
    const animO = document.createElementNS(SVG_NS, 'animate');
    animO.setAttribute('attributeName', 'opacity');
    animO.setAttribute('values', '0.55;0.55;0');
    animO.setAttribute('dur', '8s');
    animO.setAttribute('fill', 'remove');
    dot.appendChild(animO);
    setTimeout(() => { try { dot.remove(); } catch {} }, 8200);
  }
  setInterval(() => {
    if (location.hash !== '#flow') return;
    if (flowMode !== 'live') return;
    if (Math.random() < 0.7) emitPhotosynthesisMote();
  }, 1200);

  // ── Phase 2.2: health rings — green/yellow/red around each sefira ──
  // Recompute every 60s from /api/events/aggregate?window=1h
  async function refreshHealthRings() {
    if (location.hash !== '#flow') return;
    try {
      const r = await fetch('/api/events/aggregate?window=1h', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const events = data.events || [];
      // Count error vs total per sefira via eventToPulses error flag.
      const totals = new Map();
      const errors = new Map();
      for (const ev of events) {
        const m = eventToPulses(ev);
        if (!m) continue;
        for (const [from, to] of m.edges) {
          totals.set(from, (totals.get(from) || 0) + 1);
          totals.set(to,   (totals.get(to)   || 0) + 1);
          if (m.errorNodes && m.errorNodes.includes(from)) errors.set(from, (errors.get(from) || 0) + 1);
          if (m.errorNodes && m.errorNodes.includes(to))   errors.set(to,   (errors.get(to)   || 0) + 1);
        }
      }
      // Apply ring class to each sefira node
      Object.keys(NODES).forEach((id) => {
        const g = nodeGById.get(id);
        if (!g) return;
        g.classList.remove('health-good', 'health-warn', 'health-bad', 'health-cold');
        const t = totals.get(id) || 0;
        const e = errors.get(id) || 0;
        if (t === 0) { g.classList.add('health-cold'); return; }
        const rate = e / t;
        if (rate < 0.01) g.classList.add('health-good');
        else if (rate < 0.05) g.classList.add('health-warn');
        else g.classList.add('health-bad');
      });
    } catch {}
  }
  setInterval(refreshHealthRings, 60_000);
  // First refresh after the flow tab is rendered
  setTimeout(() => refreshHealthRings(), 4_000);

  // ── fractal-time slider ──────────────────────────────────────────
  // 'live' = real-time pulse animation; '1h'/'1d'/'1w' = heatmap of
  // event counts per edge over the requested window. Switching back
  // to 'live' clears the heatmap and resumes pulsing.
  let flowMode = 'live';
  const heatLabels = []; // SVG <text> nodes added by the heat renderer

  function clearHeat() {
    edgePathById.forEach((p) => {
      p.classList.remove('heat');
      p.removeAttribute('stroke-width');
      p.removeAttribute('stroke');
    });
    while (heatLabels.length) {
      const el = heatLabels.pop();
      try { el.remove(); } catch {}
    }
  }

  function paintHeat(events) {
    clearHeat();
    if (!flowEdgesG || edgePathById.size === 0) return;
    // Bucket events by edge using the same kind→edges map as live pulses.
    const counts = new Map(); // edgeKey -> count
    let total = 0;
    for (const ev of events) {
      const m = eventToPulses(ev);
      if (!m) continue;
      total++;
      for (const [from, to] of m.edges) {
        const k = edgeKey(from, to);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    if (counts.size === 0) return;
    let max = 0;
    for (const v of counts.values()) if (v > max) max = v;
    counts.forEach((count, k) => {
      const path = edgePathById.get(k);
      if (!path) return;
      const intensity = Math.log2(1 + count) / Math.log2(1 + max); // 0..1
      const width = (1.5 + intensity * 6).toFixed(2);
      // Color ramp: warm orange → bright orange. Subtle but legible.
      const r = 220, g = Math.round(150 + (1 - intensity) * 60), b = Math.round(80 + (1 - intensity) * 40);
      path.classList.add('heat');
      path.setAttribute('stroke', 'rgb(' + r + ',' + g + ',' + b + ')');
      path.setAttribute('stroke-width', width);
      // Drop a count label at the path midpoint.
      try {
        const total = path.getTotalLength();
        if (total > 0) {
          const mid = path.getPointAtLength(total / 2);
          const label = document.createElementNS(SVG_NS, 'text');
          label.setAttribute('class', 'fl-heat-label');
          label.setAttribute('x', mid.x);
          label.setAttribute('y', mid.y - 6);
          label.setAttribute('text-anchor', 'middle');
          label.textContent = String(count);
          flowEdgesG.appendChild(label);
          heatLabels.push(label);
        }
      } catch {}
    });
    return total;
  }

  async function loadAggregate(window) {
    const summary = $('flow-time-summary');
    if (summary) summary.textContent = 'loading ' + window + '…';
    try {
      const r = await fetch('/api/events/aggregate?window=' + window, { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
      const data = await r.json();
      const total = paintHeat(data.events || []);
      if (summary) {
        const sinceDate = new Date(data.since);
        summary.innerHTML =
          '<strong>' + (data.count || 0) + '</strong> events · since ' +
          sinceDate.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
      }
    } catch (err) {
      if (summary) summary.textContent = 'failed: ' + String(err);
    }
  }

  function setFlowMode(mode) {
    flowMode = mode;
    const grp = $('flow-time');
    if (grp) {
      grp.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', b.dataset.mode === mode);
      });
    }
    if (mode === 'live') {
      clearHeat();
      const summary = $('flow-time-summary');
      if (summary) summary.textContent = '';
    } else {
      loadAggregate(mode);
    }
  }

  // Wire button clicks (deferred to ensure DOM is ready).
  setTimeout(() => {
    const grp = $('flow-time');
    if (grp) {
      grp.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.tagName === 'BUTTON' && t.dataset.mode) {
          setFlowMode(t.dataset.mode);
        }
      });
    }
  }, 100);

  // Periodic refresh while a non-live window is selected (3 min).
  setInterval(() => {
    if (flowMode !== 'live' && location.hash === '#flow') {
      loadAggregate(flowMode);
    }
  }, 3 * 60_000);

  // Periodic warmth tick — also updates the "warm nodes" counter.
  setInterval(() => {
    const now = Date.now();
    let warm = 0;
    for (const [id, last] of nodeWarmth) {
      if (now - last < 30_000) warm++;
      else nodeWarmth.delete(id);
    }
    warmCount = warm;
    const wEl = $('fl-stat-warm');   if (wEl) wEl.textContent = String(warm);
    const pEl = $('fl-stat-pulses'); if (pEl) pEl.textContent = String(pulseCount);
  }, 1500);

  // Render the flow lazily when the tab activates.
  let flowRendered = false;
  window.__renderFlow = () => {
    if (!flowRendered) {
      flowRendered = true;
      renderFlow();
      // Replay buffer of recent events so opening the tab paints recent traffic.
      fetch('/api/events/recent', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : [])
        .then(arr => {
          if (!Array.isArray(arr)) return;
          let i = 0;
          for (const e of arr.slice(-30)) {
            setTimeout(() => applyEvent(e), i * 60);
            i++;
          }
        })
        .catch(() => {});
    }
  };

  // Hebrew letter toggle — show/hide the path letters
  setTimeout(() => {
    const btn = $('flow-letters-toggle');
    const lettersG = $('fl-paths-letters');
    if (btn && lettersG) {
      let on = true;
      btn.classList.add('on');
      btn.addEventListener('click', () => {
        on = !on;
        btn.classList.toggle('on', on);
        lettersG.style.display = on ? '' : 'none';
      });
    }

    // Phase 3.3 — filter pills wire-up
    document.querySelectorAll('.ff-pill').forEach((p) => {
      p.addEventListener('click', () => {
        document.querySelectorAll('.ff-pill').forEach((x) => x.classList.remove('on'));
        p.classList.add('on');
        flowFilter = p.dataset.ff || 'all';
      });
    });

    // Phase 4.2 — timelapse button
    const tlBtn = $('flow-timelapse');
    if (tlBtn) {
      tlBtn.addEventListener('click', () => {
        if (timelapsePlaying) stopTimelapse();
        else startTimelapse();
      });
    }

    // Phase 3.1 — drawer close
    $('sefira-inspector')?.querySelector('.si-close')?.addEventListener('click', () => {
      $('sefira-inspector').hidden = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && location.hash === '#flow') {
        const insp = $('sefira-inspector');
        if (insp && !insp.hidden) insp.hidden = true;
      }
    });
  }, 100);

  // Phase 3 state
  let flowFilter = 'all';

  // Override applyEvent to respect the filter + suppress live during timelapse
  const _applyEventOriginal = applyEvent;
  applyEvent = function applyEventFiltered(e) {
    if (timelapsePlaying) return; // replay handles its own pulses
    if (flowFilter !== 'all') {
      if (!e.kind || e.kind.indexOf(flowFilter) !== 0) return;
    }
    _applyEventOriginal(e);
  };

  // ── Phase 3.1: Sefira inspector ────────────────────────────────
  window.__openSefiraInspector = async function openSefiraInspector(id) {
    const insp = $('sefira-inspector');
    const body = $('si-body');
    const node = NODES[id];
    if (!insp || !body || !node) return;
    body.innerHTML =
      '<div class="si-head">' +
        '<div class="si-hebrew">' + (node.hebrew || '') + '</div>' +
        '<div class="si-title">' + esc(node.label) + '</div>' +
        '<div class="si-sub">' + esc(node.sub || '') + ' — ' + esc(node.meaning || '') + '</div>' +
      '</div>' +
      '<div class="si-section">' +
        '<div class="si-section-h">live stats — last 1h</div>' +
        '<div class="si-stats" id="si-stats">_(loading…)_</div>' +
      '</div>' +
      '<div class="si-section">' +
        '<div class="si-section-h">throughput · last 1h</div>' +
        '<svg class="si-spark" id="si-spark" viewBox="0 0 280 28" preserveAspectRatio="none"></svg>' +
      '</div>' +
      '<div class="si-section">' +
        '<div class="si-section-h">recent events</div>' +
        '<div class="si-recent" id="si-recent">_(loading…)_</div>' +
      '</div>';
    insp.hidden = false;
    // Pull stats
    try {
      const r = await fetch('/api/events/aggregate?window=1h', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const events = data.events || [];
      let touched = 0; let errors = 0;
      const recent = [];
      const buckets = new Array(20).fill(0); // 3-min buckets over 1h
      const now = Date.now();
      for (const ev of events) {
        const m = eventToPulses(ev);
        if (!m) continue;
        const involved = new Set();
        for (const [from, to] of m.edges) { involved.add(from); involved.add(to); }
        if (involved.has(id)) {
          touched++;
          if (m.errorNodes && m.errorNodes.includes(id)) errors++;
          recent.push(ev);
          const bIdx = Math.min(19, Math.floor((now - ev.ts) / (3 * 60_000)));
          buckets[19 - bIdx] = (buckets[19 - bIdx] || 0) + 1;
        }
      }
      const stats = $('si-stats');
      if (stats) {
        stats.innerHTML =
          '<span class="key">events touched</span><span class="val">' + touched + '</span>' +
          '<span class="key">errors</span><span class="val">' + errors + '</span>' +
          '<span class="key">error rate</span><span class="val">' + (touched ? ((errors/touched)*100).toFixed(1) + '%' : '—') + '</span>' +
          '<span class="key">events/min</span><span class="val">' + (touched/60).toFixed(2) + '</span>';
      }
      // Sparkline
      const spark = $('si-spark');
      if (spark) {
        const max = Math.max(1, ...buckets);
        const w = 280, h = 28;
        const stepX = w / Math.max(1, buckets.length - 1);
        let path = '';
        buckets.forEach((v, i) => {
          const x = i * stepX;
          const y = h - (v / max) * (h - 4) - 2;
          path += (i === 0 ? 'M ' : ' L ') + x.toFixed(1) + ',' + y.toFixed(1);
        });
        spark.innerHTML =
          '<path d="' + path + '" fill="none" stroke="rgba(40, 200, 200, 0.85)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>';
      }
      // Recent events
      const recentEl = $('si-recent');
      if (recentEl) {
        if (recent.length === 0) recentEl.innerHTML = '<div class="explorer-hint">_(no traffic yet)_</div>';
        else recentEl.innerHTML = recent.slice(-10).reverse().map((ev) =>
          '<div class="sir">' + esc(ev.kind) + ' · ' + new Date(ev.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</div>'
        ).join('');
      }
    } catch {}
  };

  // ── Phase 3.2: phantom flow detection ───────────────────────────
  // Mark edges as phantom if they've been silent > threshold ms (default 1h).
  const PHANTOM_THRESHOLD_MS = 60 * 60 * 1000;
  async function refreshPhantomFlows() {
    if (location.hash !== '#flow') return;
    if (edgePathById.size === 0) return;
    try {
      const r = await fetch('/api/events/aggregate?window=1d', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const events = data.events || [];
      const lastSeen = new Map(); // edgeKey -> ts
      for (const ev of events) {
        const m = eventToPulses(ev);
        if (!m) continue;
        for (const [from, to] of m.edges) {
          const k = edgeKey(from, to);
          const cur = lastSeen.get(k) || 0;
          if (ev.ts > cur) lastSeen.set(k, ev.ts);
        }
      }
      const now = Date.now();
      edgePathById.forEach((path, k) => {
        path.classList.remove('phantom');
        const ts = lastSeen.get(k) || 0;
        if (ts === 0 || (now - ts) > PHANTOM_THRESHOLD_MS) {
          path.classList.add('phantom');
        }
      });
    } catch {}
  }
  setInterval(refreshPhantomFlows, 90_000);
  setTimeout(refreshPhantomFlows, 6_000);

  // ── Phase 3.4: bottleneck auto-highlight ───────────────────────
  // Pick the path with the highest event count that ALSO has elevated
  // error rate as the "bottleneck" of the moment.
  async function refreshBottleneck() {
    if (location.hash !== '#flow') return;
    if (edgePathById.size === 0) return;
    try {
      const r = await fetch('/api/events/aggregate?window=1h', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const events = data.events || [];
      const counts = new Map();
      const errs = new Map();
      for (const ev of events) {
        const m = eventToPulses(ev);
        if (!m) continue;
        for (const [from, to] of m.edges) {
          const k = edgeKey(from, to);
          counts.set(k, (counts.get(k) || 0) + 1);
          if (m.errorNodes && (m.errorNodes.includes(from) || m.errorNodes.includes(to))) {
            errs.set(k, (errs.get(k) || 0) + 1);
          }
        }
      }
      // Score: errors * log(count). Highest = bottleneck.
      let best = null; let bestScore = 0;
      counts.forEach((c, k) => {
        const e = errs.get(k) || 0;
        const score = e * Math.log2(1 + c);
        if (score > bestScore) { bestScore = score; best = k; }
      });
      // Clear previous bottleneck
      edgePathById.forEach((p) => p.classList.remove('bottleneck'));
      if (best && bestScore > 0) {
        const p = edgePathById.get(best);
        if (p) p.classList.add('bottleneck');
      }
    } catch {}
  }
  setInterval(refreshBottleneck, 30_000);
  setTimeout(refreshBottleneck, 8_000);

  // ── Phase 4.4: anomaly highlights (10× spike vs rolling baseline) ──
  // Compare last 10min against the prior 50min from the 1h archive.
  async function refreshAnomalies() {
    if (location.hash !== '#flow') return;
    if (edgePathById.size === 0) return;
    try {
      const r = await fetch('/api/events/aggregate?window=1h', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const events = data.events || [];
      const now = Date.now();
      const recentByNode = new Map();
      const baseByNode = new Map();
      for (const ev of events) {
        const m = eventToPulses(ev);
        if (!m) continue;
        for (const [from, to] of m.edges) {
          [from, to].forEach((n) => {
            if (now - ev.ts < 10 * 60_000) recentByNode.set(n, (recentByNode.get(n) || 0) + 1);
            else baseByNode.set(n, (baseByNode.get(n) || 0) + 1);
          });
        }
      }
      Object.keys(NODES).forEach((id) => {
        const g = nodeGById.get(id);
        if (!g) return;
        g.classList.remove('anomaly');
        const recent10 = recentByNode.get(id) || 0;
        const base50 = baseByNode.get(id) || 0;
        // Recent rate per minute vs baseline rate per minute
        const recentRate = recent10 / 10;
        const baseRate = base50 / 50;
        if (baseRate > 0 && recentRate > baseRate * 5 && recent10 >= 3) {
          g.classList.add('anomaly');
        }
      });
    } catch {}
  }
  setInterval(refreshAnomalies, 60_000);
  setTimeout(refreshAnomalies, 12_000);

  // ── Phase 4.2: time-lapse playback ───────────────────────────────
  // Compress the past 24h into a 30s replay. While playing, suppress
  // live SSE pulses. Speed cycler: 1× / 60× / 600×.
  let timelapsePlaying = false;
  let timelapseSpeed = 60;
  let timelapseEvents = [];
  let timelapseStart = 0;
  let timelapseT0 = 0;

  async function startTimelapse() {
    if (timelapsePlaying) return;
    try {
      const r = await fetch('/api/events/aggregate?window=1d', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      timelapseEvents = (data.events || []).sort((a, b) => a.ts - b.ts);
      if (timelapseEvents.length === 0) return;
      timelapseStart = timelapseEvents[0].ts;
      timelapseT0 = performance.now();
      timelapsePlaying = true;
      const btn = $('flow-timelapse');
      if (btn) { btn.classList.add('on'); btn.textContent = '⏸ replay'; }
      tickTimelapse();
    } catch {}
  }

  function stopTimelapse() {
    timelapsePlaying = false;
    timelapseEvents = [];
    const btn = $('flow-timelapse');
    if (btn) { btn.classList.remove('on'); btn.textContent = '⏵ replay 24h'; }
  }

  function tickTimelapse() {
    if (!timelapsePlaying) return;
    const now = performance.now();
    const elapsedMs = now - timelapseT0;
    const cutoffTs = timelapseStart + elapsedMs * timelapseSpeed;
    while (timelapseEvents.length > 0 && timelapseEvents[0].ts <= cutoffTs) {
      const ev = timelapseEvents.shift();
      _applyEventOriginal(ev); // bypass filter during replay
    }
    if (timelapseEvents.length === 0) {
      stopTimelapse();
      return;
    }
    requestAnimationFrame(tickTimelapse);
  }

  // ── Phase 5.1: Branch tones — Web Audio chime per sefira-touching event ──
  // Each sefira gets a pentatonic-scale note. Events trigger their
  // dominant sefira's note. Off by default; toggle in toolbar.
  let toneAudio = { enabled: false, ctx: null };
  const SEFIRA_NOTES = {
    keter:    932.33, // A#5 — ethereal high
    chokmah:  830.61, // G#5
    binah:    739.99, // F#5
    chesed:   659.26, // E5
    geburah:  587.33, // D5
    tiferet:  523.25, // C5  — the heart, central
    netzach:  466.16, // A#4
    hod:      415.30, // G#4
    yesod:    349.23, // F4
    malkuth:  261.63, // C4 — earthy low
  };
  function playSefiraTone(role) {
    if (!toneAudio.enabled || !toneAudio.ctx) return;
    const f = SEFIRA_NOTES[role];
    if (!f) return;
    const ac = toneAudio.ctx;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.connect(g); g.connect(ac.destination);
    osc.type = 'sine';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.5);
    osc.start();
    osc.stop(ac.currentTime + 0.5);
  }

  // Hook the original applyEvent to also play the dominant sefira's tone
  const _applyEventForTones = applyEvent;
  applyEvent = function applyEventToned(e) {
    _applyEventForTones(e);
    if (toneAudio.enabled) {
      const m = eventToPulses(e);
      if (m && m.edges.length > 0) {
        // Pick the destination sefira of the first edge as "dominant"
        const dest = m.edges[0][1];
        if (dest && SEFIRA_NOTES[dest]) playSefiraTone(dest);
      }
    }
  };

  // ── Phase 5.2: theme variants ──────────────────────────────────
  const THEMES = ['mechanical', 'bioluminescent', 'manuscript'];
  let themeIdx = 0;
  function applyTheme() {
    const t = THEMES[themeIdx];
    const wrap = document.querySelector('.flow-wrap');
    if (!wrap) return;
    THEMES.forEach((x) => wrap.classList.remove('theme-' + x));
    wrap.classList.add('theme-' + t);
    const btn = $('flow-theme');
    if (btn) btn.textContent = '◉ ' + t;
  }
  applyTheme();

  // ── Phase 5.6: what-if mode ────────────────────────────────────
  let whatIfMode = false;
  function toggleWhatIf() {
    whatIfMode = !whatIfMode;
    const btn = $('flow-whatif');
    if (btn) btn.classList.toggle('on', whatIfMode);
    document.querySelectorAll('.fl-node').forEach((n) => {
      n.classList.toggle('whatif-armed', whatIfMode);
    });
  }
  // When in what-if mode, click on a sefira fires a simulated event
  // through it. We hook this up after renderFlow registers click
  // handlers — by re-routing via a capture-phase listener on flowNodesG.
  setTimeout(() => {
    const nodesG = $('fl-nodes');
    if (!nodesG) return;
    nodesG.addEventListener('click', (e) => {
      if (!whatIfMode) return;
      // Find clicked sefira id via traversal
      let el = e.target;
      while (el && el.tagName !== 'g') el = el.parentNode;
      if (!el) return;
      const id = (el.getAttribute && el.getAttribute('id') || '').replace('fl-node-', '');
      if (!id || !NODES[id]) return;
      // Synthetic event: spawn.start for any sefira (deterministic visual)
      e.stopPropagation();
      _applyEventOriginal({ kind: 'spawn.start', ts: Date.now(), threadKey: 'what-if' });
    }, true);
  }, 200);

  // Wire Phase 5 tool buttons
  setTimeout(() => {
    const audioBtn = $('flow-audio');
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        toneAudio.enabled = !toneAudio.enabled;
        audioBtn.classList.toggle('on', toneAudio.enabled);
        if (toneAudio.enabled && !toneAudio.ctx) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const AC = window.AudioContext || window.webkitAudioContext;
            toneAudio.ctx = new AC();
          } catch {}
        }
      });
    }
    const themeBtn = $('flow-theme');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        themeIdx = (themeIdx + 1) % THEMES.length;
        applyTheme();
      });
    }
    const whatIfBtn = $('flow-whatif');
    if (whatIfBtn) whatIfBtn.addEventListener('click', toggleWhatIf);
  }, 200);

  // ── Phase 5.5: achievement ornaments ───────────────────────────
  // Inject small SVG ornaments on relevant sefirot when milestones met.
  async function refreshAchievements() {
    if (location.hash !== '#flow') return;
    if (edgePathById.size === 0) return;
    try {
      const [statusR, partyR] = await Promise.all([
        fetch('/api/status', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        fetch('/api/parties/recent', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      ]);
      const episodeCount = statusR?.layers?.l3_episodic?.episodes ?? 0;
      const partyCount = (partyR?.parties || []).length;
      // Clear existing ornaments
      document.querySelectorAll('.fl-ornament').forEach((o) => o.remove());
      // Sia (Perception) — golden leaf at 100+ episodes, blossom at 1000+
      if (episodeCount >= 100) addOrnament('chokmah', '🍃', 'gold');
      if (episodeCount >= 1000) addOrnament('chokmah', '🌸', 'gold');
      // Horus (the Falcon) — first party constellation
      if (partyCount >= 1) addOrnament('tiferet', '✦', '#a78bfa');
      // Khepri (the Becoming) — first accepted skill (proxy: count > 0)
      // Skip for now — we'd need /api/skills count
    } catch {}
  }
  function addOrnament(sefiraId, glyph, color) {
    const g = nodeGById.get(sefiraId);
    if (!g) return;
    const node = NODES[sefiraId];
    if (!node) return;
    const orn = document.createElementNS(SVG_NS, 'text');
    orn.setAttribute('class', 'fl-ornament');
    orn.setAttribute('x', String(node.w + 14));
    orn.setAttribute('y', '14');
    orn.setAttribute('fill', color);
    orn.setAttribute('font-size', '14');
    orn.textContent = glyph;
    g.appendChild(orn);
  }
  setInterval(refreshAchievements, 5 * 60_000);
  setTimeout(refreshAchievements, 10_000);

  // SSE — replay buffer arrives first, then live events stream in.
  let totalEvents = 0;
  const lastEl = $('fl-stat-last');
  const totalEl = $('fl-stat-events');
  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    try {
      const ev = JSON.parse(m.data);
      appendEvent(ev, !pendingFadeIn ? true : false);
      // Pulse the flow tab ONLY if it's been rendered (tab visited at least once).
      if (flowRendered && flowMode === 'live') applyEvent(ev);
      if (typeof window.__councilApplyEvent === 'function' && ev.kind && ev.kind.indexOf('party.') === 0) {
        window.__councilApplyEvent(ev);
      }
      // Push shooting stars into the firmament for any meaningful event.
      if (typeof window.__cosmosShootingStar === 'function') {
        const interesting = ['message.received', 'episode.write', 'spawn.start', 'reflection.start', 'reflection.complete', 'party.started', 'party.agent_spoke', 'party.complete'];
        if (ev.kind && interesting.includes(ev.kind)) {
          window.__cosmosShootingStar(ev.kind, ev.peer);
        }
      }
      totalEvents++;
      if (totalEl) totalEl.textContent = String(totalEvents);
      if (lastEl) lastEl.textContent = ev.kind;
    } catch {}
  };
  es.onopen = () => {
    pendingFadeIn = false;
  };
  es.onerror = () => {
    // EventSource auto-reconnects; just note it visually.
  };

  // initial snapshot + 3s tick
  pollStatus();
  setInterval(pollStatus, 3000);

  // ---- anthropic status banner ----------------------------------
  // Top-of-page, sticky, severity-tinted. Initial paint via /api/anthropic-status,
  // live updates via SSE (anthropic.status.* events), refresh every 60s.
  const banner = $('anthropic-status-banner');
  const dismissedIncidents = new Set();
  let bannerSession = null;
  function severityIconFor(s) {
    if (s === 'critical') return '🚨';
    if (s === 'major') return '🔴';
    if (s === 'minor') return '🟡';
    if (s === 'maintenance') return '🛠️';
    if (s === 'resolved') return '✅';
    return 'ℹ️';
  }
  function renderBanner() {
    if (!banner || !bannerSession) return;
    const { active, recentlyResolved, indicator, fetchedAt, staleSince } = bannerSession;
    const visibleActive = (active || []).filter(i => !dismissedIncidents.has(i.id));
    const visibleResolved = (recentlyResolved || []).filter(i => !dismissedIncidents.has(i.id));
    const showResolved = visibleActive.length === 0 && visibleResolved.length > 0;
    if (visibleActive.length === 0 && !showResolved) {
      banner.hidden = true;
      return;
    }
    let severity, title, update, incident;
    if (visibleActive.length > 0) {
      // Pick highest-impact active incident.
      const order = { critical: 4, major: 3, minor: 2, none: 1, maintenance: 0 };
      visibleActive.sort((a, b) => (order[b.impact] || 0) - (order[a.impact] || 0));
      incident = visibleActive[0];
      severity = incident.impact === 'none' ? indicator || 'minor' : incident.impact;
      title = incident.name + ' · ' + incident.status;
      if (visibleActive.length > 1) title += ' (+' + (visibleActive.length - 1) + ' more)';
      update = incident.latestUpdate || '';
    } else {
      incident = visibleResolved[0];
      severity = 'resolved';
      title = 'Resolved: ' + incident.name;
      update = incident.finalUpdate || incident.latestUpdate || 'All systems operating normally.';
    }
    banner.dataset.severity = severity;
    $('ab-icon').textContent = severityIconFor(severity);
    $('ab-title').textContent = title;
    $('ab-update').textContent = update;
    $('ab-link').href = (incident && incident.shortlink) || 'https://status.claude.com/';
    const stale = staleSince && (Date.now() - staleSince > 60_000);
    $('ab-stale').hidden = !stale;
    banner.hidden = false;
  }
  async function pollAnthropicStatus() {
    try {
      const r = await fetch('/api/anthropic-status', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      if (!data.enabled) {
        if (banner) banner.hidden = true;
        return;
      }
      bannerSession = data;
      renderBanner();
    } catch {}
  }
  if (banner) {
    const dismissBtn = $('ab-dismiss');
    if (dismissBtn) dismissBtn.addEventListener('click', () => {
      if (!bannerSession) return;
      const all = [...(bannerSession.active || []), ...(bannerSession.recentlyResolved || [])];
      for (const i of all) dismissedIncidents.add(i.id);
      banner.hidden = true;
    });
    pollAnthropicStatus();
    setInterval(pollAnthropicStatus, 60_000);
  }
  // Hook the existing SSE stream to refresh on transitions.
  // (es is in scope from the live-flow init above.)
  if (typeof es !== 'undefined') {
    const orig = es.onmessage;
    es.onmessage = function (m) {
      if (typeof orig === 'function') orig.call(es, m);
      try {
        const ev = JSON.parse(m.data);
        if (ev && typeof ev.kind === 'string' && ev.kind.indexOf('anthropic.status.') === 0) {
          pollAnthropicStatus();
        }
      } catch {}
    };
  }
})();
</script>

</body>
</html>`;
}
