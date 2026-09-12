import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeRates,
  classifyPricingEvidence,
  normalizeApiIdentity,
  normalizeModelsDev,
  resolveModelEvidence,
} from "../../src/core/pricing.js";
const at = "2026-09-07T12:00:00.000Z";
const raw = (cost, extra = {}) => ({
  vendor: {
    id: "vendor",
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.example/v1",
    models: { "nested/new-model": { id: "nested/new-model", cost, ...extra } },
  },
});
const live = {
  id: "vendor/nested/new-model",
  api: {
    id: "nested/new-model",
    npm: "@ai-sdk/openai-compatible",
    url: "https://api.example/v1",
  },
};
const evidence = (cost, extra) =>
  resolveModelEvidence(
    live,
    normalizeModelsDev(raw(cost, extra), { fetchedAt: at }),
  );
test("raw absent, null, and empty URLs are unspecified SDK defaults; malformed and cached invalid stay invalid", () => {
  const cases = [
    [{}, true],
    [{ url: undefined }, true],
    [{ url: null }, true],
    [{ url: "" }, true],
    [{ url: "https://api.x.ai/v1" }, true],
    [{ url: "https://gateway.example/v1" }, true],
    [{ url: "not a url" }, false],
    [{ url: "   " }, false],
    [{ url: "https://user:secret@api.example/v1" }, false],
    [{ url: "https://api.example/v1?key=secret" }, false],
    [{ url: null, urlValid: false }, false],
    [{ url: "", urlValid: false }, false],
  ];
  for (const [value, urlValid] of cases) {
    assert.equal(
      normalizeApiIdentity(value).urlValid,
      urlValid,
      JSON.stringify(value),
    );
  }
  assert.equal(normalizeApiIdentity({ url: "" }).url, null);
  assert.equal(
    normalizeApiIdentity({ url: null, urlValid: false }).urlValid,
    false,
  );
});

test("xai/grok-4.6 empty SDK default and unfamiliar nested IDs match unspecified public endpoints", () => {
  const at = "2026-09-08T12:00:00.000Z";
  for (const [id, npm, cost] of [
    ["xai/grok-4.6", "@ai-sdk/xai", { input: 3, output: 15 }],
    ["unfamiliar/nested/spark-1.3", "@ai-sdk/openai-compatible", { input: 0, output: 0 }],
  ]) {
    const [provider, ...parts] = id.split("/");
    const key = parts.join("/");
    const snapshot = normalizeModelsDev(
      {
        [provider]: {
          id: provider,
          npm,
          models: { [key]: { id: key, cost } },
        },
      },
      { fetchedAt: at },
    );
    const record = snapshot.models[id];
    assert.equal(record.api.url, null);
    assert.equal(record.api.urlValid, true);
    const live = {
      id,
      api: { id: key, npm, url: "" },
    };
    const evidence = resolveModelEvidence(live, snapshot);
    assert.equal(evidence.class, cost.input || cost.output ? "paid" : "free", id);
    assert.equal(evidence.reasons.includes("identity-conflict"), false, id);
  }
});

test("missing public URL does not certify a custom endpoint, and identity mismatch stays distinct from zero rates", () => {
  const at = "2026-09-08T12:00:00.000Z";
  const snapshot = normalizeModelsDev(
    {
      xai: {
        id: "xai",
        npm: "@ai-sdk/xai",
        models: { "grok-4.6": { id: "grok-4.6", cost: { input: 3, output: 15 } } },
      },
    },
    { fetchedAt: at },
  );
  const custom = resolveModelEvidence(
    {
      id: "xai/grok-4.6",
      api: {
        id: "grok-4.6",
        npm: "@ai-sdk/xai",
        url: "https://gateway.example/v1",
      },
    },
    snapshot,
  );
  assert.equal(custom.class, "unknown");
  assert.ok(
    custom.reasons.includes("identity-conflict") ||
      custom.reasons.includes("public-price-route-mismatch"),
  );
  const zero = resolveModelEvidence(
    {
      id: "xai/grok-4.6",
      api: { id: "grok-4.6", npm: "@ai-sdk/xai", url: "" },
    },
    snapshot,
  );
  assert.notEqual(zero.class, "unknown");
  assert.equal(zero.rates.input, 3);
});

test("raw absent, malformed and CLI normalized zeros cannot authorize free", () => {
  for (const cost of [
    undefined,
    {},
    { input: 0 },
    { input: null, output: 0 },
    { input: -1, output: 0 },
    { input: "0", output: 0 },
    { input: 0, output: 0, mystery: 0 },
  ])
    assert.equal(evidence(cost).class, "unknown");
  assert.equal(evidence({ input: 0, output: 0 }).class, "free");
});
test("every supplied billing dimension participates, including tiers, legacy and modes", () => {
  for (const dimension of [
    "input",
    "output",
    "reasoning",
    "cache_read",
    "cache_write",
    "input_audio",
    "output_audio",
  ]) {
    assert.equal(
      evidence({ input: 0, output: 0, [dimension]: 1 }).class,
      "paid",
      dimension,
    );
    assert.equal(
      evidence({ input: 0, output: 0, [dimension]: "invalid" }).class,
      "unknown",
      dimension,
    );
  }
  for (const extra of [
    {
      tiers: [{ tier: { type: "context", size: 200000 }, input: 0, output: 1 }],
    },
    { context_over_200k: { input: 0, output: 1 } },
  ])
    assert.equal(evidence({ input: 0, output: 0, ...extra }).class, "paid");
  assert.equal(
    evidence(
      { input: 0, output: 0 },
      { experimental: { modes: { fast: { cost: { input: 0, output: 2 } } } } },
    ).class,
    "paid",
  );
  assert.equal(
    evidence({
      input: 0,
      output: 0,
      tiers: [
        { tier: { size: 200000 }, input: 0, output: 0 },
        { tier: { size: 200000 }, input: 0, output: 1 },
      ],
    }).class,
    "unknown",
  );
  assert.equal(
    analyzeRates({
      input: 0,
      output: 0,
      tiers: [{ tier: { size: 200000 }, input: 0, output: 0 }],
      context_over_200k: { input: 0, output: 1 },
    }).class,
    "unknown",
  );
});
test("provider, full nested model and API identity are exact, metadata secrets are discarded", () => {
  const snapshot = normalizeModelsDev(
    raw(
      { input: 0, output: 0 },
      {
        headers: { authorization: "secret" },
        provider: { headers: { authorization: "secret" } },
      },
    ),
    { fetchedAt: at },
  );
  assert.equal(resolveModelEvidence(live, snapshot).class, "free");
  for (const api of [
    { ...live.api, id: "new-model" },
    { ...live.api, url: "https://other.example" },
    { ...live.api, npm: "different" },
  ])
    assert.equal(
      resolveModelEvidence({ ...live, api }, snapshot).class,
      "unknown",
    );
  assert.equal(
    resolveModelEvidence({ ...live, id: "other/nested/new-model" }, snapshot)
      .class,
    "unknown",
  );
  assert.equal(
    resolveModelEvidence({ ...live, api: null }, snapshot).class,
    "unknown",
  );
  assert.doesNotMatch(JSON.stringify(snapshot), /authorization|secret/);
});
test("pricing expires at routing time and refreshed repricing supersedes zero", () => {
  const free = evidence({ input: 0, output: 0 });
  assert.equal(
    classifyPricingEvidence(free, { now: Date.parse(at) + 86400000 - 1 }),
    "free",
  );
  assert.equal(
    classifyPricingEvidence(free, { now: Date.parse(at) + 86400000 }),
    "unknown",
  );
  assert.equal(evidence({ input: 1, output: 0 }).class, "paid");
});
test("tier, legacy and mode rates validate every dimension and reject unsupported nested billing", () => {
  for (const dimension of [
    "input",
    "output",
    "reasoning",
    "cache_read",
    "cache_write",
    "input_audio",
    "output_audio",
  ]) {
    for (const value of [0, 2, "bad"]) {
      const rate = { input: 0, output: 0, [dimension]: value };
      const expected =
        value === "bad" ? "unknown" : value === 0 ? "free" : "paid";
      for (const cost of [
        { input: 0, output: 0, context_over_200k: rate },
        {
          input: 0,
          output: 0,
          tiers: [{ ...rate, tier: { size: 250000, type: "context" } }],
        },
      ])
        assert.equal(evidence(cost).class, expected);
      assert.equal(
        evidence(
          { input: 0, output: 0 },
          { experimental: { modes: { fast: { cost: rate } } } },
        ).class,
        expected,
      );
    }
  }
  for (const cost of [
    { input: 0, output: 0, tiers: {} },
    {
      input: 0,
      output: 0,
      tiers: [{ tier: { size: -1 }, input: 0, output: 0 }],
    },
    {
      input: 0,
      output: 0,
      context_over_200k: { input: 0, output: 0, request: 0 },
    },
  ])
    assert.equal(evidence(cost).class, "unknown");
  assert.equal(
    evidence(
      { input: 0, output: 0 },
      { experimental: { modes: { fast: { cost: { input: 0 } } } } },
    ).class,
    "unknown",
  );
});
