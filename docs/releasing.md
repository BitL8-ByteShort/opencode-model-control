# Release checklist

This is a maintainer checklist, not a claim that every distribution channel has been published. The canonical public repository is `https://github.com/BitL8-ByteShort/opencode-model-control`; a version in `package.json` is still not evidence that the package exists on npm.

## 1. Establish the public project identity

- Confirm the canonical public repository remains under the intended owner and is publicly readable.
- Confirm that the repository includes `LICENSE`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`.
- Enable private vulnerability reporting on the repository host.
- Add `repository`, `homepage`, and `bugs` fields to `package.json` only after their exact public URLs exist.
- Open every public link while signed out. Do not publish guessed, private, redirected, or placeholder links.
- Confirm that the package name is available and that the intended owner controls its npm scope or unscoped name.

## 2. Run the release gates

Use Node.js 22.12.0 (the minimum supported release) and a current Node.js 24 LTS release:

```sh
npm ci
npm run verify
npm audit
npm pack --dry-run
```

Review the dry-run file list for credentials, local state, receipts, backups, test artifacts, and files outside the documented package surface. Record the operating system, architecture, Node version, exact OpenCode version, test result, build result, audit result, and package contents.

Create the final tarball once, calculate its SHA-256 checksum, and carry that exact file through packaged acceptance, npm publication, and the GitHub release. Do not rebuild separately for each channel.

An installed connection receipt is not artifact-authenticity evidence: it records exact managed config values and a managed-surface version but does not hash the package files at its recorded paths. Use the single tarball checksum and npm registry integrity for release provenance.

## 3. Test the packaged experience

Test in a disposable account, virtual machine, or isolated OpenCode configuration—not against a maintainer's everyday config.

1. Install the exact packed artifact in a clean environment.
2. Confirm `opencode-model-control` starts and binds only to `127.0.0.1`.
3. Confirm the automatic browser launch receives a private write-enabled URL, stores its token in tab-scoped `sessionStorage`, and immediately removes the query token from the address bar. Verify the bare URL is read-only and a server restart invalidates the previous token.
4. Confirm every API `POST`, `PUT`, `PATCH`, and `DELETE` rejects a missing or wrong same-origin `Origin`, JSON content type/body, `X-OMC-Request: 1`, or `X-OMC-Session` token. Verify interactive `--no-open` prints the private URL with a keep-private warning and non-interactive `--no-open` prints only the public read-only URL. Ensure the private URL/token never appears in logs or release evidence.
5. Confirm **Update available models** completes or reports an honest incomplete/failure state without invoking a model.
6. Exercise Connect, restart OpenCode, `status`, Disconnect, and a second restart.
7. Confirm the canonical local plugin entry loads, an `omc-router` media turn selects a saved vision model with matching modality, text-output, and tool-call capabilities without a manual subagent mention, and an unsafe or incompatible route fails closed.
8. Confirm an eligible code task follows code worker -> read-only reviewer -> no more than one review-driven repair; verify the reviewer cannot use a shell, edit, write, or recursively delegate.
9. Test both default-agent cases: an existing user `default_agent` remains unchanged, while an empty config can add and later remove only the receipt-owned `omc-router` default.
10. Confirm unrelated JSONC settings, plugin entries, and comments survive, the backup and receipt use mode `0600`, and ownership conflicts fail closed.
11. Confirm the installed command still works from a normal non-interactive OpenCode launch where the developer shell's `PATH` is unavailable.

Do not use a paid model invocation as an install test. Provider access and billing are separate from catalog refresh and MCP connection.

The optional manual runtime access check is also separate. Run one bounded OpenCode check only in a disposable provider account after explicitly accepting the possible provider retries and cost/data terms. Record the run and any observable attempt metadata without claiming exactly one provider call, and never treat it as a benchmark or release-quality score.

## 4. Prepare an immutable public release

- Choose the release version and update the changelog or release notes.
- Confirm the working tree contains only intended release content.
- Confirm the repository's immutable-release setting is enabled before publication. This setting is not retroactive.
- Protect the exact version tag pattern against force updates and deletion before creating the release tag.
- Create the GitHub release as a draft first. Attach the exact final tested tarball and its checksum file while the release is still a draft.
- Verify the draft's tag target, notes, asset names, downloaded checksum, and package contents before publishing it. The published release must need no later asset or tag edit.
- Publish the exact tested tarball to npm with public access only when registry authorization and ownership are available. Verify the registry's version, integrity, and contents before claiming npm completion.
- Publish the finalized GitHub draft only when every attached artifact and checksum is final. Verify that GitHub reports the release immutable.
- Never replace a published asset, move or reuse a published tag, or delete and recreate a release to revise it. Any correction receives a new version, new tag, new artifacts, and a new auditable release.
- Do not describe GitHub or npm publication as complete until each service returns the expected public artifact.

## 5. Verify the public release

- Download the exact public GitHub release asset and, when published, view the exact npm version. Install each claimed channel in a new clean environment.
- Run the packaged startup, refresh, Connect, restart, status, Disconnect, and restart flow again.
- Recheck the media plugin, bounded code/review workflow, default-agent preservation, and receipt-owned uninstall behavior from the public artifact.
- Verify the published GitHub asset checksum and npm registry integrity against the single final tarball tested before publication.
- Verify the repository, homepage, issue, security-reporting, license, and npm links while signed out.
- Confirm the README commands match the published package and supported OpenCode version.
- Only then replace the README's pre-release warning with links to the verified release locations.

If any gate fails, leave publication status unverified, preserve the evidence, and fix the smallest responsible issue before retrying.
