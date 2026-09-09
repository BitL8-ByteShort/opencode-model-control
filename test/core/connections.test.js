import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBillingDeclarations,
  deriveBindingRevision,
  deriveConnectionId,
  validateConnection,
  validateConnectionSnapshot,
} from "../../src/core/connections.js";
import { observeConnections } from "../../src/opencode/connection-observer.js";

const scopeId = "11111111-1111-4111-8111-111111111111";
const now = Date.parse("2026-09-08T12:00:00.000Z");

function provider(id, models) {
  return {
    id,
    models: Object.fromEntries(
      Object.entries(models).map(([key, api]) => [
        key,
        { id: key, providerID: id, api },
      ]),
    ),
  };
}

test("connection IDs are stable, nonsecret, and derived from scope plus provider slot", () => {
  const id = deriveConnectionId(scopeId, "xai");
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal(deriveConnectionId(scopeId, "xai"), id);
  assert.notEqual(deriveConnectionId(scopeId, "openai"), id);
  assert.doesNotMatch(id, /xai|home|token|panda/i);
  assert.throws(
    () => deriveConnectionId("/home/user/.config", "xai"),
    (error) => error.code === "INVALID_CONNECTION" && !/home/.test(error.message),
  );
});

test("invalid connection payloads throw sanitized errors", () => {
  assert.throws(
    () => validateConnection({ id: "secret-token-value", providerId: "xai" }),
    (error) =>
      error.code === "INVALID_CONNECTION" &&
      !/secret-token-value/.test(error.message),
  );
});

test("one configured slot is one connection; auth methods do not invent billing", () => {
  const connections = observeConnections({
    scopeId,
    now,
    providers: [
      provider("xai", {
        "grok-4.6": { id: "grok-4.6", npm: "@ai-sdk/xai", url: "" },
      }),
      {
        id: "kimi-for-coding",
        models: {
          k2: {
            id: "k2",
            providerID: "kimi-for-coding",
            api: {
              id: "k2",
              npm: "@ai-sdk/openai-compatible",
              url: "https://api.kimi.com/coding/v1",
            },
            options: { apiKey: "sk-test" },
          },
        },
      },
      provider("unfamiliar", {
        "spark-1.3": {
          id: "spark-1.3",
          npm: "@ai-sdk/openai-compatible",
          url: null,
        },
      }),
    ],
  });
  assert.equal(connections.length, 3);
  assert.equal(new Set(connections.map((item) => item.providerId)).size, 3);
  for (const connection of connections) {
    assert.equal(connection.authKind, "unknown");
    assert.equal(connection.billing.kind, "unknown");
    assert.equal(connection.billing.source, "unknown");
    assert.equal(connection.entitlement, "not-reported");
    assert.equal(connection.quota, null);
  }
  const kimi = connections.find((item) => item.providerId === "kimi-for-coding");
  assert.notEqual(kimi.billing.kind, "metered-api");
  assert.equal(kimi.transportVisibility, "declared-endpoint");
  const xai = connections.find((item) => item.providerId === "xai");
  assert.equal(xai.transportVisibility, "host-managed");
});

test("live observation preserves reported-revoked entitlement for the same slot", () => {
  const prior = observeConnections({
    scopeId,
    now,
    providers: [
      provider("xai", {
        "grok-4.6": { id: "grok-4.6", npm: "@ai-sdk/xai", url: "" },
      }),
    ],
  });
  prior[0].entitlement = "reported-revoked";
  const next = observeConnections({
    scopeId,
    now,
    previousConnections: prior,
    providers: [
      provider("xai", {
        "grok-4.6": { id: "grok-4.6", npm: "@ai-sdk/xai", url: "" },
      }),
    ],
  });
  assert.equal(next[0].id, prior[0].id);
  assert.equal(next[0].entitlement, "reported-revoked");
});

test("user billing declarations are labelled and invalidated when the binding changes", () => {
  const [xai] = observeConnections({
    scopeId,
    now,
    providers: [
      provider("xai", {
        "grok-4.6": { id: "grok-4.6", npm: "@ai-sdk/xai", url: "" },
      }),
    ],
  });
  const declared = applyBillingDeclarations([xai], {
    [xai.id]: {
      kind: "subscription",
      bindingRevision: xai.bindingRevision,
      declaredAt: "2026-09-08T12:00:00.000Z",
    },
  });
  assert.equal(declared[0].billing.kind, "subscription");
  assert.equal(declared[0].billing.source, "user-declared");
  const changed = observeConnections({
    scopeId,
    now,
    previousConnections: declared,
    providers: [
      provider("xai", {
        "grok-4.6": {
          id: "grok-4.6",
          npm: "@ai-sdk/xai",
          url: "https://api.x.ai/v1",
        },
      }),
    ],
  });
  assert.equal(changed[0].id, xai.id);
  assert.notEqual(changed[0].bindingRevision, xai.bindingRevision);
  assert.equal(changed[0].billing.kind, "unknown");
  assert.equal(changed[0].billing.source, "unknown");
});

test("quota observations reject invalid numbers and mixed provenance is not invented", () => {
  const connection = {
    id: deriveConnectionId(scopeId, "openai"),
    providerId: "openai",
    bindingRevision: deriveBindingRevision({ npm: "@ai-sdk/openai" }),
    authKind: "unknown",
    billing: { kind: "unknown", source: "unknown", observedAt: null },
    transportVisibility: "host-managed",
    inventoryObservedAt: "2026-09-08T12:00:00.000Z",
    entitlement: "not-reported",
    quota: {
      source: "host",
      unit: "percent",
      limit: 101,
      used: 0,
      remaining: 0,
      resetsAt: null,
      observedAt: "2026-09-08T12:00:00.000Z",
      expiresAt: "2026-09-09T12:00:00.000Z",
    },
  };
  assert.throws(
    () => validateConnection(connection),
    (error) => error.code === "INVALID_CONNECTION",
  );
  const snapshot = validateConnectionSnapshot({
    schemaVersion: 1,
    scopeId,
    connections: [
      {
        ...connection,
        quota: null,
      },
    ],
  });
  assert.equal(snapshot.connections[0].quota, null);
});
