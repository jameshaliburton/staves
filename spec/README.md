# The Staves format — v0.1 (draft)

**An open format for work shared by people, agents and systems: who does what, what passes
between them, where a person decides, and how we know.**

Status: **draft for comment**. Breaking changes are expected before 1.0. Licence: Apache-2.0.

> **Conformance of Staves itself.** Staves (the app, CLI and MCP server) is not yet a fully conforming
> consumer (§10): it shows a dispute as an open question on the board rather than as the competing claims
> of §5.1, so a dispute read in does not come back out as one. Everything else a board has no field for —
> unknown extensions, evidence from other systems, references and provenance it does not model — is kept
> and written back unchanged, though not yet when a board is saved to a Staves store.
Editor: James Haliburton. Schema: [`schema/board.schema.json`](schema/board.schema.json).
Example: [`examples/support-triage.staves.json`](examples/support-triage.staves.json).
Mappings to other standards: [`MAPPINGS.md`](MAPPINGS.md). Open questions: [`DECISIONS.md`](DECISIONS.md).

---

## 1. Why this exists

Agent standards describe machines talking to machines: MCP connects an agent to tools, A2A
connects agents to each other, OpenTelemetry records what ran. In all of them a person appears
only as "the user" who is asked for input. Process standards such as BPMN can place people in
lanes, but they are built to be executed, are heavy to write, and say nothing about where a
statement came from.

Nothing describes the work itself, the way the people in it would recognise it: **jobs**,
performed by **people, agents and systems** as equals, with what passes between them, where a
person is accountable for a decision, and **where each fact came from** — a person's words, the
code, or a trace of what actually ran.

The Staves format is that description. It is written by coding agents that read a system, by
interviewers that talk to the people in it, and by people drawing it by hand. It is read by
people reviewing the work, and by tools that build, run or observe it.

It **describes work. It never runs it.** It holds no prompts to execute, no credentials, no
schedules. Execution belongs to runtimes (n8n, agent frameworks, BPMN engines); this format
is what you hand them, and what you check them against.

## 2. Design principles

1. **The job is the unit.** A job is work done for someone with an outcome they would name.
   Jobs break down into tasks; tasks are jobs too.
2. **Performers are equal.** A person, an agent and a system each get a track. Nobody is a
   footnote to a machine, and no machine is hidden inside a person's job.
3. **Handoffs are derived, never drawn.** A handoff exists because one job produces what another
   takes. You cannot draw an arrow that nothing passes along.
4. **Every fact says where it came from.** Provenance is per field, and two sources can
   disagree on the record.
5. **Nothing is inferred on the way in.** What is missing stays missing and becomes a question,
   rather than a plausible guess.
6. **Small core, named extensions.** The core fits in your head. Everything else lives in a
   namespace and is preserved by tools that do not understand it.
7. **Roles, not people.** The format describes work, not individuals. See §9.

## 3. Document

A Staves document is one **board**: one piece of work, as it is today or as it is proposed.
It is a JSON object, UTF-8, conventionally named `<name>.staves.json`. Media type:
`application/vnd.staves+json`.

```json
{
  "$schema": "https://staves.io/spec/0.1/board.schema.json",
  "staves": "0.1",
  "id": "support-triage",
  "title": "Support triage",
  "goal": "Every customer question gets a correct answer or a person, same day",
  "stance": "as-is",
  "tracks": [], "artifacts": [], "jobs": []
}
```

| Field | Required | Meaning |
|---|---|---|
| `staves` | yes | Format version this document follows. |
| `id`, `title` | yes | Stable identifier; human title. |
| `goal` | no | The outcome the whole board is for, in the words of those it serves. |
| `stance` | yes | `as-is` — a description of work that exists today (what Staves calls *Mirror*). `to-be` — a design for work that should exist (*Design*). |
| `base` | no | For a `to-be` board, the `id` (or URI) of the `as-is` board it changes. |
| `tracks`, `artifacts`, `jobs` | yes | The work. May be empty. |
| `handoffs` | no | Derived (§5.4). Producers MAY include them for consumers that cannot derive. |
| `provenance`, `refs`, `extensions` | no | As on any object (§6, §7, §8). |

Identifiers are strings matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`, unique within the board.

## 4. Core concepts

Eight shapes: **track, job, artifact, trigger, exit, gate, loop, tool** — plus **handoffs**,
derived from them, and **provenance** and **evidence**, which attach to them.

### 4.1 Track — who performs

```json
{ "id": "agent-triage", "name": "Triage agent", "kind": "agent", "description": "Reads each ticket and routes it" }
```

`kind` is one of `person` (a role people fill), `agent` (an AI agent), `system` (deterministic
software), `outside` (a party outside the work's control: a customer, a regulator, a vendor).
A `person` track names a **role**, not a person.

### 4.2 Job — what gets done

```json
{
  "id": "route", "name": "Route the ticket", "track": "agent-triage",
  "outcome": "The ticket is with whoever can answer it", "beneficiary": "customer",
  "inputs": ["ticket"], "outputs": ["routed-ticket"],
  "trigger": "event", "status": "draft"
}
```

| Field | Meaning |
|---|---|
| `track` | Who performs it. Required. |
| `parent` | The job this is a task of. Tasks may nest. |
| `kind` | `work` (default) · `queue` (instances wait here) · `store` (where an artifact rests; not a step) · `watch` (someone sees but does not act) · `outside` (outside the work's control). |
| `outcome`, `beneficiary`, `doneWhen[]` | The job in the words of the people it serves. |
| `inputs[]`, `outputs[]` | Artifact ids it takes and produces. Required; may be empty. |
| `trigger` | How it starts (§4.4). |
| `exits[]`, `gate`, `loop` | Ways out, decisions, repetition (§4.5–4.7). |
| `tools[]` | What the performer uses (§4.8). |
| `status` | `draft` (described, nobody has confirmed it) · `confirmed` (a person with standing has confirmed it). |
| `change` | On `to-be` boards only: `added` · `changed` · `moved` · `removed` · `unchanged`, relative to `base`. |
| `order` | Position among siblings when description order is not enough. |

### 4.3 Artifact — what passes

```json
{ "id": "routed-ticket", "name": "Routed ticket", "kind": "record", "livesIn": "Zendesk", "note": "Queue and priority set" }
```

`kind`: `document` · `data` · `decision` · `message` · `record` · `instruction` · `measure` ·
`other`. `external: true` marks something that enters from outside the board. `note` says what
the receiver needs from it.

### 4.4 Trigger — how a job starts

`hand` (when someone gets to it) · `ask` (when someone asks) · `event` (when something
arrives) · `chain` (when the previous job ends) · `clock` (on a schedule) · `watch` (when a
condition is met) · `deadline` (when time runs out) · `always` (never stops) · `other` (say it in
`triggerNote`). A job with several inputs MAY say whether it needs `all`, `any`, or a
`conditional` set of them in `prerequisites`.

### 4.5 Exit — ways out

```json
{ "condition": "no matching answer in the help centre", "target": "escalate", "share": 0.3 }
```

`condition` is in the language of the work. `target` is a job id or `stop` (this instance
ends). A missing `target` is a dangling exit — a known unknown, not an error. `share` is the
rough fraction of instances, 0–1.

### 4.6 Gate — where someone decides

```json
{ "rule": "no refund above €200 without a person", "accountable": "person-support-lead" }
```

A gate is a decision the work cannot pass without. `accountable` is the track that answers for
it, or `rule` when a rule decides by itself — in which case `ruleOwner` names who owns the rule.
**Gates are the point of the format:** they are where a person is, or should be, in the loop.

### 4.7 Loop — repetition

```json
{ "to": "draft-reply", "limit": 3, "then": "hand to a person" }
```

### 4.8 Tool — what a performer uses

```json
{ "name": "Zendesk search", "reach": "mcp", "does": "returns the top five articles, titles only", "limits": "no attachments" }
```

`reach`: `api` · `mcp` · `screen` (a person or agent operates a UI) · `none` (named but not
reachable by the performer). `personal: true` marks a tool tied to one person's account.

### 4.9 Handoff — derived

A handoff exists from job A to job B when:

- A outputs an artifact that B takes as input (`kind: artifact`), or
- an exit on A targets B (`kind: exit`), or
- A loops to B (`kind: loop`).

Handoffs are never authored. Consumers derive them; producers MAY list them. Their ids are
deterministic so that other formats can point at them:

- artifact: `<from>><to>@<artifact>`
- exit: `<from>><to>!<exit index>`
- loop: `<from>><to>~loop`

## 5. Provenance

Every object MAY carry `provenance`: a map from a **field path** to a **source**. The key `*`
is the default for the whole object; any other key (`gate.accountable`, `trigger`,
`exits.0.target`) overrides it for that field.

```json
"provenance": {
  "*":               { "method": "code", "by": "agent:claude-code", "at": "2026-09-20T10:02:00Z", "ref": "git:4be1c2e:src/triage.ts#route" },
  "gate.accountable":{ "method": "interview", "by": "role:support-lead", "at": "2026-09-21T14:10:00Z", "confirmed": true }
}
```

A **source** has:

| Field | Meaning |
|---|---|
| `method` | How it is known: `interview` (a person said it) · `drawn` (a person wrote it on the board) · `document` (a written procedure, ticket, spec) · `code` (read from source) · `trace` (observed in execution) · `inferred` (concluded, not observed — always to be confirmed). Required. |
| `by` | Who or what recorded it, as a pseudonymous actor id: `role:<role>`, `person:<pseudonym>`, `agent:<name>`, `tool:<name>`. |
| `at` | When, RFC 3339. |
| `ref` | What it was derived from: a commit and path (`git:<sha>:<path>#<symbol>`), a trace (`otel:<trace-id>/<span-id>`), a transcript or document URI. |
| `confidence` | 0–1, the recorder's own confidence. |
| `confirmed` | `true` when a person with standing has confirmed this field. |

### 5.1 Disputes

Sources disagree. The code says the agent refunds automatically; the support lead says every
refund is checked. The format records both instead of choosing:

```json
"disputes": [
  { "field": "gate",
    "claims": [
      { "value": null, "source": { "method": "code", "by": "agent:claude-code", "ref": "git:4be1c2e:src/refund.ts#issue" } },
      { "value": { "rule": "every refund is checked", "accountable": "person-support-lead" },
        "source": { "method": "interview", "by": "role:support-lead" } }
    ] }
]
```

The field itself holds whichever value the producer shows by default; `disputes` holds the
competing claims. A dispute is resolved by a person, which removes it and marks the field
`confirmed`. **An unresolved dispute between what people say and what the code does is often
the most important thing on a board.**

This model is W3C PROV-compatible: each source is a `prov:Activity` of type `method`, `by` is a
`prov:Agent` (`wasAttributedTo`), `ref` is `wasDerivedFrom`. See `MAPPINGS.md`.

## 6. Evidence

A job MAY carry `evidence[]`: references to observed executions. Evidence is a **pointer, never a
copy** — no inputs, outputs or prompts.

```json
"evidence": [
  { "system": "otel", "traceId": "4bf92f3577b34da6a3ce929d0e0e4736", "spanId": "00f067aa0ba902b7",
    "observedAt": "2026-09-19T08:14:03Z", "status": "ok",
    "mapping": { "method": "reviewed", "by": "role:engineer" } }
]
```

`system`: `otel` · `openinference` · `langfuse` · other. `mapping.method` says how the span was
linked to this job: `instrumented` (the code emits the job id), `proposed` (a tool guessed), or
`reviewed` (a person checked). Observation does not confirm a description; it is evidence for
or against it.

## 7. References

Any track, job, artifact or tool MAY carry `refs[]`, pointing at the same thing in another
system. Core types:

| `type` | Points at |
|---|---|
| `code` | `path`, optional `symbol` — where the job lives in a repo |
| `instructions` | `path` — the prompt, rubric or config a performer works from (never inlined) |
| `mcp-tool` | `server`, `name` |
| `a2a-agent` | `uri` of an A2A Agent Card |
| `bpmn` | `id` of a BPMN element |
| `arazzo` | `uri` of an Arazzo workflow or step |
| `onet-task` / `esco-skill` | occupational task or skill identifier |
| `uri` | anything else |

## 8. Extensions

Anything outside the core goes in `extensions`, keyed by a reverse-DNS namespace:

```json
"extensions": { "io.staves.measures": { "minutes": 4, "perWeek": 1200 } }
```

Consumers MUST preserve extensions they do not understand when they write a document back, and
MUST NOT fail on them. Namespaces defined alongside this spec:

- `io.staves.measures` — `minutes` per instance, `perWeek` volume, track `capacityHoursPerWeek`,
  `people`, `budgetSeconds`.
- `io.staves.detail` — `examples[]` (one input and what it became), `checks[]` (what a task checks
  and what happens on failure).
- `io.staves.app` — Staves' own state: questions, comments, regions, interview progress. Other
  tools SHOULD ignore it.

Producers MAY define their own (`com.example.*`).

## 9. People

A board describes work that people do. It can also be misused to watch or replace them.
The format takes a position:

- `person` tracks are **roles**. Do not name individuals in tracks, jobs or `by` fields;
  use `role:` or a pseudonymous `person:` id whose mapping stays outside the document.
- Measures (`io.staves.measures`) describe the work, not an individual's performance. Tools
  SHOULD NOT produce per-person productivity figures from boards.
- Evidence never contains trace payloads.
- A board built from interviews SHOULD be shown to the people interviewed before it is used to
  decide about their work.

Where boards describe employees' work, local law and agreements apply (in the EU, the GDPR; in
many countries, co-determination with employee representatives).

## 10. Conformance

- A **valid document** validates against the JSON Schema for its `staves` version.
- A **producer** writes valid documents, derives nothing it cannot back with a source, and marks
  `inferred` what it concluded.
- A **consumer** accepts any valid document of a supported version, derives handoffs, preserves
  unknown extensions, and shows disputes rather than silently picking a side.

## 11. Versioning

`staves` is `MAJOR.MINOR`. Before 1.0, minor versions may break. From 1.0, minor versions only
add optional fields; removals are announced one minor version ahead and kept readable for twelve
months. Every change is recorded in [`CHANGELOG.md`](CHANGELOG.md).

## 12. Relation to Staves the tool

Staves (the app, CLI and MCP server) stores a board as an append-only operation log so that
boards merge in git and every change has an author. **The log is an implementation; this format
is the interchange.** Staves reads and writes `.staves.json` snapshots; other tools need only the
snapshot.
