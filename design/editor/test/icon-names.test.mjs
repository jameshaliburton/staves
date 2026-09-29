import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { APP2_HTML, APP2_JS } from '../../../dist/app2.js';

/**
 * Every icon the workspace asks for has to exist in the set it ships with.
 *
 * A name that is not in the inlined Phosphor subset does not fail — it draws the blank rectangle
 * fallback, so the interface fills with grey squares and everything keeps working. Nobody notices
 * until someone looks at the screen, which is how "a fucking checkbox" got into a release once
 * already and how ph-checks and ph-flow-arrow got in after it.
 */

const here = new URL('../', import.meta.url);
const icons = new Set(Object.keys(JSON.parse(readFileSync(new URL('../../scripts/icons.json', here), 'utf8'))));

/** The editor layer maps a handful of names it prefers onto ones the subset actually has. */
function aliases() {
  const editor = readFileSync(new URL('editor.js', here), 'utf8');
  const literal = editor.match(/EICON=(\{[\s\S]*?\});/);
  assert.ok(literal, 'EICON should still be a literal this test can read');
  return Object.keys(Function('return ' + literal[1])());
}

test('every icon the editor asks for resolves to one that ships', () => {
  const known = new Set([...icons, ...aliases()]);
  const missing = new Map();
  for (const file of readdirSync(new URL('.', here)).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(new URL(file, here), 'utf8');
    const note = name => { if (!known.has(name)) missing.set(name, [...new Set([...(missing.get(name) ?? []), file])]); };
    for (const m of src.matchAll(/\b(?:ei|eb)\(\s*(?:'[^']*'|"[^"]*")\s*,\s*'([a-z0-9-]+)'/g)) note(m[1]);
    for (const m of src.matchAll(/\bei\(\s*'([a-z0-9-]+)'\s*\)/g)) note(m[1]);
  }
  assert.deepEqual([...missing], [], 'these draw as blank rectangles: ' + [...missing.keys()].join(', '));
});

test('every icon the served app asks for resolves to one that ships', () => {
  const missing = new Set();
  for (const source of [APP2_JS, APP2_HTML]) {
    for (const m of source.matchAll(/ph ph-([a-z0-9-]+)/g)) if (!icons.has(m[1])) missing.add(m[1]);
    for (const m of source.matchAll(/'ph-([a-z0-9-]+)'/g)) if (!icons.has(m[1])) missing.add(m[1]);
  }
  assert.deepEqual([...missing], [], 'these draw as blank rectangles: ' + [...missing].join(', '));
});
