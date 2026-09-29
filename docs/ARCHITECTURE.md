# Architecture

This describes the current source layout, rather than a proposed package architecture.

## One package, several entry points

The root npm package is `@staves/cli`. TypeScript under `src/` builds into `dist/`. `dist/cli.js` is the command-line entry point; `dist/index.js` exposes library exports. The editor's JavaScript, CSS, HTML and vendor assets are included in the npm package.

The local CLI, MCP tools and browser share the board model and operation machinery. `src/daemon.ts` manages a local process and its discovery record. `src/server.ts` serves board operations, events, analysis and related HTTP endpoints. `design/editor/handler.mjs` provides the main editor surface around those facilities. `src/host.ts` implements the open single-tenant service; it is distinct from the private staves.io gateway.

## Model and storage

`src/model.ts` defines the runtime board types. `src/ops.ts` folds operations into board state. `src/store.ts` provides filesystem persistence, board lookup, history and related operations. Local boards are JSONL logs, usually under a project's `.staves/` directory.

The format in `spec/` describes interchange snapshots. It is versioned separately from the package, and is not a specification of the operation log. `src/format.ts` maps the Staves interchange format; `src/interop.ts` handles other import and export paths. The format's conformance notice records known round-trip and store-preservation limitations.

Handoffs and findings are derived from board relationships by the analyzers. Provenance and proposals preserve distinctions between agent drafts, human decisions and observations. Do not turn a successful execution trace into human confirmation.

## Agent and browser surfaces

`src/mcp.ts` defines the MCP tools and protocol integration. `src/protocol.ts` supplies modeling guidance; `src/interviewer.ts` contains interview logic and method. The caller's model and credentials are separate from the board data.

`design/editor/` is the main editor used by the contributor preview and the current local serving path. Its modules and tests live alongside the surface they implement.

`src/app2.ts` is a legacy generated shell. Its generator is `scripts/build_app2.py`. The standalone build combines this shell with `src/standalone.ts` through `scripts/compose.cjs`. It remains a separate surface and is not a bundled version of the full editor.

## Open and hosted

The open tree includes hosted clients and small extension seams. The private `staves-cloud` repository owns the account gateway, database, tenancy and operations. It builds against this repository as a submodule at a release tag. Open code must not import that implementation or contact a hosted service without explicit configuration or connection.

Some server and tool paths still accept the concrete filesystem `Store` type. The boundary split does not imply that every storage dependency is behind a general interface. Changes here should introduce the smallest necessary seam and preserve local behavior; a full interface rewrite is not part of this release.

[BOUNDARY.md](../BOUNDARY.md) is authoritative for file placement and import direction. `npm run check:boundary -- --pack` checks source boundaries and the npm package contents.

## Validation

`npm test` builds TypeScript and runs core and editor tests. `npm run test:editor` runs the editor tests alone. `node dist/cli.js gym` exercises the interviewer against simulated stakeholders. These checks cover distinct behaviors; none alone establishes browser usability, format conformance or hosted deployment health.
