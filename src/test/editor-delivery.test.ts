import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../store.js";
import { loadEditor } from "../server.js";

test("shipped editor serves mounted canvas assets, scenario UI and workspace API", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-editor-delivery-"));
  const store = new Store(dir);
  store.watch = () => () => {};
  await store.append("sample", [{ t: "board", id: "sample", title: "Delivery check" }], "human");
  const { editorHandler } = await loadEditor();
  const server = http.createServer(editorHandler(store, undefined, "/b/local"));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const html = await (await fetch(`${origin}/b/local/?board=sample`)).text();
    assert.match(html, /<base href="\/b\/local\/">/);
    assert.match(html, /src="\.\/rehearsal.js"/);
    assert.match(html, /src="\.\/history.js"/);
    assert.ok(html.includes('src="./real-conversation.js"'));
    assert.ok(html.indexOf('src="./real-conversation.js"') > html.indexOf('src="./history.js"'));
    assert.ok(html.includes('href="./real-conversation.css"'));
    const resources = [...html.matchAll(/(?:src|href)="(\.\/[^"?#]+\.(?:js|css))"/g)].map(match => match[1]);
    assert.ok(resources.length > 30);
    for (const resource of resources) {
      const response = await fetch(new URL(resource, `${origin}/b/local/`));
      assert.equal(response.status, 200, resource);
      assert.match(response.headers.get("content-type") || "", resource.endsWith(".css") ? /text\/css/ : /(?:java|ecma)script/, resource);
      assert.ok((await response.text()).length > 20, resource);
    }
    const scenario = await (await fetch(`${origin}/b/local/rehearsal.js`)).text();
    assert.match(scenario, /scenario-panel/);
    assert.match(scenario, /Test a scenario/);
    const history = await (await fetch(`${origin}/b/local/history.js`)).text();
    assert.match(history, /history-taskbar-button/);
    const workspace = await (await fetch(`${origin}/b/local/`)).text();
    assert.match(workspace, /<base href="\/b\/local\/">/);
    const data = await (await fetch(`${origin}/b/local/workspace-api`)).json() as { boards: { id: string }[] };
    assert.equal(data.boards[0].id, "sample");
    Object.assign(store, { setup: { codex: "codex mcp add staves --url https://example.test/mcp/token", cursor: { mcpServers: { staves: { url: "https://example.test/mcp/token" } } } } });
    const config = await (await fetch(`${origin}/b/local/workspace-config`)).text();
    assert.match(config, /https:\/\/example.test\/mcp\/token/);
    assert.ok(!config.includes(dir), "mounted setup must not expose server filesystem paths");
    const created = await fetch(`${origin}/b/local/workspace-api/boards`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New workflow", source: "blank", startMode: "manual" }),
    });
    assert.equal(created.status, 201);
    const result = await created.json() as { id: string; url: string };
    assert.equal(result.url, `/b/local/?board=${encodeURIComponent(result.id)}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
