import assert from "node:assert/strict";
import { execFile as systemExecFile, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runOpenCodeRuntimeQualification,
  runtimeResponseMatches,
} from "../../src/server/runtime-qualification.js";

const resultId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function resolvedRuntimeConfig(modelId = "opencode/example-model") {
  return {
    share: "disabled",
    instructions: [],
    plugin: [],
    mcp: {},
    agent: {
      "omc-runtime-check": {
        mode: "primary",
        model: modelId,
      },
    },
  };
}

function noAuthEnvironment() {
  return {
    HOME: join(tmpdir(), "omc-runtime-test-home-without-auth"),
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
  };
}

test("only exact assistant text events satisfy a runtime challenge", () => {
  const challenge = "OMC_RUNTIME_OK_AAAABBBB";
  assert.equal(runtimeResponseMatches(`${JSON.stringify({ type: "user", text: challenge })}\n`, challenge), false);
  assert.equal(runtimeResponseMatches(`${JSON.stringify({ type: "text", part: { text: `${challenge} extra` } })}\n`, challenge), false);
  assert.equal(runtimeResponseMatches(`${JSON.stringify({ type: "text", part: { text: challenge } })}\n`, challenge), true);
});

test("runtime qualification uses a bounded isolated provider check run and discards raw output", async () => {
  const invocations = [];
  const dates = [new Date("2026-08-31T12:00:00.000Z"), new Date("2026-08-31T12:00:01.250Z")];
  const result = await runOpenCodeRuntimeQualification({
    modelId: "opencode/example-model",
    openCodeVersion: "1.18.22",
    createId: () => resultId,
    now: () => dates.shift(),
    environment: noAuthEnvironment(),
    execFile(file, args, options, callback) {
      invocations.push({ file, args, options });
      if (args[0] === "debug") {
        callback(null, JSON.stringify(resolvedRuntimeConfig()), "");
        return;
      }
      const challenge = args.at(-1).match(/OMC_RUNTIME_OK_[A-Z0-9]+/u)?.[0];
      callback(null, `${JSON.stringify({ type: "text", text: challenge })}\n`, "private stderr");
    },
  });

  assert.equal(invocations.length, 2);
  const [preflightInvocation, providerInvocation] = invocations;
  assert.equal(preflightInvocation.file, "opencode");
  assert.deepEqual(preflightInvocation.args, ["debug", "config", "--pure"]);
  assert.equal(preflightInvocation.options.cwd, providerInvocation.args[9]);
  assert.equal(providerInvocation.file, "opencode");
  assert.deepEqual(providerInvocation.args.slice(0, 9), [
    "run",
    "--pure",
    "--model",
    "opencode/example-model",
    "--agent",
    "omc-runtime-check",
    "--format",
    "json",
    "--dir",
  ]);
  assert.equal(providerInvocation.options.shell, false);
  assert.equal(providerInvocation.options.timeout, 60_000);
  assert.equal(providerInvocation.options.env.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
  assert.equal(providerInvocation.options.env.OPENCODE_CONFIG, undefined);
  assert.equal(providerInvocation.options.env.OPENCODE_PURE, "1");
  assert.equal(providerInvocation.options.env.OPENCODE_DB.startsWith(providerInvocation.args[9]), true);
  assert.equal(providerInvocation.options.env.OPENCODE_CONFIG_DIR.startsWith(providerInvocation.args[9]), true);
  assert.equal(providerInvocation.options.env.OPENCODE_TEST_HOME, providerInvocation.args[9]);
  assert.equal(providerInvocation.options.env.OPENCODE_TEST_MANAGED_CONFIG_DIR.startsWith(providerInvocation.args[9]), true);
  assert.equal(providerInvocation.options.env.XDG_CONFIG_HOME.startsWith(providerInvocation.args[9]), true);
  const isolatedConfig = JSON.parse(providerInvocation.options.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(isolatedConfig.instructions, []);
  assert.deepEqual(isolatedConfig.plugin, []);
  assert.deepEqual(isolatedConfig.mcp, {});
  assert.equal(isolatedConfig.share, "disabled");
  assert.deepEqual(isolatedConfig.tools, { "*": false });
  assert.equal(isolatedConfig.agent["omc-runtime-check"].steps, 1);
  assert.deepEqual(isolatedConfig.agent["omc-runtime-check"].tools, { "*": false });
  assert.deepEqual(isolatedConfig.agent["omc-runtime-check"].permission, { "*": "deny" });
  assert.equal(providerInvocation.args.at(-1).includes("Do not call tools"), true);
  assert.equal(result.status, "passed");
  assert.equal(result.evidenceType, "runtime-access-only");
  assert.equal(result.providerRequestAttempted, true);
  assert.equal(result.responseMatched, true);
  assert.equal(result.durationMs, 1250);
  assert.equal(JSON.stringify(result).includes("private stderr"), false);
  await assert.rejects(lstat(providerInvocation.args[9]), (error) => error?.code === "ENOENT");
});

test("runtime qualification records a redacted failure without exposing provider output", async () => {
  const result = await runOpenCodeRuntimeQualification({
    modelId: "opencode/example-model",
    createId: () => resultId,
    environment: noAuthEnvironment(),
    execFile(_file, args, _options, callback) {
      if (args[0] === "debug") {
        callback(null, JSON.stringify(resolvedRuntimeConfig()), "");
        return;
      }
      callback(Object.assign(new Error("sensitive provider failure"), { code: 7 }), "raw prompt", "secret response");
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 7);
  assert.equal(result.providerRequestAttempted, null);
  assert.equal(result.failure.code, "RUNTIME_CHECK_FAILED");
  assert.equal(JSON.stringify(result).includes("sensitive provider failure"), false);
  assert.equal(JSON.stringify(result).includes("secret response"), false);
  assert.equal(JSON.stringify(result).includes("raw prompt"), false);
});

test("a preflight failure records that no provider request was attempted", async () => {
  let invocations = 0;
  const result = await runOpenCodeRuntimeQualification({
    modelId: "opencode/example-model",
    createId: () => resultId,
    environment: noAuthEnvironment(),
    execFile(_file, _args, _options, callback) {
      invocations += 1;
      callback(Object.assign(new Error("missing executable"), { code: "ENOENT" }), "", "");
    },
  });

  assert.equal(invocations, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.providerRequestAttempted, false);
  assert.equal(result.failure.code, "OPENCODE_NOT_FOUND");
});

test("resolved instructions, MCP, or plugins stop the check before the provider phase", async () => {
  let invocations = 0;
  const result = await runOpenCodeRuntimeQualification({
    modelId: "opencode/example-model",
    createId: () => resultId,
    environment: noAuthEnvironment(),
    execFile(_file, _args, _options, callback) {
      invocations += 1;
      callback(null, JSON.stringify({
        ...resolvedRuntimeConfig(),
        instructions: ["HOSTILE_INSTRUCTION"],
        plugin: ["hostile-plugin"],
        mcp: { hostile: { type: "local", command: ["node", "hostile.js"] } },
      }), "");
    },
  });

  assert.equal(invocations, 1);
  assert.equal(result.providerRequestAttempted, false);
  assert.equal(result.failure.code, "RUNTIME_CHECK_ISOLATION_FAILED");
});

test("remote-config credentials fail closed before OpenCode starts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "omc-runtime-wellknown-auth-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const authDirectory = join(root, "data", "opencode");
  await mkdir(authDirectory, { recursive: true });
  await writeFile(join(authDirectory, "auth.json"), JSON.stringify({
    "https://provider.example": {
      type: "wellknown",
      key: "PROVIDER_TOKEN",
      token: "test-only-token",
    },
  }), { encoding: "utf8", mode: 0o600 });

  let invocations = 0;
  const result = await runOpenCodeRuntimeQualification({
    modelId: "provider/example-model",
    createId: () => resultId,
    environment: {
      ...noAuthEnvironment(),
      XDG_DATA_HOME: join(root, "data"),
    },
    execFile() {
      invocations += 1;
    },
  });

  assert.equal(invocations, 0);
  assert.equal(result.providerRequestAttempted, false);
  assert.equal(result.failure.code, "RUNTIME_CHECK_AUTH_ISOLATION_UNSUPPORTED");
});

test("the real OpenCode resolver excludes hostile inherited global instructions, MCP, and plugins", async (context) => {
  const probe = spawnSync("opencode", ["--version"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, NO_COLOR: "1" },
  });
  if (probe.error?.code === "ENOENT") {
    context.skip("OpenCode is not installed in this environment");
    return;
  }
  assert.equal(probe.status, 0, probe.stderr);

  const root = await mkdtemp(join(tmpdir(), "omc-runtime-hostile-global-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const hostileConfigDirectory = join(root, "hostile-config");
  const hostileConfigPath = join(hostileConfigDirectory, "opencode.json");
  const hostileXdgConfigDirectory = join(root, "opencode");
  const hostileXdgConfigPath = join(hostileXdgConfigDirectory, "opencode.json");
  const hostile = {
    instructions: ["HOSTILE_GLOBAL_INSTRUCTION_MUST_NOT_LOAD"],
    plugin: ["data:text/javascript,export default {}"],
    mcp: {
      hostile: {
        type: "local",
        command: ["node", "hostile-mcp.js"],
      },
    },
  };
  await mkdir(hostileConfigDirectory, { recursive: true });
  await mkdir(hostileXdgConfigDirectory, { recursive: true });
  await writeFile(hostileConfigPath, JSON.stringify(hostile), "utf8");
  await writeFile(hostileXdgConfigPath, JSON.stringify(hostile), "utf8");

  let resolved;
  const environment = {
    ...noAuthEnvironment(),
    OPENCODE_CONFIG: hostileConfigPath,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(hostile),
    OPENCODE_CONFIG_DIR: hostileConfigDirectory,
    OPENCODE_PERMISSION: JSON.stringify({ "*": "allow" }),
    OPENCODE_PLUGIN_META_FILE: join(root, "hostile-plugin-meta.json"),
    OPENCODE_WORKSPACE_ID: "hostile-workspace",
    XDG_CONFIG_HOME: root,
    XDG_DATA_HOME: join(root, "data"),
  };
  const result = await runOpenCodeRuntimeQualification({
    modelId: "opencode/example-model",
    createId: () => resultId,
    environment,
    execFile(file, args, options, callback) {
      if (args[0] !== "debug") {
        const challenge = args.at(-1).match(/OMC_RUNTIME_OK_[A-Z0-9]+/u)?.[0];
        callback(null, `${JSON.stringify({ type: "text", text: challenge })}\n`, "");
        return;
      }
      systemExecFile(file, args, options, (error, stdout, stderr) => {
        if (!error) resolved = JSON.parse(stdout);
        callback(error, stdout, stderr);
      });
    },
  });

  assert.equal(result.status, "passed", result.failure?.message);
  assert.deepEqual(resolved.instructions, []);
  assert.deepEqual(resolved.plugin, []);
  assert.deepEqual(resolved.mcp, {});
  assert.equal(resolved.agent["omc-runtime-check"].model, "opencode/example-model");
  assert.equal(resolved.agent["omc-runtime-check"].prompt, undefined);
});
