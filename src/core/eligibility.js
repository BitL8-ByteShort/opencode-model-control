import { classifyPricingEvidence } from "./pricing.js";
import {
  COST_POLICIES,
  COST_PREFERENCES,
  MODEL_ROLES,
  PAID_ELIGIBILITY,
} from "./constants.js";

function classifyModelPricing(model, options) {
  return classifyPricingEvidence(model?.pricing, options);
}

function modelEnabled(settings, modelId) {
  const control = settings?.modelControls?.[modelId];
  const selection =
    typeof control?.enabled === "boolean"
      ? control.enabled
        ? "enabled"
        : "disabled"
      : (control?.selection ?? "policy");
  return (
    selection === "enabled" ||
    (selection === "policy" && settings?.autoIncludeNewModels !== false)
  );
}

function modelSupports({ model, role, modalities, access }) {
  const roleScore = model?.roles?.[role];
  if (!MODEL_ROLES.includes(role) || !Number.isInteger(roleScore) || roleScore <= 0)
    return false;
  if (role === "orchestrator" && model.canOrchestrate !== true) return false;
  if (
    (role === "orchestrator" || role === "code-worker" || role === "vision-worker") &&
    model.toolCall === false
  )
    return false;
  if (role === "vision-worker" && model.toolCall !== true) return false;
  if (!model.access?.includes(access)) return false;
  if (!modalities.every((modality) => model.modalities?.input?.includes(modality)))
    return false;
  return model.modalities?.output?.includes("text") === true;
}

export function resolveEligibility({
  model,
  connection = null,
  connections,
  settings,
  role = null,
  modalities = ["text"],
  access = "read",
  hostInventory = null,
  now = Date.now(),
} = {}) {
  const blockingReasons = [];
  const warnings = [];
  const pricingStatus = classifyModelPricing(model, { now });
  const costPolicy = settings?.costPolicy;
  const paidEligibility = PAID_ELIGIBILITY.includes(settings?.paidEligibility)
    ? settings.paidEligibility
    : "verified-pricing";

  if (
    !COST_POLICIES.includes(costPolicy) ||
    !COST_PREFERENCES.includes(settings?.costPreference)
  ) {
    blockingReasons.push("invalid-settings");
  }

  if (!modelEnabled(settings, model?.id)) blockingReasons.push("disabled-by-you");
  if (
    model?.available === false ||
    settings?.modelControls?.[model?.id]?.available === false
  )
    blockingReasons.push("host-model-missing");

  if (model?.api?.urlValid === false) blockingReasons.push("invalid-endpoint");

  if (connection?.entitlement === "reported-revoked")
    blockingReasons.push("entitlement-revoked");

  const savedBinding = role
    ? settings?.roleConnections?.[role]
    : null;
  if (savedBinding) {
    if (!connection) {
      if (Array.isArray(connections))
        blockingReasons.push("connection-binding-changed");
    } else if (
      savedBinding.connectionId !== connection.id ||
      savedBinding.bindingRevision !== connection.bindingRevision
    )
      blockingReasons.push("connection-binding-changed");
  }

  if (hostInventory && model?.id && !hostInventory.has(model.id))
    blockingReasons.push("host-model-missing");

  if (costPolicy === "free-only") {
    if (pricingStatus !== "free") blockingReasons.push("free-access-unverified");
    if (connection?.billing?.kind === "subscription")
      blockingReasons.push("free-access-unverified");
  } else if (paidEligibility === "verified-pricing") {
    if (pricingStatus === "unknown")
      blockingReasons.push("legacy-paid-pricing-required");
  } else if (pricingStatus === "unknown") {
    warnings.push("api-estimate-unavailable");
    if (model?.pricing?.reasons?.includes("public-price-route-mismatch"))
      warnings.push("public-price-route-mismatch");
    if (model?.pricing?.reasons?.includes("pricing-expired"))
      warnings.push("pricing-expired");
  }

  if (
    role &&
    model &&
    !modelSupports({ model, role, modalities, access })
  )
    blockingReasons.push("incompatible-capabilities");

  return {
    allowed: blockingReasons.length === 0,
    blockingReasons: [...new Set(blockingReasons)],
    warnings: [...new Set(warnings)],
    pricingStatus,
    connectionId: connection?.id ?? null,
    bindingRevision: connection?.bindingRevision ?? null,
  };
}
