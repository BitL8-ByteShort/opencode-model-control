import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createModelControlMcpServer } from "./server.js";

serveStdio(() => createModelControlMcpServer(), {
  onerror(error) {
    process.stderr.write(`OpenCode Model Control MCP error: ${error.name}\n`);
  },
});
