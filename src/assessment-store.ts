import type { z } from "zod";
import type { AssessmentDelivery, Board } from "./model.js";
import type { Store } from "./store.js";
import { fold, pending } from "./ops.js";
import { ulid } from "./ulid.js";
import { createAssessmentRequest, assessReturn, type AssessmentRequest, type AssessedReturn, type assessmentOptionsSchema } from "./assessment.js";

export type SaveAssessmentOptions = Omit<z.input<typeof assessmentOptionsSchema>, "id" | "capturedBy" | "capturedAt">;

function validateIdentity(name: string, actor?: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Invalid board name.");
  if (actor !== undefined && !actor.trim()) throw new Error("Assessment actor is required.");
}

/** Fold the exact local log whose revision is captured; legacy sources are explicitly mutable. */
async function capture(store: Store, name: string) {
  validateIdentity(name);
  const entries = await store.entries(name);
  if (!entries.length) throw new Error("Board does not exist.");
  const legacy = entries.find(entry => entry.op.t === "base");
  const base = legacy?.op.t === "base" ? await store.board(legacy.op.board) : undefined;
  return { board: fold(entries, base), revision: entries.at(-1)?.seq ?? 0, pendingProposals: pending(entries).length };
}

function originalRequest(board: Board, id: string): AssessmentRequest {
  const matches = board.comments.flatMap(comment => comment.assessment?.kind === "request" && comment.assessment.request.id === id ? [comment.assessment.request] : []);
  if (!matches.length) throw new Error("Assessment request not found.");
  if (matches.length !== 1) throw new Error("Duplicate assessment request records; reconcile before adding a return.");
  return matches[0];
}

export async function saveAssessmentRequest(store: Store, name: string, options: SaveAssessmentOptions, actor: string, expectedRevision?: number): Promise<AssessmentRequest> {
  validateIdentity(name, actor);
  const snapshot = await capture(store, name);
  if (expectedRevision !== undefined && expectedRevision !== snapshot.revision) throw new Error("The workflow changed since this preview. Prepare and review a new handoff.");
  const request = createAssessmentRequest(snapshot.board, snapshot.revision, { ...options, id: ulid(), capturedBy: actor, capturedAt: new Date().toISOString() });
  request.packet.omitted.pendingProposals = snapshot.pendingProposals;
  if (snapshot.pendingProposals) request.packet.warnings.push(`${snapshot.pendingProposals} unaccepted proposal(s) are excluded.`);
  if (snapshot.board.base && !snapshot.board.baseline?.pinned) request.packet.warnings.push("This legacy baseline is unpinned; its original capture cannot be recovered. The request preserves the design seen at capture.");
  const saved = await store.append(name, [{ t: "comment", comment: {
    id: `assessment:${request.id}`, about: "board", by: actor, at: request.capturedAt,
    text: `${request.intent === "implement" ? "Implementation request" : "Assess with my agent"}: ${request.packet.board.jobs.map(job => job.name).join(", ")} · revision ${request.source.revision}. ${request.rationale || "Review the captured workflow design."}`,
    assessment: { kind: "request", request },
  } }], actor);
  return structuredClone(originalRequest(saved, request.id));
}

export async function saveAssessmentReturn(store: Store, name: string, requestId: string, input: unknown, actor: string): Promise<AssessedReturn> {
  validateIdentity(name, actor);
  const snapshot = await capture(store, name);
  const request = originalRequest(snapshot.board, requestId);
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Agent return must be an object.");
  const receivedAt = new Date().toISOString();
  const assessed = assessReturn(request, snapshot.board, { ...input, reportedBy: actor, reportedAt: receivedAt });
  const commentId = `assessment-return:${ulid()}`;
  const saved = await store.append(name, [{ t: "comment", comment: {
    id: commentId, about: "board", by: actor, at: receivedAt, replyTo: `assessment:${requestId}`,
    text: `Agent report for ${requestId}: ${assessed.result.jobs.map(job => `${job.jobId}: ${job.conclusion} — ${job.reason}`).join("; ")}. Reports are not verified execution or design acceptance.`,
    assessment: { kind: "return", requestId, result: assessed.result, statusAtReceipt: assessed.status, receivedAt },
  } }], actor);
  const record = saved.comments.find(comment => comment.id === commentId)?.assessment;
  if (record?.kind !== "return") throw new Error("Saved assessment return was not found.");
  return assessReturn(originalRequest(saved, requestId), saved, record.result);
}

export interface SavedAssessment {
  delivery: AssessmentDelivery;
  development: import("./development.js").DevelopmentRecord[];
  request: AssessmentRequest;
  returns: (AssessedReturn & { commentId: string; receivedAt: string; statusAtReceipt: "current" | "stale" })[];
}

/** Recompute freshness without rewriting the historical receipt or source snapshot. */
export async function getAssessment(store: Store, name: string, id: string): Promise<SavedAssessment> {
  const { board } = await capture(store, name);
  const request = originalRequest(board, id);
  return {
    delivery: assessmentDelivery(board, request),
    development: board.comments.flatMap(comment => comment.development?.options.requestId === id ? [structuredClone(comment.development)] : []),
    request: structuredClone(request),
    returns: board.comments.flatMap(comment => {
      const record = comment.assessment;
      if (record?.kind !== "return" || record.requestId !== id) return [];
      return [{ ...assessReturn(request, board, record.result), commentId: comment.id, receivedAt: record.receivedAt, statusAtReceipt: record.statusAtReceipt }];
    }),
  };
}

function assessmentDelivery(board: Board, request: AssessmentRequest): AssessmentDelivery {
  return board.comments.flatMap(comment => comment.assessment?.kind === "delivery" && comment.assessment.requestId === request.id ? [comment.assessment.delivery] : []).at(-1) ?? { status: "queued", actor: request.capturedBy, at: request.capturedAt };
}

/** Board-scoped inbox. A queued request does not imply a running or reachable agent. */
export async function listAssessmentRequests(store: Store, name: string) {
  const { board } = await capture(store, name);
  return board.comments.flatMap(comment => comment.assessment?.kind === "request" ? [{ request: structuredClone(comment.assessment.request), delivery: assessmentDelivery(board, comment.assessment.request) }] : []);
}

export async function updateAssessmentDelivery(store: Store, name: string, id: string, input: { status: "claimed" | "running" | "completed" | "failed"; note?: string }, actor: string): Promise<AssessmentDelivery> {
  validateIdentity(name, actor);
  const { board } = await capture(store, name);
  originalRequest(board, id);
  const at = new Date().toISOString();
  const saved = await store.append(name, [{ t: "comment", comment: { id: `assessment-delivery:${ulid()}`, about: "board", by: actor, at, replyTo: `assessment:${id}`, text: `Agent request ${input.status}${input.note ? ": " + input.note : ""}`, assessment: { kind: "delivery", requestId: id, delivery: { ...input, actor, at } } } }], actor);
  return assessmentDelivery(saved, originalRequest(saved, id));
}
