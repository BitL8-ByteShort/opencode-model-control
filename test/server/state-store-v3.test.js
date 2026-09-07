import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSettings,
  writeSettings,
} from "../../src/server/settings-store.js";
import {
  createDefaultSettings,
  migrateSettings,
} from "../../src/core/index.js";
import { loadModelCatalog } from "../fixtures/catalog.js";

test("legacy migration is persisted atomically with an exact private backup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-v3-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const old = {
    ...createDefaultSettings(loadModelCatalog()),
    schemaVersion: 2,
    modelControls: { "old/model": { enabled: false, available: false } },
  };
  await writeSettings(old, { path });
  const before = await readFile(path, "utf8");
  const loaded = await readSettings({
    path,
    migrate: (v) => migrateSettings(v, loadModelCatalog()),
  });
  assert.equal(JSON.parse(await readFile(path, "utf8")).schemaVersion, 3);
  const backups = (await readdir(directory)).filter((name) =>
    name.includes("backup"),
  );
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(directory, backups[0]), "utf8"), before);
  assert.equal((await stat(join(directory, backups[0]))).mode & 0o777, 0o600);
  assert.equal(loaded.modelControls["old/model"].selection, "disabled");
});

test("concurrent compare-and-swap saves cannot lose a settings update", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-v3-cas-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const store = await import("../../src/server/settings-store.js");
  assert.equal(typeof store.settingsRevision, "function");
  const initial = createDefaultSettings(loadModelCatalog());
  await writeSettings(initial, { path });
  const expectedRevision = store.settingsRevision(initial);
  const results = await Promise.allSettled([
    writeSettings(
      { ...initial, costPreference: "paid-first" },
      { path, expectedRevision },
    ),
    writeSettings(
      { ...initial, maxDelegationDepth: 0 },
      { path, expectedRevision },
    ),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    results.find((x) => x.status === "rejected").reason.statusCode,
    409,
  );
});

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const runner = new URL("../fixtures/state-process.mjs", import.meta.url);
test("two independent Node processes serialize a shared CAS revision", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-v3-process-cas-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const { settingsRevision } = await import(
    "../../src/server/settings-store.js"
  );
  const initial = createDefaultSettings(loadModelCatalog());
  await writeSettings(initial, { path });
  const run = (field) =>
    exec(process.execPath, [
      runner.pathname,
      "cas",
      path,
      settingsRevision(initial),
      field,
    ]);
  const outcomes = (
    await Promise.all([run("makeRouterDefault"), run("maxDelegationDepth")])
  )
    .map((r) => r.stdout)
    .sort();
  assert.deepEqual(outcomes, ["409", "saved"]);
});
test("two active processes share one metadata refresh lease and publish the same snapshot", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-v3-process-refresh-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const run = () => exec(process.execPath, [runner.pathname, "refresh", path]);
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a.stdout, b.stdout);
  assert.equal(await readFile(`${path}.attempts`, "utf8"), "fetch\n");
});
test("a terminated writer leaves a reclaimable lock rather than permanently blocking settings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-v3-process-dead-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const child = spawn(process.execPath, [runner.pathname, "hold", path], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
  });
  const ended = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await ended;
  await writeSettings({ saved: true }, { path });
  assert.equal(JSON.parse(await readFile(path, "utf8")).saved, true);
});

test("a live recovery fence excludes new owners and a dead recovery fence is reclaimed", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-v3-reaper-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const child = spawn(
    process.execPath,
    [runner.pathname, "hold-reaper", `${path}.lock`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
  });
  const { acquireFileLock } = await import("../../src/server/state-lock.js");
  const release = await acquireFileLock(`${path}.lock`, { waitMs: 40 });
  if (release) await release();
  assert.equal(release, null);
  const ended = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await ended;
  await writeSettings({ recovered: true }, { path });
  assert.equal(JSON.parse(await readFile(path, "utf8")).recovered, true);
});

test("snapshot loader distinguishes absent intent/catalog from defaults and rejects corrupt saved files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-v3-snapshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, "settings.json");
  const { readControlSnapshot } = await import(
    "../../src/server/state-snapshot.js"
  );
  let snapshot = await readControlSnapshot({ settingsPath });
  assert.equal(snapshot.settingsExists, false);
  assert.equal(snapshot.catalogExists, false);
  await writeSettings(createDefaultSettings(loadModelCatalog()), {
    path: settingsPath,
  });
  snapshot = await readControlSnapshot({ settingsPath });
  assert.equal(snapshot.settingsExists, true);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(directory, "catalog-snapshot.json"), "invalid");
  await assert.rejects(
    readControlSnapshot({ settingsPath }),
    (e) => e.code === "CATALOG_SNAPSHOT_INVALID_JSON",
  );
  await rm(join(directory, "catalog-snapshot.json"));
  await writeFile(settingsPath, "invalid");
  await assert.rejects(
    readControlSnapshot({ settingsPath }),
    (e) => e.code === "SETTINGS_INVALID_JSON",
  );
});

test("stale truncated or malformed ownership records are recoverable for settings locks and refresh leases", async (t) => {
  const { mkdir, writeFile, utimes } = await import("node:fs/promises");
  const { acquireFileLock } = await import("../../src/server/state-lock.js");
  const directory = await mkdtemp(join(tmpdir(), "omc-owner-truncated-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [index, body] of [
    "",
    '{"pid":',
    "{}",
    "null",
    '{"pid":99999999999,"token":"bad"}',
  ].entries()) {
    for (const suffix of ["lock", "refresh-lease"]) {
      const path = join(directory, `${index}.${suffix}`);
      await mkdir(path);
      await writeFile(join(path, "owner.json"), body);
      const old = new Date(Date.now() - 11000);
      await utimes(path, old, old);
      const release = await acquireFileLock(path, { waitMs: 70 });
      assert.equal(typeof release, "function", `${suffix}: ${body}`);
      await release();
    }
  }
});

test("owner publication hides partial bytes and keeps a complete live owner exclusive", async (t) => {
  const fs = await import("node:fs/promises");
  const { acquireFileLock } = await import("../../src/server/state-lock.js");
  const directory = await mkdtemp(join(tmpdir(), "omc-owner-publish-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.lock");
  let start, finish;
  const began = new Promise((resolve) => {
    start = resolve;
  });
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = acquireFileLock(path, {
    fs: {
      ...fs,
      writeFile: async (file, payload, options) => {
        await fs.writeFile(file, "{", options);
        start();
        await gate;
        await fs.writeFile(file, payload, { mode: 0o600 });
      },
    },
  });
  const first = await Promise.race([
    began.then(() => "writing"),
    pending.then(() => "published"),
  ]);
  if (first === "published") {
    await (
      await pending
    )();
    assert.fail(
      "Lock was published without exercising the filesystem write boundary.",
    );
  }
  let exposed;
  try {
    exposed = await readFile(join(path, "owner.json"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const oldPending = new Date(Date.now() - 11000);
  await fs.utimes(path, oldPending, oldPending);
  const contended = await acquireFileLock(path, { waitMs: 40 });
  finish();
  const release = await pending;
  assert.equal(exposed, undefined);
  assert.equal(contended, null);
  const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
  assert.equal(owner.pid, process.pid);
  const old = new Date(Date.now() - 11000);
  await fs.utimes(path, old, old);
  assert.equal(await acquireFileLock(path, { waitMs: 40 }), null);
  await release();
});
