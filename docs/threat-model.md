# Threat model

## Scope

This model covers the local control panel, settings, OpenCode CLI discovery, model routing policy, generated config, guarded config connection, and local MCP subprocess. It does not treat OpenCode, OpenCode Zen, OpenRouter, another provider, the browser, or a future gateway as trusted merely because they participate in the workflow.

## Assets

- Integrity and recoverability of the user's OpenCode configuration.
- Integrity of modality, cost-policy, and routing decisions.
- Local project files and command-execution authority.
- Provider credentials owned by OpenCode.
- User prompts, attachments, and provider responses.
- Benchmark, pricing, discovery, and availability evidence.
- Local settings, ownership receipt, backups, and process availability.

## Trust boundaries

1. Browser to loopback control service.
2. Control service to the local OpenCode CLI.
3. Connector to the user's OpenCode configuration.
4. OpenCode to remote model providers.
5. Primary model to specialist subagent sessions.
6. OpenCode primary to the local MCP subprocess.
7. Control service to OpenCode's local accounting database command.

## Threats and controls

| Threat | Impact | Current control |
| --- | --- | --- |
| Remote access to the control API | Settings or local information disclosure | Bind only to `127.0.0.1`; reject non-loopback host headers; do not support remote exposure. |
| Cross-site requests against loopback | Unauthorized settings or config mutation | Require trusted same-origin JSON mutation requests and a custom request header; emit restrictive security headers. |
| Browser-selected config launch target | Opening an arbitrary local file or invoking a shell | Open/Reveal accept an empty body only, resolve the config path inside the installer, require an absolute readable regular file, reject links, and execute fixed platform commands with `shell: false`. |
| Config overwrite or key collision | Lost user behavior or permissions | Own six exact paths, preserve unrelated JSONC, reject unreceipted collisions and changed managed entries. |
| Partial or concurrent connector transaction | Broken config, lost edits, or lost ownership state | Verify before write, hold a per-target lock, recheck the source snapshot, create a mode-`0600` backup, use atomic replacement, pair writes with a receipt, and roll back config if receipt commit fails. A full-config backup may contain credentials embedded by the user. |
| Malicious/special config file | Writes outside the expected target or parser confusion | Reject symlinks, nonregular/oversized files, invalid JSONC, duplicate keys, and unsafe keys. |
| Missing or substituted MCP command | Wrong executable or false healthy state | Canonicalize and validate absolute Node/CLI targets, complete the exact MCP handshake before write, and mark status unhealthy if either target disappears. |
| Prototype pollution or accessor execution | Process compromise or corrupted output | Reject unsafe keys, symbols, accessors, cycles, and non-plain objects before cloning. |
| Command injection through discovery | Arbitrary local command execution | Invoke a fixed `opencode` executable with fixed argument arrays, no shell, bounded timeout, and bounded output. |
| Usage query exposes private session content | Disclosure of prompts, responses, projects, or credentials | Use a fixed aggregate SQL projection through plugin-free OpenCode; select only accounting/model fields, allowlist time windows, cap process output and model rows, and send no raw message JSON or identifiers to the UI. |
| Missing or incompatible usage accounting appears as zero | Misleading cost/token history | Distinguish a compatible empty database from command/schema failures; reject malformed, negative, nonnumeric, or structurally incompatible accounting. |
| Plugin discovery stall | UI delay or missing catalog | Bound the process, retry plugin-free, label the snapshot incomplete, and retain the last usable catalog. |
| Upstream discovery normalizes project config | A non-routing `$schema` line appears outside the connector receipt | Disclose the observed OpenCode behavior; never claim or remove the upstream-owned field during Disconnect. Connector-owned entries still use guarded path-level writes. |
| Malicious catalog metadata | Misrouting or misleading output | Validate provider/model IDs, modalities, costs, roles, status, and sizes; new records stay routing-disabled. |
| Ambiguous price reported as zero | Unexpected charges | Do not trust arbitrary CLI zero as free; require independent exact-zero evidence or a verified positive price. Unknown is always blocked. |
| Paid preference enabled accidentally | Provider charges | Explicit Free/Paid user control, visible paid warnings, explicit model enablement, and no unknown-cost fallback. |
| Prompt injection in user content | Unsafe delegation or false claims | Keep authority in OpenCode, use bounded specialist prompts, and require separate authorization for consequential actions. Routing is not a sandbox. |
| MCP bridge overreach or recursion | Repeated delegation or enlarged tool authority | Expose bounded tools only to the primary; honor `direct` as stop; deny bridge tools and task delegation to specialists. |
| Text-only primary receives media task | Fabricated visual analysis | State the limitation and require direct attachment to the vision subagent. |
| Provider/model identity changes | Misrouting or unexpected terms | Refresh exact IDs, separate availability from runtime verification, and keep quality evidence versioned. |
| Sensitive data sent to a provider | Confidentiality loss | Do not equate local control or free pricing with local inference/private processing; do not request, extract, log, or transmit provider keys. |
| Benchmark poisoning or cherry-picking | False quality claims | Version fixtures and methodology, preserve failures, publish redacted raw results, and predeclare promotion gates. |
| Dependency compromise | Local code execution | Keep dependencies minimal and pinned, commit the lockfile, review updates, and run release verification/audit. |
| Denial of service | Unavailable UI or discovery | Bound request bodies, child-process time, and output; avoid retry storms and surface stale/incomplete status. |

## Security non-goals

- The local service is not a hardened remote or multi-user service.
- Connection status is not proof that a model provider can be invoked.
- Model output is not trusted code, and routing does not make tool execution safe.
- The project cannot guarantee provider privacy, uptime, pricing, retention, or entitlements.
- Prompt instructions do not enforce delegation depth as strongly as a host runtime or gateway.
- Backups and receipts protect against product mistakes, not a compromised local account.

## Future gateway review

A provider gateway would handle full prompts, attachments, streaming responses, routing, and possibly credentials. It requires a separate threat model covering credential storage, request authentication, SSRF, parser/decompression limits, streaming cancellation, log redaction, provider isolation, retry amplification, usage caps, update security, and tested uninstall/rollback.

## Residual risk

A compromised local account can alter settings, source, config, receipts, or backups. An upstream model can change behind a stable ID. OpenCode plugins can make discovery incomplete, and provider pricing can change after evidence was recorded. The project reduces accidental misconfiguration; it is not an operating-system, billing, or provider-security boundary.
