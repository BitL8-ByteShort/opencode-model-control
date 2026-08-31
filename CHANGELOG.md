# Changelog

All notable changes to OpenCode Model Control are recorded here. The project follows [Semantic Versioning](https://semver.org/).

## 0.2.0 - 2026-08-31

- Added attachment-aware Omc-Router media switching through the bundled local OpenCode plugin, with capability, modality, availability, enablement, and cost-policy gates that fail closed. Media-only analysis runs as a tool-free vision worker, while only explicit user-authored text classified as a code change may retain Omc-Router for the vision-to-code-to-review workflow.
- Added automatic code-worker and independent read-only reviewer delegation with at most one prompt-governed review repair pass.
- Added safe optional Omc-Router default-agent management that preserves an existing user default and removes only receipt-owned values.
- Added managed-surface version receipts so an installed 0.1.x connection is reported as requiring an update before the new plugin and agent definitions are used.
- Added a manual, isolated runtime access check that remains separate from benchmark qualification and discloses possible provider retries, quota use, charges, and retention.
- Added full-width stacked dashboard modules, a collapsible desktop sidebar, and a mobile navigation drawer.
- Hardened specialist permissions, attachment-as-untrusted-data handling, media-turn authorization, runtime-check configuration isolation, generated-config preview accuracy, and recovery from malformed optional runtime history.
- Expanded integration, security, benchmark, support, and release documentation for the new routing and qualification boundaries.

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
