#!/usr/bin/env node
// Enforces BOUNDARY.md: closed code lives in staves-cloud and never comes back here, open code never imports
// it, the npm package never ships it, and no tracked file carries a secret.
//
//   npm run check:boundary            the repository
//   npm run check:boundary -- --pack  also what npm would publish (run after a build)
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const posix = path => path.split(sep).join('/');

// Everything here moved to staves-cloud (Phase B). None of it may exist in this repository again.
export const CLOSED = ['api/', 'supabase/', 'design/beta/', 'src/cloud-store.ts', 'src/platform-telemetry.ts', 'vercel.json', '.vercel/',
  'scripts/sync-auth-emails.mjs', 'scripts/test-hosted-database.mjs', 'scripts/verify-platform-telemetry.mjs',
  'scripts/build-beta-flow.mjs', 'scripts/build-beta-scenario.mjs', 'public/robots.txt',
  'docs/beta/', 'docs/marketing/', 'docs/product/',
  // tests of closed code are closed code
  'src/test/cloud-store.test.ts', 'src/test/platform-telemetry.test.ts', 'src/test/platform-telemetry-server.test.ts', 'design/editor/test/gateway-preflight.test.mjs',
  'design/editor/test/access-copy.test.mjs', 'design/editor/test/account.test.mjs', 'design/editor/test/agent-handoff.test.mjs',
  'design/editor/test/connect-approval.test.mjs', 'design/editor/test/landing-gestures.test.mjs', 'design/editor/test/model-entry.test.mjs'];
export const OPEN = ['src/', 'packages/core/src/', 'packages/mcp/src/', 'packages/cli/src/', 'design/editor/', 'design/mockups/', 'integrations/', 'spec/', 'docs-site/src/'];
// Crossings that exist today and are removed by the staves-cloud split. Remove an entry when it is fixed.
export const PENDING = new Set([]);
const SECRETS = [
  [/xox[abpr]-\d+-\d+-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/xapp-\d-[A-Z0-9]+-\d+-[a-f0-9]{20,}/, 'Slack app token'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic key'],
  [/sk-(proj-)?[A-Za-z0-9]{32,}/, 'OpenAI key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google key'],
  [/re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/, 'Resend key'],
  [/https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,}/, 'Slack webhook'],
  [/eyJhbGciOi[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[A-Za-z0-9_-]*/, 'Supabase service-role key'],
];
const isClosed = file => CLOSED.some(prefix => prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix);
const isOpen = file => !isClosed(file) && OPEN.some(prefix => file.startsWith(prefix));
const code = /\.(ts|tsx|mts|js|mjs|cjs|jsx)$/;
const text = /\.(ts|tsx|mts|js|mjs|cjs|jsx|json|md|mdx|html|css|ya?ml)$/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (['node_modules', 'dist', '.git', 'vendor', '.astro'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path); else yield path;
  }
}

// `./x.js` in TypeScript source points at `./x.ts`; `../dist/x.js` points at `src/x.ts`.
function target(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  let file = posix(relative(root, resolve(root, dirname(fromFile), spec)));
  if (file.startsWith('dist/')) file = 'src/' + file.slice(5);
  return file.replace(/\.js$/, fromFile.endsWith('.ts') || file.startsWith('src/') ? '.ts' : '.js');
}

const exists = path => stat(join(root, path)).then(() => true, () => false);

export async function check({ pack = false } = {}) {
  const problems = [], pendingSeen = new Set();
  for (const path of CLOSED) if (await exists(path)) problems.push(`${path}: closed code, which lives in staves-cloud. Remove it here (BOUNDARY.md).`);
  for (const base of OPEN) {
    for await (const path of walk(join(root, base))) {
      const file = posix(relative(root, path));
      if (!isOpen(file) || !text.test(file)) continue;
      const source = await readFile(path, 'utf8');
      for (const [pattern, name] of SECRETS) if (pattern.test(source)) problems.push(`${file}: looks like a ${name}. Secrets never go in tracked files.`);
      if (!code.test(file)) continue;
      for (const match of source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const to = target(file, match[1] || match[2] || match[3]);
        if (!to || !isClosed(to)) continue;
        const crossing = `${file} -> ${to}`;
        if (PENDING.has(crossing)) pendingSeen.add(crossing); else problems.push(`${crossing}: open code imports closed code. Add a seam in open code instead (BOUNDARY.md rule 4).`);
      }
    }
  }
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  for (const entry of pkg.files || []) if (!entry.startsWith('!') && isClosed(entry.replace(/\*.*$/, ''))) problems.push(`package.json files: "${entry}" would publish closed code to npm.`);
  if (pack) {
    // What npm would publish, mapped back to source: dist/cloud-store.js is src/cloud-store.ts.
    const [{ files }] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    for (const { path } of files) {
      const source = path.startsWith('dist/') ? 'src/' + path.slice(5).replace(/\.(d\.ts|js)(\.map)?$/, '.ts') : path;
      if (isClosed(source) || isClosed(path)) problems.push(`npm package: ${path} is closed code and must not be published.`);
    }
  }
  const stale = [...PENDING].filter(crossing => !pendingSeen.has(crossing));
  return { problems, pending: [...pendingSeen], stale };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, pending, stale } = await check({ pack: process.argv.includes('--pack') });
  for (const crossing of pending) console.log(`pending  ${crossing}  (removed by the staves-cloud split)`);
  for (const crossing of stale) console.log(`fixed    ${crossing}  — delete it from PENDING in scripts/check-boundary.mjs`);
  if (problems.length) { for (const problem of problems) console.error(`✗ ${problem}`); process.exit(1); }
  console.log(`✓ boundary holds (${pending.length} known crossing${pending.length === 1 ? '' : 's'} pending)`);
}
