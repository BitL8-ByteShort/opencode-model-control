# Support matrix

This matrix separates implemented behavior from compatibility that still needs live acceptance. “Expected” is not the same as verified on every platform.

| Surface | Status | Boundary |
| --- | --- | --- |
| Node.js `^20.19.0` or `>=22.12.0` | Supported by package contract | `npm run verify` is the release gate. |
| Canonical public repository | Supported | Public source: `https://github.com/BitL8-ByteShort/opencode-model-control`; a versioned package artifact stored in the immutable release tag is the initial distribution channel. |
| npm registry package | Not yet published | Package metadata and an unclaimed registry name are not publication evidence. Use the pinned GitHub tag until a registry artifact is linked from the README. |
| OpenCode 1.18.x custom agents | Targeted | Managed config uses the 1.18.x `agent` and local MCP surfaces. |
| OpenCode 1.18.22 on macOS | Parser, discovery, connect, MCP handshake, and disconnect tested | Isolated acceptance does not invoke a model or prove a provider session. |
| Later OpenCode configuration majors | Unverified | Schema or agent semantics may change; support requires explicit tests. |
| macOS | Locally verified | Release evidence should name the exact version and architecture. |
| Linux | Expected | Node and CLI paths are portable; distribution-specific acceptance remains required. |
| Windows through WSL | Expected | OpenCode documents WSL as its recommended Windows environment; acceptance remains required. |
| Native Windows | Unverified | Path, process, and browser behavior need dedicated acceptance. |
| OpenCode TUI | Targeted | Managed agents load in a fresh OpenCode process after connection. |
| OpenCode desktop | Unverified separately | Desktop compatibility is not inferred from CLI parsing. |
| All-provider model discovery | Implemented | Uses plugin-aware `opencode models --verbose` with no provider filter. |
| Catalog refresh | Implemented | **Update available models** adds `--refresh`; no model is invoked. |
| OpenCode config normalization during discovery | Upstream OpenCode behavior observed on 1.18.22 | OpenCode may add its standard `$schema` property when reading a project JSONC config; Model Control does not own or remove it. |
| Local usage accounting | Implemented and live-tested on OpenCode 1.18.22 | Fixed aggregate DB query; 7/30/90-day and all-time windows; no prompt/content projection. |
| Usage cost values | Provider-reported estimate | OpenCode's recorded cost is displayed; it is not treated as a provider invoice. |
| Plugin-free fallback | Implemented, explicitly incomplete | Preserves a usable snapshot when plugin-aware discovery fails; plugin models may be absent. |
| Dynamic model records | Implemented | New records are visible and Model Control-disabled by default. |
| Verified-free mode | Implemented | Only independently verified exact-zero pricing is eligible. |
| Known-paid preference | Implemented | Paid mode allows verified free and known paid, preferring paid after hard gates. |
| Unknown pricing | Blocked | Missing or ambiguous pricing is not assumed free and cannot auto-route. |
| Big Pickle primary | Configured, unbenchmarked | Text-only default; quality claims require benchmark evidence. |
| MiMo-V2.5 Free media role | Capability-routed, unbenchmarked | Media must be attached directly to the vision subagent. |
| One-click config connection | Implemented | Managed paths only; conflict refusal, backup, receipt, isolated OpenCode parse, atomic write. |
| Managed disconnect | Implemented | Removes receipt-owned entries and stops on divergence. |
| Local MCP control relay | Implemented and handshake-tested | The primary can consult route policy; specialists cannot recurse. |
| MCP pre-first-call routing | Not supported by stock OpenCode | MCP tools become available after model selection. |
| Direct OpenRouter account/catalog API | Not implemented | OpenCode remains the provider/authentication authority. |
| Optional provider gateway | Planned, not implemented | Required for attachment-aware pre-dispatch routing. |

## Current bundled evidence

The project includes authoritative verified-free evidence for this dated OpenCode Zen snapshot:

- `opencode/big-pickle`
- `opencode/ling-3.0-flash-fin-free`
- `opencode/mimo-v2.5-free`
- `opencode/muse-spark-1.2-contributor-free`
- `opencode/nemotron-3-ultra-free`
- `opencode/nemotron-3.5-lightning-free`

These IDs are not an availability promise. OpenCode or a provider may rename, rate-limit, remove, or reprice a model. The live resolved OpenCode catalog determines discovery and availability; independent evidence determines whether zero pricing is trusted.

“Free” does not imply privacy, unlimited usage, uptime, or future pricing. “Paid” preference can incur provider charges.

## Release evidence

A release should record the operating system, architecture, Node version, exact OpenCode version, discovered model count, full test result, build result, package audit, package-content dry run, isolated connector acceptance, and MCP handshake result. Missing platform evidence stays labeled unverified.
