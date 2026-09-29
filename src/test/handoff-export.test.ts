import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Store } from "../store.js";
import { boardHandler, liveFor } from "../server.js";
import type { WorkflowExport } from "../export.js";

for (const mode of ["local", "cloud", "host"] as const) {
  const hosted = mode !== "local";
  test(`Share exports ${mode} connection instructions for the selected board`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), "staves-handoff-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const disk = new Store(path.join(root, ".staves"));
    await disk.append("selected", [
      { t: "board", id: "internal-id", title: "Selected workflow" },
      { t: "track", track: { id: "person", name: "Reviewer", kind: "person" } },
      { t: "job", job: { id: "review", name: "Review", track: "person", inputs: [], outputs: [], status: "draft", provenance: { source: "human" } } },
    ], "human");
    const store = mode === "cloud" ? new Store(`cloud:${path.basename(root)}`) : disk;
    if (mode === "cloud") store.entries = name => disk.entries(name);
    store.watch = () => () => {};
    const presence = liveFor(store.dir).presence;
    t.after(() => presence.clear());
    presence.set("other", { name: "Other agent", board: "other", since: "now", last: "now" });
    presence.set("model", { name: "Model", sampling: true, since: "now", last: "now" });
    const handler = boardHandler(store, mode === "host" ? "/b/workspace-token" : hosted ? "" : "/b/local");
    const request = async () => {
      let output = "";
      const req = {
        url: "/handoff-export?board=selected", method: "POST",
        async *[Symbol.asyncIterator]() { yield JSON.stringify({ purpose: "prototype", jobIds: ["review"] }); },
      } as IncomingMessage;
      const res = { statusCode: 200, setHeader() {}, end(value: string) { output = value; } } as unknown as ServerResponse;
      await handler(req, res);
      assert.equal(res.statusCode, 200, output);
      return JSON.parse(output) as { packet: WorkflowExport; formats: Record<string, string> };
    };
    const result = await request();
    assert.match(result.formats.prompt, /^FIRST, CONNECT/);
    assert.match(result.formats.prompt, hosted ? /cli connect/ : /cli init/);
    assert.match(result.formats.prompt, /id:\s+selected/);
    assert.match(result.formats.prompt, /Build a reviewable prototype/);
    assert.doesNotMatch(result.formats.prompt, /Other agent|ALREADY CONNECTED: Model/);
    if (hosted) {
      assert.doesNotMatch(result.formats.prompt, /cloud:|cd </);
      assert.ok(!result.formats.prompt.includes(root));
    }
    else assert.ok(result.formats.prompt.includes(`${root}/.staves/selected.jsonl`));
    assert.equal(result.packet.source.boardId, "selected");
    assert.deepEqual(result.packet.board.jobs.map(job => job.id), ["review"]);
    assert.doesNotMatch(result.formats.markdown, /FIRST, CONNECT/);
    presence.set("agent", { name: "Codex", board: "selected", since: "now", last: "now" });
    assert.match((await request()).formats.prompt, /ALREADY CONNECTED: Codex/);
    assert.equal((await disk.entries("selected")).length, 3);
  });
}
