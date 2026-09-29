# What is open, what is not

Staves is open core, and the open part comes first. In order, the project is for:

1. **Reach.** People using it, citing it and building on it.
2. **A format others adopt.** A shared way to describe work done by people, agents and systems.
3. **A modest business** in hosting it for teams, later.

Closing something only pays when there is a business to protect, so for now we close only what
exists because *we* run a service. Everything else is open. [BOUNDARY.md](BOUNDARY.md) lists
where each path belongs and how to decide for a new file.

## The line

**Open is everything one person needs, alone, to describe one system and design the next
version of it, with their own agent or their own key.**

**Closed is everything that exists because we host it,** plus the data and tuning that come from
hosting it.

## Open (Apache-2.0)

- **The Staves format** ([spec/](spec/README.md)). The model, the JSON Schema, the provenance
  rules, the mappings to other standards. This is the most open part of the project and is
  decided in public. It is versioned separately from the tool.
- **The analyzers.** Lint, cut, collectable runs, scorecard, diff, review, reflect. Every finding
  on a board traces to a rule you can read. A finding from a black box is worthless.
- **The method.** The protocol, the seven questions, the four tool facts, the stranger test, and
  `CRAFT`, the interviewer's craft. Any connected agent receives it, so keeping it open is what
  lets people cite it.
- **The interviewer engine**, the renderer and the app (`staves.html`).
- **The MCP server, the CLI and the daemon.** Includes single-tenant self-hosting with one token.
- **Interop.** JSON in and out, BPMN, and trace evidence from Langfuse or OpenTelemetry, pulled
  with your own keys.
- **Clients of the hosted service.** `staves connect` and friends are open, the same way `gh` is
  open while GitHub is not.

Anyone can run all of it, for themselves or their team, for nothing.

## Closed (`staves-cloud`, private)

- **The hosted service.** Accounts, sign-in, tenancy, the gateway, our database and its
  policies, email, the owner backoffice, billing when it exists.
- **Operations.** Deployment, platform telemetry, notifications, secrets handling.
- **What hosting teaches us.** Eval sets and session data from hosted use, and interviewer
  prompts tuned on them. The method stays open; the tuning built on other people's sessions
  does not.
- **Later, for teams.** Live trace reconciliation at scale, cross-board and org-wide views,
  domain pattern libraries.
- **Our compute.** Free with your own agent or key; paid when the model is ours.

## Rules that keep it honest

- `staves-cloud` builds from this repository as a submodule pinned to a release tag. Open code never imports cloud code and never
  calls a hosted endpoint unless the person connects. `npm run check:boundary` enforces this.
- Nothing that changes what a board *is* can be cloud-only. If hosting needs data on a board, it
  becomes a documented extension in the spec.
- When in doubt, open. The trust is worth more than the feature.
