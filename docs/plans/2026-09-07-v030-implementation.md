# OpenCode Model Control 0.3.0 implementation

## Authority and outcome

The user approved the full 0.3.0 release plan in the current Codex task on 2026-09-07, including public npm/GitHub publication, protected-main integration, Linux/macOS acceptance, and closing issue #12 only after release verification. Implementation and review use gpt-6-astra with high reasoning. This document decomposes that approved plan; it does not narrow it.

New free and paid models must acquire pricing, reported capabilities, and eligibility without a new Model Control release. New identities automatically follow the saved cost policy. Existing disabled choices and pins remain respected. Live changes apply where supported; a running OpenCode instance that has not loaded a newly introduced ID gets guided reload, never automatic disposal or interruption.

## Global Constraints

- Preserve unrelated OpenCode configuration, user credentials, sessions, UI layout, and workloads. No real paid-provider requests or benchmark promotion. Public metadata HTTP requests are allowed and credential-free.
- Do not use model names, family/version guesses, or a fixed roster to establish free pricing. Exact provider/model identities and trustworthy rate provenance are required. Unknown pricing remains blocked.
- Refresh interval: 15 minutes. Pricing expiry: 24 hours from successful source retrieval/revalidation. Failed discovery/fetches cannot advance successful timestamps or erase usable snapshots.
- New settings schema: 3. New catalog schema: 2. Preserve legacy true/false controls as explicit choices. Preserve requested pins even while blocked.
- Changes stay on bitL8byteShort/omc-v0.3.0 in /tmp/opencode-model-control-v030. Use DCO signed-off commits. No global package upgrade or writes to everyday OpenCode/Model Control settings for tests.
- Tests use isolated directories and local fake providers. Test fixtures must not enable a production runtime bypass or send title/compaction traffic to real providers.
- Real OpenCode dispatch acceptance must cover 1.18.22 and 1.18.28. Package acceptance must cover Linux and macOS, with Node 22.12.0 and 24.x coverage.
- Publish one final tested tarball to both npm 0.3.0 and immutable GitHub v0.3.0, then verify the downloaded artifacts. No tag/asset replacement. Do not claim an incomplete gate passed.
- Each implementer does its own bounded task; no implementer may spawn subagents. Controller dispatches independent review and handles release coordination.

## Task 1: Dynamic pricing and capability catalog

Replace fixed-roster zero-price trust with independent raw provider-specific Models.dev evidence and extend catalog v2. Own core pricing/catalog, verbose parsing/merge, public metadata adapter/cache, schemas, and their focused tests. Preserve interfaces used by later tasks through explicit adapters, and report them.

- Fetch https://models.dev/api.json without credentials with a bounded timeout, response-size limit, fixed endpoint, schema validation, ETag/Last-Modified revalidation, normalized evidence, and private atomic cache writes. No URLs obtained from metadata are fetched. Retain digest, source identity, successful fetchedAt/expiresAt, and attemptedAt separately. Use dependency injection for clocks/HTTP/filesystem seams in tests; no test environment bypass in production.
- Split a model ID at the first slash only. Match exact provider and full model key, including api.id/url/npm identity. Raw absent cost differs from explicit 0. Explicit finite nonnegative input/output are required; account for reasoning/cache/audio rates, context tiers, legacy over-200k, and mode rates. All supplied supported rates zero => free; any positive => paid; missing/malformed/unsupported/conflicting rates => unknown. Fresh evidence supersedes bundled/prior evidence. CLI-positive paid evidence may be labeled reported-paid for compatibility only when complete and nonconflicting; CLI zero alone never establishes free.
- Catalog v2 adds pricing source/rates/class/reasons/freshness, revision, API identity, and capability details. Avoid indefinite renewal of legacy verifiedAt during CLI refresh. Expiry is evaluated at routing time, not solely on refresh.
- Preserve OpenCode effective input/output and tool capability restrictions. Report reasoning, structured output, context and output limits, sources/timestamps; explicit false and unknown differ. Supplemental public metadata must not expand effective routing capabilities. Derive compatible roles dynamically without requiring benchmarks. Preserve existing quality ranking/provenance; no quality promotion.
- Retain bundled defaults as descriptive/offline fallback, not perpetual pricing authorization. Migrate old catalog snapshots without discarding models or inventing source freshness. Update JSON schemas and existing tests for intentional version/semantics changes.
- TDD regression coverage: Muse 1.3 and generic unseen free/paid IDs without adding a hardcoded entry, nested IDs, every billing dimension, malformed/missing/zero, repricing, expiry/revalidation, failures, identity conflicts, unknown/false capabilities, and redaction.
- Run focused tests while iterating and the available full baseline checks before committing. Document any failure requiring a subsequent task versus a regression introduced here; do not hide failures.

## Task 2: Saved policy, automatic enrollment, and refresh coordination

Build on Task 1's interfaces. Own core settings/planner, service/stores, API state/settings contracts, MCP snapshot reload, and related tests. Do not implement UI or plugin changes yet; document contracts for them.

- Settings v3: autoIncludeNewModels=true by default; per-model selection is policy/enabled/disabled. Legacy Boolean controls migrate to explicit enabled/disabled choices. New identities inherit policy even while unknown/unavailable; effective enablement follows current cost/availability gates without refresh writing inferred choices. Migration is atomic with private backups. Preserve paid preference, pins, delegation settings, and existing controls.
- Separate structural saved intent validation from live eligibility. Keep blocked pins rather than replacing them with auto; reject newly edited ineligible selections, but permit unrelated edits preserving existing blocked pins. Only required roles gate a route. Retain unavailable catalog entries so selections recover if models return.
- Settings/catalog revisions: expected settings revision on Save. Revalidate/rebase against current catalog, merging untouched newly discovered models; meaningful edit conflicts return 409 with bounded reasons, retaining client draft. Use cross-process-safe writes and coherent snapshot reads. No lost updates.
- Refresh stale metadata at startup and every 15 minutes while panel/MCP is active. Use a shared on-disk refresh lease and in-process coalescing; preserve snapshots and separate attempt/success/incomplete/failure states. A successful pricing fetch may revoke free eligibility even if CLI discovery is incomplete. Refresh modifies metadata only, never saved intent or OpenCode configuration. Stop timers and release leases cleanly.
- Existing MCP processes must reload catalog and settings before tools, exposing policy/catalog revisions, effective model eligibility, per-role blocked reasons, and workflow limits without private data. Preserve MCP read-only tool behavior.
- TDD coverage: migrations, auto enrollment before/after price resolution and policy changes, pins, unrelated blocked roles, settings CAS/rebase, simultaneous processes, retained snapshots, failed-source age, timer shutdown, and panel-to-existing-MCP propagation.

## Task 3: Stable agents and live owned-role dispatch

Build on Task 2. Own generated config/installer integration surface, plugin runtime, MCP live policy contract as needed, and corresponding unit/contract tests. Update managed-surface version from 1 to 2 and preserve connector ownership safety.

- Generate the same four stable agents with generic role instructions, fixed permissions, no resolved model assignments embedded in configuration, and live workflow limits read through MCP. Ordinary settings saves/metadata changes must not require regenerated model configuration. Default-agent and permission/instruction/plugin changes remain managed update/restart operations.
- Extend chat.message to primary and all owned specialists. Load a coherent saved policy, derive role/media requirements, apply exact model reference before dispatch, clear incompatible variants. Unrelated agents are untouched.
- Use the plugin client for GET /config/providers scoped to its directory, via client.config.providers({query:{directory},throwOnError:true}); result.data.providers is the running host inventory. Do not use /provider (it merges broader Models.dev data). Automatic selection intersects host-loaded eligible candidates; missing explicit host pin gives reload guidance before provider request.
- chat.params receives effective model and provider options in memory: validate canonical source/model/endpoint identity before inference. Emit only bounded reason codes, never options/headers/credentials/arbitrary endpoint URLs. Harmless credential/timeout configuration alone is not conflict.
- Preserve exact model per resumed code-worker child/workflow for repair. Revalidate retained model against current eligibility and block if revoked; do not silently replace it. New independent tasks use new policy. Existing in-flight provider requests are not interrupted.
- Preserve media-only hard permission/tool denial, attachment-as-untrusted-data treatment, reviewer read/search-only permissions, specialist non-recursion and current repair/delegation limits. No arbitrary task model override API or automatic instance disposal.
- Cover unit/contract behavior across owned roles, host intersections, blocked pins, variants, resumed repairs, updated gates, missing/corrupt policy, media lanes, credentials redaction, and unrelated sessions. Task 5 independently proves actual host dispatch; hook-object tests are insufficient for release.

## Task 4: Panel integration and browser behavior

Build on completed backend/plugin contracts. Own UI, meaningful browser tests, and browser-test scripts/dependencies. Retain the current responsive layout.

- Add automatic-inclusion setting beside Free/Paid. Use tri-state intent/effective state correctly; an enabled ineligible model can always be switched off.
- Preserve unsaved edits and saved baselines across manual/background metadata refresh, concurrent save, delayed/stale responses, and conflict recovery. Poll current state while visible and refresh stale metadata through authorized action on return; GET stays observational. Do not call installation as a side effect of metadata refresh or ordinary role Save. Default-agent changes alone retain explicit managed update flow.
- Show exact eligibility reasons instead of generic not-eligible labels, preserve blocked pins visibly, expose host reload versus plugin update status accurately, and distinguish refresh attempts/success/incomplete/failure.
- Automatically display full input/output lists, tools, reasoning, structured output, context/max output, compatible roles, and source/age; unknown is Not reported, explicit false is unsupported. Remove six-tag truncation using expandable details. Add model search and provider/capability filters.
- Exercise actual browser interactions against isolated controlled fixtures: edit-during-refresh, save race/conflict, new model appears with capabilities, select+Save, Free/Paid auto enrollment, blocked toggle disable, pin preservation, filters/details, desktop/mobile, and read-only panel behavior. Use pinned development dependencies, no live user profile or private panel tokens in evidence.

## Task 5: Actual OpenCode dispatch and package acceptance

Own isolated host integration harness, CI matrix, and acceptance tooling/tests. Do not narrow the existing host test requirement to hook-object assertions.

- Exercise real OpenCode 1.18.22 and 1.18.28 processes against a local fake provider with recorded actual request model IDs. Seed isolated explicit fixture pricing/identity evidence through filesystem fixtures, never production test bypasses. Isolate all directories, config, credentials, external plugins, helpers, title/compaction models, and network calls.
- Start once with models A and B loaded. Primary and owned specialists send A; change saved roles to B and verify subsequent actual requests use B without config write or process restart. Cover task child, resumed/background child, owned slash-command subtask, media-only and media-assisted code. Task wrapper metadata is not dispatch proof.
- Introduce C only after running host initialization; refresh/enroll it in Model Control, verify missing pinned C yields reload guidance and zero invalid provider requests. Automatic routing still uses eligible loaded choices. Never dispose the host automatically. Verify resumed repair exact model and revalidation, revoked/unknown/unavailable controls, and unrelated concurrent sessions.
- Add CI coverage on Linux/macOS and Node 22.12.0/24.x. Cover clean installs, production startup, token rotation/read-only panel, catalog metadata smoke check, connect/update/restart/status/disconnect/restart, config preservation, private backup/receipt/migration permissions, MCP handshake, and public tarball install acceptance. Label mocked dispatch versus live public metadata explicitly; no paid calls or quality claims.
- Establish runnable verification commands and machine-readable/redacted evidence; controller will use them for exact final tarball publication. Resolve rather than suppress genuine test failures.

## Task 6: Documentation, final review, and immutable release

Own documentation, release version updates and release-package/CI acceptance follow-through under controller coordination.

- Update README, architecture, integration, benchmark boundaries, security/threat model, support matrix, contribution/release docs, and changelog for actual 0.3.0 behavior, metadata egress, source trust, 15-minute refresh/24-hour expiry, capabilities, migration/recovery, auto inclusion, live role changes and genuine host reload limits. No unsupported platform or quality claims.
- Run clean checks, browser tests, host dispatch matrix, dependency audit and package-content review. Perform independent whole-branch code/spec/security review and fix material findings before merge.
- Ship reviewed PR through protected main with DCO commits and passing checks. Build one final v0.3.0 tarball, checksum it, carry exact artifact through Linux/macOS packaged acceptance, npm publication, and immutable GitHub release. Use a draft release to stage finalized assets and protected tag before publication. Verify both downloaded public artifacts match the tested bytes and public install paths.
- Close issue #12 only after verified publication. No global everyday-install update is part of this plan. If an external publication/CI authorization is unavailable, complete all unaffected implementation/review gates and report the exact remaining external action without claiming release completion.

## Deferred

Broader redesign, model-quality ranking changes, benchmark campaigns, authentication integrations, native Windows/new platform claims, and automatic OpenCode instance disposal.
