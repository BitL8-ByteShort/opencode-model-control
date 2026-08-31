import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { verifyMcpCommand } from "../../src/installer/index.js";

const cliPath = fileURLToPath(
  new URL("../../bin/opencode-model-control.js", import.meta.url),
);

test("the exact installed MCP command completes a stdio handshake", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "omc-stdio-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "mcp"],
    cwd: root,
    env: {
      HOME: root,
      OMC_CONFIG_DIR: join(root, "model-control"),
      PATH: "/usr/bin:/bin",
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_STATE_HOME: join(root, "state"),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "omc-stdio-acceptance", version: "1.0.0" });
  context.after(async () => client.close());

  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map(({ name }) => name).sort(),
    ["get_model_status", "route_task"],
  );
});

test("the installer preflight verifies the exact configured MCP command", async () => {
  assert.deepEqual(
    await verifyMcpCommand({ command: [process.execPath, cliPath, "mcp"] }),
    { verified: true },
  );
});
