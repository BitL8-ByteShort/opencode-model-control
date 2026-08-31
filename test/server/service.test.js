import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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

  assert.equal(result.route, "orchestrator");
  assert.equal(result.assignments[0].role, "orchestrator");
  assert.equal(result.assignments[1].role, "code-worker");
  assert.equal(result.assignments[2].role, "reviewer");
  assert.ok(
    result.assignments.every(
      ({ fallbackCount, fallbackModelId }) =>
        fallbackCount === 0 && fallbackModelId === null,
    ),
  );
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

test("non-text route previews state the installed plugin boundary", async (t) => {
  const service = await isolatedService(t, liveDiscovery());
  const result = service.route({ task: "Describe this screenshot", modality: "image" });

  assert.equal(result.route, "vision-worker");
  assert.match(result.integrationWarning, /installed Model Control plugin/iu);
});

test("image-assisted implementation plans bounded vision, code, and review work", async (t) => {
  const service = await isolatedService(t, liveDiscovery());
  const result = service.route({
    task: "Implement the UI changes shown in this screenshot",
    modality: "image",
  });

  assert.equal(result.task.kind, "code");
  assert.equal(result.task.access, "write");
  assert.equal(result.task.requiresReview, true);
  assert.deepEqual(result.task.modalities, ["text", "image"]);
  assert.equal(result.route, "orchestrator");
  assert.deepEqual(
    result.assignments.map(({ role }) => role),
    ["orchestrator", "code-worker", "vision-worker", "reviewer"],
  );
});

test("pure image inspection plans read-only vision and review work", async (t) => {
  const service = await isolatedService(t, liveDiscovery());
  const result = service.route({
    task: "Inspect this screenshot for accessibility issues",
    modality: "image",
  });

  assert.equal(result.task.kind, "vision");
  assert.equal(result.task.access, "read");
  assert.equal(result.route, "orchestrator");
  assert.deepEqual(
    result.assignments.map(({ role }) => role),
    ["orchestrator", "vision-worker", "reviewer"],
  );
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

test("connecting persists the validated plugin policy even when defaults were unchanged", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-service-connect-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, "settings.json");
  let receivedSettings;
  const service = await new ControlService({
    settingsPath,
    discovery: liveDiscovery(),
    integrationInstaller: {
      async install({ settings }) {
        receivedSettings = settings;
        return { installed: true, managed: true, healthy: true, message: "Connected" };
      },
    },
  }).initialize();

  await service.installOpenCodeIntegration();

  const persisted = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.equal(persisted.makeRouterDefault, true);
  assert.deepEqual(persisted, receivedSettings);
});

test("a complete catalog snapshot preserves enabled plugin models across a partial restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-service-catalog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, "settings.json");
  const snapshotPath = join(directory, "catalog-snapshot.json");
  const pluginModel = {
    id: "plugin/acme-code",
    provider: "plugin",
    name: "Acme Code",
    status: "active",
    inputCost: 0.2,
    outputCost: 0.8,
    inputCostVerified: true,
    outputCostVerified: true,
    context: 64_000,
    toolCall: true,
    inputModalities: ["text"],
    outputModalities: ["text"],
  };
  const completeDiscovery = async () => {
    const base = await liveDiscovery()();
    const models = [...base.models, pluginModel];
    return {
      ...base,
      complete: true,
      availableIds: models.map(({ id }) => id),
      models,
    };
  };
  const incompleteDiscovery = async () => {
    const base = await liveDiscovery()();
    return {
      ...base,
      complete: false,
      error: {
        code: "OPENCODE_PLUGIN_DISCOVERY_INCOMPLETE",
        message: "Plugin-provided models may be missing.",
      },
    };
  };

  const first = await new ControlService({ settingsPath, discovery: completeDiscovery }).initialize();
  const settings = structuredClone(first.getState().settings);
  settings.costPreference = "paid-first";
  settings.costPolicy = "known-cost";
  settings.modelControls[pluginModel.id].enabled = true;
  settings.roleAssignments["code-worker"] = pluginModel.id;
  await first.updateSettings(settings);

  assert.equal((await stat(snapshotPath)).mode & 0o777, 0o600);
  const second = await new ControlService({ settingsPath, discovery: incompleteDiscovery }).initialize();
  let state = second.getState();
  assert.equal(state.system.catalog.complete, false);
  assert.equal(state.catalog.find(({ id }) => id === pluginModel.id)?.available, true);
  assert.equal(state.settings.modelControls[pluginModel.id].enabled, true);
  assert.equal(state.settings.roleAssignments["code-worker"], pluginModel.id);

  state = await second.refreshCatalog();
  assert.equal(state.catalog.find(({ id }) => id === pluginModel.id)?.available, true);
  const stored = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.equal(stored.modelControls[pluginModel.id].enabled, true);
  assert.equal(stored.roleAssignments["code-worker"], pluginModel.id);
});
