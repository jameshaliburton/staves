import type { Board, Job } from "./model.js";

export interface ImpactFocus {
  jobIds?: string[];
  conceptIds?: string[];
  /** How many candidates to return. The tool answers in full; the interview asks for a smaller slice. */
  limit?: number;
}

type ImpactEdge = { from: string; to: string; kind: "artifact" | "exit" | "loop" | "parent" | "correction"; artifactId?: string };

/** Declared relationships identify investigation candidates, never proven runtime dependencies. */
export function investigateImpact(board: Board, focus: ImpactFocus) {
  const jobs = board.jobs.filter(j => !j.removed);
  const byId = new Map(jobs.map(j => [j.id, j]));
  const concepts = board.vocabulary?.concepts ?? [];
  const jobIds = [...new Set(focus.jobIds ?? [])];
  const conceptIds = [...new Set(focus.conceptIds ?? [])];
  if (!jobIds.length && !conceptIds.length) throw new Error("Choose at least one focus job or concept.");
  for (const id of jobIds) if (!byId.has(id)) throw new Error(`Unknown active focus job: ${id}`);
  for (const id of conceptIds) if (!concepts.some(c => c.id === id)) throw new Error(`Unknown focus concept: ${id}`);
  const linkedJobs = (links: { kind: string; id: string }[]) => jobs.filter(j => links.some(l =>
    l.kind === "job" ? l.id === j.id : l.kind === "track" ? l.id === j.track || l.id === j.gate?.accountable || l.id === j.gate?.ruleOwner : j.inputs.includes(l.id) || j.outputs.includes(l.id)
  )).map(j => j.id);
  const seed = new Set(jobIds);
  for (const c of concepts.filter(c => conceptIds.includes(c.id))) for (const id of linkedJobs(c.links ?? [])) seed.add(id);
  const sharedConcepts = concepts.filter(c => conceptIds.includes(c.id) || linkedJobs(c.links ?? []).some(id => seed.has(id)));
  const relatedConceptIds = new Set(sharedConcepts.flatMap(c => (c.relationships ?? []).map(r => r.target)));
  for (const c of concepts) if ((c.relationships ?? []).some(r => sharedConcepts.some(s => s.id === r.target))) relatedConceptIds.add(c.id);
  const relevantConcepts = concepts.filter(c => sharedConcepts.includes(c) || relatedConceptIds.has(c.id));
  const conceptCandidates = new Set(relevantConcepts.flatMap(c => linkedJobs(c.links ?? [])));
  const authorities = (j: Job) => [j.gate?.accountable, j.gate?.ruleOwner].filter((id): id is string => !!id && id !== "rule");
  const sharedAuthorities = new Set([...seed].flatMap(id => authorities(byId.get(id)!)));
  const authorityCandidates = jobs.filter(j => authorities(j).some(a => sharedAuthorities.has(a))).map(j => j.id);
  const edges: ImpactEdge[] = [];
  for (const j of jobs) {
    for (const producer of jobs) for (const artifactId of j.inputs.filter(id => producer.outputs.includes(id))) edges.push({ from: producer.id, to: j.id, kind: "artifact", artifactId });
    for (const exit of j.exits ?? []) if (exit.target && exit.target !== "stop" && byId.has(exit.target)) edges.push({ from: j.id, to: exit.target, kind: "exit" });
    if (j.loop && byId.has(j.loop.to)) edges.push({ from: j.id, to: j.loop.to, kind: "loop" });
    if (j.parent && byId.has(j.parent)) edges.push({ from: j.parent, to: j.id, kind: "parent" });
    if (j.correctionTo && byId.has(j.correctionTo)) edges.push({ from: j.id, to: j.correctionTo, kind: "correction" });
  }
  const walk = (start: Set<string>, reverse: boolean) => {
    const found = new Set(start); const queue = [...start];
    for (let i = 0; i < queue.length; i++) for (const e of edges) {
      if (e.kind === "parent") continue; // containment is context, not execution order
      const from = reverse ? e.to : e.from; const to = reverse ? e.from : e.to;
      if (queue[i] === from && !found.has(to)) { found.add(to); queue.push(to); }
    }
    return found;
  };
  const downstream = walk(seed, false); const upstream = walk(seed, true);
  const candidates = new Set([...downstream, ...upstream, ...conceptCandidates, ...authorityCandidates]);
  for (const e of edges.filter(e => e.kind === "parent")) if (seed.has(e.from) || seed.has(e.to)) { candidates.add(e.from); candidates.add(e.to); }
  const allCandidates = jobs.filter(j => candidates.has(j.id)).sort((a, b) => Number(seed.has(b.id)) - Number(seed.has(a.id)));
  const selected = allCandidates.slice(0, Math.max(1, focus.limit ?? 80)); const selectedIds = new Set(selected.map(j => j.id));
  const allEdges = edges.filter(e => selectedIds.has(e.from) && selectedIds.has(e.to));
  const allUnknowns = selected.flatMap(j => [
    ...(!j.prerequisites || j.prerequisites.kind === "unknown" ? [`${j.id}: prerequisite semantics are unspecified or unknown; artifact handoffs do not establish a start rule.`] : []),
    ...(j.gate && !j.gate.accountable ? [`${j.id}: decision accountability is unspecified.`] : []),
    ...(j.exits?.some(e => !e.target || e.target !== "stop" && !byId.has(e.target)) ? [`${j.id}: an exit has no active destination.`] : []),
    ...(j.boardRef ? [`${j.id}: linked board ${j.boardRef} was not read; investigate separately with authorized access.`] : []),
    ...j.inputs.filter(id => !board.artifacts.some(a => a.id === id && a.external) && !jobs.some(p => p.outputs.includes(id))).map(id => `${j.id}: input ${id} has no declared producer or external origin.`),
  ]);
  return {
    schema: "staves.impact", schemaVersion: 1,
    boardId: board.id,
    focus: { jobIds, conceptIds },
    basis: "Declared board relationships only; no repository, test, or trace inspection was performed.",
    jobs: selected.map(j => ({
      id: j.id, name: j.name, track: j.track,
      reasons: [seed.has(j.id) ? "focus" : null, downstream.has(j.id) && !seed.has(j.id) ? "downstream" : null, upstream.has(j.id) && !seed.has(j.id) ? "upstream" : null, conceptCandidates.has(j.id) ? "shared-concept" : null, authorityCandidates.includes(j.id) ? "shared-authority" : null, edges.some(e => e.kind === "parent" && (seed.has(e.from) && e.to === j.id || seed.has(e.to) && e.from === j.id)) ? "containment" : null].filter(Boolean),
      prerequisites: j.prerequisites ?? null, gate: j.gate ?? null,
      sources: (j.sources ?? []).slice(0, 10), omittedSources: Math.max(0, (j.sources?.length ?? 0) - 10), implementation: j.implementation ?? { state: "unknown" },
      omittedEvidenceReferences: Math.max(0, (j.executionEvidence ?? []).filter(e => !e.retraction).length - 5),
      evidenceReferences: (j.executionEvidence ?? []).filter(e => !e.retraction).map(e => ({ provider: e.provider, projectId: e.projectId, traceId: e.traceId, observationId: e.observationId, mapping: e.mapping?.method })).slice(0, 5),
    })),
    edges: allEdges.slice(0, 200),
    concepts: relevantConcepts.slice(0, 30).map(c => ({ id: c.id, name: c.name, status: c.status, definition: c.definition, relationships: (c.relationships ?? []).slice(0, 10), mappings: (c.mappings ?? []).slice(0, 10), omittedRelationships: Math.max(0, (c.relationships?.length ?? 0) - 10), omittedMappings: Math.max(0, (c.mappings?.length ?? 0) - 10) })),
    unknowns: allUnknowns.slice(0, 60),
    omitted: { jobs: allCandidates.length - selected.length, edges: Math.max(0, allEdges.length - 200), concepts: Math.max(0, relevantConcepts.length - 30), unknowns: Math.max(0, allUnknowns.length - 60) },
    repositoryQuestions: [
      `For focus jobs ${[...seed].join(", ") || "linked to the selected concepts"}, find implementations, callers, and contracts that depend on the behavior being changed. Cite file/symbol and commit; distinguish inspected code from assumptions.`,
      ...(sharedAuthorities.size ? [`Find permission and approval checks for ${[...sharedAuthorities].join(", ")}, including bypass, rejection, and recovery paths across these candidate jobs.`] : []),
      ...(relevantConcepts.length ? [`Find definitions and consumers of ${relevantConcepts.map(c => `${c.name} (${c.id})`).slice(0, 30).join(", ")}; identify conflicting meanings. Names alone do not establish identity.`] : []),
      "Which tests cover affected downstream behavior, exceptions and retries? Report what was actually run, source references, uncovered paths, and unavailable access.",
    ],
    boundaries: ["Investigation scope does not authorize edits to candidate jobs or code.", "This packet is a candidate map, not exhaustive technical truth; undeclared relationships may be absent.", "Langfuse is optional. References indicate recorded evidence associations, not new inspection or complete execution coverage.", "Only this board was inspected. No other board or repository was accessed."],
  };
}
