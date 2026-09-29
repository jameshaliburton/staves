// Screenshots for the documentation, taken from the real interface.
//
//   npm run shots            regenerate them
//   npm run shots -- --check fail if what is committed no longer matches the interface
//
// It runs against a seeded local instance rather than production: reproducible, publishable, and it
// needs no credential. A shot that changes therefore means the interface changed.
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed, BOARD } from './seed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const out = path.resolve(here, '../src/assets/screens');
const check = process.argv.includes('--check');
const PORT = 5399;

/** Each entry is one published image. Keep the list short: every shot is a thing that can go stale. */
const SHOTS = [
  { name: 'board', width: 1440, height: 900, at: `/?board=${BOARD}`,
    caption: 'A board: tracks down the side, jobs along them, handoffs between.' },
  { name: 'inspector', width: 1440, height: 900, at: `/?board=${BOARD}`,
    caption: 'A job, inspected: what it should achieve, who needs it, how you know it is done.',
    // Move the pointer off the job, or its hover card covers the inspector.
    async prepare(page) { await page.getByText('Check it against the order').first().click(); await page.mouse.move(700, 880); } },
];

const wait = ms => new Promise(r => setTimeout(r, ms));

/** The editor the documentation is about, backed by a seeded local store.
 *
 * This composes the same editorHandler the hosted gateway uses, so what is photographed is the
 * interface people actually meet — the CLI's own board view is a different surface, and shooting it
 * would document a product the reader is not using. No Supabase, no credential, no Codex bridge. */
async function serveSeeded() {
  const dir = mkdtempSync(path.join(tmpdir(), 'staves-shots-'));
  await seed(dir);
  const { Store } = await import(path.join(repo, 'dist/store.js'));
  const { editorHandler } = await import(path.join(repo, 'design/editor/handler.mjs'));
  const http = await import('node:http');
  const editor = editorHandler(new Store(dir), () => ({ model: null }));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/auth/config') { res.setHeader('content-type', 'application/json'); return res.end('{"configured":false,"local":true}'); }
      if (url.pathname === '/auth/me') { res.statusCode = 401; return res.end('{}'); }
      await editor(req, res);
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  }).listen(PORT, '127.0.0.1');
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/list`); if (r.ok) break; } catch {}
    await wait(250);
  }
  return { dir, stop: () => { server.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);

// A check renders into docs-site/.shots-check, which CI uploads when it fails. Renders differ between
// platforms, so the images to commit are the ones CI made, not a local run's.
const scratch = check ? path.resolve(here, '../.shots-check') : null;
if (scratch) { rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true }); }
const instance = await serveSeeded();
const browser = await chromium.launch();
const drifted = [], written = [];
try {
  mkdirSync(out, { recursive: true });
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${PORT}${shot.at}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.track', { timeout: 15000 }).catch(() => {});
    if (shot.prepare) await shot.prepare(page);   // no catch: a step that cannot run is a broken shot
    // Remove the version from layout too: hidden proportional digits still shift the model status.
    await page.addStyleTag({ content: '.shell-version{display:none}' });
    await wait(900);                                   // let layout and any transition settle
    const file = path.join(out, `${shot.name}.png`);
    const had = existsSync(file) ? digest(file) : null;
    // Compare into a scratch directory: playwright takes the format from the extension, so a
    // ".png.new" is not a png as far as it is concerned.
    const target = check ? path.join(scratch, `${shot.name}.png`) : file;
    await page.screenshot({ path: target, animations: 'disabled' });
    await page.close();

    if (!check) { written.push(shot.name); continue; }
    const now = digest(target);
    if (had !== now) drifted.push(`${shot.name} (was ${had ?? 'missing'}, now ${now})`);
  }
} finally {
  await browser.close();
  instance.stop();
}

if (check) {
  if (drifted.length) {
    console.error('These screenshots no longer match the interface:\n  ' + drifted.join('\n  ') +
      '\n\nOn CI, download the screenshots-as-built artifact, look at what changed, and commit those images\n' +
      'to docs-site/src/assets/screens. Locally, the new renders are in docs-site/.shots-check.');
    process.exit(1);
  }
  console.log(`screenshots: ${SHOTS.length} still match the interface`);
} else {
  writeFileSync(path.join(out, 'captions.json'),
    JSON.stringify(Object.fromEntries(SHOTS.map(s => [s.name, s.caption])), null, 2) + '\n');
  console.log('screenshots written:\n  ' + written.join('\n  '));
}
