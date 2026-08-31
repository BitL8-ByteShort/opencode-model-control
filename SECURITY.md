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

The control service is intended to bind only to `127.0.0.1`. It is not an authentication boundary and must not be exposed to a LAN, tunnel, container network, or the public internet. The project does not need or request model-provider keys. OpenCode remains responsible for its own provider credentials and provider usage.

The pure config generator operates in memory. The connector changes only its documented, receipt-owned OpenCode paths after isolated parser verification, writes a mode-`0600` backup and receipt, and refuses ownership conflicts. To preserve unrelated settings, the connector reads and parses the local OpenCode config. It does not request, extract, log, or transmit provider credentials. Its backup is a full copy of that config and can contain credentials if the user embedded them there; mode `0600` protects against other local accounts, not a compromised account.

OpenCode Model Control does not include telemetry or remote analytics. Its Usage view executes a fixed aggregate query through OpenCode's plugin-free local database command. The query projects model IDs, counts, token counters, timestamps, and recorded cost only; it does not select prompts, responses, titles, projects, paths, session identifiers, raw message JSON, or credentials. Query windows are allowlisted, process time/output are bounded, malformed accounting fails closed, and API responses are not cached.

Catalog refresh can still cause OpenCode, configured providers, or plugins to access the network. OpenCode and model providers may process prompts and report usage under their own policies. A future provider proxy, remote-control feature, or credential-handling feature requires a separate threat review before release.

See the full [threat model](docs/threat-model.md).
