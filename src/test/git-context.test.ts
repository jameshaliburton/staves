import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureGitContext } from '../git-context.js';

async function repo(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'staves-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  const commit = async (name = 'file.txt') => {
    await writeFile(join(root, name), name);
    git('add', '--', name);
    git('commit', '-m', name);
    return git('rev-parse', 'HEAD');
  };
  return { root, git, commit };
}

test('captures unborn and clean committed checkouts without exposing directory paths', async t => {
  const r = await repo(t);
  const unborn = await captureGitContext(r.root);
  assert.equal(unborn.unborn, true);
  assert.equal(unborn.head, null);
  assert.equal(unborn.branch, 'main');
  assert.equal(unborn.repository.origin, null);
  const head = await r.commit();
  const result = await captureGitContext(r.root);
  assert.equal(result.head, head);
  assert.equal(result.dirty.isDirty, false);
  assert.equal(result.worktree, false);
  assert.equal(result.source, 'local-git');
  assert.ok(!Number.isNaN(Date.parse(result.observedAt)));
  assert.ok(!JSON.stringify(result).includes(r.root));
});

test('counts dirty tracked and untracked files including staged renames', async t => {
  const r = await repo(t);
  await r.commit();
  r.git('mv', 'file.txt', 'renamed.txt');
  await writeFile(join(r.root, 'untracked.txt'), 'new');
  const result = await captureGitContext(r.root);
  assert.deepEqual(result.dirty, { tracked: 1, untracked: 1, isDirty: true });
});

test('captures linked worktrees, detached HEAD and base ancestry', async t => {
  const r = await repo(t);
  const base = await r.commit();
  const head = await r.commit('second.txt');
  const linked = join(r.root, 'linked');
  r.git('worktree', 'add', '--detach', linked, base);
  const result = await captureGitContext(linked, { baseRef: head });
  assert.equal(result.worktree, true);
  assert.equal(result.branch, null);
  assert.equal(result.head, base);
  assert.equal(result.base?.isAncestorOfHead, false);
  assert.equal((await captureGitContext(r.root, { baseRef: base })).base?.isAncestorOfHead, true);
});

test('sanitizes origin credentials and omits local origins', async t => {
  const r = await repo(t);
  for (const [origin, expected] of [
    ['https://user:secret@example.com/team/repo.git?token=private#secret', 'https://example.com/team/repo.git'],
    ['git@example.com:team/repo.git', 'ssh://example.com/team/repo.git'],
    ['ssh://user:secret@example.com/team/repo.git?secret=yes', 'ssh://example.com/team/repo.git'],
    [join(r.root, 'secret'), null],
    ['file:///private/repository', null],
  ]) {
    r.git('config', 'remote.origin.url', origin!);
    assert.equal((await captureGitContext(r.root)).repository.origin, expected);
  }
});

test('rejects missing repositories and invalid refs without leaking paths or running shell syntax', async t => {
  const r = await repo(t);
  await r.commit();
  await assert.rejects(captureGitContext(r.root, { baseRef: '--help' }), /Unable to inspect/);
  await assert.rejects(captureGitContext(r.root, { baseRef: 'HEAD; touch unexpected' }), /Unable to inspect/);
  const outside = await mkdtemp(join(tmpdir(), 'staves-nongit-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(join(outside, 'child'));
  await assert.rejects(captureGitContext(outside), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(outside));
    return true;
  });
});
