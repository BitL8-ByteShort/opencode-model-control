import assert from "node:assert/strict";
import test from "node:test";

import {
  KNOWN_MODEL_IDS,
  classifyModelPricing,
  createDefaultSettings,
  eligibleModelsForRole,
  loadModelCatalog,
  validateCatalog,
} from "../../src/core/index.js";

function derivedModel(id, overrides = {}) {
  const source = structuredClone(loadModelCatalog().models[1]);
  return {
    ...source,
    id,
    label: id,
    ...overrides,
  };
}

const EXPECTED_MODEL_IDS = [
  "opencode/big-pickle",
  "opencode/ling-3.0-flash-fin-free",
  "opencode/mimo-v2.5-free",
  "opencode/muse-spark-1.2-contributor-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/nemotron-3.5-lightning-free",
];

test("the bundled catalog contains exactly the verified six-model roster", () => {
  const catalog = loadModelCatalog();

  assert.deepEqual(KNOWN_MODEL_IDS, EXPECTED_MODEL_IDS);
  assert.deepEqual(
    catalog.models.map((model) => model.id),
    EXPECTED_MODEL_IDS,
  );
  assert.equal(catalog.schemaVersion, 1);

  for (const model of catalog.models) {
    assert.equal(model.free.verified, true);
    assert.equal(model.free.inputUsdPerMillion, 0);
    assert.equal(model.free.outputUsdPerMillion, 0);
    assert.ok(Number.isInteger(model.contextWindowTokens));
    assert.ok(model.contextWindowTokens > 0);
  }

  assert.deepEqual(
    Object.fromEntries(
      catalog.models.map((model) => [model.id, model.contextWindowTokens]),
    ),
    {
      "opencode/big-pickle": 200_000,
      "opencode/ling-3.0-flash-fin-free": 262_144,
      "opencode/mimo-v2.5-free": 200_000,
      "opencode/muse-spark-1.2-contributor-free": 1_048_576,
      "opencode/nemotron-3-ultra-free": 1_000_000,
      "opencode/nemotron-3.5-lightning-free": 262_144,
    },
  );

  const muse = catalog.models.find(
    (model) => model.id === "opencode/muse-spark-1.2-contributor-free",
  );
  assert.equal(muse.provisional, true);
  assert.equal(muse.enabledByDefault, false);
});

test("a supplied live-availability snapshot fails closed for omitted models", () => {
  const catalog = loadModelCatalog({
    liveAvailability: {
      "opencode/big-pickle": { available: true },
      "opencode/mimo-v2.5-free": { available: true, enabled: false },
      "unknown/free-model": { available: true },
    },
  });

  const byId = Object.fromEntries(
    catalog.models.map((model) => [model.id, model]),
  );
  assert.equal(byId["opencode/big-pickle"].available, true);
  assert.equal(byId["opencode/mimo-v2.5-free"].available, true);
  assert.equal(byId["opencode/mimo-v2.5-free"].enabledByDefault, false);
  assert.equal(byId["opencode/nemotron-3-ultra-free"].available, false);
  assert.equal(catalog.models.some((model) => model.id === "unknown/free-model"), false);
});

test("strict free-only eligibility excludes unverified, disabled, unavailable, and incompatible models", () => {
  const raw = structuredClone(loadModelCatalog());
  const ling = raw.models.find(
    (model) => model.id === "opencode/ling-3.0-flash-fin-free",
  );
  ling.free.verified = false;

  const catalog = validateCatalog(raw);
  const settings = createDefaultSettings(catalog);
  const codeModels = eligibleModelsForRole({
    catalog,
    settings,
    role: "code-worker",
    modalities: ["text"],
    access: "write",
  });

  assert.equal(
    codeModels.some((model) => model.id === ling.id),
    false,
  );
  assert.equal(
    codeModels.some(
      (model) => model.id === "opencode/muse-spark-1.2-contributor-free",
    ),
    false,
  );
  assert.ok(codeModels.every((model) => model.available));
  assert.ok(codeModels.every((model) => model.access.includes("write")));

  const visionModels = eligibleModelsForRole({
    catalog,
    settings,
    role: "vision-worker",
    modalities: ["text", "image"],
    access: "read",
  });
  assert.deepEqual(
    visionModels.map((model) => model.id),
    ["opencode/mimo-v2.5-free"],
  );
});

test("catalog validation rejects duplicate IDs and malformed routing metadata", () => {
  const duplicate = structuredClone(loadModelCatalog());
  duplicate.models.push(structuredClone(duplicate.models[0]));
  assert.throws(
    () => validateCatalog(duplicate),
    (error) => error.code === "INVALID_CATALOG",
  );

  const malformed = structuredClone(loadModelCatalog());
  malformed.models[0].roles.orchestrator = "high";
  assert.throws(
    () => validateCatalog(malformed),
    (error) => error.code === "INVALID_CATALOG",
  );
});

test("validated catalogs accept arbitrary provider models without requiring the bundled roster", () => {
  const dynamic = derivedModel("openrouter/example/model-v2", {
    contextWindowTokens: null,
    toolCall: true,
    provider: "openrouter",
    profileSource: "runtime-capabilities",
    discovered: true,
    runtimeVerified: true,
    free: {
      verified: false,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      verifiedAt: null,
    },
  });
  const catalog = validateCatalog({
    schemaVersion: 1,
    snapshotDate: "2026-08-30",
    models: [dynamic],
  });

  assert.equal(catalog.models.length, 1);
  assert.equal(catalog.models[0].id, dynamic.id);
  assert.equal(catalog.models[0].contextWindowTokens, null);
  assert.equal(catalog.models[0].provider, "openrouter");
  assert.equal(catalog.models[0].runtimeVerified, true);
  assert.equal(classifyModelPricing(catalog.models[0]), "unknown");
});

test("catalogs retain discovered models that have no safe routing role", () => {
  const unroutable = derivedModel("provider/image-generator", {
    modalities: { input: ["text"], output: ["image"] },
    access: ["read"],
    canOrchestrate: false,
    roles: {},
    toolCall: false,
  });
  const catalog = validateCatalog({
    schemaVersion: 1,
    snapshotDate: "2026-08-30",
    models: [unroutable],
  });
  const settings = createDefaultSettings(catalog);

  assert.equal(catalog.models[0].id, unroutable.id);
  assert.deepEqual(catalog.models[0].roles, {});
  assert.equal(
    eligibleModelsForRole({
      catalog,
      settings,
      role: "reviewer",
      modalities: ["text"],
      access: "read",
    }).length,
    0,
  );
});

test("catalog order keeps curated models first and sorts dynamic IDs stably", () => {
  const catalog = validateCatalog({
    schemaVersion: 1,
    snapshotDate: "2026-08-30",
    models: [
      derivedModel("zeta/model"),
      structuredClone(loadModelCatalog().models[2]),
      derivedModel("alpha/model"),
      structuredClone(loadModelCatalog().models[0]),
    ],
  });

  assert.deepEqual(
    catalog.models.map((model) => model.id),
    [
      "opencode/big-pickle",
      "opencode/mimo-v2.5-free",
      "alpha/model",
      "zeta/model",
    ],
  );
});

test("pricing classification requires verified numeric prices", () => {
  const free = derivedModel("provider/free");
  const paid = derivedModel("provider/paid", {
    free: {
      verified: true,
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0.5,
      verifiedAt: "2026-08-30",
    },
  });
  const unknown = derivedModel("provider/unknown", {
    free: {
      verified: false,
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      verifiedAt: null,
    },
  });

  assert.equal(classifyModelPricing(free), "free");
  assert.equal(classifyModelPricing(paid), "paid");
  assert.equal(classifyModelPricing(unknown), "unknown");
});

test("unknown pricing and missing tool calls fail eligibility closed", () => {
  const catalog = structuredClone(loadModelCatalog());
  const unknown = derivedModel("provider/unknown-cost", {
    free: {
      verified: false,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      verifiedAt: null,
    },
  });
  const noTools = derivedModel("provider/no-tools", { toolCall: false });
  catalog.models.push(unknown, noTools);
  const settings = createDefaultSettings(catalog);
  settings.costPolicy = "known-cost";
  settings.modelControls[unknown.id].enabled = true;
  settings.modelControls[noTools.id].enabled = true;

  const candidates = eligibleModelsForRole({
    catalog,
    settings,
    role: "code-worker",
    modalities: ["text"],
    access: "write",
  });
  assert.equal(candidates.some((model) => model.id === unknown.id), false);
  assert.equal(candidates.some((model) => model.id === noTools.id), false);

  const noToolVision = structuredClone(
    catalog.models.find((model) => model.id === "opencode/mimo-v2.5-free"),
  );
  noToolVision.id = "provider/no-tool-vision";
  noToolVision.label = "No Tool Vision";
  noToolVision.toolCall = false;
  catalog.models.push(noToolVision);
  settings.modelControls[noToolVision.id] = { enabled: true, available: true };
  const visionCandidates = eligibleModelsForRole({
    catalog,
    settings,
    role: "vision-worker",
    modalities: ["text", "image"],
    access: "read",
  });
  assert.equal(
    visionCandidates.some((model) => model.id === noToolVision.id),
    false,
  );
});

test("known-paid role eligibility is provider-agnostic and still requires explicit enablement", () => {
  const providerIds = [
    "xai/grok-example",
    "openrouter/vendor-example",
    "custom/private-example",
  ];
  const paidModels = providerIds.map((id) => derivedModel(id, {
    label: id,
    enabledByDefault: false,
    free: {
      verified: true,
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 4,
      verifiedAt: "2026-09-01",
    },
    modalities: { input: ["text", "image"], output: ["text"] },
    toolCall: true,
    access: ["read", "write"],
    canOrchestrate: true,
    roles: {
      orchestrator: 25,
      "code-worker": 25,
      "vision-worker": 25,
      reviewer: 25,
    },
  }));
  const catalog = validateCatalog({
    ...loadModelCatalog(),
    models: [...loadModelCatalog().models, ...paidModels],
  });
  const settings = createDefaultSettings(catalog);
  settings.costPolicy = "known-cost";
  settings.costPreference = "paid-first";

  const codeBeforeOptIn = eligibleModelsForRole({
    catalog,
    settings,
    role: "code-worker",
    modalities: ["text"],
    access: "write",
  });
  assert.ok(providerIds.every((id) => !codeBeforeOptIn.some((model) => model.id === id)));

  for (const id of providerIds) settings.modelControls[id].enabled = true;
  for (const [role, modalities, access] of [
    ["orchestrator", ["text"], "write"],
    ["code-worker", ["text"], "write"],
    ["vision-worker", ["text", "image"], "read"],
    ["reviewer", ["text"], "read"],
  ]) {
    const eligible = eligibleModelsForRole({ catalog, settings, role, modalities, access });
    assert.deepEqual(
      eligible.filter((model) => providerIds.includes(model.id)).map((model) => model.id),
      [...providerIds].sort(),
    );
  }
});
