import test from "node:test";
import assert from "node:assert/strict";
import {
  loadModelCatalog,
  validateCatalog,
  classifyModelPricing,
  eligibleModelsForRole,
  createDefaultSettings,
} from "../../src/core/index.js";
import { normalizeModelsDev } from "../../src/core/pricing.js";
import {
  mergeDiscoveredCatalog,
  parseOpenCodeVerboseCatalog,
} from "../../src/server/opencode-cli.js";
const now = new Date().toISOString();
const model = (key, cost = { input: 0, output: 0 }, capabilities = {}) => ({
  id: key,
  name: key,
  status: "active",
  api: { id: key, npm: "sdk", url: "https://api.example/v1" },
  cost,
  capabilities: {
    toolcall: true,
    input: { text: true },
    output: { text: true },
    ...capabilities,
  },
});
const publicData = (key, cost = { input: 0, output: 0 }) =>
  normalizeModelsDev(
    {
      opencode: {
        id: "opencode",
        npm: "sdk",
        api: "https://api.example/v1",
        models: {
          [key]: {
            id: key,
            cost,
            reasoning: true,
            structured_output: false,
            tool_call: true,
            modalities: { input: ["text", "image"], output: ["text"] },
            limit: { context: 100000, output: 10000 },
          },
        },
      },
    },
    { fetchedAt: now },
  );
function merge(
  key,
  cost,
  capabilities,
  publicMetadata = publicData(key, cost),
) {
  const value = model(key, cost, capabilities);
  return validateCatalog(
    mergeDiscoveredCatalog(
      loadModelCatalog(),
      parseOpenCodeVerboseCatalog(`opencode/${key}\n${JSON.stringify(value)}`, {
        observedAt: now,
      }),
      { publicMetadata, now: Date.parse(now) },
    ),
  );
}
test("Muse 1.3 and any unseen nested model use dynamic public evidence without roster entries", () => {
  for (const key of [
    "muse-spark-1.3-contributor-free",
    "unseen/nested-model",
  ]) {
    const catalog = merge(key);
    const entry = catalog.models.find((m) => m.id === `opencode/${key}`);
    assert.equal(catalog.schemaVersion, 2);
    assert.equal(classifyModelPricing(entry), "free");
    assert.ok(catalog.revision);
    assert.equal(entry.roles["code-worker"], 25);
    assert.equal(entry.evidence?.status === "qualified", false);
    assert.equal(entry.capabilities.effective.reasoning, null);
    assert.equal(entry.capabilities.supplemental.reasoning, true);
    assert.equal(entry.capabilities.supplemental.structuredOutput, false);
    assert.deepEqual(entry.modalities.input, ["text"]);
    assert.equal(entry.capabilities.supplemental.input.image, true);
  }
});
test("new paid, unknown and explicit false capability reports remain distinguishable", () => {
  const paid = merge(
    "new-paid",
    { input: 0, output: 2 },
    { toolcall: false, reasoning: false },
  );
  const entry = paid.models.find((m) => m.id === "opencode/new-paid");
  assert.equal(classifyModelPricing(entry), "paid");
  assert.equal(entry.capabilities.effective.reasoning, false);
  assert.equal(entry.capabilities.effective.toolCall, false);
  assert.deepEqual(entry.roles, { reviewer: 25 });
  const unknown = merge("new-unknown", {}, {});
  assert.equal(
    classifyModelPricing(
      unknown.models.find((m) => m.id === "opencode/new-unknown"),
    ),
    "unknown",
  );
});
test("legacy migration never invents freshness and CLI zeros do not renew bundled authorization", () => {
  const catalog = loadModelCatalog();
  for (const entry of catalog.models)
    assert.equal(classifyModelPricing(entry), "unknown");
  const key = "big-pickle";
  const result = merge(key, { input: 0, output: 0 }, {}, null);
  const entry = result.models.find((m) => m.id === `opencode/${key}`);
  assert.equal(classifyModelPricing(entry), "unknown");
  assert.equal(entry.pricing.fetchedAt, null);
});
test("routing rejects evidence that expires after initial eligibility", () => {
  const catalog = merge("new-free");
  const entry = catalog.models.find((m) => m.id === "opencode/new-free");
  const settings = createDefaultSettings(catalog);
  settings.modelControls[entry.id] = { enabled: true, available: true };
  assert.equal(
    eligibleModelsForRole({ catalog, settings, role: "reviewer" }).length,
    1,
  );
  entry.pricing.fetchedAt = "2020-01-01T00:00:00.000Z";
  entry.pricing.expiresAt = "2020-01-02T00:00:00.000Z";
  assert.equal(
    eligibleModelsForRole({ catalog, settings, role: "reviewer" }).length,
    0,
  );
});
test("CLI cache billing cannot be lost by base-price normalization", () => {
  const parsed = parseOpenCodeVerboseCatalog(
    `vendor/new\n${JSON.stringify(model("new", { input: 0, output: 0, cache: { read: 1, write: 0 } }))}`,
  );
  assert.equal(parsed[0].priceClass, "paid");
  assert.equal(parsed[0].reportedPricing.rates.cache_read, 1);
});
test("provider keys with @ and ~ are preserved through discovery, evidence and catalog validation", () => {
  for (const key of [
    "@cf/vendor/model",
    "claude-model@region",
    "~vendor/model-latest",
  ]) {
    const catalog = merge(key);
    assert.equal(
      classifyModelPricing(
        catalog.models.find((m) => m.id === `opencode/${key}`),
      ),
      "free",
    );
  }
});
test("repricing and identity changes override prior evidence while failed fetches cannot renew it", () => {
  const key = "generic";
  const first = merge(key);
  const live = parseOpenCodeVerboseCatalog(
    `opencode/${key}\n${JSON.stringify(model(key))}`,
    { observedAt: now },
  );
  const prior = first.models.find((m) => m.id === `opencode/${key}`);
  const failedRefresh = mergeDiscoveredCatalog(first, live, {
    now: Date.parse(now) + 3600000,
  });
  assert.equal(
    failedRefresh.models.find((m) => m.id === prior.id).pricing.fetchedAt,
    prior.pricing.fetchedAt,
  );
  const paid = mergeDiscoveredCatalog(first, live, {
    publicMetadata: publicData(key, { input: 1, output: 2 }),
    now: Date.parse(now),
  });
  assert.equal(
    classifyModelPricing(paid.models.find((m) => m.id === prior.id)),
    "paid",
  );
  const missing = mergeDiscoveredCatalog(first, live, {
    publicMetadata: publicData(key, {}),
    now: Date.parse(now),
  });
  assert.equal(
    classifyModelPricing(missing.models.find((m) => m.id === prior.id)),
    "unknown",
  );
  const redirected = mergeDiscoveredCatalog(
    first,
    [{ ...live[0], api: { ...live[0].api, url: "https://another.example" } }],
    { now: Date.parse(now) },
  );
  assert.equal(
    classifyModelPricing(redirected.models.find((m) => m.id === prior.id)),
    "unknown",
  );
  const removed = mergeDiscoveredCatalog(first, [], {
    publicMetadata: publicData(key, { input: 1, output: 2 }),
    now: Date.parse(now),
  });
  assert.equal(
    removed.models.find((m) => m.id === prior.id).pricing.class,
    "paid",
  );
  assert.equal(removed.models.find((m) => m.id === prior.id).available, false);
});
test("positive CLI conflicts, malformed extra rates and conflicting provider identity fail closed", () => {
  const key = "conflict";
  for (const cost of [
    { input: 1, output: 0 },
    { input: 0, output: 0, unknownBilling: 0 },
  ]) {
    const catalog = merge(key, cost, {}, publicData(key));
    assert.equal(
      classifyModelPricing(
        catalog.models.find((m) => m.id === `opencode/${key}`),
      ),
      "unknown",
    );
  }
});
