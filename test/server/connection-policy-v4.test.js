import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ControlService } from "../../src/server/service.js";
import { publicFixture, liveModel } from "../fixtures/public-metadata.js";
import { readConnectionSnapshot, writeConnectionSnapshot } from "../../src/server/connection-store.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "omc-connection-policy-"));
  const settingsPath = join(root, "settings.json");
  const service = await new ControlService({
    settingsPath,
    discovery: async () => ({ installed: true, complete: true, models: [liveModel("new/model")], error: null }),
    metadataFetch: async () => new Response(JSON.stringify(publicFixture([{ id: "new/model" }]))),
  }).initialize();
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  return { service, settingsPath };
}
const binding = (connection) => ({ connectionId: connection.id, bindingRevision: connection.bindingRevision });
const revisions = (state) => ({ expectedSettingsRevision: state.settingsRevision, expectedConnectionRevision: state.connectionRevision, catalogRevision: state.catalogRevision });

test("billing changes require a connection revision and apply immediately without refresh", async (t) => {
  const { service } = await fixture(t);
  const state = service.getState(), connection = state.connections[0];
  const settings = { ...state.settings, billingDeclarations: { [connection.id]: { kind: "subscription", bindingRevision: connection.bindingRevision } } };
  await assert.rejects(service.updateSettings(settings, { expectedSettingsRevision: state.settingsRevision }), { code: "CONNECTION_REVISION_REQUIRED" });
  const saved = await service.updateSettings(settings, revisions(state));
  assert.equal(saved.connections[0].billing.kind, "subscription");
  assert.equal(saved.connections[0].billing.source, "user-declared");
  assert.throws(() => service.route({ task: "Explain this function", modality: "text" }));
  const cleared = await service.updateSettings({ ...saved.settings, billingDeclarations: {} }, revisions(saved));
  assert.equal(cleared.connections[0].billing.kind, "unknown");
});

test("planner rejects changed pins and exposes exact connection on valid paid plans", async (t) => {
  const { service, settingsPath } = await fixture(t);
  let state = service.getState(), connection = state.connections[0];
  state = await service.updateSettings({ ...state.settings, costPolicy: "known-cost", paidEligibility: "configured-connections", roleAssignments: { ...state.settings.roleAssignments, orchestrator: "new/model" }, roleConnections: { ...state.settings.roleConnections, orchestrator: binding(connection) } }, revisions(state));
  const plan = service.route({ task: "Explain this function", modality: "text" });
  assert.equal(plan.assignments[0].connectionId, connection.id);
  assert.equal(plan.connectionRevision, state.connectionRevision);
  const snapshot = await readConnectionSnapshot({ settingsPath });
  snapshot.connections[0].bindingRevision = "f".repeat(32);
  await writeConnectionSnapshot({ settingsPath, snapshot });
  await service.reloadSettings();
  assert.ok(service.getState().blockedRoles.orchestrator.includes("connection-binding-changed"));
  assert.throws(() => service.route({ task: "Explain this function", modality: "text" }), { code: "INVALID_ROLE_ASSIGNMENT" });
  await assert.rejects(service.updateSettings({ ...state.settings, billingDeclarations: { [connection.id]: { kind: "subscription", bindingRevision: connection.bindingRevision } } }, revisions(state)), { code: "CONNECTION_CONFLICT" });
});

test("binding-only edits are validated and unrelated saves retain new connections", async (t) => {
  const { service } = await fixture(t);
  const state = service.getState();
  await assert.rejects(service.updateSettings({ ...state.settings, roleConnections: { ...state.settings.roleConnections, orchestrator: { connectionId: "e".repeat(32), bindingRevision: "f".repeat(32) } } }, revisions(state)), { code: "CONNECTION_CONFLICT" });
  service.discovery = async () => ({ installed: true, complete: true, models: [liveModel("new/model"), liveModel("second/model")] });
  await service.refreshCatalog();
  const saved = await service.updateSettings({ ...state.settings, maxDelegationDepth: 0 }, revisions(state));
  assert.equal(saved.connections.length, 2);
});

test("failed discovery preserves cached connection bindings without renewing observation time", async (t) => {
  const { service } = await fixture(t);
  const before = service.getState().connections;
  service.discovery = async () => { throw new Error("offline"); };
  await service.refreshCatalog();
  assert.deepEqual(service.getState().connections, before);
});

test("new explicit pins cannot bypass or remove their exact connection binding", async (t) => {
  const { service } = await fixture(t);
  let state = service.getState();
  const settings = { ...state.settings, roleAssignments: { ...state.settings.roleAssignments, orchestrator: "new/model" } };
  await assert.rejects(service.updateSettings(settings, { expectedSettingsRevision: state.settingsRevision }), { code: "CONNECTION_REVISION_REQUIRED" });
  await assert.rejects(service.updateSettings(settings, revisions(state)), { code: "CONNECTION_CONFLICT" });
  state = await service.updateSettings({ ...settings, roleConnections: { ...settings.roleConnections, orchestrator: binding(state.connections[0]) } }, revisions(state));
  await assert.rejects(service.updateSettings({ ...state.settings, roleConnections: { ...state.settings.roleConnections, orchestrator: null } }, revisions(state)), { code: "CONNECTION_CONFLICT" });
});
