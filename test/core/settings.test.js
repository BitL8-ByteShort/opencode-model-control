import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SETTINGS,
  createDefaultSettings,
  loadModelCatalog,
  migrateSettings,
  validateSettings,
} from "../../src/core/index.js";

test("default settings are strict, bounded, complete, and deterministic", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);

  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.equal(settings.schemaVersion, 2);
  assert.equal(settings.costPreference, "free-first");
  assert.equal(settings.costPolicy, "free-only");
  assert.equal(Object.hasOwn(settings, "freeOnly"), false);
  assert.deepEqual(settings.roleAssignments, {
    orchestrator: "opencode/big-pickle",
    "code-worker": "auto",
    "vision-worker": "opencode/mimo-v2.5-free",
    reviewer: "auto",
  });
  assert.equal(settings.maxDelegationDepth, 1);
  assert.equal(settings.maxFallbacksPerAssignment, 1);
  assert.equal(settings.makeRouterDefault, true);
  assert.equal(Object.keys(settings.modelControls).length, 6);
  assert.equal(
    settings.modelControls["opencode/muse-spark-1.2-contributor-free"].enabled,
    false,
  );
});

test("legacy settings migrate to schema v2 without enabling unselected models", () => {
  const catalog = loadModelCatalog();
  const migrated = migrateSettings(
    {
      primary: "opencode/big-pickle",
      enabledModels: [
        "opencode/big-pickle",
        "opencode/mimo-v2.5-free",
      ],
      unavailableModels: ["opencode/mimo-v2.5-free"],
      allowPaid: false,
    },
    catalog,
  );

  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.costPreference, "free-first");
  assert.equal(migrated.costPolicy, "free-only");
  assert.equal(
    migrated.roleAssignments.orchestrator,
    "opencode/big-pickle",
  );
  assert.equal(
    migrated.modelControls["opencode/big-pickle"].enabled,
    true,
  );
  assert.equal(
    migrated.modelControls["opencode/mimo-v2.5-free"].available,
    false,
  );
  assert.equal(
    migrated.modelControls["opencode/nemotron-3.5-lightning-free"].enabled,
    false,
  );
});

test("schema v1 free-only settings migrate to explicit v2 cost controls", () => {
  const catalog = loadModelCatalog();
  const legacy = {
    ...createDefaultSettings(catalog),
    schemaVersion: 1,
    freeOnly: true,
  };
  delete legacy.costPreference;
  delete legacy.costPolicy;

  const migrated = migrateSettings(legacy, catalog);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.costPreference, "free-first");
  assert.equal(migrated.costPolicy, "free-only");
});

test("settings reject malformed costs, excessive repair passes, recursion, and unknown models", () => {
  const catalog = loadModelCatalog();
  const base = createDefaultSettings(catalog);

  assert.throws(
    () => validateSettings({ ...base, costPreference: "cheapest" }, catalog),
    (error) => error.code === "INVALID_SETTINGS",
  );
  assert.throws(
    () => validateSettings({ ...base, costPolicy: "anything-goes" }, catalog),
    (error) => error.code === "INVALID_SETTINGS",
  );
  assert.throws(
    () =>
      validateSettings(
        { ...base, maxFallbacksPerAssignment: 2 },
        catalog,
      ),
    (error) => error.code === "INVALID_SETTINGS",
  );
  assert.throws(
    () => validateSettings({ ...base, maxDelegationDepth: 2 }, catalog),
    (error) => error.code === "INVALID_SETTINGS",
  );
  assert.throws(
    () => validateSettings({ ...base, makeRouterDefault: "yes" }, catalog),
    (error) =>
      error.code === "INVALID_SETTINGS" &&
      /makeRouterDefault must be true or false/.test(error.message),
  );
  assert.throws(
    () =>
      validateSettings(
        {
          ...base,
          modelControls: {
            ...base.modelControls,
            "unknown/free-model": { enabled: true, available: true },
          },
        },
        catalog,
      ),
    (error) => error.code === "UNKNOWN_MODEL",
  );
});

test("unsupported future settings versions are rejected rather than guessed", () => {
  const catalog = loadModelCatalog();
  assert.throws(
    () => migrateSettings({ schemaVersion: 99 }, catalog),
    (error) => error.code === "UNSUPPORTED_SETTINGS_VERSION",
  );
});

test("known-cost settings permit an explicit paid model from the active catalog", () => {
  const catalog = structuredClone(loadModelCatalog());
  const paid = structuredClone(catalog.models[1]);
  paid.id = "openrouter/example-paid";
  paid.label = "Example Paid";
  paid.free.inputUsdPerMillion = 0.25;
  paid.free.outputUsdPerMillion = 1;
  catalog.models.push(paid);

  const base = createDefaultSettings(catalog);
  const settings = validateSettings(
    {
      ...base,
      costPreference: "paid-first",
      costPolicy: "known-cost",
      roleAssignments: {
        ...base.roleAssignments,
        "code-worker": paid.id,
      },
      modelControls: {
        ...base.modelControls,
        [paid.id]: { enabled: true, available: true },
      },
    },
    catalog,
  );

  assert.equal(settings.roleAssignments["code-worker"], paid.id);
  assert.equal(settings.costPolicy, "known-cost");
});

test("explicit paid and free assignments reject a zero role score", () => {
  const catalog = structuredClone(loadModelCatalog());
  const free = structuredClone(catalog.models[1]);
  free.id = "provider/zero-score-free";
  free.label = "Zero Score Free";
  free.roles = { "code-worker": 0 };
  const paid = structuredClone(free);
  paid.id = "provider/zero-score-paid";
  paid.label = "Zero Score Paid";
  paid.free.inputUsdPerMillion = 0.25;
  paid.free.outputUsdPerMillion = 1;
  catalog.models.push(free, paid);

  const base = createDefaultSettings(catalog);
  for (const [model, costPreference, costPolicy] of [
    [free, "free-first", "free-only"],
    [paid, "paid-first", "known-cost"],
  ]) {
    assert.throws(
      () =>
        validateSettings(
          {
            ...base,
            costPreference,
            costPolicy,
            roleAssignments: {
              ...base.roleAssignments,
              "code-worker": model.id,
            },
            modelControls: {
              ...base.modelControls,
              [model.id]: { enabled: true, available: true },
            },
          },
          catalog,
        ),
      (error) => error.code === "INVALID_ROLE_ASSIGNMENT",
    );
  }
});

test("default settings degrade unavailable explicit defaults to automatic selection", () => {
  const catalog = loadModelCatalog({
    liveAvailability: {
      "opencode/ling-3.0-flash-fin-free": { available: true },
      "opencode/nemotron-3.5-lightning-free": { available: true },
    },
  });
  const settings = createDefaultSettings(catalog);

  assert.equal(settings.roleAssignments.orchestrator, "auto");
  assert.equal(settings.roleAssignments["vision-worker"], "auto");
});

test("explicit role assignments must remain enabled, available, verified-free, and compatible", () => {
  const catalog = loadModelCatalog();
  const base = createDefaultSettings(catalog);

  assert.throws(
    () =>
      validateSettings(
        {
          ...base,
          roleAssignments: {
            ...base.roleAssignments,
            "code-worker": "opencode/ling-3.0-flash-fin-free",
          },
          modelControls: {
            ...base.modelControls,
            "opencode/ling-3.0-flash-fin-free": {
              enabled: false,
              available: true,
            },
          },
        },
        catalog,
      ),
    (error) => error.code === "INVALID_ROLE_ASSIGNMENT",
  );

  assert.throws(
    () =>
      validateSettings(
        {
          ...base,
          roleAssignments: {
            ...base.roleAssignments,
            "vision-worker": "opencode/big-pickle",
          },
        },
        catalog,
      ),
    (error) => error.code === "INVALID_ROLE_ASSIGNMENT",
  );

  const unavailable = structuredClone(base);
  unavailable.roleAssignments.reviewer = "opencode/nemotron-3-ultra-free";
  unavailable.modelControls["opencode/nemotron-3-ultra-free"].available = false;
  assert.throws(
    () => validateSettings(unavailable, catalog),
    (error) => error.code === "INVALID_ROLE_ASSIGNMENT",
  );

  const unverifiedCatalog = structuredClone(catalog);
  unverifiedCatalog.models.find(
    (model) => model.id === "opencode/nemotron-3-ultra-free",
  ).free.verified = false;
  const unverified = structuredClone(base);
  unverified.roleAssignments.reviewer = "opencode/nemotron-3-ultra-free";
  assert.throws(
    () => validateSettings(unverified, unverifiedCatalog),
    (error) => error.code === "INVALID_ROLE_ASSIGNMENT",
  );
});

test("settings reject null assignments and malformed model controls", () => {
  const catalog = loadModelCatalog();
  const base = createDefaultSettings(catalog);

  const nullAssignment = structuredClone(base);
  nullAssignment.roleAssignments.reviewer = null;
  assert.throws(
    () => validateSettings(nullAssignment, catalog),
    (error) => error.code === "INVALID_SETTINGS",
  );

  const malformedControl = structuredClone(base);
  malformedControl.modelControls["opencode/big-pickle"].enabled = null;
  assert.throws(
    () => validateSettings(malformedControl, catalog),
    (error) => error.code === "INVALID_SETTINGS",
  );
});
