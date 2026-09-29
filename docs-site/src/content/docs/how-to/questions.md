---
title: Ask and answer questions on a board
description: How the unknowns stay visible instead of being quietly invented.
---

The most valuable thing on a board is often the thing nobody knows. Staves keeps those as questions
attached to the job they concern, rather than letting an agent guess.

## Where questions come from

**The agent raises them** when the code cannot tell it something — whether a part-delivered order is
held or part-paid, what happens to a running lookup when someone changes their mind. A good
description has questions in it; a description with none usually means something was invented.

**You raise them** on any job, when you read something that does not match how the work really goes.

## Answering

Answer in place and the answer stays attached to the job:

```
answer the question about part-delivered orders: they are held, and the supplier is told the same day
```

An answered question becomes part of the description rather than disappearing. Six months later the
board says both what happens and that somebody decided it.

## Comments, and picking them up

Comments are the other half. You leave them on the board, in the browser; the agent reads them as a
work list:

```
what did I leave on the board?
```

`staves_comments` returns them, and the agent replies in place with `staves_comment` rather than in
chat — so the discussion stays where the work is. It can also propose changes from them, which you
accept or refuse.

## Why not just fix it

Because a question is evidence. "Nobody knows what happens to a part-delivered order" is a finding
about the business, not about the board — and it is usually worth more than the answer you would
have guessed.
