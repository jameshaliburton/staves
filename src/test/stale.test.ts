// staves_stale reports how much moved under a job. The number has to mean what the sentence says.
//
// It counted every commit in the repository since the job was described, then printed "281
// commit(s) touched src/foo.ts" when eight had. On a busy week that tells a person to re-describe
// their whole board, which is exactly the advice the board exists to avoid giving.
//
// Real git, real commits: the bug was in what git was asked, so a fake git could not have caught it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stale } from "../stale.js";
import type { Board } from "../model.js";

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

function repo() {
  const root = mkdtempSync(path.join(tmpdir(), "staves-stale-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, ".staves"), { recursive: true });
  const write = (file: string, text: string) => {
    writeFileSync(path.join(root, file), text);
    git(root, "add", "-A");
    git(root, "commit", "-qm", `${file}: ${text}`);
  };
  return { root, write, head: () => git(root, "rev-parse", "HEAD") };
}

const board = (commit: string, sources: string[]): Board => ({
  id: "b", title: "b", tracks: [], artifacts: [],
  jobs: [{ id: "j", name: "A job", track: "t", inputs: [], outputs: [],
    sources: sources.map((p) => ({ path: p })),
    provenance: { source: "agent", by: "t", commit } } as any],
} as any);

test("counts only the commits that touched the job's own sources", () => {
  const { root, write, head } = repo();
  try {
    write("src/mine.ts", "first");
    const described = head();
    write("src/mine.ts", "second");        // 1 commit under the job
    for (let i = 0; i < 9; i++) write("src/elsewhere.ts", `v${i}`);   // 9 that are not

    const [found, ...rest] = stale(board(described, ["src/mine.ts"]), path.join(root, ".staves"));
    assert.deepEqual(rest, []);
    assert.deepEqual(found.files, ["src/mine.ts"]);
    // The repository moved ten commits. One of them is this job's business.
    assert.equal(Number(git(root, "rev-list", "--count", `${described}..HEAD`)), 10);
    assert.equal(found.commits, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a job whose sources never moved is not stale, however busy the repository", () => {
  const { root, write, head } = repo();
  try {
    write("src/mine.ts", "first");
    const described = head();
    for (let i = 0; i < 12; i++) write("src/elsewhere.ts", `v${i}`);
    assert.deepEqual(stale(board(described, ["src/mine.ts"]), path.join(root, ".staves")), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("uncommitted work counts as changed, with no commits to claim", () => {
  const { root, write, head } = repo();
  try {
    write("src/mine.ts", "first");
    const described = head();
    writeFileSync(path.join(root, "src/mine.ts"), "edited, not committed");

    const [found] = stale(board(described, ["src/mine.ts"]), path.join(root, ".staves"));
    assert.deepEqual(found.files, ["src/mine.ts"]);
    assert.equal(found.commits, 0, "nothing was committed, so no commit touched it");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
