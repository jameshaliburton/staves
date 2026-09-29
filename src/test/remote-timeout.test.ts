import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DAEMON_TIMEOUT, daemonTimeout, RemoteStore } from "../remote.js";

/** A daemon that accepts the connection and then says nothing at all — the wedged case. */
async function silent(): Promise<{ url: string; requests: () => number; close: () => Promise<void> }> {
  let requests = 0;
  const server = createServer(() => { requests++; });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests: () => requests,
    close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }),
  };
}

test("a daemon that never answers is a sentence, not a hang", async t => {
  const daemon = await silent();
  t.after(() => daemon.close());
  const store = new RemoteStore(daemon.url, "agent", 250);
  await assert.rejects(store.list(), (error: unknown) => {
    assert.equal((error as Error).message, "The local Staves daemon did not answer within 250 milliseconds.");
    return true;
  });
  await assert.rejects(store.board("orders"), /did not answer within/);
  await assert.rejects(store.append("orders", [], "human:j"), /did not answer within/);
  await assert.rejects(store.undo("orders"), /did not answer within/);
  // Presence is best-effort and stays that way; it must not throw the timeout at the caller.
  await store.hello("id", "agent");
  await store.bye("id");
  assert.ok(daemon.requests() >= 4, "every call reached the daemon and gave up on its own");
});

test("the deadline every call carries is ten seconds, and says so", () => {
  assert.equal(DAEMON_TIMEOUT, 10_000);
  assert.equal(new RemoteStore("http://127.0.0.1:1").timeoutMs, DAEMON_TIMEOUT);
  assert.equal(daemonTimeout(DAEMON_TIMEOUT), "The local Staves daemon did not answer within 10 seconds.");
});
