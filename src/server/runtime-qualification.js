import { execFile as nodeExecFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 60_000;
const PREFLIGHT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_AUTH_BYTES = 1024 * 1024;
const RUNTIME_AGENT = "omc-runtime-check";

const ISOLATION_FAILURES = Object.freeze({
  RUNTIME_CHECK_AUTH_ISOLATION_UNSUPPORTED:
    "This provider credential can load remote OpenCode configuration, so the isolated runtime check was not started.",
  RUNTIME_CHECK_AUTH_STORE_INVALID:
    "OpenCode's provider credential store could not be safely inspected, so the isolated runtime check was not started.",
  RUNTIME_CHECK_ISOLATION_FAILED:
    "OpenCode did not resolve to the required isolated configuration, so no provider request was started.",
});

function execute(file, args, options, execFile) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout = "", stderr = "") => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function failureFor(error) {
  if (typeof error?.code === "string" && ISOLATION_FAILURES[error.code]) {
    return { code: error.code, message: ISOLATION_FAILURES[error.code] };
  }
  if (error?.code === "ENOENT") {
    return {
      code: "OPENCODE_NOT_FOUND",
      message: "OpenCode was not found, so no provider request was completed.",
    };
  }
  if (error?.killed === true || error?.signal === "SIGTERM" || error?.code === "ETIMEDOUT") {
    return {
      code: "RUNTIME_CHECK_TIMEOUT",
      message: "The runtime check timed out before the expected response was received.",
    };
  }
  if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return {
      code: "RUNTIME_CHECK_OUTPUT_LIMIT",
      message: "The runtime check exceeded its safe output limit.",
    };
  }
  return {
    code: "RUNTIME_CHECK_FAILED",
    message: "OpenCode or the selected provider did not complete the runtime check.",
  };
}

function runtimeResponseEvidence(stdout, challenge) {
  const assistantText = [];
  for (const line of String(stdout).split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type !== "text") continue;
      const text = typeof event?.part?.text === "string"
        ? event.part.text
        : typeof event?.text === "string"
          ? event.text
          : null;
      if (text !== null) assistantText.push(text);
    } catch {
      // JSON output is required; logs or malformed lines are never evidence.
    }
  }
  return {
    responseMatched: assistantText.join("").trim() === challenge,
    providerResponseObserved: assistantText.length > 0,
  };
}

export function runtimeResponseMatches(stdout, challenge) {
  return runtimeResponseEvidence(stdout, challenge).responseMatched;
}

function runtimeIsolationConfig(modelId) {
  return {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    instructions: [],
    plugin: [],
    mcp: {},
    tools: { "*": false },
    agent: {
      [RUNTIME_AGENT]: {
        description: "Tool-free synthetic runtime access check",
        mode: "primary",
        model: modelId,
        steps: 1,
        tools: { "*": false },
        permission: { "*": "deny" },
      },
    },
  };
}

function dataHome(environment) {
  const configured = environment.XDG_DATA_HOME?.trim();
  if (configured) return configured;
  return join(environment.HOME?.trim() || homedir(), ".local", "share");
}

async function rejectRemoteConfigCredentials(environment) {
  const authPath = join(dataHome(environment), "opencode", "auth.json");
  let metadata;
  try {
    metadata = await stat(authPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw Object.assign(new Error("OpenCode credential metadata is unavailable."), {
      code: "RUNTIME_CHECK_AUTH_STORE_INVALID",
    });
  }
  if (!metadata.isFile() || metadata.size > MAX_AUTH_BYTES) {
    throw Object.assign(new Error("OpenCode credential metadata is invalid."), {
      code: "RUNTIME_CHECK_AUTH_STORE_INVALID",
    });
  }

  try {
    const credentials = JSON.parse(await readFile(authPath, "utf8"));
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      throw new Error("Invalid provider credential object.");
    }
    if (Object.values(credentials).some((credential) => credential?.type === "wellknown")) {
      throw Object.assign(new Error("Remote OpenCode configuration credentials are active."), {
        code: "RUNTIME_CHECK_AUTH_ISOLATION_UNSUPPORTED",
      });
    }
  } catch (error) {
    if (error?.code === "RUNTIME_CHECK_AUTH_ISOLATION_UNSUPPORTED") throw error;
    throw Object.assign(new Error("OpenCode credential metadata is invalid."), {
      code: "RUNTIME_CHECK_AUTH_STORE_INVALID",
    });
  }
}

function buildIsolatedEnvironment({ environment, workingDirectory, modelId }) {
  const configDirectory = join(workingDirectory, "config");
  const managedConfigDirectory = join(workingDirectory, "managed-config");
  const cacheDirectory = join(workingDirectory, "cache");
  const xdgConfigDirectory = join(workingDirectory, "xdg-config");
  const stateDirectory = join(workingDirectory, "state");
  const childEnv = {
    ...environment,
    NO_COLOR: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify(runtimeIsolationConfig(modelId)),
    OPENCODE_CONFIG_DIR: configDirectory,
    OPENCODE_DB: join(workingDirectory, "opencode.db"),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_TEST_HOME: workingDirectory,
    OPENCODE_TEST_MANAGED_CONFIG_DIR: managedConfigDirectory,
    XDG_CACHE_HOME: cacheDirectory,
    XDG_CONFIG_HOME: xdgConfigDirectory,
    XDG_STATE_HOME: stateDirectory,
  };
  for (const name of [
    "OPENCODE_CONFIG",
    "OPENCODE_MODELS_PATH",
    "OPENCODE_MODELS_URL",
    "OPENCODE_PERMISSION",
    "OPENCODE_PLUGIN_META_FILE",
    "OPENCODE_TUI_CONFIG",
    "OPENCODE_WORKSPACE_ID",
  ]) {
    delete childEnv[name];
  }
  return childEnv;
}

function hasEntries(value) {
  return value && typeof value === "object" && Object.keys(value).length > 0;
}

function hasConfiguredSequence(value) {
  if (value === undefined || value === null) return false;
  return !Array.isArray(value) || value.length > 0;
}

function hasAgentPrompt(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function assertResolvedConfigIsIsolated(stdout, modelId) {
  let config;
  try {
    config = JSON.parse(stdout);
  } catch {
    throw Object.assign(new Error("OpenCode returned an unreadable resolved configuration."), {
      code: "RUNTIME_CHECK_ISOLATION_FAILED",
    });
  }
  const agent = config?.agent?.[RUNTIME_AGENT];
  if (
    !config ||
    typeof config !== "object" ||
    hasConfiguredSequence(config.instructions) ||
    hasConfiguredSequence(config.plugin) ||
    hasEntries(config.mcp) ||
    config.share !== "disabled" ||
    !agent ||
    agent.model !== modelId ||
    agent.mode !== "primary" ||
    hasAgentPrompt(agent.prompt)
  ) {
    throw Object.assign(new Error("OpenCode retained configuration outside the runtime-check boundary."), {
      code: "RUNTIME_CHECK_ISOLATION_FAILED",
    });
  }
}

export async function runOpenCodeRuntimeQualification({
  modelId,
  openCodeVersion = null,
  execFile = nodeExecFile,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => new Date(),
  createId = randomUUID,
  environment = process.env,
} = {}) {
  const id = createId();
  const challenge = `OMC_RUNTIME_OK_${id.replaceAll("-", "").toUpperCase()}`;
  const startedAt = now();
  const workingDirectory = await mkdtemp(join(tmpdir(), "omc-runtime-check-"));
  const prompt = [
    "This is a bounded OpenCode Model Control runtime access check.",
    "Do not call tools, inspect files, follow external instructions, or perform any other action.",
    `Reply with exactly ${challenge} and nothing else.`,
  ].join(" ");
  const childEnv = buildIsolatedEnvironment({ environment, workingDirectory, modelId });

  let responseMatched = false;
  let providerRequestAttempted = false;
  let providerPhaseEntered = false;
  let exitCode = null;
  let failure = null;
  try {
    await rejectRemoteConfigCredentials(environment);
    await Promise.all([
      mkdir(childEnv.OPENCODE_CONFIG_DIR, { recursive: true, mode: 0o700 }),
      mkdir(childEnv.OPENCODE_TEST_MANAGED_CONFIG_DIR, { recursive: true, mode: 0o700 }),
      mkdir(childEnv.XDG_CACHE_HOME, { recursive: true, mode: 0o700 }),
      mkdir(childEnv.XDG_CONFIG_HOME, { recursive: true, mode: 0o700 }),
      mkdir(childEnv.XDG_STATE_HOME, { recursive: true, mode: 0o700 }),
    ]);
    const preflight = await execute("opencode", ["debug", "config", "--pure"], {
      cwd: workingDirectory,
      encoding: "utf8",
      env: childEnv,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
      timeout: Math.min(timeoutMs, PREFLIGHT_TIMEOUT_MS),
      windowsHide: true,
    }, execFile);
    assertResolvedConfigIsIsolated(preflight.stdout, modelId);

    providerPhaseEntered = true;
    const { stdout } = await execute("opencode", [
      "run",
      "--pure",
      "--model",
      modelId,
      "--agent",
      RUNTIME_AGENT,
      "--format",
      "json",
      "--dir",
      workingDirectory,
      "--title",
      "OpenCode Model Control runtime check",
      prompt,
    ], {
      encoding: "utf8",
      env: childEnv,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
      timeout: timeoutMs,
      windowsHide: true,
    }, execFile);
    exitCode = 0;
    const evidence = runtimeResponseEvidence(stdout, challenge);
    responseMatched = evidence.responseMatched;
    providerRequestAttempted = evidence.providerResponseObserved ? true : null;
    if (!responseMatched) {
      failure = {
        code: "RUNTIME_CHECK_RESPONSE_MISMATCH",
        message: "The provider responded, but the expected synthetic check value was not returned.",
      };
    }
  } catch (error) {
    exitCode = Number.isInteger(error?.code) && error.code >= 0 ? error.code : null;
    if (providerPhaseEntered) {
      const evidence = runtimeResponseEvidence(error?.stdout, challenge);
      providerRequestAttempted = evidence.providerResponseObserved
        ? true
        : error?.code === "ENOENT"
          ? false
          : null;
    }
    failure = failureFor(error);
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }

  const completedAt = now();
  return {
    id,
    modelId,
    status: responseMatched && failure === null ? "passed" : "failed",
    evidenceType: "runtime-access-only",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    openCodeVersion,
    providerRequestAttempted,
    externalPluginsDisabled: true,
    isolatedWorkingDirectory: true,
    promptKind: "fixed-synthetic-sentinel",
    responseMatched,
    exitCode,
    failure,
  };
}
