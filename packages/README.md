# Release packages

This directory carries checksum-recorded copies of verified public release packages. npm is the default install channel after registry verification; these tarballs remain available for version-pinned direct installation and independent checksum comparison.

Each tarball is produced with `npm pack` only after the full release gate passes. Its filename, version, and SHA-256 digest are recorded here so users can verify a direct download before installation.

## 0.3.0 preparation

No final 0.3.0 tarball or checksum is recorded here yet. The release controller must build once from clean protected main, test those exact bytes on the complete installed-artifact matrix, and verify both public channels before adding a final ledger entry. Candidate hashes are recorded separately in [support evidence](../docs/support-matrix.md); a candidate with package version 0.2.1 is not either the historical public 0.2.1 package or the final 0.3.0 release.

The final checksum belongs in the release assets/evidence and a subsequent ledger update; do not embed a tarball's own checksum into files inside that tarball or rebuild it to update the ledger.

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
