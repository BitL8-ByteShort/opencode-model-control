import assert from "node:assert/strict";
import test from "node:test";
import * as ui from "../../src/ui/model-control.js";

const model = {
  id: "fixture/new",
  available: true,
  pricingClass: "free",
  free: true,
  roles: { "vision-worker": 25 },
  access: ["read"],
  toolCall: true,
  modalities: { input: ["text", "audio"], output: ["text"] },
};
test("canonical policy leaves new identities absent, preserves explicit pins and supports return to policy", () => {
  const settings = ui.normalizeSettings(
    {
      schemaVersion: 3,
      autoIncludeNewModels: false,
      modelControls: { "fixture/old": { selection: "disabled" } },
      roleAssignments: { reviewer: "fixture/old" },
    },
    [model],
  );
  assert.deepEqual(settings.modelControls, {
    "fixture/old": { selection: "disabled" },
  });
  assert.equal(ui.modelIntentEnabled(settings, model.id), false);
  const enabled = ui.toggleEnabledModel(settings, model.id, true);
  assert.equal(enabled.modelControls[model.id].selection, "enabled");
  const policy = ui.selectModelPolicy(enabled, model.id, "policy");
  assert.equal(ui.modelIntentEnabled(policy, model.id), false);
  assert.equal(
    ui.modelIntentEnabled({ ...policy, autoIncludeNewModels: true }, model.id),
    true,
  );
  assert.equal(ui.settingsForApi(policy).schemaVersion, 4);
  assert.equal(ui.settingsForApi(policy).autoIncludeNewModels, false);
});
test("cost policy never erases paid intent or pins and current expired price blocks enabling", () => {
  const settings = ui.normalizeSettings({
    modelControls: { "fixture/new": { selection: "enabled" } },
    roleAssignments: { reviewer: model.id },
  });
  const free = ui.setCostMode(
    settings,
    [{ ...model, pricingClass: "paid" }],
    "free",
  );
  assert.equal(free.modelControls[model.id].selection, "enabled");
  assert.equal(free.roleAssignments.reviewer, model.id);
  assert.equal(
    ui.modelCostClass({ ...model, pricingClass: "unknown" }),
    "unknown",
  );
  assert.equal(
    ui.isRoleModelAssignable(model, settings, "vision-worker"),
    true,
  );
  assert.match(
    ui
      .modelEligibilityReasons(
        { ...model, available: false, pricingClass: "unknown" },
        settings,
      )
      .join(" "),
    /unavailable.*pricing/i,
  );
});
test("role blocking explains each missing capability and accepts roleCapabilities as the convenience list", () => {
  const settings = ui.normalizeSettings({});
  const reasons = ui.modelEligibilityReasons(
    {
      ...model,
      toolCall: false,
      access: [],
      modalities: { input: ["audio"], output: ["image"] },
    },
    settings,
    "vision-worker",
  );
  assert.match(reasons.join(" "), /tool support/i);
  assert.match(reasons.join(" "), /read access/i);
  assert.match(reasons.join(" "), /text input/i);
  assert.match(reasons.join(" "), /text output/i);
  assert.deepEqual(
    ui.modelRoles({
      roleCapabilities: ["reviewer"],
      capabilities: { effective: {} },
    }),
    ["reviewer"],
  );
});
