import { createHash } from "node:crypto";
import { isPlainObject } from "./utils.js";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const PRICING_TTL_MS = 24 * 60 * 60 * 1000;
export const CATALOG_REFRESH_MS = 15 * 60 * 1000;
const DIMENSIONS = [
  "input",
  "output",
  "reasoning",
  "cache_read",
  "cache_write",
  "input_audio",
  "output_audio",
];
const MODALITIES = ["text", "image", "audio", "video", "pdf"];
const finiteRate = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
export const splitModelId = (id) => [
  id.slice(0, id.indexOf("/")),
  id.slice(id.indexOf("/") + 1),
];
export const digestJson = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Unknown fields in a billing structure fail closed; metadata outside billing is
// allowlisted separately and never copied into the persisted evidence.
export function analyzeRates(cost, modes) {
  const rates = {};
  const reasons = [];
  function block(value, prefix, extra = []) {
    if (!isPlainObject(value)) {
      reasons.push("missing-or-malformed-cost");
      return;
    }
    for (const required of ["input", "output"])
      if (!finiteRate(value[required]))
        reasons.push("missing-or-malformed-rate");
    for (const [key, rate] of Object.entries(value)) {
      if (extra.includes(key)) continue;
      if (!DIMENSIONS.includes(key)) {
        reasons.push("unsupported-rate");
        continue;
      }
      if (!finiteRate(rate)) reasons.push("malformed-rate");
      else rates[`${prefix}${key}`] = rate;
    }
  }
  block(cost, "", ["tiers", "context_over_200k"]);
  const tiers = new Map();
  if (isPlainObject(cost) && Object.hasOwn(cost, "tiers")) {
    if (!Array.isArray(cost.tiers)) reasons.push("malformed-tiers");
    else
      for (const item of cost.tiers) {
        const tier = item?.tier;
        if (
          !isPlainObject(tier) ||
          !Number.isInteger(tier.size) ||
          tier.size < 0 ||
          (tier.type !== undefined && tier.type !== "context") ||
          Object.keys(tier).some((k) => !["type", "size"].includes(k))
        ) {
          reasons.push("malformed-tier");
          continue;
        }
        if (tiers.has(tier.size)) reasons.push("conflicting-tiers");
        tiers.set(tier.size, item);
        block(item, `context:${tier.size}.`, ["tier"]);
      }
  }
  if (isPlainObject(cost) && Object.hasOwn(cost, "context_over_200k")) {
    block(cost.context_over_200k, "context_over_200k.");
    if (tiers.has(200000)) {
      const tier = tiers.get(200000);
      const legacy = cost.context_over_200k;
      if (DIMENSIONS.some((k) => tier[k] !== legacy?.[k]))
        reasons.push("conflicting-tiers");
    }
  }
  if (modes !== undefined) {
    if (!isPlainObject(modes)) reasons.push("malformed-modes");
    else
      for (const [name, mode] of Object.entries(modes)) {
        // Only sanitized mode names are persisted in rate paths.
        if (!/^[a-z0-9_-]{1,80}$/i.test(name) || !isPlainObject(mode)) {
          reasons.push("unsupported-mode");
          continue;
        }
        if (Object.hasOwn(mode, "cost")) block(mode.cost, `mode:${name}.`);
      }
  }
  return {
    class: reasons.length
      ? "unknown"
      : Object.values(rates).some((v) => v > 0)
        ? "paid"
        : "free",
    rates,
    reasons: [...new Set(reasons)],
  };
}

function safeUrl(value) {
  if (value === undefined || value === null) return null;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}
export function normalizeApiIdentity(value) {
  return {
    id:
      typeof value?.id === "string" &&
      /^[a-z0-9@~][a-z0-9._:+/@~-]*$/i.test(value.id)
        ? value.id
        : null,
    npm:
      typeof value?.npm === "string" &&
      /^[@a-z0-9][@a-z0-9/._-]*$/i.test(value.npm)
        ? value.npm
        : null,
    url: safeUrl(value?.url),
  };
}
const tri = (value) => (typeof value === "boolean" ? value : null);
const limit = (value) => (Number.isInteger(value) && value > 0 ? value : null);
export function capabilityDetails(value, source, observedAt, cli = false) {
  const capabilities = cli ? value?.capabilities : value;
  const io = (direction) =>
    Object.fromEntries(
      MODALITIES.map((name) => [
        name,
        cli
          ? tri(capabilities?.[direction]?.[name])
          : Array.isArray(value?.modalities?.[direction])
            ? value.modalities[direction].includes(name)
            : null,
      ]),
    );
  return {
    source,
    observedAt,
    toolCall: tri(capabilities?.[cli ? "toolcall" : "tool_call"]),
    reasoning: tri(capabilities?.reasoning),
    structuredOutput: tri(
      capabilities?.[cli ? "structuredOutput" : "structured_output"],
    ),
    temperature: tri(capabilities?.temperature),
    attachment: tri(capabilities?.attachment),
    interleaved:
      typeof capabilities?.interleaved === "boolean"
        ? capabilities.interleaved
        : [
              "reasoning",
              "reasoning_content",
              "reasoning_text",
              "reasoning_details",
            ].includes(capabilities?.interleaved?.field)
          ? { field: capabilities.interleaved.field }
          : null,
    reasoningOptions:
      !cli && Array.isArray(value?.reasoning_options)
        ? value.reasoning_options.flatMap((option) => {
            if (option?.type === "toggle") return [{ type: "toggle" }];
            if (
              option?.type === "effort" &&
              Array.isArray(option.values) &&
              option.values.every(
                (v) =>
                  v === null ||
                  [
                    "none",
                    "minimal",
                    "low",
                    "medium",
                    "high",
                    "xhigh",
                    "max",
                    "default",
                  ].includes(v),
              )
            )
              return [{ type: "effort", values: option.values }];
            if (
              option?.type === "budget_tokens" &&
              (option.min === undefined ||
                (Number.isFinite(option.min) && option.min >= -1)) &&
              (option.max === undefined ||
                (Number.isFinite(option.max) && option.max >= 0))
            )
              return [
                {
                  type: "budget_tokens",
                  ...(option.min === undefined ? {} : { min: option.min }),
                  ...(option.max === undefined ? {} : { max: option.max }),
                },
              ];
            return [];
          })
        : null,
    input: io("input"),
    output: io("output"),
    contextWindowTokens: limit(value?.limit?.context),
    inputLimitTokens: limit(value?.limit?.input),
    outputLimitTokens: limit(value?.limit?.output),
  };
}

export function unknownPricing(reason = "no-independent-pricing-evidence") {
  return {
    class: "unknown",
    rates: {},
    reasons: [reason],
    source: null,
    fetchedAt: null,
    expiresAt: null,
    digest: null,
  };
}
export function normalizeModelsDev(raw, { fetchedAt, digest } = {}) {
  if (
    !isPlainObject(raw) ||
    !Object.keys(raw).length ||
    !Number.isFinite(Date.parse(fetchedAt))
  )
    throw new Error("Invalid public model metadata.");
  const models = {};
  for (const [providerId, provider] of Object.entries(raw)) {
    if (
      !/^[a-z0-9][a-z0-9._-]*$/i.test(providerId) ||
      !isPlainObject(provider) ||
      provider.id !== providerId ||
      !isPlainObject(provider.models)
    )
      throw new Error("Invalid public provider metadata.");
    for (const [key, model] of Object.entries(provider.models)) {
      if (!/^[a-z0-9@~][a-z0-9._:+/@~-]*$/i.test(key) || !isPlainObject(model))
        throw new Error("Invalid public model metadata.");
      const api = normalizeApiIdentity({
        id: model.id,
        npm: model.provider?.npm ?? provider.npm,
        url: model.provider?.api ?? provider.api,
      });
      const pricing = analyzeRates(model.cost, model.experimental?.modes);
      if (
        model.id !== key ||
        !api.npm ||
        ((model.provider?.api ?? provider.api) != null && !api.url)
      ) {
        pricing.class = "unknown";
        pricing.reasons.push("identity-conflict");
      }
      models[`${providerId}/${key}`] = {
        api,
        pricing,
        capabilities: capabilityDetails(model, "models.dev", fetchedAt),
      };
    }
  }
  if (!Object.keys(models).length)
    throw new Error("Empty public model metadata.");
  return {
    source: MODELS_DEV_URL,
    digest: digest ?? digestJson(raw),
    fetchedAt,
    expiresAt: new Date(Date.parse(fetchedAt) + PRICING_TTL_MS).toISOString(),
    models,
  };
}
export function resolveModelEvidence(live, snapshot) {
  const record = snapshot?.models?.[live.id];
  if (!record) return unknownPricing("model-not-in-public-source");
  const api = normalizeApiIdentity(live.api);
  const conflict =
    ["id", "npm", "url"].some((key) => api[key] !== record.api[key]) ||
    !api.id ||
    !api.npm ||
    (live.api?.url && !api.url);
  return {
    ...record.pricing,
    ...(conflict ? { class: "unknown", reasons: ["identity-conflict"] } : {}),
    source: MODELS_DEV_URL,
    digest: snapshot.digest,
    fetchedAt: snapshot.fetchedAt,
    expiresAt: snapshot.expiresAt,
  };
}
export function classifyPricingEvidence(pricing, { now = Date.now() } = {}) {
  if (
    !Number.isFinite(now) ||
    !pricing ||
    !["free", "paid"].includes(pricing.class) ||
    !["reported-paid", MODELS_DEV_URL].includes(pricing.source) ||
    !Number.isFinite(Date.parse(pricing.fetchedAt)) ||
    !Number.isFinite(Date.parse(pricing.expiresAt)) ||
    now >= Date.parse(pricing.expiresAt) ||
    Date.parse(pricing.expiresAt) >
      Date.parse(pricing.fetchedAt) + PRICING_TTL_MS ||
    Date.parse(pricing.fetchedAt) > now ||
    pricing.reasons?.length
  )
    return "unknown";
  if (
    pricing.source === MODELS_DEV_URL &&
    !/^[a-f0-9]{64}$/.test(pricing.digest ?? "")
  )
    return "unknown";
  const rates = pricing.rates;
  if (
    !isPlainObject(rates) ||
    !finiteRate(rates.input) ||
    !finiteRate(rates.output) ||
    !Object.values(rates).every(finiteRate)
  )
    return "unknown";
  const actual = Object.values(rates).some((rate) => rate > 0)
    ? "paid"
    : "free";
  return actual === pricing.class &&
    (pricing.source !== "reported-paid" || actual === "paid")
    ? actual
    : "unknown";
}
