// Every documentation link the product offers must land on a page that exists.
//
// The status bar shipped a "How to start it" link to /docs/local, a page that has never existed:
// the guides were reorganised and the link was not. Nothing failed, because a link is just a string
// until somebody clicks it. This reads the links out of the product and the pages off disk, so a
// renamed guide breaks the build rather than a reader's afternoon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const content = path.join(repo, 'docs-site/src/content/docs');

/** Every slug the documentation site publishes, as the URL renders it. */
function slugs(dir = content, prefix = '') {
  const out = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) for (const s of slugs(path.join(dir, entry.name), prefix + entry.name + '/')) out.add(s);
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      const name = entry.name.replace(/\.mdx?$/, '');
      out.add(prefix + (name === 'index' ? '' : name));
    }
  }
  return out;
}

/** Source files that can offer a person a link. Not the guides themselves (Starlight checks those),
 *  and not the tests, whose prose quotes the very shapes this looks for. */
function sources(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'public', '.git', '.astro', 'vendor', 'test'].includes(entry.name)) continue;
      sources(full, found);
    } else if (/\.(js|mjs|ts|html|md)$/.test(entry.name)) found.push(full);
  }
  return found;
}

test('every documentation link in the product points at a page that exists', () => {
  const published = slugs();
  assert.ok(published.size > 10, `expected the guides to be present, found ${published.size}`);

  // Three shapes reach the same page: the editor routes #docs/x through to /docs/x, and the skill
  // and MCP instructions hand out the absolute URL because they are read on someone else's machine.
  const patterns = [
    /#docs\/([a-z0-9/.-]*)/g,
    /(?:href=["']|["'])\/docs\/([a-z0-9/.-]*)/g,
    /staves\.io\/docs\/([a-z0-9/.-]*)/g,
  ];
  const broken = [];
  // staves.io's own pages and gateway live in staves-cloud, which runs this same check against them.
  for (const file of [...sources(path.join(repo, 'design')), ...sources(path.join(repo, 'src'))]) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const [, raw] of text.matchAll(pattern)) {
        const slug = raw.replace(/\/$/, '');
        if (!slug) continue;                       // /docs itself is the index
        if (slug === 'sitemap-index.xml') continue; // generated XML sitemap, not a guide
        if (slug.startsWith('pagefind')) continue; // built search assets, not a guide
        if (published.has(slug)) continue;
        broken.push(`${path.relative(repo, file)} → /docs/${slug}`);
      }
    }
  }
  assert.deepEqual(broken, [], 'these links go nowhere:\n  ' + broken.join('\n  ') +
    '\n\npublished guides:\n  ' + [...published].sort().join('\n  '));
});
