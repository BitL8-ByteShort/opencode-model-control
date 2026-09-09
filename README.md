# OpenCode Model Control

![OpenCode Model Control — Route smarter. Stay in control.](https://raw.githubusercontent.com/BitL8-ByteShort/opencode-model-control/v0.2.1/docs/assets/opencode-model-control-banner.png)

OpenCode Model Control is a local control panel and MCP companion for building a model team inside OpenCode. It discovers the models OpenCode currently exposes, lets the user decide which ones the router may use, assigns an orchestrator and specialist roles, and safely connects that policy to OpenCode.

The control panel runs on `127.0.0.1`. OpenCode remains responsible for provider authentication and model calls. Model Control does not request, extract, log, or transmit API-key or token material and does not connect directly to OpenRouter. Its guarded connector does read the local OpenCode config so it can preserve unrelated settings and create a private full-config backup. Before a manual runtime check, the local isolation guard also parses OpenCode's credential store only to inspect credential-type metadata; it does not copy secret fields into the check configuration or send them anywhere.

The running app is authoritative for model names, availability, pricing evidence, and role eligibility.

> This source documents **0.4.0**; `@latest` installs the version currently published on [npm](https://www.npmjs.com/package/opencode-model-control). Check the [release index](https://github.com/BitL8-ByteShort/opencode-model-control/releases) for availability and the [support matrix](docs/support-matrix.md) for verified compatibility. 0.4.0 is implemented in this tree; public publication is a separate authorized gate.

## What it does

- Reads OpenCode's resolved, all-provider model catalog rather than relying on a fixed list.
- Provides an **Update available models** action that runs a fresh OpenCode catalog refresh.
- Separates discovery, saved inclusion intent, and effective eligibility. Auto-include defaults on and follows the saved cost policy; explicit disables remain authoritative.
- Provides a **Free / Paid** preference:
  - **Free** permits only independently verified zero-cost models.
  - **Paid** permits verified free and known paid models, prioritizing paid models for compatible automatic assignments.
  - Unknown or ambiguous pricing is always shown as **Unknown — blocked**.
- Resolves the orchestrator, code, vision, and review roles from current eligible models without a fixed free-model roster or new quality ranking.
- Transparently sends media-only analysis through the saved compatible, tool-free vision worker. Only explicit user-authored text classified as a code change keeps Omc-Router active for a seamless vision-to-code-to-review workflow.
- Automatically routes approved code changes through a code worker, an independent reviewer, and at most one repair pass without requiring `@` mentions.
- Connects to OpenCode without requiring the user to edit JSON.
- Can make Omc-Router the OpenCode default when no user default exists; an existing user-selected default is preserved.
- Preserves unrelated OpenCode configuration, plugins, and JSONC comments, rejects ownership or concurrent-edit conflicts, creates a mode-`0600` backup and receipt, and verifies both the proposed OpenCode config and exact MCP handshake before writing it.
- Exposes a local MCP bridge so the selected orchestrator can consult the current routing policy before delegating.
- Provides a manual, explicitly confirmed runtime access check that starts one bounded synthetic OpenCode run. OpenCode may retry a retryable provider failure, so each provider attempt can consume quota, incur cost, or be retained under OpenCode's and the provider's terms; the result is never presented as a quality benchmark.
- Reports local, aggregate OpenCode token and recorded-cost history without reading prompts or credentials.
- Keeps benchmark claims honest: an available model is not called “best” until repeatable evidence qualifies it.
- Uses a full-width responsive layout with a collapsible desktop sidebar and a mobile navigation drawer.

## Prerequisites

- [OpenCode](https://opencode.ai/docs/) 1.18.x installed and available as `opencode`.
- Node.js `>=22.12.0`; use a currently supported Node.js 22 or 24 LTS release.
- npm, which is included with Node.js.

Check the two required programs before setup:

```sh
opencode --version
node --version
```

The panel can open without OpenCode, but it cannot discover the user's current models or connect the managed MCP integration until the OpenCode CLI is available.

## Install

Install the current published npm version:

```sh
npm install --global opencode-model-control@latest
opencode-model-control
```

The first command installs the version tagged `latest` on npm and its runtime dependencies. Check `opencode-model-control --version` against the public release notes; an older published version may not include the 0.3.0 behavior described here. The second command starts the local panel and opens it in the default browser.

Then:

1. Click **Update available models** to read the models currently exposed by OpenCode.
2. Choose **Free** or **Paid**, review **Automatically include new models**, and keep or override each model’s Policy choice. Select Automatic or a compatible model for each role, choose whether Omc-Router should become the default agent, then save.
3. Click **Connect to OpenCode**.
4. Restart OpenCode so it loads the managed MCP, local routing plugin, and `omc-*` agents.

No JSON editing is required. Connect creates a private backup, safely merges only its owned configuration, validates OpenCode and the MCP handshake, and rolls back if the transaction cannot complete.

### Upgrade an existing install

Close OpenCode and stop the running Model Control process with `Ctrl+C`, then run:

```sh
npm install --global opencode-model-control@latest
opencode-model-control --version
opencode-model-control
```

Confirm the version command matches the current published release. In the reopened panel, click **Update available models**, review the Free/Paid preference and enabled models, click **Save changes**, then click **Update connection**. If the panel says it is disconnected, use **Connect to OpenCode** instead. Restart OpenCode and verify the managed connection:

```sh
opencode-model-control status --json
```

The update is in place when the JSON reports `"installed": true`, `"healthy": true`, `"requiresAttention": false`, and `"code": "INSTALLED"`. A Node version manager such as nvm or Volta avoids global-install permission problems; do not add `sudo` when npm is already installed in your user account.

## Run from a source checkout

From the project directory, run:

```sh
npm ci
npm run verify
npm start
```

Then:

1. Open the local panel (normally `http://127.0.0.1:47821`).
2. Click **Update available models** to re-read all models exposed by OpenCode's resolved provider configuration.
3. Choose **Free** or **Paid**, review **Automatically include new models**, and keep or override each model’s Policy choice. Select Automatic or a compatible model for each role, choose whether Omc-Router should become the default agent, then save.
4. Click **Connect to OpenCode**.
5. Restart OpenCode so it loads the managed MCP, local routing plugin, and `omc-*` agents.

The connector writes absolute Node and package CLI paths, so a source checkout does not require `npm link`. Keep the checkout in the same location while connected. If it is moved or deleted, start it from the new location and reconnect before restarting OpenCode.

`npm start` opens the panel with a private, write-enabled launch URL. The app immediately moves that per-process session token into the tab's `sessionStorage` and removes it from the address bar. A tab opened from the bare `http://127.0.0.1:47821` URL remains read-only. Use `npm start -- --no-open` to suppress browser launch: an interactive terminal prints the private URL with a keep-private warning, while a non-interactive launch prints only the public read-only URL. Never share, bookmark, log, or paste the private URL. Set `OMC_PORT` to another unprivileged local port if needed.

### Direct GitHub release artifact

The [GitHub release index](https://github.com/BitL8-ByteShort/opencode-model-control/releases) lists published versioned tarballs and checksums. Download the exact release asset, verify its SHA-256 against that release's checksum, then install the local file with `npm install --global /absolute/path/to/downloaded-package.tgz`. Historical package digests are recorded in the [historical package ledger](https://github.com/BitL8-ByteShort/opencode-model-control/blob/v0.2.1/packages/README.md). The [release checklist](docs/releasing.md) contains the maintainer-only 0.3.0 publication and verification procedure.

## What “Update available models” means (0.4.0)

The button asks the installed OpenCode CLI for its effective model list with plugin-aware discovery and `--refresh`. This reflects OpenCode's resolved provider configuration, including its provider and model filters.

Startup refreshes stale metadata before initialization completes; a live service checks every **15 minutes**, and **Update available models** can request an immediate refresh. A shared refresh lease coalesces panel/MCP processes; a recent persisted attempt prevents duplicate periodic work. OpenCode discovery and the independent public metadata fetch run concurrently. Failed or incomplete discovery retains the last usable model records; complete discovery can mark an absent model unavailable while preserving its identity and saved choices. The panel distinguishes last attempt, last successful discovery, and last successful pricing retrieval. A failed refresh cannot renew pricing freshness. Refresh does not invoke provider inference or rewrite OpenCode config; OpenCode itself may normalize its standard `$schema` field.

If an external OpenCode plugin stalls or fails discovery, Model Control retries in plugin-free mode and clearly marks the result incomplete because plugin-provided models may be missing. A failed or partial refresh never silently erases the last usable catalog.

OpenCode 1.18.x may add its standard `$schema` property when its CLI reads a project JSONC config. That is an upstream OpenCode normalization, not a Model Control-owned entry, so Disconnect does not remove it. Model Control does not otherwise write a config during catalog refresh.

Catalog state is deliberately split into four concepts:

- **Discovered:** OpenCode reported the model.
- **Saved inclusion intent:** Policy, explicitly enabled, or explicitly disabled. Effective eligibility also requires current pricing, availability, and role capabilities.
- **Available:** the refreshed metadata reports it active.
- **Runtime access checked:** a manually confirmed bounded synthetic OpenCode run returned the expected sentinel. OpenCode may have retried a provider failure during that run. Refresh does not make this claim or incur a model charge, and a runtime-access pass is not benchmark evidence.

## Free-first, Paid-first, and pricing evidence

Pricing is matched by the exact provider/full model key and API identity (model ID, npm adapter, and normalized endpoint). A similarly named model, a `-free` suffix, arbitrary CLI zeros, and bundled historical evidence cannot authorize free routing. Model Control fetches the fixed public `https://models.dev/api.json` endpoint without credentials; URLs inside metadata are never fetched. Complete, finite, nonnegative input/output rates are required. Every supported supplied billing dimension counts: reasoning, cache read/write, audio input/output, context tiers, legacy over-200k rates, and experimental modes. With complete valid evidence, any positive rate means paid; all supplied rates must be valid and exactly zero for free. Missing, malformed, unsupported, or conflicting evidence is unknown and blocked. Complete positive CLI evidence can establish `reported-paid` when independent evidence does not contradict it; CLI zero cannot establish free.

Pricing evidence expires after **24 hours**, checked at route time even without another refresh. Successful HTTP 200 or cached 304 revalidation renews public-source freshness; a failed attempt does not. Cached evidence remains usable only until its existing expiry. Public-source digests and timestamps describe retrieved metadata, not a billing guarantee or model-quality score.

**Automatically include new models** defaults on. A model with `selection: "policy"` (including an absent control) follows that setting and the saved Free/Paid policy. Free permits current verified-free evidence only; Paid permits known-paid and verified-free models and prefers paid after hard gates. Saving Paid with auto-include on authorizes future eligible known-paid models without a separate click for every new model. Turning auto-include off excludes policy-following models; explicit enables still apply. An explicit disable always wins. An enable or role pin cannot bypass unknown/expired pricing, availability, capabilities, or cost policy.

Selecting a compatible role model can explicitly enable it in the draft; selecting Automatic changes the role choice without writing inferred model enables. **Save changes** commits user intent. Refresh never adds inferred controls or rewrites saved intent.

Selecting **Paid** can incur charges under the active OpenCode provider account. Model Control does not enforce provider-side budgets.

The model detail view preserves OpenCode's effective report separately from supplemental public metadata: input/output modalities, tool calls, reasoning and reasoning options, structured output, temperature, attachments, interleaving, and context/input/output limits. Unknown (`null` or absent) is distinct from an explicit `false`; context/input/output limits are positive integers when known. Supplemental data can explain a model but cannot expand OpenCode's effective modalities or tool access. Exact API mismatches discard supplemental evidence. Capability-derived role profiles refresh without changing curated restrictions, ranking, or benchmark qualification.

## Seamless routing boundaries

Connect installs a bundled local OpenCode plugin alongside the MCP bridge and generated agents. On an `omc-router` turn containing image, audio, video, or PDF attachment metadata, the plugin reloads the saved routing policy and selects the eligible vision-worker model before provider dispatch. It also adds a fixed security instruction that treats attachment content as untrusted data: text or instructions embedded inside an attachment never authorize tools, delegation, or workspace changes.

For ordinary inspection such as “what is in this image?”, the plugin changes the turn to `omc-vision-worker`. That agent is tool-free, and the plugin also denies permission requests and tool execution for that media-only turn. The original text and attachment parts remain on the turn for vision analysis, but Omc-Router and its tools do not. The hard denial is cleared before the next turn.

Only explicit text authored by the user outside the attachment can authorize the writable path. The plugin locally reads that text solely to classify whether it clearly requests a code/workspace change. Empty text, ignored or synthetic text, more than 4,000 characters, or any classification failure defaults to the tool-free vision worker. The text is never logged, stored, or separately transmitted by the plugin. It never reads attachment content, filenames, URLs, data URLs, or payloads. If the saved policy has no enabled, available, cost-eligible model that supports every attached modality, the turn fails closed with a fixed local error. The automatic media-to-vision switch applies only to turns that enter through `omc-router`; all four owned roles also receive the live policy checks below. Unrelated agents keep their selected model.

For a code change selected by policy, the generated Omc-Router instructions automatically delegate implementation to `omc-code-worker`, then send the resulting workspace changes to `omc-reviewer`. The reviewer has read/search tools only: it has no shell, edit, or write permission. If review finds a concrete defect and the review repair pass is enabled, the router may send one repair task back to the same code worker and then must stop delegating. This setting does not switch to an alternate model. Specialists cannot recursively delegate or access the Model Control MCP tools. Generated instructions guide the workflow; runtime guards additionally restrict specialist tools and current delegation/repair authority. Users should still review consequential model actions.

A vision-worker assignment is eligible only when OpenCode reports that the exact model supports every attached modality, text output, and tool calls. Tool-call capability is required for the explicit media-assisted code path that retains Omc-Router; ordinary attachment analysis still runs with every tool hard-disabled.

All four stable managed agents are installed without baked-in `model` fields: `omc-router`, `omc-code-worker`, `omc-vision-worker`, and `omc-reviewer`. The local plugin reads coherent saved settings/catalog state for every owned turn, including text, specialist tasks, and ordinary resumed tasks. It intersects eligible catalog models with the current OpenCode instance's loaded provider inventory. Saving A → B takes effect on the next owned turn when B is already loaded; ordinary policy changes do not rewrite config or require reconnecting.

At `chat.params`, the plugin rechecks current policy, price expiry, loaded inventory, exact provider/model/API identity, endpoint/transport, effective capabilities, and effective rates before inference. Missing or corrupt saved state, disabled or unavailable selections, incompatible effective metadata, and unknown pricing fail closed. An explicit pin is never silently replaced. Unrelated OpenCode agents keep their own selections.

A newly discovered C absent from the running host inventory needs an explicit OpenCode reload/restart. It blocks with `OMC_HOST_MODEL_MISSING`; automatic roles may choose eligible already-loaded models. OpenCode 1.18.22/1.18.28 sanitize HTTP plugin failures to `UnknownError`, so the actionable reload guidance is a same-directory TUI toast/event. Headless consumers must read the instance event stream to receive that text. Model Control never disposes or restarts an OpenCode instance automatically. Changes to installed agent instructions/permissions, package or plugin paths, or the optional default agent require **Update connection** and an OpenCode restart.

Ordinary child resumes adopt current saved policy. Only a completed owned worker followed by its matching completed reviewer can authorize one review-driven repair on that worker's original model. The repair rechecks current eligibility and stops if that model is revoked. Background acknowledgment alone is not completion: matching terminal host events are required. This evidence belongs to the current parent workflow in the running plugin instance; a new user turn, unrelated parent, or completed repair cannot reuse it. No persistence across an OpenCode restart is promised.

Owned slash subtasks have a narrow, one-shot allowance for OpenCode's synthetic parent summary, which bypasses `chat.message`. The plugin verifies the exact session/message, owned agent, inherited model, matching completed child, and fixed synthetic summary content before allowing it; all dispatch guards still run. If the parent pin changes while the child runs, the summary inherits the old model and safely blocks. A new user turn can adopt the new policy. Unmatched synthetic or ordinary messages do not gain authority.

## Command-line connection controls

The same safe connector is available without the panel:

```sh
opencode-model-control status
opencode-model-control connect --yes
opencode-model-control disconnect --yes
```

`status --json`, `connect --yes --json`, and `disconnect --yes --json` provide machine-readable output. These commands do not call a model.

## Saved policy and migration

Settings schema v3 stores intent as `selection: "policy" | "enabled" | "disabled"`, plus optional user availability exclusions; effective eligibility is derived separately. Legacy v0/v1/v2 Boolean controls migrate to explicit choices while preserving disables, Paid policy, pins (including absent model IDs), workflow bounds, and default-agent preference. Migration first saves an exact private `settings.json.v<old-version>.backup-<uuid>` copy, then atomically writes v3. State directories use mode `0700`; settings, cache, snapshot, status, migration backups, and receipts use `0600`.

Settings and catalog reads/writes share a cross-process lock. Save uses the last settings revision for compare-and-swap: a settings conflict returns 409 without overwriting either writer. A catalog-only change can rebase untouched choices, but newly edited ineligible selections return a selection conflict. Existing blocked pins remain visible through unrelated edits. The panel preserves unsaved drafts during refresh and conflicts so the user can review and retry. Corrupt saved state fails closed; preserve the private state and migration backup for recovery rather than deleting disables or replacing the whole state with defaults. Full OpenCode config backups are a separate connector recovery mechanism.

## Disconnect and recovery

Use **Disconnect** in the panel, or run `opencode-model-control disconnect --yes`, then restart OpenCode. Disconnect removes only the values recorded as owned by this installation. If those values were changed elsewhere, it stops and asks for attention instead of overwriting them.

Before changing an existing OpenCode config, Connect creates a private mode-`0600` backup next to that config and records ownership in a private receipt. The connector automatically restores the previous config if its paired receipt operation fails. There is intentionally no broad “restore any backup” command because choosing an old full-config backup can erase unrelated newer settings.

The receipt pins the exact managed paths and values plus the managed-surface version used by this installation. It detects stale or changed ownership state; it is not a content-signature or provenance check for the package files at those recorded paths. Verify package authenticity through the published npm integrity and GitHub release checksum.

If the automatic rollback itself reports a failure, stop editing the OpenCode config and preserve the newest adjacent `.omc-backup-*.bak` file. Follow the exact recovery path printed by the command or include that message in a private security/support report. A backup is a full copy of the config and can contain credentials if the user embedded them there.

## Runtime access checks and benchmarks

The **Benchmarks** page includes a manual **Run one runtime check** control. It is never triggered by startup, model refresh, Save, Connect, or Reload summary. Running it requires selecting one model and confirming both the real provider request and the provider's possible cost/data terms.

The check starts one bounded `opencode run --pure` execution with a fixed text-only sentinel. OpenCode can retry a retryable provider failure inside that run, so the UI does not claim exactly one provider attempt. Model Control stores only redacted result metadata and discards raw output. Each attempted provider call can consume quota, incur cost, and be retained under OpenCode's or the provider's terms. A pass means that exact model returned the expected synthetic response during that run; it does not establish role fitness, quality, reliability, future access, or free pricing, and it never promotes benchmark evidence. There is intentionally no one-click quality benchmark: a role remains **benchmark pending** until a reproducible, versioned benchmark run satisfies the documented promotion gate.

The isolation guard excludes user/project instructions, external plugins, MCP servers, tools, and project state before the provider phase. OpenCode's configured provider authentication remains available. Model Control locally parses OpenCode's `auth.json` only to inspect each credential record's `type` metadata and fails closed for an unreadable/invalid store or a credential type that can load remote configuration. It does not extract individual secret fields, log them, add them to the synthetic prompt/config, or transmit them.

## Easy controls and Advanced tools

The normal 0.3.0 setup path is **Update**, choose a cost preference and inclusion policy, decide whether Omc-Router should become the default agent, **Save**, **Connect**, and restart OpenCode. After setup, saved policy changes apply live within the host-loaded inventory. The default-agent option adds `default_agent: "omc-router"` only when OpenCode has no existing default. A user-owned default is preserved, and disabling the option removes only a value previously added by this installation.

The collapsed **Advanced tools for developers** section is optional. It shows the exact managed config path, lets a developer open or reveal that existing file, and previews or exports generated integration JSON. It does not provide an unrestricted config writer. Manual changes to an owned entry make connection health report **Needs attention**, and Model Control will not overwrite the divergence.

Two environment overrides are intended for advanced development and isolated acceptance only:

- `OMC_OPENCODE_CONFIG_PATH` selects the exact absolute OpenCode config file used by Status, Connect, Disconnect, Open, and Reveal. Model Control does not make an ordinary OpenCode launch load a nonstandard target; the test/operator must configure OpenCode to use the same file.
- `OMC_CONFIG_DIR` relocates Model Control's private settings and receipt directory. If used, the identical value must be present in the environments that launch the panel and OpenCode so the generated MCP subprocess and bundled plugin read the same policy. The connector does not embed arbitrary environment values into OpenCode config. If that propagation cannot be guaranteed, use the default directory.

## Privacy, network use, and usage reporting

OpenCode Model Control does not include telemetry or remote analytics. It makes credential-free public Models.dev metadata requests on refresh, including ordinary network metadata (such as the client IP) and conditional cache validators. It sends no prompts, attachments, usage, configuration, model selections, or provider credentials in those requests. Its settings, connection receipt, and Usage view stay on this computer. The server creates a new high-entropy mutation token for each process. The automatic browser launch delivers it once in the query string, the app stores it in that tab's `sessionStorage`, and the app immediately scrubs it from the address bar. Every `POST`, `PUT`, `PATCH`, or `DELETE` API request requires a same-origin `Origin`, JSON, `X-OMC-Request: 1`, and the matching `X-OMC-Session` token. Opening the bare URL is intentionally read-only; restart the command to rotate a token and authorize a new tab.

This per-process token limits accidental or cross-site changes; it does not make the loopback service a hardened remote or multi-user application. Do not expose its port to a LAN, tunnel, container network, or the public internet, and never share the private write-enabled URL or its token.

The **Usage** page runs a fixed, plugin-free aggregate query through OpenCode's local database command. It selects assistant model IDs, token counters, timestamps, recorded cost, and session IDs solely for a distinct-session count. The API returns only aggregate session/message counts and per-model totals; it never returns session identifiers, prompts, responses, titles, projects, paths, raw message JSON, or credentials. The default window is 30 days, with 7-day, 90-day, and all-time views. Reading Usage does not invoke a model or create new provider usage.

Usage values are provider-reported accounting stored by OpenCode. A zero can mean no activity or that a provider omitted accounting, and recorded cost is not a provider invoice. If the local schema or command is incompatible, the page reports Usage as unavailable instead of substituting zero values.

Local control does not mean local inference. OpenCode and the selected model provider still receive and process prompts, attachments, and usage according to their own configuration, terms, privacy policy, rate limits, and billing. **Update available models** can cause OpenCode, configured providers, or plugins to refresh catalog data over the network, but Model Control does not invoke a model as part of refresh. Installing dependencies can contact the npm registry.

The connector parses the local OpenCode config so it can preserve unrelated settings. It does not request, extract, log, or transmit provider key material. If a key is embedded directly in that config, the guarded full-config backup contains it too; the mode-`0600` permission limits access by other local accounts but is not protection from a compromised account. Separately, the manual runtime check's local isolation guard inspects credential-type metadata as described above without copying or transmitting secret fields.

The bundled routing plugin reads attachment type/MIME metadata and, only for a media turn entering through `omc-router`, up to 4,000 characters of nonsynthetic, nonignored user text for local write-intent classification. It never logs, stores, or separately transmits that text and never reads attachment content, filenames, URLs, data URLs, or payloads. Attachment content is always untrusted and cannot grant authority. The selected provider still receives the original prompt and supported attachment through OpenCode under that provider's own terms.

## Library surface

```js
import {
  buildOpenCodeConfig,
  previewOpenCodeConfig,
  renderOpenCodeConfig,
} from "opencode-model-control/src/opencode/index.js";

const config = buildOpenCodeConfig({ catalog, settings });
const text = renderOpenCodeConfig({ catalog, settings });
const preview = previewOpenCodeConfig({ existingConfig, catalog, settings });
```

These generator functions are in-memory operations. They do not read provider credentials or write files. The separate connector owns the guarded file transaction used by the panel and CLI.

## Development

```sh
npm ci
npm run check
npm test
npm run build
```

`npm run verify` runs all three validation stages. When OpenCode is installed, acceptance tests use isolated temporary configuration directories; they do not edit the user's live OpenCode configuration or call a model.

See [Contributing](CONTRIBUTING.md) before opening a pull request.

## Documentation

- [OpenCode integration](docs/opencode-integration.md)
- [Architecture](docs/architecture.md)
- [Support matrix](docs/support-matrix.md)
- [Benchmark methodology](docs/benchmarks.md)
- [Threat model](docs/threat-model.md)
- [Release checklist](docs/releasing.md)

Free access does not imply unlimited access, privacy, uptime, or stable model identity. Paid preference can incur provider charges. Review the active provider's current terms before sending sensitive data.

## Independent project

OpenCode Model Control is an independent community project. It is not affiliated with, endorsed by, or sponsored by OpenCode, OpenRouter, or any model provider. Product and model names are used only to identify compatibility.

## License

[MIT](LICENSE) © 2026 Jorvek AI Solutions.
