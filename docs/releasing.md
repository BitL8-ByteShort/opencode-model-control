# Release checklist

This maintainer procedure does not assert publication. The canonical repository is [BitL8-ByteShort/opencode-model-control](https://github.com/BitL8-ByteShort/opencode-model-control). A source version or candidate CI pass is not proof that npm or GitHub serves final release bytes. Release preparation must not update a maintainer's everyday global installation or invoke a real model provider.

## 1. Review and protected-main gates

- Confirm the public repository/package ownership, license, contribution and security policies, private vulnerability reporting, and public project links.
- Update `package.json`, the root lockfile versions, changelog and behavior/security/support docs. Keep historical evidence dated; do not invent a final digest or publication link.
- Independently review the whole change against the approved specification, code and security boundaries. Resolve material findings before merge. Preserve DCO sign-offs on every commit.
- Merge through the reviewed PR and protected main, without bypassing required checks. Required contexts remain `verify (22.12.0)` and `verify (24.x)`; also wait for **all** pack and Linux/macOS acceptance jobs and applicable security checks, even if they are not branch-required contexts.
- Keep model ranking, benchmark campaigns, provider authentication integrations, new platform claims, and automatic OpenCode instance disposal outside 0.3.0 scope.

## 2. Source and package-content checks

Use the minimum Node 22.12.0 and the tested Node 24 line. Put an exact supported OpenCode host on PATH for source config-smoke tests; missing-host skips are not a release pass.

```sh
npm ci
npm run verify
npm audit --audit-level=high
npm run test:browser
npm pack --dry-run --ignore-scripts --json
```

The dry run skips `prepack` only after the explicit full verification/build above. Inspect its exact file list for secrets, settings, metadata caches, receipts, backups, scratch reports, test evidence, nested tarballs, and unexpected files. The package includes built `dist`, production `bin`/`src`, catalog data, examples, docs and public policy/license files; internal implementation plans and test scripts are excluded; development dependencies are not runtime dependencies. Record runtime versions, results and exceptions. Review audit findings rather than treating a threshold-only exit as a zero-advisory claim.

For source host work, `OMC_HOST_BINARY=/absolute/opencode npm run test:host` requires exact OpenCode 1.18.22 or 1.18.28 and reports `checkout-source`. This does not replace installed-tarball acceptance.

## 3. Build one final tarball from clean protected main

After merge, dispatch `.github/workflows/ci.yml` on `main` with `artifact-stage: final`. It verifies source, builds, packs once, and sends the same `omc-final-tarball` artifact to all acceptance jobs. Final mode rejects a dirty source tree or another CI ref. An authorized equivalent local pack from the exact clean protected-main commit is:

```sh
npm ci
npm run verify
OMC_ARTIFACT_STAGE=final node scripts/pack-artifact.mjs /absolute/final-artifact
node scripts/check-artifact.mjs /absolute/final-artifact
```

Do not run that local command as a second producer after CI already created the final artifact. `pack-artifact.mjs` deliberately skips npm lifecycle scripts because verification/build are earlier explicit gates. It writes the single tgz, `SHA256SUMS`, and `pack-evidence.json` containing source commit, clean-tree state, stage, Node version and inner tarball digest. The GitHub ZIP artifact digest is **different** from the inner `.tgz` SHA-256.

Download and preserve the one final tarball. Never repack in an acceptance or publication step. A checksum cannot be added inside its own tarball; put final digests in external release assets/evidence and a subsequent package-ledger update. Connection receipts record managed ownership/version, not package-file authenticity.

## 4. Test the installed exact bytes on both platforms

Use disposable HOME/XDG/config/project/provider directories and exact OpenCode binaries on Linux and macOS under both Node versions. The CI matrix installs the pinned browser and dependencies in isolated locations. A local command with already available prerequisites is:

```sh
OMC_HOST_BINARY_122=/absolute/opencode-1.18.22 \
OMC_HOST_BINARY_128=/absolute/opencode-1.18.28 \
OMC_EXPECTED_SHA256='<digest from SHA256SUMS>' \
OMC_EVIDENCE_PATH=/absolute/evidence/package.json \
npm run test:package -- /absolute/final-artifact/opencode-model-control-0.3.0.tgz
```

`OMC_BROWSER_EXECUTABLE` can select an existing compatible Chromium executable; otherwise the pinned Playwright browser must be installed. Missing binaries or incomplete tests fail the gate. The package command installs the exact tgz and requires:

- All 16 package checks, including current install, actual checked-in 0.2.1 upgrade, private byte-exact v2-to-v3 migration, stable surface 2, MCP, normal production startup without Vite, read-only 403, authorized refresh, restart token rotation, Connect/Disconnect and exact config restoration.
- Both actual hosts executing the installed package core/service/plugin: 19 scenarios and 56 synthetic loopback requests each. All owned roles switch A → B live without config writes/restart. Missing C, unknown pricing, disables, saved availability, API conflicts and mid-dispatch revocation block before inference; both media lanes, ordinary resumes, synchronous/background repair and revocation, unrelated agents, owned slash summary and changed-parent-pin behavior pass.
- All 12 real browser interactions against the installed compiled `dist` with no Vite: zero failures, skips or flakes, plus hashes of the served HTML/JS/CSS.
- Digest-bound evidence identifying installed-tarball target, OS kernel/architecture, Node and host versions, **112 loopback synthetic requests and zero real-provider inference**. Keep all prompts, attachments, credentials and private panel launch URLs out of logs/evidence.

Run the negative artifact binding proof once (CI does this on Linux/Node22):

```sh
OMC_HOST_BINARY=/absolute/opencode-1.18.28 \
OMC_EVIDENCE_PATH=/absolute/evidence/artifact-guards.json \
node scripts/artifact-guards.mjs /absolute/final-artifact/opencode-model-control-0.3.0.tgz
```

This must reject both a deliberately broken plugin tarball and a deliberately broken UI tarball while healthy checkout source is present. It proves acceptance cannot silently fall back to checkout code.

Label public metadata separately:

```sh
OMC_EVIDENCE_PATH=/absolute/evidence/public-metadata.json npm run test:metadata
```

That command retrieves public Models.dev metadata without inference. Neither it nor a loopback dispatch check proves provider entitlement, billing, quality or future access. Any optional real-provider runtime check requires separate explicit acknowledgments and must not be substituted for artifact acceptance.

## 5. Stage and publish immutable public artifacts

- Confirm npm authorization and package ownership. If login or CI authorization is unavailable, finish unaffected work and report the exact external gate. Do not infer success or use a different artifact to work around it.
- Confirm GitHub immutable releases are enabled and protect the exact version tag from force updates/deletion **before** creating it. The setting is not retroactive.
- Create a draft GitHub release for `v0.3.0` at the exact reviewed protected-main commit. Stage the final tested tarball, `SHA256SUMS`, pack evidence and redacted acceptance results. Verify draft target, notes, filenames and downloaded digest before publication.
- Publish the exact tested file to npm using the authorized registry flow. The command, only after all gates and authorization, is `npm publish /absolute/final-artifact/opencode-model-control-0.3.0.tgz --access public`. Never publish from the checkout or rebuild for npm.
- Retrieve the exact npm 0.3.0 public tarball, verify registry integrity and its SHA-256 against the final file, and test its installed experience in isolation.
- Publish the finalized GitHub draft when all notes/assets are final, then verify the release is immutable and its public downloaded tarball matches the same SHA-256.
- Never replace a published asset, move/reuse a published tag, or delete/recreate the release. Corrections require a new version and artifact.

## 6. Verify both public channels and close the issue

Fetch each channel's public tarball into a separate directory and run the same exact-package acceptance command against each retrieved file. Preserve channel URL, retrieval time, digest/integrity and redacted results. Explicitly compare **both** public downloads with the original tested final bytes.

After confirmed publication, a clean user install can use `npm install --prefix /absolute/disposable-install opencode-model-control@0.3.0`. Verify its CLI version and public installed startup/refresh/Connect/restart/status/Disconnect/restart path; never change a maintainer's everyday global install as this check. README `@latest` commands resolve the registry's published channel, while this release check stays pinned.

Only after final artifact/public installation verification may the maintainer describe 0.3.0 as published and close [issue #12: Verify pricing for opencode/muse-spark-1.3-contributor-free](https://github.com/BitL8-ByteShort/opencode-model-control/issues/12). Keep the issue open while publication is blocked; do not use automatic issue-closing PR wording before this gate. Historical candidate results remain historical and do not become final-byte evidence.
