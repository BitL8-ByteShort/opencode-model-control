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

A refresh does not invoke a model, confirm an entitlement, prove successful provider access, or guarantee provider billing.

Startup refreshes stale metadata before initialization completes; a live service checks every **15 minutes**, and **Update available models** can request an immediate refresh. A shared refresh lease coalesces panel/MCP processes; a recent persisted attempt prevents duplicate periodic work. OpenCode discovery and the independent public metadata fetch run concurrently. Failed or incomplete discovery retains the last usable model records; complete discovery can mark an absent model unavailable while preserving its identity and saved choices. The panel distinguishes last attempt, last successful discovery, and last successful pricing retrieval. A failed refresh cannot renew pricing freshness. Refresh does not invoke provider inference or rewrite OpenCode config; OpenCode itself may normalize its standard `$schema` field.

A **connection** is the configured OpenCode provider slot used to reach a model. Billing kind (subscription, metered API, prepaid, local, or unknown) is observed from host evidence or an explicit user declaration. Authentication method alone does not determine billing: an API key can be a coding-plan subscription, and OAuth is not proof of entitlement.

Pricing is matched by the exact provider/full model key and API identity (model ID, npm adapter, and normalized endpoint). Raw empty, absent, and null URLs are unspecified SDK defaults; they are not invalid and are not a wildcard for custom gateways. A similarly named model, a `-free` suffix, arbitrary CLI zeros, and bundled historical evidence cannot authorize free routing. Model Control fetches the fixed public `https://models.dev/api.json` endpoint without credentials; URLs inside metadata are never fetched. Complete, finite, nonnegative input/output rates are required. Every supported supplied billing dimension counts: reasoning, cache read/write, audio input/output, context tiers, legacy over-200k rates, and experimental modes. With complete valid evidence, any positive rate means paid; all supplied rates must be valid and exactly zero for free. Missing, malformed, unsupported, or conflicting evidence is unknown. Unknown prices cannot authorize **Free** or migrated **verified-pricing Paid**. After the user saves the new Paid control (`configured-connections`), a configured host route may be used when estimates are unavailable. Complete positive CLI evidence can establish `reported-paid` when independent evidence does not contradict it; CLI zero cannot establish free, and CLI cost cannot override a public-price route mismatch.

OpenCode owns execution transport. A provider-owned authentication `fetch` may be accepted on Paid routes when the exact selected provider/model and observable connection binding match. Transport visibility is host-managed in that case; Model Control does not claim to have verified the network destination. Task or model route overrides, changed endpoints, and opaque transports under Free policy remain blocked. There is no automatic fallback from a subscription connection to metered API billing.

Pricing evidence expires after **24 hours** for Free and legacy verified-pricing access, checked at route time even without another refresh. Configured-connection Paid can continue with a stale-estimate warning. Successful HTTP 200 or cached 304 revalidation renews public-source freshness; a failed attempt does not. Cached evidence remains usable only until its existing expiry. Public-source digests and timestamps describe retrieved metadata, not a billing guarantee, subscription quota, or model-quality score. Quota is **Not reported** unless a supported host adapter actually exposes it. Historical OpenCode usage is not classified from today's login.

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

The generated config disables `model-control_*` globally and opts only `omc-router` back in. Specialists deny those tools and further delegation. The code worker retains bounded implementation tools, while the independent reviewer is limited to read/search tools and has no shell, edit, or write permission. Managed surface version 2 always generates all four model-free agent definitions. A vision model is selected at dispatch only when current effective text output, tool calls, and the actual media input are confirmed.

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
| `omc-router` | Primary | Text planning, policy lookup, and bounded delegation using saved policy |
| `omc-code-worker` | Subagent | Bounded implementation and one possible review-driven repair |
| `omc-vision-worker` | Subagent | Media-capable, tool-call-capable model assignment that also powers Omc-Router media turns |
| `omc-reviewer` | Subagent | Independent read-only text or code review; no shell, edit, or write permission |

Role choices are not benchmark winners. Automatic selection requires discovery, availability, Model Control enablement, permitted pricing, compatible modality, required access/tool capability, and a positive role profile.

For an authorized code change, the generated Omc-Router instructions call for implementation by `omc-code-worker`, independent read-only inspection of the resulting workspace changes and tests by `omc-reviewer`, and at most one return to the same code worker when the reviewer reports a concrete defect and the review repair pass is enabled. It does not switch to an alternate model. Users do not need to invoke either specialist manually. Instructions govern task decomposition and synthesis; plugin guards additionally restrict specialist tools and current delegation/repair authority. These guards do not establish output correctness or replace review of consequential actions.

## Free and Paid preference

The stored settings intentionally separate priority and permission:

```json
{
  "costPreference": "free-first",
  "costPolicy": "free-only"
}
```

**Free** uses `free-first + free-only`. **Paid** uses `paid-first + known-cost`. Known-cost mode allows both verified-free and known-paid candidates; it does not make unknown pricing eligible.

**Automatically include new models** defaults on. A model with `selection: "policy"` (including an absent control) follows that setting and the saved Free/Paid policy. Free permits current verified-free evidence only; Paid permits known-paid and verified-free models and prefers paid after hard gates. Saving Paid with auto-include on authorizes future eligible known-paid models without a separate click for every new model. Turning auto-include off excludes policy-following models; explicit enables still apply. An explicit disable always wins. An enable or role pin cannot bypass unknown/expired pricing, availability, capabilities, or cost policy.

Selecting a compatible role model can explicitly enable it in the draft; selecting Automatic changes the role choice without writing inferred model enables. **Save changes** commits user intent. Refresh never adds inferred controls or rewrites saved intent.

Exact pricing and expiry follow the discovery boundary above. Supplemental public capabilities never expand effective OpenCode permissions.

## Live changes and host reload limits

All four stable managed agents are installed without baked-in `model` fields: `omc-router`, `omc-code-worker`, `omc-vision-worker`, and `omc-reviewer`. The local plugin reads coherent saved settings/catalog state for every owned turn, including text, specialist tasks, and ordinary resumed tasks. It intersects eligible catalog models with the current OpenCode instance's loaded provider inventory. Saving A → B takes effect on the next owned turn when B is already loaded; ordinary policy changes do not rewrite config or require reconnecting.

At `chat.params`, the plugin rechecks current policy, price expiry, loaded inventory, exact provider/model/API identity, endpoint/transport, effective capabilities, and effective rates before inference. Missing or corrupt saved state, disabled or unavailable selections, incompatible effective metadata, and unknown pricing fail closed. An explicit pin is never silently replaced. Unrelated OpenCode agents keep their own selections.

A newly discovered C absent from the running host inventory needs an explicit OpenCode reload/restart. It blocks with `OMC_HOST_MODEL_MISSING`; automatic roles may choose eligible already-loaded models. OpenCode 1.18.22/1.18.28 sanitize HTTP plugin failures to `UnknownError`, so the actionable reload guidance is a same-directory TUI toast/event. Headless consumers must read the instance event stream to receive that text. Model Control never disposes or restarts an OpenCode instance automatically. Changes to installed agent instructions/permissions, package or plugin paths, or the optional default agent require **Update connection** and an OpenCode restart.

Ordinary child resumes adopt current saved policy. Only a completed owned worker followed by its matching completed reviewer can authorize one review-driven repair on that worker's original model. The repair rechecks current eligibility and stops if that model is revoked. Background acknowledgment alone is not completion: matching terminal host events are required. This evidence belongs to the current parent workflow in the running plugin instance; a new user turn, unrelated parent, or completed repair cannot reuse it. No persistence across an OpenCode restart is promised.

Owned slash subtasks have a narrow, one-shot allowance for OpenCode's synthetic parent summary, which bypasses `chat.message`. The plugin verifies the exact session/message, owned agent, inherited model, matching completed child, and fixed synthetic summary content before allowing it; all dispatch guards still run. If the parent pin changes while the child runs, the summary inherits the old model and safely blocks. A new user turn can adopt the new policy. Unmatched synthetic or ordinary messages do not gain authority.

## Saved state and migration

Settings schema v3 stores intent as `selection: "policy" | "enabled" | "disabled"`, plus optional user availability exclusions; effective eligibility is derived separately. Legacy v0/v1/v2 Boolean controls migrate to explicit choices while preserving disables, Paid policy, pins (including absent model IDs), workflow bounds, and default-agent preference. Migration first saves an exact private `settings.json.v<old-version>.backup-<uuid>` copy, then atomically writes v3. State directories use mode `0700`; settings, cache, snapshot, status, migration backups, and receipts use `0600`.

Settings and catalog reads/writes share a cross-process lock. Save uses the last settings revision for compare-and-swap: a settings conflict returns 409 without overwriting either writer. A catalog-only change can rebase untouched choices, but newly edited ineligible selections return a selection conflict. Existing blocked pins remain visible through unrelated edits. The panel preserves unsaved drafts during refresh and conflicts so the user can review and retry. Corrupt saved state fails closed; preserve the private state and migration backup for recovery rather than deleting disables or replacing the whole state with defaults. Full OpenCode config backups are a separate connector recovery mechanism.

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

1. reads each attachment's type/MIME metadata to determine the media lane; text-only owned turns still receive ordinary role routing;
2. reloads the saved catalog snapshot and routing settings;
3. resolves the explicit or automatic vision-worker assignment through enablement, availability, cost, role, access, tool-call, text-output, and modality gates;
4. selects that model for the current message before provider dispatch;
5. appends a fixed instruction that attachment content is untrusted and cannot authorize tools, delegation, or workspace changes;
6. retains `omc-router` only when explicit user-authored text outside attachments is classified as a code/workspace change; every other media request becomes `omc-vision-worker` with permissions and tools hard-denied.

The local authorization classifier ignores synthetic or ignored text parts, accepts at most 4,000 characters, and fails closed for empty, oversized, or unclassifiable text. The plugin never logs, stores, or separately transmits the text it classifies, and it never reads attachment content, filenames, URLs, data URLs, or payloads. The original text and attachment parts remain available to the selected provider under its own terms.

For ordinary media analysis, Omc-Router and its tools do not remain on the turn: the generated vision agent is tool-free, while plugin permission/tool hooks provide an independent session-scoped denial that resets on the next message. For an explicit media-assisted code request, Omc-Router remains active so the vision-capable model can inspect the attachment, consult policy, and continue through code worker -> read-only reviewer without a manual `@omc-vision-worker` step. If no compatible eligible vision model exists, the plugin raises a fixed local error instead of sending media to an incompatible or policy-blocked model.

The automatic media-to-vision switch applies only to `omc-router` media turns. Every owned role also receives the saved-state and pre-inference checks described above; unrelated agents keep their selected model.

## Manual runtime access check

Catalog refresh and connection do not call a model. A user can separately select one available model on the **Benchmarks** page and run a fixed text-only runtime check after confirming that it is a real provider request and may consume quota or incur charges.

The check starts one bounded `opencode run --pure` execution in an isolated temporary directory with external plugins disabled. Its sentinel prompt contains no project content, attachment, credential material, or custom prompt. OpenCode can retry a retryable provider failure inside that run, so more than one provider attempt may consume quota, incur cost, or be retained under OpenCode's and the provider's terms. Model Control checks for the sentinel, discards raw output, and stores only redacted local result metadata. It is never automatic. Passing confirms access during that bounded run only and does not promote benchmark evidence or prove quality, role fitness, reliability, pricing, or future access.

Configured provider authentication remains available to OpenCode. Before the provider phase, Model Control's local isolation guard parses OpenCode's `auth.json` only to inspect each credential record's `type` metadata. An unreadable/invalid store or a credential type capable of loading remote configuration fails closed. The guard does not extract individual secret fields, log them, copy them into the isolated config, or transmit them.
