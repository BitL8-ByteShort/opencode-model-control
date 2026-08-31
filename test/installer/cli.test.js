import assert from "node:assert/strict";
import test from "node:test";

import { runIntegrationCli } from "../../src/installer/cli.js";

function outputBuffer() {
  let value = "";
  return {
    stream: { write(chunk) { value += chunk; } },
    value: () => value,
  };
}

function result(overrides = {}) {
  return {
    installed: false,
    managed: false,
    healthy: true,
    requiresAttention: false,
    changed: false,
    code: "NOT_INSTALLED",
    message: "OpenCode Model Control is not connected yet.",
    configPath: "/tmp/test-opencode.json",
    secret: "must-not-be-printed",
    ...overrides,
  };
}

test("CLI install and uninstall require explicit --yes before invoking operations", async () => {
  for (const command of ["connect", "disconnect", "install", "uninstall"]) {
    let calls = 0;
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const exitCode = await runIntegrationCli({
      args: [command],
      operations: {
        status: async () => result(),
        install: async () => { calls += 1; return result(); },
        uninstall: async () => { calls += 1; return result(); },
      },
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(exitCode, 2);
    assert.equal(calls, 0);
    assert.equal(stdout.value(), "");
    assert.match(stderr.value(), /--yes/);
  }
});

test("CLI status emits a bounded secret-free JSON result", async () => {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const exitCode = await runIntegrationCli({
    args: ["status", "--json"],
    operations: {
      status: async () => result(),
      install: async () => result(),
      uninstall: async () => result(),
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  const payload = JSON.parse(stdout.value());

  assert.equal(exitCode, 0);
  assert.equal(stderr.value(), "");
  assert.equal(payload.code, "NOT_INSTALLED");
  assert.equal(payload.secret, undefined);
  assert.doesNotMatch(stdout.value(), /must-not-be-printed/);
});

test("CLI confirmed connect invokes the install operation once", async () => {
  let calls = 0;
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const exitCode = await runIntegrationCli({
    args: ["connect", "--yes"],
    operations: {
      status: async () => result(),
      install: async () => {
        calls += 1;
        return result({ installed: true, managed: true, changed: true, code: "INSTALLED" });
      },
      uninstall: async () => result(),
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 0);
  assert.equal(calls, 1);
  assert.match(stdout.value(), /Connected/);
  assert.match(stdout.value(), /restarted/);
  assert.equal(stderr.value(), "");
});

test("CLI sanitizes unexpected errors", async () => {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const exitCode = await runIntegrationCli({
    args: ["status"],
    operations: {
      status: async () => { throw new Error("token=private-value"); },
      install: async () => result(),
      uninstall: async () => result(),
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.value(), "");
  assert.doesNotMatch(stderr.value(), /private-value/);
  assert.match(stderr.value(), /could not be changed safely/);
});
