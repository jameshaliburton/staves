# Mappings — v0.1 (draft)

The Staves format sits beside other standards rather than replacing them. It describes the work
and who is accountable; the others run it, trace it, or plan the organisation around it. Each
mapping below says what corresponds, what is lost, and the direction supported.

## Agent standards (Agentic AI Foundation stack)

| Standard | Maps to | Direction | Notes |
|---|---|---|---|
| **MCP** | `tool.reach: "mcp"` + `refs: [{type:"mcp-tool", server, name}]` | reference | MCP is also how agents *write* boards (Staves' MCP server). |
| **A2A** | an `agent` track → `refs: [{type:"a2a-agent", uri}]` (its Agent Card); A2A task `INPUT_REQUIRED`/`AUTH_REQUIRED` ↔ a `gate` or a `queue` job | reference | A2A describes the runtime conversation; a board describes the job and who answers for the decision. |
| **AGENTS.md** | a repo's AGENTS.md MAY point at its boards | reference | |
| **Agent Skills (SKILL.md)** | a task MAY reference the skill its performer uses (`refs: [{type:"uri"}]`) | reference | Staves ships its generator as a skill. |

## Observability

| Standard | Maps to | Direction |
|---|---|---|
| **OpenTelemetry GenAI** (`invoke_agent`, `execute_tool`, `invoke_workflow` spans) | `evidence[]` with `system: "otel"`, `traceId`, `spanId` | import |
| **OpenInference** | `evidence[]` with `system: "openinference"`, `graphNodeId` from `graph.node.id` | import |
| **Langfuse** | `evidence[]` with `system: "langfuse"` | import |

Instrumented producers SHOULD emit the job id as a span attribute (proposed: `staves.job.id`)
so mapping is `instrumented`, not `proposed`. No span kind in these standards represents a
person's work; the board is where human steps live.

## Process

| Standard | Maps to | Direction | Lost on export |
|---|---|---|---|
| **BPMN 2.0** | track → lane (participant for `outside`); job → task (`userTask` for person, `serviceTask` for system/agent), composite → sub-process; artifact handoff → sequence flow + data object, across participants → message flow; exit → exclusive gateway; gate → exclusive gateway preceded by a `userTask`; loop → loop characteristics | export (import later) | provenance, disputes, outcome/beneficiary. Kept as `bpmn:documentation` / extension elements. |
| **OCEL 2.0** (object-centric event logs, process mining) | events → `evidence[]` (`system: "ocel"`); OCEL activity → job via `refs: [{type:"ocel-activity", id}]` | import | |
| **Arazzo** | system-track jobs → `refs: [{type:"arazzo", uri}]` | reference | |
| **Mermaid** | tracks → subgraphs, jobs → nodes, handoffs → edges (artifact as label), gates → rhombus | export | provenance (shown as a legend count) |

## Provenance

| Standard | Maps to |
|---|---|
| **W3C PROV-DM / PROV-O** | each field value = `prov:Entity`; `source` = `prov:Activity` typed by `method`; `by` = `prov:Agent` via `prov:wasAttributedTo`; `ref` = `prov:wasDerivedFrom`; `at` = `prov:generatedAtTime`. A PROV-JSON export is planned. |
| **SLSA / in-toto** | a board MAY be accompanied by an attestation "derived from repo@sha" (future). |

## Organisation, workforce and enterprise architecture

These are bridges, not core. The format does not model org charts, capabilities or positions;
it points at them.

| Ecosystem | Maps to | Direction |
|---|---|---|
| **HR / workforce planning** (Workday, SAP SuccessFactors, org charts) | `person` track → `refs: [{type:"role", uri}]` or `{type:"position", id}` — roles, never named employees | reference; org-chart → tracks import later |
| **O*NET / ESCO** | job or task → `refs: [{type:"onet-task", id}]`, `{type:"esco-skill", uri}` | reference |
| **ArchiMate** (LeanIX, Ardoq, Archi) | track → Business Role / Application Component; job → Business Process / Function; artifact → Business Object; gate → (no equivalent; kept as documentation) | export later |
| **Capability maps** | job → `refs: [{type:"capability", id}]` | reference |
| **Digital twin of the organisation** (Celonis, Signavio, ARIS) | board = designed/described model; twin = observed model. Evidence via OCEL; comparison of described vs observed is the join | import evidence; export later |

## Not mapped

Serverless Workflow, CMMN, DMN (a gate MAY reference a DMN decision via `refs`), Open Agent
Spec (agent flows; a later importer could turn its nodes into tasks).
