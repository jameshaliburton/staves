---
title: Review a workflow
description: Three kinds of review, plus volume — what each one finds, and when to use it.
---

Staves can criticise a board three ways, and count what it costs. They find different things, so
the useful question is which one you want.

## Findings — what is structurally wrong

```
what is wrong with this board?
```

`staves_issues` and `staves_review` run structural and vocabulary checks. Typical findings:

- **Jargon.** A job named in system words a person in the workflow would never say.
- **Coupled machinery.** One job reached from two places, which usually means it is doing two jobs.
- **No checks.** A job that produces something and verifies nothing — nothing would tell a person it
  came out wrong.
- **Nothing waiting.** A job whose output nobody consumes.

These are cheap and worth running after every describe.

## Reflection — what the shape implies

```
reflect on this workflow
```

`staves_reflect` reads the board as a whole rather than job by job: unreachable jobs, dead ends,
nothing that returns to the outside party who asked, a must-not-happen rule that nobody guards,
intent that does not match where the work actually sits.

## Hats — what each role would say

```
review this as each role in turn
```

`staves_hats` takes every track in turn and comments on the jobs it touches, in that role's voice
and interests. The supplier cares about being told why they are waiting; the budget owner cares
about being able to answer for a decision six months later. It surfaces the objections a single
reviewer does not think of, and it leaves the comments on the board rather than in chat.

## Volume — what the shape costs

```
how often does each of these run?
```

`staves_volume` records how many instances per week enter the board; per-job minutes come from
`staves_describe`. Together they turn "this step is slow" into "this step is slow four thousand
times a week", which is usually what decides whether it is worth changing.

With a connected Langfuse project, `staves_langfuse_runs` and the local editor's **As run** view show how the workflow actually ran in a window — runs, failures, exits, drift — measurement beside these reviews, not a substitute for them.

## Questions beat opinions

Anything the review cannot determine should become a question on the board rather than a
confident finding. You can answer them directly, and the answer stays attached to the job it
concerns.
