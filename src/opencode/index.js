import { isDeepStrictEqual } from "node:util";

const CONFIG_SCHEMA = "https://opencode.ai/config.json";
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const DEFAULT_MODELS = [
  {
    id: "opencode/big-pickle",
    label: "Big Pickle",
    status: "active",
    provisional: false,
    enabledByDefault: true,
    access: ["read", "write"],
    free: {
      verified: true,
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      verifiedAt: "2026-08-30",
    },
    available: true,
    modalities: { input: ["text"], output: ["text"] },
    canOrchestrate: true,
    roles: { orchestrator: 100, reviewer: 60 },
  },
  {
    id: "opencode/ling-3.0-flash-fin-free",
    label: "Ling 3.0 Flash Fin Free",
    status: "active",
    provisional: false,
    enabledByDefault: true,
    access: ["read", "write"],
    free: {
      verified: true,
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      verifiedAt: "2026-08-30",
    },
    available: true,
    modalities: { input: ["text"], output: ["text"] },
    canOrchestrate: true,
    roles: { orchestrator: 70, "code-worker": 100, reviewer: 50 },
  },
  {
    id: "opencode/mimo-v2.5-free",
    label: "MiMo V2.5 Free",
    status: "active",
    provisional: false,
    enabledByDefault: true,
    access: ["read", "write"],
    free: {
      verified: true,
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      verifiedAt: "2026-08-30",
    },
    available: true,
    modalities: {
      input: ["text", "image", "audio", "video"],
      output: ["text"],
    },
    canOrchestrate: false,
    roles: { "code-worker": 70, "vision-worker": 100, reviewer: 75 },
  },
  {
    id: "opencode/muse-spark-1.2-contributor-free",
    label: "Muse Spark 1.2 Contributor Free",
    status: "provisional",
    provisional: true,
    enabledByDefault: false,
    access: ["read", "write"],
    free: {
      verified: true,
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      verifiedAt: "2026-08-30",
    },
    available: true,
    modalities: {
      input: ["text", "image", "audio", "video", "pdf"],
      output: ["text"],
    },
    canOrchestrate: true,
    roles: {
      orchestrator: 75,
      "code-worker": 65,
      "vision-worker": 80,
      reviewer: 85,
    },
  },
  {
    id: "opencode/nemotron-3-ultra-free",
    label: "Nemotron 3 Ultra Free",
    status: "active",
    provisional: false,
    enabledByDefault: true,
    access: ["read"],
    free: {
      verified: true,
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      verifiedAt: "2026-08-30",
    },
    available: true,
    modalities: { input: ["text"], output: ["text"] },
    canOrchestrate: false,
    roles: { reviewer: 100 },
  },
  {
    id: "opencode/nemotron-3.5-lightning-free",
    label: "Nemotron 3.5 Lightning Free",
    status: "active",
    provisional: false,
    enabledByDefault: true,
    access: ["read", "write"],
    free: {
      verified: true,
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      verifiedAt: "2026-08-30",
    },
    available: true,
    modalities: { input: ["text"], output: ["text"] },
    canOrchestrate: false,
    roles: { "code-worker": 90, reviewer: 70 },
  },
];

export const DEFAULT_FREE_CATALOG = Object.freeze(
  DEFAULT_MODELS.map((model) =>
    Object.freeze({
      ...model,
      free: Object.freeze({ ...model.free }),
      modalities: Object.freeze({
        input: Object.freeze([...model.modalities.input]),
        output: Object.freeze([...model.modalities.output]),
      }),
      access: Object.freeze([...model.access]),
      roles: Object.freeze({ ...model.roles }),
    }),
  ),
);

export const DEFAULT_OPEN_CODE_SETTINGS = Object.freeze({
  schemaVersion: 2,
  costPreference: "free-first",
  costPolicy: "free-only",
  maxDelegationDepth: 1,
  maxFallbacksPerAssignment: 1,
  modelControls: Object.freeze({}),
  roleAssignments: Object.freeze({
    orchestrator: "opencode/big-pickle",
    "code-worker": "auto",
    "vision-worker": "opencode/mimo-v2.5-free",
    reviewer: "auto",
  }),
});

export const OPEN_CODE_LIMITATION_WARNINGS = Object.freeze([
  "Stock OpenCode chooses the session model before it can call tools; MCP cannot choose the first model.",
  "Big Pickle is text-only. It cannot transparently inspect an image attachment that OpenCode omitted before the first call; submit that attachment directly to the generated vision subagent.",
  "Free model identities, limits, availability, and data-handling terms can change. Revalidate the catalog in OpenCode before relying on it.",
]);

export class OpenCodeConfigConflictError extends Error {
  constructor(path) {
    super(`Refusing to replace existing OpenCode config at ${path}`);
    this.name = "OpenCodeConfigConflictError";
    this.path = path;
  }
}

/**
 * Build an OpenCode 1.18.x-compatible config fragment in memory.
 *
 * @param {{catalog?: object[], settings?: object}} [options]
 * @returns {object}
 */
export function buildOpenCodeConfig({ catalog, settings } = {}) {
  const catalogRecords = catalog?.models ?? catalog ?? DEFAULT_FREE_CATALOG;
  const resolvedCatalog = normalizeCatalog(catalogRecords);
  const resolvedSettings = normalizeSettings(settings);
  const primary = resolveRoleModel(
    resolvedCatalog,
    resolvedSettings.roleAssignments.orchestrator,
    "orchestrator",
    resolvedSettings,
    "roleAssignments.orchestrator",
  );

  const specialists = {};
  for (const role of ["code-worker", "vision-worker", "reviewer"]) {
    const modelId = resolvedSettings.roleAssignments[role];
    if (!modelId) continue;
    const specialist = resolveRoleModel(
      resolvedCatalog,
      modelId,
      role,
      resolvedSettings,
      `roleAssignments.${role}`,
    );
    if (specialist) specialists[role] = specialist;
  }

  const agents = {
    "omc-router": {
      description:
        "Text-first primary that delegates explicit work to policy-approved specialists.",
      mode: "primary",
      model: primary.modelId,
      prompt: buildRouterPrompt(resolvedSettings, specialists),
      tools: { "model-control_*": true },
      permission: {
        "model-control_*": "allow",
        task: specialistTaskPermissions(specialists),
      },
    },
  };

  for (const role of ["code-worker", "vision-worker", "reviewer"]) {
    if (!specialists[role]) continue;
    agents[`omc-${role}`] = {
      description: specialistDescription(role, specialists[role].label),
      mode: "subagent",
      model: specialists[role].modelId,
      prompt: specialistPrompt(role),
      tools: { "model-control_*": false },
      permission: { "model-control_*": "deny", task: "deny" },
    };
  }

  const config = {
    $schema: CONFIG_SCHEMA,
    mcp: {
      "model-control": {
        type: "local",
        command: ["opencode-model-control", "mcp"],
        enabled: true,
        timeout: 10_000,
      },
    },
    tools: { "model-control_*": false },
    agent: agents,
  };

  return config;
}

/**
 * Render the generated config fragment without reading or writing any file.
 *
 * @param {{catalog?: object[], settings?: object}} [options]
 * @returns {string}
 */
export function renderOpenCodeConfig(options = {}) {
  return `${JSON.stringify(buildOpenCodeConfig(options), null, 2)}\n`;
}

/**
 * Preview a fail-closed, non-mutating merge into an already parsed config.
 * No filesystem path is accepted and this function performs no writes.
 *
 * @param {{existingConfig?: object, catalog?: object[], settings?: object}} [options]
 * @returns {{mutation: "none", writes: never[], fragment: object, mergedConfig: object, changes: object[], warnings: string[]}}
 */
export function previewOpenCodeConfig({
  existingConfig = {},
  catalog,
  settings,
} = {}) {
  assertSafeJsonValue(existingConfig, "existingConfig");
  const mergedConfig = cloneJson(existingConfig);
  const fragment = buildOpenCodeConfig({ catalog, settings });
  const changes = [];

  if (!("$schema" in mergedConfig)) {
    mergedConfig.$schema = fragment.$schema;
    changes.push({ action: "add", path: "$schema", value: fragment.$schema });
  }

  if (!("agent" in mergedConfig)) {
    mergedConfig.agent = {};
  } else if (!isPlainObject(mergedConfig.agent)) {
    throw new TypeError("existingConfig.agent must be an object");
  }

  if (!("mcp" in mergedConfig)) {
    mergedConfig.mcp = {};
  } else if (!isPlainObject(mergedConfig.mcp)) {
    throw new TypeError("existingConfig.mcp must be an object");
  }

  for (const [serverId, definition] of Object.entries(fragment.mcp)) {
    const path = `mcp.${serverId}`;
    if (Object.hasOwn(mergedConfig.mcp, serverId)) {
      if (!isDeepStrictEqual(mergedConfig.mcp[serverId], definition)) {
        throw new OpenCodeConfigConflictError(path);
      }
      changes.push({ action: "unchanged", path });
      continue;
    }

    mergedConfig.mcp[serverId] = cloneJson(definition);
    changes.push({ action: "add", path, value: cloneJson(definition) });
  }

  if (!("tools" in mergedConfig)) {
    mergedConfig.tools = {};
  } else if (!isPlainObject(mergedConfig.tools)) {
    throw new TypeError("existingConfig.tools must be an object");
  }

  for (const [toolPattern, enabled] of Object.entries(fragment.tools)) {
    const path = `tools.${toolPattern}`;
    if (Object.hasOwn(mergedConfig.tools, toolPattern)) {
      if (!isDeepStrictEqual(mergedConfig.tools[toolPattern], enabled)) {
        throw new OpenCodeConfigConflictError(path);
      }
      changes.push({ action: "unchanged", path });
      continue;
    }
    mergedConfig.tools[toolPattern] = enabled;
    changes.push({ action: "add", path, value: enabled });
  }

  for (const [agentId, definition] of Object.entries(fragment.agent)) {
    const path = `agent.${agentId}`;
    if (Object.hasOwn(mergedConfig.agent, agentId)) {
      if (!isDeepStrictEqual(mergedConfig.agent[agentId], definition)) {
        throw new OpenCodeConfigConflictError(path);
      }
      changes.push({ action: "unchanged", path });
      continue;
    }

    mergedConfig.agent[agentId] = cloneJson(definition);
    changes.push({ action: "add", path, value: cloneJson(definition) });
  }

  if (fragment.default_agent) {
    if (
      Object.hasOwn(mergedConfig, "default_agent") &&
      mergedConfig.default_agent !== fragment.default_agent
    ) {
      throw new OpenCodeConfigConflictError("default_agent");
    }
    if (!Object.hasOwn(mergedConfig, "default_agent")) {
      mergedConfig.default_agent = fragment.default_agent;
      changes.push({
        action: "add",
        path: "default_agent",
        value: fragment.default_agent,
      });
    }
  }

  return {
    mutation: "none",
    writes: [],
    fragment,
    mergedConfig,
    changes,
    warnings: [...OPEN_CODE_LIMITATION_WARNINGS],
  };
}

function normalizeSettings(settings = {}) {
  if (!isPlainObject(settings)) {
    throw new TypeError("settings must be an object");
  }
  assertSafeJsonValue(settings, "settings");
  if (
    settings.roleAssignments !== undefined &&
    !isPlainObject(settings.roleAssignments)
  ) {
    throw new TypeError("settings.roleAssignments must be an object");
  }
  if (
    settings.modelControls !== undefined &&
    !isPlainObject(settings.modelControls)
  ) {
    throw new TypeError("settings.modelControls must be an object");
  }

  const migratedCostPreference =
    settings.costPreference ?? (settings.freeOnly === false ? "paid-first" : "free-first");
  const migratedCostPolicy =
    settings.costPolicy ?? (settings.freeOnly === false ? "known-cost" : "free-only");
  const resolved = {
    ...DEFAULT_OPEN_CODE_SETTINGS,
    ...settings,
    schemaVersion: Math.max(2, Number(settings.schemaVersion) || 2),
    costPreference: migratedCostPreference,
    costPolicy: migratedCostPolicy,
    modelControls: cloneJson(settings.modelControls ?? {}),
    roleAssignments: {
      ...DEFAULT_OPEN_CODE_SETTINGS.roleAssignments,
      ...(settings.roleAssignments ?? {}),
    },
  };

  if (!["free-first", "paid-first"].includes(resolved.costPreference)) {
    throw new TypeError("settings.costPreference must be free-first or paid-first");
  }
  if (!["free-only", "known-cost"].includes(resolved.costPolicy)) {
    throw new TypeError("settings.costPolicy must be free-only or known-cost");
  }
  if (!Number.isInteger(resolved.schemaVersion) || resolved.schemaVersion < 1) {
    throw new TypeError("settings.schemaVersion must be a positive integer");
  }
  if (
    !Number.isInteger(resolved.maxDelegationDepth) ||
    resolved.maxDelegationDepth < 0 ||
    resolved.maxDelegationDepth > 1
  ) {
    throw new TypeError(
      "settings.maxDelegationDepth must be zero or one",
    );
  }
  if (
    !Number.isInteger(resolved.maxFallbacksPerAssignment) ||
    resolved.maxFallbacksPerAssignment < 0 ||
    resolved.maxFallbacksPerAssignment > 1
  ) {
    throw new TypeError(
      "settings.maxFallbacksPerAssignment must be zero or one",
    );
  }

  const roleNames = ["orchestrator", "code-worker", "vision-worker", "reviewer"];
  for (const role of roleNames) {
    if (typeof resolved.roleAssignments[role] !== "string") {
      throw new TypeError(
        `settings.roleAssignments.${role} must be a model ID string`,
      );
    }
  }
  if (!resolved.roleAssignments.orchestrator) {
    throw new TypeError("settings.roleAssignments.orchestrator cannot be empty");
  }

  assertSafeJsonValue(resolved.modelControls, "settings.modelControls");
  for (const [modelId, control] of Object.entries(resolved.modelControls)) {
    if (!isPlainObject(control)) {
      throw new TypeError(`settings.modelControls.${modelId} must be an object`);
    }
    for (const field of ["enabled", "available"]) {
      if (control[field] !== undefined && typeof control[field] !== "boolean") {
        throw new TypeError(
          `settings.modelControls.${modelId}.${field} must be a boolean`,
        );
      }
    }
  }

  return resolved;
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new TypeError("catalog must be a non-empty array");
  }

  const byId = new Map();
  for (const [index, rawModel] of catalog.entries()) {
    if (!isPlainObject(rawModel)) {
      throw new TypeError(`catalog[${index}] must be an object`);
    }
    assertSafeJsonValue(rawModel, `catalog[${index}]`);

    const modelId = canonicalModelId(rawModel, index);
    const normalized = {
      ...cloneJson(rawModel),
      modelId,
      label:
        typeof rawModel.label === "string" && rawModel.label.trim()
          ? rawModel.label.trim()
          : typeof rawModel.name === "string" && rawModel.name.trim()
            ? rawModel.name.trim()
          : modelId,
    };

    const aliases = new Set([modelId]);
    if (typeof rawModel.id === "string") aliases.add(rawModel.id);
    if (typeof rawModel.modelId === "string") aliases.add(rawModel.modelId);
    for (const alias of aliases) {
      if (byId.has(alias)) {
        throw new TypeError(`catalog contains duplicate model ID ${alias}`);
      }
      byId.set(alias, normalized);
    }
  }
  return byId;
}

function canonicalModelId(model, index) {
  if (typeof model.modelId === "string" && model.modelId.includes("/")) {
    return model.modelId;
  }
  if (typeof model.id !== "string" || model.id.length === 0) {
    throw new TypeError(`catalog[${index}].id must be a non-empty string`);
  }
  if (model.id.includes("/")) return model.id;
  const provider =
    typeof model.provider === "string"
      ? model.provider
      : typeof model.access === "string"
        ? model.access
        : null;
  if (provider) {
    return `${provider}/${model.id}`;
  }
  throw new TypeError(
    `catalog[${index}] must use provider/model in id or provide a provider`,
  );
}

function selectModel(catalog, requestedId, settings, field) {
  const model = catalog.get(requestedId);
  if (!model) {
    throw new RangeError(`${field} references unknown model ${requestedId}`);
  }
  if (!modelAllowedByCostPolicy(model, settings.costPolicy)) {
    throw new RangeError(`${requestedId} is not allowed by the current cost policy`);
  }
  const control = settings.modelControls[requestedId] ?? {};
  const available = control.available ?? model.available;
  const enabled =
    control.enabled ?? model.enabled ?? model.enabledByDefault ?? true;
  if (available === false || enabled === false) {
    throw new RangeError(`${requestedId} is not currently available and enabled`);
  }
  return model;
}

function resolveRoleModel(catalog, assignment, role, settings, field) {
  if (assignment !== "auto") {
    const selected = selectModel(catalog, assignment, settings, field);
    if (!modelDeclaresRole(selected, role) || !modelMeetsRoleRequirements(selected, role)) {
      throw new RangeError(`${assignment} is not compatible with ${role}`);
    }
    return selected;
  }

  const candidates = [...new Set(catalog.values())]
    .filter((model) => {
      const priority = model.roles?.[role];
      if (!Number.isInteger(priority) || priority <= 0) return false;
      if (!modelAllowedByCostPolicy(model, settings.costPolicy)) return false;
      const control = settings.modelControls[model.modelId] ?? {};
      const available = control.available ?? model.available;
      const enabled =
        control.enabled ?? model.enabled ?? model.enabledByDefault ?? true;
      if (available === false || enabled === false) return false;
      return modelMeetsRoleRequirements(model, role);
    })
    .sort((left, right) => compareEligibleModels(
      left,
      right,
      role,
      settings.costPreference,
    ));

  if (candidates[0]) return candidates[0];
  if (role === "orchestrator") {
    throw new RangeError(`${field} could not resolve an eligible model`);
  }
  return undefined;
}

function isVerifiedFreeModel(model) {
  return (
    isPlainObject(model.free) &&
    model.free.verified === true &&
    model.free.inputUsdPerMillion === 0 &&
    model.free.outputUsdPerMillion === 0
  );
}

function modelPriceClass(model) {
  if (!isPlainObject(model.free) || model.free.verified !== true) return "unknown";
  const input = model.free.inputUsdPerMillion;
  const output = model.free.outputUsdPerMillion;
  if (
    typeof input !== "number" ||
    !Number.isFinite(input) ||
    input < 0 ||
    typeof output !== "number" ||
    !Number.isFinite(output) ||
    output < 0
  ) {
    return "unknown";
  }
  return input === 0 && output === 0 ? "free" : "paid";
}

function modelAllowedByCostPolicy(model, policy) {
  const priceClass = modelPriceClass(model);
  return policy === "free-only" ? priceClass === "free" : priceClass !== "unknown";
}

function costRank(model, preference) {
  const priceClass = modelPriceClass(model);
  if (preference === "paid-first") return priceClass === "paid" ? 0 : 1;
  return priceClass === "free" ? 0 : 1;
}

function qualifiedQualityScore(model, role) {
  const score = model.evidence?.status === "qualified" ? model.quality?.[role] : null;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function compareEligibleModels(left, right, role, preference) {
  const leftQuality = qualifiedQualityScore(left, role);
  const rightQuality = qualifiedQualityScore(right, role);
  if ((leftQuality !== null) !== (rightQuality !== null)) {
    return leftQuality !== null ? -1 : 1;
  }
  if (leftQuality !== null && rightQuality !== null && leftQuality !== rightQuality) {
    return rightQuality - leftQuality;
  }
  return (
    costRank(left, preference) - costRank(right, preference) ||
    right.roles[role] - left.roles[role] ||
    (left.modelId < right.modelId ? -1 : left.modelId > right.modelId ? 1 : 0)
  );
}

function modelDeclaresRole(model, role) {
  if (Array.isArray(model.roles)) return model.roles.includes(role);
  return Number.isInteger(model.roles?.[role]) && model.roles[role] > 0;
}

function modelMeetsRoleRequirements(model, role) {
  if (role === "orchestrator" && model.canOrchestrate !== true) return false;

  const modalities = Array.isArray(model.modalities)
    ? model.modalities
    : Array.isArray(model.modalities?.input)
      ? model.modalities.input
      : [];
  const access = Array.isArray(model.access) ? model.access : [];
  const needsWrite = role === "orchestrator" || role === "code-worker";

  if (!modalities.includes("text")) return false;
  if (role === "vision-worker" && !modalities.includes("image")) return false;
  if (access.length > 0 && !access.includes(needsWrite ? "write" : "read")) {
    return false;
  }
  return true;
}

function buildRouterPrompt(settings, specialists) {
  const availableSpecialists = [
    specialists["code-worker"] ? "@omc-code-worker for implementation" : null,
    specialists.reviewer ? "@omc-reviewer for independent review" : null,
  ].filter(Boolean);
  const delegationLine = availableSpecialists.length
    ? `Use ${availableSpecialists.join(" and ")}.`
    : "No text specialist is assigned; handle the text task directly.";
  const visionLine = specialists["vision-worker"]
    ? "You cannot inspect image, audio, or video attachments. Ask the user to invoke @omc-vision-worker and attach the media directly to that subagent; never claim transparent media handoff."
    : "You cannot inspect image, audio, or video attachments, and no vision specialist is assigned. State that limitation plainly.";

  const costLine = settings.costPolicy === "free-only"
    ? "The active policy permits verified-free models only. Never substitute a paid or unknown-cost model."
    : `The user explicitly allows known-cost models and prefers ${settings.costPreference === "paid-first" ? "paid" : "verified-free"} candidates for automatic assignments. Unknown-cost models remain blocked.`;

  return [
    "You are the text-only primary orchestrator for an OpenCode model team.",
    costLine,
    "Classify each text task, delegate only when a specialist has a clear advantage, and synthesize the final answer yourself.",
    "Before any nontrivial delegation, call model-control_route_task so the current local panel controls and live availability determine the permitted route.",
    "If the returned route is direct, stop routing and do not delegate. Otherwise delegate only to the returned eligible role.",
    delegationLine,
    visionLine,
    `Do not exceed ${settings.maxDelegationDepth} delegation level(s) or ${settings.maxFallbacksPerAssignment} fallback attempt(s) per assignment. These are prompt-level limits, not a stock OpenCode enforcement boundary.`,
    "Never recurse: specialists must not delegate, call router tools, or invoke the primary again.",
    "An MCP tool cannot retroactively choose the model for your first call. Never claim that this agent bundle performs pre-call routing.",
    "Treat model availability, pricing, and quality as volatile. If delegation fails, explain the failure and continue safely with the context you actually have.",
  ].join("\n\n");
}

function specialistTaskPermissions(specialists) {
  const permissions = { "*": "deny" };
  for (const role of ["code-worker", "vision-worker", "reviewer"]) {
    if (specialists[role]) permissions[`omc-${role}`] = "allow";
  }
  return permissions;
}

function specialistDescription(role, modelName) {
  const descriptions = {
    "code-worker": `Implementation specialist assigned to ${modelName}; routing quality is benchmark-dependent.`,
    reviewer: `Independent text review specialist assigned to ${modelName}; routing quality is benchmark-dependent.`,
    "vision-worker": `Multimodal-input analysis specialist assigned to ${modelName}; returns text only.`,
  };
  return descriptions[role];
}

function specialistPrompt(role) {
  const prompts = {
    "code-worker":
      "Handle the bounded implementation task you receive. Inspect relevant context, make the smallest complete change when authorized, test it, and report exact evidence and remaining uncertainty.",
    reviewer:
      "Review the supplied text or code independently. Prioritize correctness, security, regressions, and missing tests. Do not claim you ran checks that you did not run.",
    "vision-worker":
      "Analyze image, audio, or video input supplied directly to this subagent and return text. State when media is absent, unreadable, or ambiguous. Do not claim to generate or edit media.",
  };
  return prompts[role];
}

function assertSafeJsonValue(value, path, seen = new Set(), depth = 0) {
  if (depth > 50) throw new TypeError(`${path} exceeds the maximum depth`);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} must contain only JSON-compatible values`);
  }
  if (seen.has(value)) throw new TypeError(`${path} must not contain cycles`);
  seen.add(value);

  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new TypeError(`${path} must contain only plain objects and arrays`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${path} must not contain symbol keys`);
  }

  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (UNSAFE_KEYS.has(key)) {
      throw new TypeError(`${path} contains unsafe key ${key}`);
    }
    if (!("value" in descriptor)) {
      throw new TypeError(`${path}.${key} must not use a getter or setter`);
    }
    assertSafeJsonValue(descriptor.value, `${path}.${key}`, seen, depth + 1);
  }
  seen.delete(value);
}

function cloneJson(value) {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item));
  if (isPlainObject(value)) {
    const clone = {};
    for (const [key, item] of Object.entries(value)) clone[key] = cloneJson(item);
    return clone;
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
