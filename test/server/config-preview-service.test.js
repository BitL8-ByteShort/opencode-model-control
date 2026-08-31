import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

test("generated preview includes the complete managed plugin and default-agent surface", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-config-preview-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = await new ControlService({
    settingsPath: join(directory, "settings.json"),
    discovery: liveDiscovery(),
  }).initialize();

  const preview = service.getOpenCodeConfig();

  assert.equal(preview.config.default_agent, "omc-router");
  assert.equal(preview.config.plugin.length, 1);
  assert.match(preview.config.plugin[0], /^file:\/\//u);
  assert.deepEqual(JSON.parse(preview.text), preview.config);
  assert.ok(preview.warnings.some((warning) => /user-owned default/u.test(warning)));
});

test("generated preview omits the default agent when the saved preference is disabled", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-config-preview-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = await new ControlService({
    settingsPath: join(directory, "settings.json"),
    discovery: liveDiscovery(),
  }).initialize();
  const settings = structuredClone(service.getState().settings);
  settings.makeRouterDefault = false;
  await service.updateSettings(settings);

  const preview = service.getOpenCodeConfig();

  assert.equal(preview.config.default_agent, undefined);
  assert.equal(preview.text.includes('"default_agent"'), false);
});
