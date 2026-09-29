import type { Board } from "./model.js";

export interface BaselineMetadata {
  pinned: true;
  id: string;
  name: string;
  sourceBoard: string;
  sourceRevision: string;
  capturedAt: string;
  capturedBy: string;
}

/** The original capture cannot be recovered from a mutable legacy reference. */
export interface LegacyBaselineMetadata {
  pinned: false;
  sourceBoard: string;
  name: string;
}

export function validateBaseline(snapshot: Board, metadata: BaselineMetadata): void {
  if (!metadata || metadata.pinned !== true || [metadata.id, metadata.name, metadata.sourceBoard, metadata.sourceRevision, metadata.capturedAt, metadata.capturedBy].some(value => typeof value !== "string" || !value.trim()) || !Number.isFinite(Date.parse(metadata.capturedAt))) throw new Error("Invalid baseline metadata.");
  if (!snapshot || snapshot.id !== metadata.sourceBoard || snapshot.baseline || snapshot.base || ![snapshot.jobs, snapshot.tracks, snapshot.artifacts, snapshot.questions, snapshot.comments, snapshot.regions].every(Array.isArray)) throw new Error("Invalid baseline snapshot.");
}

/** Copy the materialized design; captures never nest another baseline. */
export function captureBaseline(board: Board, metadata: BaselineMetadata): { baseline: BaselineMetadata; snapshot: Board } {
  const snapshot = structuredClone(board);
  delete snapshot.baseline;
  delete snapshot.base;
  validateBaseline(snapshot, metadata);
  return { baseline: structuredClone(metadata), snapshot };
}
