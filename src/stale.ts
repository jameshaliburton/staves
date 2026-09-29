import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import type { Board, Id } from "./model.js";

export function repoRoot(stavesDir: string): string | null {
  let d = path.dirname(stavesDir);
  for (;;) { if (existsSync(path.join(d, ".git"))) return d; const up = path.dirname(d); if (up === d) return null; d = up; }
}
export function headCommit(root: string): string | undefined {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}
export interface Stale { job: Id; files: string[]; commits: number }
/** Jobs whose sources changed since the commit they were described at. Derived; never stored. */
export function stale(b: Board, stavesDir: string): Stale[] {
  const root = repoRoot(stavesDir); if (!root) return [];
  const out: Stale[] = [];
  const cache = new Map<string, string[]>();
  for (const j of b.jobs) {
    if (j.removed || !j.sources?.length || !j.provenance.commit) continue;
    const from = j.provenance.commit;
    let changed = cache.get(from);
    if (!changed) {
      const r = spawnSync("git", ["diff", "--name-only", `${from}..HEAD`], { cwd: root, encoding: "utf8" });
      const r2 = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
      changed = [...(r.status === 0 ? r.stdout.split("\n") : []), ...(r2.status === 0 ? r2.stdout.split("\n").map((l) => l.slice(3)) : [])].map((x) => x.trim()).filter(Boolean);
      cache.set(from, changed);
    }
    const files = changed.filter((f) => j.sources!.some((s) => f === s.path || f.startsWith(s.path.replace(/\/$/, "") + "/") || s.path.startsWith(f)));
    if (files.length) {
      const paths = [...new Set(files)];
      // Count commits that touched *these* files, not every commit in the repo since. Counting the
      // whole history made a busy afternoon read as "281 commits touched src/foo.ts" when eight had:
      // a number that tells you to re-describe everything says nothing about what actually moved.
      const c = spawnSync("git", ["rev-list", "--count", `${from}..HEAD`, "--", ...paths], { cwd: root, encoding: "utf8" });
      out.push({ job: j.id, files: paths, commits: c.status === 0 ? Number(c.stdout.trim()) : 0 });
    }
  }
  return out;
}
