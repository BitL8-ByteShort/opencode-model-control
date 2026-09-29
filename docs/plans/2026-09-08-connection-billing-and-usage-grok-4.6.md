# Connection Billing, Subscription Routing, and Usage — Implementation Plan

> **Executor: Grok 4.6.** This document is the complete handoff. Follow the checkbox tasks in order, inspect the repository before editing, and maintain an execution log with evidence. If the Superpowers skills are installed, use `superpowers:executing-plans`; otherwise use the equivalent checkpoints specified here. Steps use checkbox (`- [ ]`) syntax for tracking. No Codex-specific tool or subagent is required.

**Goal:** Let users select compatible models through their configured subscription, metered API, prepaid, gateway, or local connections without confusing missing cost estimates with permission to use a model. Preserve strict verified-free routing and report usage without inventing charges or quota.

**Architecture:** Separate model metadata, configured connections, access policy, and accounting. OpenCode remains the authority for the running provider inventory and execution transport. Public metadata supplies applicable prices and descriptive capabilities, never account entitlement. One shared eligibility function drives the panel, planner, MCP, and runtime.

**Tech Stack:** JavaScript ES modules, Node.js 22.12.0 and 24.x, React/TypeScript, existing Node test runner, Playwright, OpenCode plugin and MCP companion.

**Spec:** Sections 1–5 are the product and data contract. Sections 6–8 define implementation and acceptance. Where a host cannot expose information reliably, represent it as unknown and record the limitation; do not infer it from a provider name or normalized zero price.

**Proposed release:** 0.4.0. This is a change to billing policy and persisted data, not a replacement of the immutable 0.3.0 release. Confirm the latest repository/package version before choosing the final next version.

**Prepared:** 2026-09-08. Repository baseline observed at `b931cbc3218b028c5060aaa3eb7997d189dc9ea3` on `main`, package 0.3.0. Revalidate these facts when executing.

## Global constraints

- This artifact authorizes planning only. A future instruction to execute starts implementation; publishing requires the applicable release authorization at that time.
- Preserve existing disabled models, requested role assignments, automatic-inclusion preferences, unsaved panel edits, unrelated agents, sessions, and OpenCode configuration.
- Do not weaken Free mode to make a subscription work. A paid subscription is paid access even when OpenCode records zero token cost.
- Never silently switch from a subscription connection to metered API billing, including retries, repair/resume, and exhausted quota handling.
- Do not read, copy, log, hash, or export credentials to detect billing. Do not serialize transport functions, inspect their source, or monkeypatch production networking.
- Make no real paid-provider calls during automated acceptance. Use isolated loopback providers and synthetic credentials. Do not run title or compaction helpers against real providers.
- Keep automatic model discovery, capability enrichment, pricing freshness, settings revision checks, and existing permissions intact. Do not introduce model-name allowlists, benchmark campaigns, model-quality ranking changes, or a new authentication manager.
- The existing `CONTRIBUTING.md` requirement to block all unknown/expired pricing describes 0.3.0. This requested design deliberately changes that rule only for explicitly adopted configured-connection Paid access. Update the contribution/security documentation with the new contract; retain the old rule for Free and migrated legacy Paid. This is a product change, not permission to bypass dispatch identity checks.
- Commit with DCO sign-offs. Use protected-main PR review and the repository's branch policy. If no more specific policy exists, create a `codex/connection-billing-usage` branch. Do not edit protected main as the implementation workflow.
- Local source already contains uncommitted changes in `src/core/pricing.js` and `src/server/opencode-cli.js`. Preserve them before implementation and evaluate them explicitly; they are not verified fixes. Never reset or silently discard them.
- Put internal execution records under `docs/plans/`, matching this repository's existing convention and package exclusion. Do not ship credentials, local state, or test artifacts in npm packages.

## 1. The problem and reproduced evidence

The user connected `xai/grok-4.6` and saw Available alongside Unknown — Blocked, with Enable unavailable and no usable role assignment. The screenshot's pricing evidence was fresh and contained `identity-conflict`. Refreshing or selecting Policy did not resolve it.

Two independent failures were reproduced before this plan. Neither reproduction establishes successful real subscription dispatch.

### 1.1 Empty SDK-default endpoint is treated as an invalid identity

The observed raw OpenCode model had:

```js
{
  id: 'grok-4.6',
  api: { id: 'grok-4.6', npm: '@ai-sdk/xai', url: '' }
}
```

The saved catalog normalized this to `url: null, urlValid: false`. The exact Models.dev record had `url: null, urlValid: true`. Pricing evidence therefore became Unknown with `identity-conflict`, even though rates were available. Correcting the fresh empty endpoint to an absent SDK-default endpoint in an in-memory diagnostic produced Paid classification.

OpenCode 1.18.28's `fromModelsDevModel` can produce an empty URL when neither model nor provider supplies one. The xAI SDK then supplies its own default. See [provider implementation](https://github.com/anomalyco/opencode/blob/v1.18.28/packages/opencode/src/provider/provider.ts) and [xAI authentication implementation](https://github.com/anomalyco/opencode/blob/v1.18.28/packages/opencode/src/plugin/xai.ts).

Fix the fresh normalization boundary. Do not change every cached `urlValid: false` to true: an existing invalid record may represent a real malformed endpoint. A successful new host discovery can replace it with new evidence.

The existing uncommitted patch also loosens missing-public-URL matching and allows positive CLI costs to override an identity conflict. Those shortcuts are not an acceptable general fix. An unknown public endpoint must not certify arbitrary custom endpoints, and positive recorded costs do not prove matching route identity.

### 1.2 Runtime rejects provider-owned authentication transports

`optionsMatch()` in `src/opencode/plugin-runtime.js` rejects any `fetch` option. OpenCode's built-in subscription authentication loaders use custom fetch functions. OpenAI transport selection may also use a custom fetch for API-key operation, so fetch presence does not identify billing mode.

A hook diagnostic accepted a matching fixture without `fetch` and rejected the same fixture with an inert fetch function as `OMC_DISPATCH_IDENTITY_CONFLICT`, making zero provider requests. See [OpenAI auth loader](https://github.com/anomalyco/opencode/blob/v1.18.28/packages/opencode/src/plugin/openai/codex.ts) and [runtime hook call](https://github.com/anomalyco/opencode/blob/v1.18.28/packages/opencode/src/session/llm/request.ts).

Public provider responses strip functions; `chat.params` receives the live provider object. Consequently, comparing the serialized public object against the live object as if they contained identical transport evidence is invalid. Passing this hook test alone will not demonstrate that OAuth works in a real host.

### 1.3 The product model conflates billing, pricing, and usability

A public token-price catalog cannot determine which plan an account owns, the selected billing connection, or the remaining subscription allowance. Conversely, missing public pricing does not make an otherwise configured paid route unusable.

This must work across providers. Kimi Code can use an API key with a membership coding endpoint, while Moonshot's ordinary API uses a separate endpoint and billing system. Therefore `API key => metered API` is incorrect. Similarly, `OAuth => subscription`, `cost: 0 => free`, and `major lab => entitled` are incorrect. See [Kimi Code FAQ](https://www.kimi.com/code/docs/en/kimi-code/faq.html).

## 2. Product contract

### 2.1 Treat a connection as the billing boundary

A model describes capabilities. A connection describes the configured path through which OpenCode uses that model. Each route is an exact connection plus exact provider/model identity.

Examples the design must support without hardcoded model entries:

| Connection | Authentication may be | Billing may be | Required display |
| --- | --- | --- | --- |
| xAI subscription | OAuth | Subscription | Plan access; quota only when reported |
| xAI API | API key | Metered API | Applicable token rates or estimate unavailable |
| OpenAI Codex plan | OAuth | Subscription | Plan access; recorded tokens distinct from charges |
| Kimi Code | API key or supported login | Subscription | Coding-plan connection, not ordinary Moonshot API billing |
| Moonshot API | API key | Metered API | Exact regional endpoint and applicable API rates |
| Provider credit balance | API key or OAuth | Prepaid | Report balance only from an authorized supported source |
| Custom gateway | Any supported method | Any or unknown | Configured route usable under paid policy; public prices may not apply |
| Local provider | None or another method | Local or unknown | No assumed cloud bill; local infrastructure cost not calculated |
| Unfamiliar provider/model | Unknown | Unknown | Honest unknown fields; same generic eligibility rules |

These are supported data shapes and test scenarios, not promises that every provider exposes all fields through OpenCode.

A host with one configured provider slot and one active credential exposes one connection, even if the vendor sells multiple products. Show two simultaneous connections only when the running host actually exposes separate configured slots/routes. Do not duplicate a row into imaginary subscription and API alternatives.

### 2.2 Separate access policy from estimate availability

Retain the familiar Free/Paid control with this explicit contract:

| Situation | Free policy | Paid policy with configured-connection access |
| --- | --- | --- |
| Verified fresh zero rates for the exact effective route | Eligible if all other checks pass | Eligible |
| Confirmed subscription connection | Blocked as paid access | Eligible; pricing estimate optional |
| Known metered/prepaid connection | Blocked when nonzero or unverified | Eligible; estimate optional |
| Unknown, missing, stale, or conflicting public price evidence | Blocked because free use is not verified | Eligible if the configured host route passes identity and capability checks |
| Custom endpoint differs from public pricing route | Public prices cannot authorize Free | Usable configured route; estimate unavailable for that route |
| Saved connection binding differs from current host binding | Blocked | Blocked pending explicit connection review |
| Disabled, missing from host, incompatible, or explicitly revoked | Blocked | Blocked |

“Eligible” never promises provider entitlement or successful service. A provider may still reject an account, quota, or request. Preserve and explain that failure. Do not convert authentication errors into pricing errors or retry on a different billing connection.

An expired subscription entitlement explicitly reported by a supported host adapter is an access block. Missing entitlement or quota information is not proof of revocation. Do not invent an entitlement check by making a chargeable request.

### 2.3 Existing-user migration must preserve authorization

Version 3 Paid policy only admitted models with verified paid/free pricing. Automatically broadening every existing user's Paid policy would newly permit unpriced connections without their prior authorization.

Introduce `paidEligibility: 'verified-pricing' | 'configured-connections'`:

- Migrate existing settings to `verified-pricing`, preserving previous access semantics and all explicit choices.
- Keep a fresh installation's default policy Free.
- The new Paid control describes the broadened behavior: “Allow configured paid connections, including subscriptions. Cost estimates may be unavailable.” Selecting and saving that option sets `configured-connections`.
- Existing Paid users see one concise migration notice and one normal settings action to adopt the new behavior. No repeated per-model confirmation dialog.
- Preserve the legacy restriction until the user changes it. Show its specific blocking reason instead of an unexplained Unknown — Blocked.
- Turning a model off is always allowed. A settings save must not reject a disable because pricing or availability changed.

This distinction concerns saved policy intent, not the ability of a user declaration to certify a route as free.

### 2.4 Capabilities stay independent

Retain all discovered modalities, tools, reasoning, structured-output support, context and output limits, compatible roles, provenance, and successful refresh timestamps. Use tri-state support: reported true, reported false, and not reported.

Effective host restrictions win over public descriptive enrichment. Missing benchmarks cannot block compatible roles. A subscription connection may expose a different model inventory or restrictions from the same provider's ordinary API; use that connection's actual inventory.

### 2.5 Use clear panel language

Show separate fields for connection, access, and pricing:

- `Subscription · Available`, `Metered API · Available`, or `Billing not reported · Available under Paid policy`.
- `API estimate unavailable`, `Public rates do not match this endpoint`, or `Cached rates expired` as estimate warnings.
- `Disabled by you`, `Free policy requires verified free access`, `Connection changed — review required`, `Reload OpenCode to load this model`, and capability-specific messages as access blocks.
- `Declared by you` versus `Reported by OpenCode` versus `Reported by provider` on billing metadata.

Do not present unknown API pricing as a routing block when configured-connection paid access allows the route. Show all capability details and preserve the responsive layout, filters, draft behavior, and explicit pins.

## 3. Data contracts and trust boundaries

### 3.1 Schemas and identities

Target settings schema 4, catalog schema 3, new connection-store schema 1, and usage response schema 2. Keep existing route-plan/result versions unless their public structures actually change; if changing them, version their schemas and update every consumer in the same task.

Connection identity must be a stable, nonsecret identifier derived from the installation's private scope ID and configured provider slot. It must not contain account names, tokens, raw directory paths, or credential fingerprints. The same slot retains its connection ID; its observable binding gets a new revision when endpoint, SDK, or reliably reported active authentication/billing identity changes.

A binding revision cannot detect credential changes the host does not expose. Surface that limitation. Do not claim a guaranteed subscription-only connection when the available host metadata cannot establish it.

Proposed plain-data contract:

```ts
type BillingKind = 'subscription' | 'metered-api' | 'prepaid' |
  'local' | 'free' | 'unknown';
type EvidenceSource = 'host' | 'provider-adapter' | 'user-declared' | 'unknown';
type AuthKind = 'oauth' | 'api-key' | 'none' | 'unknown';

interface Connection {
  id: string;
  providerId: string;             // actual configured host slot
  bindingRevision: string;
  authKind: AuthKind;             // active method only if reliably exposed
  billing: {
    kind: BillingKind;
    source: EvidenceSource;
    observedAt: string | null;
  };
  transportVisibility: 'declared-endpoint' | 'host-managed';
  inventoryObservedAt: string;
  entitlement: 'reported-active' | 'reported-revoked' | 'not-reported';
  quota: QuotaObservation | null;
}

interface QuotaObservation {
  source: 'host' | 'provider-adapter';
  unit: 'tokens' | 'requests' | 'credits' | 'percent';
  limit: number | null;
  used: number | null;
  remaining: number | null;
  resetsAt: string | null;
  observedAt: string;
  expiresAt: string;
}

interface Eligibility {
  allowed: boolean;
  blockingReasons: string[];
  warnings: string[];
  pricingStatus: 'free' | 'paid' | 'unknown';
  connectionId: string | null;
  bindingRevision: string | null;
}
```

Validate finite, nonnegative quota values and supported units; percentage values must be within 0–100. Do not derive `remaining` from incompatible windows or unrelated balances. Expired observations remain visibly stale and cannot imply current entitlement or exhaustion.

Keep existing role-assignment strings for model IDs and add `roleConnections` keyed by the same four roles, with `{ connectionId, bindingRevision }` or null. Resolve these as one unit. Migrate a pin to a connection only when the relationship is unambiguous; otherwise preserve the requested model and show a connection-selection requirement. Never replace it with Automatic.

### 3.2 Shared functions and ownership

Create small modules with explicit responsibilities. Add `benchmarks/schemas/connection-store.schema.json` for the connection snapshot; keep quota validation within it. The usage API contract is tested alongside its TypeScript response types rather than introducing an unrelated benchmark schema:

| File | Responsibility |
| --- | --- |
| `src/core/connections.js` | Validate/sanitize connection records and derive nonsecret binding inputs; no filesystem or networking |
| `src/core/eligibility.js` | Pure shared access decision with stable reason codes |
| `src/server/connection-store.js` | Private atomic connection snapshot persistence and revisions under the existing state lock |
| `src/core/usage-accounting.js` | Validate observations and compute only supported, provenance-labelled estimates |
| `src/server/usage-attribution-store.js` | Bounded private attribution records; atomic upserts, retention, coverage diagnostics |
| `src/opencode/connection-observer.js` | Convert actual host inventory/runtime observations into sanitized connection evidence |

Use these module interfaces as the implementation seam (all persisted objects are validated before return):

```ts
// core/connections.js
validateConnection(value: unknown): Connection;
// Throws a sanitized validation error; never echoes the invalid payload.

// server/connection-store.js
readConnectionSnapshot({ settingsPath, locked = false }): Promise<{
  schemaVersion: 1; revision: string; connections: Connection[];
}>;
writeConnectionSnapshot({ settingsPath, snapshot, locked = false }): Promise<void>;
// The caller owns the shared state lock when locked is true.

// opencode/connection-observer.js
observeConnections({ providers, previousConnections, scopeId, now }): Connection[];
// providers is the actual host inventory; preserve unknown evidence.

// server/usage-attribution-store.js
upsertUsageObservation({ settingsPath, observation }): Promise<void>;
readUsageAttribution({ settingsPath, from, to }): Promise<{
  observations: UsageObservation[];
  coverage: { firstObservedAt: string | null; droppedCount: number; truncated: boolean };
}>;

interface UsageObservation {
  eventKey: string; // private HMAC, never raw host/message identifiers
  observedAt: string;
  connectionId: string | null;
  bindingRevision: string | null;
  billingKind: BillingKind;
  billingSource: EvidenceSource;
  tokens: {
    input: number | null; output: number | null;
    reasoning: number | null; cacheRead: number | null; cacheWrite: number | null;
  };
  recordedCost: { amount: number; currency: string | null } | null;
  priceSnapshotId: string | null;
}
```

Persist immutable, sanitized price evidence with referenced attribution records in the same bounded store. Prune unreferenced snapshots and count them toward its byte limit. Never depend on the mutable current catalog to resolve an old price snapshot. Include supported provider token-semantics metadata with evidence; the fields above alone do not establish whether token categories overlap.

Do not build a generic plugin ecosystem. Provider adapters, where necessary, are narrow mappings of documented metadata with tests. Unknown providers still work through the generic configured-connection path.

Use one pure call shape throughout:

```js
resolveEligibility({ model, connection, settings, role, hostInventory, now })
// => Eligibility; no writes, requests, credential access, or implicit fallback
```

Catalog-only clients may lack a live inventory. Represent host availability as unverified in preview; the runtime must always recheck the actual directory-scoped host inventory before dispatch. The panel cannot certify a future dispatch from an old snapshot.

### 3.3 Binding and pricing are different identity checks

Maintain separate results for:

1. **Dispatch binding:** Does the chosen connection/model still match the configured host route? A mismatch is a hard block.
2. **Public price applicability:** Does the exact public provider/model/endpoint describe that route? A mismatch makes those rates inapplicable, not necessarily the configured paid route unusable.

Never reuse one generic `identity-conflict` boolean for both decisions. Suggested reason codes include `connection-binding-changed`, `public-price-route-mismatch`, `invalid-endpoint`, `pricing-expired`, `free-access-unverified`, `legacy-paid-pricing-required`, `host-model-missing`, and existing capability-specific codes.

For raw endpoint normalization, treat exactly `''`, absent, and null as an unspecified SDK default where the upstream contract permits it. A nonempty malformed value, whitespace-only value, URL with forbidden embedded credentials, or unapproved query-bearing endpoint remains invalid. Preserve prior invalid provenance when merely reloading cached normalized data.

Public metadata may only certify a default endpoint when the SDK/provider default is itself established. A missing URL is not a wildcard. Custom routes can have unknown pricing and still be enabled under the appropriate paid policy.

### 3.4 Provider-owned transport

Trust OpenCode as the authority that owns the configured provider's execution transport. Accept a host-owned opaque authentication transport under configured-connection paid policy when the exact selected provider/model and observable connection binding match.

Do not claim that an opaque fetch's final network destination was independently verified. Mark transport visibility `host-managed`. Continue rejecting conflicting task/model-level route overrides, changed declared endpoints, wrong SDK/model identities, and inherited variants that do not apply to the selected model.

Free policy must not use public zero rates to certify an opaque transport whose effective billing route cannot be established. An adapter may provide stronger route evidence, but a user declaration or fetch presence cannot supply it.

The observer must distinguish provider-level options from task/model overrides using the real OpenCode hook structures. If the supported versions cannot expose that distinction reliably, preserve the block for the ambiguous case, explain it, and record a release limitation. Do not ship a blanket `fetch is allowed` bypass to satisfy a test.

### 3.5 Refresh and writes

Keep 15-minute stale refreshes and the shared refresh lock. Refresh public metadata without credentials, retain conditional requests and bounded validation, and preserve separate attempt/discovery/pricing success times. Pricing still expires after 24 hours for Free and legacy verified-pricing access; configured-connection Paid can continue with a stale-estimate warning.

Extend `readControlSnapshot()` and existing locks to read coherent settings/catalog/connections revisions. Persist discoveries separately from user choices. User declarations and role bindings are settings intent, not values a background refresh may overwrite.

Settings saves carry expected settings and connection revisions plus the existing catalog conflict context. Revalidate edited fields against the current snapshot; merge untouched discoveries. Return a structured conflict for a changed edited binding and keep the UI draft intact. Avoid introducing separate locks with inverted acquisition order.

## 4. Usage and cost reporting contract

### 4.1 Tokens are usage; billing is a separate observation

Subscription requests consume tokens too. Show tokens whenever the host reports them, regardless of billing kind. Distinguish:

| Value | Meaning | Allowed label |
| --- | --- | --- |
| OpenCode stored cost | A host-recorded value, potentially calculated from its catalog | OpenCode-recorded cost |
| Exact supported API calculation | Estimate using the actual applicable dated API rates and sufficient token dimensions | Estimated API cost |
| Optional public-rate comparison for a subscription | What a comparable API request might cost; not money charged | API-equivalent estimate |
| Authorized provider billing record | Actual bill/charge only when the source explicitly establishes it | Provider-reported charge |
| No reliable value | Unknown, not zero | Not reported / Estimate unavailable |

Never label all OpenCode cost as provider-reported billing. Never label subscription zero cost as free usage. Do not estimate a subscription's monthly fee per request. Do not add monthly fees, credits, API estimates, and provider charges into one total.

Retain null versus explicit zero. Report partial totals with observation coverage and provenance. Do not sum currencies or estimate bases together. If a source does not establish a currency, leave it unknown.

### 4.2 Historical attribution must not change after login changes

Existing OpenCode history commonly records provider/model but not the connection's billing mode at dispatch. Do not classify that history using today's authentication or current user declaration.

Add a private attribution store for future owned-role requests:

- Capture connection ID, binding revision, billing evidence source/kind, and applicable pricing snapshot at dispatch time.
- Bind completion to that snapshot using host/session/message identifiers in memory and private HMAC identifiers on disk. Store the HMAC salt privately; never export raw session/message IDs, prompts, headers, or credentials.
- Confirm the supported OpenCode event lifecycle before implementation. If the final assistant-message identity cannot be associated reliably, mark it unattributed rather than join by time or model name.
- Upsert completed messages idempotently. Multiple message updates must not count the same tokens twice. Failed requests without accounting are not zero-cost completions.
- If an observed connection change makes the dispatch evidence ambiguous, retain the observation with unknown billing rather than attach the new account's identity.
- Use bounded asynchronous writes, the shared state-lock convention, mode 0600 files, mode 0700 directories, and atomic replacement. Persistence failure must not interrupt a successful provider answer; expose a sanitized diagnostic and incomplete coverage.
- Bound retention to 90 days, 10,000 completed records, and 10 MiB, applying whichever limit is reached first. Bound pending writes to 1,000 records; report dropped observations and coverage gaps. Test shutdown flushing and interruption recovery.

Keep all-time OpenCode provider/model totals as the overall host view. The attributed connection view is a captured subset with an explicit observation period and retention limits. Never add the subset to the overall totals. Historical and unrelated/unobserved traffic remains unattributed.

### 4.3 Estimates and quota must remain honest

Use the rates captured for the request, not today's rates retroactively. Calculate only when required billing dimensions and token semantics are known. Account for input/output, cache read/write, context tiers, and reasoning/audio dimensions when applicable. Do not double-count reasoning tokens already included in output or cached tokens already included in input.

An unsupported or missing billing dimension yields unavailable or explicitly partial estimation; it must not silently become zero. A schema may contain a positive rate without enough token usage to compute a complete charge.

Quota adapters only consume sanitized host metadata or a documented, explicitly configured provider integration. Do not scrape account pages, discover local companion ports, or reuse provider tokens for speculative endpoints. The [Kimi CLI server API](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html) describes a separate companion, not an OpenCode quota endpoint. Its existence does not authorize automatic calls from this plugin.

For this release, ship quota display and ingestion contracts with `Not reported` as a valid complete result. Live quota retrieval is supported only for sources actually exposed and verified in the target host. Do not claim universal quota availability.

## 5. Runtime contract

For every new owned-role message:

1. Read a coherent settings/catalog/connections snapshot.
2. Read the running instance's `GET /config/providers` through `client.config.providers({ query: { directory }, throwOnError: true })`. Do not substitute the broader public catalog endpoint.
3. Resolve requested role, exact model ID, and connection binding using the shared eligibility function.
4. For Automatic, choose among currently eligible loaded candidates using existing ranking. Do not invent duplicate billing connections or change ranking quality policy.
5. For a pin absent from the host, preserve the pin and stop with reload guidance before a provider request.
6. Apply the exact selected provider/model; clear incompatible inherited variants and validate the actual `chat.params` binding without rejecting legitimate provider-owned transport merely because it is a function.
7. Capture attribution context before the request and completion accounting when available.

Apply this to all four owned agents: `omc-router`, `omc-code-worker`, `omc-vision-worker`, and `omc-reviewer`.

A resumed repair must retain the original exact code-worker model **and connection binding**, then recheck current policy and capabilities. If revoked, disabled, unavailable, or changed, stop with the reason. Never silently move the repair to another paid connection.

Keep media-only tool denial, reviewer restrictions, delegation limits, and unrelated agents unchanged. Routine role/billing preference edits require no generated config writes or restart. Plugin instruction/permission changes still require the guarded integration update/restart boundary. Do not dispose the host automatically.

## 6. Implementation tasks

Record each completed checkbox, commands, outcomes, and remaining limitations in a private execution log under `docs/plans/`. Stop at a concrete blocker with evidence; do not mark unexecuted platform tests as passed.

### Task 1 — Baseline and preserve the working tree

**Read:** `package.json`, lockfile, `CONTRIBUTING.md`, nearest `AGENTS.md` files, existing `docs/plans/2026-09-07-v030-implementation.md`, repository support/security/integration docs, and existing tests for the files below.

- [ ] Record `git status --short`, HEAD, remotes, current version, Node/npm/OpenCode versions, and the existing two-file diff. Save a private patch before moving anything. Do not include local account data.
- [ ] Create a work branch or isolated worktree without discarding the original changes. Bring the patch into the worktree only deliberately and record whether each hunk is retained, replaced, or excluded.
- [ ] Run `npm ci` using the locked dependencies on the current platform. Do not reuse copied macOS native binaries on Linux.
- [ ] Establish `npm run verify` baseline. Diagnose environment failures before attributing them to the product. Use existing package scripts; do not invent `lint` or `typecheck` scripts from unrelated ancestor guidance.
- [ ] Add failing regression fixtures for the two reproduced problems before changing behavior. Confirm failure messages match the intended defects.

**Gate:** Cleanly attributable baseline and preserved source edits. No credentials or paid calls used.

### Task 2 — Fix normalization without relaxing public-price identity

**Modify:** `src/core/pricing.js`, `src/server/opencode-cli.js`, their existing pricing/discovery tests. Extend `test/fixtures/public-metadata.js` with sanitized endpoint shapes.

- [ ] Write a table-driven test for raw absent/null/empty URL, valid explicit default, documented custom endpoint, malformed nonempty URL, whitespace-only URL, and cached invalid provenance.
- [ ] Assert exact `xai/grok-4.6` fixture with raw empty endpoint no longer becomes invalid solely because it uses the SDK default. Use unfamiliar and nested IDs in the same test to prove generic behavior.
- [ ] Assert missing public URL does not certify an arbitrary custom endpoint, and positive CLI cost cannot override a true price-route mismatch.
- [ ] Implement explicit raw-versus-normalized handling. Test CLI parse, merge, serialized reload, and recovery after successful fresh discovery.
- [ ] Keep missing rates distinct from zero and maintain all supported billing-dimension and 24-hour freshness checks.

Example intended assertions, adapted to actual function signatures after reading the code:

```js
assert.equal(normalizeFreshIdentity({ url: '' }).urlValid, true);
assert.equal(reloadIdentity({ url: null, urlValid: false }).urlValid, false);
assert.equal(publicRatesApply(publicDefault, customGateway), false);
```

These helper names illustrate the behavioral contract; either introduce them with these responsibilities or test the equivalent existing entry points. Do not leave unused facade functions.

**Run:** `node --test test/core/pricing.test.js test/server/opencode-cli.test.js test/server/models-dev.test.js`.

**Commit:** Sign off a focused endpoint-normalization fix once its regression tests pass.

### Task 3 — Add connection snapshots and safe migration

**Create:** `src/core/connections.js`, `src/server/connection-store.js`, `src/opencode/connection-observer.js`, `benchmarks/schemas/connection-store.schema.json`, `test/core/connections.test.js`, and `test/server/connection-store.test.js`.

**Modify:** `src/core/constants.js`, `src/core/settings.js`, `src/core/catalog.js`, `src/server/state-snapshot.js`, `src/server/settings-store.js`, `src/server/catalog-store.js`, `src/server/service.js`, `benchmarks/schemas/router-settings.schema.json`, `benchmarks/schemas/model-catalog.schema.json`, and UI state types.

- [ ] Add failing migration tests covering Free/Paid v3 settings, every disabled model, explicit pins, auto-inclusion, absent provider, multiple possible connections, and older supported settings versions.
- [ ] Implement the schema versions and contracts from §3. Keep role model IDs stable and add connection bindings without silently changing requested assignments.
- [ ] Preserve old Paid semantics through `paidEligibility: verified-pricing`. Test the explicit settings transition to configured-connection access.
- [ ] Create private pre-migration backups with rollback instructions. A failed migration must leave the previous valid state readable and must not partially advance revisions.
- [ ] Extend the coherent snapshot and compare-and-save paths. Test simultaneous refresh/save, another process discovering a connection, and an edited connection changing before save.
- [ ] Test adapters using xAI/OpenAI/Kimi shapes plus an unfamiliar provider. Supported auth methods alone must not populate the active auth type; API-key Kimi Code must not be auto-labelled metered API.
- [ ] Preserve missing auth/billing metadata as unknown. Permit an explicit user billing declaration, label its provenance, and invalidate its binding when the observable configured connection changes.

**Run:** Focused new connection tests plus `node --test test/core/settings*.test.js test/core/schemas.test.js test/server/state-store-v3.test.js test/server/settings-api-v3.test.js`.

**Gate:** No refresh writes user intent, no token-derived identity, no silent expansion of migrated Paid policy.

### Task 4 — Centralize eligibility and expose it consistently

**Create:** `src/core/eligibility.js`, `test/core/eligibility.test.js`.

**Modify:** `src/core/catalog.js`, `src/core/planner.js`, `src/core/settings.js`, `src/server/service.js`, `src/mcp/server.js`, `src/ui/model-control.js`, API/state types, and schema consumers affected by response additions.

- [ ] Encode the §2.2 matrix as parameterized tests before implementation.
- [ ] Replace duplicated price-only gates with `resolveEligibility`. Keep stable blocking/warning reason codes and human-readable explanations at API/UI boundaries.
- [ ] Ensure explicit Disable always saves; enabling validates access policy, not the presence of an estimate alone.
- [ ] Allow unknown-priced configured routes under the newly selected Paid behavior, including valid custom gateways. Keep malformed endpoints and changed saved bindings blocked.
- [ ] Preserve unavailable pins. A blocked reviewer pin must not block an unrelated valid media or coding task.
- [ ] Reload saved catalog and connections as well as settings before MCP planning. Test a long-running MCP process seeing another process's discoveries.
- [ ] Verify capability changes update role compatibility even when prices are unchanged, preserving explicit false values and unknown fields.

**Run:** `node --test test/core/eligibility.test.js test/core/planner.test.js test/mcp/snapshot-v3.test.js test/mcp/server.test.js test/ui/model-control.test.js` plus the new settings/policy tests.

**Gate:** Panel, MCP, planner, and runtime cannot disagree merely because one still uses the old pricing gate.

### Task 5 — Fix actual routing and retain connection identity on repair

**Modify:** `src/opencode/plugin-runtime.js`, `src/opencode/plugin.js`, `src/opencode/connection-observer.js`, plugin runtime/live-routing tests, and integration metadata in `src/installer/index.js` when the managed payload changes.

- [ ] Add failing hook tests for provider-owned fetch, task/model route overrides, wrong SDK/model, changed endpoint, unknown pricing in Paid, and the same unknown pricing in Free.
- [ ] Observe the provider object and directory-scoped inventory through supported host surfaces. Implement the opaque-transport distinction from §3.4; do not inspect transport function source.
- [ ] Recheck the binding immediately before dispatch. Assert no provider request for wrong binding, disabled model, missing host model, expired verified-free evidence, incompatible media/tools, or revoked entitlement.
- [ ] Extend all four owned-role routes and resumed repairs to retain connection ID/revision as well as exact model identity. Test a subscription-to-API switch between initial code generation and repair.
- [ ] Preserve inherited variant cleanup, media tool denial, reviewer permissions, and existing delegation caps.
- [ ] Add a real OpenCode process test that exercises the actual built-in authentication-loader path with synthetic credentials and loopback transport. A handmade `chat.params` object is not enough.

**Run:** `node --test test/opencode/plugin-runtime.test.js test/opencode/live-routing-v3.test.js` and the new auth-transport acceptance case in `npm run test:host`.

**Gate:** Actual host dispatch succeeds on allowed transport; blocked cases have a counted zero provider requests. No real account request is needed or allowed in these tests.

### Task 6 — Correct accounting and capture future connection attribution

**Create:** `src/core/usage-accounting.js`, `src/server/usage-attribution-store.js`, `test/core/usage-accounting.test.js` and `test/server/usage-attribution-store.test.js`.

**Modify:** `src/server/opencode-usage.js`, `src/server/service.js`, usage API handler/types, plugin completion-event handling, `test/server/opencode-usage.test.js`, and `test/server/usage-api.test.js`.

- [ ] Add failing tests for missing versus explicit zero cost/tokens, mixed currencies, invalid numeric values, repeated completion updates, partial windows, and a billing-mode change mid-session.
- [ ] Inspect real supported host database and completion-event schemas. Preserve a bounded read-only SQL query; do not select prompts or arbitrary message bodies into application logs.
- [ ] Replace coercion of unknown accounting to zero with nullable values and coverage. Keep corrupted-schema detection, but do not reject an entire valid usage response merely because individual optional fields are absent.
- [ ] Label host-recorded cost honestly. Keep overall historical totals separate from the captured connection subset.
- [ ] Capture dispatch-time attribution and idempotent completion updates with private HMAC identifiers, bounded retention, bounded pending writes, atomic persistence, and recoverable diagnostics.
- [ ] Test write failures, lock contention, process interruption, repeated events after restart, queue overflow, retention pruning, and clean shutdown.
- [ ] Implement only supported rate calculations, using request-time pricing evidence and tested token semantics. Return unavailable for unsupported dimensions; test cache, reasoning, context tier, and audio cases.
- [ ] Expose quota observations when supported and otherwise `Not reported`. Never calculate remaining plan allowance from API prices.

**Run:** New accounting/store tests plus `node --test test/server/opencode-usage.test.js test/server/usage-api.test.js` and plugin completion integration tests.

**Gate:** Switching a login cannot relabel old usage; no report implies $0, unlimited quota, or a provider charge without evidence.

### Task 7 — Make the panel and API explain the distinction

**Modify:** `src/ui/types.ts`, `src/ui/api.ts`, `src/ui/App.tsx`, `src/ui/editor-state.js`, `src/ui/model-control.js`, existing `ModelTable`, `RoleAssignments`, `UsagePanel`, `RoutingOverview`, `RouteTester`, and `ConfigPanel` components; `src/server/app.js` and state responses as needed.

- [ ] Add connection/billing/access/pricing fields using the existing responsive layout. Keep model search, provider/capability filters, and expandable complete capability details.
- [ ] Add the Paid behavior migration notice and normal save action from §2.3. Keep automatic inclusion beside policy with clear wording about new configured paid models.
- [ ] Offer billing declarations only for metadata the host does not establish; display their source. A declaration cannot override Free verification, incompatible capabilities, a changed binding, or host absence.
- [ ] Keep explicit blocked pins visible with the saved model/connection and actionable reason. Allow Disable even when Enable is unavailable.
- [ ] Separate recorded tokens, host-recorded cost, estimates, charges, and quota. Show coverage, currency/source, freshness, and unknown values without misleading totals.
- [ ] Extend save/refresh generation fences to connection metadata. Delayed responses must not replace newer edits or successful saves. A conflict preserves the user's draft.
- [ ] Ensure keyboard operation, readable errors, and mobile layout. Avoid using color alone for billing or access status.

**Run:** Existing UI contract/draft tests, new billing presentation tests, `npm run check`, and `npm run test:browser`.

**Browser scenarios:** Fresh Free install; migrated Paid install; adoption of configured Paid access; unknown-priced subscription route selection; explicit Disable after metadata expiry; pin after host connection change; refresh during editing; stale save response; usage with null cost and unknown quota; narrow viewport and keyboard-only controls.

### Task 8 — Acceptance, documentation, and release readiness

**Modify:** `scripts/host-acceptance.mjs`, `scripts/package-acceptance.mjs`, `scripts/browser/panel.spec.mjs`, fixture/environment helpers, artifact guards where needed, `.github/workflows/ci.yml`, `CONTRIBUTING.md`, README, support/security/integration docs, changelog, package version, and lockfile only when preparing the release.

- [ ] Run the complete §7 matrix, preserving machine-readable results and sanitized logs. Record exact versions and artifact checksum with each result.
- [ ] Test upgrade from the exact public 0.3.0 package with private backups, policy-preserving migration, guarded connection update, explicit restart, disconnect, and recovery. No routine role change should rewrite config.
- [ ] Document connection versus model, subscription versus API billing, the Paid migration action, missing quotas, opaque transport trust, unknown historical attribution, and estimate limitations.
- [ ] Bump the managed integration version because plugin behavior changes. Explain the explicit update/restart boundary; do not silently update a running host.
- [ ] Run `npm run verify`, `npm run test:browser`, `npm run test:host`, and separately `npm run test:metadata`. Public metadata smoke must not invoke models.
- [ ] Open a signed-off PR with concrete behavior, migration semantics, validation results, and limitations. Run pre-merge acceptance using clearly identified candidate artifacts; these are not the final public artifact. Obtain review before protected-main merge. Do not claim unavailable platform acceptance is complete.
- [ ] After the reviewed change reaches protected main, build one final tarball from its clean source tree using `node scripts/pack-artifact.mjs /absolute/path/to/artifact-directory`, following `docs/releasing.md`. Record its SHA-256 and validate those identical bytes on Linux and macOS with Node 22.12.0 and 24.x using `npm run test:package -- /absolute/path/to/final.tgz`. Set the required exact host binary paths according to that release guide. If any final-byte gate fails, stop publication; fix through another reviewed change and designate a new final candidate explicitly.
- [ ] Only with release authorization, publish that same validated artifact to npm and the immutable matching GitHub release. Verify downloaded artifacts/checksums and installation. Do not rebuild between validation and publication.

**Gate:** Release-ready means all mandatory acceptance passed or a documented blocker remains. A local test pass is not a public release, and successful publication is not proof of real account entitlement for every provider.

## 7. Required acceptance matrix

### Automated behavior matrix

| Area | Cases that must pass |
| --- | --- |
| Discovery | Grok 4.6, Muse Spark 1.3, unfamiliar free/paid IDs, nested provider/model IDs; no new model-name code required |
| Endpoints | Raw empty SDK default, explicit default, malformed endpoint, custom gateway, missing public endpoint, fresh recovery from cached invalid record |
| Prices | Missing/zero/positive, additional dimensions, source conflict, repricing, 24-hour expiry, failed refresh preserving last success |
| Billing | xAI subscription/API, OpenAI subscription/API-shaped transports, API-key Kimi coding plan, Moonshot API, prepaid/local/unknown provider |
| Policy | Free strictness, migrated legacy Paid, explicit configured Paid adoption, unknown price eligible only when policy permits, disabling always allowed |
| Connections | One slot is one connection, genuine separate slots selectable, binding change blocks pin, declarations labelled, auth-method list is not active auth proof |
| Capabilities | Full details, explicit false, unknown support, changing context/modalities/tools, missing benchmarks |
| Runtime | All four roles, live A-to-B, C absent until reload, variant cleanup, opaque host transport, task override rejected, no billing fallback |
| Repair | Exact model and connection retained; changed/revoked/disabled binding stops before provider call |
| Concurrency | Refresh/save overlap, edits during refresh, delayed responses, separate process discovery, coherent MCP reload, lock and shutdown cleanup |
| Usage | Unknown/zero distinction, partial coverage, no mixed-basis sums, historical attribution unknown, mid-session auth switch, idempotent events, retention/failure recovery |
| Isolation | Unrelated sessions/agents unchanged, no real paid endpoint, helpers remain local, secrets absent from artifacts and logs |

### Real host and platform matrix

Minimum supported-host validation: OpenCode **1.18.22 and 1.18.28**. If the built-in auth-loader behavior differs, record and test the exact supported behavior for each version. Do not extend a support claim to an untested newer version.

For each version, start an isolated host with loopback model A and already-loaded B. Change roles while it runs; assert actual outbound requests use B across primary, specialist, media, and resumed workflows. Introduce C after initialization and assert reload guidance plus zero invalid requests. Verify subscription-shaped transport via the actual host/auth-loader path, not only mocked hook calls.

Use fresh temporary HOME/XDG/config/data directories for child processes without changing the parent shell's HOME. Bind local servers explicitly to loopback, deny non-loopback test egress, and capture destination/count assertions. Synthetic auth data is test-only and must not be accepted by a production bypass. If the upstream built-in loader cannot be exercised safely within this harness, document the precise blocker; do not substitute a passing mocked hook and claim completion.

Run source and packaged acceptance across Linux/macOS and Node 22.12.0/24.x. Record each actual platform/version combination. At minimum, actual host dispatch and browser interaction must be exercised on both platforms, and the identical final package must pass installation/migration/disconnect checks across all four platform/Node combinations.

## 8. Executor checkpoint and completion checklist

At each completed implementation task, rerun its focused tests and make a small signed-off commit with explicit paths after reviewing the diff. Do not stage unrelated files. At every task boundary, record:

1. Files changed and why.
2. Exact failing regression observed before the fix, where applicable.
3. Commands run and results, including environment-only failures.
4. Migration, routing, privacy, or accounting assumptions verified against actual host behavior.
5. Remaining blockers and the next task.

Before declaring implementation complete:

- [ ] Both reproduced bugs are fixed independently and exercised together in a real isolated host.
- [ ] Configured Paid access works without a price estimate; Free remains verified-free only.
- [ ] Provider-independent connections support unknown vendors without billing/name heuristics.
- [ ] Kimi Code is not mistaken for ordinary API billing merely because it uses a key.
- [ ] No automatic subscription-to-API fallback exists.
- [ ] Legacy settings, disabled models, explicit pins, and drafts survive migration/refresh.
- [ ] Historical usage is not relabelled, costs are provenance-labelled, quota can honestly be unknown.
- [ ] Capabilities remain complete and effective host restrictions remain authoritative.
- [ ] Linux/macOS and host-version evidence is real, bounded, and reproducible.
- [ ] Existing uncommitted changes were preserved and their disposition is documented.
- [ ] Review and publication status are stated separately from implementation status.

## 9. Primary references and research boundaries

These sources informed the diagnosis and design on 2026-09-08. Recheck before implementing provider-specific adapters; do not encode today's model prices or account products as permanent rules.

- [OpenCode xAI connection documentation](https://dev.opencode.ai/docs/providers/#xai): separate subscription and API connection methods.
- [OpenCode 1.18.28 provider implementation](https://github.com/anomalyco/opencode/blob/v1.18.28/packages/opencode/src/provider/provider.ts): empty default endpoints, provider options, and public serialization.
- [OpenCode 1.18.28 xAI auth loader](https://github.com/anomalyco/opencode/blob/v1.18.28/packages/opencode/src/plugin/xai.ts): provider-owned OAuth transport and SDK default endpoint behavior.
- [OpenCode 1.18.28 OpenAI auth loader](https://github.com/anomalyco/opencode/blob/v1.18.28/packages/opencode/src/plugin/openai/codex.ts): custom transports and normalized subscription model costs.
- [OpenCode 1.18.28 request implementation](https://github.com/anomalyco/opencode/blob/v1.18.28/packages/opencode/src/session/llm/request.ts): actual hook inputs.
- [Models.dev API documentation](https://github.com/anomalyco/models.dev/blob/dev/README.md#api): public model metadata, not account entitlement or subscription quota.
- [xAI model pricing](https://docs.x.ai/developers/models): API rates; these are not subscription charges.
- [Codex with a ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan): plan-based access and allowance context.
- [Kimi Code FAQ](https://www.kimi.com/code/docs/en/kimi-code/faq.html): coding-plan endpoint and credentials differ from the ordinary Moonshot API.
- [Kimi CLI server API](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html): a separate local companion API; not permission to access it automatically.

## Copyable instruction for Grok 4.6

> Read this entire plan and the repository's current instructions. Execute it task by task after implementation is authorized. Start by preserving the existing working-tree changes and verifying the baseline. Use the product/data contracts in this document as the acceptance criteria. Do not substitute provider-name or authentication-type heuristics for connection evidence, weaken verified-free routing, invent usage/charges/quota, or silently switch billing connections. Maintain an evidence-based execution log and run the real isolated OpenCode acceptance, not only unit hooks. Preserve the existing UI and user choices. Stop before any unauthorized public release, and distinguish implemented, tested, reviewed, and published outcomes.
