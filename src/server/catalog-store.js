import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { validateCatalog } from "../core/index.js";

const MAX_CATALOG_SNAPSHOT_BYTES = 32 * 1024 * 1024;

export function resolveCatalogSnapshotPath(settingsPath) {
  return join(dirname(settingsPath), "catalog-snapshot.json");
}

export async function readCatalogSnapshot({ path }) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw Object.assign(new Error("Catalog snapshot must be a regular file."), {
        code: "CATALOG_SNAPSHOT_INVALID",
      });
    }
    if (metadata.size > MAX_CATALOG_SNAPSHOT_BYTES) {
      throw Object.assign(new Error("Catalog snapshot is too large."), {
        code: "CATALOG_SNAPSHOT_TOO_LARGE",
      });
    }
    return validateCatalog(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error("Catalog snapshot is not valid JSON."), {
        code: "CATALOG_SNAPSHOT_INVALID_JSON",
      });
    }
    throw error;
  }
}

export async function writeCatalogSnapshot(catalog, { path }) {
  const normalized = validateCatalog(catalog);
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(payload) > MAX_CATALOG_SNAPSHOT_BYTES) {
    throw Object.assign(new Error("Catalog snapshot is too large."), {
      code: "CATALOG_SNAPSHOT_TOO_LARGE",
    });
  }

  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = join(directory, `.catalog-snapshot-${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Best-effort cleanup; the original error is more useful to the caller.
    }
    throw error;
  }

  return normalized;
}
