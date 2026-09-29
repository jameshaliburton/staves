/**
 * The Staves format (spec/) in and out.
 *
 * A board is stored as an op log; the format is the interchange: one readable snapshot other tools can
 * validate and diff. `toStavesDocument` follows spec/DECISIONS.md: the core carries what the spec defines,
 * `io.staves.measures` and `io.staves.detail` carry the optional detail, and `io.staves.app` carries
 * Staves' own state so a board read back is the board that was written. Tombstones are not exported, and
 * neither is inline instruction text.
 */
import type { Artifact, Board, ExecutionEvidence, Job, Provenance, Track } from "./model.js";
import type { Prerequisites } from "./flow.js";

export const STAVES_FORMAT_VERSION = "0.1";
export const STAVES_SCHEMA_ID = "https://staves.io/spec/0.1/board.schema.json";
export const APP = "io.staves.app";
export const MEASURES = "io.staves.measures";
export const DETAIL = "io.staves.detail";

export type Method = "interview" | "drawn" | "document" | "code" | "trace" | "inferred";
export interface Source { method: Method; by?: string; at?: string; ref?: string; confidence?: number; confirmed?: boolean }
export type ProvenanceMap = Record<string, Source>;
export interface Dispute { field: string; claims: { value: unknown; source: Source }[] }
export interface Ref { type: string; uri?: string; id?: string; path?: string; symbol?: string; server?: string; name?: string }
export type Extensions = Record<string, Record<string, unknown>>;
interface Common { provenance?: ProvenanceMap; disputes?: Dispute[]; refs?: Ref[]; extensions?: Extensions }

export interface DocTrack extends Common { id: string; name: string; kind: Track["kind"]; description?: string }
export interface DocArtifact extends Common { id: string; name: string; kind: Artifact["kind"]; external?: boolean; livesIn?: string; note?: string }
export interface DocExit { condition: string; target?: string; share?: number }
export interface DocGate { rule: string; accountable?: string; ruleOwner?: string }
export interface DocTool { name: string; reach: "api" | "mcp" | "screen" | "none"; personal?: boolean; does?: string; limits?: string; refs?: Ref[]; extensions?: Extensions }
export interface DocEvidence {
  system: string; traceId: string; spanId?: string; graphNodeId?: string; observedAt: string; status: "ok" | "error"; durationMs?: number;
  mapping?: { method: "instrumented" | "proposed" | "reviewed"; by?: string; at?: string };
}
export interface DocJob extends Common {
  id: string; name: string; track: string; parent?: string;
  kind?: "work" | "queue" | "store" | "watch" | "outside";
  outcome?: string; beneficiary?: string; doneWhen?: string[];
  inputs: string[]; outputs: string[];
  trigger?: NonNullable<Job["trigger"]>; triggerNote?: string;
  prerequisites?: { kind: Prerequisites["kind"]; inputs: string[]; condition?: string };
  exits?: DocExit[]; gate?: DocGate; loop?: { to: string; limit?: number; then?: string };
  tools?: DocTool[];
  status?: "draft" | "confirmed";
  change?: "added" | "changed" | "moved" | "removed" | "unchanged";
  order?: number;
  evidence?: DocEvidence[];
}
export interface DocHandoff { id: string; from: string; to: string; kind: "artifact" | "exit" | "loop"; artifact?: string; condition?: string }
export interface StavesDocument extends Common {
  $schema?: string;
  staves: string;
  id: string; title: string; goal?: string;
  stance: "as-is" | "to-be";
  base?: string;
  tracks: DocTrack[]; artifacts: DocArtifact[]; jobs: DocJob[];
  handoffs?: DocHandoff[];
}

/** Kept as written, with the view the board would have written in its place. */
interface Kept<T> { value: T; basis: string }
/**
 * What a document held that a board has no field for: unknown extensions, evidence from systems other
 * than Langfuse, reference types Staves does not model, provenance finer than Staves records. Each part is
 * kept exactly as written and put back on export, unless the board has since changed what that part
 * describes — then the board's own view is written instead.
 */
export interface Passthrough {
  board?: { provenance?: ProvenanceMap; refs?: Ref[]; extensions?: Extensions };
  tracks?: Record<string, { provenance?: Kept<ProvenanceMap | undefined>; refs?: Ref[]; extensions?: Extensions }>;
  artifacts?: Record<string, { provenance?: ProvenanceMap; refs?: Ref[]; extensions?: Extensions }>;
  jobs?: Record<string, { provenance?: Kept<ProvenanceMap | undefined>; refs?: Kept<Ref[] | undefined>; tools?: Kept<DocTool[] | undefined>; evidence?: DocEvidence[]; extensions?: Extensions }>;
}
/** A board read from a document carries its passthrough under the app namespace. src/model.ts has no
 *  field for it, so it lives on the board object only: it survives a JSON copy and a write back to the
 *  format, but not a save to a Staves store. */
export type StavesBoard = Board & { [APP]?: { passthrough: Passthrough } };
export const passthroughOf = (board: Board): Passthrough | undefined => (board as StavesBoard)[APP]?.passthrough;
const fingerprint = (value: unknown) => JSON.stringify(value ?? null);
const keptOr = <T>(kept: Kept<T> | undefined, view: T): T => kept && kept.basis === fingerprint(view) ? kept.value : view;
const merged = (ours: Extensions | undefined, theirs: Extensions | undefined): Extensions | undefined => theirs ? { ...ours, ...theirs } : ours;
/** Staves' own provenance is written to io.staves.app only when the core source would not read back as it. */
const restores = (star: Source | undefined, provenance: Provenance | undefined) => fingerprint(star ? fromSource(star) : undefined) === fingerprint(provenance);

/* ---------- identifiers ---------- */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type IdKind = "track" | "artifact" | "job";
const slug = (raw: string, fallback: string) => raw.normalize("NFKD").replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 120) || fallback;

/** Staves ids are free strings; the format's are not. Each kind is mapped to a board-wide unique, valid id,
 *  and every rename is recorded so the board reads back with the ids it had. */
class IdMap {
  private readonly used = new Set<string>();
  private readonly maps: Record<IdKind, Map<string, string>> = { track: new Map(), artifact: new Map(), job: new Map() };
  id(kind: IdKind, raw: string): string {
    const known = this.maps[kind].get(raw);
    if (known) return known;
    const base = ID.test(raw) ? raw : slug(raw, kind);
    let safe = base, n = 2;
    while (this.used.has(safe)) safe = `${base.slice(0, 120)}-${n++}`;
    this.used.add(safe);
    this.maps[kind].set(raw, safe);
    return safe;
  }
  renamed(): Partial<Record<IdKind, Record<string, string>>> | undefined {
    const out: Partial<Record<IdKind, Record<string, string>>> = {};
    for (const kind of ["track", "artifact", "job"] as IdKind[]) {
      const pairs = [...this.maps[kind]].filter(([raw, safe]) => raw !== safe);
      if (pairs.length) out[kind] = Object.fromEntries(pairs.map(([raw, safe]) => [safe, raw]));
    }
    return Object.keys(out).length ? out : undefined;
  }
}

/* ---------- provenance ---------- */

const ACTOR = /^(role|person|agent|tool):.+$/;
const dateTime = (value?: string) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : undefined;

function actor(by: string | undefined, source: string): string | undefined {
  if (!by) return undefined;
  if (ACTOR.test(by)) return by;
  const human = by.match(/^human:(.+)$/);
  if (human) return `person:${human[1]}`;
  const prefix = source === "agent" ? "agent" : source === "human" || source === "confirmed" ? "person" : "tool";
  return `${prefix}:${by}`;
}

/** A Staves provenance as a format source. `agent` is `code` when it names a commit or the job names its
 *  code, and `inferred` otherwise; a person's word is `drawn` on a drawn board and `interview` elsewhere. */
export function toSource(p: Provenance, context: { drawn?: boolean; code?: { path: string; symbol?: string } } = {}): Source {
  const said = context.drawn ? "drawn" : "interview";
  const method: Method = p.source === "agent" ? (p.commit || context.code ? "code" : "inferred")
    : p.source === "human" || p.source === "confirmed" ? said
    : p.source === "derived" ? "inferred"
    : "document"; // imported from another format
  const ref = p.commit ? `git:${p.commit}${context.code ? `:${context.code.path}${context.code.symbol ? `#${context.code.symbol}` : ""}` : ""}` : undefined;
  return compact({
    method, by: actor(p.by, p.source), at: dateTime(p.at), ref,
    confidence: typeof p.confidence === "number" && p.confidence >= 0 && p.confidence <= 1 ? p.confidence : undefined,
    confirmed: p.source === "confirmed" ? true : undefined,
  });
}

/** A format source as a Staves provenance. */
export function fromSource(s: Source): Provenance {
  const source: Provenance["source"] = s.confirmed ? "confirmed"
    : s.method === "code" || s.method === "trace" ? "agent"
    : s.method === "inferred" ? "derived"
    : "human";
  const commit = s.ref?.match(/^git:([0-9a-fA-F]{7,40})/)?.[1];
  return compact({ source, by: s.by, at: s.at, confidence: s.confidence, commit });
}

const sameSource = (a: Source | undefined, b: Source | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* ---------- the board's view of what it can hold ---------- */

const trackProvenanceView = (t: Track, drawn: boolean): ProvenanceMap | undefined => t.provenance ? { "*": toSource(t.provenance, { drawn }) } : undefined;
function jobProvenanceView(j: Job, drawn: boolean): ProvenanceMap {
  const provenance: ProvenanceMap = { "*": toSource(j.provenance, { drawn, code: j.sources?.[0] }) };
  for (const field of j.confirmedFields ?? []) if (/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/.test(field)) provenance[field] = compact({ method: drawn ? "drawn" as const : "interview" as const, confirmed: true });
  return provenance;
}
function jobRefsView(j: Job): Ref[] | undefined {
  const refs: Ref[] = [
    ...(j.sources ?? []).map(s => compact({ type: "code", path: s.path, symbol: s.symbol })),
    ...(j.instructions ?? []).map(i => compact({ type: "instructions", path: i.path, symbol: i.symbol })),
  ];
  return refs.length ? refs : undefined;
}
const jobToolsView = (j: Job): DocTool[] | undefined => j.tools?.map(t => compact({ name: t.name, reach: t.reach, personal: t.personal, does: t.does, limits: t.limits }));
const evidenceView = (j: Job): DocEvidence[] => (j.executionEvidence ?? []).filter(e => !e.retraction).map(toEvidence).filter((e): e is DocEvidence => !!e);

/* ---------- board → document ---------- */

export interface ToStavesOptions {
  /** list derived handoffs for consumers that cannot derive them (default true) */
  handoffs?: boolean;
}

export function toStavesDocument(board: Board, options: ToStavesOptions = {}): StavesDocument {
  const ids = new IdMap();
  const tracks = board.tracks.filter(t => !t.removed);
  const jobs = board.jobs.filter(j => !j.removed);
  const hasGhost = jobs.some(j => j.kind === "ghost");
  const drawn = board.context?.where === "drawn";
  // Allocate the objects' own ids first, so a stray reference never takes a name an object needed. Jobs go
  // first: they are what handoff ids, traces (staves.job.id) and other tools point at, so when a job and an
  // artifact share an id — Staves allows it, the format does not — the artifact is the one renamed.
  for (const j of jobs) ids.id("job", j.id);
  for (const t of tracks) ids.id("track", t.id);
  for (const a of board.artifacts) ids.id("artifact", a.id);
  const boardId = ID.test(board.id) ? board.id : slug(board.id, "board");

  const pass = passthroughOf(board);
  const docTracks = tracks.map((t): DocTrack => {
    const measures = compact({ capacityHoursPerWeek: t.capacityHoursPerWeek, people: t.people, budgetSeconds: t.budgetSeconds });
    const kept = pass?.tracks?.[t.id];
    const provenance = keptOr(kept?.provenance, trackProvenanceView(t, drawn));
    return compact({
      id: ids.id("track", t.id), name: t.name, kind: t.kind, description: t.meta,
      provenance,
      refs: kept?.refs,
      extensions: merged(extensions({ [MEASURES]: measures, [APP]: compact({ provenance: restores(provenance?.["*"], t.provenance) ? undefined : t.provenance }) }), kept?.extensions),
    });
  });

  const docArtifacts = board.artifacts.map((a): DocArtifact => {
    const kept = pass?.artifacts?.[a.id];
    return compact({
      id: ids.id("artifact", a.id), name: a.name, kind: a.kind, external: a.external, livesIn: a.livesIn, note: a.note,
      provenance: kept?.provenance, refs: kept?.refs, extensions: kept?.extensions,
    });
  });

  const docJobs = jobs.map((j): DocJob => {
    const kept = pass?.jobs?.[j.id];
    const evidence = [...evidenceView(j), ...(kept?.evidence ?? [])];
    const refs = keptOr(kept?.refs, jobRefsView(j));
    const provenance = keptOr(kept?.provenance, jobProvenanceView(j, drawn));
    const confirmedFromCore = Object.entries(provenance ?? {}).filter(([field, source]) => field !== "*" && source.confirmed).map(([field]) => field);
    const app = compact({
      provenance: restores(provenance?.["*"] ?? pass?.board?.provenance?.["*"], j.provenance) ? undefined : j.provenance,
      confirmedFields: fingerprint(confirmedFromCore) === fingerprint(j.confirmedFields ?? []) ? undefined : j.confirmedFields,
      kind: j.kind === "ghost" ? "ghost" : undefined,
      instructions: j.instructions?.some(i => i.summary) ? j.instructions.map(i => compact({ path: i.path, symbol: i.symbol, summary: i.summary })) : undefined,
      executionEvidence: j.executionEvidence,
      implementation: j.implementation, rationale: j.rationale, movedFrom: j.movedFrom, correctionTo: j.correctionTo,
      boardRef: j.boardRef, size: j.size, workKind: j.workKind,
    });
    return compact({
      id: ids.id("job", j.id), name: j.name, track: ids.id("track", j.track),
      parent: j.parent ? ids.id("job", j.parent) : undefined,
      kind: j.kind === "ghost" ? undefined : j.kind,
      outcome: j.outcome, beneficiary: j.beneficiary, doneWhen: j.doneWhen,
      inputs: j.inputs.map(a => ids.id("artifact", a)), outputs: j.outputs.map(a => ids.id("artifact", a)),
      trigger: j.trigger, triggerNote: j.triggerNote,
      prerequisites: j.prerequisites ? compact({ kind: j.prerequisites.kind, inputs: j.prerequisites.inputs.map(a => ids.id("artifact", a)), condition: j.prerequisites.kind === "conditional" ? j.prerequisites.condition : undefined }) : undefined,
      exits: j.exits?.map(e => compact({ condition: e.condition, target: e.target && e.target !== "stop" ? ids.id("job", e.target) : e.target, share: typeof e.share === "number" && e.share >= 0 && e.share <= 1 ? e.share : undefined })),
      gate: j.gate ? compact({ rule: j.gate.rule, accountable: j.gate.accountable && j.gate.accountable !== "rule" ? ids.id("track", j.gate.accountable) : j.gate.accountable, ruleOwner: j.gate.ruleOwner }) : undefined,
      loop: j.loop ? compact({ to: ids.id("job", j.loop.to), limit: Number.isInteger(j.loop.limit) && (j.loop.limit ?? 0) >= 1 ? j.loop.limit : undefined, then: j.loop.then }) : undefined,
      tools: keptOr(kept?.tools, jobToolsView(j)),
      status: j.status,
      change: j.kind === "ghost" ? "added" as const : undefined,
      order: j.order,
      evidence: evidence.length ? evidence : undefined,
      refs,
      provenance,
      extensions: merged(extensions({
        [MEASURES]: compact({ minutes: j.minutes, perWeek: j.perWeek }),
        [DETAIL]: compact({ examples: j.examples, checks: j.checks }),
        [APP]: app,
      }), kept?.extensions),
    });
  });

  const app = compact({
    ids: ids.renamed(), boardId: boardId !== board.id ? board.id : undefined,
    origin: board.origin, context: board.context, questions: board.questions.length ? board.questions : undefined,
    comments: board.comments.length ? board.comments : undefined,
    regions: board.regions.some(r => !r.removed) ? board.regions.filter(r => !r.removed) : undefined,
    settled: board.settled, vocabulary: board.vocabulary, intent: board.intent, baseline: board.baseline,
  });
  const doc: StavesDocument = compact({
    $schema: STAVES_SCHEMA_ID, staves: STAVES_FORMAT_VERSION,
    id: boardId, title: board.title || board.id, goal: board.goal,
    stance: stanceOf(board.context?.stance, hasGhost, board.base),
    base: board.base,
    tracks: docTracks, artifacts: docArtifacts, jobs: docJobs,
    provenance: pass?.board?.provenance, refs: pass?.board?.refs,
    extensions: merged(extensions({ [MEASURES]: compact({ perWeek: board.perWeek }), [APP]: app }), pass?.board?.extensions),
  });
  if (options.handoffs !== false) {
    const derived = documentHandoffs(doc);
    if (derived.length) doc.handoffs = derived;
  }
  return doc;
}

const stanceOf = (explicit: "as-is" | "to-be" | undefined, hasGhost: boolean, base: string | undefined): "as-is" | "to-be" =>
  explicit ?? (hasGhost || base ? "to-be" : "as-is");

function toEvidence(e: ExecutionEvidence): DocEvidence | undefined {
  const observedAt = dateTime(e.observedAt);
  if (!observedAt || !e.traceId) return undefined;
  return compact({
    system: e.provider, traceId: e.traceId, spanId: e.observationId, observedAt,
    status: e.status === "error" ? "error" as const : "ok" as const, durationMs: typeof e.durationMs === "number" && e.durationMs >= 0 ? e.durationMs : undefined,
    mapping: e.mapping ? compact({ method: e.mapping.method, by: e.mapping.reviewedBy, at: dateTime(e.mapping.reviewedAt) }) : undefined,
  });
}

/** Handoffs, derived as spec §4.9 says, with its deterministic ids. */
export function documentHandoffs(doc: Pick<StavesDocument, "jobs">): DocHandoff[] {
  const jobs = new Set(doc.jobs.map(j => j.id));
  const producers = new Map<string, string[]>();
  for (const j of doc.jobs) for (const o of j.outputs) producers.set(o, [...(producers.get(o) ?? []), j.id]);
  const out: DocHandoff[] = [], seen = new Set<string>();
  const push = (h: DocHandoff) => { if (h.from !== h.to && !seen.has(h.id)) { seen.add(h.id); out.push(h); } };
  for (const j of doc.jobs) {
    for (const input of j.inputs) for (const from of producers.get(input) ?? []) push({ id: `${from}>${j.id}@${input}`, from, to: j.id, kind: "artifact", artifact: input });
    (j.exits ?? []).forEach((e, i) => { if (e.target && e.target !== "stop" && jobs.has(e.target)) push({ id: `${j.id}>${e.target}!${i}`, from: j.id, to: e.target, kind: "exit", condition: e.condition }); });
    if (j.loop && jobs.has(j.loop.to)) push({ id: `${j.id}>${j.loop.to}~loop`, from: j.id, to: j.loop.to, kind: "loop" });
  }
  return out;
}

/* ---------- document → board ---------- */

export interface ImportedBoard {
  board: Board;
  /** what the document held that a Staves board cannot yet carry */
  notes: string[];
}

export function fromStavesDocument(doc: unknown): Board { return importStavesDocument(doc).board; }

export function importStavesDocument(input: unknown): ImportedBoard {
  const doc = readDocument(input);
  const notes: string[] = [];
  const app = record(doc.extensions?.[APP]);
  const renamed = record(app.ids) as Partial<Record<IdKind, Record<string, string>>>;
  const original = (kind: IdKind, id: string) => renamed[kind]?.[id] ?? id;
  const drawn = contextOf(app)?.where === "drawn";
  const boardDefault = doc.provenance?.["*"];
  const pass: Required<Passthrough> = { board: {}, tracks: {}, artifacts: {}, jobs: {} };
  const known = new Set([APP, MEASURES, DETAIL]);
  const unknown = (ext?: Extensions) => { const kept = Object.entries(ext ?? {}).filter(([key]) => !known.has(key)); return kept.length ? Object.fromEntries(kept) : undefined; };
  /** Keep a part when the board would write it back differently, with the board's view as its basis. */
  const keep = <T>(raw: T, view: T): Kept<T> | undefined => fingerprint(raw) === fingerprint(view) ? undefined : { value: raw, basis: fingerprint(view) };

  pass.board = compact({ provenance: doc.provenance, refs: doc.refs, extensions: unknown(doc.extensions) });
  for (const d of doc.disputes ?? []) notes.push(`board: dispute about ${d.field} became a question.`);

  const tracks = doc.tracks.map((t): Track => {
    const tApp = record(t.extensions?.[APP]), measures = record(t.extensions?.[MEASURES]);
    const star = t.provenance?.["*"];
    const kept = tApp.provenance as Provenance | undefined;
    const provenance = kept && sameSource(toSource(kept, { drawn }), star) ? kept : star ? fromSource(star) : undefined;
    const track: Track = compact({
      id: original("track", t.id), name: t.name, kind: t.kind, meta: t.description,
      capacityHoursPerWeek: num(measures.capacityHoursPerWeek), people: num(measures.people), budgetSeconds: num(measures.budgetSeconds),
      provenance,
    });
    const held = compact({ provenance: keep(t.provenance, trackProvenanceView(track, drawn)), refs: t.refs, extensions: unknown(t.extensions) });
    if (Object.keys(held).length) pass.tracks[track.id] = held;
    return track;
  });

  const artifacts = doc.artifacts.map((a): Artifact => {
    const artifact: Artifact = compact({ id: original("artifact", a.id), name: a.name, kind: a.kind, external: a.external, livesIn: a.livesIn, note: a.note });
    const held = compact({ provenance: a.provenance, refs: a.refs, extensions: unknown(a.extensions) });
    if (Object.keys(held).length) pass.artifacts[artifact.id] = held;
    return artifact;
  });

  const questions = [...(Array.isArray(app.questions) ? app.questions as Board["questions"] : [])];
  const jobs = doc.jobs.map((j): Job => {
    const jApp = record(j.extensions?.[APP]), measures = record(j.extensions?.[MEASURES]), detail = record(j.extensions?.[DETAIL]);
    const id = original("job", j.id);
    const code = (j.refs ?? []).filter(r => r.type === "code" && r.path).map(r => compact({ path: r.path!, symbol: r.symbol }));
    const star = j.provenance?.["*"] ?? boardDefault;
    const keptProvenance = jApp.provenance as Provenance | undefined;
    const provenance = keptProvenance && sameSource(toSource(keptProvenance, { drawn, code: code[0] }), j.provenance?.["*"]) ? keptProvenance
      : star ? fromSource(star) : { source: "derived" as const, by: "tool:staves-format" };
    const confirmedFields = Array.isArray(jApp.confirmedFields) ? jApp.confirmedFields as string[]
      : Object.entries(j.provenance ?? {}).filter(([field, s]) => field !== "*" && s.confirmed).map(([field]) => field);
    const instructionRefs = (j.refs ?? []).filter(r => r.type === "instructions" && r.path).map(r => compact({ path: r.path!, symbol: r.symbol }));
    const keptInstructions = Array.isArray(jApp.instructions) ? jApp.instructions as Job["instructions"] : undefined;
    const instructions = keptInstructions && keptInstructions.length === instructionRefs.length && keptInstructions.every((i, n) => i.path === instructionRefs[n].path) ? keptInstructions : instructionRefs;
    // Staves' own observations come first in what it writes; anything after them came from elsewhere.
    const keptEvidence = Array.isArray(jApp.executionEvidence) ? jApp.executionEvidence as ExecutionEvidence[] : undefined;
    const ours = (keptEvidence ?? []).filter(e => !e.retraction).map(toEvidence).filter((e): e is DocEvidence => !!e);
    const written = j.evidence ?? [];
    const matches = !!keptEvidence && fingerprint(written.slice(0, ours.length)) === fingerprint(ours);
    const executionEvidence = matches ? keptEvidence : undefined;
    const otherEvidence = matches ? written.slice(ours.length) : written;
    for (const [n, d] of (j.disputes ?? []).entries()) {
      questions.push({ id: `dispute-${id}-${n + 1}`, about: id, askedBy: "staves", status: "raised", text: disputeQuestion(d) });
      notes.push(`job ${j.id}: dispute about ${d.field} became a question.`);
    }
    const ghost = jApp.kind === "ghost" || (j.change === "added" && !j.kind);
    const job: Job = compact({
      id, name: j.name, track: original("track", j.track), parent: j.parent ? original("job", j.parent) : undefined,
      kind: ghost ? "ghost" as const : j.kind,
      implementation: jApp.implementation as Job["implementation"],
      executionEvidence,
      outcome: j.outcome, beneficiary: j.beneficiary, doneWhen: j.doneWhen, rationale: str(jApp.rationale),
      trigger: j.trigger, triggerNote: j.triggerNote,
      prerequisites: j.prerequisites ? prerequisitesFrom(j.prerequisites, a => original("artifact", a)) : undefined,
      inputs: j.inputs.map(a => original("artifact", a)), outputs: j.outputs.map(a => original("artifact", a)),
      exits: j.exits?.map(e => compact({ condition: e.condition, target: e.target && e.target !== "stop" ? original("job", e.target) : e.target, share: e.share })),
      gate: j.gate ? compact({ rule: j.gate.rule, accountable: j.gate.accountable && j.gate.accountable !== "rule" ? original("track", j.gate.accountable) : j.gate.accountable, ruleOwner: j.gate.ruleOwner }) : undefined,
      loop: j.loop ? compact({ to: original("job", j.loop.to), limit: j.loop.limit, then: j.loop.then }) : undefined,
      examples: Array.isArray(detail.examples) ? detail.examples as Job["examples"] : undefined,
      checks: Array.isArray(detail.checks) ? detail.checks as Job["checks"] : undefined,
      instructions: instructions.length ? instructions : undefined,
      sources: code.length ? code : undefined,
      movedFrom: str(jApp.movedFrom), boardRef: str(jApp.boardRef), size: str(jApp.size), workKind: str(jApp.workKind),
      order: j.order,
      tools: j.tools?.map(t => compact({ name: t.name, reach: t.reach, personal: t.personal, does: t.does, limits: t.limits })),
      minutes: num(measures.minutes), perWeek: num(measures.perWeek),
      provenance, status: j.status ?? "draft",
      confirmedFields: confirmedFields.length ? confirmedFields : undefined,
      correctionTo: str(jApp.correctionTo),
    });
    const held = compact({
      provenance: keep(j.provenance, jobProvenanceView(job, drawn)),
      refs: keep(j.refs, jobRefsView(job)),
      tools: keep(j.tools, jobToolsView(job)),
      evidence: otherEvidence.length ? otherEvidence : undefined,
      extensions: unknown(j.extensions),
    });
    if (Object.keys(held).length) pass.jobs[job.id] = held;
    return job;
  });

  for (const d of doc.disputes ?? []) questions.push({ id: `dispute-board-${questions.length + 1}`, about: "board", askedBy: "staves", status: "raised", text: disputeQuestion(d) });

  const appContext = contextOf(app);
  const exported = stanceOf(appContext?.stance, jobs.some(j => j.kind === "ghost"), doc.base);
  // The stance is only written into the board's context when it says something the board did not already imply.
  const context = appContext ? { ...appContext, ...(doc.stance !== exported ? { stance: doc.stance } : {}) } : doc.stance !== exported ? { stance: doc.stance } : undefined;
  const measures = record(doc.extensions?.[MEASURES]);
  const board: StavesBoard = compact({
    id: str(app.boardId) ?? doc.id, title: doc.title, goal: doc.goal, origin: str(app.origin),
    tracks, artifacts, jobs,
    context,
    questions,
    settled: app.settled as Board["settled"],
    regions: Array.isArray(app.regions) ? app.regions as Board["regions"] : [],
    comments: Array.isArray(app.comments) ? app.comments as Board["comments"] : [],
    perWeek: num(measures.perWeek),
    intent: app.intent as Board["intent"], vocabulary: app.vocabulary as Board["vocabulary"],
    base: doc.base, baseline: app.baseline as Board["baseline"],
  });
  const held = compact({
    board: Object.keys(pass.board).length ? pass.board : undefined,
    tracks: Object.keys(pass.tracks).length ? pass.tracks : undefined,
    artifacts: Object.keys(pass.artifacts).length ? pass.artifacts : undefined,
    jobs: Object.keys(pass.jobs).length ? pass.jobs : undefined,
  });
  if (Object.keys(held).length) {
    board[APP] = { passthrough: held };
    notes.push(`Kept as written and put back on export, but not saved to a Staves store: ${describePassthrough(held)}.`);
  }
  return { board, notes };
}

function describePassthrough(p: Passthrough): string {
  const parts = new Set<string>();
  const each = [p.board, ...Object.values(p.tracks ?? {}), ...Object.values(p.artifacts ?? {}), ...Object.values(p.jobs ?? {})];
  for (const item of each) if (item) for (const key of Object.keys(item)) parts.add(key === "extensions" ? "extensions Staves does not know" : key === "evidence" ? "evidence from systems other than Langfuse" : key === "refs" ? "references Staves does not model" : key === "tools" ? "tool references" : "provenance finer than Staves records");
  return [...parts].join(", ");
}

function disputeQuestion(d: Dispute): string {
  const claim = (c: Dispute["claims"][number]) => `${c.source.by ?? c.source.method} (${c.source.method}) says ${c.value === null || c.value === undefined ? "none" : typeof c.value === "string" ? c.value : JSON.stringify(c.value)}`;
  return `Sources disagree about ${d.field}: ${d.claims.map(claim).join("; ")}. Which is true?`;
}

function prerequisitesFrom(p: NonNullable<DocJob["prerequisites"]>, map: (id: string) => string): Prerequisites {
  const inputs = p.inputs.map(map);
  return p.kind === "conditional" ? { kind: "conditional", inputs, condition: p.condition ?? "" } : { kind: p.kind, inputs };
}

function readDocument(input: unknown): StavesDocument {
  const doc = typeof input === "string" ? JSON.parse(input) as unknown : input;
  if (!doc || typeof doc !== "object") throw new Error("A Staves document is a JSON object.");
  const d = doc as Partial<StavesDocument>;
  if (typeof d.staves !== "string") throw new Error("Not a Staves document: it has no \"staves\" version.");
  if (d.staves !== STAVES_FORMAT_VERSION) throw new Error(`This Staves reads format ${STAVES_FORMAT_VERSION}; the document is ${d.staves}.`);
  for (const key of ["tracks", "artifacts", "jobs"] as const) if (!Array.isArray(d[key])) throw new Error(`A Staves document needs a "${key}" array.`);
  if (typeof d.id !== "string" || typeof d.title !== "string") throw new Error("A Staves document needs an id and a title.");
  return d as StavesDocument;
}

/* ---------- small helpers ---------- */

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === "string" ? value : undefined;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const contextOf = (app: Record<string, unknown>) => app.context && typeof app.context === "object" ? app.context as NonNullable<Board["context"]> : undefined;

function extensions(parts: Record<string, Record<string, unknown>>): Extensions | undefined {
  const kept = Object.entries(parts).filter(([, value]) => Object.keys(value).length);
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/** Drop undefined properties, so a document has no keys a schema would read as present. */
export function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) if (v !== undefined) out[key] = v;
  return out as T;
}
