import { execFile as nodeExecFile } from "node:child_process";

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:+/-]*$/i;
const DEFAULT_TIMEOUT_MS = 8_000;
const REFRESH_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const INPUT_MODALITIES = Object.freeze(["text", "audio", "image", "video", "pdf"]);
const OUTPUT_MODALITIES = Object.freeze(["text", "audio", "image", "video", "pdf"]);

function execute(file, args, options, execFile = nodeExecFile) {
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

export function parseOpenCodeModelList(stdout) {
  return [
    ...new Set(
      String(stdout)
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => MODEL_ID_PATTERN.test(line)),
    ),
  ].sort();
}

function readJsonObject(lines, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  const body = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    body.push(line);
    for (const character of line) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\" && inString) {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = !inString;
        continue;
      }
      if (!inString && character === "{") depth += 1;
      if (!inString && character === "}") depth -= 1;
    }
    if (depth === 0 && body.join("").trim().startsWith("{")) {
      return { value: JSON.parse(body.join("\n")), endIndex: index };
    }
  }
  throw new Error("Incomplete model metadata object.");
}

export function parseOpenCodeVerboseCatalog(stdout) {
  const lines = String(stdout).split(/\r?\n/u);
  const models = [];

  for (let index = 0; index < lines.length; index += 1) {
    const id = lines[index].trim();
    if (!MODEL_ID_PATTERN.test(id)) continue;
    try {
      const { value, endIndex } = readJsonObject(lines, index + 1);
      const input = value?.capabilities?.input ?? {};
      const output = value?.capabilities?.output ?? {};
      const inputCost = verifiedCost(value?.cost?.input);
      const outputCost = verifiedCost(value?.cost?.output);
      const priceVerified = inputCost !== null && outputCost !== null;
      models.push({
        id,
        provider: id.split("/", 1)[0],
        name: typeof value?.name === "string" ? value.name : id.split("/").at(-1),
        status: value?.status === "active" ? "active" : "unavailable",
        // OpenCode can normalize missing prices to zero. A zero reported here is
        // not sufficient evidence that an arbitrary provider model is free.
        priceClass:
          priceVerified && (inputCost > 0 || outputCost > 0) ? "paid" : "unknown",
        free: false,
        inputCost,
        outputCost,
        inputCostVerified: inputCost !== null,
        outputCostVerified: outputCost !== null,
        context: Number.isFinite(value?.limit?.context) ? value.limit.context : null,
        toolCall: value?.capabilities?.toolcall === true,
        inputModalities: INPUT_MODALITIES.filter(
          (modality) => input[modality] === true,
        ),
        outputModalities: OUTPUT_MODALITIES.filter(
          (modality) => output[modality] === true,
        ),
      });
      index = endIndex;
    } catch {
      // A malformed block is ignored, which makes that model unavailable downstream.
    }
  }

  return models;
}

function verifiedCost(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function parseOpenCodeVersion(stdout) {
  const match = String(stdout).trim().match(/^v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/u);
  return match?.[1] ?? null;
}

export async function discoverOpenCode({
  execFile = nodeExecFile,
  refresh = false,
  cwd,
} = {}) {
  const options = {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: refresh ? REFRESH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
    windowsHide: true,
    ...(cwd ? { cwd } : {}),
  };

  const modelArgs = ["models", "--verbose"];
  if (refresh) modelArgs.push("--refresh");
  let version = null;

  try {
    const versionResult = await execute("opencode", ["--version"], options, execFile);
    version = parseOpenCodeVersion(versionResult.stdout);
  } catch (error) {
    const code = error?.code === "ENOENT" ? "OPENCODE_NOT_FOUND" : "OPENCODE_DISCOVERY_FAILED";
    return failedDiscovery({ code, version });
  }

  try {
    const { stdout } = await execute("opencode", modelArgs, options, execFile);
    return successfulDiscovery({ stdout, version, complete: true });
  } catch (canonicalError) {
    // External OpenCode plugins can hang or fail catalog discovery. A pure-mode
    // fallback keeps built-in/configured providers usable, but is explicitly
    // marked incomplete because plugin-contributed providers can be omitted.
    try {
      const pureArgs = ["models", "--pure", "--verbose"];
      if (refresh) pureArgs.push("--refresh");
      const { stdout } = await execute("opencode", pureArgs, options, execFile);
      return successfulDiscovery({
        stdout,
        version,
        complete: false,
        warning: {
          code: "OPENCODE_PLUGIN_DISCOVERY_INCOMPLETE",
          message:
            "OpenCode plugin-aware discovery did not finish, so the catalog was updated in plugin-free fallback mode. Plugin-provided models may be missing.",
        },
      });
    } catch {
      const code = canonicalError?.code === "ENOENT"
        ? "OPENCODE_NOT_FOUND"
        : "OPENCODE_DISCOVERY_FAILED";
      return failedDiscovery({ code, version });
    }
  }
}

function successfulDiscovery({ stdout, version, complete, warning = null }) {
  const models = parseOpenCodeVerboseCatalog(stdout);
  if (models.length === 0) {
    return failedDiscovery({ code: "OPENCODE_DISCOVERY_FAILED", version });
  }
  return {
    installed: true,
    version,
    availableIds: models.map(({ id }) => id),
    models,
    complete,
    checkedAt: new Date().toISOString(),
    error: warning,
  };
}

function failedDiscovery({ code, version }) {
  return {
    installed: code !== "OPENCODE_NOT_FOUND",
    version,
    availableIds: [],
    models: [],
    complete: false,
    checkedAt: new Date().toISOString(),
    error: {
      code,
      message:
        code === "OPENCODE_NOT_FOUND"
          ? "OpenCode was not found on this computer."
          : "OpenCode model discovery did not complete. The last complete catalog was kept.",
    },
  };
}

export function toLiveAvailability(catalog, liveModels) {
  const models = new Map(
    liveModels.map((entry) =>
      typeof entry === "string" ? [entry, { id: entry, free: false }] : [entry.id, entry],
    ),
  );
  return Object.fromEntries(
    catalog.models.map((model) => {
      const live = models.get(model.id);
      const priceVerified = live?.inputCostVerified === true && live?.outputCostVerified === true;
      return [
        model.id,
        {
          available: live?.status === "active" && priceVerified,
        },
      ];
    }),
  );
}

export function mergeDiscoveredCatalog(baseCatalog, liveModels, {
  snapshotDate = new Date().toISOString().slice(0, 10),
  curatedCatalog,
} = {}) {
  const previous = new Map(baseCatalog.models.map((model) => [model.id, model]));
  const curatedById = new Map(
    (curatedCatalog?.models ?? []).map((model) => [model.id, model]),
  );
  const liveById = new Map(liveModels.map((model) => [model.id, model]));
  const ids = new Set([...previous.keys(), ...liveById.keys()]);
  const models = [...ids].map((id) => {
    const prior = previous.get(id);
    const curated = curatedById.get(id);
    const live = liveById.get(id);
    if (!live) {
      const capabilityDerived =
        !curated &&
        (prior?.profileSource === "capability" ||
          (prior?.profileSource == null && prior?.discovered === true));
      return {
        ...prior,
        ...(curated
          ? {
              label: curated.label,
              status: curated.status,
              provisional: curated.provisional,
              access: curated.access,
              canOrchestrate: curated.canOrchestrate,
              roles: curated.roles,
              profileSource: "curated",
            }
          : {}),
        available: false,
        discovered: false,
        runtimeVerified: false,
        enabledByDefault: curated?.enabledByDefault ??
          (capabilityDerived ? false : prior.enabledByDefault),
      };
    }

    const capabilityDerived =
      !curated &&
      (!prior ||
        prior.profileSource === "capability" ||
        (prior.profileSource == null && prior.discovered === true));

    const reportedInputCost = verifiedCost(
      live.inputCost ?? (live.free === true ? 0 : null),
    );
    const reportedOutputCost = verifiedCost(
      live.outputCost ?? (live.free === true ? 0 : null),
    );
    const reportedPrices =
      live.inputCostVerified === true &&
      live.outputCostVerified === true &&
      reportedInputCost !== null &&
      reportedOutputCost !== null;
    const liveHasPositivePrice =
      reportedPrices && (reportedInputCost > 0 || reportedOutputCost > 0);
    const pricingEvidence = curated ?? prior;
    const priorVerifiedFree =
      pricingEvidence?.free?.verified === true &&
      pricingEvidence.free.inputUsdPerMillion === 0 &&
      pricingEvidence.free.outputUsdPerMillion === 0;
    const verifiedPricing = liveHasPositivePrice || (priorVerifiedFree && reportedPrices);
    const inputModalities = Array.isArray(live.inputModalities)
      ? live.inputModalities
      : capabilityDerived
        ? []
        : curated?.modalities?.input ?? prior?.modalities?.input ?? [];
    const outputModalities = Array.isArray(live.outputModalities)
      ? live.outputModalities
      : capabilityDerived
        ? []
        : curated?.modalities?.output ?? prior?.modalities?.output ?? [];
    const capabilityProfile = capabilityRoleProfile({
      inputModalities,
      outputModalities,
      toolCall: live.toolCall,
    });
    const curatedProfile = curated
      ? {
          access: curated.access.filter((mode) => capabilityProfile.access.includes(mode)),
          canOrchestrate:
            curated.canOrchestrate === true && capabilityProfile.canOrchestrate === true,
          roles: Object.fromEntries(
            Object.entries(curated.roles).filter(([role]) =>
              Object.hasOwn(capabilityProfile.roles, role),
            ),
          ),
        }
      : null;

    return {
      ...(prior ?? {}),
      id,
      label: curated?.label ?? prior?.label ?? live.name,
      status: curated?.status ?? prior?.status ?? "provisional",
      provisional: curated?.provisional ?? prior?.provisional ?? true,
      enabledByDefault: curated?.enabledByDefault ?? prior?.enabledByDefault ?? false,
      available: live.status === "active",
      discovered: true,
      runtimeVerified: false,
      provider: live.provider ?? id.split("/", 1)[0],
      profileSource: curated ? "curated" : prior?.profileSource ?? "capability",
      contextWindowTokens:
        Number.isInteger(live.context) && live.context > 0
          ? live.context
          : prior?.contextWindowTokens ?? null,
      free: {
        verified: verifiedPricing,
        inputUsdPerMillion: verifiedPricing ? reportedInputCost : null,
        outputUsdPerMillion: verifiedPricing ? reportedOutputCost : null,
        verifiedAt: snapshotDate,
      },
      modalities: { input: inputModalities, output: outputModalities },
      toolCall: live.toolCall === true,
      access: curatedProfile?.access ??
        (capabilityDerived ? capabilityProfile.access : prior?.access ?? capabilityProfile.access),
      canOrchestrate: curatedProfile?.canOrchestrate ??
        (capabilityDerived
          ? capabilityProfile.canOrchestrate
          : prior?.canOrchestrate ?? capabilityProfile.canOrchestrate),
      roles: curatedProfile?.roles ??
        (capabilityDerived ? capabilityProfile.roles : prior?.roles ?? capabilityProfile.roles),
    };
  });

  return {
    ...baseCatalog,
    snapshotDate,
    models,
  };
}

function capabilityRoleProfile({ inputModalities, outputModalities, toolCall }) {
  const acceptsText = inputModalities.includes("text");
  const returnsText = outputModalities.includes("text");
  const roles = {};
  if (acceptsText && returnsText) roles.reviewer = 25;
  if (acceptsText && returnsText && toolCall) {
    roles.orchestrator = 25;
    roles["code-worker"] = 25;
  }
  if (acceptsText && inputModalities.includes("image") && returnsText && toolCall) {
    roles["vision-worker"] = 25;
  }
  return {
    access: toolCall ? ["read", "write"] : ["read"],
    canOrchestrate: acceptsText && returnsText && toolCall === true,
    roles,
  };
}
