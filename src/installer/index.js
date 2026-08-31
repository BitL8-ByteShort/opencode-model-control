import { createHash, randomUUID } from "node:crypto";
import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import { constants as fileConstants } from "node:fs";
import {
  access,
  chmod,
  link,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { buildOpenCodeConfig } from "../opencode/index.js";
import {
  applyJsoncOperations,
  JsoncDocumentError,
  parseJsoncDocument,
  valueAtPath,
} from "./jsonc-document.js";

const MAX_CONFIG_BYTES = 2 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 512 * 1024;
const MAX_MCP_OUTPUT_BYTES = 1024 * 1024;
const MCP_HANDSHAKE_TIMEOUT_MS = 10_000;
const MCP_PROTOCOL_VERSION = "2025-11-25";
const RECEIPT_SCHEMA_VERSION = 1;
const MANAGED_SURFACE_VERSION = 1;
const OWNED_ROOTS = ["mcp", "tools", "agent"];
const OWNED_PATHS = [
  ["mcp", "model-control"],
  ["tools", "model-control_*"],
  ["agent", "omc-router"],
  ["agent", "omc-code-worker"],
  ["agent", "omc-vision-worker"],
  ["agent", "omc-reviewer"],
  ["plugin"],
  ["default_agent"],
];
const OWNED_PATH_KEYS = new Set(OWNED_PATHS.map(pathKey));
const DEFAULT_CLI_PATH = fileURLToPath(
  new URL("../../bin/opencode-model-control.js", import.meta.url),
);
const DEFAULT_PLUGIN_PATH = fileURLToPath(
  new URL("../opencode/plugin.js", import.meta.url),
);
const CONFIG_LAUNCH_TIMEOUT_MS = 10_000;

export class OpenCodeIntegrationError extends Error {
  constructor(message, { code, statusCode = 409, cause } = {}) {
    super(message, { cause });
    this.name = "OpenCodeIntegrationError";
    this.code = code ?? "OPENCODE_INTEGRATION_ERROR";
    this.statusCode = statusCode;
  }
}

export function resolvedConfigCommand(
  action,
  configPath,
  { platform = process.platform, env = process.env } = {},
) {
  if (!new Set(["open", "reveal"]).has(action)) {
    throw new OpenCodeIntegrationError("The requested config action is not supported.", {
      code: "OPENCODE_CONFIG_ACTION_INVALID",
      statusCode: 400,
    });
  }
  if (typeof configPath !== "string" || !isAbsolute(configPath)) {
    throw new OpenCodeIntegrationError("The resolved OpenCode config path is not absolute.", {
      code: "OPENCODE_CONFIG_PATH_INVALID",
      statusCode: 422,
    });
  }

  if (platform === "darwin") {
    return action === "open"
      ? { command: "open", args: [configPath] }
      : { command: "open", args: ["-R", configPath] };
  }
  if (platform === "win32") {
    return action === "open"
      ? { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", configPath] }
      : { command: "explorer.exe", args: [`/select,${configPath}`] };
  }
  if (env.WSL_DISTRO_NAME) {
    return action === "open"
      ? { command: "wslview", args: [configPath] }
      : { command: "wslview", args: [dirname(configPath)] };
  }
  return action === "open"
    ? { command: "xdg-open", args: [configPath] }
    : { command: "xdg-open", args: [dirname(configPath)] };
}

export function launchResolvedOpenCodeConfig({
  action,
  configPath,
  platform = process.platform,
  env = process.env,
  execFile = nodeExecFile,
} = {}) {
  const { command, args } = resolvedConfigCommand(action, configPath, { platform, env });
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        env,
        maxBuffer: 64 * 1024,
        shell: false,
        timeout: CONFIG_LAUNCH_TIMEOUT_MS,
        windowsHide: true,
      },
      (error) => {
        if (error) reject(error);
        else resolve({ action, configPath, opened: true });
      },
    );
  });
}

export function resolveIntegrationReceiptPath(env = process.env) {
  const base =
    env.OMC_CONFIG_DIR ||
    join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode-model-control");
  return join(base, "opencode-integration.json");
}

export function buildManagedOpenCodeFragment({
  catalog,
  settings,
  nodePath = process.execPath,
  cliPath = DEFAULT_CLI_PATH,
  pluginUrl = pathToFileURL(DEFAULT_PLUGIN_PATH).href,
  includeDefaultAgent = false,
} = {}) {
  if (!isAbsolute(nodePath) || !isAbsolute(cliPath)) {
    throw new OpenCodeIntegrationError(
      "The MCP command must use absolute executable paths.",
      { code: "MCP_COMMAND_NOT_ABSOLUTE", statusCode: 500 },
    );
  }

  const generated = structuredClone(buildOpenCodeConfig({ catalog, settings }));
  generated.mcp["model-control"].command = [nodePath, cliPath, "mcp"];
  const fragment = Object.fromEntries(
    OWNED_ROOTS.filter((key) => generated[key] !== undefined).map((key) => [
      key,
      generated[key],
    ]),
  );
  assertCanonicalFileUrl(pluginUrl);
  fragment.plugin = [pluginUrl];
  if (includeDefaultAgent) fragment.default_agent = "omc-router";
  return fragment;
}

function assertCanonicalFileUrl(value) {
  if (typeof value !== "string") {
    throw new OpenCodeIntegrationError("The managed plugin URL is invalid.", {
      code: "PLUGIN_URL_INVALID",
      statusCode: 422,
    });
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "file:" || pathToFileURL(fileURLToPath(url)).href !== url.href) {
      throw new Error("not a canonical file URL");
    }
  } catch (error) {
    throw new OpenCodeIntegrationError("The managed plugin URL is invalid.", {
      code: "PLUGIN_URL_INVALID",
      statusCode: 422,
      cause: error,
    });
  }
}

async function canonicalizeMcpCommand(command) {
  if (
    !Array.isArray(command) ||
    command.length !== 3 ||
    command.some((part) => typeof part !== "string") ||
    command[2] !== "mcp" ||
    !isAbsolute(command[0]) ||
    !isAbsolute(command[1])
  ) {
    throw new OpenCodeIntegrationError(
      "The managed MCP command has an invalid shape.",
      { code: "MCP_COMMAND_INVALID", statusCode: 422 },
    );
  }

  const nodePath = await canonicalCommandTarget(command[0], {
    label: "The Node.js executable",
    accessMode: fileConstants.X_OK,
  });
  const cliPath = await canonicalCommandTarget(command[1], {
    label: "The Model Control CLI",
    accessMode: fileConstants.R_OK,
  });
  return [nodePath, cliPath, "mcp"];
}

async function validateMcpCommandTargets(command) {
  await canonicalizeMcpCommand(command);
}

async function canonicalizePluginUrl(pluginPath) {
  if (typeof pluginPath !== "string" || !isAbsolute(pluginPath)) {
    throw new OpenCodeIntegrationError(
      "The managed routing plugin path must be absolute.",
      { code: "PLUGIN_PATH_INVALID", statusCode: 422 },
    );
  }
  try {
    const canonicalPath = await canonicalCommandTarget(pluginPath, {
      label: "The Model Control routing plugin",
      accessMode: fileConstants.R_OK,
    });
    return pathToFileURL(canonicalPath).href;
  } catch (error) {
    throw new OpenCodeIntegrationError(
      "The Model Control routing plugin is missing or inaccessible.",
      { code: "PLUGIN_RUNTIME_UNAVAILABLE", statusCode: 422, cause: error },
    );
  }
}

async function validatePluginUrlTarget(pluginUrl) {
  assertCanonicalFileUrl(pluginUrl);
  let pluginPath;
  try {
    pluginPath = fileURLToPath(pluginUrl);
  } catch (error) {
    throw new OpenCodeIntegrationError("The managed plugin URL is invalid.", {
      code: "PLUGIN_URL_INVALID",
      statusCode: 422,
      cause: error,
    });
  }
  const canonicalUrl = await canonicalizePluginUrl(pluginPath);
  if (canonicalUrl !== pluginUrl) {
    throw new OpenCodeIntegrationError(
      "The managed routing plugin URL is no longer canonical.",
      { code: "PLUGIN_PATH_CHANGED", statusCode: 422 },
    );
  }
}

async function canonicalCommandTarget(path, { label, accessMode }) {
  try {
    const canonicalPath = await realpath(path);
    const metadata = await stat(canonicalPath);
    if (!metadata.isFile()) {
      throw new OpenCodeIntegrationError(
        `${label} is not a regular file.`,
        { code: "MCP_COMMAND_UNAVAILABLE", statusCode: 422 },
      );
    }
    await access(canonicalPath, accessMode);
    return canonicalPath;
  } catch (error) {
    if (error instanceof OpenCodeIntegrationError) throw error;
    throw new OpenCodeIntegrationError(
      `${label} is missing or inaccessible.`,
      { code: "MCP_COMMAND_UNAVAILABLE", statusCode: 422, cause: error },
    );
  }
}

function commandFromEntries(entries) {
  const entry = entries.find(({ path }) => pathKey(path) === pathKey(["mcp", "model-control"]));
  return entry?.value?.command;
}

function pluginUrlFromEntries(entries) {
  return entries.find(
    (entry) =>
      entry.kind === "array-item" && pathKey(entry.path) === pathKey(["plugin"]),
  )?.value;
}

function receiptRequiresUpdate(receipt, { command, pluginUrl }) {
  return receipt.managedSurfaceVersion !== MANAGED_SURFACE_VERSION ||
    !isDeepStrictEqual(commandFromEntries(receipt.entries), command) ||
    pluginUrlFromEntries(receipt.entries) !== pluginUrl;
}

export class OpenCodeIntegrationInstaller {
  constructor({
    configPath,
    receiptPath = resolveIntegrationReceiptPath(),
    env = process.env,
    home = homedir(),
    nodePath = process.execPath,
    cliPath = DEFAULT_CLI_PATH,
    pluginPath = DEFAULT_PLUGIN_PATH,
    now = () => new Date(),
    id = randomUUID,
    verify = verifyOpenCodeConfig,
    verifyCommand = verifyMcpCommand,
    beforeConfigWrite = async () => {},
    configLauncher = launchResolvedOpenCodeConfig,
    platform = process.platform,
  } = {}) {
    this.explicitConfigPath = configPath;
    this.receiptPath = receiptPath;
    this.env = env;
    this.home = home;
    this.nodePath = nodePath;
    this.cliPath = cliPath;
    this.pluginPath = pluginPath;
    this.now = now;
    this.id = id;
    this.verify = verify;
    this.verifyCommand = verifyCommand;
    this.beforeConfigWrite = beforeConfigWrite;
    this.configLauncher = configLauncher;
    this.platform = platform;
  }

  async status() {
    const configPath = await this.#resolveConfigPath();
    const receipt = await this.#readReceipt();
    const base = publicStatus({ configPath, receiptPath: this.receiptPath });

    if (receipt && receipt.configPath !== configPath) {
      return {
        ...base,
        managed: true,
        healthy: false,
        requiresAttention: true,
        code: "RECEIPT_PATH_MISMATCH",
        message: "The saved integration receipt points to a different OpenCode config file.",
      };
    }

    let config;
    try {
      config = await this.#readConfig(configPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return receipt
          ? {
              ...base,
              managed: true,
              healthy: false,
              requiresAttention: true,
              code: "MANAGED_CONFIG_MISSING",
              message: "The managed OpenCode config file is missing.",
            }
          : base;
      }
      return {
        ...base,
        managed: Boolean(receipt),
        healthy: false,
        requiresAttention: true,
        code: error?.code ?? "OPENCODE_CONFIG_UNREADABLE",
        message: safeErrorMessage(error),
      };
    }

    if (!receipt) {
      const pluginUrl = await canonicalizePluginUrl(this.pluginPath);
      const collision = firstOwnedCollision(config.value, [
        { kind: "array-item", path: ["plugin"], value: pluginUrl },
      ]);
      return collision
        ? {
            ...base,
            configExists: true,
            healthy: false,
            requiresAttention: true,
            code: "OWNERSHIP_UNVERIFIED",
            message: `OpenCode already contains ${formatPath(collision)} without an installer receipt.`,
          }
        : { ...base, configExists: true, ...defaultAgentMetadata(config.value, null) };
    }

    const unexpected = firstUnexpectedOwnedEntry(config.value, receipt.entries);
    if (unexpected) {
      return {
        ...base,
        configExists: true,
        managed: true,
        healthy: false,
        requiresAttention: true,
        code: "OWNERSHIP_CONFLICT",
        message: `OpenCode contains unmanaged product entry ${formatPath(unexpected)}.`,
      };
    }
    const mismatch = firstReceiptMismatch(config.value, receipt.entries);
    if (mismatch) {
      return {
        ...base,
        configExists: true,
        managed: true,
        healthy: false,
        requiresAttention: true,
        code: "MANAGED_CONFIG_CHANGED",
        message: `The managed entry ${formatPath(mismatch)} changed outside Model Control.`,
      };
    }

    let currentCommand;
    let currentPluginUrl;
    try {
      currentCommand = await canonicalizeMcpCommand([
        this.nodePath,
        this.cliPath,
        "mcp",
      ]);
      currentPluginUrl = await canonicalizePluginUrl(this.pluginPath);
    } catch (error) {
      const pluginFailure = error?.code?.startsWith("PLUGIN_");
      return {
        ...base,
        configExists: true,
        managed: true,
        healthy: false,
        requiresAttention: true,
        code: pluginFailure ? "PLUGIN_RUNTIME_UNAVAILABLE" : "MCP_COMMAND_UNAVAILABLE",
        message: pluginFailure
          ? safePluginErrorMessage(error)
          : safeCommandErrorMessage(error),
      };
    }

    if (receiptRequiresUpdate(receipt, { command: currentCommand, pluginUrl: currentPluginUrl })) {
      return {
        ...base,
        configExists: true,
        installed: true,
        managed: true,
        healthy: false,
        requiresAttention: true,
        code: "UPDATE_REQUIRED",
        message: "OpenCode Model Control is connected through an older managed installation. Update the connection to use this installed version.",
        ...defaultAgentMetadata(config.value, receipt),
      };
    }

    try {
      await validateMcpCommandTargets(commandFromEntries(receipt.entries));
      await validatePluginUrlTarget(pluginUrlFromEntries(receipt.entries));
    } catch (error) {
      const pluginFailure = error?.code?.startsWith("PLUGIN_");
      return {
        ...base,
        configExists: true,
        managed: true,
        healthy: false,
        requiresAttention: true,
        code: pluginFailure ? "PLUGIN_RUNTIME_UNAVAILABLE" : "MCP_COMMAND_UNAVAILABLE",
        message: pluginFailure
          ? safePluginErrorMessage(error)
          : safeCommandErrorMessage(error),
      };
    }

    return {
      ...base,
      configExists: true,
      installed: true,
      managed: true,
      healthy: true,
      requiresAttention: false,
      code: "INSTALLED",
      ...defaultAgentStatus(config.value, receipt),
    };
  }

  async install({ catalog, settings, makeDefaultAgent } = {}) {
    const configPath = await this.#resolveConfigPath();
    const receipt = await this.#readReceipt();
    if (receipt && receipt.configPath !== configPath) {
      throw integrationError(
        "RECEIPT_PATH_MISMATCH",
        "The saved integration receipt points to a different OpenCode config file.",
      );
    }

    const command = await canonicalizeMcpCommand([
      this.nodePath,
      this.cliPath,
      "mcp",
    ]);

    const pluginUrl = await canonicalizePluginUrl(this.pluginPath);
    const original = await this.#readConfigOrDefault(configPath);
    const previousEntries = receipt?.entries ?? [];
    const ownsDefaultAgent = previousEntries.some(
      ({ path }) => pathKey(path) === pathKey(["default_agent"]),
    );
    const requestedDefault = resolveMakeDefaultAgent({
      makeDefaultAgent,
      settings,
      ownsDefaultAgent,
      config: original.value,
    });

    const fragment = buildManagedOpenCodeFragment({
      catalog,
      settings,
      nodePath: command[0],
      cliPath: command[1],
      pluginUrl,
      includeDefaultAgent: requestedDefault,
    });
    const desiredEntries = entriesFromFragment(fragment);

    if (receipt) {
      const mismatch = firstReceiptMismatch(original.value, receipt.entries);
      if (mismatch) {
        throw integrationError(
          "MANAGED_CONFIG_CHANGED",
          `The managed entry ${formatPath(mismatch)} changed outside Model Control.`,
        );
      }
      const unexpected = firstUnexpectedOwnedEntry(original.value, receipt.entries);
      if (unexpected) {
        throw integrationError(
          "OWNERSHIP_CONFLICT",
          `Refusing to replace unmanaged product entry ${formatPath(unexpected)}.`,
        );
      }
      const newCollision = firstNewDesiredCollision(
        original.value,
        receipt.entries,
        desiredEntries,
      );
      if (newCollision) {
        throw integrationError(
          "OWNERSHIP_CONFLICT",
          `Refusing to claim existing ${formatPath(newCollision)} without receipt ownership.`,
        );
      }
    } else {
      const collision = firstOwnedCollision(original.value, desiredEntries);
      if (collision) {
        throw integrationError(
          "OWNERSHIP_UNVERIFIED",
          `Refusing to replace existing ${formatPath(collision)} without an installer receipt.`,
        );
      }
    }

    const operations = planInstallOperations(
      original.value,
      previousEntries,
      desiredEntries,
    );
    const unchanged = operations.length === 0 &&
      receipt !== null &&
      !receiptRequiresUpdate(receipt, { command, pluginUrl });
    if (unchanged) {
      return { ...(await this.status()), changed: false, backupCreated: false };
    }

    const createdContainers = receipt?.createdContainers ?? OWNED_ROOTS.filter(
      (root) => !Object.hasOwn(original.value, root),
    );
    const createdCollections = receipt?.createdCollections ?? (
      Object.hasOwn(original.value, "plugin") ? [] : ["plugin"]
    );
    const nextSource = applyJsoncOperations(original.source, operations);
    try {
      await this.verify({
        source: nextSource,
        entries: desiredEntries,
        targetPath: configPath,
        env: this.env,
      });
    } catch (error) {
      if (error instanceof OpenCodeIntegrationError) throw error;
      throw new OpenCodeIntegrationError(
        "OpenCode could not verify the proposed integration. No OpenCode config change was made.",
        { code: "OPENCODE_VERIFY_FAILED", statusCode: 503 },
      );
    }
    try {
      await this.verifyCommand({ command, env: this.env });
    } catch (error) {
      if (error instanceof OpenCodeIntegrationError) throw error;
      throw new OpenCodeIntegrationError(
        "The configured Model Control MCP command did not complete a valid handshake. No OpenCode config change was made.",
        { code: "MCP_HANDSHAKE_FAILED", statusCode: 503 },
      );
    }
    const backupPath = await withConfigLock(configPath, async () => {
      await this.beforeConfigWrite({ operation: "install", configPath });
      await assertConfigSnapshotUnchanged(configPath, original);
      const path = original.exists
        ? await this.#writeBackup(configPath, original.source)
        : null;
      const nextReceipt = {
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        managedSurfaceVersion: MANAGED_SURFACE_VERSION,
        product: "opencode-model-control",
        configPath,
        installedAt: receipt?.installedAt ?? this.now().toISOString(),
        updatedAt: this.now().toISOString(),
        createdConfig: receipt?.createdConfig ?? !original.exists,
        createdContainers,
        createdCollections,
        backupPath: path,
        entries: desiredEntries,
        configDigest: digest(nextSource),
        verifiedAt: this.now().toISOString(),
        verification: "opencode-debug-config-and-mcp-handshake",
      };

      await this.#commitTransaction({
        configPath,
        original,
        nextSource,
        receipt: nextReceipt,
      });
      return path;
    });
    return { ...(await this.status()), changed: true, backupCreated: Boolean(backupPath) };
  }

  async uninstall() {
    const configPath = await this.#resolveConfigPath();
    const receipt = await this.#readReceipt();
    if (!receipt) {
      throw new OpenCodeIntegrationError(
        "OpenCode Model Control is not installed by this installer.",
        { code: "NOT_INSTALLED", statusCode: 404 },
      );
    }
    if (receipt.configPath !== configPath) {
      throw integrationError(
        "RECEIPT_PATH_MISMATCH",
        "The saved integration receipt points to a different OpenCode config file.",
      );
    }

    const original = await this.#readConfig(configPath);
    const mismatch = firstReceiptMismatch(original.value, receipt.entries);
    if (mismatch) {
      throw integrationError(
        "MANAGED_CONFIG_CHANGED",
        `Refusing to remove changed entry ${formatPath(mismatch)}.`,
      );
    }
    const unexpected = firstUnexpectedOwnedEntry(original.value, receipt.entries);
    if (unexpected) {
      throw integrationError(
        "OWNERSHIP_CONFLICT",
        `Refusing to remove integration while ${formatPath(unexpected)} is unmanaged.`,
      );
    }

    const operations = receipt.entries.map((entry) =>
      operationToRemoveEntry(original.value, entry, {
        removeEmptyCollection: receipt.createdCollections?.includes(entry.path[0]) === true,
      }),
    );
    const withoutEntries = applyJsoncOperations(original.source, operations);
    const parsedWithoutEntries = parseJsoncDocument(withoutEntries, { path: configPath });
    for (const root of receipt.createdContainers ?? []) {
      if (isPlainObject(parsedWithoutEntries.value[root]) && Object.keys(parsedWithoutEntries.value[root]).length === 0) {
        operations.push({ action: "remove", path: [root] });
      }
    }
    const nextSource = applyJsoncOperations(original.source, operations);
    const backupPath = await withConfigLock(configPath, async () => {
      await this.beforeConfigWrite({ operation: "uninstall", configPath });
      await assertConfigSnapshotUnchanged(configPath, original);
      const path = await this.#writeBackup(configPath, original.source);

      await this.#writeConfig(configPath, nextSource, original.mode, original);
      try {
        await unlink(this.receiptPath);
      } catch (error) {
        try {
          await this.#writeConfig(configPath, original.source, original.mode, {
            exists: true,
            mode: original.mode,
            source: nextSource,
          });
        } catch (rollbackError) {
          throw new OpenCodeIntegrationError(
            "Uninstall could not remove its receipt and rollback also failed. Restore the newest private backup before continuing.",
            { code: "UNINSTALL_ROLLBACK_FAILED", statusCode: 500, cause: rollbackError },
          );
        }
        throw new OpenCodeIntegrationError(
          "Uninstall could not remove its receipt, so the OpenCode config was restored.",
          { code: "RECEIPT_REMOVE_FAILED", statusCode: 500, cause: error },
        );
      }
      return path;
    });

    return {
      ...(await this.status()),
      changed: true,
      backupCreated: true,
      backupPath,
    };
  }

  async openConfig() {
    return this.#launchConfig("open");
  }

  async revealConfig() {
    return this.#launchConfig("reveal");
  }

  async #launchConfig(action) {
    const configPath = await this.#resolveConfigPath();
    if (!isAbsolute(configPath)) {
      throw new OpenCodeIntegrationError("The resolved OpenCode config path is not absolute.", {
        code: "OPENCODE_CONFIG_PATH_INVALID",
        statusCode: 422,
      });
    }
    try {
      await safeRegularFileStat(configPath, "OpenCode config");
      await access(configPath, fileConstants.R_OK);
    } catch (error) {
      if (error instanceof OpenCodeIntegrationError) throw error;
      if (error?.code === "ENOENT") {
        throw new OpenCodeIntegrationError(
          "The resolved OpenCode config file does not exist yet. Connect Model Control first or create the file in OpenCode.",
          { code: "OPENCODE_CONFIG_MISSING", statusCode: 404 },
        );
      }
      throw new OpenCodeIntegrationError(
        "The resolved OpenCode config file is not readable.",
        { code: "OPENCODE_CONFIG_UNREADABLE", statusCode: 422, cause: error },
      );
    }

    try {
      await this.configLauncher({
        action,
        configPath,
        env: this.env,
        platform: this.platform,
      });
    } catch (error) {
      if (error instanceof OpenCodeIntegrationError) throw error;
      throw new OpenCodeIntegrationError(
        action === "open"
          ? "The operating system could not open the resolved OpenCode config file."
          : "The operating system could not reveal the resolved OpenCode config file.",
        {
          code: action === "open"
            ? "OPENCODE_CONFIG_OPEN_FAILED"
            : "OPENCODE_CONFIG_REVEAL_FAILED",
          statusCode: 503,
          cause: error,
        },
      );
    }
    return { action, configPath, opened: true };
  }

  async #resolveConfigPath() {
    if (this.explicitConfigPath) return this.explicitConfigPath;
    if (this.env.OMC_OPENCODE_CONFIG_PATH) return this.env.OMC_OPENCODE_CONFIG_PATH;

    const directory = join(
      this.env.XDG_CONFIG_HOME || join(this.home, ".config"),
      "opencode",
    );
    const jsonPath = join(directory, "opencode.json");
    const jsoncPath = join(directory, "opencode.jsonc");
    const legacyPath = join(directory, "config.json");
    if (await pathExists(jsoncPath)) return jsoncPath;
    if (await pathExists(jsonPath)) return jsonPath;
    if (await pathExists(legacyPath)) return legacyPath;
    return jsoncPath;
  }

  async #readConfigOrDefault(path) {
    try {
      return await this.#readConfig(path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return {
        exists: false,
        mode: 0o600,
        source: "{}\n",
        value: {},
      };
    }
  }

  async #readConfig(path) {
    const metadata = await safeRegularFileStat(path, "OpenCode config");
    if (metadata.size > MAX_CONFIG_BYTES) {
      throw new OpenCodeIntegrationError("The OpenCode config is too large to edit safely.", {
        code: "OPENCODE_CONFIG_TOO_LARGE",
        statusCode: 413,
      });
    }
    const source = await readFile(path, "utf8");
    const { value } = parseJsoncDocument(source, { path });
    return {
      exists: true,
      mode: metadata.mode & 0o777,
      source,
      value,
    };
  }

  async #readReceipt() {
    let metadata;
    try {
      metadata = await safeRegularFileStat(this.receiptPath, "Integration receipt");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    if (metadata.size > MAX_RECEIPT_BYTES) {
      throw new OpenCodeIntegrationError("The integration receipt is too large.", {
        code: "RECEIPT_TOO_LARGE",
        statusCode: 413,
      });
    }
    let receipt;
    try {
      receipt = JSON.parse(await readFile(this.receiptPath, "utf8"));
    } catch (error) {
      throw new OpenCodeIntegrationError("The integration receipt is not valid JSON.", {
        code: "RECEIPT_INVALID",
        statusCode: 422,
        cause: error,
      });
    }
    validateReceipt(receipt);
    return receipt;
  }

  async #commitTransaction({ configPath, original, nextSource, receipt }) {
    await this.#writeConfig(configPath, nextSource, original.mode, original);
    try {
      await atomicWrite(this.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 0o600);
    } catch (error) {
      try {
        const currentSource = await readFile(configPath, "utf8");
        if (digest(currentSource) !== digest(nextSource)) {
          throw new Error("The OpenCode config changed during receipt creation.");
        }
        if (original.exists) {
          await this.#writeConfig(configPath, original.source, original.mode, {
            exists: true,
            mode: original.mode,
            source: nextSource,
          });
        }
        else await unlink(configPath);
      } catch (rollbackError) {
        throw new OpenCodeIntegrationError(
          "Installation receipt failed and the config rollback also failed. Restore the newest private backup before continuing.",
          { code: "INSTALL_ROLLBACK_FAILED", statusCode: 500, cause: rollbackError },
        );
      }
      throw new OpenCodeIntegrationError(
        "Installation receipt could not be saved, so the OpenCode config was restored.",
        { code: "RECEIPT_WRITE_FAILED", statusCode: 500, cause: error },
      );
    }
  }

  async #writeBackup(configPath, source) {
    const stamp = this.now().toISOString().replaceAll(/[:.]/g, "-");
    const backupPath = join(
      dirname(configPath),
      `.${basename(configPath)}.omc-backup-${stamp}-${this.id()}.bak`,
    );
    await atomicCreate(backupPath, source, 0o600);
    return backupPath;
  }

  async #writeConfig(path, source, mode, expected) {
    await atomicWrite(path, source, mode ?? 0o600, { expected });
  }
}

function resolveMakeDefaultAgent({
  makeDefaultAgent,
  settings,
  ownsDefaultAgent,
  config,
}) {
  const configured = makeDefaultAgent ?? settings?.makeRouterDefault;
  if (configured !== undefined && typeof configured !== "boolean") {
    throw new OpenCodeIntegrationError(
      "makeDefaultAgent must be true or false.",
      { code: "DEFAULT_AGENT_OPTION_INVALID", statusCode: 400 },
    );
  }
  const enabled = configured ?? true;
  if (!enabled) return false;
  if (ownsDefaultAgent) return true;
  return !Object.hasOwn(config, "default_agent");
}

function defaultAgentStatus(config, receipt) {
  const metadata = defaultAgentMetadata(config, receipt);
  return {
    ...metadata,
    message: metadata.defaultAgentManaged
      ? "OpenCode Model Control is connected and Omc-Router is the default agent."
      : metadata.defaultAgentPreserved
        ? "OpenCode Model Control is connected. Your existing default agent was preserved."
        : "OpenCode Model Control is connected.",
  };
}

function defaultAgentMetadata(config, receipt) {
  const defaultAgent = typeof config.default_agent === "string"
    ? config.default_agent
    : null;
  const defaultAgentManaged = Boolean(receipt?.entries?.some(
    ({ path }) => pathKey(path) === pathKey(["default_agent"]),
  ));
  const defaultAgentPreserved = defaultAgent !== null && !defaultAgentManaged;
  return {
    defaultAgent,
    defaultAgentManaged,
    defaultAgentPreserved,
  };
}

export async function verifyOpenCodeConfig({
  source,
  entries,
  targetPath,
  env = process.env,
  execFile = nodeExecFile,
} = {}) {
  const verificationRoot = await mkdtemp(join(tmpdir(), "omc-opencode-verify-"));
  const temporaryPath = join(verificationRoot, basename(targetPath));
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    const output = await executeOpenCodeConfigCheck({
      configPath: temporaryPath,
      cwd: verificationRoot,
      verificationRoot,
      env,
      execFile,
    });
    let resolved;
    try {
      resolved = JSON.parse(output);
    } catch {
      throw new OpenCodeIntegrationError(
        "OpenCode did not return a valid resolved configuration during verification.",
        { code: "OPENCODE_VERIFY_INVALID", statusCode: 422 },
      );
    }
    for (const entry of entries) {
      const current = valueAtPath(resolved, entry.path);
      const accepted = entry.kind === "array-item"
        ? current.exists &&
          Array.isArray(current.value) &&
          current.value.filter((value) => isDeepStrictEqual(value, entry.value)).length === 1
        : current.exists && containsManagedValue(current.value, entry.value);
      if (!accepted) {
        throw new OpenCodeIntegrationError(
          `OpenCode did not accept ${formatPath(entry.path)} during verification.`,
          { code: "OPENCODE_VERIFY_MISMATCH", statusCode: 422 },
        );
      }
    }
    return { verified: true };
  } catch (error) {
    if (error instanceof OpenCodeIntegrationError) throw error;
    throw new OpenCodeIntegrationError(
      "OpenCode could not verify the proposed integration. No OpenCode config change was made.",
      { code: "OPENCODE_VERIFY_FAILED", statusCode: 503 },
    );
  } finally {
    try {
      await handle?.close();
      await rm(verificationRoot, { recursive: true, force: true });
    } catch {
      // Best-effort removal of a private verification file.
    }
  }
}

export async function verifyMcpCommand({
  command,
  env = process.env,
  spawn = nodeSpawn,
} = {}) {
  const canonicalCommand = await canonicalizeMcpCommand(command);
  const verificationRoot = await mkdtemp(join(tmpdir(), "omc-mcp-verify-"));
  let child;
  try {
    child = spawn(canonicalCommand[0], canonicalCommand.slice(1), {
      cwd: verificationRoot,
      env: isolatedMcpEnvironment(env, verificationRoot),
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    await completeMcpHandshake(child);
    return { verified: true };
  } catch (error) {
    if (error instanceof OpenCodeIntegrationError) throw error;
    throw new OpenCodeIntegrationError(
      "The configured Model Control MCP command did not complete a valid handshake.",
      { code: "MCP_HANDSHAKE_FAILED", statusCode: 503, cause: error },
    );
  } finally {
    await stopChild(child);
    try {
      await rm(verificationRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of isolated handshake state.
    }
  }
}

function isolatedMcpEnvironment(env, root) {
  const childEnv = {};
  for (const key of [
    "COMSPEC",
    "LANG",
    "LC_ALL",
    "PATHEXT",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
  ]) {
    if (typeof env?.[key] === "string") childEnv[key] = env[key];
  }
  return {
    ...childEnv,
    APPDATA: join(root, "app-data"),
    HOME: root,
    LOCALAPPDATA: join(root, "local-app-data"),
    NO_COLOR: "1",
    OMC_CONFIG_DIR: join(root, "model-control"),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    PATH: "",
    TEMP: root,
    TMP: root,
    TMPDIR: root,
    USERPROFILE: root,
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
  };
}

function completeMcpHandshake(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let initialized = false;
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const fail = (cause) => finish(
      reject,
      new OpenCodeIntegrationError(
        "The configured Model Control MCP command did not complete a valid handshake.",
        { code: "MCP_HANDSHAKE_FAILED", statusCode: 503, cause },
      ),
    );
    const send = (message) => {
      if (!child.stdin?.writable) {
        fail(new Error("The MCP process input stream is unavailable."));
        return;
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const processMessage = (message) => {
      if (message?.id === 1) {
        if (
          initialized ||
          message.error ||
          message?.result?.protocolVersion !== MCP_PROTOCOL_VERSION ||
          message?.result?.serverInfo?.name !== "opencode-model-control"
        ) {
          fail(new Error("The MCP initialize response was invalid."));
          return;
        }
        initialized = true;
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        return;
      }
      if (message?.id === 2) {
        const names = Array.isArray(message?.result?.tools)
          ? message.result.tools.map(({ name }) => name).sort()
          : [];
        if (
          message.error ||
          !isDeepStrictEqual(names, ["get_model_status", "route_task"])
        ) {
          fail(new Error("The MCP tool list response was invalid."));
          return;
        }
        finish(resolve, undefined);
      }
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_MCP_OUTPUT_BYTES) {
        fail(new Error("The MCP handshake response was too large."));
        return;
      }
      while (!settled) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).replace(/\r$/u, "");
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          processMessage(JSON.parse(line));
        } catch (error) {
          fail(error);
        }
      }
    };
    const timeout = setTimeout(
      () => fail(new Error("The MCP handshake timed out.")),
      MCP_HANDSHAKE_TIMEOUT_MS,
    );

    child.once("error", fail);
    child.once("exit", (code, signal) => {
      if (!settled) fail(new Error(`The MCP process exited before handshake (${code ?? signal}).`));
    });
    child.stdin?.once("error", fail);
    child.stdout?.on("data", onData);
    child.once("spawn", () => {
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "opencode-model-control-installer", version: "1.0.0" },
        },
      });
    });
  });
}

async function stopChild(child) {
  if (!child) return;
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  });
  try {
    child.stdin?.end();
  } catch {
    // The process may already have closed its input stream.
  }
  await Promise.race([exited, delay(250)]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Continue to the bounded hard-stop below.
    }
    await Promise.race([exited, delay(500)]);
  }
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Best effort; there is no config mutation tied to probe cleanup.
    }
    await Promise.race([exited, delay(500)]);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function containsManagedValue(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => containsManagedValue(actual[index], value));
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return false;
    return Object.entries(expected).every(([key, value]) =>
      Object.hasOwn(actual, key) && containsManagedValue(actual[key], value),
    );
  }
  return isDeepStrictEqual(actual, expected);
}

function executeOpenCodeConfigCheck({ configPath, cwd, verificationRoot, env, execFile }) {
  return new Promise((resolve, reject) => {
    const childEnv = {
      ...env,
      NO_COLOR: "1",
      OPENCODE_CONFIG: configPath,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_TEST_HOME: verificationRoot,
      XDG_CACHE_HOME: join(verificationRoot, "cache"),
      XDG_CONFIG_HOME: join(verificationRoot, "config"),
      XDG_DATA_HOME: join(verificationRoot, "data"),
      XDG_STATE_HOME: join(verificationRoot, "state"),
    };
    delete childEnv.OPENCODE_CONFIG_CONTENT;
    execFile(
      "opencode",
      ["debug", "config", "--pure"],
      {
        cwd,
        encoding: "utf8",
        env: childEnv,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 15_000,
        windowsHide: true,
      },
      (error, stdout = "") => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

function planInstallOperations(config, previousEntries, desiredEntries) {
  const operations = [];
  const working = structuredClone(config);
  const queue = (operation) => {
    operations.push(operation);
    applyOperationToObject(working, operation);
  };
  const desiredByPath = new Map(desiredEntries.map((entry) => [pathKey(entry.path), entry]));
  for (const previous of previousEntries) {
    const desired = desiredByPath.get(pathKey(previous.path));
    const arrayItemChanged =
      previous.kind === "array-item" &&
      desired?.kind === "array-item" &&
      !isDeepStrictEqual(previous.value, desired.value);
    if (!desired || arrayItemChanged) {
      queue(operationToRemoveEntry(working, previous));
    }
  }
  for (const entry of desiredEntries) {
    if (entry.kind === "array-item") {
      const current = valueAtPath(working, entry.path);
      if (!current.exists) {
        queue({ action: "set", path: entry.path, value: [entry.value] });
        continue;
      }
      assertManagedArrayShape(current.value, entry.path);
      const matches = current.value.filter((value) => isDeepStrictEqual(value, entry.value));
      if (matches.length > 1) {
        throw integrationError(
          "OWNERSHIP_CONFLICT",
          `The managed plugin entry is duplicated at ${formatPath(entry.path)}.`,
        );
      }
      if (matches.length === 0) {
        queue({
          action: "set",
          path: entry.path,
          value: [...current.value, entry.value],
        });
      }
      continue;
    }

    const current = valueAtPath(working, entry.path);
    if (!current.exists || !isDeepStrictEqual(current.value, entry.value)) {
      queue({ action: "set", path: entry.path, value: entry.value });
    }
  }
  return operations;
}

function applyOperationToObject(root, operation) {
  let parent = root;
  for (const segment of operation.path.slice(0, -1)) {
    if (!isPlainObject(parent[segment])) parent[segment] = {};
    parent = parent[segment];
  }
  const key = operation.path.at(-1);
  if (operation.action === "remove") delete parent[key];
  else parent[key] = structuredClone(operation.value);
}

function entriesFromFragment(fragment) {
  const entries = [];
  for (const root of OWNED_ROOTS) {
    for (const [key, value] of Object.entries(fragment[root] ?? {})) {
      entries.push({ path: [root, key], value });
    }
  }
  if (fragment.plugin !== undefined) {
    if (!Array.isArray(fragment.plugin) || fragment.plugin.length !== 1) {
      throw new OpenCodeIntegrationError(
        "The managed plugin fragment must contain exactly one entry.",
        { code: "PLUGIN_FRAGMENT_INVALID", statusCode: 500 },
      );
    }
    entries.push({ kind: "array-item", path: ["plugin"], value: fragment.plugin[0] });
  }
  if (fragment.default_agent !== undefined) {
    entries.push({ path: ["default_agent"], value: fragment.default_agent });
  }
  return entries;
}

function firstOwnedCollision(config, desiredEntries = []) {
  for (const root of OWNED_ROOTS) {
    if (Object.hasOwn(config, root) && !isPlainObject(config[root])) return [root];
  }
  for (const [root, keys] of [
    ["mcp", ["model-control"]],
    ["tools", ["model-control_*"]],
    ["agent", ["omc-router", "omc-code-worker", "omc-vision-worker", "omc-reviewer"]],
  ]) {
    for (const key of keys) {
      const path = [root, key];
      if (valueAtPath(config, path).exists) return path;
    }
  }
  const managedPlugin = desiredEntries.find(
    (entry) => entry.kind === "array-item" && pathKey(entry.path) === pathKey(["plugin"]),
  );
  if (Object.hasOwn(config, "plugin")) {
    if (!Array.isArray(config.plugin)) return ["plugin"];
    if (!isValidManagedArrayShape(config.plugin)) return ["plugin"];
    if (
      managedPlugin &&
      config.plugin.some((value) => isDeepStrictEqual(value, managedPlugin.value))
    ) {
      return ["plugin"];
    }
  }
  return null;
}

function firstReceiptMismatch(config, entries) {
  for (const entry of entries) {
    if (!managedEntryMatches(config, entry)) return entry.path;
  }
  return null;
}

function firstUnexpectedOwnedEntry(config, entries) {
  const managed = new Set(entries.map((entry) => pathKey(entry.path)));
  for (const path of OWNED_PATHS.filter((path) => path.length === 2)) {
    if (!managed.has(pathKey(path)) && valueAtPath(config, path).exists) return path;
  }
  return null;
}

function firstNewDesiredCollision(config, previousEntries, desiredEntries) {
  const previous = new Set(previousEntries.map((entry) => pathKey(entry.path)));
  for (const entry of desiredEntries) {
    if (previous.has(pathKey(entry.path))) continue;
    const current = valueAtPath(config, entry.path);
    if (!current.exists) continue;
    if (entry.kind === "array-item") {
      if (!isValidManagedArrayShape(current.value)) return entry.path;
      if (current.value.some((value) => isDeepStrictEqual(value, entry.value))) {
        return entry.path;
      }
      continue;
    }
    return entry.path;
  }
  return null;
}

function managedEntryMatches(config, entry) {
  const current = valueAtPath(config, entry.path);
  if (!current.exists) return false;
  if (entry.kind === "array-item") {
    if (!isValidManagedArrayShape(current.value)) return false;
    return current.value.filter((value) => isDeepStrictEqual(value, entry.value)).length === 1;
  }
  return isDeepStrictEqual(current.value, entry.value);
}

function operationToRemoveEntry(config, entry, { removeEmptyCollection = false } = {}) {
  if (entry.kind !== "array-item") return { action: "remove", path: entry.path };
  const current = valueAtPath(config, entry.path);
  if (!current.exists || !Array.isArray(current.value)) {
    throw integrationError(
      "MANAGED_CONFIG_CHANGED",
      `The managed entry ${formatPath(entry.path)} changed outside Model Control.`,
    );
  }
  const matches = current.value.filter((value) => isDeepStrictEqual(value, entry.value));
  if (matches.length !== 1) {
    throw integrationError(
      "MANAGED_CONFIG_CHANGED",
      `The managed entry ${formatPath(entry.path)} changed outside Model Control.`,
    );
  }
  const next = current.value.filter((value) => !isDeepStrictEqual(value, entry.value));
  return next.length === 0 && removeEmptyCollection
    ? { action: "remove", path: entry.path }
    : { action: "set", path: entry.path, value: next };
}

function assertManagedArrayShape(value, path) {
  if (!isValidManagedArrayShape(value)) {
    throw integrationError(
      "OWNERSHIP_CONFLICT",
      `${formatPath(path)} must be an array of unique non-empty plugin identifiers.`,
    );
  }
}

function isValidManagedArrayShape(value) {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0) &&
    new Set(value).size === value.length;
}

function validateReceipt(receipt) {
  if (
    !isPlainObject(receipt) ||
    receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
    receipt.product !== "opencode-model-control" ||
    typeof receipt.configPath !== "string" ||
    !Array.isArray(receipt.entries)
  ) {
    throw new OpenCodeIntegrationError("The integration receipt has an unsupported shape.", {
      code: "RECEIPT_INVALID",
      statusCode: 422,
    });
  }
  if (!isAbsolute(receipt.configPath)) {
    throw new OpenCodeIntegrationError("The integration receipt config path is not absolute.", {
      code: "RECEIPT_INVALID",
      statusCode: 422,
    });
  }
  if (
    receipt.managedSurfaceVersion !== undefined &&
    (!Number.isSafeInteger(receipt.managedSurfaceVersion) || receipt.managedSurfaceVersion < 1)
  ) {
    throw new OpenCodeIntegrationError("The integration receipt has an invalid managed surface version.", {
      code: "RECEIPT_INVALID",
      statusCode: 422,
    });
  }
  const seenPaths = new Set();
  for (const entry of receipt.entries) {
    const kind = entry?.kind ?? "exact";
    if (
      !isPlainObject(entry) ||
      !Array.isArray(entry.path) ||
      ![1, 2].includes(entry.path.length) ||
      entry.path.some((segment) => typeof segment !== "string") ||
      !["exact", "array-item"].includes(kind) ||
      !("value" in entry)
    ) {
      throw new OpenCodeIntegrationError("The integration receipt contains an invalid managed entry.", {
        code: "RECEIPT_INVALID",
        statusCode: 422,
      });
    }
    const key = pathKey(entry.path);
    if (!OWNED_PATH_KEYS.has(key) || seenPaths.has(key)) {
      throw new OpenCodeIntegrationError("The integration receipt contains an unauthorized managed path.", {
        code: "RECEIPT_INVALID",
        statusCode: 422,
      });
    }
    const pluginEntry = key === pathKey(["plugin"]);
    const defaultEntry = key === pathKey(["default_agent"]);
    if (
      (pluginEntry && (
        kind !== "array-item" ||
        typeof entry.value !== "string"
      )) ||
      (defaultEntry && (kind !== "exact" || entry.value !== "omc-router")) ||
      (!pluginEntry && !defaultEntry && (
        kind !== "exact" ||
        entry.path.length !== 2 ||
        !OWNED_ROOTS.includes(entry.path[0])
      ))
    ) {
      throw new OpenCodeIntegrationError("The integration receipt contains an invalid managed entry.", {
        code: "RECEIPT_INVALID",
        statusCode: 422,
      });
    }
    if (pluginEntry) assertCanonicalFileUrl(entry.value);
    seenPaths.add(key);
    assertSafeJson(entry.value, `receipt ${formatPath(entry.path)}`);
  }
  if (
    receipt.createdContainers !== undefined &&
    (!Array.isArray(receipt.createdContainers) ||
      new Set(receipt.createdContainers).size !== receipt.createdContainers.length ||
      receipt.createdContainers.some((root) => !OWNED_ROOTS.includes(root)))
  ) {
    throw new OpenCodeIntegrationError("The integration receipt contains invalid created containers.", {
      code: "RECEIPT_INVALID",
      statusCode: 422,
    });
  }
  if (
    receipt.createdCollections !== undefined &&
    (!Array.isArray(receipt.createdCollections) ||
      new Set(receipt.createdCollections).size !== receipt.createdCollections.length ||
      receipt.createdCollections.some((root) => root !== "plugin"))
  ) {
    throw new OpenCodeIntegrationError("The integration receipt contains invalid created collections.", {
      code: "RECEIPT_INVALID",
      statusCode: 422,
    });
  }
}

async function safeRegularFileStat(path, label) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new OpenCodeIntegrationError(`${label} must be a regular file, not a link.`, {
      code: "UNSAFE_FILE_TYPE",
      statusCode: 422,
    });
  }
  return metadata;
}

async function withConfigLock(configPath, callback) {
  const directory = dirname(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, `.${basename(configPath)}.omc.lock`);
  let handle;
  try {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw integrationError(
          "OPENCODE_CONFIG_BUSY",
          "Another Model Control config transaction is already in progress.",
        );
      }
      throw error;
    }
    return await callback();
  } finally {
    try {
      await handle?.close();
    } finally {
      if (handle) await unlink(lockPath);
    }
  }
}

async function assertConfigSnapshotUnchanged(path, expected) {
  let metadata;
  try {
    metadata = await safeRegularFileStat(path, "OpenCode config");
  } catch (error) {
    if (error?.code === "ENOENT" && !expected.exists) return;
    throw configChangedError(error);
  }

  if (!expected.exists || metadata.size > MAX_CONFIG_BYTES) {
    throw configChangedError();
  }

  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw configChangedError(error);
  }
  if (source !== expected.source || (metadata.mode & 0o777) !== expected.mode) {
    throw configChangedError();
  }
}

function configChangedError(cause) {
  return new OpenCodeIntegrationError(
    "The OpenCode config changed while Model Control was preparing the update. No concurrent edit was overwritten; retry after the other edit is complete.",
    { code: "OPENCODE_CONFIG_CHANGED", statusCode: 409, cause },
  );
}

async function atomicWrite(path, source, mode, { expected } = {}) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporaryPath, mode);
    if (expected) await assertConfigSnapshotUnchanged(path, expected);
    await rename(temporaryPath, path);
  } catch (error) {
    try {
      await handle?.close();
      await unlink(temporaryPath);
    } catch {
      // Best-effort cleanup; preserve the original error.
    }
    throw error;
  }
}

async function atomicCreate(path, source, mode) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporaryPath, mode);
    await link(temporaryPath, path);
    await unlink(temporaryPath);
  } catch (error) {
    try {
      await handle?.close();
      await unlink(temporaryPath);
    } catch {
      // Best-effort cleanup; preserve the original error.
    }
    throw error;
  }
}

function publicStatus({ configPath, receiptPath }) {
  return {
    schemaVersion: 1,
    installed: false,
    managed: false,
    healthy: true,
    requiresAttention: false,
    configExists: false,
    configPath,
    receiptPath,
    code: "NOT_INSTALLED",
    message: "OpenCode Model Control is not connected yet.",
  };
}

function integrationError(code, message) {
  return new OpenCodeIntegrationError(message, { code, statusCode: 409 });
}

function pathKey(path) {
  return JSON.stringify(path);
}

function formatPath(path) {
  return path.join(".");
}

function digest(source) {
  return createHash("sha256").update(source).digest("hex");
}

function safeErrorMessage(error) {
  if (error instanceof JsoncDocumentError || error instanceof OpenCodeIntegrationError) {
    return error.message;
  }
  return "The OpenCode config could not be inspected safely.";
}

function safeCommandErrorMessage(error) {
  if (error instanceof OpenCodeIntegrationError) return error.message;
  return "The configured Model Control MCP command is missing or inaccessible.";
}

function safePluginErrorMessage(error) {
  if (error instanceof OpenCodeIntegrationError) return error.message;
  return "The configured Model Control routing plugin is missing or inaccessible.";
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeJson(value, path, seen = new Set(), depth = 0) {
  if (depth > 50) throw new OpenCodeIntegrationError(`${path} is nested too deeply.`, {
    code: "RECEIPT_INVALID",
    statusCode: 422,
  });
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return;
  if (typeof value !== "object" || seen.has(value)) {
    throw new OpenCodeIntegrationError(`${path} is not safe JSON.`, {
      code: "RECEIPT_INVALID",
      statusCode: 422,
    });
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertSafeJson(item, `${path}[${index}]`, seen, depth + 1);
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new OpenCodeIntegrationError(`${path} contains an unsafe key.`, {
          code: "RECEIPT_INVALID",
          statusCode: 422,
        });
      }
      assertSafeJson(item, `${path}.${key}`, seen, depth + 1);
    }
  } else {
    throw new OpenCodeIntegrationError(`${path} is not a plain JSON object.`, {
      code: "RECEIPT_INVALID",
      statusCode: 422,
    });
  }
  seen.delete(value);
}
