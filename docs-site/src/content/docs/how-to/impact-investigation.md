---
title: Investigate a design change
description: Find wider implications before changing a workflow.
---

A local interview answer can affect other parts of the design. Before a substantive change, use `staves_impact` with the board and focus job IDs or domain concept IDs:

```json
{"board":"procurement","jobIds":["approve-vendor"]}
```

The read-only packet follows declared artifact handoffs, exits, retries and correction links upstream and downstream. It also identifies shared domain concepts, decision authority and immediate parent/task context. A concept can link explicitly to jobs, performers or artifacts. Similar wording alone never establishes a shared concept.

For example, changing vendor approval can identify both provisioning and payment as downstream candidates, a disconnected exception decision with the same authority, and a registration task using the same domain concept. These are investigation candidates, not permission to change those jobs.

## Investigate implementation separately

The packet includes existing source references and targeted repository questions. A coding agent with repository access can inspect callers, contracts, permission checks and tests. Its response should cite the inspected code and commit, distinguish tests actually run from suggested tests, and state access limitations. Use a scoped assessment request to retain those findings.

Staves does not execute repository searches through this tool. Existing Langfuse references are reported associations; returning them does not inspect a new trace or establish complete execution coverage. No integration is needed to use impact investigation.

## Preserve uncertainty and scope

Missing prerequisite semantics, missing producers, dangling exits and linked boards appear as unknowns. Linked boards are never fetched automatically. The packet only covers declared relationships on the requested board; undeclared technical dependencies can still be absent.

Results contain at most 80 candidate jobs, 200 connecting edges, 30 concepts and 60 unknowns, with omission counts. Source and evidence references and concept mappings are bounded separately with omission counts. Focus jobs are prioritized. Narrow the focus if results are truncated; do not interpret truncation as a complete review.

Exploratory conversation can collect context before a coherent revision. Investigation may expand beyond the selected task, but edit scope remains explicit and existing proposal review rules still apply.
