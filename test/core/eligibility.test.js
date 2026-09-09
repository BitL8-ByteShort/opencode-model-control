import assert from "node:assert/strict";
import test from "node:test";
import { loadModelCatalog, syntheticPricing } from "../fixtures/catalog.js";
import { createDefaultSettings, eligibleModelsForRole } from "../../src/core/index.js";
import { resolveEligibility } from "../../src/core/eligibility.js";

function paidUnknown(catalog, extras = {}) {
  const model = {
    ...structuredClone(catalog.models[0]),
    id: "xai/grok-4.6",
    available: true,
    api: {
      id: "grok-4.6",
      npm: "@ai-sdk/xai",
      url: null,
      urlValid: true,
    },
    pricing: {
      class: "unknown",
      rates: {},
      reasons: ["public-price-route-mismatch"],
      source: "https://models.dev/api.json",
      digest: "a".repeat(64),
      fetchedAt: "2026-09-08T12:00:00.000Z",
      expiresAt: "2026-09-09T12:00:00.000Z",
    },
    ...extras,
  };
  return model;
}

test("eligibility matrix: free stays verified-free; configured paid allows unknown estimates", () => {
  const catalog = loadModelCatalog();
  const free = catalog.models.find((model) => model.id === "opencode/big-pickle");
  const settings = createDefaultSettings(catalog);
  assert.equal(resolveEligibility({ model: free, settings }).allowed, true);

  const unknown = paidUnknown(catalog);
  assert.equal(
    resolveEligibility({ model: unknown, settings }).allowed,
    false,
  );
  assert.ok(
    resolveEligibility({ model: unknown, settings }).blockingReasons.includes(
      "free-access-unverified",
    ),
  );

  const legacyPaid = {
    ...settings,
    costPolicy: "known-cost",
    paidEligibility: "verified-pricing",
  };
  assert.equal(resolveEligibility({ model: unknown, settings: legacyPaid }).allowed, false);
  assert.ok(
    resolveEligibility({
      model: unknown,
      settings: legacyPaid,
    }).blockingReasons.includes("legacy-paid-pricing-required"),
  );

  const configured = {
    ...settings,
    costPolicy: "known-cost",
    paidEligibility: "configured-connections",
  };
  const allowed = resolveEligibility({ model: unknown, settings: configured });
  assert.equal(allowed.allowed, true);
  assert.ok(allowed.warnings.includes("api-estimate-unavailable"));

  const invalid = paidUnknown(catalog, {
    api: { id: "grok-4.6", npm: "@ai-sdk/xai", url: null, urlValid: false },
  });
  assert.equal(
    resolveEligibility({ model: invalid, settings: configured }).allowed,
    false,
  );
  assert.ok(
    resolveEligibility({
      model: invalid,
      settings: configured,
    }).blockingReasons.includes("invalid-endpoint"),
  );
});

test("disabled models stay blocked; binding changes block pins; disable does not require an estimate", () => {
  const catalog = loadModelCatalog();
  const model = catalog.models[0];
  const settings = createDefaultSettings(catalog);
  settings.modelControls[model.id] = { selection: "disabled" };
  assert.ok(
    resolveEligibility({ model, settings }).blockingReasons.includes("disabled-by-you"),
  );
  const configured = {
    ...createDefaultSettings(catalog),
    costPolicy: "known-cost",
    paidEligibility: "configured-connections",
    roleConnections: {
      orchestrator: { connectionId: "a".repeat(32), bindingRevision: "b".repeat(32) },
      "code-worker": null,
      "vision-worker": null,
      reviewer: null,
    },
  };
  const changed = resolveEligibility({
    model,
    settings: configured,
    role: "orchestrator",
    connection: {
      id: "c".repeat(32),
      bindingRevision: "d".repeat(32),
      entitlement: "not-reported",
    },
  });
  assert.ok(changed.blockingReasons.includes("connection-binding-changed"));
});

test("revoked and missing pinned connections are blocked when inventory is known", () => {
  const catalog = loadModelCatalog();
  const model = catalog.models[0];
  const settings = createDefaultSettings(catalog);
  settings.costPolicy = "known-cost";
  settings.paidEligibility = "configured-connections";
  const connection = {
    id: "a".repeat(32),
    providerId: model.id.split("/")[0],
    bindingRevision: "b".repeat(32),
    entitlement: "reported-revoked",
  };
  assert.ok(
    resolveEligibility({
      model,
      settings,
      connection,
      connections: [connection],
    }).blockingReasons.includes("entitlement-revoked"),
  );
  settings.roleConnections.orchestrator = {
    connectionId: "a".repeat(32),
    bindingRevision: "b".repeat(32),
  };
  assert.ok(
    resolveEligibility({
      model,
      settings,
      role: "orchestrator",
      connection: null,
      connections: [],
    }).blockingReasons.includes("connection-binding-changed"),
  );
});

test("configured-connections enrolls unknown-priced models into role eligibility", () => {
  const catalog = structuredClone(loadModelCatalog());
  const model = paidUnknown(catalog, {
    roles: { "code-worker": 25, orchestrator: 25, reviewer: 25 },
    access: ["read", "write"],
    canOrchestrate: true,
    toolCall: true,
    modalities: { input: ["text"], output: ["text"] },
  });
  catalog.models.push(model);
  const settings = createDefaultSettings(catalog);
  settings.costPolicy = "known-cost";
  settings.paidEligibility = "configured-connections";
  settings.modelControls[model.id] = { selection: "enabled" };
  const ids = eligibleModelsForRole({
    catalog,
    settings,
    role: "code-worker",
    modalities: ["text"],
    access: "write",
  }).map((item) => item.id);
  assert.equal(ids.includes(model.id), true);
});
