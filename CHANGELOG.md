# 0.45.1 — public launch documentation

- Include the complete Apache-2.0 license text.
- Explain local setup, the hosted boundary and draft-format limitations in the open-source guide.
- Document a source-backed release workflow example and distinguish inferred risks from observed incidents.

# 0.45.0 — public source release

- Apache-2.0 source release with a clean public history and the Staves format v0.1 draft.
- One supported package and current contributor and architecture documentation.
- Historical project studies and unused package prototypes are omitted from the public source.
- Local editor development no longer imports a project-specific study.

# Changelog

## 0.44.1 — 23 September 2026

- The npm package no longer carries the hosted service's own modules (`dist/cloud-store.js`, `dist/platform-telemetry.js`). They live in the private repository that runs staves.io; nothing a person runs locally used them.

## 0.44.0 — 23 September 2026

### A board can leave Staves in an open format

- `staves export <board> --format staves` writes the whole board as a Staves format v0.1 document (`.staves.json`), which validates against [the schema](https://staves.io/spec/0.1/board.schema.json). Tracks, jobs, artifacts, gates, exits and loops are carried, with provenance for every job and derived handoffs with stable ids; Staves' own state rides along under `io.staves.app`, so the board reads back as it was written. The same formats are on `staves_export` over MCP.
- `--format mermaid` draws the board where Mermaid renders (GitHub, GitLab, Notion): tracks as groups, handoffs labelled with what passes, a gate on the track of whoever answers for it, and a job whose sources disagree in red.
- `--format bpmn` writes BPMN 2.0 with a diagram, so it opens drawn in BPMN tools: lanes, a pool for outside parties, gateways for the ways out, a decision task for each gate, and a sub-process for a job with tasks. It describes; it is not executable.
- A Staves document from another tool reads in, and what the board has no field for — extensions, other systems' evidence, references and provenance it does not model — is written back unchanged.
- The format is specified in the open, in `spec/`.


### CLAUDE.md, AGENTS.md and GEMINI.md can be committed

- The managed block no longer names the connection. `connect` and `setup` record it in `.staves/config.json`, and `staves tool … --hosted` and the other hosted commands read it from there when `--connection` is not given. `doctor` says when the config has lost the reference, and when a block still names one; `staves setup` fixes both. Client registrations (`.mcp.json` and the rest) still carry it, and stay on your machine.

### Self-hosted Staves no longer sends interview telemetry

- A server you run yourself (`staves web`, `staves host`, the MCP daemon) used to send aggregate interview metrics to a Langfuse project whenever `STAVES_LANGFUSE_PUBLIC_KEY`, `STAVES_LANGFUSE_SECRET_KEY` and `STAVES_LANGFUSE_BASE_URL` were set in its environment. It now reports to a telemetry sink that records nothing unless the program hosting it installs one; staves.io installs its own. Open code never calls a service by default. Your own traces of your own work (`LANGFUSE_*`, the as-run view) are unchanged.

## 0.43.0 — 17 September 2026

### One way to continue in your coding agent

- **Coding agent** in the board header replaces the Share & hand off wizard. Choose the whole workflow or some jobs, **Copy to coding agent**, paste into your agent's chat. The request is saved on the board with its revision and scope, and the dialog shows **Received by** the agent once it claims it.
- The copied text tells the agent to connect itself when it is not connected yet — run `connect`, show you the approval link, then load its native Staves tools — and to say plainly when it is working through the CLI instead.
- Downloads moved to **Board options → Export…**: Brief, Map, Data, and the n8n planning canvas.
- `connect` and `init` register Gemini CLI in `.gemini/settings.json` alongside Claude Code, Cursor and Codex, and write the managed block into `GEMINI.md`.
- Every connected agent gets the same first-use instructions: verify access, then offer what it can do with this board.

## 0.42.0 – 0.42.1 — 17 September 2026

- One thing to paste: a new board made with **Use my coding agent** gives one block of text carrying a single-use connection code, instead of three screens repeating the CLI.
- A drafted map questions itself before it lands.
- 0.42.1: tracing is scoped to the board owner's own work. A hosted person's conversation is no longer sent to anyone else's observability account.

## 0.41.0 — 17 September 2026

- Staves can make every change it can name: connect two existing jobs, merge two roles, and the rest of the edits it used to hand back as "a board edit on your side".

## 0.40.0 — 17 September 2026

- **Walk the flow**: the open questions in the board's own order, one job at a time, each lit where it sits with the most consequential unknown asked underneath.

## 0.39.0 — 17 September 2026

- Staves records its own turns to Langfuse, so a conversation that went wrong can be read rather than guessed at.
- Accepting a proposal shows what it changed, including field changes that draw nothing on the canvas.

## 0.37.0 – 0.38.1 — 17 September 2026

- The board is drawn in two materials: what you said, and what Staves guessed. A guess is settled where it sits.
- The header reads how much of the board is yours, not how much Staves still wants to ask.
- A workflow you described in your own words comes back as yours, not stamped as Staves' guess.
- A draft lands on the board instead of queueing in review; **Openings** is a place you go.
- 0.38.1: no more blank-square icons, and the questions follow the board's order.

## 0.33.0 – 0.36.0 — 16 September 2026

- A card may only say *you said this* if the words are in the transcript. Fragments are not quotations.
- One malformed entry in a reply is skipped rather than losing the whole turn.
- A chain of work described in one breath becomes a chain on the board.
- How much you are asked is a choice — ask me, or draft and check — not a consequence of board size.
- Staves may draft a class or close it, never both: a board cannot certify its own inference.

## 0.31.0 – 0.32.0 — 16 September 2026

- Selecting a job re-points the conversation, the agenda and the readiness count at it.
- Testimony requires the words: attributions are checked against what was said.

## 0.27.0 – 0.30.3 — 16 September 2026

- The interview says what it still needs, as a count of its own questions — never a completeness percentage of the workflow.
- Staves asks the question and the person answers it; an open question arrives as Staves' turn, not in your input box.
- The conversation panel is a card with its own header, Talk and Review tabs, and a Stop and Close that survive every repaint.
- **Talk to Staves**, bottom right, is the one permanent way in; its caret holds Review, the agenda and the model.
- Failures are written in words, and a suggestion that could not be saved says so.

## 0.26.0 — 16 September 2026

### Suggestions wait on the board, where everyone can see them

- An unapplied suggestion is a **proposal** now, not a thing that lived in one browser tab. Leaving mid-interview used to lose every card you had not acted on — and the ones lost were exactly the ones that needed you, since auto-build applies what you said outright and never an assumption. They are recorded, not applied, and answered later by their seq.
- `Entry.suggestion` carries what an op cannot: the card's name, the person's own quote, how sure the interviewer was, and the card type. Optional, so older logs still read. This is what makes a suggestion legible to a collaborator opening the board, and to a coding agent reading it through MCP.
- Accepting a card turns its proposal into work; dismissing closes it. Its basis travels with it, so a suggestion made against work that has since changed is refused rather than applied quietly. A write that fails says so on the cards instead of dropping them.
- Review lists them by their own name and the words they came from — "FROM THE CONVERSATION · ASSUMPTION" — rather than a title derived from the op.

### The conversation says what it is on

- Every reply names the ledger classes it touched, so the strip rings them from what the interviewer said rather than a guess. One answer usually feeds several.
- Under each exchange, one quiet line: "about roles · handoffs", with settled classes marked. Clicking a class in the strip asks to go there next; going back to one you had settled reopens it.
- Each class also shows **depth** — nothing here, named with gaps the board can name, or nothing outstanding — with the gap itself on hover and on focus: "8 named · 3 of them have no work against them". Never a percentage: how much of the work is understood is the claim the craft refuses.

### Fixes

- The Review tab has a way back. Focus mode hid the Talk/Review tabs whenever the conversation panel was open, and the board menu opens Review directly, so you could land there with no way out.
- The return action and the "Gathering context" status moved out of a menu that is hidden and inert during every conversation.
- One voice for a turn: the status line no longer says "Thinking through your answer…" underneath the notice that says "Reading what you said…".
- One band at the foot of the canvas and one status-bar height, instead of four guessed offsets and three panels covering the status bar.
- A card scrolled sideways stops at its lane instead of sliding under the role column. The canvas is an isolated stacking context, so a tooltip cannot paint over the conversation or a modal.
- Nothing you must hit is under 24px; three controls no longer show two tooltips at once; the settled strip is status-sized, and its detail is a line you can reach with a keyboard rather than a title attribute.
- The Show runs wizard says it moves on by itself, owns up after forty seconds when a project's agent holds no Langfuse keys, names its steps, and offers pasting as a real choice.
- The interview uses the model this browser chose and the activity picked in "Guide the next reply"; both were ignored.

## 0.25.0 — 16 September 2026

### The board remembers what the interview settled

- A conversation that starts again no longer starts over. Five classes — brief, roles, jobs, handoffs, exceptions — read as **untouched**, **open** or **closed**, worked out from the board rather than stored, and travel with every interview turn. A settled class is never asked about again.
- One new op, `settle`, records a closure with a **basis**: a snapshot of the very thing it claims is complete. Add a ninth role and the basis stops matching, so the class reopens itself and says the work moved. Reopening by hand is the same op.
- Staves may settle a class on its own judgment when the evidence is saturated, but the craft requires it to say so in that turn, and the closure is recorded as Staves' own. It shows as `◐` against your `✓`, carries the words it went by, and never reads as the person's answer. One click reopens it.
- The conversation header draws the row; hovering says who settled each class and on what.

### Interviews cost a fraction of what they did

- The system prompt — about 5,900 tokens, the same bytes every turn — is now a cache prefix, read at roughly a tenth of the price after the first turn. The volatile board and transcript were already in the user message, on the right side of the breakpoint. OpenAI and Gemini cache long prefixes themselves, so all three benefit.
- Prompt detail is spent where the conversation is. `discussionEvidence` shipped all 22 fields of every job into a conversation about one of them, and `investigateImpact` sized its answer the same way whatever focus it was given. Boards of 25 jobs or fewer are sent exactly as before; past that, full detail goes to the job in hand, what it is made of and sits inside, whoever it hands to or takes from, anything just named, and anything carrying an open question — everything else keeps its name, place and outcome, so the whole map is still there to reconcile against. Measured: a 200-job board fell from 37,066 to 16,171 tokens a turn.
- Every provider gets the same room to answer. Anthropic asked for 1,400 output tokens from the single-provider days while OpenAI had 4,096 and Gemini 8,192, so ordinary answers truncated and the turn was lost. A reply that still runs past the limit says to ask for a smaller piece of the work instead of blaming the request.
- `staves_impact` keeps its own reach; only the interview asks for a smaller slice.

### Writes that cannot be read back are refused

- **A job written without provenance is now rejected at the write.** It used to be accepted and then break every later read of that board, because lint reads `provenance.source` on each load. This is stricter than 0.24: an agent or script posting a job op with no `provenance` will now get an error where it previously got `ok`. The vocabulary itself is unchanged.

### The interview uses what you chose

- The request carries the model this browser is set to and the activity picked in "Guide the next reply". Both were ignored: the mode was fixed at `understand`, and `staves.html` sent every key to Anthropic whatever provider was saved.

### Fixes

- A board with roles and no jobs shows its roles. The start card hid the tracks beneath it and counted only jobs, so roles added from suggestions were saved but invisible — and with the conversation open the card itself was hidden too.
- One thinking indicator, in the conversation you are typing in rather than hovering over the board. Two notices announced the same turn, and the board one mounted on `body`, covering the status bar.
- Applied suggestions stop asking to be reviewed, and "Add remaining suggestions and close" goes when nothing is left.
- A role or record applied before its job is no longer treated as staleness; stale suggestions answer 409 and say so in a sentence instead of printing JSON.
- The Langfuse account offer left the retired timeline header; account projects are offered by name from Board options.

## 0.24.0 — 16 September 2026

### Runs per code project

- Langfuse keys are held **per Langfuse project**, not one set per account: each app keeps its own keys, and a hosted board reads As run with the keys for the project in its own connection. Two projects for one person coexist; saving the same project again replaces its keys. Removing one project's keys leaves the others, and its boards keep their connection.
- `npx @staves/cli connect` offers to show the project's runs on staves.io with the Langfuse keys your coding agent already has — `LANGFUSE_*` in the shell, or in the `env` block of this project's `staves` registration. Asked in a terminal; `--share-runs` does it without asking, `--no-share-runs` never asks. The keys are named after the connection, the connection's boards with no Langfuse project are pointed at theirs, and the terminal prints the project and how many boards will show As run — never the keys. A refusal is one line and the connection still stands.
- `doctor` and the home screen recommend `npx @staves/cli connect --share-runs` when the agent has keys and staves.io shows none of this connection's runs.
- A board reading a project with no keys says `No Langfuse keys for this board's project yet. Add them under Account → Runs.`, with the Account link.
- Gateway: `GET /workspace-api/langfuse` answers `{ configured, projects: [{ projectId, projectName, baseUrl, label, publicKeyHint, verifiedAt, boards }] }` (and `configured: false` when the service holds no secrets key); `PUT` accepts `label` and `boards`; `DELETE ?project=` removes one project's keys; `POST /workspace-api/board-langfuse` points one board at a project you hold keys for; `POST /cli-api/langfuse` is the connect-time hand-off (contribute connections only, five a minute per connection) and `GET /cli-api/langfuse` says which project a connection's runs come from.
- Migration `202609160002` makes `(owner, project_id)` the primary key of `langfuse_credentials` and adds `label`. New rows seal the secret to the owner and the project (`key_version` 2); rows saved before still open.

## 0.23.0 — 16 September 2026

### As run on staves.io

- **Account → Langfuse** saves one project-scoped Langfuse key per account. **Test and save** checks the keys against Langfuse and records the project they reach before anything is kept; keys that reach no project or several are refused. **Remove** deletes them.
- The secret key is encrypted with AES-256-GCM before it is stored (`STAVES_SECRETS_KEY`), bound to its owner, and never returned, logged or shown again. Account shows the project, the last four characters of the public key and when the keys were checked. A service without a usable key refuses to store keys at all.
- As run now works on hosted boards connected to that project: the same overlay, window picker, drift and case replay as the local editor. A board on another project, or an account with no keys, says so and links to Account.
- A hosted board with no Langfuse connection offers **Connect this board to** the account's project.
- Keys are stored in a new service-only table, `langfuse_credentials` (migration `202609160001`); no browser role can read it. The hosted MCP tools still read Langfuse keys from the agent's own environment.

## 0.22.0 — 15 September 2026

### As run

- `staves_langfuse_instrumentation` adds two keys: `staves.exit` on a decision job's observation (the id of the job the work went to next, or `stop`), and `staves.case` on every observation of one unit of work when a trace does not equal one case.
- `staves_langfuse_runs` reads a board's connected Langfuse project for a window and reports, per job, its run count, failure count and duration percentiles; per decision, the exits taken; per handoff, how often the work went that way; and drift in both directions — observation job ids the board does not recognise, and board jobs that never ran. `staves_langfuse_run` replays one case as the ordered path it took through the board.
- The local editor gains an **As run** view: a window picker (1d/7d/30d) paints run counts, p50, failures and handoff weight on the board itself, with a Runs panel for drift and case replay.
- Nothing here is stored and nothing here is approved: no prompt, input or output is read or kept, and a run is measurement beside the design, never a claim that a job is implemented or that a person accepted the work.

## 0.21.3 — 15 September 2026

- The two pairing routes anyone can reach are bounded: six connection starts and sixty polls a minute per address, and no more than 200 unapproved requests waiting at once. Expired requests are swept before every new one, so a flood nobody approved clears itself.
- `connect` repeats what a throttled or busy gateway said rather than reporting the service as too old, and a throttled poll waits out the minute it was asked for instead of losing an approval already open in the browser.

## 0.21.2 — 15 September 2026

- A connection that cannot create a board is no longer a dead end in the terminal: `staves_access` returns a `nextStep` sentence for a read-only connection or an exhausted allowance, and the agent contract tells the agent to repeat it rather than report a wall.
- `connect`, `doctor` and the recommendations say the same thing: rerun `npx @staves/cli connect` and tick "Create a new board for this project", or raise the allowance under Account → Agent connections.

## 0.21.1 — 15 September 2026

- The browser approval page for `staves connect` offers a new board for the project, named after the project directory and ticked when the account has none. The board is created before access is granted, joins the connection's scope, and the terminal prints its link.

## 0.21.0 — 15 September 2026

### Connecting agents

- `connect` reuses an existing connection when the same account (URL + email) connects again, instead of minting a new one every time.
- `connect` keeps going if listing your boards fails after a successful connection, and tells you to run `doctor` rather than aborting.
- `connect` and `init` register into the same project root and print which root they used; running either again inside an already-initialised repo refreshes that repo instead of silently creating a second one.
- Non-interactive connect: `--token`, `STAVES_TOKEN`, and `--token-stdin` for CI; `--no-browser` prints the approval URL and check code without trying to open a browser.
- A registration left over from the old `staves` package name, or pinned to an older `@staves/cli` version, is detected and rewritten to the current package and version by `setup`.
- The `env` table on an existing `staves` MCP registration (Langfuse keys, for example) is preserved across `setup`, in both JSON configs (`.mcp.json`, `.cursor/mcp.json`) and `.codex/config.toml`.
- Every board is a link. The home screen, `doctor`, `review`, `listen` and the listener's own status lines name the page each board is drawn on, and each recommendation about a board carries the link to it. `doctor` adds the workspace address for a hosted connection; when nothing is serving a local board, the link is printed beside `npx @staves/cli open`, which starts it.
- Every board-scoped MCP tool answers with the board's link — as a `boardUrl` field in a JSON answer, or one `Board:` line under prose — so an agent always has somewhere to send the person. `staves_access` returns the workspace address.
- `init`, `setup`, `doctor`, `listen`, the home screen, `staves_help` and all three ways `connect` can fail now end with the connection guide, `https://staves.io/docs/connect/`.
- The managed `CLAUDE.md`/`AGENTS.md` block and the skill’s "This project" section say where this project’s boards open and link the guide. `setup` recognises every unmarked block this CLI has written, so a project last set up before the markers existed is upgraded instead of gaining a second block.
- The delivery panel in the editor offers the connection guide under the command that delivers a request.

### Diagnostics

- `doctor` reports project-level (`.mcp.json`, `.cursor/mcp.json`, `.codex/config.toml`) and user-level (`~/.mcp.json`, `~/.claude.json`, `~/.codex/config.toml`) registrations separately, and never edits the user-level files.
- Flags a stale `staves` package name, an outdated `@staves/cli` version pin, a missing `--dir`, or a missing credential for a hosted connection — each with the command that fixes it.
- Reports whether the skill files and the managed `CLAUDE.md`/`AGENTS.md` block are present and current, including when a customised skill has an unread generated update.
- Names the process it inspected for Langfuse credentials rather than implying a shell-level check says anything about the MCP server's own environment, and reads the launch environment of all three project registrations — `.mcp.json`, `.cursor/mcp.json` and `[mcp_servers.staves.env]` in `.codex/config.toml` — naming the files that carry the keys.
- Exits 1 when something is broken; add `--strict` to fail on stale-but-working registrations too, for CI. Prints the `init`/`connect` next step when nothing is registered at all.
- Errors print a single `staves: <message>` line and exit 1; stack traces only appear with `--debug`.
- `connect` against a service that has no browser pairing route says so and names the status, instead of forwarding the gateway's own page; the body is kept for `--debug`.
- Every command finds `.staves` within the repository it is run in: the search now stops at the directory holding `.git`, so a nested checkout or worktree no longer writes into its parent's boards.
- A local daemon that stops answering fails after ten seconds with one sentence rather than hanging the call.

### Delivery and review

- `listen` skips conversation ("discuss") requests instead of claiming them, and says so once per request; those stay queued for your interactive agent.
- `listen` can auto-detect a single installed local agent (Claude Code or Codex) and the board, when there is exactly one of each, and reports the agent, binary path and board it picked.
- New `review [board]`, `accept <seq>`, and `reject <seq> --reason "..."` commands decide on agent-proposed evidence and completed requests from the terminal. `accept` and `reject` work on local boards; on a hosted board they refuse, because the gateway attributes CLI writes to the agent token, so decide on the board in the web app. `review` works on both.
- An agent can no longer report job outcomes outside the scope of the request it was given; an out-of-scope return fails the request with an explicit note.
- Read-only MCP tools (`staves_brief`, `staves_requests`, and others) fail with the list of existing boards when given an unknown board name, instead of behaving as if that board were empty.
- The MCP server sends a notification when a new request is queued on a board the session has touched, so an agent doesn't have to poll for work.

### What to do next

- A bare `npx @staves/cli` in a terminal prints a state-aware home screen: what is registered, what is on the boards right now (queued and failed requests, pending proposals), and the top three recommended next steps with the exact command. `npx @staves/cli help` prints the full command list; the bare command still prints the help when there is no terminal.
- `doctor` ends with the same recommendations, and says when the account state is incomplete and why (an unreachable account, an expired budget) instead of reporting an empty account.
- `staves_help` opens with "Right now" and "Recommended next" for the agent, built from the same rules as the terminal, so the person and the agent are never told different things; the tool catalogue below it is generated from the registered tools.

### In the editor

- Queuing a request shows its delivery state live (queued, claimed, running, completed, failed, with the agent's note), the exact command that delivers it (`staves listen` for assessments; "say resume staves" in your agent for conversations), and the returned report inline when it completes.
- The status footer says whether an agent has ever worked on this board, when it was last active, or that it is active now; "Reconnect" opens a sheet with the `init`/`connect`, `doctor` and `listen` commands for this board instead of a docs link.
- The Langfuse panel says whether the board is connected and whether access has been verified, and how to connect through the agent when it is not.
- The account page shows the same agent state and can re-run the check.
- Every "Connect assistant" control — the top bar, the conversation panel, the stage-header chip, the empty-board card and the More toolbar — opens the same command sheet, and that sheet now keeps Tab inside it, moves focus into it on open, and returns focus to whatever opened it. The old paste-a-line-of-JSON sheet is gone.
- On a phone, Staves is the marketing site, the documentation, and a single board opened from a shared link. That board is read only and now shows its queued, claimed, running, completed and failed agent requests and its pending proposal count above the brief. The mobile board list is gone; the workspace URL on a phone says Staves is a desktop tool and offers the link to get there.
- "Recently edited" in the board library orders by when each board last changed in this workspace, matching the order the server sends, so a board whose log arrived from another machine no longer sinks to the bottom; the edit line says when a change arrived when that differs from when it was made.

### Docs and setup copy

- The local-workspace connection panel in the web editor leads with `staves init` / `staves connect` / `staves doctor`, with the raw JSON/TOML configuration collapsed under "Manual configuration" for anyone who still wants it.
- `docs/CONNECT.md`, the docs site, and the README describe the actual browser-approval-with-check-code flow, the CI token paths, `doctor`, `listen`, and `review`/`accept`/`reject` — replacing the old "paste the token when prompted" instructions.
- The Langfuse docs state exactly where the keys belong (the MCP server's launch environment, preserved by `staves setup`) and what `staves doctor`'s Langfuse line actually checks.
- One connection guide, at `https://staves.io/docs/connect/`. Its first screen is three steps — `init` or `connect`, `doctor`, then say **run staves** in Claude Code or Codex — with short sections below it for what to do when something is off, `listen`, terminal review, CI and headless connections, and Langfuse.
- `docs/CONNECT.md` points at that page and keeps only what is internal to this repository: the permission model behind a connection, and the release requirement. The duplicated command walkthroughs are gone. The README connect note is three lines and the link.

### Earlier in this release

### Design conversations

- Explicit board/job scope and log-backed working intentions, separate from accepted design and implementation evidence.
- Browser draft and scope restoration, contextual return information, coherent automatic graph batches and human review boundaries.
- Coding-agent continuation prompts that carry the board, intention and draft; existing-board continuation is separate from creating a connection.
- Browser model configuration now appears consistently in the board status and Account.

### Workflow design and implementation

- Scoped agent connections with read/contribute permissions, board access and lifetime creation allowances.
- Interviews through MCP or CLI, pinned alternatives, scenario checks, assessment requests/returns and Git references.
- Optional Langfuse evidence mappings and instrumentation guidance; modelling remains usable without Langfuse.
- Shared vocabulary and impact investigation tools for changes that affect surrounding work.
- Integrated design history and restrained semantic canvas styling.

### Mobile

- Read-only companion for existing boards, workflow summaries, open questions and links to continue on desktop.
- Full modelling, canvas editing, scenarios, approvals and connection setup remain desktop actions. Resizing preserves the desktop workspace.

### Updating

Use `npx @staves/cli@latest` for the current package. Existing generated MCP configurations pin their installed version; update the package version in that configuration to `@staves/cli@0.21.0` and reload MCP. Preserve its connection ID and other arguments. Custom skill files are preserved; compare the current skill guidance before editing local instructions.

Hosted deployments require the three September 14 scoped-connection and board-incarnation migrations before the matching gateway. Keep incarnation-aware RPCs when rolling forward or recovering a deployment. The managed staves.io schema has been updated.
