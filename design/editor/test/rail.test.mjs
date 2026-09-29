// The track names are pinned over the left of the canvas. They have to survive the cascade.
//
// A later rule set `.track>.h{position:relative}` so two hover buttons had something to anchor to.
// Sticky is already a containing block for absolute children, so the buttons never needed it — but
// the declaration won on specificity and un-pinned the rail. Nothing looked wrong until the canvas
// scrolled sideways, and then every track name slid off the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../navigation.css', import.meta.url), 'utf8');

/** The declarations a selector makes for one property, in source order. Same specificity throughout,
 *  so the last one is what the browser uses.
 *
 *  Comments are stripped first and every rule is matched, rather than anchoring on the character
 *  before the selector: the first version of this anchored on `{`, `}` or `,`, so a rule written
 *  just after a comment was invisible to it and the test passed while the bug was present. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(selector, property) {
  const out = [];
  for (const [, selectors, body] of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const targets = selectors.split(',').map(s => s.trim().replace(/\s*>\s*/g, '>'));
    if (!targets.includes(selector)) continue;
    for (const [, value] of body.matchAll(new RegExp(String.raw`(?:^|;)\s*${property}\s*:\s*([^;!]+)`, 'g'))) {
      out.push(value.trim());
    }
  }
  return out;
}

test('the track rail stays pinned when the canvas scrolls sideways', () => {
  const positions = declarations('.track>.h', 'position');
  assert.ok(positions.length, 'expected .track>.h to declare a position');
  assert.equal(positions.at(-1), 'sticky',
    `the last position on .track>.h wins, and it must be sticky. Found: ${positions.join(' then ')}`);
});

test('the rail keeps a stacking order above the jobs it scrolls over', () => {
  // Pinned but underneath is the same bug with extra steps: jobs would slide across the names.
  const z = declarations('.track>.h', 'z-index').map(Number);
  assert.ok(z.length && z.at(-1) >= 8, `rail z-index must stay above the lane, found ${z.join(', ') || 'none'}`);
});
