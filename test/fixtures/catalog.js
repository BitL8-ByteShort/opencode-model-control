// Synthetic, fresh rate evidence for isolated routing tests. Production bundled
// metadata deliberately has no independent pricing authorization.
import {
  loadModelCatalog as loadBundledCatalog,
  validateCatalog,
} from "../../src/core/index.js";
import { unknownPricing } from "../../src/core/pricing.js";
export function syntheticPricing(
  free = { verified: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
) {
  if (!free.verified) return unknownPricing();
  const fetchedAt = new Date().toISOString();
  return {
    class:
      free.inputUsdPerMillion > 0 || free.outputUsdPerMillion > 0
        ? "paid"
        : "free",
    rates: { input: free.inputUsdPerMillion, output: free.outputUsdPerMillion },
    source: "https://models.dev/api.json",
    digest: "0".repeat(64),
    reasons: [],
    fetchedAt,
    expiresAt: new Date(Date.parse(fetchedAt) + 86400000).toISOString(),
  };
}
export function loadModelCatalog(options) {
  const catalog = loadBundledCatalog(options);
  for (const model of catalog.models)
    model.pricing = syntheticPricing(model.free);
  return validateCatalog(catalog);
}
