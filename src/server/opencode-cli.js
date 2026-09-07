import {
  analyzeRates,
  capabilityDetails,
  classifyPricingEvidence,
  digestJson,
  normalizeApiIdentity,
  PRICING_TTL_MS,
  resolveModelEvidence,
  splitModelId,
  unknownPricing,
} from "../core/pricing.js";
import { validateCatalog } from "../core/catalog.js";
import { execFile as nodeExecFile } from "node:child_process";

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9@~][a-z0-9._:+/@~-]*$/i;
const DEFAULT_TIMEOUT_MS = 8_000;
const REFRESH_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const INPUT_MODALITIES = Object.freeze([
  "text",
  "audio",
  "image",
  "video",
  "pdf",
]);
const OUTPUT_MODALITIES = Object.freeze([
  "text",
  "audio",
  "image",
  "video",
  "pdf",
]);

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

export function parseOpenCodeVerboseCatalog(
  stdout,
  { observedAt = new Date().toISOString() } = {},
) {
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
      const reportedPricing = analyzeRates(
        normalizeCliCost(value?.cost),
        value?.experimental?.modes,
      );
      const effectiveCapabilities = capabilityDetails(
        value,
        "opencode",
        observedAt,
        true,
      );
      models.push({
        id,
        api: normalizeApiIdentity(value?.api),
        reportedPricing,
        capabilities: effectiveCapabilities,
        provider: splitModelId(id)[0],
        name:
          typeof value?.name === "string" ? value.name : splitModelId(id)[1],
        status: value?.status === "active" ? "active" : "unavailable",
        // OpenCode can normalize missing prices to zero. A zero reported here is
        // not sufficient evidence that an arbitrary provider model is free.
        priceClass: reportedPricing.class === "paid" ? "paid" : "unknown",
        free: false,
        inputCost,
        outputCost,
        inputCostVerified: inputCost !== null,
        outputCostVerified: outputCost !== null,
        context: Number.isFinite(value?.limit?.context)
          ? value.limit.context
          : null,
        toolCall: effectiveCapabilities.toolCall,
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
  const match = String(stdout)
    .trim()
    .match(/^v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/u);
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
    const versionResult = await execute(
      "opencode",
      ["--version"],
      options,
      execFile,
    );
    version = parseOpenCodeVersion(versionResult.stdout);
  } catch (error) {
    const code =
      error?.code === "ENOENT"
        ? "OPENCODE_NOT_FOUND"
        : "OPENCODE_DISCOVERY_FAILED";
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
      const code =
        canonicalError?.code === "ENOENT"
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
      typeof entry === "string"
        ? [entry, { id: entry, free: false }]
        : [entry.id, entry],
    ),
  );
  return Object.fromEntries(
    catalog.models.map((model) => {
      const live = models.get(model.id);
      const priceVerified =
        live?.inputCostVerified === true && live?.outputCostVerified === true;
      return [
        model.id,
        {
          available: live?.status === "active" && priceVerified,
        },
      ];
    }),
  );
}

function retainCliConflict(pricing, priorPricing) {
  const conflicts = (priorPricing?.reasons ?? []).filter((reason) =>
    ["conflicting-cli-rates", "identity-or-rate-conflict"].includes(reason),
  );
  return conflicts.length
    ? {
        ...pricing,
        class: "unknown",
        reasons: [...new Set([...pricing.reasons, ...conflicts])],
      }
    : pricing;
}

export function mergeDiscoveredCatalog(
  baseCatalog,
  liveModels,
  {
    snapshotDate = new Date().toISOString().slice(0, 10),
    curatedCatalog,
    publicMetadata,
    now = Date.now(),
  } = {},
) {
  baseCatalog = validateCatalog(baseCatalog);
  const previous = new Map(
    baseCatalog.models.map((model) => [model.id, model]),
  );
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
      // Public metadata may revoke or update evidence, but an omitted CLI
      // observation cannot resolve a previously observed pricing conflict.
      const publicPricing = publicMetadata
        ? resolveModelEvidence(prior, publicMetadata)
        : null;
      const capabilityDerived =
        !curated &&
        (prior?.profileSource === "capability" ||
          (prior?.profileSource == null && prior?.discovered === true));
      return {
        ...prior,
        ...(publicMetadata
          ? {
              pricing: retainCliConflict(publicPricing, prior.pricing),
              capabilities: {
                ...prior.capabilities,
                supplemental: publicPricing.reasons.includes(
                  "identity-conflict",
                )
                  ? null
                  : (publicMetadata.models?.[id]?.capabilities ?? null),
              },
            }
          : {}),
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
        enabledByDefault:
          curated?.enabledByDefault ??
          (capabilityDerived ? false : prior.enabledByDefault),
      };
    }

    const capabilityDerived =
      !curated &&
      (!prior ||
        prior.profileSource === "capability" ||
        (prior.profileSource == null && prior.discovered === true));

    const observedAt =
      live.capabilities?.observedAt ?? new Date(now).toISOString();
    const reported =
      live.reportedPricing ??
      analyzeRates({
        input: live.inputCostVerified === true ? live.inputCost : undefined,
        output: live.outputCostVerified === true ? live.outputCost : undefined,
      });
    const api = normalizeApiIdentity(live.api);
    let pricing;
    if (publicMetadata) {
      pricing = resolveModelEvidence(live, publicMetadata);
      // CLI normalized zero is not contradictory to raw positive pricing, but
      // a positive CLI price conflicting with raw evidence must fail closed.
      if (
        pricing.class !== "unknown" &&
        (reported.class === "unknown" ||
          Object.entries(reported.rates).some(
            ([key, rate]) =>
              rate > 0 &&
              (pricing.rates[key] === undefined || pricing.rates[key] !== rate),
          ))
      ) {
        pricing = {
          ...pricing,
          class: "unknown",
          reasons: ["conflicting-cli-rates"],
        };
      }
    } else if (prior?.pricing?.source === "https://models.dev/api.json") {
      pricing = prior.pricing;
      if (
        !api.urlValid ||
        JSON.stringify(api) !==
          JSON.stringify(normalizeApiIdentity(prior.api)) ||
        reported.class === "unknown" ||
        Object.entries(reported.rates).some(
          ([key, rate]) => rate > 0 && pricing.rates[key] !== rate,
        )
      )
        pricing = {
          ...pricing,
          class: "unknown",
          reasons: ["identity-or-rate-conflict"],
        };
    } else pricing = unknownPricing();
    // Compatibility only: complete positive CLI rates can establish reported
    // paid status when no independent source record contradicts them.
    if (
      (!publicMetadata || !publicMetadata.models?.[id]) &&
      pricing.source !== "https://models.dev/api.json" &&
      reported.class === "paid" &&
      api.urlValid
    ) {
      pricing = {
        ...reported,
        source: "reported-paid",
        digest: null,
        fetchedAt: observedAt,
        expiresAt: new Date(
          Date.parse(observedAt) + PRICING_TTL_MS,
        ).toISOString(),
      };
    }
    const pricingClass = classifyPricingEvidence(pricing, { now });
    // A fresh observation resolves the rejection only when its resulting
    // evidence is known and current; unknown metadata must not wash it out.
    if (pricingClass === "unknown")
      pricing = retainCliConflict(pricing, prior?.pricing);
    const verifiedPricing = pricingClass !== "unknown";
    const effective =
      live.capabilities ??
      capabilityDetails(
        {
          capabilities: {
            toolcall: live.toolCall,
            input: Object.fromEntries(
              (live.inputModalities ?? []).map((key) => [key, true]),
            ),
            output: Object.fromEntries(
              (live.outputModalities ?? []).map((key) => [key, true]),
            ),
          },
          limit: { context: live.context },
        },
        "opencode",
        observedAt,
        true,
      );
    const supplemental =
      pricing.reasons.includes("identity-conflict") ||
      pricing.reasons.includes("identity-or-rate-conflict")
        ? null
        : (publicMetadata?.models?.[id]?.capabilities ??
          prior?.capabilities?.supplemental ??
          null);
    const inputModalities = Array.isArray(live.inputModalities)
      ? live.inputModalities
      : capabilityDerived
        ? []
        : (curated?.modalities?.input ?? prior?.modalities?.input ?? []);
    const outputModalities = Array.isArray(live.outputModalities)
      ? live.outputModalities
      : capabilityDerived
        ? []
        : (curated?.modalities?.output ?? prior?.modalities?.output ?? []);
    const capabilityProfile = capabilityRoleProfile({
      inputModalities,
      outputModalities,
      toolCall: live.toolCall,
    });
    const restrictedProfile = curated ?? (capabilityDerived ? null : prior);
    const curatedProfile = restrictedProfile
      ? {
          access: restrictedProfile.access.filter((mode) =>
            capabilityProfile.access.includes(mode),
          ),
          canOrchestrate:
            restrictedProfile.canOrchestrate === true &&
            capabilityProfile.canOrchestrate === true,
          roles: Object.fromEntries(
            Object.entries(restrictedProfile.roles).filter(([role]) =>
              Object.hasOwn(capabilityProfile.roles, role),
            ),
          ),
        }
      : null;

    return {
      ...(prior ?? {}),
      id,
      api,
      pricing,
      capabilities: { effective, supplemental },
      label: curated?.label ?? prior?.label ?? live.name,
      status: curated?.status ?? prior?.status ?? "provisional",
      provisional: curated?.provisional ?? prior?.provisional ?? true,
      enabledByDefault:
        curated?.enabledByDefault ?? prior?.enabledByDefault ?? false,
      available: live.status === "active",
      discovered: true,
      runtimeVerified: false,
      provider: live.provider ?? splitModelId(id)[0],
      profileSource: curated
        ? "curated"
        : (prior?.profileSource ?? "capability"),
      contextWindowTokens:
        Number.isInteger(live.context) && live.context > 0
          ? live.context
          : null,
      free: {
        verified: verifiedPricing,
        inputUsdPerMillion: verifiedPricing ? pricing.rates.input : null,
        outputUsdPerMillion: verifiedPricing ? pricing.rates.output : null,
        verifiedAt:
          pricing.fetchedAt?.slice(0, 10) ?? prior?.free?.verifiedAt ?? null,
      },
      modalities: { input: inputModalities, output: outputModalities },
      toolCall: live.toolCall === true,
      access:
        curatedProfile?.access ??
        (capabilityDerived
          ? capabilityProfile.access
          : (prior?.access ?? capabilityProfile.access)),
      canOrchestrate:
        curatedProfile?.canOrchestrate ??
        (capabilityDerived
          ? capabilityProfile.canOrchestrate
          : (prior?.canOrchestrate ?? capabilityProfile.canOrchestrate)),
      roles:
        curatedProfile?.roles ??
        (capabilityDerived
          ? capabilityProfile.roles
          : (prior?.roles ?? capabilityProfile.roles)),
    };
  });

  return {
    ...baseCatalog,
    snapshotDate,
    schemaVersion: 2,
    revision: digestJson(models),
    models,
  };
}

function capabilityRoleProfile({
  inputModalities,
  outputModalities,
  toolCall,
}) {
  const acceptsText = inputModalities.includes("text");
  const returnsText = outputModalities.includes("text");
  const roles = {};
  if (acceptsText && returnsText) roles.reviewer = 25;
  if (acceptsText && returnsText && toolCall) {
    roles.orchestrator = 25;
    roles["code-worker"] = 25;
  }
  if (
    acceptsText &&
    ["image", "audio", "video", "pdf"].some((modality) => inputModalities.includes(modality)) &&
    returnsText &&
    toolCall
  ) {
    roles["vision-worker"] = 25;
  }
  return {
    access: toolCall ? ["read", "write"] : ["read"],
    canOrchestrate: acceptsText && returnsText && toolCall === true,
    roles,
  };
}

// OpenCode normalizes raw Models.dev cache rates into an object. Preserve all
// other fields so unknown billing dimensions still fail closed in analyzeRates.
function normalizeCliCost(cost) {
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) return cost;
  const result = { ...cost };
  if (Object.hasOwn(result, "cache")) {
    const cache = result.cache;
    if (
      !cache ||
      typeof cache !== "object" ||
      Array.isArray(cache) ||
      Object.keys(cache).some((key) => !["read", "write"].includes(key))
    )
      result.unsupported_cache = null;
    else {
      result.cache_read = cache.read;
      result.cache_write = cache.write;
      if (
        (cost.cache_read !== undefined && cost.cache_read !== cache.read) ||
        (cost.cache_write !== undefined && cost.cache_write !== cache.write)
      )
        result.conflicting_cache = null;
    }
    delete result.cache;
  }
  if (Array.isArray(result.tiers))
    result.tiers = result.tiers.map(normalizeCliCost);
  if (Object.hasOwn(result, "experimentalOver200K")) {
    if (Object.hasOwn(result, "context_over_200k"))
      result.conflicting_legacy = null;
    result.context_over_200k = normalizeCliCost(result.experimentalOver200K);
    delete result.experimentalOver200K;
  }
  return result;
}
