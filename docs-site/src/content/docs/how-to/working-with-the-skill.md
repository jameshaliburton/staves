---
title: Get more out of the skill
description: What the skill changes about how your agent behaves, and how to steer it.
---

The [skill](/docs/skill/) is written into your project by `connect` and `init`. It does not add
capability — the server does that — but it changes what your agent does with the capability it has.

## What it makes happen without asking

- **It offers.** On first use it tells you what is available rather than waiting to be asked.
- **It scopes.** It asks which workflow you mean instead of describing the whole repository.
- **It cites.** Jobs carry the files they were described from, so a claim can be checked.
- **It asks.** Where the code cannot tell it something, it raises a question rather than inventing an
  answer.
- **It reads before writing.** Before changing code a board describes, it reads the brief.

## Steering it

The skill is a file. Read it, and change it when your project needs something different:

```
.claude/skills/staves/SKILL.md
```

Reasonable things to add for your own repo: what your workflows are called, which directories hold
which, vocabulary your team uses that an agent would otherwise get wrong, or a rule like *always
describe the failure path, not only the happy one*.

Existing custom skill files are preserved by `connect` and `init`. Instructions are also installed
in `.agents/skills/staves/SKILL.md` for agents that discover project skills there.

## When it is not being used

An agent that has the tools but ignores the judgement will describe a repository as a call graph —
jobs named after endpoints, no questions, no citations. If that is what you are getting, check the
skill is actually there and being read. In Claude Code, asking *what skills do you have?* is enough.

## Talk it through in your coding agent

Say **interview me with Staves**. Your agent uses the interview craft through MCP, asks one question at a time, and saves draft graph updates in the background. It does not need a separate model-provider key or a repository to interview you.

The tools separate reported words, draft descriptions and progress. The agent returns the board link early and when it is ready for review. Recording your words does not confer human confirmation; the board preserves your corrections through proposals.

If the MCP connection needs reloading, `connect` prints a CLI command that calls the same tools immediately. Use `staves_access` before creating boards so the agent knows the connection's remaining allowance.
