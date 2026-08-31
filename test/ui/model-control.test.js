import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogRefreshNotice,
  catalogSummary,
  evidenceMeta,
  isModelFree,
  modelCostClass,
  modelAccess,
  modelInputModalities,
  modelRoles,
  normalizeState,
  roleModelCompatible,
  routePlanView,
  settingsEqual,
  settingsForApi,
  setCostMode,
  toggleEnabledModel,
} from "../../src/ui/model-control.js";

const liveIds = [
  "opencode/big-pickle",
  "opencode/ling-3.0-flash-fin-free",
  "opencode/mimo-v2.5-free",
  "opencode/muse-spark-1.2-contributor-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/nemotron-3.5-lightning-free",
];

const catalog = liveIds.map((id) => ({
  id,
  label: id.split("/").at(-1),
  status: "available",
  available: true,
  free: {
    verified: true,
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
  },
  provisional: true,
  enabledByDefault: id !== "opencode/muse-spark-1.2-contributor-free",
  modalities: {
    input:
      id === "opencode/mimo-v2.5-free"
        ? ["text", "image", "audio", "video"]
        : id === "opencode/muse-spark-1.2-contributor-free"
          ? ["text", "image", "audio", "video", "pdf"]
          : ["text"],
    output: ["text"],
  },
  access: id === "opencode/nemotron-3-ultra-free" ? ["read"] : ["read", "write"],
  canOrchestrate: id === "opencode/big-pickle",
  roles:
    id === "opencode/big-pickle"
      ? { orchestrator: 100, reviewer: 60 }
      : id === "opencode/mimo-v2.5-free"
        ? { "code-worker": 70, "vision-worker": 100, reviewer: 75 }
        : id === "opencode/nemotron-3-ultra-free"
          ? { reviewer: 100 }
          : { "code-worker": 100, reviewer: 50 },
}));

test("normalizes API catalog records without invented concept rows", () => {
  const normalized = normalizeState({
    schemaVersion: 1,
    catalog,
    settings: {
      schemaVersion: 1,
      freeOnly: true,
      maxDelegationDepth: 1,
      maxFallbacksPerAssignment: 1,
      modelControls: {},
      roleAssignments: {
        orchestrator: "opencode/big-pickle",
        "code-worker": "opencode/nemotron-3-ultra-free",
        "vision-worker": "opencode/mimo-v2.5-free",
        reviewer: "opencode/ling-3.0-flash-fin-free",
      },
    },
  });

  assert.deepEqual(normalized.catalog.map((model) => model.id), liveIds);
  assert.equal(normalized.catalog.some((model) => model.id.includes("minicpm")), false);
  assert.equal(normalized.catalog.some((model) => model.id.includes("qwen2.5")), false);
  assert.equal(normalized.settings.modelControls["opencode/muse-spark-1.2-contributor-free"].enabled, false);
});

test("serializes the finalized settings contract without UI aliases", () => {
  const normalized = normalizeState({ catalog, settings: {} });
  normalized.settings.roleAssignments = {
    orchestrator: "opencode/big-pickle",
    "code-worker": "opencode/nemotron-3-ultra-free",
    "vision-worker": "opencode/mimo-v2.5-free",
    reviewer: "auto",
  };
  const payload = settingsForApi(normalized.settings);

  assert.deepEqual(Object.keys(payload).sort(), [
    "costPolicy",
    "costPreference",
    "maxDelegationDepth",
    "maxFallbacksPerAssignment",
    "modelControls",
    "roleAssignments",
    "schemaVersion",
  ]);
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.costPolicy, "free-only");
  assert.equal(payload.roleAssignments["vision-worker"], "opencode/mimo-v2.5-free");
  assert.equal("enabledModels" in payload, false);
  assert.equal("primaryModel" in payload, false);
});

test("model toggles preserve per-model availability and make settings dirty", () => {
  const normalized = normalizeState({ catalog, settings: {} });
  const before = normalized.settings;
  const after = toggleEnabledModel(before, "opencode/muse-spark-1.2-contributor-free", true);

  assert.equal(after.modelControls["opencode/muse-spark-1.2-contributor-free"].enabled, true);
  assert.equal(after.modelControls["opencode/muse-spark-1.2-contributor-free"].available, true);
  assert.equal(settingsEqual(before, after), false);
  assert.equal(settingsEqual(after, structuredClone(after)), true);
});

test("vision and orchestrator compatibility use live modality metadata", () => {
  const bigPickle = catalog.find((model) => model.id === "opencode/big-pickle");
  const mimo = catalog.find((model) => model.id === "opencode/mimo-v2.5-free");

  assert.equal(roleModelCompatible(mimo, "vision-worker"), true);
  assert.equal(roleModelCompatible(bigPickle, "vision-worker"), false);
  assert.equal(roleModelCompatible(bigPickle, "orchestrator"), true);
  assert.equal(roleModelCompatible(mimo, "orchestrator"), false);
  assert.equal(isModelFree(mimo), true);
  assert.deepEqual(modelInputModalities(mimo), ["text", "image", "audio", "video"]);
  assert.deepEqual(modelRoles(mimo), ["code-worker", "vision-worker", "reviewer"]);
  assert.deepEqual(modelAccess(mimo), ["read", "write"]);
  assert.equal(roleModelCompatible(mimo, "code-worker"), true);
  assert.equal(roleModelCompatible(bigPickle, "code-worker"), false);
});

test("normalization emits core-valid automatic roles and 0..1 policy bounds", () => {
  const normalized = normalizeState({
    catalog,
    settings: {
      maxDelegationDepth: 9,
      maxFallbacksPerAssignment: -2,
      roleAssignments: {},
    },
  });

  assert.deepEqual(normalized.settings.roleAssignments, {
    orchestrator: "auto",
    "code-worker": "auto",
    "vision-worker": "auto",
    reviewer: "auto",
  });
  assert.equal(normalized.settings.maxDelegationDepth, 1);
  assert.equal(normalized.settings.maxFallbacksPerAssignment, 0);
});

test("unbenchmarked evidence remains explicit in catalog summaries", () => {
  const normalized = normalizeState({ catalog, settings: {} });
  const summary = catalogSummary(catalog, normalized.settings);

  assert.equal(evidenceMeta(true).label, "Unbenchmarked role");
  assert.equal(evidenceMeta({ status: "capability-only" }).label, "Capability verified; benchmark pending");
  assert.equal(summary.total, 6);
  assert.equal(summary.unbenchmarked, 6);
  assert.equal(summary.available, 6);
});

test("Free and Paid modes map to explicit cost policy and disable paid routes safely", () => {
  const paidModel = {
    ...catalog[1],
    id: "openai/paid-code",
    label: "Paid Code",
    enabledByDefault: false,
    free: { verified: true, inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
  };
  const normalized = normalizeState({ catalog: [...catalog, paidModel], settings: {} });
  const paid = setCostMode(normalized.settings, [...catalog, paidModel], "paid");
  paid.modelControls[paidModel.id].enabled = true;
  paid.roleAssignments["code-worker"] = paidModel.id;
  const free = setCostMode(paid, [...catalog, paidModel], "free");

  assert.equal(modelCostClass(paidModel), "paid");
  assert.equal(paid.costPreference, "paid-first");
  assert.equal(paid.costPolicy, "known-cost");
  assert.equal(free.costPreference, "free-first");
  assert.equal(free.costPolicy, "free-only");
  assert.equal(free.modelControls[paidModel.id].enabled, false);
  assert.equal(free.roleAssignments["code-worker"], "auto");
});

test("catalog refresh notices require an OpenCode restart when the connection changed", () => {
  assert.equal(
    catalogRefreshNotice({ connectionChanged: false }),
    "Available OpenCode models updated.",
  );
  assert.match(
    catalogRefreshNotice({ connectionChanged: true }),
    /connection was updated\. Restart OpenCode to load the changes\./u,
  );
  assert.match(
    catalogRefreshNotice({ incomplete: true, connectionChanged: true }),
    /limited OpenCode fallback catalog.*Restart OpenCode/su,
  );
});

test("derives the visible route from the exact core assignment response", () => {
  const view = routePlanView({
    route: "vision-worker",
    assignments: [
      {
        role: "orchestrator",
        modelId: "opencode/big-pickle",
        fallbackModelId: "opencode/ling-3.0-flash-fin-free",
      },
      {
        role: "vision-worker",
        modelId: "opencode/mimo-v2.5-free",
        fallbackModelId: "opencode/muse-spark-1.2-contributor-free",
      },
    ],
    reasons: ["non-text-input-capability"],
    integrationWarning: "Use the vision agent directly for the original attachment.",
  });

  assert.equal(view.primary, "opencode/big-pickle");
  assert.deepEqual(view.workers, [
    { role: "vision-worker", modelId: "opencode/mimo-v2.5-free" },
  ]);
  assert.deepEqual(view.fallbacks, [
    "opencode/ling-3.0-flash-fin-free",
    "opencode/muse-spark-1.2-contributor-free",
  ]);
});
