# Source map

Start with [README.md](README.md), [BOUNDARY.md](BOUNDARY.md) and [local setup](docs/LOCAL-SETUP.md). This document is a contributor entry point, not a record of hosted operations or a roadmap.

## Follow a change through the system

| Area | Start here |
|---|---|
| Board types and interchange | `src/model.ts`, `src/format.ts`, `src/interop.ts`, `spec/` |
| Operations, folding and persistence | `src/ops.ts`, `src/store.ts` |
| Handoffs and analysis | `src/derive.ts`, `src/reflect.ts` |
| Modeling method and interviews | `src/protocol.ts`, `src/interviewer.ts`, `src/gym.ts` |
| Agent tools | `src/mcp.ts` |
| CLI and local daemon | `src/cli.ts`, `src/daemon.ts` |
| HTTP board surface | `src/server.ts` |
| Main editor | `design/editor/`, beginning with `handler.mjs` |
| Single-tenant service | `src/host.ts` |
| Legacy shell and standalone build | `scripts/build_app2.py`, `src/app2.ts`, `src/standalone.ts`, `scripts/compose.cjs` |
| User documentation | `docs-site/` |

The root builds `src/` into `dist/` and publishes `@staves/cli`. The hosted service lives separately and consumes this repository as a submodule pinned to a release tag.

## Invariants and rough edges

- A board describes work; it does not execute that work.
- A local board is an operation log. Preserve provenance and human review when adding write paths.
- Handoffs are derived from board relationships. Edit the underlying jobs and artifacts rather than introducing an independent arrow store.
- Execution evidence does not confirm an intended design.
- The main editor and the legacy standalone shell are distinct surfaces; a change to one does not establish parity with the other.
- Storage consumers still use the concrete `Store` type in places. The open/private split is not a completed storage-interface refactor.
- The format is a draft and the tool has documented conformance gaps. See the notice in [spec/README.md](spec/README.md).

See [architecture](docs/ARCHITECTURE.md) for runtime relationships and [contributing](CONTRIBUTING.md) for checks and sign-off.
