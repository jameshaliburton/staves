---
title: "Langfuse execution evidence"
description: "Connect the designed work to observations in Langfuse."
---

Staves describes jobs, responsibilities, decisions and intended outcomes. Langfuse
holds the execution traces. Connect a Langfuse project to a board, then ask your
coding agent to attach observations to the jobs they represent.

A project can support several boards. A job can encompass many observations and
traces. Human work remains on the board even when it has no telemetry.

## Connect from your coding agent

Staves works fully without Langfuse. Add it when you want execution evidence.
Your application's Langfuse project supplies that evidence; Staves platform
telemetry, if configured by its operator, is a separate project and grants no
access to your application's traces.

Configure `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`
in the **process that runs the Staves MCP server or CLI command**. A project
`.env` file alone is not loaded automatically. Use your existing secret manager
or client environment configuration, then restart the MCP server after changes.
Never paste credentials into chat, tool arguments, board content or tracked files.

Concretely, that means the `env` table on the `staves` entry: `env` inside
`mcpServers.staves` in `.mcp.json` (or `.cursor/mcp.json`) for Claude Code and
Cursor, or `[mcp_servers.staves.env]` in `.codex/config.toml` for Codex. `staves
setup` rewrites everything else in that entry — the command, args and version
pin — but preserves this `env` table as-is, so keys placed there survive an
upgrade. `staves doctor` reads all three files and names the ones that carry the
keys — `✓ Langfuse keys configured for the MCP server in .codex/config.toml`, for
example — and separately says which process it inspected for `LANGFUSE_*` in your
shell — your shell is not the MCP server's process, and the doctor line says so
rather than implying a shell check proves anything about the server's environment.

Ask your agent to run `staves_langfuse_probe`. It discovers the project belonging
to those credentials and tests v2 observation read access without fetching inputs
or outputs. The returned project reference can be saved with
`staves_langfuse_connect`. No project ID needs to be copied from the web UI.
A failed probe leaves any existing saved reference and captured evidence intact.

The browser's **Select Langfuse project** records only a public origin and project
ID. **Project selected** means those settings are saved; it is not a claim of
verified access. A successful agent probe proves access only at its recorded time,
from that agent's environment. It does not grant the browser live trace access.

## Find observations without knowing IDs

Use `staves_langfuse_discover` to inspect one page of recent candidates. It returns
IDs, timestamps, names, trace links and only the three Staves mapping metadata
fields. Filter by trace, observation name or environment; use a date window for
older runs. Each page has at most 50 observations and an optional continuation
cursor. Preserve the returned time window when requesting another page.

Discovery never attaches evidence or guesses a job mapping. Instrumented board
and job IDs establish an explicit association; untagged historical observations
need a rationale and human review. Use `staves_langfuse_evidence` to capture the
selected observation. The browser's **Ask agent to find evidence** saves a scoped
request on the board for the agent to retrieve; its saved state does not mean an
agent has started work. No manual request-copy step is required.

## Build with job identifiers

Ask the agent to call `staves_langfuse_instrumentation` before instrumenting a job.
It returns metadata identifying the board, job and revision. Attach that metadata
to the observations implementing the job. Existing traces without an explicit
mapping should inform a proposed mapping; similar names alone are insufficient.

On a decision job's observation, also set `staves.exit` to the id of the job the
work went to next (or `stop`). On every observation of one unit of work, set
`staves.case` when a trace does not equal one case. These let
`staves_langfuse_runs` count exits and replay a case; they carry no prompt or
output.

## Read evidence

A job's evidence shows observations and their trace links. Measured duration is
observation duration, not necessarily total job duration or human waiting time.
An error is a technical observation; an observed run is not proof that the job
achieved its completion criteria. Board confirmation and implementation progress
remain separate.

Revision identifies the recorded board snapshot. Evidence can refer to an older
snapshot; it is not silently relabeled as evidence for the current design.
No linked observations means **no evidence linked**, not that the job never
happened. Linked summaries do not establish current source access, freshness or
independent verification by Staves. The importer checks the requested source and
mapping when it fetches an observation; accepting a saved summary through the
Staves gateway does not independently repeat that fetch.

Staves stores references and bounded summaries, not prompts, model outputs or a
copy of the trace store. Open Langfuse to investigate the full execution.

## As run: how the workflow actually ran

`staves_langfuse_runs` reads a board's connected project and reports, per job in a
time window: how many times it ran, its failure count, and its duration
percentiles. Per decision job, which exit the work took and how often. Per
handoff between jobs, how often the work went that way. And drift in both
directions: observation job ids the board does not recognise, and board jobs
that never ran in the window. `staves_langfuse_run` replays one case — a
`staves.case` id or a trace id — as the ordered path it took through the board,
with what each step took and which exit it left by.

This is measurement beside the design, not approval of it. A job with runs is
not thereby implemented as designed; a job with none is not thereby missing —
both are questions for a person, not findings. Nothing here stores a prompt, an
input or an output, and nothing here claims a human reviewed or accepted the
work.

Both tools use the two keys from `staves_langfuse_instrumentation`: `staves.exit`
on a decision job's observation, set to the id of the job the work went to next
(or `stop`); `staves.case` on every observation of one unit of work, when a
trace does not equal one case.

Every answer carries its bound. `staves_langfuse_runs` and `staves_langfuse_run`
take `days` (1–90, default 7) and scan up to `maxPages` pages (default 20, max
50) of 100 observations each — 2,000 by default — newest first, filtered to the
board on the server side by `staves.board_id`. The response reports how many
observations were actually scanned and whether the scan was truncated before
reaching the start of the window; a truncated scan means older observations in
that window were not read.

In the local editor, an **As run** view shows this window on the board itself —
node run counts and p50 duration, failures, handoff weight by edge, exit counts
on decision gates, jobs that never ran dimmed — with a window picker (1d/7d/30d)
and a Runs panel for drift and case replay.

### As run on staves.io

Langfuse keys belong to one Langfuse project, and each of your apps usually has
its own. So your account holds keys per project: a hosted board reads its runs
with the keys for the project in its own Langfuse connection. Two apps, two
projects, two sets of keys, each showing runs on its own boards.

**The fastest way** is from the project folder, with the keys your coding agent
already has. When `npx @staves/cli connect` finishes, and `LANGFUSE_PUBLIC_KEY`
and `LANGFUSE_SECRET_KEY` (and `LANGFUSE_BASE_URL` or `LANGFUSE_HOST`, if you set
one) are in your shell or in the `env` block of this project's `staves` server
registration, it asks, naming the Langfuse server the keys belong to:

```
Show this project's runs on staves.io using the Langfuse keys your coding agent already has (cloud.langfuse.com)? [Y/n]
```

Say yes and the keys go to your account once, named after the connection, and
every board this connection can open that has no Langfuse project yet is pointed
at theirs:

```
runs: Vendor onboarding · 3 boards will show As run  https://staves.io/workspace
```

In a script, or to skip the question, pass `--share-runs`; to connect without
being asked, pass `--no-share-runs`. On a machine that is already connected,
`connect --share-runs` uses that connection (`staves: using connection <id>`)
and goes straight to sharing, with no second browser approval. The terminal never prints the keys. A
refusal (keys Langfuse does not accept, a read-only connection) is one line, and
the connection itself still stands. `npx @staves/cli doctor` recommends
`connect --share-runs` when your agent has keys and staves.io is not showing
this project's runs yet.

**Or paste them.** Open **Account → Runs**, choose **Show runs** for the project,
then **Paste keys instead**: a project-scoped public key and its secret key (and,
under Advanced, your Langfuse URL — Langfuse Cloud by default; a self-hosted
instance must be reachable over HTTPS on a public name). **Test and save** checks
the keys against Langfuse before keeping them and records the project they
belong to; then tick the boards that should show its runs.

Either way the secret key is encrypted before it is stored, bound to your
account and that project, and never shown again — not in Account, not in a
response, not in a log, not in the terminal. Account shows only the project, the
last four characters of the public key, when the keys were checked and which
boards read them. **Remove keys** deletes one project's keys; its boards keep
their connection and say there are no keys for their project until you add them
again.

Any board connected to a project whose keys you hold can then open **As run**. A
board connected to a project with no keys says so and links to Account → Runs.

Your coding agent's MCP tools still read keys from its own environment, as above;
the keys in your account are used only by As run on staves.io. Nothing is written
to the board by reading runs.

## Requirements and current limits

Observation reads use the Langfuse v2 Observations API: Langfuse Cloud or a
self-hosted v4 instance. Set `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and
`LANGFUSE_SECRET_KEY` in the agent environment. The configured host must match the
board connection; the project-scoped key must match the project ID.

Discovery supplies the trace ID and observation ID needed for import. The default search window is the
last 30 days; the tool accepts `fromStartTime` and `toStartTime` for older runs.
Each job holds at most 100 references. Reimporting the same observation does not
add a duplicate. This first integration does not continuously sync projects or
calculate success rates, cost totals or coverage from incomplete samples.

See [Langfuse's Observations API](https://langfuse.com/docs/api-and-data-platform/features/observations-api)
for version requirements and the underlying evidence model.

## Historical associations, refresh and withdrawal

For an untagged historical observation, provide an `associationRationale` to `staves_langfuse_evidence`. This creates a proposed association for human review. Conflicting instrumentation identifiers are rejected. Accepting the proposal records who reviewed the mapping and when; it does not verify the business outcome.

Use `staves_langfuse_refresh` with the saved capture key to explicitly fetch a newer capture of that observation. Earlier captures remain in history and retain their original source origin, project and timestamps. The 100-item limit applies to retained captures, including refreshed and retracted entries.

Use `staves_langfuse_retract`, or the job evidence action, to withdraw a capture with a reason. Retraction preserves its history and removes its use as current support. Refresh is bounded and explicit; there is no periodic background synchronization. Bulk job edits cannot replace captured evidence.
