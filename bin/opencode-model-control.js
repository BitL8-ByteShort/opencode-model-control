#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const argumentsList = process.argv.slice(2);

if (argumentsList[0] === "mcp") {
  await import("../src/mcp/index.js");
} else if (["status", "connect", "disconnect", "install", "uninstall"].includes(argumentsList[0])) {
  const { runIntegrationCli } = await import("../src/installer/cli.js");
  process.exitCode = await runIntegrationCli({ args: argumentsList });
} else if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
  process.stdout.write(`OpenCode Model Control

Usage:
  opencode-model-control [--no-open]
  opencode-model-control mcp
  opencode-model-control status [--json]
  opencode-model-control connect --yes [--json]
  opencode-model-control disconnect --yes [--json]

Environment:
  OMC_PORT                  Local loopback port (default: 47821)
  OMC_CONFIG_DIR            Override the private settings directory; use the same
                            value for the panel, MCP, and OpenCode plugin process
  OMC_OPENCODE_CONFIG_PATH  Advanced/testing override for the exact OpenCode
                            config file managed by Connect and Disconnect

The panel starts without editing OpenCode. Connect and disconnect require explicit
confirmation and use a mode-0600 backup plus an ownership receipt.
`);
} else if (argumentsList.includes("--version") || argumentsList.includes("-v")) {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  process.stdout.write(`${packageJson.version}\n`);
} else {
  process.env.OMC_OPEN_BROWSER = argumentsList.includes("--no-open") ? "0" : "1";
  await import("../src/server/index.js");
}
