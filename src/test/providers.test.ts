import test from "node:test";
import assert from "node:assert/strict";
import { byKey, normalizeModelConfig, testModelConnection, type ModelProvider } from "../providers.js";

const cases: { provider: ModelProvider; host: string; payload: unknown; stream: unknown[] }[] = [
  { provider: "anthropic", host: "api.anthropic.com", payload: { content: [{ text: "Hello" }] }, stream: [{ type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } }, { delta: { type: "text_delta", text: "lo" } }] },
  { provider: "openai", host: "api.openai.com", payload: { choices: [{ message: { content: "Hello" } }] }, stream: [{ choices: [{ delta: { content: "Hel" } }] }, { choices: [{ delta: { content: "lo" } }] }] },
  { provider: "gemini", host: "generativelanguage.googleapis.com", payload: { candidates: [{ content: { parts: [{ thought: true, text: "private reasoning" }, { text: "Hello" }] } }] }, stream: [{ candidates: [{ content: { parts: [{ thought: true, text: "private reasoning" }, { text: "Hel" }] } }] }, { candidates: [{ content: { parts: [{ text: "lo" }] } }] }] },
];
for (const fixture of cases) {
  test(`${fixture.provider} sends selected model and credentials to its endpoint and decodes text`, async (t) => {
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      assert.equal(new URL(url).hostname, fixture.host);
      assert.ok(!url.includes("secret-key"));
      const body = JSON.parse(String(init.body));
      if (fixture.provider === "gemini") {
        assert.match(url, /models\/custom-model:generateContent$/);
        assert.equal(body.systemInstruction.parts[0].text, "system");
        assert.equal(new Headers(init.headers).get("x-goog-api-key"), "secret-key");
      } else {
        assert.equal(body.model, "custom-model");
        assert.equal(body.stream, false);
        assert.equal(new Headers(init.headers).get(fixture.provider === "openai" ? "authorization" : "x-api-key"), fixture.provider === "openai" ? "Bearer secret-key" : "secret-key");
      }
      return Response.json(fixture.payload);
    });
    assert.equal(await byKey("secret-key", { provider: fixture.provider, model: "custom-model" })("system", "user"), "Hello");
  });
  test(`${fixture.provider} streams across byte boundaries and consumes final unterminated event`, async (t) => {
    const wire = fixture.stream.map((event, i) => `data:${i ? " " : ""}${JSON.stringify(event)}`).join("\r\n\r\n") + (fixture.provider === "openai" ? "\n\ndata: [DONE]" : "");
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) {
      for (const byte of new TextEncoder().encode(wire)) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } })));
    const parts: string[] = [];
    assert.equal(await byKey("key", { provider: fixture.provider })("system", "user", text => parts.push(text)), "Hello");
    assert.deepEqual(parts, ["Hel", "Hello"]);
  });
}
test("configuration preserves legacy defaults and rejects URLs and unknown providers", () => {
  assert.deepEqual(normalizeModelConfig(), { provider: "anthropic", model: "claude-sonnet-4-6" });
  assert.throws(() => normalizeModelConfig({ provider: "other" }), /Choose/);
  assert.throws(() => normalizeModelConfig({ provider: "gemini", model: "../keys?key=secret" }), /valid model ID/);
  assert.throws(() => byKey("\nsecret"), /valid Anthropic API key/);
});
test("provider errors never echo raw provider response or credentials", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("secret-key was rejected", { status: 401 }));
  await assert.rejects(byKey("secret-key", { provider: "openai" })("system", "user"), { message: "OpenAI: Check your API key and its access permissions." });
});
test("connection test proves generation access and returns selected configuration", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }));
  assert.deepEqual(await testModelConnection("key", { provider: "gemini", model: "my-model" }), { provider: "gemini", model: "my-model" });
});
test("empty and truncated responses fail instead of claiming a working connection", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: "" } }] }));
  await assert.rejects(testModelConnection("key", { provider: "openai" }), /returned no text/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: "partial" }, finish_reason: "length" }] }));
  await assert.rejects(byKey("key", { provider: "openai" })("s", "u"), /output limit/);
});

test("HTTP interview and reflect routes honor provider/model and surface key failures", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { Store } = await import("../store.js");
  const { boardHandler } = await import("../server.js");
  const dir = await mkdtemp(`${tmpdir()}/staves-provider-route-`);
  try {
    const store = new Store(dir);
    await store.append("test", [{ t: "board", id: "test", title: "Test", goal: "Help" }], "test");
    store.watch = () => () => {};
    const handler = boardHandler(store);
    const fetched: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      fetched.push(url);
      assert.equal(JSON.parse(String(init.body)).model, "gpt-custom");
      return new Response("credential-sensitive provider response", { status: 401 });
    });
    for (const route of ["interview", "reflect"]) {
      const output: string[] = [];
      const req = { method: "POST", url: `/${route}?board=test`, async *[Symbol.asyncIterator]() { yield JSON.stringify({ job: "board", said: "Help me", key: "key", provider: "openai", model: "gpt-custom" }); } } as unknown as import("node:http").IncomingMessage;
      const res = { statusCode: 200, setHeader() {}, end(text: string) { output.push(text); } } as unknown as import("node:http").ServerResponse;
      await handler(req, res);
      assert.equal(res.statusCode, 400);
      assert.match(JSON.parse(output[0]).error, /OpenAI: Check your API key/);
      assert.ok(!output[0].includes("credential-sensitive"));
    }
    assert.equal(fetched.length, 2);
    assert.ok(fetched.every(url => url === "https://api.openai.com/v1/chat/completions"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// A three-word question can still exhaust the reply budget: the interview answers with a reply and
// its suggestion cards, so the ceiling is the same work whichever provider answers.
test("every provider gets the same room to answer, and a truncated reply says what to do about it", async (t) => {
  const sent: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return Response.json(String(url).includes("anthropic") ? { content: [{ text: "OK" }] } : { choices: [{ message: { content: "OK" } }] });
  });
  await byKey("key", { provider: "anthropic" })("s", "u");
  await byKey("key", { provider: "openai" })("s", "u");
  assert.equal(sent[0].max_tokens, 4096, "Anthropic asked for the same room as OpenAI");
  assert.equal(sent[1].max_completion_tokens, 4096);
  t.mock.method(globalThis, "fetch", async () => Response.json({ content: [{ text: "half" }], stop_reason: "max_tokens" }));
  await assert.rejects(byKey("key", { provider: "anthropic" })("s", "u"), (error: Error) => {
    assert.match(error.message, /output limit/);
    assert.doesNotMatch(error.message, /shorten the request/i, 'the request was not the problem');
    assert.match(error.message, /smaller|part|piece/i, 'says what to ask for instead');
    return true;
  });
});

// The interviewer re-sends a ~5,900-token system prompt every turn and it never changes. Marking the
// end of it cacheable makes every turn after the first read it at a tenth of the price; the volatile
// board and transcript already live in the user message, on the right side of the breakpoint.
test("the unchanging system prompt is offered to the cache, and the volatile turn is not", async (t) => {
  const bodies: Record<string, any> = {};
  t.mock.method(globalThis, "fetch", async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    bodies[String(url).includes("anthropic") ? "anthropic" : String(url).includes("openai") ? "openai" : "gemini"] = body;
    return Response.json(String(url).includes("anthropic") ? { content: [{ text: "OK" }] }
      : String(url).includes("openai") ? { choices: [{ message: { content: "OK" } }] }
      : { candidates: [{ content: { parts: [{ text: "OK" }] } }] });
  });
  const system = "CRAFT".repeat(2000);
  for (const provider of ["anthropic", "openai", "gemini"] as const) await byKey("key", { provider })(system, "the board and the transcript");

  const blocks = bodies.anthropic.system;
  assert.ok(Array.isArray(blocks), "system is sent as blocks so a breakpoint can be placed");
  assert.equal(blocks.map((block: any) => block.text).join(""), system, "the prompt itself is unchanged");
  assert.deepEqual(blocks.at(-1).cache_control, { type: "ephemeral" }, "the breakpoint sits at the end of the system prompt");
  assert.equal(JSON.stringify(bodies.anthropic.messages).includes("cache_control"), false, "the volatile turn is never marked cacheable");

  // The other two cache prefixes automatically; they must keep working untouched.
  assert.equal(bodies.openai.messages[0].content, system);
  assert.equal(bodies.gemini.systemInstruction.parts[0].text, system);
  assert.equal(bodies.gemini.generationConfig.maxOutputTokens, 4096, "every provider gets the same room to answer");
});
