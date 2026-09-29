---
title: Try a change without committing to it
description: Fork a board, redesign a flow on the branch, and compare it against the original.
---

Some questions cannot be answered by arguing about them. *Should the report wait for the published
revision, or go out preliminary?* is a shape question, and the cheapest way to settle it is to draw
both shapes.

## Branch the board

```
branch a scenario called preliminary-report
```

`staves_scenario` forks the board. The branch carries everything the original had and is edited
independently. The original is untouched, so nothing you try on the branch can cost you the
description you already trust.

## Redesign on the branch

Work on the branch as you would the board: move a handoff, split a job, change who is accountable
for a gate, change what triggers something.

The valuable part is describing the *consequences* rather than only the change. Ask for them:

> On this branch, the report goes out before the revision is published. What breaks? Who finds out,
> and how?

## Compare them

Put the two side by side and ask what actually differs — not in structure, but in what people
experience:

> What is different for the shopper between these two? What is different for the operator?

A scenario that reads better on the canvas but makes someone wait longer is not an improvement, and
that only becomes obvious when the comparison is about people rather than boxes.

## Keeping one

A branch is a board. If it wins, it can become the description you work from; if it loses, it is a
record of a decision you already made, which is worth keeping. Nothing forces you to merge.

## Pin, assess and accept intended design

New alternatives pin an immutable baseline. Later source edits do not change that comparison. Older mutable alternatives are labelled unpinned; Staves does not invent their original capture.

On a pinned alternative, open **View → Effort estimates → Review intended changes**. Review the semantic changes and any conflicts with the current source. **Accept intended design** applies the reviewed design changes to the source. Conflicts or intervening edits require a fresh review. Existing implementation and execution records are preserved separately.

Choose **Test a scenario** in the **Board options** menu to open a panel beside the board. Describe the situation and select what is already available at the start. The description names the scenario; its facts come from your explicit selections.

Preview the scenario before saving. Staves highlights reached work and blockers on the canvas, then offers the relevant decision and retry choices. Unknown prerequisite rules remain unresolved: change the design if those rules are missing, rather than guessing how they work. Previewing does not write to the board.

**Save scenario** records the checked design and result. If the design changes after preview, test it again before saving. Saved results retain their original design and are shown as historical captures. Testing a scenario does not create an alternative board or execute software.

The **History** button in the bottom taskbar shows lineage and saved activity. [Connect design to Git and development](/docs/how-to/design-and-development/) to associate requests with actual branches, commits and pull requests.
