---
title: What Staves is for
description: What a board is, what it is not, and who it is for.
---

Staves draws the work of a project as a board: people, agents, systems and outside parties on
tracks, with jobs between the handoffs. It answers a question that is otherwise expensive to
answer — *who does what here, what passes between them, and where does it stall* — and keeps the
answer true as the code changes.

## What a board is

![A board: six tracks down the side, jobs along them, handoffs curving between.](../../assets/screens/board.png)

*A worked example, not anyone's real workflow. These images are regenerated from the running interface, so what you see here is what you will get.*

A **job** describes something achieved for a person. Its **tasks** describe the work needed to
achieve it, and they can belong to different roles — people, agents, systems. **Tracks** keep those
responsibilities visible. **Handoffs** are what passes between them.

Each job is written so a stranger could do it by hand and get the same result and the same
failures. That is the test.

## What a board is not

A board is a description, not a live trace of production. It does not execute your services, and a
walkthrough is design exploration rather than a recording of what happened. Where the code cannot
tell you something, a board carries an open question rather than a confident invention — an
unanswered question is worth more than a guess that reads as fact.

## Who draws it

Usually the coding agent you already use. It reads the code on your machine and writes only its
description of the work to the board; Staves never sees your repository. You can also be
interviewed in the browser, which needs no repository and no agent, but does need an AI key.

## Desktop and mobile

Use desktop to design and remodel workflows, by conversation or directly on the canvas. A phone reads one board opened from a shared link and copies the link to continue on a computer; there is no board list on a phone. See [Design through conversation](/docs/how-to/conversations/).
