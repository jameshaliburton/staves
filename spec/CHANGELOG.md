# Changelog — the Staves format

## 0.1 (draft, 2026-09-23)

First public draft: board, tracks, jobs, artifacts, triggers, exits, gates, loops, tools;
derived handoffs with deterministic ids; per-field provenance with disputes (W3C PROV-compatible);
generic execution evidence; references; namespaced extensions; a position on describing people.

Clarified during the draft (2026-09-23): identifiers are unique across the whole board, not per kind.
Producers that must rename colliding ids do so deterministically and record the renames
(`DECISIONS.md`).
