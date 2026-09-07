# Release packages

This ledger records verified release tarballs and their SHA-256 digests. npm is the default install channel after registry verification. Historical copies remain in this directory; 0.3.0 links to the exact public artifact instead of adding another binary copy to the repository.

Each final tarball is produced once with `npm pack` from clean protected main, then tested on the installed-artifact matrix. Its checksum is recorded externally after the artifact is built; a ledger update does not rebuild or change the release bytes.

## 0.3.0

- File: `opencode-model-control-0.3.0.tgz`
- SHA-256: `26a532b44c96d643c0543a78d2fef1ab2c1a3b83886e6715cef0ab683d3413ab`
- Source commit: [`bcd228a349627523382dda65017bab6fb0a4856c`](https://github.com/BitL8-ByteShort/opencode-model-control/commit/bcd228a349627523382dda65017bab6fb0a4856c)
- Source tag: [`v0.3.0`](https://github.com/BitL8-ByteShort/opencode-model-control/releases/tag/v0.3.0) (immutable GitHub release).
- Downloads: [GitHub tarball](https://github.com/BitL8-ByteShort/opencode-model-control/releases/download/v0.3.0/opencode-model-control-0.3.0.tgz), [npm tarball](https://registry.npmjs.org/opencode-model-control/-/opencode-model-control-0.3.0.tgz), or [npm package 0.3.0](https://www.npmjs.com/package/opencode-model-control/v/0.3.0).
- Release evidence: [SHA256SUMS](https://github.com/BitL8-ByteShort/opencode-model-control/releases/download/v0.3.0/SHA256SUMS), [pack evidence](https://github.com/BitL8-ByteShort/opencode-model-control/releases/download/v0.3.0/pack-evidence.json), [final matrix evidence](https://github.com/BitL8-ByteShort/opencode-model-control/releases/download/v0.3.0/acceptance-evidence.zip), and [public npm verification](https://github.com/BitL8-ByteShort/opencode-model-control/releases/download/v0.3.0/npm-public-verification.zip).
- Final acceptance: [CI run 34146977662](https://github.com/BitL8-ByteShort/opencode-model-control/actions/runs/34146977662), with the exact matrix and test boundaries in [support evidence](../docs/support-matrix.md).

Both public downloads match the final SHA-256, and npm registry SHA-512 integrity matches. Both downloaded tarballs passed the full installed-artifact acceptance on 2026-09-07. A clean `opencode-model-control@0.3.0` npm name install also reported CLI 0.3.0 and matched all 74 package files. See [support evidence](../docs/support-matrix.md) for the executed public-channel matrix.

## 0.2.1

- File: `opencode-model-control-0.2.1.tgz`
- SHA-256: `b0c0e161bec91ac384d12336d9786aa41870a65d3a291a72760a1e84fb3a489c`
- Source tag: `v0.2.1`

## 0.2.0

- File: `opencode-model-control-0.2.0.tgz`
- SHA-256: `59c6094a9b7dd57b897ee59c41269b154861de408db7c138c22725d17a1e67df`
- Source tag: `v0.2.0`

## 0.1.2

- File: `opencode-model-control-0.1.2.tgz`
- SHA-256: `b8ac329f72fd351159e4f1c86a739bdc7005b96b8d4a7f793580edd5929d5aee`
- Source tag: `v0.1.2`
