---
title: "Every tool, and when to reach for it"
description: "The complete Staves MCP surface, generated from the server: what each tool does and what it takes."
---

Your coding agent has these once it is connected. You will rarely name one — saying *run staves*
or *what has drifted* is enough — but this is what is behind those requests, and what to ask for
when you want something specific.

:::note
This page is generated from the running server. Every argument a tool takes is listed here.
:::

## Finding your way

Start here when you do not know what exists yet.

### `staves_access`

Read this connection's current permission, accessible board selection and remaining creation allowance before writing. Does not create a board.

Takes nothing.

### `staves_help`

How staves works and how to use its tools, for an agent.

Takes nothing.

### `staves_list`

List the boards in this project: what each one is called, its id, and where it is drawn.

Takes nothing.

### `staves_survey`

Only when a person explicitly asks for a survey. Call staves_access first; a survey uses one board of your creation allowance. Record the workflows you can see, one line each — the entry point where a request from someone outside arrives, the outcome for the person it is for, and a rough size. This writes the 'survey' board (each workflow is a job that opens its own board) and asks the person how to proceed: one workflow, an audit of all of them briefly, or all of them in depth. Then follow their answer: 'describe:<id>' → describe that one in depth on its own board named <id>; 'audit' → for each workflow, its own board with 3–6 jobs, no tasks, then staves_review each and give a one-line verdict per workflow; 'all' → each in depth. If they answered on the web page, staves_issues shows the answer.

| Argument | | What it is |
| --- | --- | --- |
| `workflows` | **required** | — |

### `staves_board`

Read the board as JSON, with findings.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

### `staves_brief`

Read the board as prose: who does what, the jobs with their accounts, the cut, the findings, and what is still open. Read this before working on the system it describes.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

## Interviewing in your agent

Talk through the work and save drafts without a separate model or browser interview.

### `staves_interview`

Get the interview craft and existing board context. You are the interviewer; use your current model and save drafts through these tools.

| Argument | | What it is |
| --- | --- | --- |
| `board` | optional | — |

### `staves_interview_record`

Save actual words reported by the person, separately from your interpretation. Agent-attributed evidence, not human confirmation. Build the corresponding draft graph at a coherent interview checkpoint; do not force a write before every question.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `quote` | **required** | — |
| `interpretation` | optional | — |
| `about` | optional | — |

### `staves_interview_progress`

Save honest progress: working, partial (paused or blocked), or ready for human review. Does not mark behavior implemented or confirm the description.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `state` | **required** | — |
| `summary` | **required** | — |

## Domain vocabulary

Read stable work concepts and propose domain definitions with explicit implementation associations.

### `staves_vocabulary`

Read the versioned core work contract and this board's domain concepts, definitions, aliases, relationships and implementation mappings. Read-only; Langfuse and repository access are optional. Domain definitions are design knowledge, not proof of implementation.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

### `staves_vocabulary_propose`

Propose a coherent domain vocabulary revision for human review. Read staves_vocabulary first and preserve all existing identities. Inferred meanings stay inferred; a proposal does not confirm a definition or verify code. Includes explicit workflow links and optional repository/API/Langfuse mappings; never provide credentials.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `vocabulary` | **required** | — |
| `basis` | **required** | Exact basis returned by staves_vocabulary |

## Langfuse execution evidence

Connect a project, instrument job identifiers, and attach explicitly mapped observations.

### `staves_langfuse_connect`

Connect this board to a Langfuse project using public configuration only. Credentials stay in the agent environment; never pass secrets here. Several boards may share one project.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `baseUrl` | **required** | — |
| `projectId` | **required** | — |

### `staves_langfuse_instrumentation`

Get stable board/job metadata for direct Langfuse observation instrumentation. Read-only. One job may encompass many observations and traces; missing telemetry means not observed.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `job` | **required** | — |

### `staves_langfuse_evidence`

Read one Langfuse observation with local credentials. Tagged observations attach directly; untagged historical observations need associationRationale and become proposals for human review. No prompts or outputs are copied. At most 100 retained captures per job. Use refresh for later state of an existing capture.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `job` | **required** | — |
| `traceId` | **required** | — |
| `observationId` | **required** | — |
| `associationRationale` | optional | — |
| `implementationRef` | optional | — |
| `fromStartTime` | optional | — |
| `toStartTime` | optional | — |

### `staves_langfuse_refresh`

Fetch a later state of one exact evidence capture, retaining its previous summary and mapping. Requires local Langfuse credentials. Never refreshes a retracted reference or changes its source. At most 100 retained captures per job.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `job` | **required** | — |
| `key` | **required** | — |
| `fromStartTime` | optional | — |
| `toStartTime` | optional | — |

### `staves_langfuse_retract`

Retract a selected evidence capture with a reason while retaining its history. This labels a copied reference; it does not revoke upstream access or delete Langfuse data.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `job` | **required** | — |
| `key` | **required** | — |
| `reason` | **required** | — |

## Drawing the work

Building a board from what the code actually does.

### `staves_start`

Start or reopen a board for one piece of work. Give it a title in the language of the work ("How a lead becomes a sent proposal"), the goal in one sentence (what it delivers, to whom, and the rule that must never be broken), and where this description comes from.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | short id, e.g. lookup |
| `title` | **required** | — |
| `goal` | optional | — |
| `origin` | optional | — |

### `staves_track`

Add a performer: a person (a role, not a name), an agent (say which model or prompt), a system (a service), or an outside party (a customer, a registry, a mail provider). One track per performer.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | **required** | — |
| `name` | **required** | — |
| `kind` | **required** | — |
| `meta` | optional | one line: what this performer is for or what is unknown about it |

### `staves_artifact`

Name something that changes hands: a document, data, a decision, a message, a record. Mark it external if it enters from outside and nothing on the board produces it. Say where it lives if you know.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | **required** | — |
| `name` | **required** | — |
| `kind` | optional | — |
| `external` | optional | — |
| `livesIn` | optional | — |

### `staves_describe`

Describe one job as work, not as code. A job is named by what a person has when it is done — someone is waiting on it, and that someone is a person or an outside party, never a system. If only another step waits on it, it is a task: give it a parent. Describe from the outside in: the people who ask and receive first, then the jobs between them, then machinery as tasks inside those jobs. Helpful for understanding the job: outcome (what is different when it's done), beneficiary (who is waiting on it and what they do with it), doneWhen (what you would check). You may submit without them; the job is kept as a draft and you get the questions back. Answer them by calling staves_describe again with the same id. Say what starts it: event (something arrives), chain (the previous job ends), clock (a schedule), hand (a person gets to it). List inputs and outputs by artifact id — handoffs are derived from these, never drawn. If the job decides something, give the gate: the rule in words, and who is accountable (a track id, or "rule" if a rule decides — then name the rule's owner if you can). Give every exit a target (a job id, or "stop"). An exit with no target is a finding, not an error — leave it if the code truly does not say. Loops: say where it goes back to and the limit; a loop without a limit is a finding. Tasks pass the stranger test: a competent stranger could do it by hand from the description and get the same result, including the same failures. Answer: what arrives; what you open; what you look at — which part, how much, how far in; what you're looking for; what you do with it; when you stop; what you do when it isn't there, is ambiguous, or disagrees. Put that narration in outcome/doneWhen/rationale. Tools: name them, how they are reached (api, mcp, screen, none), what comes back for this task (does: shape, portion, size, freshness, verbatim or summarised), and what it does not return or does when it fails (limits). 'Unknown' is a valid value; a missing one is a finding. Mark a person's own spreadsheet, file, or colleague as personal. Where you cannot tell from the code, say unknown in the field or ask with staves_ask. Do not infer.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | **required** | — |
| `name` | **required** | — |
| `track` | **required** | — |
| `parent` | optional | job id, if this is a task inside a job |
| `kind` | optional | — |
| `outcome` | optional | — |
| `beneficiary` | optional | — |
| `doneWhen` | optional | — |
| `rationale` | optional | — |
| `trigger` | optional | how it starts: hand (someone gets to it), ask (someone asks for it), event (something arrives), chain (the previous one ends), clock (a schedule), watch (a condition is met), deadline (time runs out), always (never stops), other (say it in triggerNote) |
| `triggerNote` | optional | the trigger in the person's words when none of the kinds fit |
| `inputs` | optional | — |
| `outputs` | optional | — |
| `prerequisites` | optional | Explicit start rule over input artifact IDs. Omit when unresolved; never infer all from multiple handoffs. Conditional requires the named condition and all listed inputs. |
| `exits` | optional | — |
| `gate` | optional | — |
| `loop` | optional | — |
| `tools` | optional | — |
| `examples` | optional | one input as it arrived and what it became — give one for any task that transforms data |
| `checks` | optional | what this task checks, and what happens when a check fails |
| `sources` | optional | where in the code this job lives: file paths (and symbols) you read to describe it |
| `instructions` | optional | for agents and orchestrators: where their instructions live — the prompt, rubric, or config file (and symbol) — with a one-line summary of what it tells them to do. The board shows the text read-only from the repo. |
| `minutes` | optional | performer minutes per instance, if known |
| `perWeek` | optional | instances per week at this job, if it differs from the board |
| `implementation` | optional | Implementation maturity, separate from description confirmation. Missing means unknown; code references alone do not establish completeness. |
| `confidence` | optional | — |

### `staves_describe_many`

Describe several jobs using the same fields, evidence and checks as staves_describe. Put parents before their tasks. Unknown implementation stays unknown.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `jobs` | **required** | — |

### `staves_split`

Break a job into tasks, in order. Each task is named by what it achieves; give it its own track if a different performer does it. Tasks can then get their own inputs, outputs, tools and gates with staves_describe (parent = the job).

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | **required** | — |
| `tasks` | **required** | — |

### `staves_collect`

Gather several jobs or tasks into one job, named by its outcome, on the track of the performer who takes it over. Use this after the cut, or when proposing that an agent take a run of a person's tasks. A run that contains a person's decision keeps the decision outside.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | optional | — |
| `name` | **required** | — |
| `track` | **required** | — |
| `into` | **required** | — |

### `staves_handover`

Analyze a proposed transfer between a human role and an agent track. Returns moves, retained human work, blockers, prerequisites, and one atomic design operation. Does not apply or execute anything. Call staves_propose with handover: {job, toTrack, basis} from this analysis for human review.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `job` | **required** | — |
| `toTrack` | **required** | — |

### `staves_cut`

Optional grouping that changes the board. It groups execution steps between human touchpoints and joins, which can hide important automated decisions and handoffs. Use only when grouping improves the visible journey; do not use it as a routine finishing step or on confirmed work. Returns grouped regions and naming questions.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

### `staves_patch`

Change one or more fields on a job without resending the whole description. Use it to fix anything staves noticed (a name, a beneficiary), to add a tool fact, a check, a way out. Same fields as staves_describe; only what you pass changes.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | **required** | — |
| `patch` | **required** | — |

### `staves_words`

Tell the board the words this domain actually uses, so the jargon check stops flagging them ('edge', 'authority', 'timeout' in a network product). Adds to the board's context.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `words` | **required** | — |

### `staves_intent`

What a redesign of this board is for: the one dimension it must improve, and what it must not make worse. Every scenario is scored against it.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `primary` | **required** | — |
| `target` | optional | e.g. 'halve the analyst's hours per lookup' |
| `constraints` | optional | e.g. 'no answer goes out unread by a person' |

### `staves_volume`

Say how many instances per week enter the board (and, per job, minutes per instance via staves_describe) so load per person can be shown.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `perWeek` | **required** | — |

## Questions and discussion

What the code cannot tell you, and what the person said about it.

### `staves_ask`

Ask the person something you could not tell from the code. Attach it to the job it concerns.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `about` | optional | — |
| `text` | **required** | — |

### `staves_answer`

Answer an open question. If you are an agent answering a person's question, say so with by=agent.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | **required** | — |
| `answer` | **required** | — |
| `by` | optional | — |

### `staves_comment`

Leave a comment on a job, a track, an artifact, or the board. Comments are for discussion; facts about the work go in staves_describe. When speaking from a role's chair (staves_hats), say so with `as`.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `about` | optional | — |
| `text` | **required** | — |
| `replyTo` | optional | — |
| `as` | optional | the role you are speaking as, e.g. 'the analyst' |

### `staves_comments`

Comments from people that await your reply. Reply to each with staves_comment (replyTo = its id): say why it is or isn't a good idea, what is missing, what you would need to know. Propose a change with staves_propose when a comment calls for one.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

## Reviewing it

Finding what is missing, coupled, jargon, or no longer true.

### `staves_review`

The analysis of a board in one read: where a person would be surprised, where an agent is trusted blind, where the description is not yet the person's, runs an agent could take, open questions, and the three things to do first. Call it right after describing, and give the person the gist.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

### `staves_reflect`

Zoom out and look at the whole board against its goal, in three lenses: does it hold together (logical), can it be done (functional), does it serve the goal for the person it is for (goal). Use it on your own description after you have described a system, before you tell the person it is done — and whenever you are about to build something from the board. Returns the reflections and, for each, what would fix it. You are the model that can reflect further: read the brief, then add what you see in the same three lenses as comments on the board, citing jobs.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

### `staves_issues`

Everything a person has raised on the board, as a work list: questions they asked, comments awaiting your reply, and the findings. Read this when they say 'look at the issues' or 'what did I raise'. Answer in place; propose changes rather than making them.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

### `staves_hats`

The board from each role's chair: what they do, wait on, answer for, and what is unresolved around them. Read one, then look for what that person would notice — gaps (what they'd need and don't get; waits nobody bounds; decisions with no one behind them; checks nobody makes) and opportunities (work they do that a stranger could do from the description; handoffs that could disappear). Record each as staves_comment with `as` the role, and staves_propose where a change follows.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `track` | optional | one track id; omit for all |

### `staves_stale`

Which jobs have code changes since they were described. Re-describe each with staves_describe (same id): if a person confirmed it, your re-description lands as a proposal for them.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

### `staves_focus`

One job as its own board: its tasks laid out on their tracks, with what comes in and what goes out at the edges. Use it to describe or discuss one part of the flow on its own.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `job` | **required** | — |

## Changing it safely

Proposing rather than overwriting, and trying an alternative.

### `staves_propose`

Propose a design change for human acceptance. For role transfers pass handover with the job, destination and basis returned by staves_handover. Nothing executes.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | optional | — |
| `patch` | optional | — |
| `remove` | optional | — |
| `why` | optional | — |
| `handover` | optional | — |

### `staves_scenario`

Create an alternative from an immutable snapshot of a board. Hosted connections require source access and an unused creation allowance. The source can change without changing this baseline. Use an alternative to explore a redesign without touching what is described.

| Argument | | What it is |
| --- | --- | --- |
| `base` | **required** | — |
| `name` | **required** | — |
| `title` | **required** | — |

## Connecting development

Link design requests with existing local Git and PR workflows.

### `staves_design_history`

Read accessible design alternatives, pinned baselines, acceptance events, scoped assessments, saved cases and reported Git/PR links. Design acceptance is separate from code merge and deployment.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

### `staves_git_context`

Read the local repository's sanitized origin, current branch/worktree, full HEAD commit, dirty state and optional base commit. No network, branch creation or code changes. This captures local Git; it does not check PR, merge or deployment status. Pass the actual project directory when the MCP process runs elsewhere.

| Argument | | What it is |
| --- | --- | --- |
| `directory` | optional | — |
| `baseRef` | optional | — |

### `staves_development_link`

Attach a Git snapshot and optional PR reference to this design or a saved assessment/implementation request. Use staves_git_context or inspect Git locally first. PR state is a timestamped report, never independently verified by Staves. New records preserve previous references; no branch is created, design accepted or code deployed.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `options` | **required** | — |

## Assessing a design

Walk through explicit cases and exchange snapshot-bound requests and agent reports.

### `staves_impact`

Investigate declared upstream/downstream paths, shared concepts and decision authority before a substantive revision. Read-only candidates and targeted repository questions; no code or trace verification, no expanded edit authorization. Only the requested board is read.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `jobIds` | optional | — |
| `conceptIds` | optional | — |

### `staves_walkthrough`

Check a concrete case against explicit model prerequisites and chosen exits. Deterministic model assessment, not execution or quantitative simulation. Unknown rules stop visibly. Returns captured inputs and an inspectable path. Set save to retain this case against its captured design.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `case` | **required** | — |
| `maxSteps` | optional | — |
| `save` | optional | — |

### `staves_walkthrough_runs`

Read saved case walkthroughs with their original inputs and current design freshness. These are model checks, not execution evidence.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | optional | — |

### `staves_assess`

Capture a scoped design request for your coding agent. Defaults to assessment only. Use implement only after the person explicitly requests implementation; this tool never executes code. Returns the pinned packet and board link.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `intent` | optional | — |
| `jobIds` | optional | — |
| `includeSources` | optional | — |
| `rationale` | optional | — |
| `constraints` | optional | — |
| `cases` | optional | — |

### `staves_assessment`

Read the original assessment request and its agent reports. Freshness is recalculated against current design; reports never certify execution.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | **required** | — |

### `staves_assessment_return`

Return repository findings or explicitly requested implementation results against an existing request. Include scoped source/test references and limitations. Stale results are retained for reconciliation; no design or implementation status changes automatically.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `result` | **required** | — |

## Taking it elsewhere

Getting the description out in a shape something else can use.

### `staves_export`

Prepare a versioned workflow handoff for feasibility, prototyping, implementation comparison or a workshop, or write the whole board out. Read-only. json, markdown, prompt, svg and n8n are scoped handoffs that preserve stable IDs, gates, questions and scope boundaries. staves is the whole board in the open Staves format (a .staves.json document, https://staves.io/spec/0.1/board.schema.json); mermaid and bpmn draw the whole board from it, and ignore purpose and scope. Does not execute workflows or send content to third-party apps.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `purpose` | optional | — |
| `jobIds` | optional | — |
| `unknowns` | optional | — |
| `constraints` | optional | — |
| `includeSources` | optional | — |
| `format` | optional | — |

## Everything else

### `staves_langfuse_probe`

Verify Langfuse project and observation access using the MCP process environment. Read-only; never supply secrets. Without a board, discover the project attached to the configured key.

| Argument | | What it is |
| --- | --- | --- |
| `board` | optional | — |

### `staves_langfuse_discover`

Find one bounded page of observation metadata. No prompts/outputs or automatic associations. Use candidate IDs to import evidence; expand the time window for older runs.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `fromStartTime` | optional | — |
| `toStartTime` | optional | — |
| `traceId` | optional | — |
| `name` | optional | — |
| `environment` | optional | — |
| `cursor` | optional | — |
| `limit` | optional | — |

### `staves_langfuse_runs`

How a board's workflow actually ran in a window: per job the runs, failure count and duration percentiles; per decision the exits taken; per handoff how often the work went that way; and drift in both directions. Read-only, bounded, and carrying no prompt, input or output. Measurement beside the design, never approval of it.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `days` | optional | — |
| `maxPages` | optional | — |

### `staves_langfuse_run`

Replay one unit of work as a path through the board: the steps in the order they happened, with what each took and which exit it left by. The case is a staves.case id or a trace id. A job the board no longer has is shown as unknown, never dropped.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `case` | **required** | — |
| `days` | optional | — |
| `maxPages` | optional | — |

### `staves_requests`

Read the request inbox for one accessible board. Queued means saved, not received. Inspect the pinned request and its intent before claiming; do not execute implementation for an assessment or discussion.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |

### `staves_request_status`

Claim a saved request or report running, completed or failed. This records delivery state, not verified implementation or human approval. Return evidence with staves_assessment_return.

| Argument | | What it is |
| --- | --- | --- |
| `board` | **required** | — |
| `id` | **required** | — |
| `status` | **required** | — |
| `note` | optional | — |

---

*57 tools. Generated from the server — run `npm run tools` in `docs-site` after changing them.*
