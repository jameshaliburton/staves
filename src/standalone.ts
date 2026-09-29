import { validateDesignConversationOperation } from "./design-conversation.js";
import { ledger } from "./ledger.js";
import { validateVocabularyOperation } from "./vocabulary.js";
import { designHistory } from "./design-history.js";
import { normalizeDevelopmentRecord, protectDevelopmentHistory } from "./development.js";
import { normalizeWalkthroughRecord, protectWalkthroughHistory, createWalkthroughRun, walkthroughBasis } from "./walkthrough-record.js";
import { validateEvidenceOperation } from "./evidence-lifecycle.js";
import { previewAlternative } from "./alternative.js";
import { normalizeAssessmentRecord, protectAssessmentHistory } from "./assessment-record.js";
/* staves in one file: the core with a browser-local store. No server, no agent — the design tool alone. */
import { fold, migrate, pending, SCHEMA, basisOf, targetOf, type Entry, type Op } from "./ops.js";
import { collectableRuns, columns, diff, focusBoard, handoffs, lint, reviewData, scorecard } from "./derive.js";
import { ulid } from "./ulid.js";
import { captureProposalBasis, captureCardPreconditions, validateProposalDecision, validateOperationPreconditions, type ProposalBasis } from "./proposals.js";
import { VERSION } from "./version.js";
import { interviewTurn, interviewFlow, normalizeInterviewMode } from "./interviewer.js";
import { fromBPMN, toJSON, fromJSON } from "./interop.js";
import { reflect } from "./reflect.js";
import { brief } from "./brief.js";
import { byKey } from "./interviewer.js";

/** The provider this browser chose. Without it every key is sent to Anthropic — including one that
 *  belongs to someone else's API. The request may carry it; otherwise it is whatever was saved here. */
function modelChoice(provider?: unknown, model?: unknown) {
  return {
    provider: (typeof provider === "string" && provider) || localStorage.getItem("staves:provider") || undefined,
    model: (typeof model === "string" && model) || localStorage.getItem("staves:model") || undefined,
  };
}
import { captureBaseline } from "./baseline.js";
import type { Board } from "./model.js";

const KEY = "staves:boards";
type Logs = Record<string, Entry[]>;
const load = (): Logs => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const save = (l: Logs) => localStorage.setItem(KEY, JSON.stringify(l));

class LocalStore {
  dir = "browser";
  logs: Logs = load();
  list() { return Object.keys(this.logs); }
  entries(b: string) { return (this.logs[b] ?? []).map(migrate); }
  board(b: string, ancestors = new Set<string>()): Board { if (ancestors.has(b)) throw new Error("Circular legacy baseline reference."); const seen = new Set(ancestors).add(b); const es = this.entries(b); const baseOp = es.find((e) => e.op.t === "base"); const base = baseOp?.op.t === "base" ? this.board(baseOp.op.board, seen) : undefined; const bd = fold(es, base); if (!es.length) { bd.id = b; bd.title = b; } return bd; }
  baseline(b: string): Board | null { const es = this.entries(b); const pin = es.find(e => e.op.t === "baseline"); if (pin?.op.t === "baseline") { fold(es); return { ...structuredClone(pin.op.snapshot), baseline: structuredClone(pin.op.baseline) }; } const legacy = es.find(e => e.op.t === "base"); return legacy?.op.t === "base" ? { ...this.board(legacy.op.board), baseline: { pinned: false, sourceBoard: legacy.op.board, name: "Unpinned legacy baseline" } } : null; }
  branch(base: string, name: string, title: string): Board { if (!/^[a-zA-Z0-9_-]+$/.test(name) || !/^[a-zA-Z0-9_-]+$/.test(base)) throw new Error("Invalid board name."); if (Object.hasOwn(this.logs, name)) throw new Error("Alternative already exists."); const entries = this.entries(base); if (!entries.length) throw new Error("Source board does not exist."); const board = this.board(base); const capture = captureBaseline(board, { pinned: true, id: ulid(), name: board.title + " baseline", sourceBoard: base, sourceRevision: String(entries.at(-1)?.id ?? entries.at(-1)?.seq), capturedAt: new Date().toISOString(), capturedBy: "human" }); this.append(name, [{ t: "baseline", ...capture }, { t: "board", id: name, title }]); return this.board(name); }
  proposals(b: string) { return pending(this.entries(b)); }
  append(b: string, ops: Op[], by = "human", propose = false, preconditions?: ProposalBasis[], suggestions?: (import("./ops.js").Suggestion | undefined)[]) {
    ops = structuredClone(ops);
    for (const op of ops) if (op.t === "acceptAlternative") {
      if (propose || !(by === "human" || by.startsWith("human:"))) throw new Error("Intended-design acceptance requires a human review.");
      const trusted = this.baseline(op.alternative.id);
      if (!trusted) throw new Error("Alternative baseline not found.");
      op.alternative = this.board(op.alternative.id); op.baseline = trusted;
    }
    validateOperationPreconditions(this.board(b), ops, preconditions);
    const previous = this.entries(b);
    if (propose && ops.some(op => op.t === "accept" || op.t === "reject")) throw new Error("Proposal decisions cannot themselves be proposed.");
    if (ops.some(op => op.t === "baseline") && (previous.length || propose)) throw new Error("Baseline can only initialize a new board.");
    if (previous.some(e => e.op.t === "baseline") && ops.some(op => op.t === "base")) throw new Error("A pinned baseline cannot be replaced.");
    const baseOp = [...previous.map(e => e.op), ...ops].find(op => op.t === "base");
    const base = baseOp?.t === "base" ? this.board(baseOp.board, new Set([b])) : undefined;
    let seq = (previous.at(-1)?.seq ?? 0) + 1;
    const now = new Date().toISOString();
    for (const op of ops) protectDevelopmentHistory(this.board(b), previous, op);
    for (const op of ops) protectWalkthroughHistory(this.board(b), previous, op);
    for (const op of ops) protectAssessmentHistory(this.board(b), previous, op);
    for (const op of ops) if (op.t === "comment") {
      const current = fold(previous, base);
      if (op.comment.development) op.comment.development = normalizeDevelopmentRecord(current, op.comment.development, by, now, previous.at(-1)?.seq ?? 0);
      if (op.comment.walkthrough) op.comment.walkthrough = normalizeWalkthroughRecord(current, op.comment.walkthrough, by, now, previous.at(-1)?.seq ?? 0, pending(previous).length);
      if (current.comments.some(comment => comment.id === op.comment.id && comment.assessment)) throw new Error("Assessment records are immutable. Add a new report.");
      if (op.comment.assessment) op.comment.assessment = normalizeAssessmentRecord(current, op.comment.assessment, by, now, previous.at(-1)?.seq ?? 0, pending(previous).length, previous.find(entry => entry.op.t === "baseline")?.op.t === "baseline" ? (previous.find(entry => entry.op.t === "baseline")!.op as Extract<Op, { t: "baseline" }>).snapshot : undefined);
    }
    for (const op of ops) if (op.t === "addExecutionEvidence" && op.evidence.fetchedAt) op.evidence.fetchedBy = by;
    const candidates: Entry[] = ops.map(op => ({ seq: seq++, id: ulid(), v: SCHEMA, at: now, by, op: structuredClone(op), ...(basisOf(op).length ? { basis: basisOf(op) } : {}) }));
    const validationEntries = structuredClone(previous);
    for (const entry of candidates) {
      const currentBoard = fold(validationEntries, base);
      validateDesignConversationOperation(currentBoard, entry.op, by, propose);
      validateVocabularyOperation(currentBoard, entry.op, by, propose);
      if (entry.op.t === "accept") { const seq = entry.op.seq; const proposal = validationEntries.find(e => e.seq === seq && e.pending); if (proposal) { validateVocabularyOperation(currentBoard, proposal.op, by); validateDesignConversationOperation(currentBoard, proposal.op, by); } }
      validateEvidenceOperation(currentBoard, entry.op, by, propose);
      if (entry.op.t === "accept") { const seq = entry.op.seq; const proposal = validationEntries.find(item => item.seq === seq && item.pending); if (proposal) validateEvidenceOperation(currentBoard, proposal.op, by); }

      if (entry.op.t === "accept" || entry.op.t === "reject") validateProposalDecision(validationEntries, entry.op, fold(structuredClone(validationEntries), base));
      validationEntries.push(entry);
    }
    fold([...structuredClone(previous), ...structuredClone(candidates)], base);
    const current = fold(previous, base);
    const entries = [...previous, ...candidates.map((entry, index) => propose ? { ...entry, pending: true, proposalBasis: captureProposalBasis(current, entry.op), ...(suggestions?.[index] ? { suggestion: suggestions[index] } : {}) } : entry)];
    const next = { ...this.logs, [b]: entries };
    save(next); this.logs = next; this.onchange();
  }
  undo(b: string, by = "human") { const es = this.entries(b); const reverted = new Set(es.filter((e) => e.op.t === "revert").map((e) => (e.op as any).of));
    const undone = new Set(es.filter((e) => e.op.t === "revert" && !reverted.has(e.id ?? String(e.seq))).map((e) => (e.op as any).of)); for (let i = es.length - 1; i >= 0; i--) { const e = es[i]; if (e.by !== by || e.pending || ["revert", "accept", "reject", "base", "board"].includes(e.op.t)) continue; if (undone.has(e.id ?? String(e.seq))) continue; const t = targetOf(e.op); if (!t) continue; const before = fold(es.slice(0, i)); const list = (before as any)[t.entity === "job" ? "jobs" : t.entity === "track" ? "tracks" : t.entity === "region" ? "regions" : t.entity === "question" ? "questions" : t.entity === "comment" ? "comments" : "artifacts"] as any[]; const prior = list.find((x) => x.id === t.id) ?? null; this.append(b, [{ t: "revert", of: e.id ?? String(e.seq), entity: t.entity, id: t.id, prior }], by); return e; } return null; }
  redo(b: string, by = "human") { const es = this.entries(b); const reverted = new Set(es.filter((e) => e.op.t === "revert").map((e) => (e.op as any).of));
    const undone = new Set(es.filter((e) => e.op.t === "revert" && !reverted.has(e.id ?? String(e.seq))).map((e) => (e.op as any).of)); for (let i = es.length - 1; i >= 0; i--) { const e = es[i]; if (e.op.t !== "revert" || e.by !== by || reverted.has(e.id ?? String(e.seq))) continue; const before = fold(es.slice(0, i)); const rop = e.op as any; const list = (before as any)[rop.entity === "job" ? "jobs" : rop.entity === "track" ? "tracks" : rop.entity === "region" ? "regions" : rop.entity === "question" ? "questions" : rop.entity === "comment" ? "comments" : "artifacts"] as any[]; const prior = list.find((x) => x.id === rop.id) ?? null; this.append(b, [{ t: "revert", of: e.id ?? String(e.seq), entity: rop.entity, id: rop.id, prior }], by); return e; } return null; }
  onchange: () => void = () => {};
  exportJsonl(b: string) { return (this.logs[b] ?? []).map((e) => JSON.stringify(e)).join("\n") + "\n"; }
  importJsonl(b: string, text: string) { this.logs[b] = text.split("\n").filter(Boolean).map((l) => JSON.parse(l)); save(this.logs); this.onchange(); }
}

/** A fetch that answers the app's relative endpoints from the local store. */
export function install() {
  const store = new LocalStore();
  const real = window.fetch.bind(window);
  const listeners = new Set<(e: string) => void>();
  store.onchange = () => listeners.forEach((f) => f("change"));
  (window as any).__staves = { store, listeners, VERSION };
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
  window.fetch = async (input: any, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input.url;
    if (!u.startsWith("./")) return real(input, init);
    const url = new URL(u, "http://local/"); const name = url.searchParams.get("board") ?? "";
    switch (url.pathname) {
      case "/board.json": { const b0 = store.board(name); const focus = url.searchParams.get("focus"); const b = focus ? focusBoard(b0, focus) : b0; const captured = store.baseline(name); const base = captured && focus ? focusBoard(captured, focus) : captured; return json({ ...b, findings: lint(b), ledger: ledger(b), stale: [], scorecard: scorecard(b), runs: collectableRuns(b), baseScorecard: base ? scorecard(base) : undefined, diff: base ? diff(base, b) : undefined, boards: store.list(), columns: Object.fromEntries(columns(b)), handoffs: handoffs(b), proposalsList: store.proposals(name), review: reviewData(b) }); }
      case "/design-history": return json(await designHistory({ list: async () => store.list(), entries: async name => store.entries(name) }, name));
      case "/walkthrough": { try {
        if (init?.method !== "POST") {
          const board = store.board(name), id = url.searchParams.get("id");
          const runs = board.comments.flatMap(comment => comment.walkthrough ? [{ run: comment.walkthrough, status: walkthroughBasis(board) === comment.walkthrough.basis ? "current" : "stale", requiresReconciliation: walkthroughBasis(board) !== comment.walkthrough.basis }] : []);
          if (id && !runs.some(item => item.run.id === id)) throw new Error("Walkthrough run not found.");
          return json(id ? runs.find(item => item.run.id === id) : runs);
        }
        const input = JSON.parse(String(init.body || "{}")), board = store.board(name);
        const run = createWalkthroughRun(board, store.entries(name).at(-1)?.seq ?? 0, input.case ?? input, "human", new Date().toISOString(), ulid(), input.maxSteps, store.proposals(name).length);
        if (!input.save) return json({ ...run.result, basis: run.basis });
        if (input.expectedBasis !== undefined && input.expectedBasis !== run.basis) throw new Error("The design changed since this preview. Test the scenario again before saving.");
        store.append(name, [{ t: "comment", comment: { id: `walkthrough:${run.id}`, about: "board", by: "human", text: `Saved walkthrough: ${run.result.case.name}. Model check, not execution evidence.`, walkthrough: run } }]);
        return json(run);
      } catch (error) { return new Response(error instanceof Error ? error.message : "Could not check case", { status: 400 }); } }
      case "/alternative-review": { try {
        const alternative = store.board(name), baseline = store.baseline(name);
        if (!baseline?.baseline?.pinned || !alternative.base) throw new Error("Only pinned alternatives can advance intended design.");
        const sourceName = baseline.baseline.sourceBoard, source = store.board(sourceName);
        if (init?.method !== "POST") return json(previewAlternative(source, alternative, baseline));
        const { basis } = JSON.parse(String(init.body || "{}"));
        store.append(sourceName, [{ t: "acceptAlternative", alternative, baseline, expectedBasis: basis }]);
        return json({ sourceBoard: sourceName, status: "intended-design-accepted", implementationChanged: false });
      } catch (error) { return new Response(error instanceof Error ? error.message : "Could not accept design", { status: 400 }); } }
      case "/baseline": return json(store.baseline(name));
      case "/branch": { if (init?.method !== "POST") return new Response("Method not allowed", { status: 405 }); try { const { base, name: alternative, title } = JSON.parse(String(init?.body || "{}")); if (typeof base !== "string" || typeof alternative !== "string" || typeof title !== "string") throw new Error("Base, name and title are required."); return json(store.branch(base, alternative, title)); } catch (error) { return new Response(error instanceof Error ? error.message : "Could not create alternative", { status: 400 }); } }
      case "/op": { const ops = JSON.parse((init?.body as string) || "[]"); store.append(name, Array.isArray(ops) ? ops : ops.ops, url.searchParams.get("by") ?? "human", url.searchParams.get("propose") === "1", Array.isArray(ops) ? undefined : ops.preconditions, Array.isArray(ops) ? undefined : ops.suggestions); return new Response("ok"); }
      case "/undo": return json({ undone: store.undo(name) });
      case "/redo": return json({ redone: store.redo(name) });
      case "/interview": { const { job, lines, said, key, provider, model: modelId, mute, suggestions, mode: requestedMode } = JSON.parse((init?.body as string) || "{}"); const mode = normalizeInterviewMode(requestedMode); const b = store.board(name); (b as any).__findings = lint(b).filter((f) => f.severity !== "info"); const j = b.jobs.find((x) => x.id === job); if (!j && job !== "board") return new Response("no such job", { status: 404 }); const k = key || localStorage.getItem("staves:key") || undefined; const config = modelChoice(provider, modelId); if (!k) return json({ engine: "none", reply: "", cards: [] }); const turn = j ? await interviewTurn(b, j, lines ?? [], said ?? null, byKey(k, config), { mode, mute, suggestions }) : await interviewFlow(b, lines ?? [], said ?? null, byKey(k, config), { mode, mute, suggestions }); return json({ ...turn, cards: captureCardPreconditions(b, turn.cards) }); }
      case "/link": { const { from, to, name: aname, kind } = JSON.parse((init?.body as string) || "{}"); const id = `x-${Date.now().toString(36)}`; const fb = store.board(from.board); const fj = fb.jobs.find((j) => j.id === from.job); const tb = store.board(to.board); const tj = tb.jobs.find((j) => j.id === to.job); if (!fj || !tj) return new Response("no such job", { status: 404 }); store.append(from.board, [{ t: "artifact", artifact: { id, name: aname, kind: kind ?? "document" } }, { t: "updateJob", id: fj.id, patch: { outputs: [...fj.outputs, id] } }]); store.append(to.board, [{ t: "artifact", artifact: { id, name: aname, kind: kind ?? "document", external: true } }, { t: "updateJob", id: tj.id, patch: { inputs: [...tj.inputs, id] } }]); return json({ ok: true, artifact: id }); }
      case "/reflect": { const b = store.board(name); const k = localStorage.getItem("staves:key"); return json(await reflect(b, brief(b), k ? byKey(k, modelChoice()) : null)); }
      case "/export.json": return json(toJSON(store.board(name)));
      case "/import": { const { format, text } = JSON.parse((init?.body as string) || "{}"); const ops = format === "bpmn" ? fromBPMN(text) : fromJSON(JSON.parse(text)); store.append(name, ops, "human"); return json({ ops: ops.length }); }
      case "/entries": { const since = url.searchParams.get("since"); const es = store.entries(name); { const i = since ? es.findIndex((e) => (e.id ?? String(e.seq)) === since) : -1; return json(since ? (i >= 0 ? es.slice(i + 1) : []) : es); } }
      case "/proposals": return json(store.proposals(name));
      case "/list": return json(store.list());
      case "/presence": return json([]);
      case "/setup": return json({ claudeCode: "This file runs on its own, with no agent. To connect Claude Code, start the service: npx @staves/cli web  (or double-click Start staves)", codex: "npx @staves/cli web", cursor: {} });
      case "/source": return new Response("(this file has no repo — the agent attaches instruction text when it describes through the service)");
      case "/staves-version": return new Response(VERSION);
      default: return new Response("not here", { status: 404 });
    }
  };
  // EventSource shim: the app subscribes; we push 'change' from the store
  (window as any).EventSource = class { listeners: Record<string, ((e: any) => void)[]> = {}; onerror: any; constructor() { setTimeout(() => this.emit("hello", { version: "1", presence: [] }), 0); listeners.add((ev) => this.emit(ev, {})); } addEventListener(n: string, f: (e: any) => void) { (this.listeners[n] ??= []).push(f); } emit(n: string, d: unknown) { (this.listeners[n] ?? []).forEach((f) => f({ data: JSON.stringify(d) })); } close() {} };
}
install();
