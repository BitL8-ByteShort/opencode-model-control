import {
  PROVIDER_ID_PATTERN,
  deriveBindingRevision,
  deriveConnectionId,
  validateConnection,
  connectionBindingInputs,
} from "../core/connections.js";
import { isPlainObject } from "../core/utils.js";

function iso(now) {
  return new Date(now).toISOString();
}

function previousByProvider(previousConnections) {
  return new Map(
    (previousConnections ?? []).map((connection) => [
      connection.providerId,
      connection,
    ]),
  );
}

export function providersFromLiveModels(models) {
  const byProvider = new Map();
  for (const model of models ?? []) {
    const providerId =
      typeof model?.provider === "string"
        ? model.provider
        : String(model?.id ?? "").split("/")[0];
    if (!providerId) continue;
    const key =
      typeof model?.id === "string" && model.id.startsWith(`${providerId}/`)
        ? model.id.slice(providerId.length + 1)
        : String(model?.api?.id ?? model?.id ?? "");
    if (!key) continue;
    const slot = byProvider.get(providerId) ?? { id: providerId, models: {} };
    slot.models[key] = {
      id: key,
      providerID: providerId,
      api: model.api,
    };
    byProvider.set(providerId, slot);
  }
  return [...byProvider.values()];
}

export function observeConnections({
  providers,
  previousConnections = [],
  scopeId,
  now = Date.now(),
} = {}) {
  if (!Array.isArray(providers)) return [];
  const previous = previousByProvider(previousConnections);
  const observedAt = iso(now);
  const connections = [];
  const seen = new Set();
  for (const provider of providers) {
    if (!isPlainObject(provider) || typeof provider.id !== "string") continue;
    if (!PROVIDER_ID_PATTERN.test(provider.id)) continue;
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    const binding = connectionBindingInputs(provider);
    const prior = previous.get(provider.id);
    const authKind = "unknown";
    const billingKind = "unknown";
    const bindingRevision = deriveBindingRevision({
      url: binding.url,
      npm: binding.npm,
      authKind,
      billingKind,
      mixed: binding.mixed,
    });
    const billingUnchanged =
      prior &&
      prior.bindingRevision === bindingRevision &&
      prior.billing?.source === "user-declared";
    connections.push(
      validateConnection({
        id: deriveConnectionId(scopeId, provider.id),
        providerId: provider.id,
        bindingRevision,
        authKind,
        billing: billingUnchanged
          ? prior.billing
          : {
              kind: "unknown",
              source: "unknown",
              observedAt: null,
            },
        transportVisibility: binding.declared
          ? "declared-endpoint"
          : "host-managed",
        inventoryObservedAt: observedAt,
        entitlement: "not-reported",
        quota: null,
      }),
    );
  }
  return connections;
}
