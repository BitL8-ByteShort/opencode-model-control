import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attributionEventKey,
  readOrCreateAttributionSalt,
  readUsageAttribution,
  upsertUsageObservation,
} from "../../src/server/usage-attribution-store.js";

test("attribution upserts are idempotent and do not use raw host identifiers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-usage-attr-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, "settings.json");
  const salt = await readOrCreateAttributionSalt(settingsPath);
  const eventKey = attributionEventKey(salt, "ses_live", "msg_live");
  assert.doesNotMatch(eventKey, /ses_live|msg_live/);
  const observation = {
    eventKey,
    observedAt: "2026-09-08T12:00:00.000Z",
    connectionId: "a".repeat(32),
    bindingRevision: "b".repeat(32),
    billingKind: "subscription",
    billingSource: "user-declared",
    tokens: { input: 10, output: 2, reasoning: null, cacheRead: null, cacheWrite: null },
    recordedCost: { amount: 0, currency: null },
    priceSnapshotId: null,
  };
  await upsertUsageObservation({ settingsPath, observation });
  await upsertUsageObservation({
    settingsPath,
    observation: { ...observation, tokens: { ...observation.tokens, input: 10 } },
  });
  const read = await readUsageAttribution({ settingsPath });
  assert.equal(read.observations.length, 1);
  assert.equal(read.observations[0].tokens.input, 10);
  assert.equal(read.coverage.droppedCount, 0);
});

test("concurrent attribution upserts serialize and retain both records", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-usage-attr-conc-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, "settings.json");
  const salt = await readOrCreateAttributionSalt(settingsPath);
  const base = {
    observedAt: "2026-09-08T12:00:00.000Z",
    connectionId: null,
    bindingRevision: null,
    billingKind: "unknown",
    billingSource: "unknown",
    tokens: { input: 1, output: 1, reasoning: null, cacheRead: null, cacheWrite: null },
    recordedCost: null,
    priceSnapshotId: null,
  };
  await Promise.all([
    upsertUsageObservation({
      settingsPath,
      observation: {
        ...base,
        eventKey: attributionEventKey(salt, "s1", "m1"),
      },
    }),
    upsertUsageObservation({
      settingsPath,
      observation: {
        ...base,
        eventKey: attributionEventKey(salt, "s2", "m2"),
      },
    }),
  ]);
  const read = await readUsageAttribution({ settingsPath });
  assert.equal(read.observations.length, 2);
});
