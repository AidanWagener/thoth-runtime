import type { AgentRole } from '../party/agents';
import { AGENTS } from '../party/agents';

/**
 * Procedural sigil generator. Each agent gets a deterministic SVG
 * sigil derived from their name. The same name always produces the
 * same sigil — handy for both visual recognition and stability across
 * dashboard reloads.
 *
 * Algorithm:
 *   1. Hash the agent's name into a stream of bytes (FNV-1a 32-bit).
 *   2. Use the bytes to fill a 5×5 boolean grid, mirror-symmetric
 *      around the central column (so the sigil reads as a glyph).
 *   3. Plus geometric flourishes: an inner rotation marker (cardinal
 *      anchor stroke) and an outer ring scaled by the grid density.
 *   4. Coloring uses each agent's accent hex.
 *
 * Output: a self-contained <svg> string suitable for inline injection.
 */

const SIGIL_VIEWBOX = 64;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG seeded with a string. */
function rngFor(seed: string): () => number {
  let t = fnv1a(seed);
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SigilOptions {
  size?: number;          // pixel size of the rendered SVG
  glow?: boolean;         // add a drop-shadow filter
  ring?: boolean;         // outer ring (default true)
  spinning?: boolean;     // CSS-class flag for rotation animation
}

/** Build a sigil SVG for any agent role. */
export function sigilSvg(role: AgentRole, opts: SigilOptions = {}): string {
  const agent = AGENTS[role];
  return sigilForName(agent.name, '#' + agent.accent, opts);
}

/** Build a sigil SVG from any name + color (used for council seal too). */
export function sigilForName(name: string, color: string, opts: SigilOptions = {}): string {
  const size = opts.size ?? 64;
  const ring = opts.ring !== false;
  const rng = rngFor(name);
  const cells: boolean[][] = []; // 5 cols × 5 rows; mirror-symmetric on cols
  // Fill columns 0..2 (left half + center) randomly, with bias for
  // centerward density so sigils feel rooted.
  for (let r = 0; r < 5; r++) {
    cells[r] = [false, false, false, false, false];
    for (let c = 0; c < 3; c++) {
      const bias = c === 2 ? 0.7 : c === 1 ? 0.55 : 0.42;
      const fill = rng() < bias;
      cells[r][c] = fill;
      // Mirror to right side
      cells[r][4 - c] = fill;
    }
  }

  const cellPx = SIGIL_VIEWBOX / 6; // gives natural padding around 5×5
  const offset = (SIGIL_VIEWBOX - cellPx * 5) / 2;
  const strokes: string[] = [];

  // Vertical / horizontal connectors based on cell adjacency.
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (!cells[r][c]) continue;
      const cx = offset + cellPx * (c + 0.5);
      const cy = offset + cellPx * (r + 0.5);
      // Horizontal stroke into right neighbor
      if (c < 4 && cells[r][c + 1]) {
        const x2 = offset + cellPx * (c + 1.5);
        strokes.push(line(cx, cy, x2, cy));
      }
      // Vertical stroke down
      if (r < 4 && cells[r + 1][c]) {
        const y2 = offset + cellPx * (r + 1.5);
        strokes.push(line(cx, cy, cx, y2));
      }
      // Anchor dot
      strokes.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(cellPx * 0.16).toFixed(2)}"/>`);
    }
  }

  // Center anchor — always present, gives every sigil a stable focal point
  const cx0 = SIGIL_VIEWBOX / 2;
  strokes.push(`<circle cx="${cx0}" cy="${cx0}" r="${(cellPx * 0.28).toFixed(2)}" fill="currentColor"/>`);

  // Outer ring — scaled by density so denser sigils get fuller rings
  let density = 0;
  for (const row of cells) for (const c of row) if (c) density++;
  const arcSpan = ring ? Math.max(60, Math.min(330, density * 14)) : 0;
  const ringPath = ring ? buildArc(SIGIL_VIEWBOX / 2, SIGIL_VIEWBOX / 2, SIGIL_VIEWBOX / 2 - 2, -90, -90 + arcSpan) : '';

  const filter = opts.glow ? `filter="url(#sigilGlow)"` : '';
  const spinClass = opts.spinning ? ' sigil-spin' : '';
  const filterDef = opts.glow
    ? `<defs><filter id="sigilGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4" /></filter></defs>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="sigil${spinClass}" viewBox="0 0 ${SIGIL_VIEWBOX} ${SIGIL_VIEWBOX}" width="${size}" height="${size}" style="color:${color}">`,
    filterDef,
    `<g ${filter} stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none">`,
    ringPath ? `<path d="${ringPath}" stroke-width="0.9" opacity="0.85"/>` : '',
    strokes.join(''),
    '</g>',
    '</svg>',
  ].join('');
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
}

function buildArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, endDeg);
  const end = polar(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * Build a council seal — a composite emblem where each member's sigil
 * is anchored on a circle around a central glyph. Used for the
 * roster's "coat of arms" view.
 */
export function councilSealSvg(roles: AgentRole[], opts: { size?: number } = {}): string {
  const size = opts.size ?? 280;
  if (roles.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"></svg>`;
  }
  const cx = size / 2, cy = size / 2;
  const innerR = Math.min(size, size) * 0.18;
  const outerR = Math.min(size, size) * 0.42;
  const memberSize = Math.max(36, Math.min(72, size / Math.max(roles.length, 4)));
  const parts: string[] = [];

  // Outer ring
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${outerR + memberSize / 2 + 8}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1.2"/>`,
  );
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.4" stroke-dasharray="3 3"/>`,
  );

  // Each member's sigil at angle
  roles.forEach((role, i) => {
    const angle = -90 + (360 / roles.length) * i;
    const p = polar(cx, cy, outerR, angle);
    const sigil = sigilSvg(role, { size: memberSize, ring: false });
    parts.push(
      `<g transform="translate(${(p.x - memberSize / 2).toFixed(2)} ${(p.y - memberSize / 2).toFixed(2)})">${sigil}</g>`,
    );
  });

  // Center mark — Maat's feather glyph as a placeholder
  parts.push(
    `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="${(innerR * 1.1).toFixed(0)}" fill="rgba(255, 213, 100, 0.8)" font-family="serif">𓆄</text>`,
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    parts.join(''),
    '</svg>',
  ].join('');
}
