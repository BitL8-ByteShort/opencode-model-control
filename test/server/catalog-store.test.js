import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadModelCatalog } from "../../src/core/index.js";
import {
  readCatalogSnapshot,
  writeCatalogSnapshot,
} from "../../src/server/catalog-store.js";

test("catalog snapshots round-trip through an atomic mode-0600 file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-catalog-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "catalog-snapshot.json");
  const catalog = loadModelCatalog();

  const written = await writeCatalogSnapshot(catalog, { path });
  const loaded = await readCatalogSnapshot({ path });

  assert.deepEqual(loaded, written);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path, "utf8")).schemaVersion, catalog.schemaVersion);
});

test("catalog snapshot reads reject invalid JSON and symbolic links", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-catalog-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const invalidPath = join(directory, "invalid.json");
  await writeFile(invalidPath, "{", { mode: 0o600 });

  await assert.rejects(
    readCatalogSnapshot({ path: invalidPath }),
    (error) => error?.code === "CATALOG_SNAPSHOT_INVALID_JSON",
  );

  const targetPath = join(directory, "target.json");
  const linkPath = join(directory, "linked.json");
  await writeFile(targetPath, JSON.stringify(loadModelCatalog()), { mode: 0o600 });
  await symlink(targetPath, linkPath);

  await assert.rejects(
    readCatalogSnapshot({ path: linkPath }),
    (error) => error?.code === "CATALOG_SNAPSHOT_INVALID",
  );
});
