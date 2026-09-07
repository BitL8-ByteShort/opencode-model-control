import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createControlServer } from "../../src/server/app.js";
import { publicMetadataFetch, liveModel } from "../fixtures/public-metadata.js";
test("settings HTTP accepts revision envelope and returns bounded conflict reasons", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-api-v3-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = publicMetadataFetch;
  const app = await createControlServer({
    settingsPath: join(directory, "settings.json"),
    metadataFetch: publicMetadataFetch,
    mutationSessionSecret: "test-revision-secret",
    discovery: async () => ({
      installed: true,
      complete: true,
      models: [liveModel("opencode/big-pickle")],
      error: null,
    }),
  });
  globalThis.fetch = originalFetch;
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const state = await fetch(`${base}/api/state`).then((r) => r.json());
  const save = (body) =>
    fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-omc-request": "1",
        "x-omc-session": "test-revision-secret",
        origin: base,
      },
      body: JSON.stringify(body),
    });
  const body = {
    settings: { ...state.settings, maxDelegationDepth: 0 },
    expectedSettingsRevision: state.settingsRevision,
    catalogRevision: state.catalogRevision,
  };
  let response = await save(body);
  assert.equal(response.status, 200);
  response = await save(body);
  assert.equal(response.status, 409);
  assert.ok(Array.isArray((await response.json()).error.reasons));
  const latest = await fetch(`${base}/api/state`).then((r) => r.json());
  response = await save({
    settings: { ...latest.settings, autoIncludeNewModels: "yes" },
    expectedSettingsRevision: latest.settingsRevision,
  });
  assert.equal(response.status, 400);
});

test("settings API accepts a bounded dynamic catalog worth of explicit controls above 64 KiB", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-api-large-v3-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await createControlServer({
    settingsPath: join(directory, "settings.json"),
    metadataFetch: publicMetadataFetch,
    mutationSessionSecret: "large-test",
    discovery: async () => ({
      installed: false,
      complete: false,
      models: [],
      error: null,
    }),
  });
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const state = app.service.getState();
  const controls = Object.fromEntries(
    Array.from({ length: 1800 }, (_, i) => [
      `saved/model-${i}`,
      { selection: "disabled" },
    ]),
  );
  const response = await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-omc-request": "1",
      "x-omc-session": "large-test",
      origin: base,
    },
    body: JSON.stringify({
      settings: { ...state.settings, modelControls: controls },
      expectedSettingsRevision: state.settingsRevision,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).settings.modelControls["saved/model-1799"]
      .selection,
    "disabled",
  );
});
