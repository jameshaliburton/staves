/* Plain JSON in and out, and BPMN 2.0 in: lanes → who, tasks → jobs, sequence flows → handoffs, gateways → decisions and ways out. */
import type { Board } from "./model.js";
import type { Op } from "./ops.js";

export function toJSON(b: Board) {
  return { staves: 1, title: b.title, goal: b.goal, context: b.context, intent: b.intent,
    who: b.tracks.filter((t) => !t.removed).map((t) => ({ id: t.id, name: t.name, kind: t.kind, note: t.meta })),
    jobs: b.jobs.filter((j) => !j.removed).map((j) => ({ id: j.id, name: j.name, who: j.track, parent: j.parent, trigger: j.trigger, outcome: j.outcome, for: j.beneficiary, doneWhen: j.doneWhen, kind: j.workKind, tools: j.tools, checks: j.checks, exits: j.exits, gate: j.gate, inputs: j.inputs, outputs: j.outputs, status: j.status })),
    things: b.artifacts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    regions: b.regions.filter((r) => !r.removed), questions: b.questions, comments: b.comments };
}
export function fromJSON(d: any): Op[] {
  const ops: Op[] = [];
  if (d.title) ops.push({ t: "board", id: d.id ?? "board", title: d.title, goal: d.goal });
  if (d.context) ops.push({ t: "setContext", context: d.context });
  for (const w of d.who ?? d.tracks ?? []) ops.push({ t: "track", track: { id: w.id, name: w.name, kind: w.kind ?? "person", meta: w.note ?? w.meta } });
  for (const a of d.things ?? d.artifacts ?? []) ops.push({ t: "artifact", artifact: { id: a.id, name: a.name, kind: a.kind ?? "document" } });
  for (const j of d.jobs ?? []) ops.push({ t: "job", job: { id: j.id, name: j.name, track: j.who ?? j.track, parent: j.parent, trigger: j.trigger ?? "hand", inputs: j.inputs ?? [], outputs: j.outputs ?? [], outcome: j.outcome, beneficiary: j.for ?? j.beneficiary, doneWhen: j.doneWhen, workKind: j.kind ?? j.workKind, tools: j.tools, checks: j.checks, exits: j.exits, gate: j.gate, provenance: { source: "import" as any, by: "import" }, status: j.status ?? "draft" } });
  for (const r of d.regions ?? []) ops.push({ t: "region", region: r });
  return ops;
}

/** BPMN 2.0 XML → ops. Tolerant: namespaces vary; we read by local name. */
export function fromBPMN(xml: string): Op[] {
  const ops: Op[] = [];
  const tag = (name: string) => new RegExp(`<(?:\\w+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}>)`, "g");
  const attr = (s: string, a: string) => (s.match(new RegExp(`\\b${a}="([^"]*)"`)) ?? [])[1];
  const un = (s?: string) => (s ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#10;|\n/g, " ").trim();
  // lanes → who
  const laneOf = new Map<string, string>(); let anyLane = false;
  for (const m of xml.matchAll(tag("lane"))) { const id = attr(m[1], "id") ?? `lane${laneOf.size}`; const name = un(attr(m[1], "name")) || "Someone"; anyLane = true; ops.push({ t: "track", track: { id, name, kind: /system|bot|agent|service|automation/i.test(name) ? (/agent|bot/i.test(name) ? "agent" : "system") : /customer|client|citizen|applicant|user|patient|claimant|supplier|vendor/i.test(name) ? "outside" : "person" } }); for (const r of (m[2] ?? "").matchAll(/<(?:\w+:)?flowNodeRef>([^<]+)</g)) laneOf.set(r[1].trim(), id); }
  if (!anyLane) ops.push({ t: "track", track: { id: "who", name: "Someone", kind: "person" } });
  // nodes
  const nodes = new Map<string, { name: string; type: string }>();
  for (const t of ["task", "userTask", "serviceTask", "scriptTask", "manualTask", "sendTask", "receiveTask", "businessRuleTask", "subProcess", "callActivity", "startEvent", "endEvent", "intermediateCatchEvent", "intermediateThrowEvent", "exclusiveGateway", "inclusiveGateway", "parallelGateway", "eventBasedGateway"]) for (const m of xml.matchAll(tag(t))) { const id = attr(m[1], "id"); if (id) nodes.set(id, { name: un(attr(m[1], "name")), type: t }); }
  // flows
  const flows: { from: string; to: string; name: string }[] = [];
  for (const m of xml.matchAll(tag("sequenceFlow"))) { const f = attr(m[1], "sourceRef"), to = attr(m[1], "targetRef"); if (f && to) flows.push({ from: f, to, name: un(attr(m[1], "name")) }); }
  const outs = (id: string) => flows.filter((f) => f.from === id), ins = (id: string) => flows.filter((f) => f.to === id);
  // gateways collapse: a task whose outgoing flow hits an exclusive gateway gets a decision + ways out; parallel gateways just pass through
  const passThrough = (id: string, seen = new Set<string>()): string[] => { const n = nodes.get(id); if (!n || seen.has(id)) return []; seen.add(id); if (/Gateway|Event/.test(n.type) && n.type !== "endEvent") return outs(id).flatMap((f) => passThrough(f.to, seen)); return [id]; };
  const jobIds = [...nodes].filter(([, n]) => /Task|subProcess|callActivity/.test(n.type)).map(([id]) => id);
  const artOf = (from: string, to: string) => `a-${from}-${to}`;
  for (const id of jobIds) {
    const n = nodes.get(id)!; const track = laneOf.get(id) ?? (anyLane ? [...laneOf.values()][0] : "who");
    const targets = outs(id).flatMap((f) => passThrough(f.to));
    const sources = ins(id).map((f) => f.from).flatMap((s) => nodes.get(s) && /Gateway|Event/.test(nodes.get(s)!.type) && nodes.get(s)!.type !== "startEvent" ? flows.filter((f) => f.to === s).map((f) => f.from) : [s]).filter((s) => jobIds.includes(s));
    const outputs = targets.map((t) => artOf(id, t)); const inputs = sources.map((s) => artOf(s, id));
    for (const t of targets) ops.push({ t: "artifact", artifact: { id: artOf(id, t), name: un(outs(id)[0]?.name) || `from ${n.name || id}`, kind: "record" } });
    const gw = outs(id).map((f) => nodes.get(f.to)).find((x) => x && /exclusiveGateway|inclusiveGateway/.test(x.type));
    const gwId = outs(id).find((f) => nodes.get(f.to) === gw)?.to;
    const exits = gwId ? outs(gwId).filter((f) => f.name).map((f) => ({ condition: f.name, target: nodes.get(f.to)?.name || f.to })) : undefined;
    const kind = n.type === "serviceTask" || n.type === "scriptTask" ? "system" : undefined;
    ops.push({ t: "job", job: { id, name: n.name || id, track, trigger: n.type === "userTask" || n.type === "manualTask" ? "hand" : "chain", inputs, outputs, gate: gw ? { rule: gw.name || "a decision", accountable: n.type === "userTask" ? track : "rule" } : undefined, exits: exits?.length ? exits : undefined, rationale: `imported from BPMN (${n.type})`, provenance: { source: "import" as any, by: "import" }, status: "draft" } });
  }
  return ops;
}
