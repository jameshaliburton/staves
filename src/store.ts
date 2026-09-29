import { validateDesignConversationOperation } from "./design-conversation.js";
import { validateVocabularyOperation } from "./vocabulary.js";
import { normalizeDevelopmentRecord, protectDevelopmentHistory } from "./development.js";
import { normalizeWalkthroughRecord, protectWalkthroughHistory } from "./walkthrough-record.js";
import { validateEvidenceOperation } from "./evidence-lifecycle.js";
import { normalizeAssessmentRecord, protectAssessmentHistory } from "./assessment-record.js";
import { captureProposalBasis, validateProposalDecision, validateOperationPreconditions, type ProposalBasis } from "./proposals.js";
import { captureBaseline } from "./baseline.js";
import { promises as fs, existsSync, watch as fsWatch } from "node:fs";
import path from "node:path";
import { basisOf, sameExecutionEvidence, decode, encode, fold, migrate, pending, SCHEMA, targetOf, validateOpShape, type Entry, type Op, type HandoverSnapshot, type Suggestion } from "./ops.js";
import { ulid } from "./ulid.js";
import { handoverBasis, handoverPlan, type HandoverPlacement } from "./handover.js";
import { validateExecutionEvidence } from "./langfuse.js";
import type { Board } from "./model.js";

function matchesSnapshot(board: Board, snapshot: HandoverSnapshot): boolean {
  return snapshot.jobs.every(j => "absent" in j ? !board.jobs.some(x => x.id === j.id) : JSON.stringify(board.jobs.find(x => x.id === j.id)) === JSON.stringify(j))
    && snapshot.artifacts.every(a => "absent" in a ? !board.artifacts.some(x => x.id === a.id) : JSON.stringify(board.artifacts.find(x => x.id === a.id)) === JSON.stringify(a));
}

/** A board is one JSONL file under .staves/ in the project. */
export class Store {
  constructor(public dir: string) {}
  file(board: string) {
    return path.join(this.dir, `${board}.jsonl`);
  }
  async list(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    return (await fs.readdir(this.dir)).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, ""));
  }
  /** Whether this board exists at all, so a read can refuse a name nobody wrote rather than
   * answering about an empty board or quietly creating one. */
  async has(board: string): Promise<boolean> {
    return /^[a-zA-Z0-9_-]+$/.test(board) && existsSync(this.file(board));
  }
  /** When this board last changed *here*. An event log carries the timestamps of the work it
   * describes, which is not the same thing: a log replayed into a new workspace is new to that
   * workspace however old its entries are. Listings should order by this, or a board that arrived a
   * minute ago sorts below everything and reads as missing. */
  async touchedAt(board: string): Promise<string | null> {
    try { return (await fs.stat(this.file(board))).mtime.toISOString(); } catch { return null; }
  }
  /** Delete only an explicitly named board; callers obtain user confirmation first. */
  async deleteBoard(board: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(board)) throw new Error("Invalid board name.");
    await this.writes.get(board)?.catch(() => {});
    await fs.rm(this.file(board), { force: true });
    this.memo.delete(board);
  }
  protected async readLog(board: string): Promise<{ entries: Entry[]; revision: number }> {
    const f = this.file(board);
    const entries = existsSync(f) ? decode(await fs.readFile(f, "utf8")) : [];
    return { entries, revision: entries.length };
  }
  /** Persistence seam: remote adapters atomically check the captured revision. */
  protected async writeLog(board: string, entries: Entry[], _revision: number, mode: "append" | "replace"): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    if (mode === "append" && entries.some(e => e.op.t === "baseline")) await fs.writeFile(this.file(board), encode(entries), { flag: "wx" });
    else if (mode === "append") await fs.appendFile(this.file(board), encode(entries));
    else await fs.writeFile(this.file(board), encode(entries));
  }
  async entries(board: string): Promise<Entry[]> {
    return (await this.readLog(board)).entries;
  }
  private memo = new Map<string, { key: string; board: Board }>();
  async board(board: string): Promise<Board> {
    return this.loadBoard(board, new Set());
  }
  private async loadBoard(board: string, ancestors: Set<string>): Promise<Board> {
    if (ancestors.has(board)) throw new Error("Circular legacy baseline reference.");
    const seen = new Set(ancestors).add(board);
    const es = await this.entries(board);
    const baseOp = es.find(e => e.op.t === "base");
    const base = baseOp?.op.t === "base" ? await this.loadBoard(baseOp.op.board, seen) : undefined;
    const key = JSON.stringify([es, base]);
    const m = this.memo.get(board);
    if (m && m.key === key) return structuredClone(m.board);
    const b = fold(es, base);
    if (!es.length) b.id = board, (b.title = board);
    this.memo.set(board, { key, board: structuredClone(b) });
    return b;
  }
  async proposals(board: string): Promise<Entry[]> {
    return pending(await this.entries(board));
  }
  /** Append ops. `propose` makes them proposals: recorded, not applied until a person accepts. */
  private writes = new Map<string, Promise<unknown>>();
  async append(board: string, ops: Op[], by: string, propose = false, preconditions?: ProposalBasis[], suggestions?: (Suggestion | undefined)[]): Promise<Board> {
    const previous = this.writes.get(board) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(() => this.appendUnlocked(board, ops, by, propose, preconditions, suggestions));
    this.writes.set(board, write);
    try { return await write; } finally { if (this.writes.get(board) === write) this.writes.delete(board); }
  }
  private async appendUnlocked(board: string, ops: Op[], by: string, propose = false, preconditions?: ProposalBasis[], suggestions?: (Suggestion | undefined)[]): Promise<Board> {
    const snapshot = await this.readLog(board);
    const es = snapshot.entries;
    const validationEntries = structuredClone(es);
    const baseOp = es.find(entry => entry.op.t === "base");
    const baseEntries = baseOp?.op.t === "base" ? await this.board(baseOp.op.board) : undefined;
    if (ops.some(op => op.t === "baseline") && (es.length || propose)) throw new Error("Baseline can only initialize a new board.");
    if (es.some(e => e.op.t === "baseline") && ops.some(op => op.t === "base")) throw new Error("A pinned baseline cannot be replaced.");
    validateOperationPreconditions(fold(structuredClone(es), baseEntries), ops, preconditions);
    const add: Entry[] = [];
    for (const incomingOp of ops) {
      const op = structuredClone(incomingOp);
      const currentBoard = fold(validationEntries, baseEntries);
      validateOpShape(op);
      validateDesignConversationOperation(currentBoard, op, by, propose);
      protectAssessmentHistory(currentBoard, validationEntries, op);
      protectWalkthroughHistory(currentBoard, validationEntries, op);
      protectDevelopmentHistory(currentBoard, validationEntries, op);
      if (op.t === "acceptAlternative") {
        if (propose || !(by === "human" || by.startsWith("human:"))) throw new Error("Intended-design acceptance requires a human review.");
        if (!/^[a-zA-Z0-9_-]+$/.test(op.alternative.id) || op.alternative.id === board) throw new Error("Invalid alternative identity.");
        const trusted = await this.baseline(op.alternative.id);
        if (!trusted) throw new Error("Alternative baseline not found.");
        op.alternative = await this.board(op.alternative.id);
        op.baseline = trusted;
      }
      if (op.t === "comment") {
        if (op.comment.development) op.comment.development = normalizeDevelopmentRecord(currentBoard, op.comment.development, by, new Date().toISOString(), validationEntries.at(-1)?.seq ?? 0);
        if (op.comment.walkthrough) op.comment.walkthrough = normalizeWalkthroughRecord(currentBoard, op.comment.walkthrough, by, new Date().toISOString(), validationEntries.at(-1)?.seq ?? 0, pending(validationEntries).length);
        if (currentBoard.comments.some(comment => comment.id === op.comment.id && comment.assessment)) throw new Error("Assessment records are immutable. Add a new report.");
        if (op.comment.assessment) op.comment.assessment = normalizeAssessmentRecord(currentBoard, op.comment.assessment, by, new Date().toISOString(), validationEntries.at(-1)?.seq ?? 0, pending(validationEntries).length, validationEntries.find(entry => entry.op.t === "baseline")?.op.t === "baseline" ? (validationEntries.find(entry => entry.op.t === "baseline")!.op as Extract<Op, { t: "baseline" }>).snapshot : undefined);
      }
      if (propose && (op.t === "accept" || op.t === "reject")) throw new Error("Proposal decisions cannot themselves be proposed.");
      if (op.t === "accept" || op.t === "reject") validateProposalDecision(validationEntries, op, currentBoard);
      if (op.t === "addExecutionEvidence" && op.evidence.fetchedAt) op.evidence.fetchedBy = by;
      const entry: Entry = { seq: (validationEntries.at(-1)?.seq ?? 0) + 1, id: ulid(), v: SCHEMA, at: new Date().toISOString(), by, op: structuredClone(op), ...(propose ? { pending: true, proposalBasis: captureProposalBasis(currentBoard, op), ...(suggestions?.[add.length] ? { suggestion: suggestions[add.length] } : {}) } : {}), ...(basisOf(op).length ? { basis: basisOf(op) } : {}) };
      validateVocabularyOperation(currentBoard, op, by, propose);
      if (op.t === "accept") { const proposal = validationEntries.find(e => e.seq === op.seq && e.pending); if (proposal) { validateVocabularyOperation(currentBoard, proposal.op, by); validateDesignConversationOperation(currentBoard, proposal.op, by); } }
      validateEvidenceOperation(currentBoard, op, by, propose);
      const evidenceOp = op.t === "addExecutionEvidence" || op.t === "retractExecutionEvidence" ? op : op.t === "accept" ? es.find(entry => entry.seq === op.seq && entry.pending)?.op : undefined;
      if (evidenceOp) validateEvidenceOperation(currentBoard, evidenceOp, by, propose);
      if (evidenceOp?.t === "addExecutionEvidence") {
        const evidence = validateExecutionEvidence(evidenceOp.evidence);
        const current = fold(structuredClone(validationEntries), baseEntries ? structuredClone(baseEntries) : undefined);
        const job = current.jobs.find(item => item.id === evidenceOp.id && !item.removed);
        if (!job) throw new Error("Execution evidence requires an existing active job.");
        if (current.context?.langfuse?.projectId !== evidence.projectId) throw new Error("Execution evidence must match the connected Langfuse project.");
        const references = job.executionEvidence ?? [];
        if (references.length >= 100 && !references.some(item => sameExecutionEvidence(item, evidence))) throw new Error("Keep at most 100 evidence references per job.");
      }
      // Validate proposed operation semantics without committing it to subsequent applied state.
      if (propose) fold([...validationEntries, { ...entry, pending: false }], baseEntries);
      validationEntries.push(entry);
      add.push(entry);
      if (op.t === "revert" && op.expectedJobs && !matchesSnapshot(await this.board(board), { jobs: op.expectedJobs, artifacts: [] })) {
        throw new Error("Grouped tasks changed since this action. Resolve those edits before undo or redo.");
      }
      if (op.t === "restoreHandover") {
        if (!matchesSnapshot(await this.board(board), op.inverse)) throw new Error("Transferred work changed since this action. Resolve those edits before undo or redo.");
      }
      if (op.t === "handover") {
        if (!propose) throw new Error("Transfers must first be proposed for human review.");
        const expected = handoverPlan(await this.board(board), op.jobId, op.toTrack, op.placement);
        if (JSON.stringify(expected.ops[0]) !== JSON.stringify(op)) throw new Error("Transfer plan is invalid or stale. Analyze it again.");
        if (handoverBasis(await this.board(board)) !== op.basis) throw new Error("The board changed. Analyze this transfer again.");
      }
      if (op.t === "accept") {
        const proposal = es.find(e => e.seq === op.seq && e.pending && e.op.t === "handover");
        if (proposal?.op.t === "handover") {
          if (!pending(es).some(e => e.seq === op.seq)) throw new Error("This transfer has already been decided.");
          if (handoverBasis(await this.board(board)) !== proposal.op.basis) throw new Error("The board changed. Analyze this transfer again before accepting.");
          if (ops.length !== 1) throw new Error("Accept this transfer separately from other edits.");
        }
      }
    }
    fold(validationEntries, baseEntries);
    await this.writeLog(board, add, snapshot.revision, "append");
    return this.board(board);
  }
  async proposeHandover(board: string, jobId: string, toTrack: string, basis?: string, placement?: HandoverPlacement) {
    const plan = handoverPlan(await this.board(board), jobId, toTrack, placement);
    if (basis && basis !== plan.basis) throw new Error("The board changed. Analyze this transfer again.");
    if (plan.blocks.length) throw new Error(plan.blocks.join(" "));
    await this.append(board, plan.ops, "human", true);
    const proposal = (await this.proposals(board)).reverse().find(e => e.op.t === "handover" && e.op.jobId === jobId && e.op.toTrack === toTrack && e.op.basis === plan.basis);
    return { plan, seq: proposal!.seq };
  }
  /** Undo the last human entry that touched an entity: append a revert to its prior state. Returns the reverted entry or null. */
  async undo(board: string, by = "human"): Promise<Entry | null> {
    const es = (await this.entries(board)).map(migrate);
    const baseOp = es.find(e => e.op.t === "base");
    const baseEntries = baseOp?.op.t === "base" ? await this.board(baseOp.op.board) : undefined;
    const reverted = new Set(es.filter((e) => e.op.t === "revert" || e.op.t === "restoreHandover").map((e) => (e.op as { of: string }).of));
    const undone = new Set(es.filter((e) => (e.op.t === "revert" || e.op.t === "restoreHandover") && !reverted.has(e.id ?? String(e.seq))).map((e) => (e.op as { of: string }).of));
    for (let i = es.length - 1; i >= 0; i--) {
      const e = es[i];
      if (e.by === by && e.op.t === "accept" && !undone.has(e.id ?? String(e.seq))) {
        const acceptedSeq = e.op.seq;
        const proposal = es.find(x => x.seq === acceptedSeq);
        if (proposal?.op.t === "handover") {
          await this.append(board, [{ t: "restoreHandover", of: e.id ?? String(e.seq), snapshot: proposal.op.before, inverse: proposal.op.after }], by);
          return e;
        }
      }
      if (e.by !== by || e.pending || e.op.t === "revert" || e.op.t === "accept" || e.op.t === "reject" || e.op.t === "base" || e.op.t === "board") continue;
      if (undone.has(e.id ?? String(e.seq))) continue;
      const target = targetOf(e.op);
      if (!target) continue;
      const before = fold(es.slice(0, i), baseEntries);
      const list = (target.entity === "job" ? before.jobs : target.entity === "track" ? before.tracks : target.entity === "region" ? before.regions : target.entity === "question" ? before.questions : target.entity === "comment" ? before.comments : before.artifacts) as any[];
      const prior = list.find((x) => x.id === target.id) ?? null;
      const collectedIds = e.op.t === "collect" ? e.op.into : [];
      const relatedJobs = structuredClone(before.jobs.filter(j => collectedIds.includes(j.id)));
      const expectedJobs = collectedIds.length ? fold(es.slice(0, i + 1), baseEntries).jobs.filter(j => collectedIds.includes(j.id)) : [];
      await this.append(board, [{ t: "revert", of: e.id ?? String(e.seq), entity: target.entity, id: target.id, prior, ...(collectedIds.length ? { relatedJobs, expectedJobs } : {}) }], by);
      return e;
    }
    return null;
  }
  /** Redo: undo the last human revert that has not itself been reverted. */
  async redo(board: string, by = "human"): Promise<Entry | null> {
    const es = (await this.entries(board)).map(migrate);
    const baseOp = es.find(e => e.op.t === "base");
    const baseEntries = baseOp?.op.t === "base" ? await this.board(baseOp.op.board) : undefined;
    const reverted = new Set(es.filter((e) => e.op.t === "revert" || e.op.t === "restoreHandover").map((e) => (e.op as { of: string }).of));
    const undone = new Set(es.filter((e) => (e.op.t === "revert" || e.op.t === "restoreHandover") && !reverted.has(e.id ?? String(e.seq))).map((e) => (e.op as { of: string }).of));
    for (let i = es.length - 1; i >= 0; i--) {
      const e = es[i];
      if (e.op.t === "restoreHandover" && e.by === by && !reverted.has(e.id ?? String(e.seq))) {
        await this.append(board, [{ t: "restoreHandover", of: e.id ?? String(e.seq), snapshot: e.op.inverse, inverse: e.op.snapshot }], by);
        return e;
      }
      if (e.op.t !== "revert" || e.by !== by) continue;
      if (reverted.has(e.id ?? String(e.seq))) continue;
      const before = fold(es.slice(0, i), baseEntries);
      const rop = e.op as Extract<Op, { t: "revert" }>;
      const ent = rop.entity;
      const list = (ent === "job" ? before.jobs : ent === "track" ? before.tracks : ent === "region" ? before.regions : ent === "question" ? before.questions : ent === "comment" ? before.comments : before.artifacts) as any[];
      const prior = list.find((x) => x.id === rop.id) ?? null;
      await this.append(board, [{ t: "revert", of: e.id ?? String(e.seq), entity: ent, id: rop.id, prior, ...(rop.relatedJobs ? { relatedJobs: rop.expectedJobs, expectedJobs: rop.relatedJobs } : {}) }], by);
      return e;
    }
    return null;
  }
  /** Merge another log of the same board (another machine, another branch). Ops whose basis no longer holds become proposals. Deterministic: sorted by id. */
  async merge(board: string, other: Entry[]): Promise<{ added: number; demoted: number }> {
    const snapshot = await this.readLog(board);
    const mine = snapshot.entries.map(migrate);
    const have = new Set(mine.map((e) => e.id));
    const incoming = other.map(migrate).filter((e) => !have.has(e.id));
    if (incoming.some(e => e.op.t === "baseline") && mine.length) throw new Error("Merge cannot replace a baseline.");
    if (mine.some(e => e.op.t === "baseline") && incoming.some(e => e.op.t === "base")) throw new Error("Merge cannot replace a baseline.");
    const all = [...mine, ...incoming].sort((a, c) => (a.id! < c.id! ? -1 : a.id! > c.id! ? 1 : 0));
    let demoted = 0;
    const out: Entry[] = [];
    for (const e of all) {
      if (incoming.includes(e) && e.basis?.length) {
        const snap = fold(out);
        const ids = new Set([...snap.jobs.filter((j) => !j.removed).map((j) => j.id), ...snap.tracks.map((t) => t.id), ...snap.regions.map((r) => r.id), ...snap.questions.map((q) => q.id)]);
        if (e.basis.some((id) => !ids.has(id))) { out.push({ ...e, pending: true, demoted: true } as Entry); demoted++; continue; }
      }
      out.push(e);
    }
    const renum = out.map((e, i) => ({ ...e, seq: i + 1 }));
    fold(renum);
    await this.writeLog(board, renum, snapshot.revision, "replace");
    return { added: incoming.length, demoted };
  }
  /** Return the captured reference, or explicitly label the recoverable legacy reference. */
  async baseline(board: string): Promise<Board | null> {
    const entries = await this.entries(board);
    const pin = entries.find(e => e.op.t === "baseline");
    if (pin?.op.t === "baseline") {
      fold(entries); // Reject malformed/repeated initialization records.
      return { ...structuredClone(pin.op.snapshot), baseline: structuredClone(pin.op.baseline) };
    }
    const base = entries.find(e => e.op.t === "base");
    if (base?.op.t !== "base") return null;
    return { ...await this.board(base.op.board), baseline: { pinned: false, sourceBoard: base.op.board, name: "Unpinned legacy baseline" } };
  }
  /** Capture applied state once. Pending proposals do not become design facts. */
  async branch(base: string, name: string, title: string, baselineName?: string, capturedBy = "human"): Promise<Board> {
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || !/^[a-zA-Z0-9_-]+$/.test(base)) throw new Error("Invalid board name.");
    const previous = this.writes.get(name) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      if ((await this.entries(name)).length || existsSync(this.file(name))) throw new Error("Alternative already exists.");
      const source = await this.readLog(base);
      if (!source.entries.length) throw new Error("Source board does not exist.");
      const baseOp = source.entries.find(e => e.op.t === "base");
      const sourceBase = baseOp?.op.t === "base" ? await this.board(baseOp.op.board) : undefined;
      const board = fold(source.entries, sourceBase);
      const capture = captureBaseline(board, {
        pinned: true, id: ulid(), name: baselineName?.trim() || `${board.title} baseline`,
        sourceBoard: base, sourceRevision: `${source.revision}:${source.entries.at(-1)?.id ?? source.entries.at(-1)?.seq}`,
        capturedAt: new Date().toISOString(), capturedBy,
      });
      return this.appendUnlocked(name, [{ t: "baseline", ...capture }, { t: "board", id: name, title }], capturedBy);
    });
    this.writes.set(name, write);
    try { return await write; } finally { if (this.writes.get(name) === write) this.writes.delete(name); }
  }
  watch(cb: () => void) {
    if (!existsSync(this.dir)) return () => {};
    const w = fsWatch(this.dir, { persistent: false }, () => cb());
    return () => w.close();
  }
}

/** A checkout is its own project: a nested repository or worktree never inherits its parent's
 * boards, so the walk searches the directory holding `.git` and then stops there. */
export function findStavesDir(start = process.cwd()): string {
  let d = start;
  for (;;) {
    const c = path.join(d, ".staves");
    if (existsSync(c)) return c;
    if (existsSync(path.join(d, ".git"))) return path.join(start, ".staves");
    const up = path.dirname(d);
    if (up === d) return path.join(start, ".staves");
    d = up;
  }
}

