import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogRefreshNotice,
  catalogSummary,
  evidenceMeta,
  isModelFree,
  isRoleModelAssignable,
  isRoleModelEligible,
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
  selectRoleModel,
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
  toolCall: id === "opencode/mimo-v2.5-free" ? true : undefined,
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
    "makeRouterDefault",
    "maxDelegationDepth",
    "maxFallbacksPerAssignment",
    "modelControls",
    "roleAssignments",
    "schemaVersion",
  ]);
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.costPolicy, "free-only");
  assert.equal(payload.makeRouterDefault, true);
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
  assert.equal(evidenceMeta({ status: "capability-only" }).label, "Reported capability; runtime unverified");
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

test("explicit role selection opts a compatible known-paid provider model into routing", () => {
  const grok = {
    ...catalog[1],
    id: "xai/grok-4.6",
    label: "Grok 4.6",
    enabledByDefault: false,
    free: { verified: true, inputUsdPerMillion: 2, outputUsdPerMillion: 6 },
    toolCall: true,
    modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    access: ["read", "write"],
    canOrchestrate: true,
    roles: {
      orchestrator: 25,
      "code-worker": 25,
      "vision-worker": 25,
      reviewer: 25,
    },
  };
  const allModels = [...catalog, grok];
  const normalized = normalizeState({ catalog: allModels, settings: {} });
  const paid = setCostMode(normalized.settings, allModels, "paid");

  assert.equal(paid.modelControls[grok.id].enabled, false);
  assert.equal(isRoleModelAssignable(grok, paid, "code-worker"), true);
  assert.equal(isRoleModelEligible(grok, paid, "code-worker"), false);

  const selected = selectRoleModel(paid, allModels, "code-worker", grok.id);
  assert.equal(selected.roleAssignments["code-worker"], grok.id);
  assert.equal(selected.modelControls[grok.id].enabled, true);
  assert.equal(isRoleModelEligible(grok, selected, "code-worker"), true);
});

test("role selection keeps cost, availability, capability, and automatic opt-in gates closed", () => {
  const paid = {
    ...catalog[1],
    id: "provider/paid-code",
    enabledByDefault: false,
    free: { verified: true, inputUsdPerMillion: 1, outputUsdPerMillion: 4 },
    toolCall: true,
    modalities: { input: ["text"], output: ["text"] },
    access: ["read", "write"],
    roles: { "code-worker": 25, reviewer: 25 },
  };
  const unknown = {
    ...paid,
    id: "provider/unknown-code",
    free: { verified: false, inputUsdPerMillion: null, outputUsdPerMillion: null },
  };
  const unavailable = { ...paid, id: "provider/unavailable-code", available: false };
  const incompatible = {
    ...paid,
    id: "provider/text-generator",
    modalities: { input: ["text"], output: ["image"] },
  };
  const allModels = [...catalog, paid, unknown, unavailable, incompatible];
  const freeSettings = normalizeState({ catalog: allModels, settings: {} }).settings;
  const paidSettings = setCostMode(freeSettings, allModels, "paid");

  assert.equal(isRoleModelAssignable(paid, freeSettings, "code-worker"), false);
  assert.equal(isRoleModelAssignable(unknown, paidSettings, "code-worker"), false);
  assert.equal(isRoleModelAssignable(unavailable, paidSettings, "code-worker"), false);
  assert.equal(isRoleModelAssignable(incompatible, paidSettings, "code-worker"), false);

  const automatic = selectRoleModel(paidSettings, allModels, "code-worker", "auto");
  assert.equal(automatic.roleAssignments["code-worker"], "auto");
  assert.equal(automatic.modelControls[paid.id].enabled, false);
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

test("derives reviewed code repair semantics without displaying legacy model fallbacks", () => {
  const view = routePlanView({
    route: "orchestrator",
    policy: { maxFallbacksPerAssignment: 1 },
    assignments: [
      {
        role: "orchestrator",
        modelId: "opencode/big-pickle",
        fallbackModelId: "opencode/ling-3.0-flash-fin-free",
      },
      {
        role: "code-worker",
        modelId: "opencode/ling-3.0-flash-fin-free",
        fallbackModelId: "opencode/muse-spark-1.2-contributor-free",
      },
      {
        role: "reviewer",
        modelId: "opencode/nemotron-3-ultra-free",
      },
    ],
    reasons: ["multiple-specialist-capabilities"],
  });

  assert.equal(view.primary, "opencode/big-pickle");
  assert.deepEqual(view.workers, [
    { role: "code-worker", modelId: "opencode/ling-3.0-flash-fin-free" },
    { role: "reviewer", modelId: "opencode/nemotron-3-ultra-free" },
  ]);
  assert.equal(view.repairPasses, 1);
  assert.equal("fallbacks" in view, false);
});
