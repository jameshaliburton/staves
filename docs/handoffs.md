# Share and hand off

This is the board export. For the dated engineering handovers, see `handoffs/`:
`2026-09-15-connectivity-hardening.md` and `2026-09-15-editor-connections.md`.


Use **Share & hand off** in the board header. Choose an assignment, select the workflow/jobs/tasks and describe constraints. The preview and every download identify the same board revision. Selecting a job includes its nested tasks; dependencies outside the scope are listed rather than silently imported.

Supported assignments: feasibility assessment, prototype, comparison/integration planning for an existing system, workshop. Unknown requirements can be returned as questions or marked assumptions. Human approval gates remain explicit.

## Outputs

- Markdown brief and copyable coding prompt.
- Versioned Staves JSON handoff (`staves.workflow-handoff`, schema 1).
- Printable SVG. `staves_export` does not produce PDF; `npx @staves/cli pdf [board] --paper=A3` renders one through headless Chrome, and writes a print-ready HTML file instead when no Chrome is found. A browser's print dialog on the SVG works too.
- n8n planning draft: importable sticky notes, **not runnable automation**. No executable nodes, credentials or execution connections are generated.

The scoped handoff excludes raw interview transcripts, raw instruction bodies and unaccepted proposals. Source references are optional. Scoped design comments and questions are included. This is not the archival JSON export available from the Board menu.

## MCP

Call `staves_export` with `board`, optional `jobIds`, `purpose`, `unknowns`, `constraints`, `includeSources`, and `format` (`markdown`, `prompt`, `json`, `svg`, `n8n`). This operation is read-only.

For example: “Use Staves to export the support workflow as a prototype brief. Ask clarifying questions before resolving unknowns, and preserve specialist approval.”

The receiving agent should preserve object IDs and source revision. Existing `staves_ask`, `staves_answer`, `staves_comment` and proposal tools provide the return path. Export itself does not execute or dispatch work.

## CLI

```sh
npx @staves/cli export my-board --format=prompt --purpose=prototype --unknowns=ask-first --constraints='Keep human approval'
npx @staves/cli export my-board --jobs=review,deliver --format=json
```

`--dir PATH` selects a board directory other than this repository's `.staves`.

## Design-tool adapters

[Figma Design importer](../integrations/figma/README.md): local development plugin producing editable frames/text. [Miro adapter](../integrations/miro/README.md): native shapes/connectors for an installed Miro SDK app. Both are developer integrations, not connected production services. Their parser/layout and mocked adapter contracts pass local tests; live destination rendering is unverified. FigJam is not supported yet. Neither adapter syncs destination edits back into Staves.
