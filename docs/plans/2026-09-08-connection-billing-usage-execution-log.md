# Connection Billing Execution Log

**Branch:** `codex/connection-billing-usage`
**Baseline HEAD:** `b931cbc3218b028c5060aaa3eb7997d189dc9ea3` (`main`, package 0.3.0)
**Started:** 2026-09-08
**Executor:** Grok 4.6

## Environment

| Item | Value |
| --- | --- |
| Node | v26.8.1 (`/home/panda927/.local/bin/node`) |
| npm | 11.19.0 |
| OpenCode | 1.18.28 |
| Platform | linux |
| Remote | `https://github.com/BitL8-ByteShort/opencode-model-control.git` |

Node is not 22.12.0 or 24.x. Recorded as an environment limitation; diagnose product vs environment failures separately. `engines` is `>=22.12.0`.

## Preserved working-tree patch

Saved to `docs/plans/2026-09-08-working-tree-preserved.patch` (82 lines). Original uncommitted files:

- `src/core/pricing.js`
- `src/server/opencode-cli.js`

**Disposition:** both hunks **excluded** from the worktree.

- `pricing.js`: loosened public-URL matching so a live URL is accepted when models.dev omitted the URL. Plan §1.1 / §3.3: an unknown public endpoint must not certify an arbitrary custom endpoint.
- `opencode-cli.js`: allowed positive CLI costs to override an identity conflict. Plan §1.1: positive recorded costs do not prove matching route identity.

These are not verified fixes. The correct Task 2 contract treats raw `''`/absent/null as an unspecified SDK default without relaxing public-price identity.

## Task 1

- `git status --short` at start: `M src/core/pricing.js`, `M src/server/opencode-cli.js`, untracked plan.
- HEAD `b931cbc3218b028c5060aaa3eb7997d189dc9ea3`, package 0.3.0, branch created `codex/connection-billing-usage`.
- Patch saved; both hunks excluded (see above).
- `npm ci`: 44 packages, 0 vulnerabilities.
- `npm run verify` on Node v26.8.1: 2 failures (production-entry timeout; lock recovery `typeof release` object vs function). Environment, not product.
- `npm run verify` on `/usr/bin/node` v24.14.0: 292 pass, 1 fail — `test/server/production-entry.test.js` times out waiting for `/OpenCode Model Control:/`. Only output is Node `--experimental-loader` deprecation warning. Pre-existing environment limitation. Subsequent work uses Node 24.
- Failing regressions added and confirmed:
  - empty `url: ''` => `urlValid: false` (`{"url":""}` false !== true)
  - `xai/grok-4.6` empty SDK default => `unknown` !== `paid`
  - CLI parse empty URL `urlValid` false !== true
  - cached invalid then fresh empty discovery still `urlValid` false
  - provider-owned fetch => `OMC_DISPATCH_IDENTITY_CONFLICT`
- Guard that already passed on HEAD: custom gateway cannot inherit unspecified public rates / CLI cost cannot override mismatch.

## Task 2

**Files:** `src/core/pricing.js`, `src/server/opencode-cli.js`, `test/core/pricing.test.js`, `test/server/opencode-cli.test.js`, `test/server/catalog-v2.test.js`, `test/fixtures/public-metadata.js`

**Fix:** Treat raw `''` / absent / null as unspecified SDK default (`url: null`, `urlValid: true`) unless cached `urlValid: false`. Malformed, whitespace, credential, and query endpoints remain invalid. Public rate matching uses exact id/npm/url; missing public URL does not certify a custom gateway (`public-price-route-mismatch`). CLI cost cannot override that mismatch.

**Commands:** `node --test test/core/pricing.test.js test/server/opencode-cli.test.js test/server/models-dev.test.js test/server/catalog-v2.test.js` — 38 pass, 0 fail.

**Remaining:** provider-owned fetch still blocked (Task 5). Fetch regression left unstaged for that task.

## Task 3

