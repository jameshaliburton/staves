---
title: Pick a board back up after the code moved
description: Find what your description no longer matches, and re-describe only that.
---

A board is a description, and descriptions go stale. Staves tracks which files each job was
described from, so it can tell you which ones moved.

## Ask what drifted

```
resume staves
```

or, more precisely:

```
what has drifted since we described this?
```

The agent reads `staves_brief` for context and `staves_stale` for movement. Stale means *the source
files behind this job changed since it was described* — not that the description is wrong, only
that nobody has checked.

## Re-describe the drifted jobs, not the board

Re-describing everything throws away work you confirmed. Ask for the list first, then:

> Re-describe the three jobs that drifted. Leave the rest.

A job someone confirmed comes back as a **proposal** rather than being overwritten. You accept or
refuse it. That is deliberate: an agent should not silently redraw a description a person signed
off on.

## What to check in a re-description

- Did a job's **outcome** change, or only its implementation? Only the first matters to the board.
- Did a **handoff** move — is something now passed to someone else, or later?
- Did a job become **two** jobs, or two collapse into one?
- Has something that was **planned** shipped? Status should say so.

## Before you change code

The habit worth building is the other direction:

```
read the brief before you touch the engine
```

A board earns its keep when it is read before work, not only written after it. If a job describes
the thing you are about to change, read it first and re-describe it after.

## Resume a design conversation

Open Staves on desktop to return to your last explicit board or job scope, saved working intention and transcript. Unsent drafts restore in the same browser. See [Design through conversation](/docs/how-to/conversations/) for scope, return context and coding-agent handoff.
