# OpenCode integration

## User flow

A normal user should not edit OpenCode JSON:

1. Start OpenCode Model Control.
2. Update available models and save the routing policy.
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

This is an OpenCode integration, not a direct OpenRouter integration. OpenCode owns provider authentication and determines which providers/models its resolved configuration exposes. Model Control does not request, extract, log, or transmit provider API keys. The connector does parse the local OpenCode config to preserve unrelated settings, and its full-config backup can contain a key if the user embedded one there.

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

The connector does not add provider configuration, API keys, or `default_agent`. It disables `model-control_*` globally and opts only `omc-router` back in. Specialists deny those tools and further delegation.

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
- validates and canonicalizes the exact Node and package CLI paths, then completes an isolated MCP initialize/tool-list handshake before writing;
- holds an exclusive per-target transaction lock and rechecks the original config snapshot immediately before an install or disconnect write;
- creates a mode-`0600` backup when a config already exists;
- atomically replaces the config and writes a mode-`0600` ownership receipt;
- rolls the config back if the paired receipt write fails.

Connection status means the receipt-owned entries still exactly match the installed values and both managed command targets still exist and are accessible. It does not mean a provider model was invoked.

After connecting or updating a connection, restart OpenCode so a new process loads the changes.

## Disconnect and recovery

Use **Disconnect** or `opencode-model-control disconnect --yes`, then restart OpenCode. Disconnect removes only receipt-owned values and refuses to overwrite a managed value that changed elsewhere.

Rollback is automatic inside a failed connection transaction: if the paired ownership-receipt operation fails after the config write, the connector restores the previous config. Model Control intentionally does not expose a general command that copies an arbitrary old full-config backup over current settings. That could erase unrelated changes made after the backup.

If automatic rollback reports that it could not restore the config, stop making changes and preserve the newest adjacent `.omc-backup-*.bak` file. Follow the exact recovery path printed by the connector. The backup and receipt are mode `0600`; a backup is still a complete config copy and may contain embedded credentials.

## Generated team

| Agent | Mode | Initial intent |
| --- | --- | --- |
| `omc-router` | Primary | Text planning and bounded delegation; Big Pickle by default |
| `omc-code-worker` | Subagent | Text implementation tasks |
| `omc-vision-worker` | Subagent | Image-capable analysis; returns text |
| `omc-reviewer` | Subagent | Independent text or code review |

Initial assignments are not benchmark winners. Automatic selection requires discovery, availability, Model Control enablement, permitted pricing, compatible modality, required access/tool capability, and a positive role profile.

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

Open and Reveal are trusted same-origin JSON mutations because they launch a local application. Their request body must be an empty object: the browser cannot supply or override a path. The server resolves the path internally, requires an absolute readable regular file, rejects links, and invokes fixed platform commands with argument arrays and `shell: false`.

The panel intentionally does not provide a raw config writer. Developers may edit the opened file with their preferred tool. If an owned entry changes, connection health becomes **Needs attention**, and Model Control refuses to overwrite the change. The pure generator keeps unrelated config values and rejects collisions in memory; the guarded connector remains the only component authorized to apply managed paths automatically.

## First-model limitation

The stock sequence is:

1. OpenCode selects the session's primary model.
2. OpenCode transforms the request for that model's supported modalities.
3. The selected model receives the request and may then call MCP tools or subagents.

MCP participates at step 3. It cannot pick the first model. Big Pickle therefore cannot transparently pass along an image OpenCode omitted before calling it; attach the original media directly to `@omc-vision-worker`.

The pinned public plugin contract also receives an already selected model and does not expose a supported model-replacement return value. True pre-first-call routing requires the separately reviewed optional gateway, which is not included in the current project.
