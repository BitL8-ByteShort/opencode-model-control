import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createModelControlMcpServer } from "./server.js";

const transport = serveStdio(() => createModelControlMcpServer(), {
  onerror(error) {
    process.stderr.write(`OpenCode Model Control MCP error: ${error.name}\n`);
  },
});

process.once("SIGINT", () => void transport.close());
process.once("SIGTERM", () => void transport.close());
