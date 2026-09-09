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
              : typeof value.recordedCost.currency === "string"
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
    priceSnapshotId:
      value.priceSnapshotId === null || value.priceSnapshotId === undefined
        ? null
        : typeof value.priceSnapshotId === "string"
          ? value.priceSnapshotId
          : invalidUsage("Usage observation price snapshot is invalid."),
  };
}

export function costLabel(kind) {
  if (kind === "opencode-recorded") return "OpenCode-recorded cost";
  if (kind === "estimated-api") return "Estimated API cost";
  if (kind === "api-equivalent") return "API-equivalent estimate";
  if (kind === "provider-charge") return "Provider-reported charge";
  return "Not reported";
}
