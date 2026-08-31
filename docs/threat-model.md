# Threat model

## Scope

This model covers the local control panel, settings, OpenCode CLI discovery, model routing policy, generated config, guarded config connection, local media-routing plugin, local MCP subprocess, usage aggregation, and manual runtime access checks. It does not treat OpenCode, OpenCode Zen, OpenRouter, another provider, or the browser as trusted merely because they participate in the workflow.

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
8. OpenCode's local message hook to the selected provider model.
9. Explicit runtime access check to OpenCode and the selected provider.

## Threats and controls

| Threat | Impact | Current control |
| --- | --- | --- |
| Remote access to the control API | Settings or local information disclosure | Bind only to `127.0.0.1`; reject non-loopback host headers; do not support remote exposure. |
| Cross-site or same-host requests against loopback | Unauthorized settings, provider checks, local application launch, or config mutation | Create a high-entropy token per server process; deliver it only through the private launch URL; store it in tab-scoped `sessionStorage`; immediately scrub it from the address bar; and require same-origin `Origin`, JSON, `X-OMC-Request: 1`, and the matching `X-OMC-Session` value on every `POST`, `PUT`, `PATCH`, or `DELETE`. A bare-URL tab is read-only. Restrictive response headers provide an additional boundary. |
| Mutation token disclosure | Another local process or person can authorize panel changes for the life of that server process | Never print the token in non-interactive output; label the interactive `--no-open` URL keep-private; do not log or persist it; keep it in `sessionStorage`; and rotate it on every server restart. Users must not share, bookmark, or paste the private URL. |
| Browser-selected config launch target | Opening an arbitrary local file or invoking a shell | Open/Reveal accept an empty body only, resolve the config path inside the installer, require an absolute readable regular file, reject links, and execute fixed platform commands with `shell: false`. |
| Config overwrite or key collision | Lost user behavior or permissions | Own only documented exact entries, preserve unrelated JSONC and plugins, reject unreceipted collisions and changed managed entries, and never claim a user-owned default agent. |
| Partial or concurrent connector transaction | Broken config, lost edits, or lost ownership state | Verify before write, hold a per-target lock, recheck the source snapshot, create a mode-`0600` backup, use atomic replacement, pair writes with a receipt, and roll back config if receipt commit fails. A full-config backup may contain credentials embedded by the user. The receipt records managed ownership/version, not package-content authenticity. |
| Malicious/special config file | Writes outside the expected target or parser confusion | Reject symlinks, nonregular/oversized files, invalid JSONC, duplicate keys, and unsafe keys. |
| Missing or substituted MCP command | Wrong executable or false healthy state | Canonicalize and validate absolute Node/CLI targets, complete the exact MCP handshake before write, and mark status unhealthy if either target disappears. |
| Missing or substituted local routing plugin | Media reaches an incompatible model or false healthy state | Store a canonical absolute `file://` entry, validate its readable real path, receipt-own only the exact plugin item, and mark connection status unhealthy if the target disappears. |
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
| Media reaches a text-only, tool-incapable, or policy-blocked model | Failed input handling, fabricated analysis, or unexpected cost | On media turns entering through `omc-router`, require every modality plus text-output and tool-call capability, reload the saved policy, select the compatible vision model before dispatch, and fail closed when no safe candidate exists. |
| Attachment prompt injection grants tool or workspace authority | Unauthorized delegation, command execution, or file mutation | Treat attachment content as untrusted in a fixed system instruction. Only bounded nonsynthetic/nonignored user text outside attachments can authorize the code lane; otherwise change to the tool-free vision worker and deny both permission requests and tool execution until the next turn. |
| Media authorization classification leaks user content | Disclosure of user text or attachments | Read at most 4,000 characters of explicit user-authored text only for local write-intent classification; never log, store, or separately transmit it. Never read attachment content, filenames, URLs, data URLs, or payloads; the chosen provider remains a separate disclosed inference boundary. |
| Automatic code workflow loops, trusts its own output, or gives review mutation authority | Excessive calls or unreviewed defects | Require policy selection, code-worker implementation, an independent read-only reviewer with no shell/edit/write permission, at most one review-driven repair, and non-recursive specialists; disclose that the cycle ceiling is prompt-level. |
| Provider/model identity changes | Misrouting or unexpected terms | Refresh exact IDs, separate availability from one-off runtime access, and keep quality evidence versioned. |
| Sensitive data sent to a provider | Confidentiality loss | Do not equate local control or free pricing with local inference/private processing; do not request, extract, log, or transmit provider secret material. The runtime isolation guard may inspect credential-type metadata locally without copying secret fields. |
| Runtime check runs unexpectedly or is mistaken for quality evidence | Charges, provider disclosure, or misleading claims | Never run automatically; require two explicit acknowledgements, use one bounded isolated OpenCode run with a fixed synthetic prompt, disclose that OpenCode may retry and each provider attempt can incur quota/cost/retention, discard raw output, store redacted metadata, and prevent results from promoting benchmark status. |
| Runtime isolation inherits unsafe remote configuration | Project/customer content or tools enter the synthetic check | Isolate config/cache/state/database/project paths, disable instructions/plugins/MCP/tools, verify the resolved config before provider execution, and locally inspect credential-type metadata so credentials capable of loading remote config fail closed. Do not extract, log, copy, or transmit secret fields. |
| Advanced path overrides diverge across processes | Connector updates one config or policy while OpenCode/MCP/plugin uses another | Treat `OMC_OPENCODE_CONFIG_PATH` and `OMC_CONFIG_DIR` as advanced/testing options; require the operator to configure OpenCode for the same config target and propagate the same private-state directory to panel and OpenCode launches. Prefer defaults when propagation is uncertain. |
| Benchmark poisoning or cherry-picking | False quality claims | Version fixtures and methodology, preserve failures, publish redacted raw results, and predeclare promotion gates. |
| Dependency compromise | Local code execution | Keep dependencies minimal and pinned, commit the lockfile, review updates, and run release verification/audit. |
| Denial of service | Unavailable UI or discovery | Bound request bodies, child-process time, and output; avoid retry storms and surface stale/incomplete status. |

## Security non-goals

- The per-process mutation token is not user identity or a hardened remote/multi-user authentication system.
- The local service is not a hardened remote or multi-user service.
- Connection status is not proof that a model provider can be invoked.
- Model output is not trusted code, and routing does not make tool execution safe.
- The project cannot guarantee provider privacy, uptime, pricing, retention, or entitlements.
- Prompt instructions do not enforce delegation and repair counts as strongly as a dedicated host runtime counter.
- Backups and receipts protect against product mistakes, not a compromised local account.

## Residual risk

A compromised local account can alter settings, source, config, receipts, or backups. An upstream model can change behind a stable ID. OpenCode plugins can make discovery incomplete, and provider pricing can change after evidence was recorded. The project reduces accidental misconfiguration; it is not an operating-system, billing, or provider-security boundary.
