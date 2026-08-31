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

Use the minimum supported Node.js release and a current supported Node.js release:

```sh
npm ci
npm run verify
npm audit
npm pack --dry-run
```

Review the dry-run file list for credentials, local state, receipts, backups, test artifacts, and files outside the documented package surface. Record the operating system, architecture, Node version, exact OpenCode version, test result, build result, audit result, and package contents.

## 3. Test the packaged experience

Test in a disposable account, virtual machine, or isolated OpenCode configuration—not against a maintainer's everyday config.

1. Install the exact packed artifact in a clean environment.
2. Confirm `opencode-model-control` starts and binds only to `127.0.0.1`.
3. Confirm **Update available models** completes or reports an honest incomplete/failure state without invoking a model.
4. Exercise Connect, restart OpenCode, `status`, Disconnect, and a second restart.
5. Confirm unrelated JSONC settings and comments survive, the backup and receipt use mode `0600`, and ownership conflicts fail closed.
6. Confirm the installed command still works from a normal non-interactive OpenCode launch where the developer shell's `PATH` is unavailable.

Do not use a paid model invocation as an install test. Provider access and billing are separate from catalog refresh and MCP connection.

## 4. Publish only after authorization

- Choose the release version and update the changelog or release notes.
- Confirm the working tree contains only intended release content.
- Create the signed tag and public repository release.
- Publish the exact tested artifact to npm with public access.
- Do not describe GitHub or npm publication as complete until each service returns the expected public artifact.

## 5. Verify the public release

- View the exact version on npm and install it in a new clean environment.
- Run the packaged startup, refresh, Connect, restart, status, Disconnect, and restart flow again.
- Verify the repository, homepage, issue, security-reporting, license, and npm links while signed out.
- Confirm the README commands match the published package and supported OpenCode version.
- Only then replace the README's pre-release warning with links to the verified release locations.

If any gate fails, leave publication status unverified, preserve the evidence, and fix the smallest responsible issue before retrying.
