import {
  ACCESS_MODES,
  AUTO_ASSIGNMENT,
  COMPLEXITIES,
  CURRENT_PLAN_VERSION,
  MODALITIES,
  TASK_KINDS,
} from "./constants.js";
import {
  eligibleModelsForRole,
  loadModelCatalog,
} from "./catalog.js";
import { routerError } from "./errors.js";
import {
  createDefaultSettings,
  validateSettings,
} from "./settings.js";
import { isPlainObject } from "./utils.js";

function normalizeTask(value) {
  if (!isPlainObject(value)) throw routerError("INVALID_TASK", "Task metadata is required.");
  const kind = value.kind ?? "general";
  const complexity = value.complexity ?? "medium";
  const access = value.access ?? "read";
  const modalities = value.modalities ?? ["text"];
  const delegationDepth = value.delegationDepth ?? 0;
  if (!TASK_KINDS.includes(kind) || !COMPLEXITIES.includes(complexity)) {
    throw routerError("INVALID_TASK", "Task kind or complexity is unsupported.");
  }
  if (!ACCESS_MODES.includes(access)) {
    throw routerError("INVALID_TASK", "Task access mode is unsupported.");
  }
  if (
    !Array.isArray(modalities) ||
    modalities.length === 0 ||
    modalities.some((item) => !MODALITIES.includes(item))
  ) {
    throw routerError("INVALID_TASK", "Task modalities are unsupported.");
  }
  if (!Number.isInteger(delegationDepth) || delegationDepth < 0) {
    throw routerError("INVALID_TASK", "Task delegation depth is invalid.");
  }
  const modalitySet = new Set(modalities);
  return {
    kind,
    complexity,
    modalities: MODALITIES.filter((modality) => modalitySet.has(modality)),
    access,
    cohesive: value.cohesive === true,
    requiresReview: value.requiresReview === true,
    delegationDepth,
  };
}

function routeFor(task) {
  if (
    task.kind === "general" &&
    task.modalities.length === 1 &&
    task.modalities[0] === "text" &&
    !task.requiresReview
  ) {
    return "direct";
  }
  if (
    (task.kind === "general" || task.kind === "code") &&
    task.complexity === "small" &&
    task.cohesive &&
    task.modalities.length === 1 &&
    task.modalities[0] === "text" &&
    !task.requiresReview
  ) {
    return "direct";
  }
  if (task.requiresReview && task.kind !== "review") return "orchestrator";
  if (task.kind === "code" && task.modalities.some((item) => item !== "text")) {
    return "orchestrator";
  }
  if (task.kind === "code") return "code-worker";
  if (task.kind === "vision") return "vision-worker";
  if (task.kind === "review") return "reviewer";
  return "orchestrator";
}

function rolesFor(route, task) {
  if (route === "direct") return ["orchestrator"];
  if (route === "code-worker") return ["orchestrator", "code-worker"];
  if (route === "vision-worker") return ["orchestrator", "vision-worker"];
  if (route === "reviewer") return ["orchestrator", "reviewer"];

  const roles = ["orchestrator"];
  if (
    task.access === "write" ||
    task.kind === "code" ||
    task.kind === "mixed"
  ) {
    roles.push("code-worker");
  }
  if (task.modalities.some((item) => item !== "text")) roles.push("vision-worker");
  if (task.requiresReview) roles.push("reviewer");
  return roles;
}

function requirementsFor(role, route, task) {
  if (role === "orchestrator") return { modalities: ["text"], access: task.access };
  if (role === "code-worker") return { modalities: ["text"], access: "write" };
  if (role === "vision-worker") {
    return { modalities: task.modalities, access: task.access };
  }
  return {
    modalities: route === "reviewer" ? task.modalities : ["text"],
    access: "read",
  };
}

function assignmentFor({ role, route, task, catalog, settings }) {
  const requirements = requirementsFor(role, route, task);
  const candidates = eligibleModelsForRole({
    catalog,
    settings,
    role,
    modalities: requirements.modalities,
    access: requirements.access,
  });
  const configured = settings.roleAssignments[role];
  const selected =
    configured === AUTO_ASSIGNMENT
      ? candidates[0]
      : candidates.find((model) => model.id === configured);
  if (!selected) {
    const freeOnly = settings.costPolicy === "free-only";
    const code = configured === AUTO_ASSIGNMENT
      ? freeOnly
        ? "NO_ELIGIBLE_FREE_MODEL"
        : "NO_ELIGIBLE_MODEL"
      : "INVALID_ROLE_ASSIGNMENT";
    const qualifier = freeOnly ? "verified-free" : "known-cost";
    throw routerError(code, `No eligible ${qualifier} model can serve ${role}.`, {
      role,
    });
  }

  const allowFallback =
    route !== "direct" && settings.maxFallbacksPerAssignment === 1;
  const fallback = allowFallback
    ? candidates.find((model) => model.id !== selected.id) ?? null
    : null;
  return {
    role,
    modelId: selected.id,
    fallbackModelId: fallback?.id ?? null,
    fallbackCount: fallback ? 1 : 0,
    selection: configured === AUTO_ASSIGNMENT ? "auto" : "explicit",
    access: requirements.access,
    modalities: requirements.modalities,
    mayDelegate: role === "orchestrator" && route !== "direct",
  };
}

function routeReason(route, task) {
  if (route === "direct") {
    return task.complexity === "small" && task.cohesive
      ? "small-cohesive-task"
      : "primary-only-task";
  }
  return {
    orchestrator: "multiple-specialist-capabilities",
    "code-worker": "bounded-code-capability",
    "vision-worker": "non-text-input-capability",
    reviewer: "independent-read-only-review",
  }[route];
}

export function planRoute({
  task,
  catalog = loadModelCatalog(),
  settings = createDefaultSettings(catalog),
} = {}) {
  const normalizedTask = normalizeTask(task);
  if (normalizedTask.delegationDepth > 0) {
    throw routerError(
      "RECURSIVE_DELEGATION_BLOCKED",
      "Only the root orchestrator may create delegated work.",
    );
  }
  const normalizedSettings = validateSettings(settings, catalog);
  const route = routeFor(normalizedTask);
  if (route !== "direct" && normalizedSettings.maxDelegationDepth === 0) {
    throw routerError("DELEGATION_DISABLED", "Delegation is disabled by settings.");
  }
  const roles = rolesFor(route, normalizedTask);
  const assignments = roles.map((role) =>
    assignmentFor({
      role,
      route,
      task: normalizedTask,
      catalog,
      settings: normalizedSettings,
    }),
  );

  return {
    schemaVersion: CURRENT_PLAN_VERSION,
    route,
    assignments,
    policy: {
      freeOnly: normalizedSettings.costPolicy === "free-only",
      costPreference: normalizedSettings.costPreference,
      costPolicy: normalizedSettings.costPolicy,
      maxDelegationDepth: normalizedSettings.maxDelegationDepth,
      maxFallbacksPerAssignment:
        normalizedSettings.maxFallbacksPerAssignment,
      recursiveDelegation: false,
    },
    reasons: [routeReason(route, normalizedTask)],
  };
}
