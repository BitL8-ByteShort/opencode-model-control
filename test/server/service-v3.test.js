import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlService } from "../../src/server/service.js";
import { publicFixture, liveModel } from "../fixtures/public-metadata.js";
const discovery = (models) => async () => ({
  installed: true,
  version: "1.18.22",
  models,
  availableIds: models.map((m) => m.id),
  complete: true,
  error: null,
  checkedAt: new Date().toISOString(),
});
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "omc-v3-service-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, "settings.json");
  const service = await new ControlService({
    settingsPath,
    discovery: discovery([liveModel("new/model")]),
    metadataFetch: async () =>
      new Response(JSON.stringify(publicFixture([{ id: "new/model" }]))),
    ...options,
  }).initialize();
  t.after(() => service.close());
  return { service, settingsPath, directory };
}
test("startup and periodic catalog refresh enroll new models without creating saved intent", async (t) => {
  let tick,
    cleared = false;
  const { service, settingsPath } = await setup(t, {
    setInterval: (fn, ms) => {
      assert.equal(ms, 900000);
      tick = fn;
      return { unref() {} };
    },
    clearInterval: () => {
      cleared = true;
    },
  });
  assert.equal(
    service.getState().catalog.find((m) => m.id === "new/model")
      .effectiveEnabled,
    true,
  );
  await assert.rejects(access(settingsPath), (e) => e.code === "ENOENT");
  await tick();
  await service.close();
  assert.equal(cleared, true);
  await assert.rejects(access(settingsPath), (e) => e.code === "ENOENT");
});
test("CAS rejects a stale draft while catalog-only discovery rebases a valid edit", async (t) => {
  const { service, settingsPath } = await setup(t);
  const base = service.getState();
  service.discovery = discovery([
    liveModel("new/model"),
    liveModel("new/second"),
  ]);
  await service.refreshCatalog();
  const saved = await service.updateSettings(
    { ...base.settings, maxDelegationDepth: 0 },
    {
      expectedSettingsRevision: base.settingsRevision,
      catalogRevision: base.catalogRevision,
    },
  );
  assert.equal(
    saved.catalog.some((m) => m.id === "new/second"),
    true,
  );
  assert.equal(saved.settings.maxDelegationDepth, 0);
  await assert.rejects(
    service.updateSettings(
      { ...base.settings, makeRouterDefault: false },
      { expectedSettingsRevision: base.settingsRevision },
    ),
    (e) => e.statusCode === 409,
  );
  assert.equal(
    JSON.parse(await readFile(settingsPath, "utf8")).makeRouterDefault,
    true,
  );
  await assert.rejects(
    service.updateSettings(base.settings),
    (e) => e.code === "SETTINGS_REVISION_REQUIRED",
  );
});
test("blocked saved pins survive refresh and unrelated saves; newly edited blocked pins fail", async (t) => {
  const { service } = await setup(t);
  let state = service.getState();
  state = await service.updateSettings(
    {
      ...state.settings,
      roleAssignments: {
        ...state.settings.roleAssignments,
        orchestrator: "new/model",
      },
    },
    { expectedSettingsRevision: state.settingsRevision },
  );
  service.metadataFetch = async () =>
    new Response(
      JSON.stringify(publicFixture([{ id: "new/model", input: 1, output: 2 }])),
    );
  await service.refreshCatalog();
  state = service.getState();
  assert.equal(state.settings.roleAssignments.orchestrator, "new/model");
  assert.ok(state.blockedRoles.orchestrator.length);
  state = await service.updateSettings(
    { ...state.settings, makeRouterDefault: false },
    { expectedSettingsRevision: state.settingsRevision },
  );
  await assert.rejects(
    service.updateSettings(
      {
        ...state.settings,
        roleAssignments: {
          ...state.settings.roleAssignments,
          reviewer: "new/model",
        },
      },
      { expectedSettingsRevision: state.settingsRevision },
    ),
    (e) => e.statusCode === 409 && e.code === "SELECTION_CONFLICT",
  );
});
test("successful repricing survives incomplete discovery and failed refresh does not renew success age", async (t) => {
  const { service } = await setup(t);
  let state = service.getState();
  const old = state.system.catalog.pricingSucceededAt;
  service.discovery = async () => ({
    installed: true,
    models: [],
    complete: false,
    error: { code: "INCOMPLETE", message: "incomplete" },
  });
  service.metadataFetch = async () =>
    new Response(
      JSON.stringify(publicFixture([{ id: "new/model", input: 1, output: 2 }])),
    );
  await service.refreshCatalog();
  state = service.getState();
  assert.equal(
    state.catalog.find((m) => m.id === "new/model").pricingClass,
    "paid",
  );
  assert.equal(state.catalog.find((m) => m.id === "new/model").available, true);
  const success = state.system.catalog.pricingSucceededAt;
  assert.ok(success >= old);
  service.metadataFetch = async () => {
    throw new Error("secret failure");
  };
  await service.refreshCatalog();
  state = service.getState();
  assert.equal(state.system.catalog.pricingSucceededAt, success);
  assert.equal(
    state.catalog.find((m) => m.id === "new/model").pricingClass,
    "paid",
  );
  assert.equal(JSON.stringify(state).includes("secret failure"), false);
});
test("existing service reloads another process catalog snapshot and settings coherently", async (t) => {
  const { service, settingsPath } = await setup(t);
  const other = await new ControlService({
    settingsPath,
    discovery: discovery([]),
    metadataFetch: async () => new Response("{}"),
  }).initialize();
  t.after(() => other.close());
  service.discovery = discovery([
    liveModel("new/model"),
    liveModel("new/second"),
  ]);
  service.metadataFetch = async () =>
    new Response(
      JSON.stringify(
        publicFixture([{ id: "new/model" }, { id: "new/second" }]),
      ),
    );
  await service.refreshCatalog();
  let state = service.getState();
  await service.updateSettings(
    { ...state.settings, autoIncludeNewModels: false },
    { expectedSettingsRevision: state.settingsRevision },
  );
  await other.reloadSettings();
  state = other.getState();
  assert.equal(state.catalogRevision, service.getState().catalogRevision);
  assert.equal(state.settingsRevision, service.getState().settingsRevision);
  assert.equal(
    state.catalog.find((m) => m.id === "new/second").effectiveEnabled,
    false,
  );
});

test("same-process refresh calls coalesce and shutdown releases the active lease", async (t) => {
  const { service, settingsPath } = await setup(t);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  service.metadataFetch = async () => {
    started();
    await gate;
    return new Response(JSON.stringify(publicFixture([{ id: "new/model" }])));
  };
  const first = service.refreshCatalog();
  await began;
  const second = service.refreshCatalog();
  const closing = service.close();
  release();
  const [a, b] = await Promise.all([first, second]);
  await closing;
  assert.equal(a.catalogRevision, b.catalogRevision);
  await assert.rejects(
    access(`${settingsPath}.refresh-lease`),
    (e) => e.code === "ENOENT",
  );
  const state = await service.refreshCatalog();
  assert.equal(state.catalogRevision, a.catalogRevision);
});

test("automatic refresh leaves saved bytes unchanged and new policy identities absent from saved controls", async (t) => {
  const { service, settingsPath } = await setup(t);
  let state = service.getState();
  await service.updateSettings(
    {
      ...state.settings,
      modelControls: { "old/gone": { selection: "disabled" } },
    },
    { expectedSettingsRevision: state.settingsRevision },
  );
  const before = await readFile(settingsPath, "utf8");
  service.discovery = discovery([
    liveModel("new/model"),
    liveModel("new/later"),
  ]);
  service.metadataFetch = async () =>
    new Response(
      JSON.stringify(publicFixture([{ id: "new/model" }, { id: "new/later" }])),
    );
  await service.refreshCatalog();
  state = service.getState();
  assert.equal(
    state.catalog.find((m) => m.id === "new/later").effectiveEnabled,
    true,
  );
  assert.equal(await readFile(settingsPath, "utf8"), before);
  assert.equal(state.settings.modelControls["new/later"], undefined);
  assert.equal(state.settings.modelControls["old/gone"].selection, "disabled");
});

test("every concurrent close waits for active metadata work and lease release", async (t) => {
  const { service, settingsPath } = await setup(t);
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const began = new Promise((resolve) => {
    started = resolve;
  });
  service.metadataFetch = async () => {
    started();
    await gate;
    return new Response(JSON.stringify(publicFixture([{ id: "new/model" }])));
  };
  const refresh = service.refreshCatalog();
  await began;
  const first = service.close();
  let secondDone = false;
  const second = service.close().then(() => {
    secondDone = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const premature = secondDone;
  release();
  await Promise.all([refresh, first, second]);
  assert.equal(premature, false);
  await assert.rejects(
    access(`${settingsPath}.refresh-lease`),
    (e) => e.code === "ENOENT",
  );
});
