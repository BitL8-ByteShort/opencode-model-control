import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendRuntimeQualificationResult,
  emptyRuntimeQualificationHistory,
  readRuntimeQualificationHistory,
} from "../../src/server/runtime-qualification-store.js";

function result(overrides = {}) {
  return {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    modelId: "opencode/example-model",
    status: "passed",
    evidenceType: "runtime-access-only",
    startedAt: "2026-08-31T12:00:00.000Z",
    completedAt: "2026-08-31T12:00:01.000Z",
    durationMs: 1000,
    openCodeVersion: "1.18.22",
    providerRequestAttempted: true,
    externalPluginsDisabled: true,
    isolatedWorkingDirectory: true,
    promptKind: "fixed-synthetic-sentinel",
    responseMatched: true,
    exitCode: 0,
    failure: null,
    ...overrides,
  };
}

test("runtime-check evidence is atomic, private, bounded metadata", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-runtime-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "runtime-qualification-results.json");

  const history = await appendRuntimeQualificationResult(
    emptyRuntimeQualificationHistory(),
    result(),
    { path },
  );
  const loaded = await readRuntimeQualificationHistory({ path });

  assert.deepEqual(loaded, history);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  const persisted = await readFile(path, "utf8");
  assert.equal(persisted.includes("OMC_RUNTIME_OK"), false);
  assert.equal(persisted.includes("prompt"), true);
});

test("runtime-check evidence preserves an unknown or confirmed-negative provider attempt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-runtime-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "runtime-qualification-results.json");

  const unknown = result({
    status: "failed",
    providerRequestAttempted: null,
    responseMatched: false,
    exitCode: 7,
    failure: { code: "RUNTIME_CHECK_FAILED", message: "The provider check failed." },
  });
  const history = await appendRuntimeQualificationResult(
    emptyRuntimeQualificationHistory(),
    unknown,
    { path },
  );
  assert.equal(history.results[0].providerRequestAttempted, null);

  const notAttempted = result({
    id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
    status: "failed",
    providerRequestAttempted: false,
    responseMatched: false,
    exitCode: null,
    failure: { code: "OPENCODE_NOT_FOUND", message: "OpenCode was not found." },
  });
  const updated = await appendRuntimeQualificationResult(history, notAttempted, { path });
  assert.equal(updated.results[0].providerRequestAttempted, false);
});

test("runtime-check evidence rejects invalid JSON and symbolic links", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-runtime-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const invalidPath = join(directory, "invalid.json");
  await writeFile(invalidPath, "{", { mode: 0o600 });
  await assert.rejects(
    readRuntimeQualificationHistory({ path: invalidPath }),
    (error) => error?.code === "RUNTIME_QUALIFICATION_HISTORY_INVALID_JSON",
  );

  const target = join(directory, "target.json");
  const link = join(directory, "link.json");
  await writeFile(target, JSON.stringify(emptyRuntimeQualificationHistory()), { mode: 0o600 });
  await symlink(target, link);
  await assert.rejects(
    readRuntimeQualificationHistory({ path: link }),
    (error) => error?.code === "RUNTIME_QUALIFICATION_HISTORY_INVALID",
  );
});
