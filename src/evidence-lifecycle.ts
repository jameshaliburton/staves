import type { Board, ExecutionEvidence } from "./model.js";
import type { Op } from "./ops.js";
import { executionEvidenceKey, validateExecutionEvidence, validateLangfuseConnection } from "./langfuse.js";

export function isHumanEvidenceActor(actor: string): boolean {
  return actor === "human" || actor.startsWith("human:");
}

function sameSource(a: ExecutionEvidence, b: ExecutionEvidence): boolean {
  return a.baseUrl === b.baseUrl && a.projectId === b.projectId && a.traceId === b.traceId && a.observationId === b.observationId;
}

/** Validate at the write boundary, including the target of an acceptance operation.
 * For an accepted proposed mapping pass the actual reviewer actor with propose=false.
 * This does not authenticate actors; the transport supplies its trusted identity.
 */
export function validateEvidenceOperation(board: Board, op: Op, actor: string, propose = false): void {
  if (op.t === "job" || op.t === "updateJob") {
    const supplied = op.t === "job" ? op.job.executionEvidence : op.patch.executionEvidence;
    const id = op.t === "job" ? op.job.id : op.id;
    const prior = board.jobs.find(item => item.id === id)?.executionEvidence ?? [];
    if ((supplied !== undefined || op.t === "updateJob" && Object.hasOwn(op.patch, "executionEvidence")) && JSON.stringify(supplied) !== JSON.stringify(prior)) {
      throw new Error("Use evidence append, refresh or retraction operations; bulk job edits cannot replace captured evidence.");
    }
    return;
  }
  if (op.t !== "addExecutionEvidence" && op.t !== "retractExecutionEvidence") return;
  const job = board.jobs.find(item => item.id === op.id && !item.removed);
  if (!job) throw new Error("Execution evidence requires an existing active job.");
  const references = job.executionEvidence ?? [];
  if (op.t === "retractExecutionEvidence") {
    if (typeof op.key !== "string" || !op.key || op.key.length > 4096) throw new Error("Retraction requires a valid capture key.");
    if (typeof op.reason !== "string" || !op.reason.trim() || op.reason.length > 2000) throw new Error("Retraction requires a reason of up to 2,000 characters.");
    const prior = references.find(item => executionEvidenceKey(item) === op.key);
    if (!prior) throw new Error("The evidence capture to retract was not found.");
    if (prior.retraction) throw new Error("This evidence capture is already retracted.");
    return;
  }
  const evidence = validateExecutionEvidence(op.evidence);
  const connection = board.context?.langfuse && validateLangfuseConnection(board.context.langfuse);
  if (!connection || evidence.projectId !== connection.projectId || evidence.baseUrl !== undefined && evidence.baseUrl !== connection.baseUrl) throw new Error("Execution evidence must match the connected Langfuse origin and project.");
  if (evidence.retraction) throw new Error("Use the retraction operation to retract an existing capture.");
  if (references.length >= 100 && !references.some(item => executionEvidenceKey(item) === executionEvidenceKey(evidence))) throw new Error("Keep at most 100 evidence captures per job. Retraction preserves captured history.");
  const mapping = evidence.mapping;
  if (mapping && (mapping.boardId !== board.id || mapping.jobId !== op.id)) throw new Error("Evidence mapping must match this board and job.");
  const prior = evidence.supersedes ? references.find(item => executionEvidenceKey(item) === evidence.supersedes) : undefined;
  if (evidence.supersedes) {
    if (!prior || prior.retraction || !sameSource({ ...prior, baseUrl: prior.baseUrl ?? connection.baseUrl }, evidence)) throw new Error("Refresh requires an existing unretracted capture of the exact same source.");
    if (!evidence.fetchedAt || prior.fetchedAt !== undefined && Date.parse(evidence.fetchedAt) <= Date.parse(prior.fetchedAt)) throw new Error("Refresh must be fetched after the capture it supersedes.");
    if (prior.mapping && (prior.mapping.boardId !== mapping?.boardId || prior.mapping.jobId !== mapping?.jobId)) throw new Error("Refresh cannot change the job association.");
    if (references.some(item => item.supersedes === evidence.supersedes && executionEvidenceKey(item) !== executionEvidenceKey(evidence))) throw new Error("Refresh the latest capture; this capture already has a successor.");
  }
  if (mapping?.method === "reviewed") {
    if (!prior || prior.mapping?.method !== "reviewed" || ["method", "boardId", "jobId", "rationale", "reviewedBy", "reviewedAt"].some(key => mapping[key as keyof typeof mapping] !== prior.mapping?.[key as keyof typeof mapping])) throw new Error("Reviewed mappings are stamped by accepting a proposal, not supplied in a payload.");
  }
  if (mapping?.method === "proposed") {
    if (!mapping.rationale?.trim()) throw new Error("Historical associations require a review rationale.");
    if (mapping.reviewedBy || mapping.reviewedAt) throw new Error("A proposed association cannot claim prior review.");
    if (!propose && !isHumanEvidenceActor(actor)) throw new Error("Historical associations require human review; submit this evidence as a proposal.");
  }
  if (mapping?.method === "instrumented" && (mapping.reviewedBy || mapping.reviewedAt)) throw new Error("Instrumented mappings cannot claim a human review.");
}
