import test from "node:test";
import assert from "node:assert/strict";
import { loadModelCatalog } from "../fixtures/catalog.js";
import {
  createDefaultSettings,
  migrateSettings,
  validateSettings,
} from "../../src/core/index.js";

test("v3 free and paid settings migrate to verified-pricing without expanding access", () => {
  const catalog = loadModelCatalog();
  for (const costPolicy of ["free-only", "known-cost"]) {
    const old = {
      ...createDefaultSettings(catalog),
      schemaVersion: 3,
      costPolicy,
      autoIncludeNewModels: false,
      modelControls: {
        "opencode/big-pickle": { selection: "disabled" },
        "missing/model": { selection: "disabled", available: false },
      },
      roleAssignments: {
        orchestrator: "opencode/big-pickle",
        "code-worker": "missing/model",
        "vision-worker": "auto",
        reviewer: "auto",
      },
    };
    delete old.paidEligibility;
    delete old.roleConnections;
    delete old.billingDeclarations;
    const next = migrateSettings(old, catalog);
    assert.equal(next.schemaVersion, 4);
    assert.equal(next.paidEligibility, "verified-pricing");
    assert.equal(next.costPolicy, costPolicy);
    assert.equal(next.autoIncludeNewModels, false);
    assert.equal(next.roleAssignments.orchestrator, "opencode/big-pickle");
    assert.equal(next.roleAssignments["code-worker"], "missing/model");
    assert.equal(next.modelControls["opencode/big-pickle"].selection, "disabled");
    assert.deepEqual(next.roleConnections, {
      orchestrator: null,
      "code-worker": null,
      "vision-worker": null,
      reviewer: null,
    });
  }
});

test("fresh installs stay free and require an explicit configured-connections adoption", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);
  assert.equal(settings.costPolicy, "free-only");
  assert.equal(settings.paidEligibility, "verified-pricing");
  const adopted = validateSettings(
    {
      ...settings,
      costPolicy: "known-cost",
      paidEligibility: "configured-connections",
    },
    catalog,
  );
  assert.equal(adopted.paidEligibility, "configured-connections");
  assert.equal(adopted.costPolicy, "known-cost");
});

test("older supported settings versions keep disabled models and pins through v4", () => {
  const catalog = loadModelCatalog();
  const v3 = {
    ...createDefaultSettings(catalog),
    schemaVersion: 3,
    costPolicy: "known-cost",
    modelControls: {
      "opencode/big-pickle": { selection: "disabled" },
    },
    roleAssignments: {
      ...createDefaultSettings(catalog).roleAssignments,
      orchestrator: "opencode/big-pickle",
    },
  };
  delete v3.paidEligibility;
  delete v3.roleConnections;
  delete v3.billingDeclarations;
  for (const value of [
    {
      schemaVersion: 0,
      primary: "opencode/big-pickle",
      enabledModels: ["opencode/big-pickle"],
      allowPaid: false,
    },
    {
      schemaVersion: 1,
      freeOnly: true,
      roleAssignments: { orchestrator: "opencode/big-pickle" },
    },
    {
      schemaVersion: 2,
      costPreference: "free-first",
      costPolicy: "known-cost",
      roleAssignments: {
        orchestrator: "opencode/big-pickle",
        "code-worker": "auto",
        "vision-worker": "auto",
        reviewer: "auto",
      },
      modelControls: { "opencode/big-pickle": { enabled: false } },
      maxDelegationDepth: 1,
      maxFallbacksPerAssignment: 1,
      makeRouterDefault: true,
    },
    v3,
  ]) {
    const migrated = migrateSettings(value, catalog);
    assert.equal(migrated.schemaVersion, 4, String(value.schemaVersion));
    assert.equal(migrated.paidEligibility, "verified-pricing");
    assert.equal(migrated.roleAssignments.orchestrator, "opencode/big-pickle");
  }
});
