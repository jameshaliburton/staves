/**
 * A Staves document as BPMN 2.0 XML, per spec/MAPPINGS.md, with a diagram so it opens drawn in BPMN tools.
 *
 * Tracks are lanes; an outside track is its own pool, and what passes to or from it is a message flow.
 * A job is a user task for a person and a service task for an agent or a system; a job with tasks is a
 * collapsed sub-process drawn on its own page. An artifact handoff is a sequence flow plus a data object; a
 * store is a data store. Exits leave through an exclusive gateway; a gate is a user task for whoever answers
 * for it, before that gateway. The result is a description, never an executable process
 * (isExecutable="false"). What BPMN has no place for — provenance, disputes, outcome — is kept as
 * documentation and staves: extension elements.
 */
import { documentHandoffs, STAVES_FORMAT_VERSION, type DocJob, type StavesDocument } from "./format.js";
import { VERSION } from "./version.js";

const NS = `https://staves.io/spec/${STAVES_FORMAT_VERSION}/bpmn`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const attr = (name: string, value: string | number | undefined) => value === undefined || value === "" ? "" : ` ${name}="${esc(String(value))}"`;

type Kind = "userTask" | "serviceTask" | "subProcess" | "exclusiveGateway" | "startEvent" | "endEvent" | "dataStoreReference";
interface Node {
  id: string; kind: Kind; name?: string; lane?: string; container: string;
  docs?: string; ext?: string; loopMaximum?: number; loop?: boolean;
  incoming: string[]; outgoing: string[];
  inputs: { ref: string; property: string; id: string }[]; outputs: { ref: string; id: string }[];
}
interface Flow { id: string; from: string; to: string; name?: string; container: string }
interface DataRef { id: string; object: string; name: string; container: string; anchor: string }

const SIZE: Record<Kind, [number, number]> = { userTask: [100, 80], serviceTask: [100, 80], subProcess: [100, 80], exclusiveGateway: [50, 50], startEvent: [36, 36], endEvent: [36, 36], dataStoreReference: [50, 50] };

export function toBPMN(doc: StavesDocument): string {
  const used = new Set<string>();
  const bid = (prefix: string, raw: string) => { const base = `${prefix}_${raw.replace(/[^A-Za-z0-9_.-]/g, "_")}`; let id = base, n = 2; while (used.has(id)) id = `${base}_${n++}`; used.add(id); return id; };
  const PROCESS = bid("Process", doc.id), COLLAB = bid("Collaboration", doc.id), POOL = bid("Participant", doc.id);

  const tracks = new Map(doc.tracks.map(t => [t.id, t]));
  const outside = (trackId: string) => tracks.get(trackId)?.kind === "outside";
  const jobs = new Map(doc.jobs.map(j => [j.id, j]));
  const children = (id: string) => doc.jobs.filter(j => j.parent === id && !outside(j.track));
  const participant = new Map(doc.tracks.filter(t => t.kind === "outside").map(t => [t.id, bid("Participant", t.id)]));
  const lanes = doc.tracks.filter(t => t.kind !== "outside");
  const laneId = new Map(lanes.map(t => [t.id, bid("Lane", t.id)]));

  const nodes = new Map<string, Node>();
  const flows: Flow[] = [], messages: { id: string; from: string; to: string; name?: string }[] = [];
  const dataRefs: DataRef[] = [], dataObjects: { id: string; container: string }[] = [];
  const element = new Map<string, string>(), tail = new Map<string, string>();
  const containerOf = new Map<string, string>();

  const add = (n: Omit<Node, "incoming" | "outgoing" | "inputs" | "outputs">) => { const node = { ...n, incoming: [], outgoing: [], inputs: [], outputs: [] }; nodes.set(n.id, node); return node; };
  const flow = (from: string, to: string, name?: string) => {
    const container = nodes.get(from)!.container, id = bid("Flow", `${from}_${to}`);
    flows.push({ id, from, to, name, container });
    nodes.get(from)!.outgoing.push(id); nodes.get(to)!.incoming.push(id);
  };

  // Jobs → flow nodes, depth first so a sub-process exists before its tasks.
  const place = (j: DocJob, container: string) => {
    if (outside(j.track)) return;
    const lane = container === PROCESS ? (laneId.has(j.track) ? j.track : undefined) : undefined;
    if (j.kind === "store") { const id = bid("Store", j.id); add({ id, kind: "dataStoreReference", name: j.name, container: PROCESS, lane }); element.set(j.id, id); containerOf.set(j.id, PROCESS); return; }
    const kids = children(j.id);
    const kind: Kind = kids.length ? "subProcess" : tracks.get(j.track)?.kind === "person" ? "userTask" : "serviceTask";
    const id = bid(kind === "subProcess" ? "SubProcess" : "Task", j.id);
    add({ id, kind, name: j.name, container, lane, docs: jobDocs(j), ext: jobExt(j), loopMaximum: j.loop?.to === j.id ? j.loop.limit : undefined, loop: j.loop?.to === j.id });
    element.set(j.id, id); containerOf.set(j.id, container);
    let last = id;
    if (j.gate) {
      const accountable = j.gate.accountable && laneId.has(j.gate.accountable) && container === PROCESS ? j.gate.accountable : lane;
      const decision = bid("Decision", j.id);
      add({ id: decision, kind: "userTask", name: `Decide: ${j.gate.rule}`, container, lane: accountable, docs: j.gate.accountable === "rule" ? `Decided by a rule${j.gate.ruleOwner ? `, owned by ${j.gate.ruleOwner}` : ""}.` : undefined });
      flow(id, decision); last = decision;
    }
    tail.set(j.id, last);
    for (const kid of kids) place(kid, id);
  };
  for (const j of doc.jobs.filter(j => !j.parent || !jobs.has(j.parent) || outside(jobs.get(j.parent)!.track))) place(j, PROCESS);

  // Handoffs. Two ends in different sub-processes meet at the level they share.
  const chain = (id: string) => { const out: string[] = []; for (let j = jobs.get(id); j && element.has(j.id); j = j.parent ? jobs.get(j.parent) : undefined) { out.push(j.id); if (out.length > 64) break; } return out; };
  const meet = (a: string, b: string): [string, string] | undefined => {
    for (const x of chain(a)) for (const y of chain(b)) if (containerOf.get(x) === containerOf.get(y)) return x === y ? undefined : [x, y];
    const [x, y] = [chain(a).at(-1), chain(b).at(-1)];
    return x && y && x !== y ? [x, y] : undefined;
  };
  const topOf = (id: string) => chain(id).at(-1) ?? id;
  const artifactName = new Map(doc.artifacts.map(a => [a.id, a.name]));
  const dataRefFor = (artifact: string, container: string, anchor: string) => {
    let ref = dataRefs.find(r => r.name === (artifactName.get(artifact) ?? artifact) && r.container === container);
    if (!ref) {
      const object = bid("DataObject", artifact);
      dataObjects.push({ id: object, container });
      ref = { id: bid("DataObjectReference", artifact), object, name: artifactName.get(artifact) ?? artifact, container, anchor };
      dataRefs.push(ref);
    }
    return ref;
  };
  const associate = (producer: string, consumer: string, ref: string) => {
    nodes.get(producer)!.outputs.push({ ref, id: bid("DataOutputAssociation", producer) });
    const property = bid("Property", consumer);
    nodes.get(consumer)!.inputs.push({ ref, property, id: bid("DataInputAssociation", consumer) });
  };
  const exitGateway = new Map<string, string>();
  const gatewayFor = (jobId: string) => {
    let gw = exitGateway.get(jobId);
    if (!gw) { const from = tail.get(jobId)!; gw = bid("Gateway", jobId); add({ id: gw, kind: "exclusiveGateway", container: nodes.get(from)!.container, lane: nodes.get(from)!.lane }); flow(from, gw); exitGateway.set(jobId, gw); }
    return gw;
  };

  for (const h of documentHandoffs(doc)) {
    const from = jobs.get(h.from)!, to = jobs.get(h.to)!;
    const name = h.kind === "artifact" ? artifactName.get(h.artifact!) ?? h.artifact : h.kind === "exit" ? h.condition : "again";
    if (outside(from.track) || outside(to.track)) {
      const source = outside(from.track) ? participant.get(from.track) : element.get(topOf(h.from));
      const target = outside(to.track) ? participant.get(to.track) : element.get(topOf(h.to));
      if (source && target && source !== target) messages.push({ id: bid("MessageFlow", `${h.from}_${h.to}`), from: source, to: target, name });
      continue;
    }
    if (from.kind === "store" || to.kind === "store") {
      const store = element.get(from.kind === "store" ? h.from : h.to), other = element.get(topOf(from.kind === "store" ? h.to : h.from));
      if (!store || !other) continue;
      if (from.kind === "store") nodes.get(other)!.inputs.push({ ref: store, property: bid("Property", other), id: bid("DataInputAssociation", other) });
      else nodes.get(tail.get(topOf(h.from)) ?? other)!.outputs.push({ ref: store, id: bid("DataOutputAssociation", other) });
      continue;
    }
    const ends = meet(h.from, h.to);
    if (!ends) continue;
    const [a, b] = ends;
    if (h.kind === "exit" && a === h.from) { flow(gatewayFor(a), element.get(b)!, name); continue; }
    const source = tail.get(a)!, target = element.get(b)!;
    flow(source, target, name);
    if (h.kind === "artifact") associate(source, target, dataRefFor(h.artifact!, nodes.get(source)!.container, source).id);
  }
  for (const j of doc.jobs) for (const e of j.exits ?? []) if (e.target === "stop" && element.has(j.id) && j.kind !== "store") {
    const gw = gatewayFor(j.id), end = bid("End", `${j.id}_stop`);
    add({ id: end, kind: "endEvent", name: e.condition, container: nodes.get(gw)!.container, lane: nodes.get(gw)!.lane }); flow(gw, end, e.condition);
  }

  // Every container starts and ends somewhere.
  for (const container of [PROCESS, ...[...nodes.values()].filter(n => n.kind === "subProcess").map(n => n.id)]) {
    const inside = [...nodes.values()].filter(n => n.container === container && n.kind !== "dataStoreReference");
    if (!inside.length) continue;
    const firsts = inside.filter(n => !n.incoming.length && n.kind !== "endEvent"), lasts = inside.filter(n => !n.outgoing.length && n.kind !== "startEvent" && n.kind !== "endEvent");
    if (firsts.length) { const start = bid("Start", container); add({ id: start, kind: "startEvent", container, lane: firsts[0].lane }); for (const n of firsts) flow(start, n.id); }
    if (lasts.length) { const end = bid("End", container); add({ id: end, kind: "endEvent", container, lane: lasts[0].lane }); for (const n of lasts) flow(n.id, end); }
  }

  /* ---------- semantic XML ---------- */

  const out: string[] = [];
  const nodeXml = (n: Node, pad: string): string[] => {
    if (n.kind === "dataStoreReference") return [`${pad}<bpmn:dataStoreReference id="${n.id}"${attr("name", n.name)} />`];
    const body: string[] = [];
    if (n.docs) body.push(`${pad}  <bpmn:documentation>${esc(n.docs)}</bpmn:documentation>`);
    if (n.ext) body.push(`${pad}  <bpmn:extensionElements>${n.ext}</bpmn:extensionElements>`);
    for (const f of n.incoming) body.push(`${pad}  <bpmn:incoming>${f}</bpmn:incoming>`);
    for (const f of n.outgoing) body.push(`${pad}  <bpmn:outgoing>${f}</bpmn:outgoing>`);
    const activity = n.kind === "userTask" || n.kind === "serviceTask" || n.kind === "subProcess";
    if (activity) {
      for (const i of n.inputs) body.push(`${pad}  <bpmn:property id="${i.property}" name="__input" />`);
      for (const i of n.inputs) body.push(`${pad}  <bpmn:dataInputAssociation id="${i.id}"><bpmn:sourceRef>${i.ref}</bpmn:sourceRef><bpmn:targetRef>${i.property}</bpmn:targetRef></bpmn:dataInputAssociation>`);
      for (const o of n.outputs) body.push(`${pad}  <bpmn:dataOutputAssociation id="${o.id}"><bpmn:targetRef>${o.ref}</bpmn:targetRef></bpmn:dataOutputAssociation>`);
      if (n.loop) body.push(`${pad}  <bpmn:standardLoopCharacteristics${attr("loopMaximum", n.loopMaximum)} />`);
    }
    if (n.kind === "subProcess") body.push(...containerXml(n.id, `${pad}  `));
    return [`${pad}<bpmn:${n.kind} id="${n.id}"${attr("name", n.name)}>`, ...body, `${pad}</bpmn:${n.kind}>`];
  };
  function containerXml(container: string, pad: string): string[] {
    const lines: string[] = [];
    for (const n of nodes.values()) if (n.container === container) lines.push(...nodeXml(n, pad));
    for (const d of dataObjects) if (d.container === container) lines.push(`${pad}<bpmn:dataObject id="${d.id}" />`);
    for (const r of dataRefs) if (r.container === container) lines.push(`${pad}<bpmn:dataObjectReference id="${r.id}"${attr("name", r.name)} dataObjectRef="${r.object}" />`);
    for (const f of flows) if (f.container === container) lines.push(`${pad}<bpmn:sequenceFlow id="${f.id}"${attr("name", f.name)} sourceRef="${f.from}" targetRef="${f.to}" />`);
    return lines;
  }

  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:staves="${NS}" id="${bid("Definitions", doc.id)}" targetNamespace="${NS}" exporter="Staves" exporterVersion="${esc(VERSION)}">`);
  out.push(`  <bpmn:collaboration id="${COLLAB}">`);
  out.push(`    <bpmn:participant id="${POOL}"${attr("name", doc.title)} processRef="${PROCESS}" />`);
  for (const t of doc.tracks.filter(t => t.kind === "outside")) out.push(`    <bpmn:participant id="${participant.get(t.id)}"${attr("name", t.name)} />`);
  for (const m of messages) out.push(`    <bpmn:messageFlow id="${m.id}"${attr("name", m.name)} sourceRef="${m.from}" targetRef="${m.to}" />`);
  out.push(`  </bpmn:collaboration>`);
  out.push(`  <bpmn:process id="${PROCESS}"${attr("name", doc.title)} isExecutable="false">`);
  if (doc.goal) out.push(`    <bpmn:documentation>${esc(doc.goal)}</bpmn:documentation>`);
  out.push(`    <bpmn:extensionElements><staves:board id="${esc(doc.id)}" format="${esc(doc.staves)}" stance="${doc.stance}" /></bpmn:extensionElements>`);
  if (lanes.length) {
    out.push(`    <bpmn:laneSet id="${bid("LaneSet", doc.id)}">`);
    for (const t of lanes) {
      out.push(`      <bpmn:lane id="${laneId.get(t.id)}"${attr("name", t.name)}>`);
      for (const n of nodes.values()) if (n.container === PROCESS && n.lane === t.id) out.push(`        <bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`);
      out.push(`      </bpmn:lane>`);
    }
    out.push(`    </bpmn:laneSet>`);
  }
  out.push(...containerXml(PROCESS, "    "));
  out.push(`  </bpmn:process>`);

  /* ---------- diagram ---------- */

  const dataStores = [...nodes.values()].filter(n => n.kind === "dataStoreReference");
  const pools = new Set(participant.values());
  const pagesFor = [COLLAB, ...[...nodes.values()].filter(n => n.kind === "subProcess").map(n => n.id)];
  for (const page of pagesFor) {
    const container = page === COLLAB ? PROCESS : page;
    out.push(`  <bpmndi:BPMNDiagram id="${bid("Diagram", page)}">`, `    <bpmndi:BPMNPlane id="${bid("Plane", page)}" bpmnElement="${page}">`);
    out.push(...layout(container, page === COLLAB).map(line => `      ${line}`));
    out.push(`    </bpmndi:BPMNPlane>`, `  </bpmndi:BPMNDiagram>`);
  }
  out.push(`</bpmn:definitions>`);
  return out.join("\n") + "\n";

  function layout(container: string, main: boolean): string[] {
    const inside = [...nodes.values()].filter(n => n.container === container && n.kind !== "dataStoreReference");
    const localFlows = flows.filter(f => f.container === container);
    // Columns by longest path, ignoring the flows that go back (loops and rework).
    const column = new Map<string, number>(), state = new Map<string, number>(), back = new Set<string>();
    const visit = (id: string) => { state.set(id, 1); for (const f of localFlows.filter(f => f.from === id)) { if (state.get(f.to) === 1) back.add(f.id); else if (!state.get(f.to)) visit(f.to); } state.set(id, 2); };
    for (const n of inside) if (!state.get(n.id)) visit(n.id);
    const forward = localFlows.filter(f => !back.has(f.id));
    for (let changed = true, guard = 0; changed && guard < inside.length + 2; guard++) {
      changed = false;
      for (const n of inside) { const c = Math.max(0, ...forward.filter(f => f.to === n.id).map(f => (column.get(f.from) ?? 0) + 1)); if (c !== (column.get(n.id) ?? 0)) { column.set(n.id, c); changed = true; } }
    }
    const rowsOf = (main ? lanes.map(t => t.id) : [""]).concat(main && inside.some(n => !n.lane) ? ["~"] : []);
    const laneOf = (n: Node) => main ? (n.lane ?? "~") : "";
    const slot = new Map<string, number>(), depth = new Map<string, number>();
    for (const n of inside) { const key = `${laneOf(n)}|${column.get(n.id) ?? 0}`; const k = depth.get(key) ?? 0; slot.set(n.id, k); depth.set(key, k + 1); }
    const CELL_W = 180, CELL_H = 150, POOL_X = 0, HEAD = main ? 60 : 0;
    const cols = Math.max(1, ...inside.map(n => (column.get(n.id) ?? 0) + 1));
    const width = HEAD + 60 + cols * CELL_W + 40;
    const outsidePools = main ? doc.tracks.filter(t => t.kind === "outside") : [];
    let y = 0;
    const lines: string[] = [], at = new Map<string, { x: number; y: number; w: number; h: number }>();
    const shape = (el: string, b: { x: number; y: number; w: number; h: number }, extra = "") => { at.set(el, b); lines.push(`<bpmndi:BPMNShape id="${bid("Shape", el)}" bpmnElement="${el}"${extra}><dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" /></bpmndi:BPMNShape>`); };
    for (const t of outsidePools) { shape(participant.get(t.id)!, { x: POOL_X, y, w: width, h: 80 }, ` isHorizontal="true"`); y += 110; }
    const laneTop = new Map<string, number>(), laneHeight = new Map<string, number>();
    const poolY = y;
    for (const row of rowsOf) {
      const tallest = Math.max(1, ...[...depth].filter(([key]) => key.startsWith(`${row}|`)).map(([, d]) => d));
      laneTop.set(row, y); laneHeight.set(row, tallest * CELL_H + 30); y += tallest * CELL_H + 30;
    }
    if (main) {
      shape(POOL, { x: POOL_X, y: poolY, w: width, h: y - poolY }, ` isHorizontal="true"`);
      for (const t of lanes) shape(laneId.get(t.id)!, { x: POOL_X + 30, y: laneTop.get(t.id)!, w: width - 30, h: laneHeight.get(t.id)! }, ` isHorizontal="true"`);
    }
    for (const n of inside) {
      const [w, h] = SIZE[n.kind];
      const cx = POOL_X + HEAD + 60 + (column.get(n.id) ?? 0) * CELL_W + 50, cy = laneTop.get(laneOf(n))! + 15 + (slot.get(n.id) ?? 0) * CELL_H + 40;
      shape(n.id, { x: cx - w / 2, y: cy - h / 2, w, h }, n.kind === "subProcess" ? ` isExpanded="false"` : "");
    }
    // Data objects sit under the task that produces them; stores along the bottom.
    const under = new Map<string, number>();
    for (const r of dataRefs.filter(r => r.container === container)) {
      const anchor = at.get(r.anchor); if (!anchor) continue;
      const k = under.get(r.anchor) ?? 0; under.set(r.anchor, k + 1);
      shape(r.id, { x: anchor.x + anchor.w / 2 - 18 + k * 44, y: anchor.y + anchor.h + 12, w: 36, h: 50 });
    }
    if (main) dataStores.forEach((s, k) => shape(s.id, { x: POOL_X + HEAD + 60 + k * 90, y: y + 30, w: 50, h: 50 }));
    const mid = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const edge = (el: string, points: { x: number; y: number }[]) => lines.push(`<bpmndi:BPMNEdge id="${bid("Edge", el)}" bpmnElement="${el}">${points.map(p => `<di:waypoint x="${Math.round(p.x)}" y="${Math.round(p.y)}" />`).join("")}</bpmndi:BPMNEdge>`);
    for (const f of localFlows) {
      const a = at.get(f.from), b = at.get(f.to); if (!a || !b) continue;
      if (back.has(f.id) || b.x <= a.x) {
        const low = Math.max(a.y + a.h, b.y + b.h) + 20;
        edge(f.id, [{ x: mid(a).x, y: a.y + a.h }, { x: mid(a).x, y: low }, { x: mid(b).x, y: low }, { x: mid(b).x, y: b.y + b.h }]);
      } else {
        const x = a.x + a.w + (b.x - a.x - a.w) / 2;
        edge(f.id, mid(a).y === mid(b).y ? [{ x: a.x + a.w, y: mid(a).y }, { x: b.x, y: mid(b).y }] : [{ x: a.x + a.w, y: mid(a).y }, { x, y: mid(a).y }, { x, y: mid(b).y }, { x: b.x, y: mid(b).y }]);
      }
    }
    // Only the short association from a task to what it produces is drawn. The ones to each consumer are in
    // the model but not the picture: drawn, they cross every lane, and the labelled flow already says it.
    for (const n of inside) for (const o of n.outputs) { const a = at.get(n.id), b = at.get(o.ref); if (a && b) edge(o.id, [mid(a), mid(b)]); }
    if (main) for (const m of messages) {
      const a = at.get(m.from), b = at.get(m.to); if (!a || !b) continue;
      const x = pools.has(m.from) ? mid(b).x : mid(a).x; // drawn straight down to, or up from, the task
      edge(m.id, a.y < b.y ? [{ x, y: a.y + a.h }, { x, y: b.y }] : [{ x, y: a.y }, { x, y: b.y + b.h }]);
    }
    return lines;
  }
}

function jobDocs(j: DocJob): string | undefined {
  const lines = [
    j.outcome && `Outcome: ${j.outcome}`, j.beneficiary && `For: ${j.beneficiary}`,
    j.doneWhen?.length ? `Done when: ${j.doneWhen.join("; ")}` : undefined,
    j.gate && `Gate: ${j.gate.rule}`,
    ...(j.exits ?? []).filter(e => !e.target).map(e => `Way out with no destination yet: ${e.condition}`),
    j.loop && j.loop.to === j.id ? `Repeats${j.loop.limit ? ` up to ${j.loop.limit} times` : ""}${j.loop.then ? `, then ${j.loop.then}` : ""}` : undefined,
    ...(j.disputes ?? []).map(d => `Sources disagree about ${d.field}.`),
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
}

function jobExt(j: DocJob): string {
  const p = j.provenance?.["*"];
  return `<staves:job id="${esc(j.id)}"${attr("status", j.status)}${attr("change", j.change)}${attr("kind", j.kind)} />` +
    (p ? `<staves:provenance method="${p.method}"${attr("by", p.by)}${attr("at", p.at)}${attr("ref", p.ref)}${p.confirmed ? ` confirmed="true"` : ""} />` : "");
}
