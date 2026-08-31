# Security policy

## Supported versions

The canonical public source is [BitL8-ByteShort/opencode-model-control](https://github.com/BitL8-ByteShort/opencode-model-control). Security fixes target the latest published minor version unless a release notice says otherwise.

## Reporting a vulnerability

Use the repository's **Security** tab and **Report a vulnerability** to submit a private report. If private vulnerability reporting is temporarily unavailable, open a minimal issue asking a maintainer to establish a private channel. Do not include exploit details, secrets, personal data, or a proof of concept in a public issue.

Include:

- The affected version or commit.
- Reproduction steps and required preconditions.
- The security impact and realistic attack path.
- Any suggested mitigation.
- Whether the issue is already public or under active exploitation.

Maintainers should acknowledge a complete private report within seven days. A remediation and disclosure schedule depends on severity, exploitability, and release risk. Please do not publicly disclose the issue until a fix or coordinated disclosure date is available.

## Security boundaries

The control service is intended to bind only to `127.0.0.1` and must not be exposed to a LAN, tunnel, container network, or the public internet. Each server process creates a new high-entropy token for local API mutations. The automatic browser launch receives it through a private query URL; the UI stores it in the tab's `sessionStorage` and immediately removes it from the address bar. A tab opened from the bare URL is read-only. Every `POST`, `PUT`, `PATCH`, or `DELETE` API request requires a same-origin `Origin`, JSON, `X-OMC-Request: 1`, and the matching `X-OMC-Session` token.

With `--no-open`, the private write-enabled URL is printed only to an interactive terminal and is marked keep-private; non-interactive output contains only the public read-only URL. Do not share, bookmark, log, or paste the private URL or its token. Restarting the service rotates the token. This capability protects local mutations but is not user identity or a hardened remote/multi-user authentication boundary. The project does not need or request model-provider keys. OpenCode remains responsible for its own provider credentials and provider usage.

The pure config generator operates in memory. The connector changes only its documented, receipt-owned OpenCode paths after isolated parser verification, writes a mode-`0600` backup and receipt, and refuses ownership conflicts. It preserves unrelated plugins and adds the Omc-Router default only when no user default exists. To preserve unrelated settings, the connector reads and parses the local OpenCode config. It does not request, extract, log, or transmit provider secret material. Its backup is a full copy of that config and can contain credentials if the user embedded them there; mode `0600` protects against other local accounts, not a compromised account. The receipt records exact managed values and a managed-surface version so stale or divergent connections fail closed, but it is not a signature or content-authenticity proof for package files at recorded paths.

The bundled local routing plugin applies only to media turns that enter through `omc-router`. It reads attachment part type/MIME metadata to choose a compatible saved model. It also reads only nonsynthetic, nonignored user text, bounded to 4,000 characters, for a local authorization classification: unless that text clearly requests a code/workspace change, the turn becomes `omc-vision-worker`, all permission requests are denied, and all tool execution is hard-blocked. Empty, synthetic-only, ignored-only, oversized, or unclassifiable text fails closed to this tool-free path. The text is not logged, stored, or separately transmitted by the plugin, which never reads attachment content, filenames, URLs, data URLs, or payloads.

Every media turn receives a fixed instruction that attachment content is untrusted data. Instructions embedded in an image, audio file, video, or PDF cannot authorize tools, delegation, or workspace changes. Only explicit user-authored text outside the attachment can authorize the path that retains Omc-Router for vision-assisted code delegation. OpenCode and the selected provider still receive the original prompt and supported attachment under their own security and privacy boundaries.

Generated specialists cannot access Model Control MCP tools or recursively delegate. The code worker retains bounded implementation tools. The independent reviewer is read-only and has no shell, edit, or write permission. These permissions reduce accidental authority, but prompt-governed delegation and repair limits are not a substitute for user review of consequential model actions.

OpenCode Model Control does not include telemetry or remote analytics. Its Usage view executes a fixed aggregate query through OpenCode's plugin-free local database command. The query projects model IDs, token counters, timestamps, recorded cost, and session IDs solely for a distinct-session count. The API returns aggregates and model IDs, never individual session identifiers, prompts, responses, titles, projects, paths, raw message JSON, or credentials. Query windows are allowlisted, process time/output are bounded, malformed accounting fails closed, and API responses are not cached.

The manual runtime access check is never automatic. It requires explicit provider-request and cost/data acknowledgements and starts one bounded, isolated, plugin-free OpenCode run with a fixed text-only sentinel. OpenCode may retry retryable provider failures, so the run can make more than one provider attempt; every attempt can consume quota, incur charges, and be retained by OpenCode or the provider under their own terms. Model Control bounds time and output, discards raw output, and stores only redacted mode-`0600` result metadata. Before launch, its local isolation guard parses OpenCode's credential store only to inspect credential-type metadata and fails closed when the store cannot be safely interpreted or a type can load remote configuration. It does not extract individual secret fields, log them, copy them into the isolated configuration, or transmit them. A pass is not benchmark or quality evidence.

`OMC_OPENCODE_CONFIG_PATH` and `OMC_CONFIG_DIR` are advanced/testing overrides. The first changes the connector's target but does not make an ordinary OpenCode process load a nonstandard file. The second must be propagated unchanged to the panel and every OpenCode launch so the MCP subprocess and media plugin use the same private policy directory. Misaligned launch environments are outside the supported easy path; use the defaults when consistent propagation is not guaranteed.

Catalog refresh can still cause OpenCode, configured providers, or plugins to access the network. OpenCode and model providers may process prompts and report usage under their own policies. A remote-control or credential-handling feature requires a separate threat review before release.

See the full [threat model](docs/threat-model.md).
