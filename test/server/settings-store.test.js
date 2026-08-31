import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSettings, writeSettings } from "../../src/server/settings-store.js";

test("settings use restrictive permissions and round-trip through migration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omc-settings-"));
  const path = join(directory, "nested", "settings.json");
  const settings = { schemaVersion: 1, primaryModelId: "opencode/big-pickle" };

  await writeSettings(settings, { path });
  const loaded = await readSettings({ path, migrate: (value) => value });
  const fileMode = (await stat(path)).mode & 0o777;

  assert.deepEqual(loaded, settings);
  assert.equal(fileMode, 0o600);
  assert.equal(JSON.parse(await readFile(path, "utf8")).primaryModelId, "opencode/big-pickle");
});

test("missing settings use the provided migration default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omc-settings-missing-"));
  const path = join(directory, "settings.json");
  const defaultValue = { schemaVersion: 1 };
  const loaded = await readSettings({ path, migrate: (value) => value ?? defaultValue });
  assert.equal(loaded, defaultValue);
});
