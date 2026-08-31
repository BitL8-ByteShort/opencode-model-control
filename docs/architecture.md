# Architecture

OpenCode Model Control is a loopback-only companion process. It does not replace OpenCode or sit in the provider request path.

## Current path

```text
Browser on this computer
        |
        v
Local control service (127.0.0.1 only)
        |-- discovers `opencode models --verbose [--refresh]`
        |-- stores model enablement, role choices, and cost policy
        |-- plans explainable routes
        |-- safely manages owned OpenCode config entries
        `-- serves a local MCP control subprocess
                         |
                         v
OpenCode starts the configured primary
        |-- may consult model-control_route_task
        |-- may invoke omc-code-worker
        |-- may invoke omc-reviewer
        `-- media must be sent directly to omc-vision-worker
```

OpenCode, OpenCode Zen, OpenRouter, and other model providers remain separate systems with their own credentials, terms, availability, pricing, and data handling. Model Control does not collect provider credentials or call provider APIs directly.

## Components

### Dynamic catalog

Normal discovery runs the installed OpenCode CLI without a provider filter or `--pure`. That gives OpenCode a chance to apply its resolved provider configuration, model allow/deny rules, and external plugins. The **Update available models** action adds `--refresh`.

If plugin-aware discovery fails or times out, a `--pure` fallback can preserve built-in/configured provider visibility. That snapshot is marked incomplete because plugin-contributed providers may be missing. A failed or incomplete refresh retains models from the last usable snapshot rather than silently disabling everything.

Catalog records separate:

- discovery by OpenCode;
- Model Control enablement;
- reported availability;
- runtime verification;
- input and output modalities;
- tool-call capability;
- role profile and evidence;
- pricing class.

Newly discovered models are visible but Model Control-disabled by default.

### Pricing and preference

Pricing has three classes:

- `free`: independently verified input and output prices are both exactly zero;
- `paid`: verified input or output price is positive;
- `unknown`: missing, ambiguous, malformed, or otherwise unverified pricing.

OpenCode may normalize absent price fields to zero. Therefore a zero from arbitrary CLI metadata is not, by itself, proof of free access.

The UI maps **Free** to `free-first + free-only`. It maps **Paid** to `paid-first + known-cost`. Paid mode permits both verified-free and known-paid models but prefers paid candidates after capability, availability, enablement, and qualified-evidence gates. Unknown pricing is never eligible.

### Route planner

The planner produces an explainable proposed route. Its hard gates require the model to be discovered, active, Model Control-enabled, cost-policy eligible, role-compatible, modality-compatible, and capable of the required access/tool behavior.

Compatible candidates are then ordered by qualified evidence, cost preference, role score, and stable ID. An explicit compatible assignment remains authoritative. Routing does not call a model and is not proof that stock OpenCode enforced a plan.

### OpenCode config generator

`src/opencode/index.js` converts the catalog and settings into an OpenCode agent fragment. It is deliberately pure:

- no filesystem API is imported;
- no file path is accepted;
- no provider credential is read;
- existing values are cloned rather than mutated;
- owned-key collisions fail closed;
- `default_agent` is omitted.

The generated team includes `omc-router`, `omc-code-worker`, `omc-vision-worker`, and `omc-reviewer` when eligible models resolve.

### Safe connector

The panel and CLI use a separate connector for the optional configuration write. It owns only:

- `mcp.model-control`;
- `tools.model-control_*`;
- `agent.omc-router`;
- `agent.omc-code-worker`;
- `agent.omc-vision-worker`;
- `agent.omc-reviewer`.

The connector selects the current global OpenCode config using OpenCode-compatible filename precedence, rejects symlinks/nonregular files/invalid JSONC/duplicate or unsafe keys, preserves unrelated JSONC text and comments, and refuses to replace conflicting owned paths.

Before the live write it constructs the candidate in memory, asks a fresh isolated OpenCode process to parse it, and completes a real initialize/tool-list handshake with the exact managed MCP command. The final transaction holds a per-target lock, rechecks the source snapshot, creates an adjacent mode-`0600` backup, atomically replaces the config, and writes a mode-`0600` ownership receipt. Disconnect uses the same lock and snapshot guard and removes only receipt-owned values; if the config changed elsewhere, it stops instead of overwriting it. Because the backup is a full config copy, it can contain credentials the user embedded in that file even though Model Control does not extract, log, or transmit them.

The managed MCP command contains absolute Node and package CLI paths so OpenCode does not depend on an interactive shell's `PATH`.

### MCP control bridge

The bridge exposes bounded routing information from the local panel to the already selected primary. Before a nontrivial delegation, the generated prompt tells the primary to call `model-control_route_task`, honor a `direct` result as a stop, and delegate at most once to an eligible role.

Only `omc-router` receives the `model-control_*` tools. Specialists deny those tools and further task delegation. The bridge does not return secrets, arbitrary commands, filesystem content, or unknown-cost candidates.

### Local control service

The service binds to `127.0.0.1`, rejects non-loopback host headers, and exposes the UI plus a bounded JSON API. State-changing requests require trusted same-origin JSON requests. It is not designed for remote hosting or untrusted multi-user access. The project does not include telemetry or remote analytics; OpenCode, configured plugins, and model providers remain separate network and reporting boundaries.

The Usage API runs a fixed aggregate query through `opencode --pure db ... --format json`. It accepts only four allowlisted time windows and projects assistant model identifiers, aggregate sessions/messages, token counters, timestamps, and recorded cost. It does not select prompts, responses, titles, project metadata, paths, session identifiers, raw JSON, parts, or credentials. The child process has a ten-second timeout and one-mebibyte output cap, at most 250 model rows are returned, and schema/process failures remain distinguishable from a compatible empty database.

## Why MCP is not the first router

An MCP server gives tools to a model after OpenCode has selected and invoked that model. The bridge can guide delegation, but it cannot intercept a request before the first model.

For image work, the original attachment must currently be sent directly to `@omc-vision-worker`. A text-only primary cannot forward media OpenCode omitted before invocation.

## Later path: optional local gateway

True first-call routing requires a provider-compatible component that receives the request before provider dispatch. A future gateway would need separate opt-in configuration plus credential isolation, request authentication and size limits, streaming/cancellation conformance, timeout and retry controls, provider error normalization, redacted logs, SSRF protection, and cost limits.

That gateway is not implemented in the current project.

## Design invariants

- Unknown pricing is never automatically routed.
- Cost preference never overrides capability, availability, enablement, or an explicit compatible assignment.
- Live availability does not prove model quality or successful provider access.
- Benchmark evidence is versioned and reproducible; unrun evidence stays provisional.
- Only connector-owned OpenCode paths may be changed or removed.
- Only the primary receives model-control MCP tools; specialist delegation is non-recursive.
- No claim of media understanding is made by the text-only primary.
- Failure is explicit; there is no silent unknown-cost or unavailable fallback.
