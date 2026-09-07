import test from "node:test";
import assert from "node:assert/strict";
import { loadModelCatalog, syntheticPricing } from "../fixtures/catalog.js";
import {
  createDefaultSettings,
  migrateSettings,
  validateSettings,
  eligibleModelsForRole,
  planRoute,
} from "../../src/core/index.js";

test("v2 migration keeps explicit choices, paid preference and unavailable pins", () => {
  const catalog = loadModelCatalog();
  const old = {
    ...createDefaultSettings(catalog),
    schemaVersion: 2,
    costPolicy: "known-cost",
    costPreference: "paid-first",
    modelControls: { "missing/model": { enabled: false, available: false } },
    roleAssignments: {
      orchestrator: "missing/model",
      "code-worker": "auto",
      "vision-worker": "auto",
      reviewer: "auto",
    },
  };
  const next = migrateSettings(old, catalog);
  assert.equal(next.schemaVersion, 3);
  assert.equal(next.autoIncludeNewModels, true);
  assert.equal(next.costPreference, "paid-first");
  assert.equal(next.roleAssignments.orchestrator, "missing/model");
  assert.deepEqual(next.modelControls["missing/model"], {
    selection: "disabled",
    available: false,
  });
});

test("policy models enroll when evidence resolves and obey subsequent policy changes", () => {
  const catalog = structuredClone(loadModelCatalog());
  const settings = createDefaultSettings(catalog);
  const fresh = {
    ...structuredClone(catalog.models[0]),
    id: "new/unseen",
    pricing: syntheticPricing({ verified: false }),
  };
  catalog.models.push(fresh);
  const candidates = () =>
    eligibleModelsForRole({
      catalog,
      settings,
      role: "orchestrator",
      modalities: ["text"],
      access: "read",
    }).map((m) => m.id);
  assert.equal(candidates().includes(fresh.id), false);
  fresh.pricing = syntheticPricing({
    verified: true,
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
  });
  assert.equal(candidates().includes(fresh.id), true);
  settings.autoIncludeNewModels = false;
  assert.equal(candidates().includes(fresh.id), false);
  settings.modelControls[fresh.id] = { selection: "enabled" };
  assert.equal(candidates().includes(fresh.id), true);
  settings.modelControls[fresh.id] = { selection: "disabled" };
  settings.autoIncludeNewModels = true;
  assert.equal(candidates().includes(fresh.id), false);
  assert.equal(
    Object.hasOwn(
      createDefaultSettings(loadModelCatalog()).modelControls,
      fresh.id,
    ),
    false,
  );
});

test("saved blocked specialist pin survives structural validation and cannot block unrelated route", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);
  settings.roleAssignments["vision-worker"] = "missing/vision";
  assert.equal(
    validateSettings(settings, catalog).roleAssignments["vision-worker"],
    "missing/vision",
  );
  assert.equal(
    planRoute({ catalog, settings, task: { kind: "general" } }).route,
    "direct",
  );
  assert.throws(
    () =>
      planRoute({
        catalog,
        settings,
        task: { kind: "vision", modalities: ["image"] },
      }),
    (e) => e.code === "INVALID_ROLE_ASSIGNMENT",
  );
});
