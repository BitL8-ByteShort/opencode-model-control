# Contributing

Thank you for helping improve OpenCode Model Control. Contributions should keep the project local-first, cost-explicit, understandable, and honest about unverified model behavior.

## Development setup

Install Node.js `>=22.12.0` (prefer a currently supported Node.js 22 or 24 LTS release), npm, and the project dependencies:

```sh
npm ci
npm run verify
```

OpenCode 1.18.x is required for full live integration acceptance, but most checks run without it. When OpenCode is installed, the acceptance suite uses isolated temporary configuration directories. Tests and examples must never connect to a real user config, invoke a paid model, or rely on private credentials.

Documentation-only changes should still run `npm run verify` when practical. State exactly what was not run and why.

## Before opening a change

1. Search existing issues and discussions to avoid duplicate work.
2. For a behavior change, add a failing test before the implementation.
3. Keep the change narrowly scoped and avoid unrelated refactors.
4. Update documentation when behavior, support, security, or benchmark claims change.
5. Run `npm run verify` and report any check you could not run.

Routing changes must keep unknown pricing blocked, preserve the verified-free default, and require an explicit user choice before known paid models become eligible. Connector changes must preserve unrelated OpenCode configuration, fail closed on ownership conflicts, and include isolated install/disconnect tests.

Do not include credentials, private prompts, user transcripts, proprietary source code, benchmark data you cannot redistribute, or code copied from closed-source routers. Contributions must be clean-room work or compatible third-party material with its provenance and license recorded.

## Developer Certificate of Origin

This project uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Every commit must include a sign-off certifying that you have the right to submit the contribution under this project's license.

Create signed-off commits with:

```sh
git commit -s
```

The commit message must contain a line in this form, using your real name and an email address you control:

```text
Signed-off-by: Your Name <you@example.com>
```

A cryptographic Git signature does not replace the DCO sign-off. Maintainers may ask contributors to amend commits that lack it.

## Pull requests

Describe the user problem, the smallest complete solution, security or privacy implications, and exact verification performed. Benchmark changes must include the methodology version, raw machine-readable results, model IDs, OpenCode version, run date, failure data, and enough instructions to reproduce the run.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security findings belong in the private process described in [SECURITY.md](SECURITY.md), not in a public issue.
