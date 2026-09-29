# Security

## Report a vulnerability

Use [GitHub's private vulnerability reporting form](https://github.com/jameshaliburton/staves/security/advisories/new). Include the affected version, reproduction steps, impact and a minimal example with secrets and personal data removed. Do not put vulnerability details or credentials in a public issue.

Security fixes target the current release. Older versions do not have a separate maintenance commitment, and no response-time guarantee is offered.

## Local data and external services

Local boards are plain JSONL files. Treat board content, source snippets, exports and backups according to the sensitivity of the work they describe. An append-only history can retain information after it disappears from the current board view.

Local use does not require a Staves account. Explicitly connecting a hosted account sends board operations and supplied context to that service. Using a model provider or an execution-evidence integration can send data to the configured provider. Review what you share; a local MCP server does not control what your coding agent sends to its model.

Keep provider keys and integration credentials in the supported environment or credential configuration, never in tool arguments, board content, commits or chat. Do not commit `.env` files, `.staves` connection references or agent client files containing secrets.

Hosted agent connection credentials are stored outside the project under `~/.staves/connections/`. Disconnecting locally removes local access; revoking a connection through the service is the way to invalidate it remotely.

## Serving boards

The contributor preview binds to the loopback interface. Keep local development services private. The open single-tenant `staves host` service uses bearer workspace links; anyone with a valid link can exercise the access it grants. Protect those links and use an appropriate authenticated deployment boundary when exposing a service to a network.

The private hosted implementation is maintained outside this repository. See [BOUNDARY.md](BOUNDARY.md) for the source boundary.
