import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const CLI_ENTRY = fileURLToPath(
  new URL("../../bin/opencode-model-control.js", import.meta.url),
);

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function waitForOutput(child, getOutput, pattern, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}; output:\n${getOutput()}`));
    }, timeoutMs);

    const onData = () => {
      if (pattern.test(getOutput())) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `CLI exited before startup (code=${code}, signal=${signal}); output:\n${getOutput()}`,
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
    onData();
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (exited === false && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

test("normal CLI ignores NODE_ENV=development and never imports Vite", async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "omc-production-entry-"));
  const loaderPath = join(temporaryDirectory, "reject-vite-loader.mjs");
  await writeFile(
    loaderPath,
    `export async function resolve(specifier, context, nextResolve) {
  if (specifier === "vite") throw new Error("VITE_IMPORT_FORBIDDEN");
  return nextResolve(specifier, context);
}\n`,
    "utf8",
  );

  const port = await reserveLoopbackPort();
  let stdout = "";
  let stderr = "";
  const child = spawn(
    process.execPath,
    [
      `--experimental-loader=${pathToFileURL(loaderPath).href}`,
      CLI_ENTRY,
      "--no-open",
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        OMC_CONFIG_DIR: join(temporaryDirectory, "config"),
        OMC_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    await stopChild(child);
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  await waitForOutput(child, () => stdout + stderr, /OpenCode Model Control:/);
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src/);
  assert.doesNotMatch(stdout + stderr, /VITE_IMPORT_FORBIDDEN/);
});
