import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ControlService } from "../../src/server/service.js";
import { createModelControlMcpServer } from "../../src/mcp/server.js";
import { readConnectionSnapshot, writeConnectionSnapshot } from "../../src/server/connection-store.js";
import { publicFixture, liveModel } from "../fixtures/public-metadata.js";
test("an already connected MCP reloads panel discoveries and policy revisions before tools", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "omc-mcp-v3-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = {
    settingsPath: join(dir, "settings.json"),
    discovery: async () => ({
      installed: true,
      version: "1.18.22",
      models: [liveModel("new/model")],
      complete: true,
      error: null,
    }),
    metadataFetch: async () =>
      new Response(JSON.stringify(publicFixture([{ id: "new/model" }]))),
  };
  const panel = await new ControlService(options).initialize();
  t.after(() => panel.close());
  const backend = await new ControlService(options).initialize();
  t.after(() => backend.close());
  const server = await createModelControlMcpServer({ service: backend });
  const client = new Client({ name: "snapshot-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  panel.discovery = async () => ({
    installed: true,
    models: [liveModel("new/model"), liveModel("new/second")],
    complete: true,
    error: null,
  });
  panel.metadataFetch = async () =>
    new Response(
      JSON.stringify(
        publicFixture([{ id: "new/model" }, { id: "new/second" }]),
      ),
    );
  await panel.refreshCatalog();
  const state = panel.getState();
  await panel.updateSettings(
    { ...state.settings, autoIncludeNewModels: false },
    { expectedSettingsRevision: state.settingsRevision },
  );
  const result = await client.callTool({
    name: "get_model_status",
    arguments: {},
  });
  const payload = result.structuredContent;
  assert.equal(payload.catalogRevision, panel.getState().catalogRevision);
  assert.equal(payload.settingsRevision, panel.getState().settingsRevision);
  assert.equal(
    payload.models.find((m) => m.id === "new/second").effectiveEnabled,
    false,
  );
  assert.equal(
    payload.models.find((m) => m.id === "new/second").pricingClass,
    "free",
  );
  assert.ok(payload.blockedRoles.orchestrator.length);
  assert.equal(payload.policy.maxFallbacksPerAssignment, 1);
  assert.equal(
    payload.catalog.attemptedAt,
    panel.getState().system.catalog.attemptedAt,
  );
  assert.equal(
    payload.catalog.discoverySucceededAt,
    panel.getState().system.catalog.discoverySucceededAt,
  );
  assert.equal(
    payload.catalog.pricingSucceededAt,
    panel.getState().system.catalog.pricingSucceededAt,
  );
  assert.equal(
    payload.catalog.succeededAt,
    panel.getState().system.catalog.succeededAt,
  );
  assert.equal(payload.catalog.status, "success");
  assert.equal(payload.openCode.checkedAtSource, "process-local-discovery");
  const successful = payload.catalog;
  panel.now = () => Date.now() + 30000;
  panel.discovery = async () => ({
    installed: true,
    models: [],
    complete: false,
    error: { code: "FAIL", message: "failed" },
  });
  panel.metadataFetch = async () => new Response("{}", { status: 503 });
  await panel.refreshCatalog();
  const failed = (
    await client.callTool({ name: "get_model_status", arguments: {} })
  ).structuredContent;
  assert.equal(failed.catalog.status, "failure");
  assert.notEqual(failed.catalog.attemptedAt, successful.attemptedAt);
  for (const field of [
    "succeededAt",
    "discoverySucceededAt",
    "pricingSucceededAt",
  ])
    assert.equal(failed.catalog[field], successful[field]);
});

test("MCP routing decisions include the exact snapshot revisions and bounded workflow policy", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "omc-mcp-route-v3-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const backend = await new ControlService({
    settingsPath: join(dir, "settings.json"),
    discovery: async () => ({
      installed: true,
      models: [liveModel("new/model")],
      complete: true,
      error: null,
    }),
    metadataFetch: async () =>
      new Response(JSON.stringify(publicFixture([{ id: "new/model" }]))),
  }).initialize();
  const server = await createModelControlMcpServer({ service: backend });
  const client = new Client({ name: "route-revisions", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const result = await client.callTool({
    name: "route_task",
    arguments: { task: "Explain this function", modality: "text" },
  });
  const payload = result.structuredContent;
  assert.equal(payload.settingsRevision, backend.getState().settingsRevision);
  assert.equal(payload.catalogRevision, backend.getState().catalogRevision);
  assert.equal(payload.policy.maxDelegationDepth, 1);
  assert.equal(payload.policy.maxFallbacksPerAssignment, 1);
  assert.equal(payload.policy.recursiveDelegation, false);
  assert.equal(payload.connectionRevision, backend.getState().connectionRevision);
  assert.equal(payload.assignments[0].connectionId, backend.getState().connections[0].id);
  const settingsPath = join(dir, "settings.json");
  const snapshot = await readConnectionSnapshot({ settingsPath });
  snapshot.connections[0].entitlement = "reported-revoked";
  await writeConnectionSnapshot({ settingsPath, snapshot });
  const blocked = await client.callTool({ name: "route_task", arguments: { task: "Explain this function", modality: "text" } });
  assert.equal(blocked.isError, true);
  assert.equal(blocked.structuredContent.error.code, "NO_ELIGIBLE_FREE_MODEL");
});
