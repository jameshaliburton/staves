import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardUrl, guideUrl, resolveBase, workspaceUrl, LOCAL_BASE } from "../links.js";
import { boardLink } from "../mcp.js";

/** A fetch that answers for exactly one origin, so a probe is decided without a socket. */
const answering = (alive: string): typeof globalThis.fetch =>
  (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.startsWith(alive)) throw new Error("connection refused");
    return new Response("0.0.0", { status: 200 });
  }) as typeof globalThis.fetch;

const refusing: typeof globalThis.fetch = async () => { throw new Error("connection refused"); };

test("a board link is the base with the board named on it, in every scheme", () => {
  assert.equal(boardUrl("http://localhost:5178/b/local", "orders"), "http://localhost:5178/b/local?board=orders");
  assert.equal(boardUrl("https://staves.io", "9f3a"), "https://staves.io/?board=9f3a");
  assert.equal(boardUrl("https://host.example/b/tok/", "orders"), "https://host.example/b/tok/?board=orders");
  // Naming the board twice is one board, not two query parameters.
  assert.equal(boardUrl(boardUrl("https://staves.io", "a"), "b"), "https://staves.io/?board=b");
  assert.equal(boardLink("http://localhost:5178/b/local", "orders"), boardUrl("http://localhost:5178/b/local", "orders"));
});

test("the workspace is a page of its own on an account, and the base itself on a board server", () => {
  assert.equal(workspaceUrl("https://staves.io"), "https://staves.io/workspace");
  assert.equal(workspaceUrl("https://staves.example/"), "https://staves.example/workspace");
  assert.equal(workspaceUrl("http://localhost:5178/b/local"), "http://localhost:5178/b/local");
  assert.equal(workspaceUrl("https://host.example/b/tok/"), "https://host.example/b/tok/");
});

test("the guide is the one on staves.io unless the service is somebody else's", () => {
  assert.equal(guideUrl(), "https://staves.io/docs/connect/");
  assert.equal(guideUrl("https://staves.io"), "https://staves.io/docs/connect/");
  assert.equal(guideUrl("https://www.staves.io/"), "https://staves.io/docs/connect/");
  assert.equal(guideUrl("https://staves.example"), "https://staves.example/docs/connect/");
  // A local daemon serves boards, not documentation.
  assert.equal(guideUrl(LOCAL_BASE), "https://staves.io/docs/connect/");
  assert.equal(guideUrl("https://host.example/b/tok/"), "https://staves.io/docs/connect/");
  assert.equal(guideUrl("not a url"), "https://staves.io/docs/connect/");
});

test("a hosted project's boards are at the account, and always reachable by link", async () => {
  const base = await resolveBase({ dir: "/nowhere", credentials: { url: "https://staves.io/", token: "sta_x", email: "a@b.c" } }, refusing);
  assert.deepEqual(base, { url: "https://staves.io", live: true });
  assert.equal(workspaceUrl(base.url), "https://staves.io/workspace");
});

test("a local project's boards are at the running daemon, when one answers", async t => {
  const dir = await mkdtemp(join(tmpdir(), "staves-links-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".staves"), { recursive: true });
  const staves = join(dir, ".staves");
  await writeFile(join(staves, ".daemon.json"), JSON.stringify({ port: 5203, pid: 1, url: "http://localhost:5203", since: new Date().toISOString() }));

  const live = await resolveBase({ dir: staves }, answering("http://localhost:5203"));
  assert.deepEqual(live, { url: "http://localhost:5203/b/local", live: true });

  // The lock outlives the process that wrote it, so a lock is not an answer.
  const stale = await resolveBase({ dir: staves }, refusing);
  assert.deepEqual(stale, { url: LOCAL_BASE, live: false, hint: "start it with npx @staves/cli open" });
});

test("with no daemon at all the base is still nameable, with what starts it", async t => {
  const dir = await mkdtemp(join(tmpdir(), "staves-links-none-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const base = await resolveBase({ dir: join(dir, ".staves") }, refusing);
  assert.equal(base.url, LOCAL_BASE);
  assert.equal(base.live, false);
  assert.equal(base.hint, "start it with npx @staves/cli open");
  assert.equal(boardUrl(base.url, "orders"), "http://localhost:5178/b/local?board=orders");
});
