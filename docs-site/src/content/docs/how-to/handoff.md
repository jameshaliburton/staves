---
title: Hand work to another agent or a person
description: Export a board as a scoped brief, a prompt, or a drawing — and what each is good for.
---

A board is most useful when it leaves the room it was drawn in. `staves_export` produces several
shapes, and picking the wrong one wastes the work.

## A scoped prompt, for another agent

```
export a handoff for the payment work
```

This is the one people underuse. It builds a prompt scoped to the jobs you name: what the work is,
who it is for, the decision gates and checks, what is still unknown, and, when you ask for sources,
the files behind it. It is what you paste into a different agent, or a different session, instead
of writing four hundred lines of context by hand.

Scope it. A handoff covering the whole board is the same problem as a board covering the whole
platform.

## Markdown, for people

A prose read of the workflow — who does what, in what order, with the open questions listed. This
is what goes in a document, a ticket, or an email to someone who will never open Staves.

## JSON, for machines

The board as data. Use it when something else needs to read the structure — a script, a diff
between two points in time, an import into another board.

## SVG, for the wall

The drawing. `staves_export` produces SVG; `npx @staves/cli pdf [board] --paper=A3` turns a board
into a PDF through headless Chrome, and prints a ready-to-print HTML file instead when there is no
Chrome to use. Worth more than it sounds: a printed board on a wall gets corrected by people
walking past it, which is the cheapest review there is.

## What an export is not

An export is a handoff, not a connection. Nothing you do to the exported copy comes back to the
board it came from. If you want work to land on the board, the agent needs to be
[connected](/docs/connect/) and write to it directly.
