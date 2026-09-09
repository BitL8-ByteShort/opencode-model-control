import { routerError } from "./errors.js";
import { isPlainObject } from "./utils.js";
import { BILLING_KINDS, EVIDENCE_SOURCES } from "./connections.js";

const TOKEN_KEYS = Object.freeze([
  "input",
  "output",
  "reasoning",
  "cacheRead",
  "cacheWrite",
]);

function invalidUsage(message) {
  throw routerError("INVALID_USAGE", message);
}

export function nullableFinite(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    invalidUsage("Usage values must be finite and nonnegative.");
  return value;
}

export function sumNullable(values) {
  const present = values.filter((value) => value !== null && value !== undefined);
  if (!present.length) return null;
  const total = present.reduce((sum, value) => sum + value, 0);
  return Number.isFinite(total) ? total : null;
}

export function estimateApiCost({ rates, tokens, semantics = {} } = {}) {
  if (!isPlainObject(rates) || !isPlainObject(tokens)) {
    return { amount: null, status: "unavailable", currency: null };
  }
  const unavailable = { amount: null, status: "unavailable", currency: null };
  if (!isPlainObject(semantics)) return unavailable;
  // Unsupported rate dimensions (tiered, audio, long-context, etc.) cannot
  // silently fall back to ordinary text prices.
  const supported = new Set(["input", "output", "reasoning", "cache_read", "cache_write"]);
  if (Object.entries(rates).some(([key, value]) => !supported.has(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0)) return unavailable;
  if (semantics.audioRequired || Object.keys(semantics).some(key => !["reasoningIncludedInOutput", "cacheIncludedInInput", "audioRequired"].includes(key))) return unavailable;
  for (const key of ["reasoningIncludedInOutput", "cacheIncludedInInput"]) {
    if (semantics[key] != null && typeof semantics[key] !== "boolean") return unavailable;
  }
  if (tokens.reasoning > 0 && typeof semantics.reasoningIncludedInOutput !== "boolean") return unavailable;
  if ((tokens.cacheRead > 0 || tokens.cacheWrite > 0) && typeof semantics.cacheIncludedInInput !== "boolean") return unavailable;
  const input = nullableFinite(tokens.input);
  const output = nullableFinite(tokens.output);
  if (input === null || output === null || rates.input == null || rates.output == null) {
    return { amount: null, status: "unavailable", currency: null };
  }
  let amount = (input * rates.input + output * rates.output) / 1_000_000;
  if (semantics.reasoningIncludedInOutput !== true && tokens.reasoning != null) {
    if (rates.reasoning == null)
      return { amount: null, status: "partial", currency: "USD", incomplete: true };
    amount += (nullableFinite(tokens.reasoning) * rates.reasoning) / 1_000_000;
  }
  if (semantics.cacheIncludedInInput !== true) {
    for (const [key, rateKey] of [
      ["cacheRead", "cache_read"],
      ["cacheWrite", "cache_write"],
    ]) {
      if (tokens[key] == null) continue;
      if (rates[rateKey] == null)
        return { amount: null, status: "partial", currency: "USD", incomplete: true };
      amount += (nullableFinite(tokens[key]) * rates[rateKey]) / 1_000_000;
    }
  }
  if (semantics.audioRequired && (rates.input_audio == null || rates.output_audio == null)) {
    return { amount: null, status: "unavailable", currency: null };
  }
  return {
    amount: Number.isFinite(amount) ? amount : null,
    status: "estimated-api-cost",
    currency: "USD",
  };
}

// Retain only public rate evidence. Missing semantics intentionally keeps this
// historical snapshot unsuitable for a complete API estimate.
export function capturePriceSnapshot(pricing) {
  if (!isPlainObject(pricing) || !isPlainObject(pricing.rates) || !Number.isFinite(Date.parse(pricing.fetchedAt)) || !Number.isFinite(Date.parse(pricing.expiresAt))) return null;
  const keys = ["input", "output", "reasoning", "cache_read", "cache_write"];
  if (Object.entries(pricing.rates).some(([key, value]) => !keys.includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0)) return null;
  if (pricing.rates.input == null || pricing.rates.output == null || typeof pricing.source !== "string" || pricing.source.length > 2048) return null;
  let source;
  try {
    source = new URL(pricing.source);
    if (source.protocol !== "https:" || source.username || source.password || source.search || source.hash) return null;
  } catch { return null; }
  return { rates: Object.fromEntries(keys.filter(key => pricing.rates[key] != null).map(key => [key, pricing.rates[key]])), source: source.href, fetchedAt: new Date(pricing.fetchedAt).toISOString(), expiresAt: new Date(pricing.expiresAt).toISOString(), semantics: null };
}

export function validateUsageObservation(value) {
  if (!isPlainObject(value)) invalidUsage("Usage observation is invalid.");
  if (typeof value.eventKey !== "string" || !/^[a-f0-9]{64}$/.test(value.eventKey))
    invalidUsage("Usage observation identity is invalid.");
  if (
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt))
  )
    invalidUsage("Usage observation time is invalid.");
  if (
    value.connectionId !== null &&
    (typeof value.connectionId !== "string" ||
      !/^[a-f0-9]{32}$/.test(value.connectionId))
  )
    invalidUsage("Usage observation connection is invalid.");
  if (
    value.bindingRevision !== null &&
    (typeof value.bindingRevision !== "string" ||
      !/^[a-f0-9]{32}$/.test(value.bindingRevision))
  )
    invalidUsage("Usage observation binding is invalid.");
  if (!BILLING_KINDS.includes(value.billingKind))
    invalidUsage("Usage observation billing is invalid.");
  if (!EVIDENCE_SOURCES.includes(value.billingSource))
    invalidUsage("Usage observation billing is invalid.");
  const tokens = value.tokens ?? {};
  const recorded =
    value.recordedCost === null || value.recordedCost === undefined
      ? null
      : {
          amount: nullableFinite(value.recordedCost.amount),
          currency:
            value.recordedCost.currency === null ||
            value.recordedCost.currency === undefined
              ? null
              : typeof value.recordedCost.currency === "string" && /^[A-Z]{3}$/.test(value.recordedCost.currency)
                ? value.recordedCost.currency
                : invalidUsage("Usage observation currency is invalid."),
        };
  return {
    eventKey: value.eventKey,
    observedAt: value.observedAt,
    connectionId: value.connectionId,
    bindingRevision: value.bindingRevision,
    billingKind: value.billingKind,
    billingSource: value.billingSource,
    tokens: Object.fromEntries(
      TOKEN_KEYS.map((key) => [key, nullableFinite(tokens[key] ?? null)]),
    ),
    recordedCost: recorded,
    priceSnapshot: capturePriceSnapshot(value.priceSnapshot),
    priceSnapshotId: capturePriceSnapshot(value.priceSnapshot) && typeof value.priceSnapshotId === "string" && /^[a-f0-9]{64}$/.test(value.priceSnapshotId) ? value.priceSnapshotId : null,

  };
}

export function costLabel(kind) {
  if (kind === "opencode-recorded") return "OpenCode-recorded cost";
  if (kind === "estimated-api") return "Estimated API cost";
  if (kind === "api-equivalent") return "API-equivalent estimate";
  if (kind === "provider-charge") return "Provider-reported charge";
  return "Not reported";
}
