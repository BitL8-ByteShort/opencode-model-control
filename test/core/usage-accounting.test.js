import assert from "node:assert/strict";
import test from "node:test";
import {
  costLabel,
  estimateApiCost,
  nullableFinite,
  sumNullable,
  validateUsageObservation,
} from "../../src/core/usage-accounting.js";

test("missing usage stays null and explicit zero stays zero", () => {
  assert.equal(nullableFinite(null), null);
  assert.equal(nullableFinite(0), 0);
  assert.equal(sumNullable([null, null]), null);
  assert.equal(sumNullable([null, 0]), 0);
  assert.throws(() => nullableFinite(-1), (error) => error.code === "INVALID_USAGE");
});

test("API estimates require known dimensions and do not invent zero", () => {
  assert.equal(
    estimateApiCost({
      rates: { input: 1, output: 2 },
      tokens: { input: null, output: 10 },
    }).status,
    "unavailable",
  );
  assert.equal(
    estimateApiCost({
      rates: { input: 1, output: 2 },
      tokens: { input: 1_000_000, output: 1_000_000 },
    }).amount,
    3,
  );
  assert.equal(
    estimateApiCost({
      rates: { input: 1, output: 2 },
      tokens: { input: 1, output: 1, cacheRead: 1 },
      semantics: { cacheIncludedInInput: false },
    }).status,
    "partial",
  );
});

test("observations keep billing provenance and reject mixed invalid numbers", () => {
  const observation = validateUsageObservation({
    eventKey: "a".repeat(64),
    observedAt: "2026-09-08T12:00:00.000Z",
    connectionId: null,
    bindingRevision: null,
    billingKind: "unknown",
    billingSource: "unknown",
    tokens: { input: 1, output: 0, reasoning: null, cacheRead: null, cacheWrite: null },
    recordedCost: { amount: 0, currency: null },
    priceSnapshotId: null,
  });
  assert.equal(observation.recordedCost.amount, 0);
  assert.equal(observation.tokens.reasoning, null);
  assert.equal(costLabel("opencode-recorded"), "OpenCode-recorded cost");
  assert.equal(costLabel("unknown"), "Not reported");
});

test('estimates reject invalid rates, unsupported audio/tiering and unknown overlapping token semantics', () => {
  const tokens = { input: 10, output: 2 };
  for (const rates of [{ input: -1, output: 1 }, { input: '1', output: 1 }, { input: 1, output: Infinity }, { input: 1, output: 1, input_audio: 2 }, { input: 1, output: 1, tiers: [] }]) {
    assert.equal(estimateApiCost({ rates, tokens }).amount, null);
  }
  assert.equal(estimateApiCost({ rates: { input: 1, output: 1, reasoning: 1 }, tokens: { ...tokens, reasoning: 3 } }).amount, null);
  assert.equal(estimateApiCost({ rates: { input: 1, output: 1 }, tokens, semantics: { audioRequired: true } }).amount, null);
});
