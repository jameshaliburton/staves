---
title: Build a shared domain vocabulary
description: Keep stable workflow concepts, evolving domain definitions and implementation mappings connected without requiring an integration.
---

Staves separates its core work model from your domain vocabulary. Tracks describe performers, jobs describe work, and artifacts describe what changes hands. Your vocabulary defines concepts such as vendor, approval authority or purchase request. Repository, API and Langfuse references associate those concepts with implementation; they do not independently verify that implementation.

You can model work without a vocabulary, repository or Langfuse connection. Establish definitions when they help resolve ambiguity in the conversation.

## Propose definitions with your coding agent

Call `staves_vocabulary` with the board ID. It returns the versioned core contract, current vocabulary and a `basis` value identifying the vocabulary you read. Then use `staves_vocabulary_propose` with that exact basis and a complete vocabulary revision:

```json
{
  "board": "onboarding",
  "basis": "null",
  "vocabulary": {
    "version": 1,
    "namespace": "vendor-onboarding",
    "concepts": [{
      "id": "vendor",
      "name": "Vendor",
      "definition": "An organization being evaluated to supply goods or services.",
      "aliases": ["supplier"],
      "status": "inferred"
    }]
  }
}
```

The `"null"` basis applies only when the read tool returned no vocabulary. Never manufacture a basis for an existing vocabulary. A changed vocabulary requires another read and reconciliation.

Every agent vocabulary edit becomes a proposal. The active vocabulary stays unchanged until a person accepts it through the board's proposal review. An accepted definition can still be labelled inferred or disputed: accepting its inclusion does not establish its truth. Use confirmed only when proposing a definition the person has actually agreed to.

## Preserve identities and uncertainty

Keep the namespace and concept IDs when renaming terms or creating alternatives. Store synonyms as aliases only when they mean the same thing; ask when meanings differ. Context-specific approval rules belong to the relevant workflow, rather than redefining a shared concept for every use.

Concepts can include:

- `sources`: reported interview, repository, trace or document references and explanatory notes.
- `links`: explicit associations with job, track or artifact IDs on the board.
- `relationships`: named relationships targeting other concept IDs in the vocabulary.
- `mappings`: repository, API or Langfuse references with notes explaining the association.

Relationships and mappings are many-to-many. A task is not the same thing as a trace observation. Do not place credentials in any definition, note or reference.

Retain old identities when merging concepts: label the old concept `superseded` and name its replacement with `supersededBy`. The replacement must exist and cannot form a cycle. The proposal review checks that the vocabulary and referenced work have not changed underneath the proposed revision.

## Share the vocabulary

The board JSON and structured workflow handoff carry the accepted vocabulary. Scoped handoffs retain the shared definitions and concept relationships while limiting workflow links to the selected work. Source notes and implementation mappings are omitted by default; `includeSources` opts them in, while interview source notes remain excluded from handoffs.

This release stores vocabulary within a board, with its namespace retained by alternatives. It does not provide a centrally synchronized project ontology registry. Changes on independent boards do not automatically propagate. Human-reviewed board knowledge is also not shared across other customers or used as automatic platform memory.
