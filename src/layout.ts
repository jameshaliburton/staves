/**
 * Layout — every dimension the board uses, and the rules that bind them.
 *
 * Rules (enforced by render.ts; see LAYOUT.md for the prose):
 *  R1  Nothing draws outside its box. Text that does not fit is cut with an ellipsis, never overflowed.
 *  R2  A clip's width is measured from its content; a column is as wide as its widest clip.
 *  R3  Columns are handoffs. A clip sits in the column of the last handoff it takes.
 *  R4  Tracks have one height. Two clips in one track-column stack with a fixed offset, never overlap.
 *  R5  Marks sit in one row above the clip's right edge; the pin is last and outermost.
 *  R6  Notes never sit on the board. Pins on the board, notes in the gutter, in pin order.
 *  R7  Wires leave from the right port, arrive at the left port; loops pass underneath; same-column handoffs are vertical.
 *  R8  Gutters, margins and paddings come from this file, never from the renderer.
 */

export const T = {
  /* page */
  pageMargin: 40,
  /* board */
  labelColumn: 210, // track names live here; the board starts after it
  boardInset: 14, // track background extends this far left of the first column line
  columnGutter: 36, // space between the widest clip of one column and the next column
  columnMinWidth: 120,
  headerHeight: 40, // room above the first track for artifact labels
  /* tracks */
  trackHeight: 64,
  trackGap: 8,
  trackNameX: 24,
  trackGlyph: 16,
  /* clips */
  clipPadX: 12,
  clipPadTop: 10, // for clips with a meta line
  clipPadTopSlim: 17, // for clips with title only
  clipHeight: 44,
  clipHeightSlim: 30,
  clipRadius: 3,
  clipStackDx: 14, // when two clips share a track-column
  clipStackDy: 6,
  compositeShadow: 4,
  triggerGlyph: 12,
  kindGlyph: 14,
  glyphGap: 4,
  portRadius: 3,
  notchDepth: 7,
  notchDepthSingle: 9,
  gateReserve: 10, // extra width reserved on a clip that has notches
  /* marks */
  markSize: 14,
  markStep: 17,
  markRise: 9, // how far above the clip top the mark row sits
  pinRadius: 7,
  /* type */
  titleSize: 12.5,
  metaSize: 10.5,
  artifactSize: 10.5,
  noteSize: 10.5,
  trackNameSize: 12.5,
  trackMetaSize: 11,
  /* text fitting */
  metaMaxChars: 44,
  em: 0.56, // average advance / font-size for Archivo at these sizes
  /* wires */
  wireLoopDrop: 40,
  /* gutter */
  gutterTop: 28,
  gutterLine: 18,
  gutterWrap: 120, // characters per line before a note wraps
  titleWeight: 600,
  metaWeight: 400,
} as const;

import { METRICS } from "./fonts/metrics.js";
/** Rendered width of a string at a font size and weight, from the embedded font's own metrics. */
export function textWidth(s: string, size: number, weight = 400): number {
  const m = METRICS[weight] ?? METRICS[400];
  let w = 0;
  for (const ch of s) w += (m[ch] ?? m["n"] ?? T.em) * size;
  return w;
}

/** Cut a string so it fits in `px` at `size`, with an ellipsis, breaking on a word if one is near. (R1) */
export function fit(s: string, px: number, size: number, weight = 400): string {
  if (textWidth(s, size, weight) <= px + 0.5) return s;
  let max = s.length;
  while (max > 3 && textWidth(s.slice(0, max) + "…", size, weight) > px) max--;
  let cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[ ,;:·—-]+$/, "") + "…";
}

/** Wrap a note into lines of at most `chars`. (R6) */
export function wrap(s: string, chars = T.gutterWrap): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > chars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}
