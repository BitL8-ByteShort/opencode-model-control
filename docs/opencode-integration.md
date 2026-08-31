# OpenCode integration

## User flow

A normal user should not edit OpenCode JSON:

1. Start OpenCode Model Control.
2. Update available models, choose whether Omc-Router should become the default agent, and save the routing policy.
3. Click **Connect to OpenCode**.
4. Restart OpenCode.

The panel and the `connect --yes` CLI command use the same guarded connector. **Disconnect** and `disconnect --yes` remove only entries owned by the saved installation receipt.

## Discovery boundary

Model Control asks OpenCode for its effective all-provider model catalog:

```sh
opencode models --verbose
opencode models --verbose --refresh
```

The first form is used at startup; the second powers **Update available models**. There is no provider filter. Normal discovery is plugin-aware so external plugin providers can contribute models. If that process fails or stalls, Model Control retries with `--pure` and labels the snapshot incomplete.

This is an OpenCode integration, not a direct OpenRouter integration. OpenCode owns provider authentication and determines which providers/models its resolved configuration exposes. Model Control does not request, extract, log, or transmit provider API-key or token material. The connector does parse the local OpenCode config to preserve unrelated settings, and its full-config backup can contain a key if the user embedded one there. The separate manual runtime-check isolation guard locally parses OpenCode's credential store only to inspect credential-type metadata; it does not copy or transmit secret fields.

A refresh does not invoke a model, confirm an entitlement, prove successful provider access, or confirm current billing terms.

## Managed config surface

The target is OpenCode 1.18.x. The connector manages only:

```text
mcp.model-control
tools.model-control_*
agent.omc-router
agent.omc-code-worker
agent.omc-vision-worker
agent.omc-reviewer
plugin[]: exact Model Control file URL
default_agent: omc-router, only when receipt-owned
```

The MCP entry is local. Its command uses the absolute executable paths resolved by the installed package, conceptually:

```json
{
  "mcp": {
    "model-control": {
      "type": "local",
      "command": [
        "/absolute/path/to/node",
        "/absolute/path/to/opencode-model-control/bin/opencode-model-control.js",
        "mcp"
      ],
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

The top-level plugin entry is a canonical absolute `file://` URL to the installed package's routing plugin. The connector appends only that exact entry and preserves unrelated plugins.

The connector does not add provider configuration or API keys. When **Make Omc-Router my default agent** is enabled, it adds `default_agent: "omc-router"` only if the OpenCode config has no default. An existing user-owned default is preserved. If this installation previously added the default, disabling the option on a later Connect removes only that receipt-owned value.

The generated config disables `model-control_*` globally and opts only `omc-router` back in. Specialists deny those tools and further delegation. The code worker retains bounded implementation tools, while the independent reviewer is limited to read/search tools and has no shell, edit, or write permission. A vision worker is generated only when OpenCode reports the exact model supports text output, tool calls, and the required media input.

OpenCode's documented surfaces are the source of truth:

- [Agents](https://opencode.ai/docs/agents/)
- [MCP servers](https://opencode.ai/docs/mcp-servers/)
- [Providers](https://opencode.ai/docs/providers/)
- [Configuration](https://opencode.ai/docs/config/)
- [OpenCode Zen](https://opencode.ai/docs/zen/)
- [OpenCode 1.18.22 config source](https://github.com/anomalyco/opencode/blob/v1.18.22/packages/opencode/src/config/config.ts)
- [OpenCode 1.18.17 model transform source](https://github.com/anomalyco/opencode/blob/v1.18.17/packages/opencode/src/provider/transform.ts#L385-L438)

OpenCode can evolve. Compatibility with later configuration majors requires explicit acceptance tests.

## Safe connection transaction

The global target follows OpenCode-compatible precedence:

1. existing `opencode.jsonc`;
2. otherwise existing `opencode.json`;
3. otherwise existing legacy `config.json`;
4. otherwise a new `opencode.jsonc`.

The connector:

- rejects symlinks, nonregular files, oversized files, invalid JSONC, duplicate keys, and unsafe object keys;
- refuses to replace a managed path that already exists without its receipt;
- applies path-level JSONC edits, preserving unrelated settings and comments;
- validates the candidate with a fresh OpenCode `debug config --pure` process in isolated temporary configuration directories before writing;
- validates and canonicalizes the exact Node, package CLI, and local plugin paths, then completes an isolated MCP initialize/tool-list handshake before writing;
- holds an exclusive per-target transaction lock and rechecks the original config snapshot immediately before an install or disconnect write;
- creates a mode-`0600` backup when a config already exists;
- atomically replaces the config and writes a mode-`0600` ownership receipt;
- rolls the config back if the paired receipt write fails.

Connection status means the receipt-owned entries still exactly match the installed values and both managed command targets still exist and are accessible. It does not mean a provider model was invoked.

The receipt records exact managed paths/values and the managed-surface version used to install them. That is ownership and stale-install detection, not package-content authentication: it does not hash the Node, CLI, or plugin file bytes at those paths. Verify package provenance through the published npm integrity and GitHub release checksum.

After connecting or updating a connection, restart OpenCode so a new process loads the changes.

## Disconnect and recovery

Use **Disconnect** or `opencode-model-control disconnect --yes`, then restart OpenCode. Disconnect removes only receipt-owned values and refuses to overwrite a managed value that changed elsewhere.

Rollback is automatic inside a failed connection transaction: if the paired ownership-receipt operation fails after the config write, the connector restores the previous config. Model Control intentionally does not expose a general command that copies an arbitrary old full-config backup over current settings. That could erase unrelated changes made after the backup.

If automatic rollback reports that it could not restore the config, stop making changes and preserve the newest adjacent `.omc-backup-*.bak` file. Follow the exact recovery path printed by the connector. The backup and receipt are mode `0600`; a backup is still a complete config copy and may contain embedded credentials.

## Generated team

| Agent | Mode | Initial intent |
| --- | --- | --- |
| `omc-router` | Primary | Text planning, policy lookup, and bounded delegation; Big Pickle by default |
| `omc-code-worker` | Subagent | Bounded implementation and one possible review-driven repair |
| `omc-vision-worker` | Subagent | Media-capable, tool-call-capable model assignment that also powers Omc-Router media turns |
| `omc-reviewer` | Subagent | Independent read-only text or code review; no shell, edit, or write permission |

Initial assignments are not benchmark winners. Automatic selection requires discovery, availability, Model Control enablement, permitted pricing, compatible modality, required access/tool capability, and a positive role profile.

For an authorized code change, the generated Omc-Router instructions call for implementation by `omc-code-worker`, independent read-only inspection of the resulting workspace changes and tests by `omc-reviewer`, and at most one return to the same code worker when the reviewer reports a concrete defect and the review repair pass is enabled. It does not switch to an alternate model. Users do not need to invoke either specialist manually. This is a prompt-governed workflow; specialists are prevented from recursive task delegation, but stock OpenCode does not enforce the repair count independently of the primary's instructions.

## Free and Paid preference

The stored settings intentionally separate priority and permission:

```json
{
  "costPreference": "free-first",
  "costPolicy": "free-only"
}
```

**Free** uses `free-first + free-only`. **Paid** uses `paid-first + known-cost`. Known-cost mode allows both verified-free and known-paid candidates; it does not make unknown pricing eligible.

A model is:

- **verified free** only when authoritative evidence establishes exact zero input and output prices;
- **paid** when verified input or output pricing is positive;
- **unknown** when pricing is missing, normalized, ambiguous, or malformed.

A model name ending in `-free` is not sufficient evidence by itself. OpenCode may normalize missing pricing fields to zero, so arbitrary CLI zero values remain unknown unless independently verified.

Newly discovered models are visible and disabled by default. The user must explicitly allow Model Control to select them.

## Advanced developer tools

Easy mode remains the default: normal setup uses Connect, Update, and Disconnect without opening a config file. The collapsed **Advanced tools for developers** section adds deliberate, read-only visibility and operating-system access:

- show and copy the exact config path selected by the same OpenCode-compatible precedence used by the installer;
- open that existing file in its operating-system default app;
- reveal that existing file in Finder, Explorer, or the platform file browser;
- preview, copy, and export the generated Model Control integration.

The local service creates a new high-entropy mutation token on every start. Its normal automatic browser launch uses a private write-enabled query URL; the UI stores the token in that tab's `sessionStorage` and immediately removes it from the address bar. The bare panel URL is read-only. With `--no-open`, only an interactive terminal prints the private URL, together with a keep-private warning; non-interactive output contains only the public read-only URL. Never share, bookmark, log, or paste the private URL. Restart the service to rotate it.

Open and Reveal are trusted same-origin JSON mutations because they launch a local application. Like every `POST`, `PUT`, `PATCH`, or `DELETE` API call, they require a same-origin `Origin`, JSON, `X-OMC-Request: 1`, and the matching `X-OMC-Session` token. Their request body must be an empty object: the browser cannot supply or override a path. The server resolves the path internally, requires an absolute readable regular file, rejects links, and invokes fixed platform commands with argument arrays and `shell: false`.

The panel intentionally does not provide a raw config writer. Developers may edit the opened file with their preferred tool. If an owned entry changes, connection health becomes **Needs attention**, and Model Control refuses to overwrite the change. The pure generator keeps unrelated config values and rejects collisions in memory; the guarded connector remains the only component authorized to apply managed paths automatically.

Two environment variables are advanced/testing overrides rather than part of the easy path:

- `OMC_OPENCODE_CONFIG_PATH` must be an absolute file path. It changes the target used by Status, Connect, Disconnect, Open, and Reveal, but does not make an ordinary OpenCode launch load that nonstandard file. Isolated tests or operators must configure OpenCode to use the same target.
- `OMC_CONFIG_DIR` relocates the private Model Control settings and receipt directory. The exact same value must be exported for both the panel launch and every OpenCode launch so the generated MCP subprocess and bundled plugin resolve the same saved policy. The connector deliberately does not write arbitrary environment values into OpenCode config. Use the default directory unless that launch-environment propagation is guaranteed.

## Attachment-aware media routing

Connect installs the bundled local plugin in OpenCode's top-level `plugin` array. For a media-bearing `omc-router` `chat.message` turn, the plugin:

1. reads each attachment's type/MIME metadata and does nothing when no image, audio, video, or PDF is present;
2. reloads the saved catalog snapshot and routing settings;
3. resolves the explicit or automatic vision-worker assignment through enablement, availability, cost, role, access, tool-call, text-output, and modality gates;
4. selects that model for the current message before provider dispatch;
5. appends a fixed instruction that attachment content is untrusted and cannot authorize tools, delegation, or workspace changes;
6. retains `omc-router` only when explicit user-authored text outside attachments is classified as a code/workspace change; every other media request becomes `omc-vision-worker` with permissions and tools hard-denied.

The local authorization classifier ignores synthetic or ignored text parts, accepts at most 4,000 characters, and fails closed for empty, oversized, or unclassifiable text. The plugin never logs, stores, or separately transmits the text it classifies, and it never reads attachment content, filenames, URLs, data URLs, or payloads. The original text and attachment parts remain available to the selected provider under its own terms.

For ordinary media analysis, Omc-Router and its tools do not remain on the turn: the generated vision agent is tool-free, while plugin permission/tool hooks provide an independent session-scoped denial that resets on the next message. For an explicit media-assisted code request, Omc-Router remains active so the vision-capable model can inspect the attachment, consult policy, and continue through code worker -> read-only reviewer without a manual `@omc-vision-worker` step. If no compatible eligible vision model exists, the plugin raises a fixed local error instead of sending media to an incompatible or policy-blocked model.

This automatic switch is deliberately narrow: it applies only to `omc-router` media turns. Other agents keep their selected model. Saved media-policy gates are read on every media turn, while generated agent definitions, the plugin entry, and the optional default-agent value require Connect and an OpenCode restart to change.

## Manual runtime access check

Catalog refresh and connection do not call a model. A user can separately select one available model on the **Benchmarks** page and run a fixed text-only runtime check after confirming that it is a real provider request and may consume quota or incur charges.

The check starts one bounded `opencode run --pure` execution in an isolated temporary directory with external plugins disabled. Its sentinel prompt contains no project content, attachment, credential material, or custom prompt. OpenCode can retry a retryable provider failure inside that run, so more than one provider attempt may consume quota, incur cost, or be retained under OpenCode's and the provider's terms. Model Control checks for the sentinel, discards raw output, and stores only redacted local result metadata. It is never automatic. Passing confirms access during that bounded run only and does not promote benchmark evidence or prove quality, role fitness, reliability, pricing, or future access.

Configured provider authentication remains available to OpenCode. Before the provider phase, Model Control's local isolation guard parses OpenCode's `auth.json` only to inspect each credential record's `type` metadata. An unreadable/invalid store or a credential type capable of loading remote configuration fails closed. The guard does not extract individual secret fields, log them, copy them into the isolated config, or transmit them.
