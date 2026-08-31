import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadModelCatalog } from "../../src/core/index.js";
import { ControlService } from "../../src/server/service.js";

function liveDiscovery() {
  const catalog = loadModelCatalog();
  return async () => ({
    installed: true,
    version: "1.18.22",
    checkedAt: "2026-08-31T12:00:00.000Z",
    error: null,
    complete: true,
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

function passingResult(modelId) {
  return {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    modelId,
    status: "passed",
    evidenceType: "runtime-access-only",
    startedAt: "2026-08-31T12:00:00.000Z",
    completedAt: "2026-08-31T12:00:01.000Z",
    durationMs: 1000,
    openCodeVersion: "1.18.22",
    providerRequestAttempted: true,
    externalPluginsDisabled: true,
    isolatedWorkingDirectory: true,
    promptKind: "fixed-synthetic-sentinel",
    responseMatched: true,
    exitCode: 0,
    failure: null,
  };
}

test("runtime checks never run automatically and persist only after both confirmations", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-runtime-service-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, "settings.json");
  let calls = 0;
  const runner = async ({ modelId }) => {
    calls += 1;
    return passingResult(modelId);
  };
  const service = await new ControlService({
    settingsPath,
    discovery: liveDiscovery(),
    runtimeQualificationRunner: runner,
  }).initialize();

  assert.equal(calls, 0);
  assert.equal(service.getRuntimeQualificationSummary().automatic, false);
  assert.equal(calls, 0);
  await service.refreshCatalog();
  assert.equal(calls, 0);

  await assert.rejects(
    service.runRuntimeQualification({
      modelId: "opencode/big-pickle",
      acknowledgeProviderRequest: true,
      acknowledgeCostAndDataTerms: false,
    }),
    (error) => error?.code === "RUNTIME_QUALIFICATION_CONFIRMATION_REQUIRED",
  );
  assert.equal(calls, 0);

  const summary = await service.runRuntimeQualification({
    modelId: "opencode/big-pickle",
    acknowledgeProviderRequest: true,
    acknowledgeCostAndDataTerms: true,
  });
  assert.equal(calls, 1);
  assert.equal(summary.running, false);
  assert.equal(summary.benchmarkPromotion, false);
  assert.equal(summary.results[0].status, "passed");

  const restarted = await new ControlService({
    settingsPath,
    discovery: liveDiscovery(),
    runtimeQualificationRunner: async () => {
      throw new Error("must not run during restart");
    },
  }).initialize();
  assert.equal(restarted.getRuntimeQualificationSummary().results[0].modelId, "opencode/big-pickle");
});

test("runtime checks reject unavailable models and concurrent runs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-runtime-service-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const service = await new ControlService({
    settingsPath: join(directory, "settings.json"),
    discovery: liveDiscovery(),
    runtimeQualificationRunner: async ({ modelId }) => {
      await pending;
      return passingResult(modelId);
    },
  }).initialize();
  const confirmation = {
    acknowledgeProviderRequest: true,
    acknowledgeCostAndDataTerms: true,
  };

  await assert.rejects(
    service.runRuntimeQualification({ modelId: "unknown/model", ...confirmation }),
    (error) => error?.code === "RUNTIME_QUALIFICATION_MODEL_UNAVAILABLE",
  );

  const first = service.runRuntimeQualification({ modelId: "opencode/big-pickle", ...confirmation });
  await assert.rejects(
    service.runRuntimeQualification({ modelId: "opencode/big-pickle", ...confirmation }),
    (error) => error?.code === "RUNTIME_QUALIFICATION_IN_PROGRESS" && error?.statusCode === 409,
  );
  release();
  await first;
});

test("invalid optional runtime history does not prevent the control panel from starting", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-runtime-history-invalid-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const historyPath = join(directory, "runtime-qualification-results.json");
  await writeFile(historyPath, "{not-json}\n");

  const service = await new ControlService({
    settingsPath: join(directory, "settings.json"),
    catalogSnapshotPath: join(directory, "catalog.json"),
    runtimeQualificationHistoryPath: historyPath,
    discovery: liveDiscovery(),
  }).initialize();

  const summary = service.getRuntimeQualificationSummary();
  assert.deepEqual(summary.results, []);
  assert.match(summary.warning, /history is unreadable/iu);
});
