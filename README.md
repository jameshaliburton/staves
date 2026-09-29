# Staves

**An open format for work shared by people, agents and systems — who does what, what passes between them, where a person decides, and how we know — and the tools that write it.**

Point your coding agent at a system. Staves describes the work as the people in it experience it, records where each fact came from, and helps review the description as the code changes. Or start with an interview or a blank board and design the work before building it.

Staves describes work; it does not execute the workflow it describes.

## Start locally

Requires Node.js 20 or later. In the project you want to describe:

```sh
npx -y @staves/cli init
npx -y @staves/cli doctor
```

Then tell your connected coding agent **run staves**. Local boards live in `.staves/` next to your code. No Staves account is required.

```sh
npx -y @staves/cli open
```

This opens the local editor. To use boards in a Staves account instead, run `npx -y @staves/cli connect` and approve the connection. Local and hosted boards are separate stores; connecting does not migrate local boards.

[Connection guide](https://staves.io/docs/connect/) · [User documentation](https://staves.io/docs/) · [Run from source](docs/LOCAL-SETUP.md)

## What a board holds

- **Tracks** for the people, agents and systems performing the work.
- **Jobs and tasks** named by the outcome they produce and who benefits.
- **Artifacts and handoffs** showing what passes between jobs.
- **Gates, exits and loops** showing decisions, accountability and ways out.
- **Provenance, questions and evidence** distinguishing what someone said, what code describes and what execution showed.

Local boards are append-only JSONL operation logs. Changes retain their authorship; undo and proposals are recorded in the log. The interchange format is a separate JSON snapshot, so other tools do not need to implement the log.

## Agents propose, people review

An agent's new work starts as a draft. Changes to confirmed work can be recorded as proposals, which a person accepts or rejects on the board. `staves_propose` creates one explicitly; describing a confirmed job through the agent tools routes changes through that review boundary.

Raise an issue on a job and ask your agent to review the board's requests. The agent can read sources, answer questions and propose changes. A queued request alone does not start an agent: execution depends on your connected agent or runtime.

## Explore and improve the work

The editor supports selecting and editing jobs, opening their tasks, moving work between tracks, collecting tasks into jobs, commenting, reviewing findings and inspecting provenance. The print view provides a static view of the board.

Design conversations help scope a proposed change and record an intention. Your coding agent can interview you through MCP using its own model. Browser interview availability depends on the model provider configured for the running service; an MCP connection does not automatically provide a browser model.

The open analyzers find issues such as dangling exits, unbounded loops, missing accountability and artifacts with no receiver. Role-based reviews examine what each performer does, waits for and answers for. Scenarios let you explore an alternative without replacing the base board.

Jobs can reference source files and commits. Staleness checks identify descriptions whose sources changed; re-describing confirmed work produces proposals. Hosted services do not have automatic access to your local repository: agents must supply the relevant context.

Volumes, durations and track capacity support estimates of workload. Optional Langfuse integration connects execution evidence to the described work. Observations are evidence, not human approval of a description. Keep provider credentials in the launching environment, never on a board.

## The open format

The [Staves format](spec/README.md) is **v0.1, draft for comment**, versioned separately from the CLI. It includes a JSON Schema, an example and [mappings to other standards](spec/MAPPINGS.md).

The implementation is not yet a fully conforming consumer. In particular, disputes do not round-trip as competing claims, and some preservation behavior is incomplete when saving through a Staves store. Read the conformance notice in the spec before relying on lossless interchange.

## Build and contribute

```sh
git clone https://github.com/jameshaliburton/staves.git
cd staves
npm ci
npm test
npm run check:boundary -- --pack
npm run preview:editor
```

The preview opens at `http://127.0.0.1:4325/?board=node-stress` and retains edits in `.staves/visual-preview/`. `npm test` builds the TypeScript source before running the tests.

This repository publishes one npm package, **`@staves/cli`**. The main editor is in `design/editor/`; `src/app2.ts` is a legacy generated shell also used by the standalone HTML build. The standalone artifact is not the full editor.

Library exports are available from the same package:

```ts
import { fold, lint, cut, renderSVG, brief } from "@staves/cli";
```

See [CONTRIBUTING.md](CONTRIBUTING.md), the [source map](HANDOVER.md), and [architecture](docs/ARCHITECTURE.md). Contributions use DCO sign-off.

## License and boundary

The format, local tools, editor, method, analyzers and integration clients are Apache-2.0. The hosted service is maintained separately in the private `staves-cloud` repository. [OPEN-CORE.md](OPEN-CORE.md) explains the split; [BOUNDARY.md](BOUNDARY.md) defines the paths and import rules.

[License](LICENSE) · [Security reporting](SECURITY.md)
