// A plan-specific slot's zero token rates describe included usage, not the
// account's subscription/credit charges. This conservative gate does not infer
// billing, authentication, entitlement, or quota from a provider name.
export function isPlanProvider(modelId) {
  const provider = typeof modelId === "string"
    ? modelId.split("/", 1)[0].toLowerCase()
    : "";
  return provider === "opencode-go" || provider === "kimi-for-coding" ||
    /(?:^|-)(?:coding|code|token|step)-plan(?:-|$)/.test(provider);
}

export function guardPlanPricing(modelId, pricing) {
  if (!isPlanProvider(modelId) || pricing?.class !== "free") return pricing;
  return {
    ...pricing,
    class: "unknown",
    reasons: [...new Set([...(pricing.reasons ?? []), "plan-access-unverified"])],
  };
}
