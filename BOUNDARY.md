# The boundary

Staves is split in two. This file says where every file belongs and how to decide for a new one.
Read it before you add a file, move one, or import across the line. `OPEN-CORE.md` says *why*;
this says *where*. `npm run check:boundary` enforces the import rule.

## The two sides

**Open — `staves` (Apache-2.0, public).** Everything one person needs, alone, to describe one
system and design the next version of it, with their own agent or their own key.

**Closed — `staves-cloud` (private).** Everything that only exists because *we* run a service:
accounts, tenancy, our database, our email, our backoffice, our compute, and the data and tuning
that come from running it.

The format (`spec/`) is open and stays the most open thing in the project. When in doubt, open —
but never open something that carries a secret, a customer's data, or our operations.

## Where things live

| Path | Side | Note |
|---|---|---|
| `spec/` | open | The Staves format. Changes need a spec version note. |
| `src/` | open | Model, analyzers, protocol, CRAFT, interviewer, renderer, MCP, CLI, daemon, interop, local Langfuse pull. |
| `src/hosted.ts`, `src/device-connect.ts`, `src/remote.ts` | open | *Clients* of a hosted service are open (like `gh` is to GitHub). |
| `src/conflict.ts`, `src/telemetry-sink.ts` | open | Seams the hosted service plugs into (rule 4). |
| `design/editor/` | open | The app. |
| `design/mockups/`, `integrations/`, `docs-site/` | open | Public documentation lives in `docs-site/`. |
| `docs/` | open | Engineering notes a contributor needs. Review for customer names before publishing. |
| `.env*` (except `.env.example`), `.staves/` connection files, `.mcp.json` and the client folders `connect` writes | never committed | They hold personal connection ids and secrets. `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` are committed: their managed block names no connection. |

**Closed code lives in [`staves-cloud`](https://github.com/jameshaliburton/staves-cloud)** (private):
the gateway and backoffice (`api/`), the database (`supabase/`), the staves.io pages (`design/beta/`) and
their tests, the Supabase store and platform telemetry, the scripts that operate the service, internal
plans (`docs/beta`, `docs/marketing`, `docs/product`) and the deployment. It builds from this repository
as a submodule at a release tag and never copies open code. `npm run check:boundary` fails if any of it
reappears here, and `npm run check:boundary -- --pack` fails if the npm package would ship it.

## The rules

1. **Open never imports closed.** Nothing under an open path may import from `api/`,
   `supabase/`, `design/beta/`, `src/cloud-store.ts` or `src/platform-telemetry.ts`.
   Closed code may import open code: staves-cloud builds from this repository at a release tag.
2. **Open never calls us by default.** No open code contacts staves.io, our Supabase, or our
   telemetry unless the person explicitly connects (`staves connect`) or sets a variable.
3. **No secrets, customers or operations in open files.** No keys, no real customer or tester
   names, no owner emails, no internal hostnames beyond the public `staves.io`.
4. **Seams, not forks.** When hosted behaviour needs a hook in open code, add a small interface in
   open code (a store, a telemetry sink, an auth provider) and implement it in `staves-cloud`.
   Do not copy open code into the cloud repo to change it.
5. **The format is decided in the open.** Anything that changes what a board *is* — fields,
   meanings, provenance, versions — goes in `spec/` first, then code. Cloud-only data (billing,
   tenancy, telemetry) never enters the format; if the product needs it on a board, it is an
   extension under a namespace, documented in the spec.
6. **Tuning is closed, method is open.** CRAFT, the protocol and the interviewer engine are open.
   Eval sets, session data from hosted users, and tuned prompts built from them are closed.

## Deciding for a new file

Ask in order:

1. Does it hold a secret, a customer's data, or describe how we operate the service? → **closed**.
2. Does it only make sense because we host (tenancy, billing, our database, our email, our
   backoffice, our models)? → **closed**.
3. Could one person use it alone, on one system, with their own agent or key? → **open**.
4. Still unsure → **open**, and say why in the commit message.

## For agents working in this repo

- Before creating a file, place it with the table and questions above. If it is closed and the
  split has not happened, put it under an existing closed path, never under `src/` or `packages/`.
- Never add an import from an open path to a closed one. Run `npm run check:boundary` after
  changes; it fails on any new crossing.
- Never write secrets, tokens, owner emails or tester names into tracked files. Paste nothing
  from `.env.local`.
- If a task seems to need crossing the line, stop and propose a seam (rule 4) instead.
- Changes to the model's shape start in `spec/`. Update the spec and its changelog in the same
  change.
