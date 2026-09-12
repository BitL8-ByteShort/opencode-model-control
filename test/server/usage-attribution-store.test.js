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

test('simultaneous startup publishes a single stable private salt', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'omc-salt-race-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, 'settings.json');
  const salts = await Promise.all(Array.from({ length: 20 }, () => readOrCreateAttributionSalt(settingsPath)));
  assert.equal(new Set(salts.map(salt => salt.toString('hex'))).size, 1);
});

test('read rejects malformed rows without echoing payload and prunes old pending rows', async (t) => {
  const { writeFile } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'omc-attr-validation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, 'settings.json');
  await writeFile(join(directory, 'usage-attribution.json'), JSON.stringify({ schemaVersion: 1, observations: [{ eventKey: 'secret' }] }));
  await assert.rejects(readUsageAttribution({ settingsPath }), error => !error.message.includes('secret'));
  const row = { eventKey: 'a'.repeat(64), observedAt: '2025-01-01T00:00:00Z', connectionId: null, bindingRevision: null, billingKind: 'unknown', billingSource: 'unknown', tokens: {}, recordedCost: null, priceSnapshotId: null };
  await writeFile(join(directory, 'usage-attribution.json'), JSON.stringify({ schemaVersion: 1, observations: [], pending: [row] }));
  const result = await readUsageAttribution({ settingsPath, now: Date.parse('2026-09-08') });
  assert.equal(result.coverage.pendingCount, 0);
  assert.equal(result.coverage.droppedCount, 1);
  assert.equal(result.coverage.partial, true);
});

test('write failure diagnostics remain visible after recovery without leaking the error', async (t) => {
  const { createAttributionQueue } = await import('../../src/server/attribution-queue.js');
  const { setAttributionDiagnostics, persistAttributionDiagnostics } = await import('../../src/server/usage-attribution-store.js');
  const directory = await mkdtemp(join(tmpdir(), 'omc-attr-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, 'settings.json');
  const queue = createAttributionQueue({ onState: state => setAttributionDiagnostics(settingsPath, state), persist: state => persistAttributionDiagnostics(settingsPath, state) });
  queue.enqueue(async () => { throw new Error('private prompt /secret/path'); });
  await queue.flush();
  queue.enqueue(async () => {});
  await queue.flush();
  const { coverage } = await readUsageAttribution({ settingsPath });
  assert.equal(coverage.failedWriteCount, 1);
  assert.equal(coverage.partial, true);
  assert.equal(coverage.lastFailureCode, 'ATTRIBUTION_WRITE_FAILED');
  assert.doesNotMatch(JSON.stringify(coverage), /private|secret/);
});

test('historical rate evidence is immutable, sanitized, and independent of current rates', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'omc-attr-price-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, 'settings.json');
  const observation = { eventKey: 'b'.repeat(64), observedAt: new Date().toISOString(), connectionId: null, bindingRevision: null, billingKind: 'unknown', billingSource: 'unknown', tokens: { input: 10 }, recordedCost: null, priceSnapshotId: null, priceSnapshot: { rates: { input: 1, output: 2 }, source: 'https://models.dev/api.json', fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+86400000).toISOString(), secret: 'must not persist' } };
  await upsertUsageObservation({ settingsPath, observation });
  observation.priceSnapshot.rates.input = 99;
  await upsertUsageObservation({ settingsPath, observation });
  const row = (await readUsageAttribution({ settingsPath })).observations[0];
  assert.equal(row.priceSnapshot.rates.input, 1);
  assert.equal(row.priceSnapshot.semantics, null);
  assert.match(row.priceSnapshotId, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(row), /must not persist/);
});
