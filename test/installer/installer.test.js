import assert from "node:assert/strict";
import test from "node:test";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  OpenCodeIntegrationInstaller,
  buildManagedOpenCodeFragment,
  launchResolvedOpenCodeConfig,
  resolvedConfigCommand,
} from "../../src/installer/index.js";
import { parseJsoncDocument } from "../../src/installer/jsonc-document.js";

async function fixture(t, {
  source,
  mode = 0o640,
  nodePath,
  cliPath,
  pluginPath,
  verify = async ({ source: proposed }) => {
    parseJsoncDocument(proposed);
    return { verified: true };
  },
  verifyCommand = async () => ({ verified: true }),
  beforeConfigWrite = async () => {},
  configLauncher,
  platform,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "omc-installer-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "opencode.jsonc");
  const receiptPath = join(directory, "private", "receipt.json");
  const resolvedPluginPath = pluginPath ?? join(directory, "omc-plugin.js");
  if (pluginPath === undefined) await writeFile(resolvedPluginPath, "export default {}\n");
  if (source !== undefined) await writeFile(configPath, source, { mode });
  let sequence = 0;
  const installer = new OpenCodeIntegrationInstaller({
    configPath,
    receiptPath,
    now: () => new Date("2026-08-30T21:45:00.000Z"),
    id: () => `test-${++sequence}`,
    nodePath,
    cliPath,
    pluginPath: resolvedPluginPath,
    verify,
    verifyCommand,
    beforeConfigWrite,
    configLauncher,
    platform,
  });
  return { configPath, directory, installer, receiptPath };
}

test("advanced config commands are shell-free and platform-specific", () => {
  const configPath = "/tmp/opencode.jsonc";
  assert.deepEqual(resolvedConfigCommand("open", configPath, { platform: "darwin", env: {} }), {
    command: "open",
    args: [configPath],
  });
  assert.deepEqual(resolvedConfigCommand("reveal", configPath, { platform: "darwin", env: {} }), {
    command: "open",
    args: ["-R", configPath],
  });
  assert.deepEqual(resolvedConfigCommand("open", configPath, { platform: "linux", env: {} }), {
    command: "xdg-open",
    args: [configPath],
  });
  assert.deepEqual(resolvedConfigCommand("reveal", configPath, { platform: "win32", env: {} }), {
    command: "explorer.exe",
    args: [`/select,${configPath}`],
  });
  assert.throws(
    () => resolvedConfigCommand("edit", configPath),
    (error) => error.code === "OPENCODE_CONFIG_ACTION_INVALID",
  );
});

test("advanced actions launch only the installer's exact resolved config path", async (t) => {
  const launches = [];
  const current = await fixture(t, {
    source: "{}\n",
    platform: "darwin",
    configLauncher: async (input) => {
      launches.push(input);
      return { opened: true };
    },
  });

  assert.deepEqual(await current.installer.openConfig(), {
    action: "open",
    configPath: current.configPath,
    opened: true,
  });
  assert.deepEqual(await current.installer.revealConfig(), {
    action: "reveal",
    configPath: current.configPath,
    opened: true,
  });
  assert.deepEqual(
    launches.map(({ action, configPath, platform }) => ({ action, configPath, platform })),
    [
      { action: "open", configPath: current.configPath, platform: "darwin" },
      { action: "reveal", configPath: current.configPath, platform: "darwin" },
    ],
  );
});

test("advanced actions fail closed for missing, linked, or failed config targets", async (t) => {
  await t.test("missing", async (nested) => {
    let launched = false;
    const current = await fixture(nested, {
      configLauncher: async () => { launched = true; },
    });
    await assert.rejects(
      current.installer.openConfig(),
      (error) => error.code === "OPENCODE_CONFIG_MISSING" && error.statusCode === 404,
    );
    assert.equal(launched, false);
  });

  await t.test("symlink", async (nested) => {
    const directory = await mkdtemp(join(tmpdir(), "omc-config-launch-link-"));
    nested.after(() => rm(directory, { recursive: true, force: true }));
    const target = join(directory, "target.jsonc");
    const configPath = join(directory, "opencode.jsonc");
    await writeFile(target, "{}\n");
    await symlink(target, configPath);
    const installer = new OpenCodeIntegrationInstaller({
      configPath,
      receiptPath: join(directory, "receipt.json"),
      configLauncher: async () => assert.fail("launcher must not run"),
    });
    await assert.rejects(
      installer.revealConfig(),
      (error) => error.code === "UNSAFE_FILE_TYPE" && error.statusCode === 422,
    );
  });

  await t.test("launcher failure", async (nested) => {
    const current = await fixture(nested, {
      source: "{}\n",
      configLauncher: async () => { throw new Error("private-path-or-command-detail"); },
    });
    await assert.rejects(
      current.installer.openConfig(),
      (error) =>
        error.code === "OPENCODE_CONFIG_OPEN_FAILED" &&
        error.statusCode === 503 &&
        !error.message.includes("private-path-or-command-detail"),
    );
  });
});

test("resolved config launcher explicitly disables shell execution", async () => {
  let invocation;
  await launchResolvedOpenCodeConfig({
    action: "open",
    configPath: "/tmp/opencode.jsonc",
    platform: "darwin",
    env: { PATH: "/usr/bin:/bin" },
    execFile(command, args, options, callback) {
      invocation = { command, args, options };
      callback(null, "", "");
    },
  });
  assert.equal(invocation.command, "open");
  assert.deepEqual(invocation.args, ["/tmp/opencode.jsonc"]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
});

test("installs into JSONC without removing comments or unrelated settings", async (t) => {
  const source = `{
  // This comment belongs to the user.
  "theme": "system",
  "mcp": {
    "existing": { "type": "remote", "url": "https://example.invalid/mcp" },
  },
}
`;
  const { configPath, installer, receiptPath } = await fixture(t, { source });

  const result = await installer.install();
  const installedSource = await readFile(configPath, "utf8");
  const installed = parseJsoncDocument(installedSource).value;
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));

  assert.equal(result.installed, true);
  assert.equal(result.changed, true);
  assert.equal(result.backupCreated, true);
  assert.match(installedSource, /This comment belongs to the user/);
  assert.equal(installed.theme, "system");
  assert.equal(installed.mcp.existing.url, "https://example.invalid/mcp");
  assert.deepEqual(installed.mcp["model-control"].command.slice(-1), ["mcp"]);
  assert.ok(installed.mcp["model-control"].command.slice(0, 2).every(isAbsolute));
  assert.equal(installed.tools["model-control_*"], false);
  assert.equal(installed.agent["omc-router"].mode, "primary");
  assert.equal(installed.default_agent, "omc-router");
  assert.equal(installed.plugin.length, 1);
  assert.match(installed.plugin[0], /^file:\/\//);
  assert.equal(receipt.product, "opencode-model-control");
  assert.equal(receipt.configPath, configPath);
  assert.ok(receipt.entries.some(({ path }) => path.join(".") === "default_agent"));
  assert.ok(receipt.entries.some(
    ({ kind, path, value }) =>
      kind === "array-item" && path.join(".") === "plugin" && value === installed.plugin[0],
  ));
  assert.equal((await stat(configPath)).mode & 0o777, 0o640);
  assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
  assert.equal((await stat(receipt.backupPath)).mode & 0o777, 0o600);
});

test("a repeated install is idempotent and does not create another backup", async (t) => {
  const { configPath, directory, installer } = await fixture(t, {
    source: "{\n  \"theme\": \"system\"\n}\n",
  });
  await installer.install();
  const before = await readFile(configPath, "utf8");
  const backupsBefore = (await readdir(directory)).filter((name) => name.includes("omc-backup"));

  const result = await installer.install();

  assert.equal(result.installed, true);
  assert.equal(result.changed, false);
  assert.equal(result.backupCreated, false);
  assert.equal(await readFile(configPath, "utf8"), before);
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.includes("omc-backup")),
    backupsBefore,
  );
});

test("install refuses to claim an existing managed key without a receipt", async (t) => {
  const { configPath, installer, receiptPath } = await fixture(t, {
    source: `{
  "mcp": {
    "model-control": { "type": "remote", "url": "https://example.invalid" }
  }
}
`,
  });
  const before = await readFile(configPath, "utf8");

  await assert.rejects(
    installer.install(),
    (error) => error.code === "OWNERSHIP_UNVERIFIED" && error.statusCode === 409,
  );
  assert.equal(await readFile(configPath, "utf8"), before);
  await assert.rejects(lstat(receiptPath), (error) => error.code === "ENOENT");
});

test("status and uninstall fail closed after a managed entry changes", async (t) => {
  const { configPath, installer, receiptPath } = await fixture(t, { source: "{}\n" });
  await installer.install();
  const installed = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  installed.tools["model-control_*"] = true;
  await writeFile(configPath, `${JSON.stringify(installed, null, 2)}\n`);
  const before = await readFile(configPath, "utf8");

  const status = await installer.status();
  assert.equal(status.installed, false);
  assert.equal(status.managed, true);
  assert.equal(status.healthy, false);
  assert.equal(status.code, "MANAGED_CONFIG_CHANGED");
  await assert.rejects(
    installer.uninstall(),
    (error) => error.code === "MANAGED_CONFIG_CHANGED",
  );
  assert.equal(await readFile(configPath, "utf8"), before);
  assert.equal((await stat(receiptPath)).isFile(), true);
});

test("a receipt never authorizes replacement of a newly added unmanaged product key", async (t) => {
  const { configPath, installer } = await fixture(t, { source: "{}\n" });
  await installer.install({
    settings: { roleAssignments: { reviewer: "" } },
  });
  const installed = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  installed.agent["omc-reviewer"] = { mode: "subagent", model: "someone/else" };
  await writeFile(configPath, `${JSON.stringify(installed, null, 2)}\n`);

  const status = await installer.status();
  assert.equal(status.code, "OWNERSHIP_CONFLICT");
  await assert.rejects(
    installer.install(),
    (error) => error.code === "OWNERSHIP_CONFLICT",
  );
  assert.equal(
    parseJsoncDocument(await readFile(configPath, "utf8")).value.agent["omc-reviewer"].model,
    "someone/else",
  );
});

test("uninstall removes only owned entries and retains user JSONC comments", async (t) => {
  const source = `{
  // Keep this comment and setting.
  "theme": "system"
}
`;
  const { configPath, installer, receiptPath } = await fixture(t, { source });
  await installer.install();

  const result = await installer.uninstall();
  const finalSource = await readFile(configPath, "utf8");
  const finalConfig = parseJsoncDocument(finalSource).value;

  assert.equal(result.installed, false);
  assert.equal(result.changed, true);
  assert.match(finalSource, /Keep this comment and setting/);
  assert.deepEqual(finalConfig, { theme: "system" });
  assert.equal(finalConfig.mcp, undefined);
  assert.equal(finalConfig.tools, undefined);
  assert.equal(finalConfig.agent, undefined);
  await assert.rejects(lstat(receiptPath), (error) => error.code === "ENOENT");
});

test("preserves user plugins and an existing user-owned default agent", async (t) => {
  const source = `${JSON.stringify({
    plugin: ["existing-plugin", "file:///opt/example/plugin.js"],
    default_agent: "user-primary",
    theme: "system",
  }, null, 2)}\n`;
  const { configPath, installer, receiptPath } = await fixture(t, { source });

  const installedResult = await installer.install();
  const installed = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));

  assert.equal(installedResult.defaultAgent, "user-primary");
  assert.equal(installedResult.defaultAgentManaged, false);
  assert.equal(installedResult.defaultAgentPreserved, true);
  assert.equal(installed.default_agent, "user-primary");
  assert.deepEqual(installed.plugin.slice(0, 2), [
    "existing-plugin",
    "file:///opt/example/plugin.js",
  ]);
  assert.equal(installed.plugin.length, 3);
  assert.equal(
    receipt.entries.some(({ path }) => path.join(".") === "default_agent"),
    false,
  );

  await installer.uninstall();
  const disconnected = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  assert.deepEqual(disconnected.plugin, [
    "existing-plugin",
    "file:///opt/example/plugin.js",
  ]);
  assert.equal(disconnected.default_agent, "user-primary");
  assert.equal(disconnected.theme, "system");
});

test("explicitly disabling the router default removes only a receipt-owned value", async (t) => {
  const { configPath, installer, receiptPath } = await fixture(t, { source: "{}\n" });
  await installer.install();
  assert.equal(
    parseJsoncDocument(await readFile(configPath, "utf8")).value.default_agent,
    "omc-router",
  );

  const result = await installer.install({ settings: { makeRouterDefault: false } });
  const updated = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));

  assert.equal(result.changed, true);
  assert.equal(updated.default_agent, undefined);
  assert.equal(
    receipt.entries.some(({ path }) => path.join(".") === "default_agent"),
    false,
  );
  assert.equal(updated.plugin.length, 1);
});

test("an existing v0.1.2 receipt upgrades without claiming user-owned values", async (t) => {
  const { configPath, installer, receiptPath } = await fixture(t, { source: "{}\n" });
  await installer.install({ settings: { makeRouterDefault: false } });

  const legacyConfig = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  delete legacyConfig.plugin;
  const legacyReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  legacyReceipt.entries = legacyReceipt.entries.filter(
    ({ path }) => !["plugin", "default_agent"].includes(path.join(".")),
  );
  delete legacyReceipt.managedSurfaceVersion;
  delete legacyReceipt.createdCollections;
  await writeFile(configPath, `${JSON.stringify(legacyConfig, null, 2)}\n`);
  await writeFile(receiptPath, `${JSON.stringify(legacyReceipt, null, 2)}\n`, { mode: 0o600 });

  const status = await installer.status();
  assert.equal(status.installed, true);
  assert.equal(status.managed, true);
  assert.equal(status.healthy, false);
  assert.equal(status.requiresAttention, true);
  assert.equal(status.code, "UPDATE_REQUIRED");

  const result = await installer.install();
  const upgraded = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  const upgradedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));

  assert.equal(result.changed, true);
  assert.equal(upgraded.default_agent, "omc-router");
  assert.equal(upgraded.plugin.length, 1);
  assert.ok(upgradedReceipt.entries.some(({ path }) => path.join(".") === "plugin"));
  assert.ok(upgradedReceipt.entries.some(({ path }) => path.join(".") === "default_agent"));
  assert.equal(upgradedReceipt.managedSurfaceVersion, 1);
});

test("a new package instance requires and safely applies an update from older valid package paths", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-installer-package-upgrade-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "opencode.jsonc");
  const receiptPath = join(directory, "receipt.json");
  const oldPackage = join(directory, "old-package-cache");
  const currentPackage = join(directory, "current-package-cache");
  await mkdir(oldPackage);
  await mkdir(currentPackage);

  const oldNodePath = join(oldPackage, "node");
  const oldCliPath = join(oldPackage, "opencode-model-control.js");
  const oldPluginPath = join(oldPackage, "plugin.js");
  const currentNodePath = join(currentPackage, "node");
  const currentCliPath = join(currentPackage, "opencode-model-control.js");
  const currentPluginPath = join(currentPackage, "plugin.js");
  for (const path of [oldNodePath, currentNodePath]) {
    await writeFile(path, "fake node\n", { mode: 0o700 });
    await chmod(path, 0o700);
  }
  for (const path of [oldCliPath, oldPluginPath, currentCliPath, currentPluginPath]) {
    await writeFile(path, "export default {}\n", { mode: 0o600 });
  }
  await writeFile(configPath, `${JSON.stringify({
    plugin: ["user-plugin"],
    default_agent: "user-primary",
  }, null, 2)}\n`);

  const installerOptions = {
    configPath,
    receiptPath,
    verify: async () => ({ verified: true }),
    verifyCommand: async () => ({ verified: true }),
  };
  const oldInstaller = new OpenCodeIntegrationInstaller({
    ...installerOptions,
    nodePath: oldNodePath,
    cliPath: oldCliPath,
    pluginPath: oldPluginPath,
  });
  await oldInstaller.install();
  assert.equal((await oldInstaller.status()).healthy, true);

  const currentInstaller = new OpenCodeIntegrationInstaller({
    ...installerOptions,
    nodePath: currentNodePath,
    cliPath: currentCliPath,
    pluginPath: currentPluginPath,
  });
  const before = await currentInstaller.status();
  assert.equal(before.installed, true);
  assert.equal(before.managed, true);
  assert.equal(before.healthy, false);
  assert.equal(before.requiresAttention, true);
  assert.equal(before.code, "UPDATE_REQUIRED");

  const result = await currentInstaller.install();
  const updated = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const oldPluginUrl = pathToFileURL(await realpath(oldPluginPath)).href;
  const currentPluginUrl = pathToFileURL(await realpath(currentPluginPath)).href;
  const currentCommand = [
    await realpath(currentNodePath),
    await realpath(currentCliPath),
    "mcp",
  ];

  assert.equal(result.changed, true);
  assert.equal(result.healthy, true);
  assert.equal(result.code, "INSTALLED");
  assert.deepEqual(updated.mcp["model-control"].command, currentCommand);
  assert.deepEqual(updated.plugin, ["user-plugin", currentPluginUrl]);
  assert.equal(updated.plugin.includes(oldPluginUrl), false);
  assert.equal(updated.default_agent, "user-primary");
  assert.equal(receipt.managedSurfaceVersion, 1);
  assert.deepEqual(
    receipt.entries.find(({ path }) => path.join(".") === "mcp.model-control").value.command,
    currentCommand,
  );
  assert.equal(
    receipt.entries.find(({ path }) => path.join(".") === "plugin").value,
    currentPluginUrl,
  );
});

test("plugin ownership is item-scoped and preserves plugins added after connect", async (t) => {
  const { configPath, installer } = await fixture(t, {
    source: `${JSON.stringify({ plugin: ["existing-plugin"] }, null, 2)}\n`,
  });
  await installer.install({ settings: { makeRouterDefault: false } });
  const connected = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  connected.plugin.push("later-user-plugin");
  await writeFile(configPath, `${JSON.stringify(connected, null, 2)}\n`);

  assert.equal((await installer.status()).healthy, true);
  await installer.uninstall();
  const disconnected = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  assert.deepEqual(disconnected.plugin, ["existing-plugin", "later-user-plugin"]);
});

test("install fails closed instead of claiming a matching unowned plugin entry", async (t) => {
  const current = await fixture(t, { source: "{}\n" });
  const pluginUrl = pathToFileURL(await realpath(current.installer.pluginPath)).href;
  await writeFile(
    current.configPath,
    `${JSON.stringify({ plugin: [pluginUrl] }, null, 2)}\n`,
  );
  const before = await readFile(current.configPath, "utf8");

  await assert.rejects(
    current.installer.install(),
    (error) => error.code === "OWNERSHIP_UNVERIFIED",
  );
  assert.equal(await readFile(current.configPath, "utf8"), before);
  await assert.rejects(lstat(current.receiptPath), (error) => error.code === "ENOENT");
});

test("install fails closed when the bundled plugin target is unavailable", async (t) => {
  const source = "{\n  \"theme\": \"system\"\n}\n";
  const current = await fixture(t, {
    source,
    pluginPath: join(tmpdir(), `missing-omc-plugin-${process.pid}.js`),
  });

  await assert.rejects(
    current.installer.install(),
    (error) => error.code === "PLUGIN_RUNTIME_UNAVAILABLE" && error.statusCode === 422,
  );
  assert.equal(await readFile(current.configPath, "utf8"), source);
  await assert.rejects(lstat(current.receiptPath), (error) => error.code === "ENOENT");
});

test("creates a missing config privately and can remove its managed entries", async (t) => {
  const { configPath, installer } = await fixture(t);

  const installed = await installer.install();
  assert.equal(installed.installed, true);
  assert.equal(installed.backupCreated, false);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);

  await installer.uninstall();
  assert.deepEqual(parseJsoncDocument(await readFile(configPath, "utf8")).value, {});
});

test("invalid or ambiguous JSONC is rejected without mutation", async (t) => {
  for (const source of [
    `{ "theme": }\n`,
    `{ "theme": "one", "theme": "two" }\n`,
    `{ "__proto__": { "polluted": true } }\n`,
  ]) {
    await t.test(source, async (nested) => {
      const current = await fixture(nested, { source });
      await assert.rejects(current.installer.install(), (error) => error.statusCode === 422);
      assert.equal(await readFile(current.configPath, "utf8"), source);
    });
  }
});

test("refuses a symlinked OpenCode config", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-installer-link-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, "target.json");
  const configPath = join(directory, "opencode.json");
  const receiptPath = join(directory, "receipt.json");
  await writeFile(target, "{}\n");
  await symlink(target, configPath);
  const installer = new OpenCodeIntegrationInstaller({ configPath, receiptPath });

  await assert.rejects(
    installer.install(),
    (error) => error.code === "UNSAFE_FILE_TYPE" && error.statusCode === 422,
  );
  assert.equal(await readFile(target, "utf8"), "{}\n");
});

test("managed fragment always uses an absolute local MCP command", () => {
  const fragment = buildManagedOpenCodeFragment();
  const command = fragment.mcp["model-control"].command;

  assert.equal(command.length, 3);
  assert.ok(isAbsolute(command[0]));
  assert.ok(isAbsolute(command[1]));
  assert.equal(command[2], "mcp");
  assert.doesNotMatch(command.join(" "), /npm link|npx/);
  assert.equal(fragment.plugin.length, 1);
  assert.match(fragment.plugin[0], /^file:\/\//);
  assert.equal(fragment.default_agent, undefined);

  const defaultFragment = buildManagedOpenCodeFragment({ includeDefaultAgent: true });
  assert.equal(defaultFragment.default_agent, "omc-router");
});

test("OpenCode verification failure leaves the config and receipt untouched", async (t) => {
  const source = "{\n  \"theme\": \"system\"\n}\n";
  const { configPath, installer, receiptPath } = await fixture(t, {
    source,
    verify: async () => {
      const error = new Error("verification failed with token=private");
      error.code = "VERIFY_FAILED";
      throw error;
    },
  });

  await assert.rejects(
    installer.install(),
    (error) =>
      error.code === "OPENCODE_VERIFY_FAILED" &&
      !error.message.includes("private"),
  );
  assert.equal(await readFile(configPath, "utf8"), source);
  await assert.rejects(lstat(receiptPath), (error) => error.code === "ENOENT");
});

test("install fails closed when the OpenCode config changes during verification", async (t) => {
  const source = "{\n  \"theme\": \"system\"\n}\n";
  const concurrentSource = "{\n  \"theme\": \"concurrent-edit\"\n}\n";
  const current = await fixture(t, {
    source,
    beforeConfigWrite: async ({ operation, configPath }) => {
      if (operation === "install") await writeFile(configPath, concurrentSource);
    },
  });

  await assert.rejects(
    current.installer.install(),
    (error) => error.code === "OPENCODE_CONFIG_CHANGED" && error.statusCode === 409,
  );
  assert.equal(await readFile(current.configPath, "utf8"), concurrentSource);
  await assert.rejects(lstat(current.receiptPath), (error) => error.code === "ENOENT");
  assert.deepEqual(
    (await readdir(current.directory)).filter((name) => name.includes("omc-backup")),
    [],
  );
});

test("uninstall fails closed when the OpenCode config changes after planning", async (t) => {
  const current = await fixture(t, { source: "{\n  \"theme\": \"system\"\n}\n" });
  await current.installer.install();
  const installed = parseJsoncDocument(await readFile(current.configPath, "utf8")).value;
  installed.theme = "concurrent-edit";
  const concurrentSource = `${JSON.stringify(installed, null, 2)}\n`;
  current.installer.beforeConfigWrite = async ({ operation, configPath }) => {
    if (operation === "uninstall") await writeFile(configPath, concurrentSource);
  };

  await assert.rejects(
    current.installer.uninstall(),
    (error) => error.code === "OPENCODE_CONFIG_CHANGED" && error.statusCode === 409,
  );
  assert.equal(await readFile(current.configPath, "utf8"), concurrentSource);
  assert.equal((await stat(current.receiptPath)).isFile(), true);
});

test("install canonicalizes the exact Node and CLI targets before verification", async (t) => {
  const current = await fixture(t, { source: "{}\n" });
  const nodeLink = join(current.directory, "node-link");
  const cliTarget = buildManagedOpenCodeFragment().mcp["model-control"].command[1];
  const cliLink = join(current.directory, "cli-link.js");
  await symlink(process.execPath, nodeLink);
  await symlink(cliTarget, cliLink);
  let verifiedCommand;
  const installer = new OpenCodeIntegrationInstaller({
    configPath: current.configPath,
    receiptPath: current.receiptPath,
    nodePath: nodeLink,
    cliPath: cliLink,
    verify: async () => ({ verified: true }),
    verifyCommand: async ({ command }) => {
      verifiedCommand = command;
      return { verified: true };
    },
  });

  await installer.install();
  const expected = [await realpath(process.execPath), await realpath(cliTarget), "mcp"];
  const installed = parseJsoncDocument(await readFile(current.configPath, "utf8")).value;
  assert.deepEqual(verifiedCommand, expected);
  assert.deepEqual(installed.mcp["model-control"].command, expected);
});

test("install rejects a missing command target before changing OpenCode", async (t) => {
  const source = "{\n  \"theme\": \"system\"\n}\n";
  const current = await fixture(t, {
    source,
    cliPath: join(tmpdir(), `missing-omc-cli-${process.pid}.js`),
  });

  await assert.rejects(
    current.installer.install(),
    (error) => error.code === "MCP_COMMAND_UNAVAILABLE" && error.statusCode === 422,
  );
  assert.equal(await readFile(current.configPath, "utf8"), source);
  await assert.rejects(lstat(current.receiptPath), (error) => error.code === "ENOENT");
});

test("status becomes unhealthy when either configured command target disappears", async (t) => {
  for (const removedTarget of ["node", "cli"]) {
    await t.test(removedTarget, async (nested) => {
      const current = await fixture(nested, { source: "{}\n" });
      const nodePath = join(current.directory, "node");
      const cliPath = join(current.directory, "cli.js");
      await writeFile(nodePath, "fake node\n", { mode: 0o700 });
      await chmod(nodePath, 0o700);
      await writeFile(cliPath, "fake cli\n", { mode: 0o600 });
      const installer = new OpenCodeIntegrationInstaller({
        configPath: current.configPath,
        receiptPath: current.receiptPath,
        nodePath,
        cliPath,
        verify: async () => ({ verified: true }),
        verifyCommand: async () => ({ verified: true }),
      });
      assert.equal((await installer.install()).installed, true);

      await unlink(removedTarget === "node" ? nodePath : cliPath);
      const status = await installer.status();
      assert.equal(status.installed, false);
      assert.equal(status.managed, true);
      assert.equal(status.healthy, false);
      assert.equal(status.requiresAttention, true);
      assert.equal(status.code, "MCP_COMMAND_UNAVAILABLE");
    });
  }
});

test("global target follows OpenCode precedence and prefers an existing JSONC file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-installer-path-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configDirectory = join(directory, ".config", "opencode");
  await mkdir(configDirectory, { recursive: true });
  const jsonPath = join(configDirectory, "opencode.json");
  const jsoncPath = join(configDirectory, "opencode.jsonc");
  await writeFile(jsonPath, "{}\n");
  await writeFile(jsoncPath, "{}\n");
  const installer = new OpenCodeIntegrationInstaller({
    home: directory,
    env: {},
    receiptPath: join(directory, "receipt.json"),
    verify: async () => ({ verified: true }),
  });

  assert.equal((await installer.status()).configPath, jsoncPath);
});
