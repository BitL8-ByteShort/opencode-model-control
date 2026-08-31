# Support matrix

This matrix separates implemented behavior from compatibility that still needs live acceptance. “Expected” is not the same as verified on every platform.

| Surface | Status | Boundary |
| --- | --- | --- |
| Node.js `>=22.12.0` | Supported by package contract | CI verifies the minimum 22.12.0 release and the current Node.js 24 LTS line. |
| Canonical public repository | Supported | Public source: `https://github.com/BitL8-ByteShort/opencode-model-control`; releases include tagged source and a checksum-recorded package artifact. |
| GitHub `v0.2.0` release | Published and immutable | The release points to protected tag `v0.2.0` and includes the final tarball plus its SHA-256 checksum. The downloaded public asset matches the packaged release artifact. |
| npm registry package | Published and artifact-verified | [`opencode-model-control@0.2.0`](https://www.npmjs.com/package/opencode-model-control/v/0.2.0) is the `latest` version. Its public registry tarball matches the final package checksum and passed a disposable macOS install/version check. Linux fresh-install acceptance remains separate. |
| OpenCode 1.18.x custom agents | Targeted | Managed config uses the 1.18.x `agent` and local MCP surfaces. |
| OpenCode 1.18.22 on macOS | Parser, discovery, connect, MCP handshake, and disconnect tested | Isolated acceptance does not invoke a model or prove a provider session. |
| Later OpenCode configuration majors | Unverified | Schema or agent semantics may change; support requires explicit tests. |
| macOS | Locally verified | Release evidence should name the exact version and architecture. |
| Linux | Expected | Node and CLI paths are portable; distribution-specific acceptance remains required. |
| Windows through WSL | Expected | OpenCode documents WSL as its recommended Windows environment; acceptance remains required. |
| Native Windows | Unverified | Path, process, and browser behavior need dedicated acceptance. |
| OpenCode TUI | Targeted | Managed agents load in a fresh OpenCode process after connection. |
| OpenCode desktop | Unverified separately | Desktop compatibility is not inferred from CLI parsing. |
| Responsive control panel | Implemented | Full-width stacked modules, a persistent collapsible desktop sidebar, and a mobile dialog drawer avoid the prior split-column overflow. |
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
| Big Pickle primary | Configured, unbenchmarked | Text-first initial assignment; quality claims require benchmark evidence. |
| Attachment-aware media routing | Implemented; release acceptance pending | A media turn entering through `omc-router` selects the compatible saved vision model. Media-only analysis becomes a hard tool-free vision-worker turn; only explicit user-authored text classified as a code change retains Omc-Router. |
| MiMo-V2.5 Free media role | Capability-routed, unbenchmarked | Initial vision assignment; vision workers require text output plus confirmed tool-call and input-modality support for the possible media-assisted code lane, while ordinary analysis runs with tools and permissions denied. |
| Automatic code and review workflow | Implemented; prompt-governed | Eligible code changes route code worker -> read-only reviewer -> at most one review-driven repair. The reviewer has no shell/edit/write permission, and specialists cannot recurse. |
| Optional Omc-Router default | Implemented | Added only when no user default exists; user-owned defaults are preserved and only receipt-owned values can be removed. |
| One-click config connection | Implemented | Managed paths only; conflict refusal, backup, receipt, isolated OpenCode parse, atomic write. Receipts detect owned-path/version drift but do not authenticate package file contents. |
| Managed disconnect | Implemented | Removes receipt-owned entries and stops on divergence. |
| Local MCP control relay | Implemented and handshake-tested | The primary can consult route policy; specialists cannot recurse. |
| Local pre-dispatch media plugin | Implemented and contract-tested | Reads attachment type/MIME plus bounded user-authored text only for local write-intent classification; never reads attachment content/locations/payloads; treats attachments as untrusted; hard-denies tools for non-code media turns; fails closed. |
| MCP first-model selection | Not supported by MCP alone | MCP tools become available after model selection; the local OpenCode plugin provides the narrower Omc-Router media switch. |
| Manual runtime access check | Implemented; never automatic | One explicitly confirmed bounded OpenCode run checks access only. OpenCode may retry provider failures, and every attempt may consume quota/cost or be retained. It is not a quality benchmark and cannot promote evidence. |
| Direct OpenRouter account/catalog API | Not implemented | OpenCode remains the provider/authentication authority. |

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

A release should record the operating system, architecture, Node version, exact OpenCode version, discovered model count, full test result, build result, package audit, package-content dry run, isolated connector acceptance, MCP handshake, local-plugin load, attachment-aware route, automatic code/review workflow, and safe default preservation. A manual runtime access check must remain separately labeled and is not benchmark evidence. Missing platform evidence stays labeled unverified.
