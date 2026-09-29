import test from "node:test";
import assert from "node:assert/strict";
import { fetchLangfuseEvidence, refreshLangfuseEvidence, executionEvidenceKey, langfuseTraceUrl, validateExecutionEvidence, validateLangfuseConnection } from "../langfuse.js";

const connection = { baseUrl: "https://cloud.langfuse.com", projectId: "project-1" };
const request = { traceId: "trace-1", observationId: "span-1", boardId: "board-1", jobId: "job-1" };
const env = { LANGFUSE_PUBLIC_KEY: "pk-test", LANGFUSE_SECRET_KEY: "secret-test" };
const observation = {
  id: "span-1", traceId: "trace-1", projectId: "project-1",
  startTime: "2026-09-14T09:00:00.000Z", endTime: "2026-09-14T09:00:01.250Z",
  name: "Prepare packet", level: "DEFAULT", environment: "production",
  metadata: { "staves.board_id": "board-1", "staves.job_id": "job-1", "staves.design_revision": "42", private: "secret prompt" },
  input: "sensitive input", output: "sensitive output", statusMessage: "private detail",
};
function mock(overrides: Record<string, unknown> = {}, project = "project-1") {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return Response.json(url.pathname === "/api/public/projects" ? { data: [{ id: project }] } : { data: [{ ...observation, ...overrides }] });
  };
  return { fetch: fetcher, env, calls, now: () => new Date("2026-09-14T10:00:00.000Z") };
}

test("public connection and evidence reject secrets, unsafe URLs, and unsafe IDs", () => {
  assert.deepEqual(validateLangfuseConnection({ ...connection, baseUrl: `${connection.baseUrl}/` }), connection);
  for (const baseUrl of ["http://example.com", "https://user:pass@example.com", "https://example.com/?key=x", "https://example.com/#x", "https://example.com/path", "javascript:alert(1)"]) {
    assert.throws(() => validateLangfuseConnection({ ...connection, baseUrl }));
  }
  assert.throws(() => validateLangfuseConnection({ ...connection, secretKey: "secret" }));
  assert.throws(() => validateLangfuseConnection({ ...connection, projectId: "../evil" }));
  assert.equal(validateLangfuseConnection({ ...connection, baseUrl: "http://localhost:3000" }).baseUrl, "http://localhost:3000");
  assert.throws(() => validateExecutionEvidence({ provider: "langfuse", projectId: "p", traceId: "t", observedAt: "yesterday", status: "observed" }));
});

test("reads an explicitly mapped observation with selected fields and preserves recorded revision", async () => {
  const deps = mock();
  const evidence = await fetchLangfuseEvidence(connection, request, deps);
  assert.deepEqual(evidence, {
    provider: "langfuse", baseUrl: connection.baseUrl, fetchedAt: "2026-09-14T10:00:00.000Z",
    mapping: {method: "instrumented", boardId: "board-1", jobId: "job-1"}, projectId: "project-1", traceId: "trace-1", observationId: "span-1",
    observedAt: observation.startTime, designRevision: "42", durationMs: 1250,
    name: "Prepare packet", environment: "production", status: "observed",
  });
  assert.equal(deps.calls.length, 2);
  assert.equal(deps.calls[1].url.searchParams.get("fields"), "core,basic,metadata");
  assert.equal(deps.calls[1].url.searchParams.get("limit"), "1");
  assert.equal(deps.calls[1].url.searchParams.get("fromStartTime"), "2026-08-15T10:00:00.000Z");
  assert.equal(deps.calls[0].init?.redirect, "error");
  assert.equal((deps.calls[0].init?.headers as Record<string,string>).Authorization, `Basic ${Buffer.from("pk-test:secret-test").toString("base64")}`);
  assert.equal(langfuseTraceUrl(connection, evidence), "https://cloud.langfuse.com/project/project-1/traces/trace-1?observation=span-1");
  assert.equal(langfuseTraceUrl({ ...connection, baseUrl: "https://other.test", projectId: "other" }, evidence), langfuseTraceUrl(connection, evidence));
  assert.throws(() => validateExecutionEvidence({ ...evidence, input: "secret" }));
});

test("a board cannot select the credential destination", async () => {
  const deps = mock();
  await assert.rejects(fetchLangfuseEvidence({ ...connection, baseUrl: "https://attacker.test" }, request, deps), /LANGFUSE_BASE_URL/);
  assert.equal(deps.calls.length, 0);
  await assert.rejects(fetchLangfuseEvidence(connection, request, { ...deps, env: {} }), /LANGFUSE_PUBLIC_KEY/);
  assert.equal(deps.calls.length, 0);
});

test("credentials and observation must belong to the selected project", async () => {
  const deps = mock({}, "other-project");
  await assert.rejects(fetchLangfuseEvidence(connection, request, deps), /project-scoped key/);
  assert.equal(deps.calls.length, 1);
  for (const overrides of [{ projectId: "other-project" }, { traceId: "other-trace" }, { id: "other-span" }]) {
    await assert.rejects(fetchLangfuseEvidence(connection, request, mock(overrides)), /identity/);
  }
});

test("mapping is explicit and revision cannot be relabeled", async () => {
  for (const metadata of [{}, { "staves.board_id": "board-1", "staves.job_id": "other-job" }]) {
    await assert.rejects(fetchLangfuseEvidence(connection, request, mock({ metadata })), /explicitly map/);
  }
  await assert.rejects(fetchLangfuseEvidence(connection, { ...request, designRevision: "99" }, mock()), /revision/);
  const evidence = await fetchLangfuseEvidence(connection, request, mock({ metadata: { "staves.board_id": "board-1", "staves.job_id": "job-1" }, endTime: null, level: "ERROR" }));
  assert.equal(evidence.designRevision, undefined);
  assert.equal(evidence.durationMs, undefined);
  assert.equal(evidence.status, "error");
});

test("invalid timestamps and reversed durations are rejected", async () => {
  await assert.rejects(fetchLangfuseEvidence(connection, request, mock({ endTime: "2026-09-14T08:00:00.000Z" })), /before/);
  await assert.rejects(fetchLangfuseEvidence(connection, { ...request, fromStartTime: "2026-09-15T00:00:00Z" }, mock()), /before/);
});

test("HTTP and transport errors never echo provider payloads or secrets", async () => {
  await assert.rejects(fetchLangfuseEvidence(connection, request, { env, fetch: async () => new Response("secret-test sensitive payload", { status: 401 }) }), (error: Error) => error.message === "Langfuse request failed (HTTP 401)");
  await assert.rejects(fetchLangfuseEvidence(connection, request, { env, fetch: async () => { throw new Error("secret-test"); } }), (error: Error) => !error.message.includes("secret-test"));
  await assert.rejects(fetchLangfuseEvidence(connection, request, { env, fetch: async () => new Response("x".repeat(1_048_577)) }), /oversized/);
});


test("untagged historical observations require a reviewable association, never invented instrumentation", async () => {
  const evidence = await fetchLangfuseEvidence(connection, { ...request, associationRationale: "This call supplies the review packet", fetchedBy: "agent:codex" }, mock({ metadata: null }));
  assert.equal(evidence.mapping?.method, "proposed");
  assert.equal(evidence.mapping?.reviewedBy, undefined);
  assert.equal(evidence.fetchedBy, "agent:codex");
  assert.equal(evidence.designRevision, undefined);
  await assert.rejects(fetchLangfuseEvidence(connection, { ...request, associationRationale: "Reassign" }, mock({ metadata: { "staves.job_id": "other" } })), /conflicting/);
});

test("refresh appends an exact capture lineage while preserving prior unfinished evidence", async () => {
  const prior = await fetchLangfuseEvidence(connection, request, mock({ endTime: null }));
  const before = structuredClone(prior);
  const later = { ...mock(), now: () => new Date("2026-09-14T11:00:00.000Z") };
  const refreshed = await refreshLangfuseEvidence(connection, prior, request, later);
  assert.equal(refreshed.durationMs, 1250);
  assert.equal(refreshed.supersedes, executionEvidenceKey(prior));
  assert.notEqual(executionEvidenceKey(refreshed), executionEvidenceKey(prior));
  assert.deepEqual(prior, before);
  await assert.rejects(refreshLangfuseEvidence({ ...connection, baseUrl: "https://other.test" }, prior, request, later), /source/);
  await assert.rejects(refreshLangfuseEvidence(connection, prior, { ...request, jobId: "other" }, later), /mapping/);
  await assert.rejects(refreshLangfuseEvidence(connection, { ...prior, retraction: { at: later.now().toISOString(), by: "human", reason: "Wrong association" } }, request, later), /Retracted/);
});

test("refresh preserves a reviewed historical association but does not add review to a proposal", async () => {
  const prior = await fetchLangfuseEvidence(connection, { ...request, associationRationale: "Supplies the packet" }, mock({ metadata: {} }));
  const later = { ...mock({ metadata: {} }), now: () => new Date("2026-09-14T11:00:00.000Z") };
  assert.equal((await refreshLangfuseEvidence(connection, prior, request, later)).mapping?.method, "proposed");
  prior.mapping = { ...prior.mapping!, method: "reviewed", reviewedBy: "human:J", reviewedAt: "2026-09-14T10:30:00Z" };
  assert.deepEqual((await refreshLangfuseEvidence(connection, prior, request, later)).mapping, prior.mapping);
});

test("probe discovers the credential project and confirms bounded v2 access", async () => {
  const { probeLangfuseAccess } = await import("../langfuse.js");
  const deps = mock();
  const result = await probeLangfuseAccess(undefined, deps);
  assert.deepEqual(result.connection, connection);
  assert.equal(result.access, "verified");
  assert.equal(deps.calls[1].url.searchParams.get("fields"), "core");
  assert.equal(deps.calls[1].url.searchParams.get("limit"), "1");
  await assert.rejects(probeLangfuseAccess({ ...connection, projectId: "wrong" }, mock()), /do not match/);
});

test("discovery allowlists metadata, bounds reads, and exposes cursor without attaching", async () => {
  const { discoverLangfuseObservations } = await import("../langfuse.js");
  const deps = mock();
  const result = await discoverLangfuseObservations(connection, { name: "Prepare packet", limit: 2 }, deps);
  assert.equal(result.observations[0].observationId, "span-1");
  assert.equal(result.observations[0].mapping["staves.job_id"], "job-1");
  assert.equal(JSON.stringify(result).includes("secret prompt"), false);
  assert.equal(JSON.stringify(result).includes("sensitive input"), false);
  assert.equal(deps.calls[1].url.searchParams.get("fields"), "core,basic,metadata");
  assert.equal(deps.calls[1].url.searchParams.get("name"), "Prepare packet");
  await assert.rejects(discoverLangfuseObservations(connection, { limit: 51 }, mock()));
  await assert.rejects(discoverLangfuseObservations(connection, {}, mock({ projectId: "other" })), /does not match/);
});
