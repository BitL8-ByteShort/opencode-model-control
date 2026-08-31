# OpenCode Model Control

![OpenCode Model Control — Route smarter. Stay in control.](https://raw.githubusercontent.com/BitL8-ByteShort/opencode-model-control/v0.1.2/docs/assets/opencode-model-control-banner.png)

OpenCode Model Control is a local control panel and MCP companion for building a model team inside OpenCode. It discovers the models OpenCode currently exposes, lets the user decide which ones the router may use, assigns an orchestrator and specialist roles, and safely connects that policy to OpenCode.

The control panel runs on `127.0.0.1`. OpenCode remains responsible for provider authentication and model calls. Model Control does not request, extract, log, or transmit API keys and does not connect directly to OpenRouter; its guarded connector does read the local OpenCode config so it can preserve unrelated settings and create a private full-config backup.

The running app is authoritative for model names, availability, pricing evidence, and role eligibility.

> **Release status:** Version `0.1.2` is available from [npm](https://www.npmjs.com/package/opencode-model-control/v/0.1.2) and as the exact tested package attached to [GitHub Release v0.1.2](https://github.com/BitL8-ByteShort/opencode-model-control/releases/tag/v0.1.2). The [source repository](https://github.com/BitL8-ByteShort/opencode-model-control) is public.

## What it does

- Reads OpenCode's resolved, all-provider model catalog rather than relying on a fixed list.
- Provides an **Update available models** action that runs a fresh OpenCode catalog refresh.
- Separates OpenCode discovery from Model Control enablement: newly discovered models are visible but disabled for routing until the user enables them.
- Provides a **Free / Paid** preference:
  - **Free** permits only independently verified zero-cost models.
  - **Paid** permits verified free and known paid models, prioritizing paid models for compatible automatic assignments.
  - Unknown or ambiguous pricing is always shown as **Unknown — blocked**.
- Keeps Big Pickle as the initial text orchestrator by default and supports bounded code, vision, and review specialists.
- Connects to OpenCode without requiring the user to edit JSON.
- Preserves unrelated OpenCode configuration and JSONC comments, rejects ownership or concurrent-edit conflicts, creates a mode-`0600` backup and receipt, and verifies both the proposed OpenCode config and exact MCP handshake before writing it.
- Exposes a local MCP bridge so the selected orchestrator can consult the current routing policy before delegating.
- Reports local, aggregate OpenCode token and recorded-cost history without reading prompts or credentials.
- Keeps benchmark claims honest: an available model is not called “best” until repeatable evidence qualifies it.

## Prerequisites

- [OpenCode](https://opencode.ai/docs/) 1.18.x installed and available as `opencode`.
- Node.js `^20.19.0` or `>=22.12.0`.
- npm, which is included with Node.js.

Check the two required programs before setup:

```sh
opencode --version
node --version
```

The panel can open without OpenCode, but it cannot discover the user's current models or connect the managed MCP integration until the OpenCode CLI is available.

## Install

Install the verified public npm release:

```sh
npm install --global opencode-model-control@0.1.2
opencode-model-control
```

The first command installs the tested `0.1.2` release and its runtime dependencies. The second command starts the local panel and opens it in the default browser.

Then:

1. Click **Update available models** to read the models currently exposed by OpenCode.
2. Choose **Free** or **Paid**, enable the models Model Control is allowed to route to, and save.
3. Click **Connect to OpenCode**.
4. Restart OpenCode so it loads the managed MCP and `omc-*` agents.

No JSON editing is required. Connect creates a private backup, safely merges only its owned configuration, validates OpenCode and the MCP handshake, and rolls back if the transaction cannot complete.

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
3. Choose **Free** or **Paid**, enable the models Model Control is allowed to route to, and save.
4. Click **Connect to OpenCode**.
5. Restart OpenCode so it loads the managed MCP and `omc-*` agents.

The connector writes absolute Node and package CLI paths, so a source checkout does not require `npm link`. Keep the checkout in the same location while connected. If it is moved or deleted, start it from the new location and reconnect before restarting OpenCode.

`npm start` opens the panel in the default browser. Use `npm start -- --no-open` to suppress browser launch, or set `OMC_PORT` to another unprivileged local port.

### Direct GitHub release artifact

To install the same tested tarball directly from GitHub:

```sh
npm install --global https://github.com/BitL8-ByteShort/opencode-model-control/releases/download/v0.1.2/opencode-model-control-0.1.2.tgz
opencode-model-control
```

Its SHA-256 is `b8ac329f72fd351159e4f1c86a739bdc7005b96b8d4a7f793580edd5929d5aee`; the package record is in [packages/README.md](packages/README.md).

## What “Update available models” means

The button asks the installed OpenCode CLI for its effective model list with plugin-aware discovery and `--refresh`. This reflects OpenCode's resolved provider configuration, including its provider and model filters.

If an external OpenCode plugin stalls or fails discovery, Model Control retries in plugin-free mode and clearly marks the result incomplete because plugin-provided models may be missing. A failed or partial refresh never silently erases the last usable catalog.

OpenCode 1.18.x may add its standard `$schema` property when its CLI reads a project JSONC config. That is an upstream OpenCode normalization, not a Model Control-owned entry, so Disconnect does not remove it. Model Control does not otherwise write a config during catalog refresh.

Catalog state is deliberately split into four concepts:

- **Discovered:** OpenCode reported the model.
- **Enabled in Model Control:** the user permits this router to select it. Newly discovered models start disabled here even if OpenCode exposes them.
- **Available:** the refreshed metadata reports it active.
- **Runtime verified:** an actual provider invocation succeeded. Refresh does not make this claim or incur a model charge.

OpenCode can normalize missing pricing fields to zero, so a reported zero by itself is not enough to call an arbitrary model free. Paid routing is allowed only when pricing is positively known; ambiguous pricing remains blocked in both modes.

## Free-first and Paid-first

The two cost choices set both priority and permission. They never override task capability, input type, availability, Model Control enablement, or an explicit compatible role assignment.

- **Free** means `free-first + free-only`. Only models with independently verified zero input and output pricing may be selected automatically.
- **Paid** means `paid-first + known-cost`. Known-paid models are preferred for compatible automatic assignments, but verified-free models remain eligible as fallbacks. It is not a paid-only mode.
- **Unknown pricing** is blocked in both modes. A name ending in `-free` or a zero normalized by OpenCode is not enough evidence by itself.

Selecting **Paid** can incur charges under the active OpenCode provider account. Model Control does not set or enforce provider-side budgets.

## Important routing boundary

Stock OpenCode chooses the session's primary model before that model can use MCP tools. The MCP bridge can help the chosen orchestrator select a specialist, but it cannot replace the model for the first call.

That matters for media. Big Pickle is text-only. If OpenCode removes an unsupported image before invoking it, Big Pickle cannot forward an attachment it never received. For now, send the media directly to `@omc-vision-worker`. True attachment-aware routing before the first call requires the optional provider gateway described in [Architecture](docs/architecture.md).

## Command-line connection controls

The same safe connector is available without the panel:

```sh
opencode-model-control status
opencode-model-control connect --yes
opencode-model-control disconnect --yes
```

`status --json`, `connect --yes --json`, and `disconnect --yes --json` provide machine-readable output. These commands do not call a model.

## Disconnect and recovery

Use **Disconnect** in the panel, or run `opencode-model-control disconnect --yes`, then restart OpenCode. Disconnect removes only the values recorded as owned by this installation. If those values were changed elsewhere, it stops and asks for attention instead of overwriting them.

Before changing an existing OpenCode config, Connect creates a private mode-`0600` backup next to that config and records ownership in a private receipt. The connector automatically restores the previous config if its paired receipt operation fails. There is intentionally no broad “restore any backup” command because choosing an old full-config backup can erase unrelated newer settings.

If the automatic rollback itself reports a failure, stop editing the OpenCode config and preserve the newest adjacent `.omc-backup-*.bak` file. Follow the exact recovery path printed by the command or include that message in a private security/support report. A backup is a full copy of the config and can contain credentials if the user embedded them there.

## Easy controls and Advanced tools

The normal path is **Update**, choose a cost preference, enable models, **Save**, **Connect**, and restart OpenCode. No manual JSON editing is required.

The collapsed **Advanced tools for developers** section is optional. It shows the exact managed config path, lets a developer open or reveal that existing file, and previews or exports generated integration JSON. It does not provide an unrestricted config writer. Manual changes to an owned entry make connection health report **Needs attention**, and Model Control will not overwrite the divergence.

## Privacy, network use, and usage reporting

OpenCode Model Control does not include telemetry or remote analytics. Its settings, connection receipt, and Usage view stay on this computer. The loopback panel is not an authentication boundary, so do not expose its port to a LAN, tunnel, container network, or the public internet.

The **Usage** page runs a fixed, plugin-free aggregate query through OpenCode's local database command. It selects assistant model IDs, token counters, timestamps, recorded cost, and session IDs solely for a distinct-session count. The API returns only aggregate session/message counts and per-model totals; it never returns session identifiers, prompts, responses, titles, projects, paths, raw message JSON, or credentials. The default window is 30 days, with 7-day, 90-day, and all-time views. Reading Usage does not invoke a model or create new provider usage.

Usage values are provider-reported accounting stored by OpenCode. A zero can mean no activity or that a provider omitted accounting, and recorded cost is not a provider invoice. If the local schema or command is incompatible, the page reports Usage as unavailable instead of substituting zero values.

Local control does not mean local inference. OpenCode and the selected model provider still receive and process prompts, attachments, and usage according to their own configuration, terms, privacy policy, rate limits, and billing. **Update available models** can cause OpenCode, configured providers, or plugins to refresh catalog data over the network, but Model Control does not invoke a model as part of refresh. Installing dependencies can contact the npm registry.

The connector parses the local OpenCode config so it can preserve unrelated settings. It does not request, extract, log, or transmit provider keys. If a key is embedded directly in that config, the guarded full-config backup contains it too; the mode-`0600` permission limits access by other local accounts but is not protection from a compromised account.

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
