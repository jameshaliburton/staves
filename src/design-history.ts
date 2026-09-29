import { executionEvidenceKey } from "./langfuse.js";
import type { DevelopmentRecord } from "./development.js";
import type { Board } from "./model.js";
import type { Store } from "./store.js";
import { fold, type Entry } from "./ops.js";
import { assessReturn, createAssessmentRequest, type AgentReturn } from "./assessment.js";
import { walkthroughBasis } from "./walkthrough-record.js";
import type { WalkthroughResult } from "./walkthrough.js";

export interface DesignHistoryAssessment {
  id: string;
  intent: "assess" | "implement" | "discuss";
  sourceRevision: number;
  actor: string;
  at: string;
  status: "current" | "stale" | "unavailable";
  returns: { commentId: string; actor: string; at: string; status: "current" | "stale" | "unavailable"; statusAtReceipt: "current" | "stale"; tests: AgentReturn["tests"]; evidence: "agent-report" }[];
}
export interface DesignHistoryNode {
  id: string;
  title: string;
  revision: number;
  baseline?: Board["baseline"];
  parentAvailable?: boolean;
  availability: "available" | "unavailable";
  development: DevelopmentRecord[];
  assessments: DesignHistoryAssessment[];
  walkthroughs: { id: string; name: string; sourceRevision: number; actor: string; at: string; status: "current" | "stale"; outcome: WalkthroughResult["status"]; evidence: "model-check" }[];
  acceptances: { seq: number; actor: string; at: string; alternativeBoard: string; baselineId?: string }[];
}
export interface DesignHistory {
  selectedBoard: string;
  nodes: DesignHistoryNode[];
  warnings: string[];
}

/** A scoped history projection, not a repository graph or a claim that a design was tested. */
export async function designHistory(store: Pick<Store, "list" | "entries">, selectedBoard: string): Promise<DesignHistory> {
  const names = [...new Set(await store.list())].sort();
  if (!names.includes(selectedBoard)) throw new Error("Selected board is not accessible.");
  const logs = new Map<string, Entry[]>();
  const unavailable = new Set<string>();
  await Promise.all(names.map(async name => {
    try { const entries = await store.entries(name); if (entries.length) logs.set(name, entries); else unavailable.add(name); }
    catch { unavailable.add(name); }
  }));
  const baselines = new Map<string, NonNullable<Board["baseline"]>>();
  for (const [name, entries] of logs) {
    const pin = entries.find(entry => entry.op.t === "baseline");
    const legacy = entries.find(entry => entry.op.t === "base");
    if (pin?.op.t === "baseline") baselines.set(name, structuredClone(pin.op.baseline));
    else if (legacy?.op.t === "base") baselines.set(name, { pinned: false, sourceBoard: legacy.op.board, name: legacy.op.board });
  }
  // Include siblings whose shared parent is no longer accessible, without reading that parent.
  const connected = new Set([selectedBoard]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, baseline] of baselines) if (connected.has(name) || connected.has(baseline.sourceBoard)) {
      for (const id of [name, baseline.sourceBoard]) if (!connected.has(id)) { connected.add(id); changed = true; }
    }
  }
  const boards = new Map<string, Board>();
  const resolve = (name: string, ancestors = new Set<string>()): Board | undefined => {
    if (boards.has(name)) return boards.get(name);
    if (ancestors.has(name) || unavailable.has(name)) { unavailable.add(name); return undefined; }
    const entries = logs.get(name);
    if (!entries) return undefined;
    const baseline = baselines.get(name);
    let base: Board | undefined;
    if (baseline && !baseline.pinned) {
      base = resolve(baseline.sourceBoard, new Set(ancestors).add(name));
      if (!base) { unavailable.add(name); return undefined; }
    }
    try { const board = fold(entries, base); boards.set(name, board); return board; }
    catch { unavailable.add(name); return undefined; }
  };
  const warnings: string[] = [];
  const nodes = names.filter(name => connected.has(name)).map(name => {
    const entries = logs.get(name) ?? [];
    const board = resolve(name);
    const baseline = baselines.get(name);
    const title = [...entries].reverse().find(entry => entry.op.t === "board");
    const node: DesignHistoryNode = {
      id: name, title: board?.title ?? (title?.op.t === "board" ? title.op.title : name),
      revision: entries.at(-1)?.seq ?? 0, baseline,
      parentAvailable: baseline ? logs.has(baseline.sourceBoard) : undefined,
      availability: board ? "available" : "unavailable", development: [], assessments: [], walkthroughs: [], acceptances: [],
    };
    if (!board) warnings.push(`${name}: design history could not be fully resolved.`);
    if (baseline && !logs.has(baseline.sourceBoard)) warnings.push(`${name}: parent is unavailable in this connection.`);
    const lineage = new Set<string>();
    let parent: string | undefined = name;
    while (parent) {
      if (lineage.has(parent)) { warnings.push(`${name}: cyclic design lineage.`); break; }
      lineage.add(parent); parent = baselines.get(parent)?.sourceBoard;
    }
    if (!board) return node;
    // Inherited assessment/run captures belong to the source version, not this alternative.
    const nativeComments = new Set(entries.flatMap(entry => entry.op.t === "comment" ? [entry.op.comment.id] : []));
    for (const comment of board.comments) {
      if (comment.development && nativeComments.has(comment.id)) node.development.push(structuredClone(comment.development));
      const record = comment.assessment;
      if (record?.kind === "request" && record.request.source.boardId === name) {
        const request = record.request;
        let status: DesignHistoryAssessment["status"] = "unavailable";
        try {
          const current = createAssessmentRequest(board, request.source.revision, { id: request.id, capturedBy: request.capturedBy, capturedAt: request.capturedAt, intent: request.intent, jobIds: request.packet.request.jobIds, includeSources: request.packet.request.includeSources, rationale: request.rationale, constraints: request.constraints, cases: request.cases });
          const retainedEvidence = request.packet.board.jobs.every(original => (original.executionEvidence ?? []).every(reference => {
            const present = current.packet.board.jobs.find(job => job.id === original.id)?.executionEvidence?.find(item => executionEvidenceKey(item) === executionEvidenceKey(reference));
            return present && JSON.stringify(present.retraction) === JSON.stringify(reference.retraction);
          }));
          status = retainedEvidence && current.basis === request.basis && current.source.base === request.source.base && JSON.stringify(current.source.baseline) === JSON.stringify(request.source.baseline) ? "current" : "stale";
        } catch { status = "stale"; /* Removed scope requires reconciliation. */ }
        node.assessments.push({ id: request.id, intent: request.intent, sourceRevision: request.source.revision, actor: request.capturedBy, at: request.capturedAt, status, returns: board.comments.flatMap(receipt => {
          const report = receipt.assessment;
          if (report?.kind !== "return" || report.requestId !== request.id) return [];
          let freshness: DesignHistoryAssessment["status"] = "unavailable";
          try { freshness = assessReturn(request, board, report.result).status; } catch { /* Preserve receipt even if current scope cannot be resolved. */ }
          return [{ commentId: receipt.id, actor: report.result.reportedBy, at: report.receivedAt, status: freshness, statusAtReceipt: report.statusAtReceipt, tests: structuredClone(report.result.tests), evidence: "agent-report" as const }];
        }) });
      }
      const run = comment.walkthrough;
      if (run && run.result.snapshot.id === name) node.walkthroughs.push({ id: run.id, name: run.result.case.name, sourceRevision: run.sourceRevision, actor: run.actor, at: run.at, status: walkthroughBasis(board) === run.basis ? "current" : "stale", outcome: run.result.status, evidence: "model-check" });
    }
    for (const entry of entries) if (entry.op.t === "acceptAlternative" && !entry.pending) node.acceptances.push({ seq: entry.seq, actor: entry.by, at: entry.at, alternativeBoard: entry.op.alternative.id, baselineId: entry.op.alternative.baseline?.pinned ? entry.op.alternative.baseline.id : undefined });
    return node;
  });
  return { selectedBoard, nodes, warnings: [...new Set(warnings)] };
}
