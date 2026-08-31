# Changelog

All notable changes to OpenCode Model Control are recorded here. The project follows [Semantic Versioning](https://semver.org/).

## 0.1.2 - 2026-08-30

- Published the verified package as an immutable artifact in the public Git tag, providing a one-command install that does not depend on npm registry publication or npm's Git-dependency packaging lifecycle.

## 0.1.1 - 2026-08-30

- Switched the public installer to an attached, prebuilt GitHub release package after clean-room testing exposed unreliable npm extraction for a Git-source dependency install.
- Retained the last complete live catalog across app restarts so an incomplete plugin-free fallback cannot erase previously discovered plugin models.
- Added an explicit restart notice when a refresh updates an already-connected OpenCode integration.
- Clarified that local Usage accounting reads session IDs only for a distinct-session aggregate and never returns those identifiers.

## 0.1.0 - 2026-08-30

Initial public release.

- Added a local-first model routing control panel and read-only MCP bridge for OpenCode.
- Added live OpenCode model discovery with an explicit plugin-free fallback.
- Added user-managed model enablement and Free or Paid routing preferences that block unknown pricing.
- Added bounded orchestrator, code, vision, and reviewer assignments with explainable routing previews.
- Added safe one-click Connect and Disconnect flows with backup, ownership receipts, concurrency checks, rollback, OpenCode validation, and exact MCP handshake verification.
- Added an optional Advanced section for resolving, opening, revealing, previewing, copying, and exporting integration configuration.
- Added local aggregate Usage reporting for tokens, recorded cost, sessions, messages, and per-model totals without reading prompt content or credentials.
- Added tests, CI, security documentation, contributor guidance, release documentation, and an MIT license.
