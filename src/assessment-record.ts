import { diff } from "./derive.js";
import type { Entry, Op } from "./ops.js";
import type { AssessmentRecord, Board } from "./model.js";
import { assessReturn, createAssessmentRequest } from "./assessment.js";

/** Ingestion only: history is replayed, never rewritten to match today's design. */
export function normalizeAssessmentRecord(board: Board, record: AssessmentRecord, actor: string, at: string, revision: number, pendingProposals = 0, baseline?: Board): AssessmentRecord {
  if (!record || (record.kind !== "request" && record.kind !== "return" && record.kind !== "delivery")) throw new Error("Invalid assessment record.");
  if (record.kind === "request") {
    const original = record.request;
    if (!original?.packet?.request || original.source?.boardId !== board.id) throw new Error("Assessment request must reference this board.");
    if (board.comments.some(comment => comment.assessment?.kind === "request" && comment.assessment.request.id === original.id)) throw new Error("Assessment requests are immutable. Create a new request.");
    const request = createAssessmentRequest(board, revision, {
      id: original.id, capturedBy: actor, capturedAt: at, intent: original.intent,
      jobIds: original.packet.request.jobIds, includeSources: original.packet.request.includeSources,
      cases: original.cases, rationale: original.rationale, constraints: original.constraints,
    });
    if (request.basis !== original.basis) throw new Error("The design changed while this assessment request was prepared. Review and request again.");
    if (baseline) request.changes = diff(baseline, board);
    request.packet.omitted.pendingProposals = pendingProposals;
    if (pendingProposals) request.packet.warnings.push(`${pendingProposals} unaccepted proposal(s) are excluded.`);
    if (board.base && !board.baseline?.pinned) request.packet.warnings.push("This legacy baseline is unpinned; its original capture cannot be recovered. The request preserves the design seen at capture.");
    return { kind: "request", request };
  }
  if (record.kind === "delivery") {
    const request = board.comments.find(comment => comment.assessment?.kind === "request" && comment.assessment.request.id === record.requestId)?.assessment;
    if (request?.kind !== "request") throw new Error("Delivery requires an existing assessment request.");
    const events = board.comments.flatMap(comment => comment.assessment?.kind === "delivery" && comment.assessment.requestId === record.requestId ? [comment.assessment.delivery] : []);
    const previous = events.at(-1);
    const status = record.delivery?.status;
    const permitted = previous?.status === "claimed" ? ["running", "failed"] : previous?.status === "running" ? ["completed", "failed"] : previous ? [] : ["claimed"];
    if (!permitted.includes(status)) throw new Error("Invalid request delivery transition.");
    if (previous && previous.actor !== actor) throw new Error("Only the claiming agent can update this request.");
    if (status === "completed" && request.request.intent !== "discuss" && !board.comments.some(comment => comment.assessment?.kind === "return" && comment.assessment.requestId === record.requestId)) throw new Error("Record a result before completing this request.");
    if (status === "completed" && request.request.intent === "discuss" && !record.delivery.note?.trim()) throw new Error("Summarize the conversation outcome before completing this request.");
    if (record.delivery.note !== undefined && (typeof record.delivery.note !== "string" || record.delivery.note.length > 2000)) throw new Error("Delivery note must be at most 2000 characters.");
    return { kind: "delivery", requestId: record.requestId, delivery: { status, actor, at, ...(record.delivery.note ? { note: record.delivery.note } : {}) } };
  }
  const requests = board.comments.flatMap(comment => comment.assessment?.kind === "request" && comment.assessment.request.id === record.requestId ? [comment.assessment.request] : []);
  if (requests.length !== 1) throw new Error("Return requires one existing assessment request.");
  const assessed = assessReturn(requests[0], board, { ...record.result, reportedBy: actor, reportedAt: at });
  return { kind: "return", requestId: record.requestId, result: assessed.result, statusAtReceipt: assessed.status, receivedAt: at };
}

/** Retain request identity even if an older client removed its visible comment. */
export function protectAssessmentHistory(board: Board, entries: Entry[], op: Op): void {
  const records = [...board.comments, ...entries.flatMap(entry => entry.op.t === "comment" ? [entry.op.comment] : entry.op.t === "baseline" ? entry.op.snapshot.comments : [])].filter(comment => comment.assessment);
  if ((op.t === "removeComment" || (op.t === "revert" && op.entity === "comment")) && records.some(comment => comment.id === op.id)) throw new Error("Assessment history is immutable. Add a correction or a new request.");
  if (op.t === "comment" && records.some(comment => comment.id === op.comment.id)) throw new Error("Assessment history is immutable. Add a new record.");
  if (op.t === "comment" && op.comment.assessment?.kind === "request") {
    const id = op.comment.assessment.request.id;
    if (records.some(comment => comment.assessment?.kind === "request" && comment.assessment.request.id === id)) throw new Error("Assessment request identity has already been used. Create a new request.");
  }
}
