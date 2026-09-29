# Decisions and open questions — v0.1 (draft)

## Decided in v0.1

| Decision | Why |
|---|---|
| Name: **the Staves format**; files `*.staves.json` | One name for tool, format and author. A neutral rename is possible if it moves to a foundation (Swagger → OpenAPI precedent). "Mirror" and "Design" stay the two ways of writing a board (`stance`). |
| Snapshot JSON is the interchange; the op log is Staves' storage | Other tools need one readable file to diff and validate. |
| Handoffs derived, with deterministic ids | Keeps "you cannot draw an arrow nothing passes along", while giving BPMN/A2A/traces something to point at. |
| Provenance per field, PROV-compatible, with disputes | The feature no other format has; disputes are where boards earn their keep. |
| `stance` + `change` replace `ghost` jobs and board `context.stance` | Mirror vs Design must be explicit in the document. |
| Evidence generic (`system`), not Langfuse-only | OpenTelemetry is the standard; Langfuse is one provider. |
| App state (comments, questions, regions, interview ledger, vocabulary, intent, baselines) is out of core → `io.staves.app` | The spec describes work, not one tool's session. |
| Measures and detail fields → `io.staves.measures`, `io.staves.detail` | Useful, but not needed to describe work; keeps the core small. |
| `sources` and `instructions` → `refs` of type `code` / `instructions` | One reference mechanism. |
| Roles, not people; pseudonymous `by` | See README §9. |
| **Identifiers are unique across the whole board**, not per kind: no track, artifact and job share an id. Exporters from tools that allowed collisions rename them deterministically — ids are allocated jobs first, then tracks, then artifacts, each in document order; the first holder keeps the id and a later one takes the first free `-2`, `-3`, … suffix — and record every rename so the tool can read its own ids back. Staves itself must stop creating new collisions. | Handoff ids, trace attributes (`staves.job.id`) and other tools refer to objects by id alone. An id that could mean a job or an artifact makes every such reference ambiguous. |

## From the current Staves model (src/model.ts) to v0.1

| Today | v0.1 |
|---|---|
| `Job.provenance` (source `agent·human·confirmed·derived`) + `confirmedFields[]` | `provenance["*"]` with `method`; `confirmed` per field. `agent` → `code` or `inferred` by context; `human` → `interview` or `drawn`; `derived` → `inferred`. |
| Track/artifact without provenance | Optional `provenance` on every object. |
| `Job.status` | unchanged |
| `Job.kind: "ghost"` | `change: "added"` on a `to-be` board |
| `Job.sources[]`, `Job.instructions[]` | `refs` (`code`, `instructions`); inline instruction `text` is not carried |
| `Job.executionEvidence[]` (Langfuse) | `evidence[]` (`system: "langfuse"`) |
| `examples`, `checks` | `io.staves.detail` |
| `minutes`, `perWeek`, track capacity/people/budget | `io.staves.measures` |
| `movedFrom`, `correctionTo`, `boardRef`, `size`, `workKind`, `implementation`, `replacedBy`, `removed` | `io.staves.app` (tombstones are not exported) |
| `Board.questions/comments/regions/settled/context/vocabulary/intent/baseline` | `io.staves.app` |
| `Board.base` | `base` |

## Open questions

1. **Tasks as jobs.** v0.1 keeps one shape with `parent`. Do consumers need a distinct `task`
   kind to avoid clashing with A2A's runtime "Task"? (Leaning: no; document the difference.)
2. **Handoff ids for multiple exits to the same target.** Index-based ids are stable only while
   exit order is. Use exit ids instead?
3. **Gate placement.** A gate sits on a job today. Is a gate on a handoff (between two performers)
   ever needed? BPMN users will expect gateways between tasks.
4. **Parallelism.** `prerequisites` covers joins (`all`/`any`); forks are implicit (one output,
   several consumers). Is that enough for designers modelling parallel agent branches?
5. **Confidence semantics.** A 0–1 self-reported number is easy to write and hard to compare.
   Replace with `said · implied · asked` (the interviewer's scale)?
6. **Signed boards.** Should a board derived from code carry an attestation (commit, producer,
   hash) so reviewers can trust "the code says"?
7. **Name.** Staves format vs a neutral name (e.g. Open Work Format). Revisit at the first
   foundation conversation, not before.
8. **Org and twin bridges.** Which of HR roles, ArchiMate export, OCEL import comes first?
   Decide from the first outside adopter's needs.
