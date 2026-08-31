import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ACCESS_MODES,
  COST_PREFERENCES,
  CURRENT_CATALOG_VERSION,
  KNOWN_MODEL_IDS,
  MODALITIES,
  MODEL_ROLES,
} from "./constants.js";
import { routerError } from "./errors.js";
import { isPlainObject, uniqueStrings } from "./utils.js";

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:+/-]*$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CATALOG_STATUSES = Object.freeze(["active", "provisional"]);
const EVIDENCE_STATUSES = Object.freeze([
  "qualified",
  "candidate",
  "capability-only",
  "provisional",
  "unverified",
]);

export const DEFAULT_CATALOG_PATH = fileURLToPath(
  new URL("../../data/model-catalog.json", import.meta.url),
);

function invalidCatalog(message) {
  throw routerError("INVALID_CATALOG", message);
}

function normalizeFreeMetadata(value, modelId) {
  if (!isPlainObject(value)) invalidCatalog(`Model ${modelId} has invalid free metadata.`);
  const input = value.inputUsdPerMillion ?? null;
  const output = value.outputUsdPerMillion ?? null;
  const verifiedAt = value.verifiedAt ?? null;
  const nullablePriceIsValid = (price) =>
    price === null ||
    (typeof price === "number" && Number.isFinite(price) && price >= 0);
  if (
    typeof value.verified !== "boolean" ||
    !nullablePriceIsValid(input) ||
    !nullablePriceIsValid(output) ||
    (verifiedAt !== null &&
      (typeof verifiedAt !== "string" || !DATE_PATTERN.test(verifiedAt))) ||
    (value.verified === true &&
      (typeof input !== "number" ||
        typeof output !== "number" ||
        typeof verifiedAt !== "string"))
  ) {
    invalidCatalog(`Model ${modelId} has invalid free metadata.`);
  }
  return {
    verified: value.verified,
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    verifiedAt,
  };
}

function normalizeOptionalString(value, field, modelId) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    invalidCatalog(`Model ${modelId} has invalid ${field} metadata.`);
  }
  return value.trim();
}

function normalizeEvidence(value, modelId) {
  if (value === undefined) return undefined;
  if (!isPlainObject(value) || !EVIDENCE_STATUSES.includes(value.status)) {
    invalidCatalog(`Model ${modelId} has invalid evidence metadata.`);
  }
  const source = normalizeOptionalString(value.source, "evidence source", modelId);
  const verifiedAt = value.verifiedAt;
  if (
    verifiedAt !== undefined &&
    verifiedAt !== null &&
    (typeof verifiedAt !== "string" || !DATE_PATTERN.test(verifiedAt))
  ) {
    invalidCatalog(`Model ${modelId} has invalid evidence metadata.`);
  }
  return {
    status: value.status,
    ...(source === undefined ? {} : { source }),
    ...(verifiedAt === undefined ? {} : { verifiedAt }),
  };
}

function normalizeQuality(value, modelId) {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    invalidCatalog(`Model ${modelId} has invalid quality metadata.`);
  }
  const quality = {};
  for (const [role, score] of Object.entries(value)) {
    if (
      !MODEL_ROLES.includes(role) ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      invalidCatalog(`Model ${modelId} has invalid quality metadata.`);
    }
    quality[role] = score;
  }
  return quality;
}

function normalizeModel(value) {
  if (!isPlainObject(value)) invalidCatalog("Every catalog model must be an object.");
  const id = value.id;
  if (typeof id !== "string" || !MODEL_ID_PATTERN.test(id)) {
    invalidCatalog("A catalog model has an invalid ID.");
  }
  if (typeof value.label !== "string" || !value.label.trim()) {
    invalidCatalog(`Model ${id} has an invalid label.`);
  }
  if (!CATALOG_STATUSES.includes(value.status)) {
    invalidCatalog(`Model ${id} has an invalid status.`);
  }
  if (
    typeof value.provisional !== "boolean" ||
    typeof value.enabledByDefault !== "boolean" ||
    typeof value.available !== "boolean" ||
    typeof value.canOrchestrate !== "boolean" ||
    (value.contextWindowTokens !== null &&
      (!Number.isInteger(value.contextWindowTokens) ||
        value.contextWindowTokens <= 0)) ||
    (value.toolCall !== undefined && typeof value.toolCall !== "boolean") ||
    (value.discovered !== undefined && typeof value.discovered !== "boolean") ||
    (value.runtimeVerified !== undefined && typeof value.runtimeVerified !== "boolean")
  ) {
    invalidCatalog(`Model ${id} has invalid control metadata.`);
  }
  if (!isPlainObject(value.modalities)) {
    invalidCatalog(`Model ${id} has invalid modality metadata.`);
  }
  const input = uniqueStrings(value.modalities.input, MODALITIES);
  const output = uniqueStrings(value.modalities.output, MODALITIES);
  const access = uniqueStrings(value.access, ACCESS_MODES);
  if (!input || !output || !access) {
    invalidCatalog(`Model ${id} has incompatible modality or access metadata.`);
  }
  if (!isPlainObject(value.roles)) {
    invalidCatalog(`Model ${id} has invalid role assignments.`);
  }
  const roles = {};
  for (const [role, priority] of Object.entries(value.roles)) {
    if (
      !MODEL_ROLES.includes(role) ||
      !Number.isInteger(priority) ||
      priority < 0 ||
      priority > 100
    ) {
      invalidCatalog(`Model ${id} has invalid role metadata.`);
    }
    roles[role] = priority;
  }
  if (roles.orchestrator !== undefined && !value.canOrchestrate) {
    invalidCatalog(`Model ${id} cannot hold its declared orchestrator role.`);
  }
  if (roles["vision-worker"] !== undefined && !input.includes("image")) {
    invalidCatalog(`Model ${id} cannot hold its declared vision role.`);
  }
  if (roles["code-worker"] !== undefined && !access.includes("write")) {
    invalidCatalog(`Model ${id} cannot hold its declared code role.`);
  }

  const provider = normalizeOptionalString(value.provider, "provider", id);
  const profileSource = normalizeOptionalString(
    value.profileSource,
    "profile source",
    id,
  );
  const evidence = normalizeEvidence(value.evidence, id);
  const quality = normalizeQuality(value.quality, id);

  return {
    id,
    label: value.label.trim(),
    status: value.status,
    provisional: value.provisional,
    enabledByDefault: value.enabledByDefault,
    available: value.available,
    contextWindowTokens: value.contextWindowTokens,
    free: normalizeFreeMetadata(value.free, id),
    modalities: { input, output },
    access,
    canOrchestrate: value.canOrchestrate,
    roles,
    ...(value.toolCall === undefined ? {} : { toolCall: value.toolCall }),
    ...(provider === undefined ? {} : { provider }),
    ...(profileSource === undefined ? {} : { profileSource }),
    ...(value.discovered === undefined ? {} : { discovered: value.discovered }),
    ...(value.runtimeVerified === undefined
      ? {}
      : { runtimeVerified: value.runtimeVerified }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(quality === undefined ? {} : { quality }),
  };
}

function compareStableIds(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareCatalogOrder(left, right) {
  const leftCurated = KNOWN_MODEL_IDS.indexOf(left.id);
  const rightCurated = KNOWN_MODEL_IDS.indexOf(right.id);
  if (leftCurated !== -1 || rightCurated !== -1) {
    if (leftCurated === -1) return 1;
    if (rightCurated === -1) return -1;
    return leftCurated - rightCurated;
  }
  return compareStableIds(left, right);
}

export function validateCatalog(value) {
  if (!isPlainObject(value) || value.schemaVersion !== CURRENT_CATALOG_VERSION) {
    invalidCatalog("Catalog schema version is unsupported.");
  }
  if (typeof value.snapshotDate !== "string" || !DATE_PATTERN.test(value.snapshotDate)) {
    invalidCatalog("Catalog snapshot date is invalid.");
  }
  if (!Array.isArray(value.models)) invalidCatalog("Catalog models must be an array.");

  const models = value.models.map(normalizeModel);
  const ids = models.map((model) => model.id);
  if (new Set(ids).size !== ids.length) invalidCatalog("Catalog model IDs must be unique.");
  models.sort(compareCatalogOrder);

  return {
    schemaVersion: CURRENT_CATALOG_VERSION,
    snapshotDate: value.snapshotDate,
    models,
  };
}

export function mergeLiveAvailability(catalog, liveAvailability) {
  const normalized = validateCatalog(catalog);
  if (liveAvailability === undefined) return normalized;
  if (!isPlainObject(liveAvailability)) {
    throw routerError("INVALID_AVAILABILITY", "Live availability must be an object.");
  }

  return {
    ...normalized,
    models: normalized.models.map((model) => {
      const live = liveAvailability[model.id];
      const validLive = isPlainObject(live);
      return {
        ...model,
        available: validLive && live.available === true,
        enabledByDefault:
          validLive && typeof live.enabled === "boolean"
            ? live.enabled
            : model.enabledByDefault,
      };
    }),
  };
}

export function loadModelCatalog({
  catalogPath = DEFAULT_CATALOG_PATH,
  liveAvailability,
} = {}) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch {
    throw routerError("CATALOG_UNAVAILABLE", "The model catalog could not be loaded.");
  }
  return mergeLiveAvailability(validateCatalog(parsed), liveAvailability);
}

export function isVerifiedFree(model) {
  return classifyModelPricing(model) === "free";
}

export function classifyModelPricing(model) {
  const pricing = model?.free;
  if (
    pricing?.verified !== true ||
    typeof pricing.inputUsdPerMillion !== "number" ||
    !Number.isFinite(pricing.inputUsdPerMillion) ||
    pricing.inputUsdPerMillion < 0 ||
    typeof pricing.outputUsdPerMillion !== "number" ||
    !Number.isFinite(pricing.outputUsdPerMillion) ||
    pricing.outputUsdPerMillion < 0
  ) {
    return "unknown";
  }
  return pricing.inputUsdPerMillion === 0 &&
    pricing.outputUsdPerMillion === 0
    ? "free"
    : "paid";
}

export function modelSupports({ model, role, modalities, access }) {
  if (!MODEL_ROLES.includes(role) || model?.roles?.[role] === undefined) return false;
  if (role === "orchestrator" && model.canOrchestrate !== true) return false;
  if (
    (role === "orchestrator" || role === "code-worker") &&
    model.toolCall === false
  ) {
    return false;
  }
  if (!model.access?.includes(access)) return false;
  if (!modalities.every((modality) => model.modalities?.input?.includes(modality))) {
    return false;
  }
  return model.modalities?.output?.includes("text") === true;
}

function qualifiedQualityScore(model, role) {
  const score = model.evidence?.status === "qualified" ? model.quality?.[role] : null;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function costRank(model, costPreference) {
  const pricingClass = classifyModelPricing(model);
  if (costPreference === "paid-first") return pricingClass === "paid" ? 0 : 1;
  return pricingClass === "free" ? 0 : 1;
}

function compareEligibleModels(left, right, role, costPreference) {
  const leftQuality = qualifiedQualityScore(left, role);
  const rightQuality = qualifiedQualityScore(right, role);

  // Exact ranking contract: qualified role evidence (presence, then score) wins;
  // next comes the user's free/paid preference, then curated role score, then a
  // code-unit ID comparison. Capability, access, availability, enablement, and
  // cost-policy checks have already removed ineligible models before this sort.
  if ((leftQuality !== null) !== (rightQuality !== null)) {
    return leftQuality !== null ? -1 : 1;
  }
  if (leftQuality !== null && rightQuality !== null && leftQuality !== rightQuality) {
    return rightQuality - leftQuality;
  }
  const costDifference =
    costRank(left, costPreference) - costRank(right, costPreference);
  if (costDifference !== 0) return costDifference;
  const roleDifference = right.roles[role] - left.roles[role];
  return roleDifference || compareStableIds(left, right);
}

export function eligibleModelsForRole({
  catalog,
  settings,
  role,
  modalities = ["text"],
  access = "read",
}) {
  if (!MODEL_ROLES.includes(role)) {
    throw routerError("INVALID_ROLE", "The requested model role is unsupported.");
  }
  if (
    !Array.isArray(modalities) ||
    modalities.length === 0 ||
    modalities.some((item) => !MODALITIES.includes(item)) ||
    !ACCESS_MODES.includes(access)
  ) {
    throw routerError("INVALID_REQUIREMENTS", "Routing requirements are invalid.");
  }
  const costPolicy = settings?.costPolicy;
  const costPreference = settings?.costPreference;
  if (
    !["free-only", "known-cost"].includes(costPolicy) ||
    !COST_PREFERENCES.includes(costPreference)
  ) {
    throw routerError("INVALID_SETTINGS", "Routing cost settings are invalid.");
  }

  return validateCatalog(catalog).models
    .filter((model) => {
      const control = settings?.modelControls?.[model.id];
      const pricingClass = classifyModelPricing(model);
      return (
        pricingClass !== "unknown" &&
        (costPolicy === "known-cost" || pricingClass === "free") &&
        model.available === true &&
        control?.enabled === true &&
        control?.available === true &&
        modelSupports({ model, role, modalities, access })
      );
    })
    .sort((left, right) =>
      compareEligibleModels(left, right, role, costPreference),
    );
}
