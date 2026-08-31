import test from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createModelControlMcpServer } from "../../src/mcp/server.js";

function fakeService() {
  return {
    async reloadSettings() {},
    getState() {
      return {
        schemaVersion: 1,
        system: { openCode: { installed: true, version: "1.18.22", checkedAt: "2026-08-30" } },
        settings: {
          roleAssignments: {
            orchestrator: "opencode/big-pickle",
            "code-worker": "auto",
            "vision-worker": "opencode/mimo-v2.5-free",
            reviewer: "auto",
          },
        },
        catalog: [
          {
            id: "opencode/big-pickle",
            label: "Big Pickle",
            enabled: true,
            available: true,
            free: { verified: true },
            modalities: { input: ["text"] },
            evidence: { status: "candidate" },
          },
        ],
      };
    },
    route({ modality }) {
      return {
        schemaVersion: 1,
        route: "delegate",
        task: {
          description: "private task description",
          kind: modality === "image" ? "vision" : "code",
          modalities: [modality],
          delegationDepth: 0,
        },
        assignments: [
          {
            role: "vision-worker",
            modelId: "opencode/mimo-v2.5-free",
            fallbackModelId: null,
            mayDelegate: false,
          },
        ],
        reasons: ["The task requires image input."],
        integrationWarning: "Use the vision agent directly for the original attachment.",
      };
    },
  };
}

async function connectedClient() {
  const server = await createModelControlMcpServer({ service: fakeService() });
  const client = new Client({ name: "model-control-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("MCP exposes only the two read-only routing tools", async (t) => {
  const { client, server } = await connectedClient();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.listTools();
  assert.deepEqual(
    result.tools.map(({ name }) => name).sort(),
    ["get_model_status", "route_task"],
  );
  assert.ok(result.tools.every((tool) => tool.annotations?.readOnlyHint === true));
});

test("MCP relays panel state without secrets and returns a bounded route", async (t) => {
  const { client, server } = await connectedClient();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const status = await client.callTool({ name: "get_model_status", arguments: {} });
  const statusText = status.content.find(({ type }) => type === "text")?.text ?? "";
  assert.match(statusText, /opencode\/big-pickle/u);
  assert.doesNotMatch(statusText, /token|authorization|credential/iu);

  const route = await client.callTool({
    name: "route_task",
    arguments: { task: "Understand this screenshot", modality: "image" },
  });
  const routePayload = JSON.parse(route.content.find(({ type }) => type === "text").text);
  assert.equal(routePayload.assignments.length, 1);
  assert.equal(routePayload.assignments[0].agentId, "omc-vision-worker");
  assert.equal(routePayload.assignments[0].mayDelegate, false);
  assert.equal(JSON.stringify(routePayload).includes("private task description"), false);
});
