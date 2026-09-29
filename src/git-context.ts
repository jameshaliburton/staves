import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** A point-in-time observation of local Git, not a claim about remote PR state. */
export interface GitContext {
  source: 'local-git';
  observedAt: string;
  repository: { origin: string | null };
  branch: string | null;
  head: string | null;
  unborn: boolean;
  worktree: boolean;
  dirty: { tracked: number; untracked: number; isDirty: boolean };
  base?: { ref: string; commit: string; isAncestorOfHead: boolean | null };
}

/** Keep a portable repository address, never credentials or local filesystem paths. */
function sanitizeOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value || /[\r\n\0]/.test(value)) return null;
  // Git's SCP-like spelling is not a URL; normalize it before URL sanitization.
  const scp = !value.includes('://') && value.match(/^(?:[^/@:]+@)?([^/:]+):(.+)$/);
  const candidate = scp ? `ssh://${scp[1]}/${scp[2]}` : value;
  try {
    const url = new URL(candidate);
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || !url.hostname) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export async function captureGitContext(
  directory: string,
  options: { baseRef?: string } = {},
): Promise<GitContext> {
  const git = async (args: string[]): Promise<string> => {
    try {
      const result = await execFileAsync('git', args, {
        cwd: directory,
        encoding: 'utf8',
        timeout: 15_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      });
      return result.stdout;
    } catch {
      // Git stderr can contain filesystem paths and credential-bearing remote URLs.
      throw new Error('Unable to inspect the requested local Git repository or reference.');
    }
  };
  const optional = async (args: string[]): Promise<string | null> => {
    try { return (await git(args)).trim() || null; } catch { return null; }
  };
  if ((await git(['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') {
    throw new Error('Git capture requires a working tree.');
  }
  const branch = await optional(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const head = await optional(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!head && !branch) throw new Error('Unable to resolve the current Git checkout.');
  const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const records = status.split('\0');
  let tracked = 0;
  let untracked = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const code = record.slice(0, 2);
    if (code === '??') untracked++;
    else {
      tracked++;
      // -z emits a second pathname for renames/copies. It is not another status.
      if (/[RC]/.test(code)) i++;
    }
  }
  const gitDir = (await git(['rev-parse', '--absolute-git-dir'])).trim();
  const commonDir = (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  const origin = await optional(['config', '--get', 'remote.origin.url']);
  const result: GitContext = {
    source: 'local-git',
    observedAt: new Date().toISOString(),
    repository: { origin: origin ? sanitizeOrigin(origin) : null },
    branch,
    head,
    unborn: head === null,
    worktree: gitDir !== commonDir,
    dirty: { tracked, untracked, isDirty: tracked + untracked > 0 },
  };
  if (options.baseRef !== undefined) {
    if (!options.baseRef.trim() || /[\r\n\0]/.test(options.baseRef)) {
      throw new Error('A valid base Git reference is required.');
    }
    const commit = (await git(['rev-parse', '--verify', '--end-of-options', `${options.baseRef}^{commit}`])).trim();
    // rev-list avoids treating an execution error as a negative ancestry result.
    const ancestry = head ? await git(['rev-list', '--count', `${head}..${commit}`]) : null;
    result.base = { ref: options.baseRef, commit, isAncestorOfHead: ancestry === null ? null : ancestry.trim() === '0' };
  }
  // Detect a concurrent checkout/commit instead of attaching inconsistent metadata.
  const finalHead = await optional(['rev-parse', '--verify', 'HEAD^{commit}']);
  const finalBranch = await optional(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (finalHead !== head || finalBranch !== branch) {
    throw new Error('The Git checkout changed during capture; capture it again.');
  }
  return result;
}
