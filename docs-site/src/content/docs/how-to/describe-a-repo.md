---
title: Describe a repository for the first time
description: Turn code you already have into a board, without describing the whole platform at once.
---

You need a project open in an agent that is [connected](/docs/connect/). Nothing else.

## Say what you want described

```
run staves
```

That is the whole prompt — the server carries its own instructions. The agent reads
`staves_help`, looks for where requests from outside arrive, and asks which workflow you mean
before drawing anything.

**Answer with a workflow, not a repository.** "The checkout flow", "how a lead becomes a sent
proposal", "what happens when an invoice arrives". A repository usually holds several, and one
board per workflow is what keeps a board readable. A board called "the platform" is one nobody
reads twice.

## What it does while you wait

In order: names the board and its goal, puts the people and systems on tracks, then describes jobs
from the outside in — the person who asks, the person who receives, then the work between them.
Machinery becomes tasks inside jobs rather than jobs of its own.

Then it runs `staves_cut`, which folds execution steps into the jobs a person would name. That step
is why the finished board reads as work rather than as a call graph.

You will see each piece arrive on the board as it lands.

## Read it before you correct it

Open the board and read the brief first:

```
brief me
```

One prose pass over who does what, where the gates are, and what is unanswered. It is faster than
reading the canvas, and it tells you whether the agent understood the work or only the code.

## Fix the names, not the shapes

The most common thing wrong with a first board is vocabulary: jobs named after endpoints rather
than outcomes. Say so plainly —

> "Reach out to approved vendors" is what the team calls that, not "POST /vendors". Rename anything
> that uses system words a person in this workflow would not say.

The agent renames jobs with `staves_patch`. `staves_words` is for something else: registering the
terms this domain uses, so later descriptions reach for the same ones.

## When it does not know, it should say so

A board carries open questions on purpose. If the agent could not tell from the code whether a
part-delivered order is held or part-paid, that belongs on the board as a question, not as a
confident sentence. Ask for them:

> What did you have to guess at? Put those on the board as questions instead.

## Next

- [Pick it back up after the code moves](/docs/how-to/resume/)
- [Review it](/docs/how-to/review/)
