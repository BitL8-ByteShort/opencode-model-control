import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadModelCatalog } from "../../src/core/index.js";
import { ControlService } from "../../src/server/service.js";

function liveDiscovery() {
  const catalog = loadModelCatalog();
  return async () => ({
    installed: true,
    version: "1.18.22",
    checkedAt: "2026-08-30T12:00:00.000Z",
    error: null,
    availableIds: catalog.models.map(({ id }) => id),
    models: catalog.models.map((model) => ({
      id: model.id,
      status: "active",
      free: true,
      inputCostVerified: true,
      outputCostVerified: true,
      toolCall: true,
    })),
  });
}

async function isolatedService(t, discovery) {
  const directory = await mkdtemp(join(tmpdir(), "omc-service-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new ControlService({
    settingsPath: join(directory, "settings.json"),
    discovery,
  }).initialize();
}

async function isolatedUsageService(t, usageReader) {
  const directory = await mkdtemp(join(tmpdir(), "omc-service-usage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new ControlService({
    settingsPath: join(directory, "settings.json"),
    discovery: liveDiscovery(),
    usageReader,
  }).initialize();
}

test("service still starts and fails closed when OpenCode is unavailable", async (t) => {
  const service = await isolatedService(t, async () => ({
    installed: false,
    version: null,
    checkedAt: "2026-08-30T12:00:00.000Z",
    error: { code: "OPENCODE_NOT_FOUND", message: "OpenCode was not found." },
    availableIds: [],
    models: [],
  }));
  const state = service.getState();

  assert.equal(state.system.openCode.installed, false);
  assert.ok(state.catalog.every((model) => model.available === false));
  assert.equal(state.settings.roleAssignments.orchestrator, "auto");
  assert.equal(state.settings.roleAssignments["vision-worker"], "auto");
  assert.throws(
    () => service.route({ task: "Implement an API test", modality: "text" }),
    (error) => error.code === "NO_ELIGIBLE_FREE_MODEL",
  );
});

test("live zero-cost catalog produces a bounded explainable route", async (t) => {
  const service = await isolatedService(t, liveDiscovery());
  const result = service.route({ task: "Implement API endpoint authentication", modality: "text" });

  assert.equal(result.route, "code-worker");
  assert.equal(result.assignments[0].role, "orchestrator");
  assert.equal(result.assignments[1].role, "code-worker");
  assert.ok(result.assignments.every(({ fallbackCount }) => fallbackCount <= 1));
  assert.equal(result.integrationWarning, null);
});

test("disabling an assigned model atomically degrades its role to auto", async (t) => {
  const service = await isolatedService(t, liveDiscovery());
  const next = structuredClone(service.getState().settings);
  next.modelControls["opencode/big-pickle"].enabled = false;

  const state = await service.updateSettings(next);
  assert.equal(state.settings.roleAssignments.orchestrator, "auto");
  assert.equal(state.settings.modelControls["opencode/big-pickle"].enabled, false);
});

test("non-text route previews state the stock OpenCode first-call limitation", async (t) => {
  const service = await isolatedService(t, liveDiscovery());
  const result = service.route({ task: "Describe this screenshot", modality: "image" });

  assert.equal(result.route, "vision-worker");
  assert.match(result.integrationWarning, /selects the primary model before delegation/iu);
});

test("usage is read on demand with the requested fixed window", async (t) => {
  let received;
  const service = await isolatedUsageService(t, async (options) => {
    received = options;
    return { schemaVersion: 1, window: options.window ?? "30d", totals: { messages: 0 } };
  });

  assert.equal(received, undefined);
  const usage = await service.getUsage("7d");
  assert.deepEqual(received, { window: "7d" });
  assert.equal(usage.window, "7d");
});
