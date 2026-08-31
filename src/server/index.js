import { createControlServer } from "./app.js";
import { launchBrowser } from "./browser.js";

function readPort(value) {
  const port = Number.parseInt(value ?? "47821", 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("OMC_PORT must be an integer between 1024 and 65535.");
  }
  return port;
}

const development = process.argv.includes("--dev");
const port = readPort(process.env.OMC_PORT);
const host = "127.0.0.1";
const app = await createControlServer({ development });

app.server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  process.stdout.write(`OpenCode Model Control: ${url}\n`);
  if (process.env.OMC_OPEN_BROWSER === "1") launchBrowser(url);
});

app.server.once("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    process.stderr.write(`Port ${port} is already in use. Set OMC_PORT to another local port.\n`);
  } else {
    process.stderr.write("The local control service could not start.\n");
  }
  process.exitCode = 1;
});

async function shutdown(signal) {
  process.stdout.write(`\n${signal}: shutting down local control service.\n`);
  await app.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
