# Architecture

OpenCode Model Control is a loopback-only companion process. It does not replace OpenCode, proxy provider traffic, or hold provider credentials. Its bundled local OpenCode plugin can change the model on an `omc-router` media turn immediately before OpenCode dispatches that turn to a provider.

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
        |-- serves a local MCP control subprocess
        `-- offers explicit one-model runtime access checks
                         |
                         v
OpenCode loads Omc-Router, specialists, MCP, and local routing plugin
        |-- media analysis -> compatible vision model + tool-free vision agent
        |-- explicit media-assisted code request -> vision model + Omc-Router
        |                                      -> code worker -> reviewer
        |-- task metadata  -> MCP returns an eligible, explainable route
        `-- code change    -> code worker -> reviewer -> at most one repair
```

OpenCode, OpenCode Zen, OpenRouter, and other model providers remain separate systems with their own credentials, terms, availability, pricing, and data handling. Model Control does not request, extract, log, or transmit provider secret material and does not call provider APIs directly. Its connector does read the local OpenCode config to preserve unrelated settings and create a private full-config backup. Its separate runtime-check isolation guard locally parses OpenCode's credential store only to inspect credential-type metadata and fails closed when that metadata cannot be handled safely.

## Components

### Dynamic catalog

Normal discovery runs the installed OpenCode CLI without a provider filter or `--pure`. That gives OpenCode a chance to apply its resolved provider configuration, model allow/deny rules, and external plugins. The **Update available models** action adds `--refresh`.

If plugin-aware discovery fails or times out, a `--pure` fallback can preserve built-in/configured provider visibility. That snapshot is marked incomplete because plugin-contributed providers may be missing. A failed or incomplete refresh retains models from the last usable snapshot rather than silently disabling everything.

Catalog records separate:

- discovery by OpenCode;
- Model Control enablement;
- reported availability;
- manual runtime-access evidence;
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

The UI maps **Free** to `free-first + free-only`. It maps **Paid** to `paid-first + known-cost`. Paid mode permits both verified-free and known-paid models but prefers paid candidates after capability, availability, enablement, and qualified-evidence gates. Unknown pricing is never eligible. A deliberate compatible role selection is also an explicit model opt-in: it enables only that selected model in the unsaved draft. Automatic routing never enables models.

### Route planner

The planner produces an explainable proposed route. Its hard gates require the model to be discovered, active, Model Control-enabled, cost-policy eligible, role-compatible, modality-compatible, and capable of the required access/tool behavior.

Compatible candidates are then ordered by qualified evidence, cost preference, role score, and stable ID. An explicit compatible assignment remains authoritative. Vision-worker eligibility additionally requires text output and confirmed tool-call capability so the same assignment can safely support the explicit media-assisted code path; pure media analysis runs tool-free. Code changes require independent review, so an eligible code route includes the primary, code worker, and reviewer. Planning does not call a model and is not proof that a model followed the generated instructions.

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

The panel and CLI use a separate connector for the optional configuration write. It can own only:

- `mcp.model-control`;
- `tools.model-control_*`;
- `agent.omc-router`;
- `agent.omc-code-worker`;
- `agent.omc-vision-worker`;
- `agent.omc-reviewer`;
- its exact canonical `file://` entry inside the top-level `plugin` array;
- `default_agent` only when it safely added `omc-router` itself.

The connector selects the current global OpenCode config using OpenCode-compatible filename precedence, rejects symlinks/nonregular files/invalid JSONC/duplicate or unsafe keys, preserves unrelated JSONC text, comments, and plugin entries, and refuses to replace conflicting owned paths.

When **Make Omc-Router my default agent** is enabled, the connector adds `default_agent: "omc-router"` only if the config has no default. An existing user-owned default is preserved. Turning the option off removes only a default previously recorded in this installation's receipt; it never claims or removes a user-owned value.

Before the live write it constructs the candidate in memory, asks a fresh isolated OpenCode process to parse it, and completes a real initialize/tool-list handshake with the exact managed MCP command. The final transaction holds a per-target lock, rechecks the source snapshot, creates an adjacent mode-`0600` backup, atomically replaces the config, and writes a mode-`0600` ownership receipt. Disconnect uses the same lock and snapshot guard and removes only receipt-owned values; if the config changed elsewhere, it stops instead of overwriting it. Because the backup is a full config copy, it can contain credentials the user embedded in that file even though Model Control does not extract, log, or transmit their secret material.

The receipt pins exact managed paths/values and a managed-surface version for ownership and stale-install detection. It does not hash or authenticate the package file contents at the recorded Node, CLI, and plugin paths; published package integrity and release checksums provide that provenance evidence.

`OMC_OPENCODE_CONFIG_PATH` can select an absolute nonstandard connector target for advanced tests, but it does not make an ordinary OpenCode launch read that file. `OMC_CONFIG_DIR` can relocate private Model Control state only when the identical value is propagated to both the panel and every OpenCode launch, including the environments inherited by the MCP subprocess and media plugin. The default paths are the supported safe choice when propagation is uncertain.

The managed MCP command contains absolute Node and package CLI paths so OpenCode does not depend on an interactive shell's `PATH`.

### Local media routing plugin

The connector adds the bundled plugin as a canonical absolute `file://` URL. On each media-bearing `omc-router` `chat.message` hook, the plugin reads attachment part type/MIME metadata, reloads the saved catalog snapshot and settings, applies the enablement, availability, pricing, role, access, text-output, tool-call, and modality gates, and resolves the explicit or automatic vision-worker assignment. It selects that model for the current turn and clears any text-model variant by omission.

The plugin then chooses the authority lane from explicit user-authored text outside attachments. It ignores text parts marked synthetic or ignored, rejects an empty combined value, caps classification input at 4,000 characters, and fails closed if classification throws. If the bounded text clearly requests a code/workspace change, the agent remains `omc-router` so the vision-capable model can inspect the attachment and follow the code-worker -> read-only reviewer workflow. Otherwise the agent becomes `omc-vision-worker`; generated agent settings disable its tools, and session-scoped `permission.ask` and `tool.execute.before` hooks independently deny any permission or tool attempt until the next turn resets the guard.

Every routed media turn receives a fixed system instruction declaring attachment content untrusted. Embedded attachment instructions cannot authorize tools, delegation, or workspace changes. The plugin never reads attachment content, filenames, URLs, data URLs, or payloads. It does not log, persist, or separately transmit the user text used for local authorization classification. OpenCode and the selected provider still receive the original text and attachment parts as the inference payload under their own terms.

No safe eligible model means a fixed local failure. There is no unknown-cost, unavailable, or modality-incompatible fallback. Other agents are outside this hook and keep their selected model.

### MCP control bridge

The bridge exposes bounded routing information from the local panel to the selected primary. Before nontrivial work, the generated prompt tells Omc-Router to call `model-control_route_task`, honor a `direct` result as a stop, and delegate only to roles returned by policy.

For an authorized code change, Omc-Router is instructed to delegate implementation to `omc-code-worker`, then give `omc-reviewer` the original task and resulting workspace changes. The reviewer has read/search tools only and no shell, edit, or write permission. When the review repair pass is enabled and the review identifies a concrete correctness, security, regression, or missing-test defect, the router may send one repair task back to the same code worker and must then stop the cycle. With the repair pass disabled it reports review findings without another delegation. This is not an alternate-model fallback.

Only `omc-router` receives the `model-control_*` tools. Specialists deny those tools and further task delegation. The bridge does not return secrets, arbitrary commands, filesystem content, or unknown-cost candidates. Delegation and repair ceilings are prompt-level controls; stock OpenCode does not provide a stronger host-enforced cycle counter here.

### Local control service

The service binds to `127.0.0.1`, rejects non-loopback host headers, and exposes the UI plus a bounded JSON API. Each server process creates a new high-entropy mutation token. The normal browser launch receives that token in a private query URL; the UI captures it in the tab's `sessionStorage` and immediately removes it from the address bar. A tab opened from the bare URL can read state but cannot change it.

Every `POST`, `PUT`, `PATCH`, or `DELETE` API request requires a same-origin `Origin`, a JSON content type and body, `X-OMC-Request: 1`, and the matching `X-OMC-Session` value. `--no-open` prints the private write-enabled URL only when stdout is an interactive terminal and labels it keep-private; a non-interactive launch prints only the public read-only URL. Restarting the service rotates the token. The token must not be shared, bookmarked, logged, or persisted outside the browser tab. This is a local mutation capability, not support for remote hosting or untrusted multi-user access. The project does not include telemetry or remote analytics; OpenCode, configured plugins, and model providers remain separate network and reporting boundaries.

The Usage API runs a fixed aggregate query through `opencode --pure db ... --format json`. It accepts only four allowlisted time windows and projects assistant model identifiers, token counters, timestamps, recorded cost, and session IDs solely for a distinct-session count. It returns aggregate sessions/messages and per-model totals, never session identifiers, prompts, responses, titles, project metadata, paths, raw JSON, parts, or credentials. The child process has a ten-second timeout and one-mebibyte output cap, at most 250 model rows are returned, and schema/process failures remain distinguishable from a compatible empty database.

### Manual runtime access check

The runtime access check is a separate, explicit provider-call boundary. It never runs during startup, refresh, Save, Connect, or benchmark-summary reload. The user selects one model and must acknowledge both the real provider request and possible cost/data terms.

The service starts one bounded `opencode run --pure` execution in an isolated temporary directory with a fixed text-only sentinel, no project content, no attachments, no custom prompt, and external plugins disabled. OpenCode may retry retryable provider failures inside that run, so more than one provider attempt can consume quota, incur cost, or be retained under OpenCode's and the provider's terms. The service bounds runtime and output, checks only for the expected sentinel, discards raw output, and stores mode-`0600` redacted outcome metadata. A pass proves access during that bounded run only. It does not qualify model quality, role fitness, reliability, pricing, or future availability and cannot promote benchmark evidence.

Configured provider authentication remains available to OpenCode. Before provider execution, the local isolation guard parses `auth.json` only to inspect credential-type metadata and rejects an unreadable/invalid store or a type that can load remote configuration. It does not extract individual secret fields, log them, place them in the isolated config, or transmit them.

## Routing boundaries

MCP tools become available to a model after OpenCode has selected that model, so MCP alone still does not choose the first provider call. The bundled local plugin handles the narrower attachment case inside OpenCode's pre-dispatch message hook by replacing only the model for an `omc-router` media turn. It is not a provider proxy, does not handle provider credentials, and does not route non-Omc-Router sessions.

Text-only routing and specialist delegation remain model-guided through the MCP policy and generated prompts. Media-only analysis is forcibly tool-free, while the explicit user-text code lane remains prompt-guided after the local authorization classifier retains Omc-Router. A route receipt is policy evidence, not proof that a model completed or correctly synthesized delegated work.

## Design invariants

- Unknown pricing is never automatically routed.
- Cost preference never overrides capability, availability, enablement, or an explicit compatible assignment.
- Live availability does not prove model quality or successful provider access.
- Benchmark evidence is versioned and reproducible; unrun evidence stays provisional.
- Only connector-owned OpenCode paths may be changed or removed.
- Only the primary receives model-control MCP tools; specialist delegation is non-recursive.
- Media routing never treats attachment content as authorization; only bounded, explicit user-authored text can retain Omc-Router, and all other media analysis is hard-denied tools and permissions.
- A manual runtime-access pass never becomes quality or benchmark evidence.
- Failure is explicit; there is no silent unknown-cost or unavailable fallback.
