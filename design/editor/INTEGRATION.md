# Editor integration

The editor is served by `handler.mjs` over the same store and board protocol as the CLI.
Run `npm run preview:editor` for a persistent development workspace. See
[local setup](../../docs/LOCAL-SETUP.md) and [architecture](../../docs/ARCHITECTURE.md).

The optional `codex-bridge.mjs` adapter uses an existing local Codex account for explicit
interview and model-review requests. Availability and limits belong to that account;
an MCP connection alone does not imply model access. Saved questions require an agent
to pick them up; they do not start background execution.
