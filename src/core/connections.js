import { createHash } from "node:crypto";
import { routerError } from "./errors.js";
import { isPlainObject } from "./utils.js";
import { normalizeApiIdentity } from "./pricing.js";

export const CURRENT_CONNECTION_STORE_VERSION = 1;
export const BILLING_KINDS = Object.freeze([
  "subscription",
  "metered-api",
  "prepaid",
  "local",
  "free",
  "unknown",
]);
export const EVIDENCE_SOURCES = Object.freeze([
  "host",
  "provider-adapter",
  "user-declared",
  "unknown",
]);
export const AUTH_KINDS = Object.freeze(["oauth", "api-key", "none", "unknown"]);
export const ENTITLEMENTS = Object.freeze([
  "reported-active",
  "reported-revoked",
  "not-reported",
]);
export const TRANSPORT_VISIBILITY = Object.freeze([
  "declared-endpoint",
  "host-managed",
]);
export const QUOTA_UNITS = Object.freeze([
  "tokens",
  "requests",
  "credits",
  "percent",
]);
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX32_PATTERN = /^[a-f0-9]{32}$/;
const TIMESTAMP = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

function invalidConnection(message) {
  throw routerError("INVALID_CONNECTION", message);
}

export function deriveConnectionId(scopeId, providerId) {
  if (typeof scopeId !== "string" || !UUID_PATTERN.test(scopeId))
    invalidConnection("Connection scope is invalid.");
  if (typeof providerId !== "string" || !PROVIDER_ID_PATTERN.test(providerId))
    invalidConnection("Connection provider is invalid.");
  return createHash("sha256")
    .update(`omc.connection.v1\0${scopeId}\0${providerId}`)
    .digest("hex")
    .slice(0, 32);
}

export function deriveBindingRevision(input) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        url: input?.url ?? null,
        npm: input?.npm ?? null,
        authKind: input?.authKind ?? "unknown",
        billingKind: input?.billingKind ?? "unknown",
        mixed: input?.mixed === true,
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateQuotaObservation(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) invalidConnection("Quota observation is invalid.");
  const unit = value.unit;
  if (!QUOTA_UNITS.includes(unit)) invalidConnection("Quota unit is invalid.");
  const numeric = ["limit", "used", "remaining"];
  const quota = {
    source:
      value.source === "host" || value.source === "provider-adapter"
        ? value.source
        : invalidConnection("Quota source is invalid."),
    unit,
    limit: value.limit === null ? null : value.limit,
    used: value.used === null ? null : value.used,
    remaining: value.remaining === null ? null : value.remaining,
    resetsAt: value.resetsAt === null ? null : value.resetsAt,
    observedAt: value.observedAt,
    expiresAt: value.expiresAt,
  };
  for (const key of numeric) {
    if (quota[key] !== null && !finiteNonNegative(quota[key]))
      invalidConnection("Quota values must be finite and nonnegative.");
  }
  if (
    unit === "percent" &&
    numeric.some((key) => quota[key] !== null && quota[key] > 100)
  )
    invalidConnection("Quota percent values must be within 0-100.");
  if (!TIMESTAMP(quota.observedAt) || !TIMESTAMP(quota.expiresAt))
    invalidConnection("Quota timestamps are invalid.");
  if (!["host", "provider-adapter"].includes(quota.source))
    invalidConnection("Quota source is invalid.");
  return quota;
}

export function validateConnection(value) {
  if (!isPlainObject(value)) invalidConnection("Connection is invalid.");
  const providerId = value.providerId;
  if (typeof providerId !== "string" || !PROVIDER_ID_PATTERN.test(providerId))
    invalidConnection("Connection provider is invalid.");
  if (typeof value.id !== "string" || !HEX32_PATTERN.test(value.id))
    invalidConnection("Connection identity is invalid.");
  if (
    typeof value.bindingRevision !== "string" ||
    !HEX32_PATTERN.test(value.bindingRevision)
  )
    invalidConnection("Connection binding is invalid.");
  if (!AUTH_KINDS.includes(value.authKind))
    invalidConnection("Connection authentication is invalid.");
  if (!isPlainObject(value.billing))
    invalidConnection("Connection billing is invalid.");
  if (!BILLING_KINDS.includes(value.billing.kind))
    invalidConnection("Connection billing is invalid.");
  if (!EVIDENCE_SOURCES.includes(value.billing.source))
    invalidConnection("Connection billing is invalid.");
  if (value.billing.observedAt !== null && !TIMESTAMP(value.billing.observedAt))
    invalidConnection("Connection billing is invalid.");
  if (!TRANSPORT_VISIBILITY.includes(value.transportVisibility))
    invalidConnection("Connection transport is invalid.");
  if (!TIMESTAMP(value.inventoryObservedAt))
    invalidConnection("Connection inventory time is invalid.");
  if (!ENTITLEMENTS.includes(value.entitlement))
    invalidConnection("Connection entitlement is invalid.");
  return {
    id: value.id,
    providerId,
    bindingRevision: value.bindingRevision,
    authKind: value.authKind,
    billing: {
      kind: value.billing.kind,
      source: value.billing.source,
      observedAt: value.billing.observedAt,
    },
    transportVisibility: value.transportVisibility,
    inventoryObservedAt: value.inventoryObservedAt,
    entitlement: value.entitlement,
    quota: validateQuotaObservation(value.quota ?? null),
  };
}

export function validateConnectionSnapshot(value) {
  if (!isPlainObject(value)) invalidConnection("Connection snapshot is invalid.");
  if (value.schemaVersion !== CURRENT_CONNECTION_STORE_VERSION)
    invalidConnection("Connection snapshot version is unsupported.");
  if (typeof value.scopeId !== "string" || !UUID_PATTERN.test(value.scopeId))
    invalidConnection("Connection scope is invalid.");
  if (!Array.isArray(value.connections))
    invalidConnection("Connection snapshot is invalid.");
  const connections = value.connections.map(validateConnection);
  const ids = new Set();
  const providers = new Set();
  for (const connection of connections) {
    if (ids.has(connection.id) || providers.has(connection.providerId))
      invalidConnection("Connection identities must be unique.");
    ids.add(connection.id);
    providers.add(connection.providerId);
    if (connection.id !== deriveConnectionId(value.scopeId, connection.providerId))
      invalidConnection("Connection identity is invalid.");
  }
  const revision =
    typeof value.revision === "string" && /^[a-f0-9]{64}$/.test(value.revision)
      ? value.revision
      : createHash("sha256")
          .update(JSON.stringify(connections))
          .digest("hex");
  return {
    schemaVersion: CURRENT_CONNECTION_STORE_VERSION,
    revision,
    scopeId: value.scopeId,
    connections,
  };
}

export function applyBillingDeclarations(connections, declarations = {}) {
  return connections.map((connection) => {
    const declaration = declarations[connection.id];
    if (!declaration) return connection;
    if (declaration.bindingRevision !== connection.bindingRevision) {
      return {
        ...connection,
        billing: { kind: "unknown", source: "unknown", observedAt: null },
      };
    }
    return {
      ...connection,
      billing: {
        kind: declaration.kind,
        source: "user-declared",
        observedAt: declaration.declaredAt ?? connection.inventoryObservedAt,
      },
    };
  });
}

export function connectionBindingInputs(provider) {
  const models = Object.values(provider?.models ?? {});
  const identities = models.map((model) => normalizeApiIdentity(model?.api));
  const npms = [
    ...new Set(identities.map((api) => api.npm).filter((value) => value)),
  ].sort();
  const urls = [
    ...new Set(identities.map((api) => api.url).filter((value) => value !== undefined)),
  ].sort((left, right) => String(left) < String(right) ? -1 : 1);
  const mixed = npms.length > 1 || new Set(urls.map((value) => value ?? "")).size > 1;
  return {
    npm: npms.length === 1 ? npms[0] : null,
    url: !mixed && urls.length <= 1 ? (urls[0] ?? null) : null,
    mixed,
    declared: identities.some((api) => api.urlValid && api.url !== null),
  };
}
