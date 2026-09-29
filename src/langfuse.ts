import { z } from "zod";
import type { ExecutionEvidence, LangfuseConnection } from "./model.js";

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/, "Expected a stable identifier");
const shortText = z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/);
const timestamp = z.string().datetime({ offset: true });

function validatedBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Langfuse base URL must be an origin without credentials, path, query or fragment");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Langfuse requires HTTPS, except on localhost");
  }
  return url.origin;
}

const connectionSchema = z.object({
  baseUrl: z.string().url().max(2048),
  projectId: identifier,
}).strict();

const evidenceSchema = z.object({
  provider: z.literal("langfuse"),
  baseUrl: z.string().url().max(2048).transform(validatedBaseUrl).optional(),
  fetchedAt: timestamp.optional(),
  fetchedBy: shortText.optional(),
  mapping: z.object({
    method: z.enum(["instrumented", "proposed", "reviewed"]),
    boardId: identifier, jobId: identifier,
    rationale: z.string().min(1).max(2000).optional(),
    reviewedBy: shortText.optional(), reviewedAt: timestamp.optional(),
  }).strict().optional(),
  implementationRef: z.string().min(1).max(2048).optional(),
  supersedes: z.string().min(1).max(4096).optional(),
  retraction: z.object({ at: timestamp, by: shortText, reason: z.string().min(1).max(2000) }).strict().optional(),
  projectId: identifier,
  traceId: identifier,
  observationId: identifier.optional(),
  observedAt: timestamp,
  designRevision: shortText.optional(),
  environment: shortText.optional(),
  status: z.enum(["observed", "error"]),
  durationMs: z.number().finite().min(0).optional(),
  name: shortText.optional(),
}).strict();

export function validateLangfuseConnection(input: unknown): LangfuseConnection {
  const connection = connectionSchema.parse(input);
  return { ...connection, baseUrl: validatedBaseUrl(connection.baseUrl) };
}

export function validateExecutionEvidence(input: unknown): ExecutionEvidence {
  return evidenceSchema.parse(input);
}

export function langfuseTraceUrl(connectionInput: LangfuseConnection, evidenceInput: ExecutionEvidence): string {
  const connection = validateLangfuseConnection(connectionInput);
  const evidence = validateExecutionEvidence(evidenceInput);
  if (!evidence.baseUrl && evidence.projectId !== connection.projectId) throw new Error("Evidence belongs to a different Langfuse project");
  const url = new URL(`/project/${evidence.projectId}/traces/${evidence.traceId}`, evidence.baseUrl ?? connection.baseUrl);
  if (evidence.observationId) url.searchParams.set("observation", evidence.observationId);
  return url.toString();
}

export interface LangfuseEvidenceRequest {
  traceId: string;
  observationId: string;
  boardId: string;
  jobId: string;
  designRevision?: string;
  /** Untagged historical evidence is proposed for review, never automatically reviewed. */
  associationRationale?: string;
  fetchedBy?: string;
  implementationRef?: string;
  fromStartTime?: string;
  toStartTime?: string;
}

interface LangfuseDependencies {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Langfuse response");
  return value as Record<string, unknown>;
}


function langfuseReader(baseUrl: string, deps: LangfuseDependencies) {
  const env = deps.env ?? process.env;
  // A shared board must never choose the destination for the agent's credentials.
  const trustedOrigin = validatedBaseUrl(env.LANGFUSE_BASE_URL ?? env.LANGFUSE_HOST ?? "https://cloud.langfuse.com");
  if (baseUrl !== trustedOrigin) throw new Error("Set LANGFUSE_BASE_URL in the agent environment to this Langfuse origin before connecting");
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) throw new Error("Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in the coding agent environment");
  if (publicKey.includes(":")) throw new Error("Invalid Langfuse public key");
  const fetcher = deps.fetch ?? fetch;
  const read = async (path: string): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("Langfuse request failed; check the origin, connectivity and credentials");
    }
    if (!response.ok) throw new Error(`Langfuse request failed (HTTP ${response.status})`);
    // Even a misconfigured endpoint cannot feed unlimited trace payload into the agent.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Langfuse response");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1_048_576) throw new Error("Langfuse response exceeds the evidence size limit");
        chunks.push(part.value);
      }
      return record(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
    } catch {
      await reader.cancel().catch(() => {});
      throw new Error("Invalid or oversized Langfuse response");
    }
  };

  return read;
}

/** One bounded, credential-checked reader over the public API, for other modules that must not
 * build a second fetch path: same trusted origin, Basic auth, redirect refusal, timeout and size cap. */
export { langfuseReader, record as langfuseRecord, identifier as langfuseIdentifier, timestamp as langfuseTimestamp, validatedBaseUrl as validateLangfuseBaseUrl };

/** Read one explicitly mapped observation using project-scoped credentials held by the agent.
 * Uses v2 field selection to omit inputs/outputs. No response bodies enter errors or storage.
 */
export async function fetchLangfuseEvidence(
  connectionInput: LangfuseConnection,
  request: LangfuseEvidenceRequest,
  deps: LangfuseDependencies = {},
): Promise<ExecutionEvidence> {
  const connection = validateLangfuseConnection(connectionInput);
  for (const key of ["traceId", "observationId", "boardId", "jobId"] as const) identifier.parse(request[key]);
  if (request.designRevision !== undefined) shortText.parse(request.designRevision);
  const read = langfuseReader(connection.baseUrl, deps);

  const projects = await read("/api/public/projects");
  if (!Array.isArray(projects.data) || projects.data.length !== 1 || record(projects.data[0]).id !== connection.projectId) {
    throw new Error("Langfuse credentials do not match the board's project; use a project-scoped key");
  }
  const now = (deps.now ?? (() => new Date()))();
  const toStartTime = timestamp.parse(request.toStartTime ?? now.toISOString());
  const fromStartTime = timestamp.parse(request.fromStartTime ?? new Date(Date.parse(toStartTime) - 30 * 86_400_000).toISOString());
  if (Date.parse(fromStartTime) >= Date.parse(toStartTime)) throw new Error("Observation time range must start before it ends");
  const params = new URLSearchParams({
    fields: "core,basic,metadata", limit: "1", fromStartTime, toStartTime,
    filter: JSON.stringify([
      { type: "string", column: "id", operator: "=", value: request.observationId },
      { type: "string", column: "traceId", operator: "=", value: request.traceId },
    ]),
  });
  const result = await read(`/api/public/v2/observations?${params}`);
  if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error("Observation not found in the time range; it may not be ingested yet");
  const observation = record(result.data[0]);
  if (observation.id !== request.observationId || observation.traceId !== request.traceId || observation.projectId !== connection.projectId) {
    throw new Error("Langfuse observation identity does not match the requested project and trace");
  }
  const metadata = observation.metadata == null ? {} : record(observation.metadata);
  const instrumented = metadata["staves.board_id"] === request.boardId && metadata["staves.job_id"] === request.jobId;
  if (!instrumented) {
    if (metadata["staves.board_id"] !== undefined || metadata["staves.job_id"] !== undefined) throw new Error("Observation must explicitly map to this board and job; conflicting instrumentation cannot be reassigned");
    if (!request.associationRationale?.trim()) throw new Error("Observation must explicitly map to this board and job, or supply an association rationale for human review");
  }
  const revision = metadata["staves.design_revision"];
  if (request.designRevision !== undefined && revision !== request.designRevision) {
    throw new Error("Observation design revision does not match the requested revision");
  }
  const observedAt = timestamp.parse(observation.startTime);
  const endTime = observation.endTime == null ? undefined : timestamp.parse(observation.endTime);
  const durationMs = endTime === undefined ? undefined : Date.parse(endTime) - Date.parse(observedAt);
  if (durationMs !== undefined && durationMs < 0) throw new Error("Observation ends before it starts");
  return validateExecutionEvidence({
    provider: "langfuse", baseUrl: connection.baseUrl, projectId: connection.projectId,
    fetchedAt: now.toISOString(),
    ...(request.fetchedBy ? { fetchedBy: request.fetchedBy } : {}),
    mapping: { method: instrumented ? "instrumented" : "proposed", boardId: request.boardId, jobId: request.jobId,
      ...(!instrumented ? { rationale: request.associationRationale } : {}) },
    ...(request.implementationRef ? { implementationRef: request.implementationRef } : {}),
    traceId: request.traceId, observationId: request.observationId, observedAt,
    status: observation.level === "ERROR" ? "error" : "observed",
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(revision !== undefined ? { designRevision: revision } : {}),
    ...(typeof observation.name === "string" && observation.name ? { name: observation.name.slice(0, 200) } : {}),
    ...(typeof observation.environment === "string" && observation.environment ? { environment: observation.environment.slice(0, 200) } : {}),
  });
}

/** Identifies a capture, including fetch time; never changes when it is retracted. */
export function executionEvidenceKey(evidence: ExecutionEvidence): string {
  return JSON.stringify([evidence.provider, evidence.baseUrl ?? null, evidence.projectId, evidence.traceId, evidence.observationId ?? null, evidence.fetchedAt ?? null]);
}

/** A refresh is another bounded read of the exact source. It preserves the earlier capture. */
export async function refreshLangfuseEvidence(
  connection: LangfuseConnection, prior: ExecutionEvidence, request: LangfuseEvidenceRequest,
  deps: LangfuseDependencies = {},
): Promise<ExecutionEvidence> {
  validateExecutionEvidence(prior);
  if (prior.retraction) throw new Error("Retracted evidence cannot be refreshed; create a new reviewed association");
  if (prior.baseUrl !== undefined && prior.baseUrl !== validateLangfuseConnection(connection).baseUrl || prior.projectId !== connection.projectId || prior.traceId !== request.traceId || prior.observationId !== request.observationId) throw new Error("Refresh must retain the original evidence source");
  if (prior.mapping && (prior.mapping.boardId !== request.boardId || prior.mapping.jobId !== request.jobId)) throw new Error("Refresh must retain the original job mapping");
  const refreshed = await fetchLangfuseEvidence(connection, { ...request,
    associationRationale: prior.mapping?.rationale ?? request.associationRationale,
    implementationRef: request.implementationRef ?? prior.implementationRef,
  }, deps);
  if (executionEvidenceKey(refreshed) === executionEvidenceKey(prior)) throw new Error("Refresh needs a distinct fetch timestamp");
  // Reuse only an already reviewed association to the same source and job.
  if (prior.mapping?.method === "reviewed" && refreshed.mapping?.method === "proposed") refreshed.mapping = structuredClone(prior.mapping);
  return { ...refreshed, supersedes: executionEvidenceKey(prior) };
}

/** Verify project-scoped credentials and v2 read access without retrieving trace contents. */
export async function probeLangfuseAccess(connectionInput?: LangfuseConnection, deps: LangfuseDependencies = {}) {
  const env = deps.env ?? process.env;
  const baseUrl = connectionInput ? validateLangfuseConnection(connectionInput).baseUrl
    : validatedBaseUrl(env.LANGFUSE_BASE_URL ?? env.LANGFUSE_HOST ?? "https://cloud.langfuse.com");
  const read = langfuseReader(baseUrl, deps);
  const projects = await read("/api/public/projects");
  if (!Array.isArray(projects.data) || projects.data.length !== 1) throw new Error("Use a project-scoped Langfuse key");
  const projectId = identifier.parse(record(projects.data[0]).id);
  if (connectionInput && projectId !== connectionInput.projectId) throw new Error("Langfuse credentials do not match the board's project; use a project-scoped key");
  const verifiedAt = (deps.now ?? (() => new Date()))().toISOString();
  const params = new URLSearchParams({ fields: "core", limit: "1", fromStartTime: new Date(Date.parse(verifiedAt) - 86_400_000).toISOString(), toStartTime: verifiedAt });
  const observations = await read(`/api/public/v2/observations?${params}`);
  if (!Array.isArray(observations.data)) throw new Error("Langfuse v2 observation access could not be verified");
  return { connection: { baseUrl, projectId }, access: "verified" as const, verifiedAt, observationsReadable: true as const };
}

export interface LangfuseDiscoveryRequest {
  fromStartTime?: string;
  toStartTime?: string;
  traceId?: string;
  name?: string;
  environment?: string;
  cursor?: string;
  limit?: number;
}

/** One bounded page. Returns only allowlisted metadata; finding a candidate never attaches it. */
export async function discoverLangfuseObservations(connectionInput: LangfuseConnection, request: LangfuseDiscoveryRequest = {}, deps: LangfuseDependencies = {}) {
  const connection = validateLangfuseConnection(connectionInput);
  const read = langfuseReader(connection.baseUrl, deps);
  const projects = await read("/api/public/projects");
  if (!Array.isArray(projects.data) || projects.data.length !== 1 || record(projects.data[0]).id !== connection.projectId) throw new Error("Langfuse credentials do not match the board's project; use a project-scoped key");
  const toStartTime = timestamp.parse(request.toStartTime ?? (deps.now ?? (() => new Date()))().toISOString());
  const fromStartTime = timestamp.parse(request.fromStartTime ?? new Date(Date.parse(toStartTime) - 30 * 86_400_000).toISOString());
  if (Date.parse(fromStartTime) >= Date.parse(toStartTime)) throw new Error("Observation time range must start before it ends");
  const limit = z.number().int().min(1).max(50).parse(request.limit ?? 20);
  const params = new URLSearchParams({ fields: "core,basic,metadata", limit: String(limit), fromStartTime, toStartTime });
  if (request.traceId !== undefined) params.set("traceId", identifier.parse(request.traceId));
  if (request.name !== undefined) params.set("name", shortText.parse(request.name));
  if (request.environment !== undefined) params.set("environment", shortText.parse(request.environment));
  if (request.cursor !== undefined) params.set("cursor", z.string().min(1).max(4096).parse(request.cursor));
  const response = await read(`/api/public/v2/observations?${params}`);
  if (!Array.isArray(response.data) || response.data.length > limit) throw new Error("Invalid Langfuse observation page");
  const observations = response.data.map(value => {
    const row = record(value);
    if (row.projectId !== connection.projectId) throw new Error("Langfuse observation project does not match");
    const metadata = row.metadata == null ? {} : record(row.metadata);
    const observationId = identifier.parse(row.id), traceId = identifier.parse(row.traceId);
    const mapping: Record<string, string> = {};
    for (const key of ["staves.board_id", "staves.job_id", "staves.design_revision"]) {
      if (typeof metadata[key] === "string") mapping[key] = shortText.parse(metadata[key]);
    }
    return { observationId, traceId, observedAt: timestamp.parse(row.startTime),
      ...(typeof row.name === "string" ? { name: shortText.parse(row.name) } : {}),
      ...(typeof row.environment === "string" ? { environment: shortText.parse(row.environment) } : {}),
      status: row.level === "ERROR" ? "error" : "observed", mapping,
      traceUrl: `${connection.baseUrl}/project/${connection.projectId}/traces/${traceId}?observation=${observationId}` };
  });
  const meta = response.meta == null ? {} : record(response.meta);
  const nextCursor = typeof meta.cursor === "string" ? z.string().max(4096).parse(meta.cursor) : null;
  return { connection, fromStartTime, toStartTime, observations, nextCursor,
    meaning: "Candidates only. Confirm an instrumented mapping or propose an association with a rationale before attaching evidence. An empty page does not prove a job never ran." };
}
