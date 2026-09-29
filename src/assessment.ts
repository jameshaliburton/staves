import { executionEvidenceKey } from "./langfuse.js";
import { z } from "zod";
import type { Board } from "./model.js";
import { workflowExport, type WorkflowExport } from "./export.js";
import type { WalkthroughCase } from "./walkthrough.js";

const text = z.string().trim().min(1);
const timestamp = text.refine(value => Number.isFinite(Date.parse(value)), "Invalid timestamp");
export const assessmentOptionsSchema = z.object({
  id: text,
  capturedBy: text,
  capturedAt: timestamp,
  intent: z.enum(["assess", "implement", "discuss"]).default("assess"),
  jobIds: z.array(text).min(1).optional(),
  includeSources: z.boolean().default(false),
  rationale: z.string().max(12000).default(""),
  constraints: z.string().max(12000).default(""),
  cases: z.array(z.object({
    name: text,
    initialArtifacts: z.array(text),
    conditions: z.record(z.boolean()).optional(),
    exitChoices: z.record(text).optional(),
    loopChoices: z.record(z.boolean()).optional(),
    assumptions: z.array(z.object({ id: text, note: text, status: z.enum(["active", "retracted"]), condition: text.optional(), value: z.boolean().optional() }).strict()).optional(),
  }).strict()).optional(),
}).strict();

export interface AssessmentRequest {
  schema: "staves.assessment-request";
  schemaVersion: 1;
  id: string;
  intent: "assess" | "implement" | "discuss";
  capturedBy: string;
  capturedAt: string;
  source: { boardId: string; revision: number; baseline?: Board["baseline"]; base?: string };
  /** Canonical semantic content, not a security hash. Revision and reports are excluded. */
  basis: string;
  packet: WorkflowExport;
  cases?: WalkthroughCase[];
  rationale: string;
  constraints: string;
  changes?: ReturnType<typeof import("./derive.js").diff>;
}

const referenceSchema = z.object({ kind: z.enum(["file", "commit", "pr", "execution"]), ref: text }).strict();
export const agentReturnSchema = z.object({
  requestId: text,
  reportedBy: text,
  reportedAt: timestamp,
  repositoryAccess: z.enum(["available", "unavailable"]),
  jobs: z.array(z.object({
    jobId: text,
    conclusion: z.enum(["feasible", "conditional", "blocked", "unknown", "reported-implemented"]),
    reason: text,
    references: z.array(referenceSchema).optional(),
  }).strict()).min(1),
  tests: z.array(z.object({
    jobIds: z.array(text).min(1),
    scope: text,
    status: z.enum(["pass", "fail", "not-run"]),
    reference: text.optional(),
  }).strict()).default([]),
  limitations: z.array(text),
  counterproposal: text.optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.jobs.map(job => job.jobId)).size !== value.jobs.length) context.addIssue({ code: "custom", message: "Duplicate job conclusions" });
  if (value.repositoryAccess === "unavailable") {
    if (!value.limitations.length || value.jobs.some(job => job.conclusion !== "unknown")) context.addIssue({ code: "custom", message: "Without repository access, report unknown conclusions and the access limitation" });
    if (value.tests.some(test => test.status !== "not-run")) context.addIssue({ code: "custom", message: "Without repository access, tests must be not-run" });
  }
  for (const test of value.tests) if (test.status !== "not-run" && !test.reference) context.addIssue({ code: "custom", message: "A reported test result requires a reference" });
  for (const job of value.jobs) if (job.conclusion === "reported-implemented" && !job.references?.some(ref => ["file", "commit", "pr"].includes(ref.kind))) context.addIssue({ code: "custom", message: "Reported implementation requires a file, commit or PR reference" });
});
export type AgentReturn = z.output<typeof agentReturnSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function basis(packet: WorkflowExport): string {
  const board = structuredClone(packet.board);
  // Recording an assessment, execution observation, or confirmation is not a design edit.
  board.comments = [];
  if (board.context) { delete board.context.agentProgress; delete board.context.langfuse; }
  for (const job of board.jobs) {
    delete job.implementation;
    delete job.executionEvidence;
    delete job.confirmedFields;
    job.status = "draft";
    job.provenance = { source: "derived" };
  }
  return canonical({ board, handoffs: packet.handoffs, boundaries: packet.boundaries });
}

/** Capture a read-only scoped packet. Intent is a request, never an executable action. */
export function createAssessmentRequest(board: Board, revision: number, input: z.input<typeof assessmentOptionsSchema>): AssessmentRequest {
  const options = assessmentOptionsSchema.parse(input);
  if (!Number.isInteger(revision) || revision < 0) throw new Error("Invalid board revision");
  const packet = workflowExport(board, revision, { jobIds: options.jobIds, includeSources: options.includeSources, constraints: options.constraints });
  const jobIds = new Set(packet.board.jobs.map(job => job.id));
  for (const example of options.cases ?? []) {
    if (example.initialArtifacts.some(id => !packet.board.artifacts.some(artifact => artifact.id === id))) throw new Error("Case artifact is outside the assessment scope");
    if ([...Object.keys(example.exitChoices ?? {}), ...Object.keys(example.loopChoices ?? {})].some(id => !jobIds.has(id))) throw new Error("Case job is outside the assessment scope");
    if (example.assumptions?.some(assumption => assumption.condition !== undefined && typeof assumption.value !== "boolean")) throw new Error("A condition assumption needs a boolean value");
  }
  return {
    schema: "staves.assessment-request", schemaVersion: 1, id: options.id,
    intent: options.intent, capturedBy: options.capturedBy, capturedAt: options.capturedAt,
    source: { boardId: board.id, revision, ...(board.baseline ? { baseline: structuredClone(board.baseline) } : {}), ...(board.base ? { base: board.base } : {}) },
    basis: basis(packet), packet, cases: options.cases,
    rationale: options.rationale, constraints: options.constraints,
  };
}

export interface AssessedReturn {
  request: AssessmentRequest;
  result: AgentReturn;
  status: "current" | "stale";
  requiresReconciliation: boolean;
  evidence: "agent-report";
  verifiedExecution: false;
}

/** Validate the agent report against its original snapshot; never alter board authority. */
export function assessReturn(request: AssessmentRequest, currentBoard: Board, input: unknown): AssessedReturn {
  const result = agentReturnSchema.parse(input);
  if (result.requestId !== request.id) throw new Error("Return does not match the original assessment request");
  const ids = new Set(request.packet.board.jobs.map(job => job.id));
  if (result.jobs.some(job => !ids.has(job.jobId)) || result.tests.some(test => test.jobIds.some(id => !ids.has(id)))) throw new Error("Return references jobs outside the assessment scope");
  if (request.intent !== "implement" && result.jobs.some(job => job.conclusion === "reported-implemented")) throw new Error("Implementation was not requested");
  let current = false;
  if (currentBoard.id === request.source.boardId) {
    try {
      const packet = workflowExport(currentBoard, request.source.revision, request.packet.request);
      const retainedEvidence = request.packet.board.jobs.every(original => (original.executionEvidence ?? []).every(reference => {
        const current = packet.board.jobs.find(job => job.id === original.id)?.executionEvidence?.find(item => executionEvidenceKey(item) === executionEvidenceKey(reference));
        return current && JSON.stringify(current.retraction) === JSON.stringify(reference.retraction);
      }));
      current = retainedEvidence && basis(packet) === request.basis && canonical(currentBoard.baseline) === canonical(request.source.baseline) && currentBoard.base === request.source.base;
    } catch { /* Removed scoped work requires reconciliation, never scope widening. */ }
  }
  return { request: structuredClone(request), result, status: current ? "current" : "stale", requiresReconciliation: !current, evidence: "agent-report", verifiedExecution: false };
}
