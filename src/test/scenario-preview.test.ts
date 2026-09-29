import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Store } from "../store.js";
import { boardHandler } from "../server.js";

test("scenario previews are read-only and HTTP save rejects a superseded preview", async t => {
  const dir = await mkdtemp("/tmp/staves-scenario-api-");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.append("test", [{ t: "board", id: "test", title: "Scenario" }], "human");
  store.watch = () => () => {};
  const handler = boardHandler(store);
  const request = async (body: unknown) => {
    let output = "";
    const req = { url: "/walkthrough?board=test", method: "POST", async *[Symbol.asyncIterator]() { yield JSON.stringify(body); } } as IncomingMessage;
    const res = { statusCode: 200, setHeader() {}, end(value: string) { output = value; } } as unknown as ServerResponse;
    await handler(req, res);
    return { status: res.statusCode, output };
  };
  const example = { name: "A hypothetical request", initialArtifacts: [] };
  const preview = await request({ case: example, save: false });
  assert.equal(preview.status, 200);
  const basis = JSON.parse(preview.output).basis;
  assert.equal(typeof basis, "string");
  assert.equal((await store.entries("test")).length, 1);
  await store.append("test", [{ t: "setGoal", goal: "A different goal" }], "human");
  const saved = await request({ case: example, save: true, expectedBasis: basis });
  assert.ok(saved.status >= 400);
  assert.match(saved.output, /changed since this preview/);
  assert.equal((await store.entries("test")).length, 2);
});
