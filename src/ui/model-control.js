const AVAILABLE_STATES = new Set(["available", "ready", "online", "active", "ok"]);

export const ROLE_DEFINITIONS = Object.freeze([
  { key: "orchestrator", label: "Primary orchestrator", hint: "Plans and delegates" },
  { key: "code-worker", label: "Code worker", hint: "Bounded implementation" },
  { key: "vision-worker", label: "Vision worker", hint: "Image understanding" },
  { key: "reviewer", label: "Reviewer", hint: "Independent review" },
]);

export function modelDisplayName(model) {
  if (typeof model?.label === "string" && model.label.trim()) {
    return model.label.trim();
  }
  if (typeof model?.displayName === "string" && model.displayName.trim()) {
    return model.displayName.trim();
  }

  const tail = typeof model?.id === "string" ? model.id.split("/").at(-1) : "Unknown model";
  return tail
    .split("-")
    .filter(Boolean)
    .map((part) => (/^v?\d/.test(part) ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
    .join(" ");
}

export function isModelAvailable(model) {
  if (typeof model?.available === "boolean") return model.available;
  if (typeof model?.status === "boolean") return model.status;
  if (typeof model?.status !== "string") return false;
  return AVAILABLE_STATES.has(model.status.toLowerCase());
}

export function isModelFree(model) {
  return modelCostClass(model) === "free";
}

export function modelCostClass(model) {
  if (typeof model?.free === "boolean") return model.free ? "free" : "unknown";
  if (!model?.free || typeof model.free !== "object" || model.free.verified !== true) {
    return "unknown";
  }
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

export function isModelCostAllowed(model, settings) {
  const priceClass = modelCostClass(model);
  return settings?.costPolicy === "known-cost"
    ? priceClass !== "unknown"
    : priceClass === "free";
}

export function modelInputModalities(model) {
  if (Array.isArray(model?.modalities)) return model.modalities.map(String);
  if (model?.modalities && typeof model.modalities === "object" && Array.isArray(model.modalities.input)) {
    return model.modalities.input.map(String);
  }
  if (Array.isArray(model?.inputModalities)) return model.inputModalities.map(String);
  return [];
}

export function modelRoles(model) {
  if (Array.isArray(model?.roles)) return model.roles.map(String);
  if (model?.roles && typeof model.roles === "object") {
    return Object.entries(model.roles)
      .filter(([, value]) => value !== false && value !== 0 && value != null)
      .map(([role]) => role);
  }
  if (Array.isArray(model?.capabilities)) return model.capabilities.map(String);
  return [];
}

export function modelAccess(model) {
  if (Array.isArray(model?.access)) return model.access.map(String);
  if (typeof model?.access === "string") return [model.access];
  return [];
}

export function evidenceMeta(evidence) {
  if (typeof evidence === "boolean") {
    return evidence
      ? { key: "provisional", label: "Unbenchmarked role", tone: "warning" }
      : { key: "unverified", label: "Evidence: unverified", tone: "neutral" };
  }
  const value =
    typeof evidence === "string"
      ? evidence
      : evidence && typeof evidence === "object"
        ? evidence.status ?? evidence.state ?? evidence.label
        : "unverified";
  const normalized = String(value ?? "unverified").toLowerCase();

  if (["qualified", "verified", "accepted", "promoted"].includes(normalized)) {
    return { key: "qualified", label: "Qualified evidence", tone: "positive" };
  }
  if (["provisional", "candidate", "shadow", "experimental"].includes(normalized)) {
    return { key: "provisional", label: "Unbenchmarked role", tone: "warning" };
  }
  if (["capability-only", "capability_verified", "capability-verified"].includes(normalized)) {
    return { key: "provisional", label: "Capability verified; benchmark pending", tone: "warning" };
  }
  return { key: "unverified", label: "Evidence: unverified", tone: "neutral" };
}

function normalizedRoleAssignment(value) {
  return typeof value === "string" && value.trim() ? value : "auto";
}

export function normalizeSettings(settings = {}, catalog = []) {
  const modelControls = {};
  for (const model of catalog) {
    const current = settings.modelControls?.[model.id];
    modelControls[model.id] = {
      enabled:
        typeof current?.enabled === "boolean"
          ? current.enabled
          : typeof model.enabled === "boolean"
            ? model.enabled
            : Boolean(model.enabledByDefault),
      available:
        typeof current?.available === "boolean" ? current.available : isModelAvailable(model),
    };
  }
  for (const [id, control] of Object.entries(settings.modelControls ?? {})) {
    if (!modelControls[id]) {
      modelControls[id] = {
        enabled: Boolean(control?.enabled),
        ...(typeof control?.available === "boolean" ? { available: control.available } : {}),
      };
    }
  }

  const roles = settings.roleAssignments ?? {};
  const orchestrator =
    typeof roles.orchestrator === "string"
      ? normalizedRoleAssignment(roles.orchestrator)
      : normalizedRoleAssignment(settings.primaryModel);

  return {
    ...settings,
    schemaVersion: 2,
    costPreference:
      settings.costPreference === "paid-first" || settings.freeOnly === false
        ? "paid-first"
        : "free-first",
    costPolicy:
      settings.costPolicy === "known-cost" || settings.freeOnly === false
        ? "known-cost"
        : "free-only",
    modelControls,
    roleAssignments: {
      orchestrator,
      "code-worker": normalizedRoleAssignment(roles["code-worker"] ?? roles.codeWorker),
      "vision-worker": normalizedRoleAssignment(roles["vision-worker"] ?? roles.visionWorker),
      reviewer: normalizedRoleAssignment(roles.reviewer),
    },
    maxDelegationDepth: clampInteger(settings.maxDelegationDepth, 1, 0, 1),
    maxFallbacksPerAssignment: clampInteger(settings.maxFallbacksPerAssignment, 1, 0, 1),
  };
}

export function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  const catalog = Array.isArray(state.catalog)
    ? state.catalog.filter((model) => model && typeof model.id === "string")
    : [];

  const system = state.system && typeof state.system === "object" ? state.system : {};

  return {
    ...state,
    system: {
      ...system,
      opencode: system.opencode ?? system.openCode,
    },
    catalog,
    settings: normalizeSettings(state.settings, catalog),
  };
}

export function settingsEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

export function settingsForApi(settings) {
  return {
    schemaVersion: 2,
    costPreference: settings.costPreference === "paid-first" ? "paid-first" : "free-first",
    costPolicy: settings.costPolicy === "known-cost" ? "known-cost" : "free-only",
    maxDelegationDepth: clampInteger(settings.maxDelegationDepth, 1, 0, 1),
    maxFallbacksPerAssignment: clampInteger(settings.maxFallbacksPerAssignment, 1, 0, 1),
    modelControls: Object.fromEntries(
      Object.entries(settings.modelControls ?? {}).map(([id, control]) => [
        id,
        {
          enabled: Boolean(control?.enabled),
          ...(typeof control?.available === "boolean" ? { available: control.available } : {}),
        },
      ]),
    ),
    roleAssignments: {
      orchestrator: normalizedRoleAssignment(settings.roleAssignments?.orchestrator),
      "code-worker": normalizedRoleAssignment(settings.roleAssignments?.["code-worker"]),
      "vision-worker": normalizedRoleAssignment(settings.roleAssignments?.["vision-worker"]),
      reviewer: normalizedRoleAssignment(settings.roleAssignments?.reviewer),
    },
  };
}

export function toggleEnabledModel(settings, modelId, enabled) {
  return {
    ...settings,
    modelControls: {
      ...settings.modelControls,
      [modelId]: {
        ...(settings.modelControls?.[modelId] ?? {}),
        enabled,
      },
    },
  };
}

export function setCostMode(settings, catalog, mode) {
  const paid = mode === "paid";
  const next = {
    ...settings,
    costPreference: paid ? "paid-first" : "free-first",
    costPolicy: paid ? "known-cost" : "free-only",
    modelControls: Object.fromEntries(
      Object.entries(settings.modelControls ?? {}).map(([modelId, control]) => {
        const model = catalog.find((entry) => entry.id === modelId);
        return [
          modelId,
          {
            ...control,
            enabled: !paid && model && modelCostClass(model) !== "free"
              ? false
              : Boolean(control?.enabled),
          },
        ];
      }),
    ),
  };
  if (!paid) {
    next.roleAssignments = Object.fromEntries(
      Object.entries(next.roleAssignments ?? {}).map(([role, modelId]) => {
        const model = catalog.find((entry) => entry.id === modelId);
        return [role, model && modelCostClass(model) !== "free" ? "auto" : modelId];
      }),
    );
  }
  return next;
}

export function catalogSummary(catalog, settings) {
  return catalog.reduce(
    (summary, model) => {
      summary.total += 1;
      if (isModelAvailable(model)) summary.available += 1;
      if (settings?.modelControls?.[model.id]?.enabled) summary.enabled += 1;
      const evidence = model.evidence ?? (model.provisional === true ? true : null);
      if (evidenceMeta(evidence).key === "provisional") {
        summary.unbenchmarked += 1;
      }
      return summary;
    },
    { total: 0, available: 0, enabled: 0, unbenchmarked: 0 },
  );
}

export function roleModelCompatible(model, role) {
  if (!modelRoles(model).includes(role)) return false;
  if (role === "orchestrator" && model?.canOrchestrate !== true) return false;
  const requiredAccess = role === "orchestrator" || role === "code-worker" ? "write" : "read";
  if (!modelAccess(model).includes(requiredAccess)) return false;
  const modalities = modelInputModalities(model).map((item) => item.toLowerCase());
  if (!modalities.includes("text")) return false;
  return role !== "vision-worker" || modalities.includes("image");
}

export function configText(response) {
  if (typeof response?.text === "string" && response.text.trim()) return response.text;
  if (response && "config" in response) return JSON.stringify(response.config, null, 2);
  return "";
}

export function routeModelId(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value.modelId ?? value.model ?? value.id ?? "";
}

export function routePlanView(result) {
  const assignments = Array.isArray(result?.assignments) ? result.assignments : [];
  if (assignments.length === 0) {
    return {
      primary: result?.primary ?? null,
      workers: Array.isArray(result?.workers) ? result.workers : [],
      fallbacks: Array.isArray(result?.fallback)
        ? result.fallback
        : result?.fallback
          ? [result.fallback]
          : [],
    };
  }

  const primaryAssignment =
    assignments.find((assignment) => assignment?.role === "orchestrator") ?? assignments[0];
  return {
    primary: primaryAssignment?.modelId ?? null,
    workers: assignments
      .filter((assignment) => assignment !== primaryAssignment)
      .map((assignment) => ({
        modelId: assignment.modelId,
        role: assignment.role,
      })),
    fallbacks: assignments
      .map((assignment) => assignment?.fallbackModelId)
      .filter((modelId) => typeof modelId === "string" && modelId.length > 0),
  };
}

export function roleLabel(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
