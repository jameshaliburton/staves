/**
 * A Staves document as a Mermaid flowchart, for anywhere Mermaid renders (GitHub, GitLab, Notion, docs).
 * Tracks are subgraphs, jobs are nodes, handoffs are edges labelled with what passes, and a gate is a
 * rhombus placed on the track of whoever answers for it. Tasks fold into the job they belong to, so the
 * chart shows the jobs a person would name. Provenance is summarised in one legend line.
 */
import { documentHandoffs, type DocJob, type StavesDocument } from "./format.js";

/** Mermaid reads `"` and `#` inside labels; everything a person wrote goes through this. */
const label = (text: string) => text.replace(/\s+/g, " ").trim().replace(/#/g, "#35;").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;");

const STYLE: Record<string, string> = {
  person: "fill:#fdf0e6,stroke:#b5652b,color:#3b2414",
  agent: "fill:#e7f4ef,stroke:#2f7a5c,color:#12332a",
  system: "fill:#e9edf7,stroke:#4a5f8c,color:#1b2440",
  outside: "fill:#f4ecf4,stroke:#8a5a8a,color:#2e1d2e",
  gate: "fill:#fff7d6,stroke:#9a7b0a,color:#3a2e04",
  draft: "stroke-dasharray:4 3",
  disputed: "stroke:#c0392b,stroke-width:2px",
};

export function toMermaid(doc: StavesDocument): string {
  const jobs = new Map(doc.jobs.map(j => [j.id, j]));
  const top = (id: string): string => { let j = jobs.get(id); const seen = new Set<string>(); while (j?.parent && jobs.has(j.parent) && !seen.has(j.id)) { seen.add(j.id); j = jobs.get(j.parent); } return j?.id ?? id; };
  const shown = doc.jobs.filter(j => !j.parent || !jobs.has(j.parent));
  const node = new Map<string, string>();
  shown.forEach((j, i) => node.set(j.id, `j${i}`));
  const gateNode = new Map<string, string>();
  shown.forEach((j, i) => { if (j.gate) gateNode.set(j.id, `g${i}`); });
  const artifactName = new Map(doc.artifacts.map(a => [a.id, a.name]));
  const trackIds = new Set(doc.tracks.map(t => t.id));

  const lines = ["flowchart LR"];
  const place = (track: string) => (j: DocJob) => j.track === track;
  // A gate sits on the track of whoever answers for it; a rule that decides by itself sits with the job.
  const gateHome = (j: DocJob) => j.gate?.accountable && trackIds.has(j.gate.accountable) ? j.gate.accountable : j.track;
  const gatesOn = (track: string) => shown.filter(j => j.gate && gateHome(j) === track);
  doc.tracks.forEach((t, i) => {
    const members = shown.filter(place(t.id)), gates = gatesOn(t.id);
    if (!members.length && !gates.length) return;
    lines.push(`  subgraph t${i}["${label(t.name)}"]`, "    direction LR");
    for (const j of members) lines.push(`    ${node.get(j.id)}["${label(j.name)}"]`);
    for (const j of gates) lines.push(`    ${gateNode.get(j.id)}{"${label(j.gate!.rule)}"}`);
    lines.push("  end");
  });
  for (const j of shown.filter(j => !trackIds.has(j.track))) lines.push(`  ${node.get(j.id)}["${label(j.name)}"]`);
  for (const j of shown.filter(j => j.gate && !trackIds.has(gateHome(j)))) lines.push(`  ${gateNode.get(j.id)}{"${label(j.gate!.rule)}"}`);

  // A gated job passes through its decision: everything it hands on leaves from the gate.
  for (const [job, gate] of gateNode) lines.push(`  ${node.get(job)} --> ${gate}`);
  const from = (id: string) => gateNode.get(id) ?? node.get(id)!;
  const edges = new Set<string>();
  const edge = (line: string) => { if (!edges.has(line)) { edges.add(line); lines.push(line); } };
  for (const h of documentHandoffs(doc)) {
    const a = top(h.from), b = top(h.to);
    if (a === b || !node.has(a) || !node.has(b)) continue;
    if (h.kind === "artifact") edge(`  ${from(a)} -->|"${label(artifactName.get(h.artifact!) ?? h.artifact!)}"| ${node.get(b)}`);
    else if (h.kind === "exit") edge(`  ${from(a)} -.->|"${label(h.condition ?? "")}"| ${node.get(b)}`);
    else edge(`  ${node.get(a)} -.->|"again"| ${node.get(b)}`);
  }
  shown.forEach(j => (j.exits ?? []).forEach(e => { if (e.target === "stop") { const end = `${node.get(j.id)}_stop`; edge(`  ${end}(("stop"))`); edge(`  ${from(j.id)} -.->|"${label(e.condition)}"| ${end}`); } }));

  const legend = provenanceLegend(doc);
  if (legend) lines.push(`  legend["${label(legend)}"]`, "  style legend fill:none,stroke:none");

  for (const [name, style] of Object.entries(STYLE)) lines.push(`  classDef ${name} ${style}`);
  const kindOf = new Map(doc.tracks.map(t => [t.id, t.kind]));
  const byKind = new Map<string, string[]>();
  const add = (cls: string, id: string) => byKind.set(cls, [...(byKind.get(cls) ?? []), id]);
  const disputed = new Set(doc.jobs.filter(j => j.disputes?.length).map(j => top(j.id)));
  for (const j of shown) {
    add(kindOf.get(j.track) ?? "system", node.get(j.id)!);
    if (j.status !== "confirmed") add("draft", node.get(j.id)!);
    if (disputed.has(j.id)) add("disputed", node.get(j.id)!);
  }
  for (const g of gateNode.values()) add("gate", g);
  for (const [cls, ids] of byKind) lines.push(`  class ${ids.join(",")} ${cls}`);
  return lines.join("\n") + "\n";
}

/** "Sources: 4 read from code · 2 from interviews · 1 inferred", counted over every job and task. */
function provenanceLegend(doc: StavesDocument): string | undefined {
  const words: Record<string, string> = { code: "read from code", interview: "from interviews", drawn: "drawn by a person", document: "from documents", trace: "observed", inferred: "inferred" };
  const counts = new Map<string, number>();
  for (const j of doc.jobs) {
    const method = j.provenance?.["*"]?.method ?? doc.provenance?.["*"]?.method ?? "unrecorded";
    counts.set(method, (counts.get(method) ?? 0) + 1);
  }
  if (!counts.size) return undefined;
  const confirmed = doc.jobs.filter(j => j.status === "confirmed").length;
  const disputes = doc.jobs.reduce((n, j) => n + (j.disputes?.length ?? 0), 0);
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n} ${words[m] ?? "source not recorded"}`);
  return `Sources: ${parts.join(" · ")} · ${confirmed} of ${doc.jobs.length} confirmed by a person · dashed = not yet confirmed` +
    (disputes ? ` · red = sources disagree (${disputes})` : "");
}
