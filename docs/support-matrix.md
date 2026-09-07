# Support matrix

This matrix describes implemented 0.3.0 behavior and dated compatibility evidence. Source versions, candidate CI, and final public artifacts are separate claims. See [Releasing](releasing.md) for the final-byte gates and the [release index](https://github.com/BitL8-ByteShort/opencode-model-control/releases) for published versions.

## Platform and artifact evidence

Corrected [CI run 34135803892](https://github.com/BitL8-ByteShort/opencode-model-control/actions/runs/34135803892) passed the installed-artifact matrix on 2026-09-07 at source commit `0e2ea30`. Every job consumed the same candidate tarball, SHA-256 `f709991f6da74da2730cecc525cb7e1d188fd482ac29a42e2b9b0a0588b5a2f8`. This was 0.3.0 candidate code still carrying package version **0.2.1**, not final 0.3.0 bytes or the historical public 0.2.1 artifact. Initial CI run 34134319692 predates the installed-artifact correction and is not this proof.

| OS/kernel | Architecture | Node versions executed | OpenCode versions executed |
| --- | --- | --- | --- |
| Linux 6.17.0-1022-azure | x64 | 22.12.0 and 24.20.0 | 1.18.22 and 1.18.28 under each Node version |
| macOS / Darwin 25.6.0 | arm64 | 22.12.0 and 24.20.0 | 1.18.22 and 1.18.28 under each Node version |

Each OS/Node job passed all 16 package checks, both real-host matrices (19 scenarios and 56 loopback provider requests per host), and all 12 interactions with the installed production UI, with zero failures, skips or flakes. Evidence binds host execution to the installed core/service/plugin and browser execution to the packaged HTML/JS/CSS hashes. The package flow also checks production startup without Vite, current install, actual prior-0.2.1 upgrade, private v3 migration, MCP, token rotation, read-only rejection, Connect/Disconnect and config restoration. Intentionally broken plugin/UI tarballs were rejected while healthy checkout source remained present.

These were **112 synthetic loopback provider requests per package run and zero real-provider inference requests**. Public Models.dev metadata smoke is separately labeled and makes no inference/quality claim. Linux source verification also passed on both Node versions; source tests alone do not establish installed-package behavior.

No final 0.3.0 digest is asserted by this dated candidate record. After the version/docs commit and protected-main merge, release acceptance must execute on the one final tarball before publication, and both downloaded public artifacts must match it. Final evidence belongs with the release assets; a prior candidate pass must never be relabeled as final-byte proof.

| Surface | Status | Boundary |
| --- | --- | --- |
| Node.js `>=22.12.0` | Package engine contract | The exact 22.12.0 minimum and 24.20.0 were executed above; other versions are not individually proven. |
| Linux x64 / macOS arm64 | Candidate artifact verified | Only the recorded OS/kernel/runtime matrix is proven; this is not every distribution or architecture. |
| OpenCode 1.18.22 / 1.18.28 | Actual candidate dispatch verified | All owned roles, both media lanes, ordinary task/background resumes, retained repair/revocation, missing host models, endpoint conflicts, unrelated agents and owned slash summaries. |
| Other OpenCode versions/configuration majors | Unverified | Require explicit compatibility acceptance. |
| OpenCode TUI/server host | Tested through actual host APIs/events | Managed agents require a fresh host after initial Connect or a managed-surface update. |
| Headless HTTP-only callers | Limited error guidance | Missing-host errors may be generic `UnknownError`; consume the same-directory instance event stream for the reload toast text. |
| OpenCode desktop | Unverified separately | CLI/server evidence does not prove desktop application behavior. |
| WSL / native Windows / other architectures | Unverified | No new platform support claim is made. |
| npm / GitHub final 0.3.0 artifacts | Separate publication gate | Consult the actual public channels and their final artifact evidence; candidate CI is not publication. |

## Implemented behavior

| Surface | Contract | Boundary |
| --- | --- | --- |
| All-provider discovery | Plugin-aware `opencode models --verbose`, no provider filter | `--pure` fallback is explicitly incomplete; preserve last usable records. OpenCode may normalize its own `$schema` line. |
| Metadata refresh | Stale startup, every 15 minutes while active, or manual Update | Cross-process coalescing; separate attempted/successful timestamps; no inference or inferred settings/config writes. |
| Pricing | Exact provider/model/API match; complete rates across every supported supplied billing dimension | With complete valid evidence, any positive rate means paid; exact-zero valid public evidence means free; malformed/conflicting/expired pricing is unknown and blocked. No free-name roster. |
| Pricing freshness | 24-hour expiry evaluated at routing time | Successful 200/304 renews public evidence; failed requests do not. Neither the source nor OMC guarantees future billing. |
| Capabilities | Effective OpenCode report plus separate supplemental public report | Unknown differs from false; full modalities/tools/reasoning/options/structured-output/limits retained. Supplemental metadata cannot expand effective restrictions. |
| Inclusion | Default-on auto-include follows saved Free/Paid policy | Explicit disables win. Saved Paid permits future eligible known-paid models; explicit enables cannot bypass hard gates. |
| Saved intent | v3 policy/enabled/disabled controls; private legacy backups | Preserve absent pins, disables and Paid policy; revision-aware Save prevents lost updates; refresh/conflicts retain drafts. |
| Live owned-role routing | Stable model-free agents, coherent saved state and pre-inference revalidation | Loaded A → B changes need no reconnect; explicit C absent from host inventory blocks until an explicit reload. No automatic disposal. |
| Media handling | Tool-free vision analysis; explicit user-authored code intent may retain router | Classifier reads at most 4,000 user-text characters and attachment type/MIME only; no attachment payload/location inspection. |
| Delegation and repair | Bounded worker → independent read-only reviewer → one authorized repair | Current runtime guards and exact completion evidence; synthesis remains model-guided; no restart-durable workflow claim. |
| Owned slash summaries | Narrow exact-message one-shot grant after matching child completion | Changed parent pin blocks the stale inherited summary; no general synthetic-message bypass. |
| Connect/Disconnect | Receipt-owned managed surface 2, exact MCP preflight, private backup, conflict refusal | Preserves unrelated JSONC/plugins/defaults; receipt is ownership evidence, not package authenticity. |
| Usage | Fixed local aggregate query, 7/30/90-day or all-time windows | Recorded cost is an estimate, not an invoice; no prompt/content projection. |
| Runtime access check | Explicitly acknowledged bounded synthetic OpenCode run | OpenCode may retry; can incur real costs/retention; never automatic or quality evidence. |
| Ranking and benchmark qualification | Existing ranking and curated restrictions retained | No new winner, benchmark campaign, or quality promotion. |
| Provider authentication integrations | Deferred | OpenCode retains credentials/authentication authority; no direct OpenRouter account/catalog integration. |

“Free” does not imply private inference, unlimited use, entitlement, uptime, or perpetual pricing. Model names and availability can change. The running catalog and unexpired exact evidence govern eligibility, not a hardcoded list.
