# Support matrix

This matrix describes implemented 0.4.0 behavior and dated compatibility evidence. Source verification, final installed-artifact acceptance, and public-channel verification are separate claims. See [Releasing](releasing.md) for the final-byte gates and the [release index](https://github.com/BitL8-ByteShort/opencode-model-control/releases) for published versions.

## 0.4.0 verification boundary

The release targets the same Linux/macOS and Node 22.12.0/24.x matrix, with OpenCode 1.18.22 and 1.18.28. Candidate [CI run 34304377304](https://github.com/BitL8-ByteShort/opencode-model-control/actions/runs/34304377304) verified 20 host scenarios and 57 synthetic loopback requests per host, 14 production browser interactions, and actual 0.3.0 Free/Paid upgrades plus legacy 0.2.1 coverage under every OS/Node combination. This dated candidate result predates the final mixed-endpoint binding correction and is not final-byte evidence. Final and public-download evidence belongs with the immutable release assets after the release checklist passes; no additional platform claim is made here.

## Historical 0.3.0 platform and artifact evidence

Final [CI run 34146977662](https://github.com/BitL8-ByteShort/opencode-model-control/actions/runs/34146977662) passed all seven jobs on 2026-09-07 at source commit [`bcd228a349627523382dda65017bab6fb0a4856c`](https://github.com/BitL8-ByteShort/opencode-model-control/commit/bcd228a349627523382dda65017bab6fb0a4856c). The final 0.3.0 tarball was built once from that clean protected-main commit, and every installed-artifact job consumed the same bytes: SHA-256 `26a532b44c96d643c0543a78d2fef1ab2c1a3b83886e6715cef0ab683d3413ab`.

| OS/kernel | Architecture | Node versions executed | OpenCode versions executed |
| --- | --- | --- | --- |
| Linux 6.17.0-1022-azure | x64 | 22.12.0 and 24.20.0 | 1.18.22 and 1.18.28 under each Node version |
| macOS / Darwin 25.6.0 | arm64 | 22.12.0 and 24.20.0 | 1.18.22 and 1.18.28 under each Node version |

Each OS/Node job passed all 16 package checks, both real-host matrices (19 scenarios and 56 loopback provider requests per host), and all 12 interactions with the installed production UI, with zero failures, skips or flakes. Evidence binds host execution to the installed core/service/plugin and browser execution to the packaged HTML/JS/CSS hashes. The package flow also checks production startup without Vite, current install, actual prior-0.2.1 upgrade, private v3 migration, MCP, token rotation, read-only rejection, Connect/Disconnect and config restoration. Intentionally broken plugin/UI tarballs were rejected while healthy checkout source remained present.

These were **112 synthetic loopback provider requests per package run and zero real-provider inference requests**. Public Models.dev metadata smoke is separately labeled and makes no inference/quality claim. Linux source verification also passed all 293 tests, typecheck and build on both Node versions; source tests alone do not establish installed-package behavior.

The [immutable GitHub release](https://github.com/BitL8-ByteShort/opencode-model-control/releases/tag/v0.3.0) contains [final matrix evidence](https://github.com/BitL8-ByteShort/opencode-model-control/releases/download/v0.3.0/acceptance-evidence.zip) and [public npm verification](https://github.com/BitL8-ByteShort/opencode-model-control/releases/download/v0.3.0/npm-public-verification.zip). On 2026-09-07, credential-free npm and GitHub downloads matched the final SHA-256 above; npm registry SHA-512 integrity also matched.

Each downloaded tarball passed all 16 package checks, both OpenCode hosts (19 scenarios and 56 loopback requests each), and all 12 production browser interactions with zero failures, skips or flakes. Each public-channel run used Linux x64 kernel 6.8.0-138-generic and Node 22.12.0, separately from the final CI matrix above, with 112 synthetic loopback requests and zero real-provider inference requests.

A clean version-pinned npm name install reported CLI 0.3.0 and all 74 package files matched the public tarball. Exact download links and checksums are in the [package ledger](../packages/README.md); the [public verification receipt](https://github.com/BitL8-ByteShort/opencode-model-control/issues/12#issuecomment-5574166395) records both channels and issue closure.

| Surface | Status | Boundary |
| --- | --- | --- |
| Node.js `>=22.12.0` | Package engine contract | The exact 22.12.0 minimum and 24.20.0 were executed above; other versions are not individually proven. |
| Linux x64 / macOS arm64 | Final 0.3.0 artifact verified | Only the recorded OS/kernel/runtime matrix is proven; this is not every distribution or architecture. |
| OpenCode 1.18.22 / 1.18.28 | Actual final-artifact dispatch verified | All owned roles, both media lanes, ordinary task/background resumes, retained repair/revocation, missing host models, endpoint conflicts, unrelated agents and owned slash summaries. |
| Other OpenCode versions/configuration majors | Unverified | Require explicit compatibility acceptance. |
| OpenCode TUI/server host | Tested through actual host APIs/events | Managed agents require a fresh host after initial Connect or a managed-surface update. |
| Headless HTTP-only callers | Limited error guidance | Missing-host errors may be generic `UnknownError`; consume the same-directory instance event stream for the reload toast text. |
| OpenCode desktop | Unverified separately | CLI/server evidence does not prove desktop application behavior. |
| WSL / native Windows / other architectures | Unverified | No new platform support claim is made. |
| npm / GitHub final 0.3.0 artifacts | Public downloads and installed acceptance verified | Both downloaded tarballs match the final SHA-256 and passed the separate Linux/Node 22.12.0 acceptance described above; GitHub release is immutable. |

## Implemented behavior

| Surface | Contract | Boundary |
| --- | --- | --- |
| All-provider discovery | Plugin-aware `opencode models --verbose`, no provider filter | `--pure` fallback is explicitly incomplete; preserve last usable records. OpenCode may normalize its own `$schema` line. |
| Metadata refresh | Stale startup, every 15 minutes while active, or manual Update | Cross-process coalescing; separate attempted/successful timestamps; no inference or inferred settings/config writes. |
| Pricing | Exact provider/model/API match; complete rates across every supported supplied billing dimension | With complete valid evidence, any positive rate means paid; exact-zero valid public evidence means free; malformed/conflicting/expired pricing is unknown and cannot authorize Free or legacy verified-price Paid. Configured Paid uses eligible host connection evidence without requiring an estimate. No free-name roster. |
| Pricing freshness | 24-hour expiry evaluated at routing time | Successful 200/304 renews public evidence; failed requests do not. Neither the source nor OMC guarantees future billing. |
| Capabilities | Effective OpenCode report plus separate supplemental public report | Unknown differs from false; full modalities/tools/reasoning/options/structured-output/limits retained. Supplemental metadata cannot expand effective restrictions. |
| Inclusion | Default-on auto-include follows saved Free/Paid policy | Explicit disables win. Configured Paid permits future eligible configured models; explicit enables cannot bypass hard gates. |
| Saved intent | v4 policy/enabled/disabled controls, billing declarations and role bindings; private legacy backups | Preserve absent pins, disables and Paid policy; revision-aware Save prevents lost updates; refresh/conflicts retain drafts. |
| Live owned-role routing | Stable model-free agents, coherent saved state and pre-inference revalidation | Loaded A → B changes need no reconnect; explicit C absent from host inventory blocks until an explicit reload. No automatic disposal. |
| Media handling | Tool-free vision analysis; explicit user-authored code intent may retain router | Classifier reads at most 4,000 user-text characters and attachment type/MIME only; no attachment payload/location inspection. |
| Delegation and repair | Bounded worker → independent read-only reviewer → one authorized repair | Current runtime guards and exact completion evidence; synthesis remains model-guided; no restart-durable workflow claim. |
| Owned slash summaries | Narrow exact-message one-shot grant after matching child completion | Changed parent pin blocks the stale inherited summary; no general synthetic-message bypass. |
| Connect/Disconnect | Receipt-owned managed surface 3, exact MCP preflight, private backup, conflict refusal | Preserves unrelated JSONC/plugins/defaults; receipt is ownership evidence, not package authenticity. |
| Usage | Fixed local aggregate query, 7/30/90-day or all-time windows | OpenCode-recorded cost is not an invoice. Captured records retain historical billing and binding, nullable token/cost fields and currency; no prompt/content projection. Quota and estimates remain unreported without evidence. |
| Runtime access check | Explicitly acknowledged bounded synthetic OpenCode run | OpenCode may retry; can incur real costs/retention; never automatic or quality evidence. |
| Ranking and benchmark qualification | Existing ranking and curated restrictions retained | No new winner, benchmark campaign, or quality promotion. |
| Provider authentication integrations | Deferred | OpenCode retains credentials/authentication authority; no direct OpenRouter account/catalog integration. |

“Free” does not imply private inference, unlimited use, entitlement, uptime, or perpetual pricing. Model names and availability can change. The running catalog, current connection evidence and saved policy govern eligibility. Free and legacy verified-price Paid additionally require unexpired exact pricing evidence; no hardcoded free-model list authorizes access.
