import {
  AUTO_ASSIGNMENT,
  COST_POLICIES,
  COST_PREFERENCES,
  CURRENT_SETTINGS_VERSION,
  MODEL_ROLES,
  PAID_ELIGIBILITY,
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

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9@~][a-z0-9._:+/@~-]*$/i;

function normalizeModelControls(value) {
  if (value !== undefined && !isPlainObject(value))
    invalidSettings("modelControls must be an object.");
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([id, control]) => {
      if (id.length > 512 || !MODEL_ID_PATTERN.test(id))
        invalidSettings("Invalid model identity.", "UNKNOWN_MODEL");
      if (
        !isPlainObject(control) ||
        Object.keys(control).some(
          (key) => !["selection", "enabled", "available"].includes(key),
        )
      )
        invalidSettings("Invalid model control.");
      for (const key of ["enabled", "available"]) {
        if (Object.hasOwn(control, key) && typeof control[key] !== "boolean")
          invalidSettings("Invalid model control flag.");
      }
      if (
        control.selection !== undefined &&
        !["policy", "enabled", "disabled"].includes(control.selection)
      )
        invalidSettings("Invalid model selection.");
      // Boolean inputs are accepted for older clients, and become explicit intent.
      const selection =
        typeof control.enabled === "boolean"
          ? control.enabled
            ? "enabled"
            : "disabled"
          : (control.selection ?? "policy");
      return [
        id,
        {
          selection,
          ...(control.available !== undefined
            ? { available: control.available }
            : {}),
        },
      ];
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

function emptyRoleConnections() {
  return Object.fromEntries(MODEL_ROLES.map((role) => [role, null]));
}

function normalizeRoleConnections(value) {
  if (value !== undefined && !isPlainObject(value))
    invalidSettings("roleConnections must be an object.");
  const supplied = value ?? {};
  for (const role of Object.keys(supplied)) {
    if (!MODEL_ROLES.includes(role))
      invalidSettings("Settings contain an unknown role.");
  }
  return Object.fromEntries(
    MODEL_ROLES.map((role) => {
      const binding = Object.hasOwn(supplied, role) ? supplied[role] : null;
      if (binding === null || binding === undefined) return [role, null];
      if (
        !isPlainObject(binding) ||
        typeof binding.connectionId !== "string" ||
        !/^[a-f0-9]{32}$/.test(binding.connectionId) ||
        typeof binding.bindingRevision !== "string" ||
        !/^[a-f0-9]{32}$/.test(binding.bindingRevision)
      )
        invalidSettings(`Role connection for ${role} is invalid.`);
      return [
        role,
        {
          connectionId: binding.connectionId,
          bindingRevision: binding.bindingRevision,
        },
      ];
    }),
  );
}

function normalizeBillingDeclarations(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value))
    invalidSettings("billingDeclarations must be an object.");
  return Object.fromEntries(
    Object.entries(value).map(([connectionId, declaration]) => {
      if (!/^[a-f0-9]{32}$/.test(connectionId))
        invalidSettings("Billing declaration identity is invalid.");
      if (
        !isPlainObject(declaration) ||
        !["subscription", "metered-api", "prepaid", "local", "free", "unknown"].includes(
          declaration.kind,
        ) ||
        typeof declaration.bindingRevision !== "string" ||
        !/^[a-f0-9]{32}$/.test(declaration.bindingRevision) ||
        (declaration.declaredAt !== undefined &&
          (typeof declaration.declaredAt !== "string" ||
            !Number.isFinite(Date.parse(declaration.declaredAt))))
      )
        invalidSettings("Billing declaration is invalid.");
      return [
        connectionId,
        {
          kind: declaration.kind,
          bindingRevision: declaration.bindingRevision,
          source: "user-declared",
          ...(declaration.declaredAt ? { declaredAt: declaration.declaredAt } : {}),
        },
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
  for (const role of Object.keys(supplied)) {
    if (!MODEL_ROLES.includes(role))
      invalidSettings("Settings contain an unknown role.");
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
        (assignment.length > 512 || !MODEL_ID_PATTERN.test(assignment))
      ) {
        invalidSettings(
          `Role assignment for ${role} is invalid.`,
          "UNKNOWN_MODEL",
        );
      }
      return [role, assignment];
    }),
  );
}

export function assertExplicitAssignments(
  settings,
  catalog,
  roles = MODEL_ROLES,
) {
  for (const role of roles) {
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
  if (
    !isPlainObject(value) ||
    value.schemaVersion !== CURRENT_SETTINGS_VERSION
  ) {
    invalidSettings("Settings schema version is unsupported.");
  }
  if (!COST_PREFERENCES.includes(value.costPreference)) {
    invalidSettings("costPreference is unsupported.");
  }
  if (!COST_POLICIES.includes(value.costPolicy)) {
    invalidSettings("costPolicy is unsupported.");
  }
  if (!PAID_ELIGIBILITY.includes(value.paidEligibility)) {
    invalidSettings("paidEligibility is unsupported.");
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

  if (
    value.autoIncludeNewModels !== undefined &&
    typeof value.autoIncludeNewModels !== "boolean"
  )
    invalidSettings("autoIncludeNewModels must be true or false.");
  const settings = {
    schemaVersion: CURRENT_SETTINGS_VERSION,
    autoIncludeNewModels: value.autoIncludeNewModels ?? true,
    costPreference: value.costPreference,
    costPolicy: value.costPolicy,
    paidEligibility: value.paidEligibility,
    roleAssignments: normalizeRoleAssignments(
      value.roleAssignments,
      normalizedCatalog,
    ),
    roleConnections: normalizeRoleConnections(value.roleConnections),
    billingDeclarations: normalizeBillingDeclarations(value.billingDeclarations),
    maxDelegationDepth: value.maxDelegationDepth,
    maxFallbacksPerAssignment: value.maxFallbacksPerAssignment,
    makeRouterDefault: value.makeRouterDefault ?? true,
    modelControls: normalizeModelControls(
      value.modelControls,
      normalizedCatalog,
    ),
  };
  return settings;
}

export function createDefaultSettings(catalog = loadModelCatalog()) {
  const normalizedCatalog = validateCatalog(catalog);
  const settings = {
    schemaVersion: CURRENT_SETTINGS_VERSION,
    costPreference: DEFAULT_COST_PREFERENCE,
    costPolicy: DEFAULT_COST_POLICY,
    paidEligibility: "verified-pricing",
    roleAssignments: defaultRoleAssignmentsForCatalog(normalizedCatalog),
    roleConnections: emptyRoleConnections(),
    billingDeclarations: {},
    maxDelegationDepth: 1,
    maxFallbacksPerAssignment: 1,
    makeRouterDefault: true,
    autoIncludeNewModels: true,
    modelControls: Object.fromEntries(
      normalizedCatalog.models.map((model) => [
        model.id,
        { selection: "policy" },
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
  const primary =
    value.primary ?? value.orchestratorModel ?? value.primaryModel;
  if (typeof primary === "string") {
    assignments.orchestrator = primary;
    explicit.add("orchestrator");
  }
  const current = isPlainObject(value.roleAssignments)
    ? value.roleAssignments
    : {};
  const legacy = isPlainObject(value.roles) ? value.roles : {};
  const candidates = {
    orchestrator: current.orchestrator,
    "code-worker": current["code-worker"] ?? current.codeWorker ?? legacy.code,
    "vision-worker":
      current["vision-worker"] ?? current.visionWorker ?? legacy.vision,
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
  if (value === undefined || value === null)
    return createDefaultSettings(normalizedCatalog);
  if (!isPlainObject(value)) invalidSettings("Settings must be an object.");

  if (value.schemaVersion === CURRENT_SETTINGS_VERSION) {
    return validateSettings(value, normalizedCatalog);
  }
  if (value.schemaVersion === 3) {
    return validateSettings(upgradeV3ToV4(value), normalizedCatalog);
  }
  if (
    value.schemaVersion !== undefined &&
    value.schemaVersion !== 0 &&
    value.schemaVersion !== 1 &&
    value.schemaVersion !== 2
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

  const { assignments } = legacyRoleAssignments(value, normalizedCatalog);
  const controls = { ...(value.modelControls ?? {}) };
  const enabledSet = Array.isArray(value.enabledModels)
    ? new Set(value.enabledModels)
    : null;
  const unavailable = new Set(value.unavailableModels ?? []);
  if (enabledSet) {
    for (const id of new Set([
      ...normalizedCatalog.models.map((model) => model.id),
      ...enabledSet,
    ])) {
      controls[id] = {
        ...controls[id],
        enabled: controls[id]?.enabled ?? enabledSet.has(id),
      };
    }
  }
  for (const id of unavailable)
    controls[id] = { ...controls[id], available: false };

  return validateSettings(
    upgradeV3ToV4({
      schemaVersion: 3,
      costPreference: value.costPreference ?? DEFAULT_COST_PREFERENCE,
      costPolicy: value.costPolicy ?? DEFAULT_COST_POLICY,
      autoIncludeNewModels: true,
      roleAssignments: assignments,
      maxDelegationDepth: Number.isInteger(value.maxDelegationDepth)
        ? value.maxDelegationDepth
        : 1,
      maxFallbacksPerAssignment: Number.isInteger(
        value.maxFallbacksPerAssignment,
      )
        ? value.maxFallbacksPerAssignment
        : 1,
      makeRouterDefault:
        typeof value.makeRouterDefault === "boolean"
          ? value.makeRouterDefault
          : true,
      modelControls: controls,
    }),
    normalizedCatalog,
  );
}

function upgradeV3ToV4(value) {
  return {
    ...value,
    schemaVersion: CURRENT_SETTINGS_VERSION,
    paidEligibility: "verified-pricing",
    roleConnections: emptyRoleConnections(),
    billingDeclarations: {},
  };
}

export const DEFAULT_SETTINGS = deepFreeze(createDefaultSettings());

export function cloneDefaultSettings() {
  return jsonClone(DEFAULT_SETTINGS);
}
