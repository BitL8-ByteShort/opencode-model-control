import {
  AUTO_ASSIGNMENT,
  COST_POLICIES,
  COST_PREFERENCES,
  CURRENT_SETTINGS_VERSION,
  MODEL_ROLES,
  ROLE_REQUIREMENTS,
} from "./constants.js";
import {
  eligibleModelsForRole,
  loadModelCatalog,
  validateCatalog,
} from "./catalog.js";
import { routerError } from "./errors.js";
import { deepFreeze, isPlainObject, jsonClone } from "./utils.js";

const DEFAULT_ROLE_ASSIGNMENTS = Object.freeze({
  orchestrator: "opencode/big-pickle",
  "code-worker": AUTO_ASSIGNMENT,
  "vision-worker": "opencode/mimo-v2.5-free",
  reviewer: AUTO_ASSIGNMENT,
});
const DEFAULT_COST_PREFERENCE = "free-first";
const DEFAULT_COST_POLICY = "free-only";

function invalidSettings(message, code = "INVALID_SETTINGS") {
  throw routerError(code, message);
}

function normalizeModelControls(value, catalog) {
  if (value !== undefined && !isPlainObject(value)) {
    invalidSettings("modelControls must be an object.");
  }
  const supplied = value ?? {};
  const catalogIds = new Set(catalog.models.map((model) => model.id));
  for (const modelId of Object.keys(supplied)) {
    if (!catalogIds.has(modelId)) {
      invalidSettings("Settings contain an unknown model.", "UNKNOWN_MODEL");
    }
  }

  return Object.fromEntries(
    catalog.models.map((model) => {
      const control = supplied[model.id];
      if (control !== undefined && !isPlainObject(control)) {
        invalidSettings(`Model control for ${model.id} is invalid.`);
      }
      if (control !== undefined) {
        for (const key of Object.keys(control)) {
          if (key !== "enabled" && key !== "available") {
            invalidSettings(`Model control for ${model.id} has an unknown field.`);
          }
        }
        for (const key of ["enabled", "available"]) {
          if (Object.hasOwn(control, key) && typeof control[key] !== "boolean") {
            invalidSettings(`Model control for ${model.id} has an invalid ${key} value.`);
          }
        }
      }
      const enabled =
        typeof control?.enabled === "boolean"
          ? control.enabled
          : model.enabledByDefault;
      const available =
        typeof control?.available === "boolean" ? control.available : model.available;
      return [model.id, { enabled, available }];
    }),
  );
}

function defaultRoleAssignmentsForCatalog(catalog) {
  const catalogIds = new Set(catalog.models.map((model) => model.id));
  return Object.fromEntries(
    MODEL_ROLES.map((role) => {
      const preferred = DEFAULT_ROLE_ASSIGNMENTS[role];
      return [
        role,
        preferred !== AUTO_ASSIGNMENT && !catalogIds.has(preferred)
          ? AUTO_ASSIGNMENT
          : preferred,
      ];
    }),
  );
}

function normalizeRoleAssignments(value, catalog) {
  if (value !== undefined && !isPlainObject(value)) {
    invalidSettings("roleAssignments must be an object.");
  }
  const supplied = value ?? {};
  const defaults = defaultRoleAssignmentsForCatalog(catalog);
  const catalogIds = new Set(catalog.models.map((model) => model.id));
  for (const role of Object.keys(supplied)) {
    if (!MODEL_ROLES.includes(role)) invalidSettings("Settings contain an unknown role.");
  }

  return Object.fromEntries(
    MODEL_ROLES.map((role) => {
      const assignment = Object.hasOwn(supplied, role)
        ? supplied[role]
        : defaults[role];
      if (typeof assignment !== "string") {
        invalidSettings(`Role assignment for ${role} is invalid.`);
      }
      if (
        assignment !== AUTO_ASSIGNMENT &&
        !catalogIds.has(assignment)
      ) {
        invalidSettings(`Role assignment for ${role} is invalid.`, "UNKNOWN_MODEL");
      }
      return [role, assignment];
    }),
  );
}

function assertExplicitAssignments(settings, catalog) {
  for (const role of MODEL_ROLES) {
    const modelId = settings.roleAssignments[role];
    if (modelId === AUTO_ASSIGNMENT) continue;
    const requirement = ROLE_REQUIREMENTS[role];
    const eligible = eligibleModelsForRole({
      catalog,
      settings,
      role,
      modalities: [...requirement.modalities],
      access: requirement.access,
    });
    if (!eligible.some((model) => model.id === modelId)) {
      invalidSettings(
        `The explicit ${role} assignment is not currently eligible.`,
        "INVALID_ROLE_ASSIGNMENT",
      );
    }
  }
}

export function validateSettings(value, catalog = loadModelCatalog()) {
  const normalizedCatalog = validateCatalog(catalog);
  if (!isPlainObject(value) || value.schemaVersion !== CURRENT_SETTINGS_VERSION) {
    invalidSettings("Settings schema version is unsupported.");
  }
  if (!COST_PREFERENCES.includes(value.costPreference)) {
    invalidSettings("costPreference is unsupported.");
  }
  if (!COST_POLICIES.includes(value.costPolicy)) {
    invalidSettings("costPolicy is unsupported.");
  }
  if (
    !Number.isInteger(value.maxDelegationDepth) ||
    value.maxDelegationDepth < 0 ||
    value.maxDelegationDepth > 1
  ) {
    invalidSettings("maxDelegationDepth must be zero or one.");
  }
  if (
    !Number.isInteger(value.maxFallbacksPerAssignment) ||
    value.maxFallbacksPerAssignment < 0 ||
    value.maxFallbacksPerAssignment > 1
  ) {
    invalidSettings("maxFallbacksPerAssignment must be zero or one.");
  }
  if (
    value.makeRouterDefault !== undefined &&
    typeof value.makeRouterDefault !== "boolean"
  ) {
    invalidSettings("makeRouterDefault must be true or false.");
  }

  const settings = {
    schemaVersion: CURRENT_SETTINGS_VERSION,
    costPreference: value.costPreference,
    costPolicy: value.costPolicy,
    roleAssignments: normalizeRoleAssignments(
      value.roleAssignments,
      normalizedCatalog,
    ),
    maxDelegationDepth: value.maxDelegationDepth,
    maxFallbacksPerAssignment: value.maxFallbacksPerAssignment,
    makeRouterDefault: value.makeRouterDefault ?? true,
    modelControls: normalizeModelControls(value.modelControls, normalizedCatalog),
  };
  assertExplicitAssignments(settings, normalizedCatalog);
  return settings;
}

export function createDefaultSettings(catalog = loadModelCatalog()) {
  const normalizedCatalog = validateCatalog(catalog);
  const settings = {
    schemaVersion: CURRENT_SETTINGS_VERSION,
    costPreference: DEFAULT_COST_PREFERENCE,
    costPolicy: DEFAULT_COST_POLICY,
    roleAssignments: defaultRoleAssignmentsForCatalog(normalizedCatalog),
    maxDelegationDepth: 1,
    maxFallbacksPerAssignment: 1,
    makeRouterDefault: true,
    modelControls: Object.fromEntries(
      normalizedCatalog.models.map((model) => [
        model.id,
        {
          enabled: model.enabledByDefault,
          available: model.available,
        },
      ]),
    ),
  };

  for (const role of MODEL_ROLES) {
    const modelId = settings.roleAssignments[role];
    if (modelId === AUTO_ASSIGNMENT) continue;
    const requirement = ROLE_REQUIREMENTS[role];
    const eligible = eligibleModelsForRole({
      catalog: normalizedCatalog,
      settings,
      role,
      modalities: [...requirement.modalities],
      access: requirement.access,
    });
    if (!eligible.some((model) => model.id === modelId)) {
      settings.roleAssignments[role] = AUTO_ASSIGNMENT;
    }
  }

  return validateSettings(settings, normalizedCatalog);
}

function legacyRoleAssignments(value, catalog) {
  const assignments = defaultRoleAssignmentsForCatalog(catalog);
  const explicit = new Set();
  const primary = value.primary ?? value.orchestratorModel ?? value.primaryModel;
  if (typeof primary === "string") {
    assignments.orchestrator = primary;
    explicit.add("orchestrator");
  }
  const current = isPlainObject(value.roleAssignments) ? value.roleAssignments : {};
  const legacy = isPlainObject(value.roles) ? value.roles : {};
  const candidates = {
    orchestrator: current.orchestrator,
    "code-worker": current["code-worker"] ?? current.codeWorker ?? legacy.code,
    "vision-worker": current["vision-worker"] ?? current.visionWorker ?? legacy.vision,
    reviewer: current.reviewer ?? legacy.review,
  };
  for (const [role, assignment] of Object.entries(candidates)) {
    if (typeof assignment === "string") {
      assignments[role] = assignment || AUTO_ASSIGNMENT;
      explicit.add(role);
    }
  }
  return { assignments, explicit };
}

export function migrateSettings(value, catalog = loadModelCatalog()) {
  const normalizedCatalog = validateCatalog(catalog);
  if (value === undefined || value === null) return createDefaultSettings(normalizedCatalog);
  if (!isPlainObject(value)) invalidSettings("Settings must be an object.");

  if (value.schemaVersion === CURRENT_SETTINGS_VERSION) {
    return validateSettings(value, normalizedCatalog);
  }
  if (
    value.schemaVersion !== undefined &&
    value.schemaVersion !== 0 &&
    value.schemaVersion !== 1
  ) {
    invalidSettings(
      "Settings were created by an unsupported future version.",
      "UNSUPPORTED_SETTINGS_VERSION",
    );
  }
  if (value.allowPaid === true || value.freeOnly === false) {
    invalidSettings(
      "Legacy settings request an ambiguous cost mode; choose an explicit v2 cost policy.",
    );
  }

  const defaults = createDefaultSettings(normalizedCatalog);
  const { assignments, explicit } = legacyRoleAssignments(value, normalizedCatalog);
  const enabledSet = Array.isArray(value.enabledModels)
    ? new Set(value.enabledModels)
    : null;
  const unavailableSet = new Set(
    Array.isArray(value.unavailableModels) ? value.unavailableModels : [],
  );
  const catalogIds = new Set(normalizedCatalog.models.map((model) => model.id));
  for (const modelId of [...(enabledSet ?? []), ...unavailableSet]) {
    if (!catalogIds.has(modelId)) {
      invalidSettings("Legacy settings contain an unknown model.", "UNKNOWN_MODEL");
    }
  }

  const controls = Object.fromEntries(
    normalizedCatalog.models.map((model) => {
      const current = isPlainObject(value.modelControls?.[model.id])
        ? value.modelControls[model.id]
        : {};
      return [
        model.id,
        {
          enabled:
            typeof current.enabled === "boolean"
              ? current.enabled
              : enabledSet
                ? enabledSet.has(model.id)
                : defaults.modelControls[model.id].enabled,
          available:
            typeof current.available === "boolean"
              ? current.available
              : !unavailableSet.has(model.id) &&
                defaults.modelControls[model.id].available,
        },
      ];
    }),
  );

  for (const role of MODEL_ROLES) {
    const modelId = assignments[role];
    const control = controls[modelId];
    if (
      !explicit.has(role) &&
      modelId !== AUTO_ASSIGNMENT &&
      (!control || !control.enabled || !control.available)
    ) {
      assignments[role] = AUTO_ASSIGNMENT;
    }
  }

  return validateSettings(
    {
      schemaVersion: CURRENT_SETTINGS_VERSION,
      costPreference: DEFAULT_COST_PREFERENCE,
      costPolicy: DEFAULT_COST_POLICY,
      roleAssignments: assignments,
      maxDelegationDepth:
        Number.isInteger(value.maxDelegationDepth) ? value.maxDelegationDepth : 1,
      maxFallbacksPerAssignment:
        Number.isInteger(value.maxFallbacksPerAssignment)
          ? value.maxFallbacksPerAssignment
          : 1,
      makeRouterDefault:
        typeof value.makeRouterDefault === "boolean"
          ? value.makeRouterDefault
          : true,
      modelControls: controls,
    },
    normalizedCatalog,
  );
}

export const DEFAULT_SETTINGS = deepFreeze(createDefaultSettings());

export function cloneDefaultSettings() {
  return jsonClone(DEFAULT_SETTINGS);
}
