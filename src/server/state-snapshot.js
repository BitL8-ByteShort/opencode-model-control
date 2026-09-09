import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { migrateSettings, loadModelCatalog } from "../core/index.js";
import {
  readSettings,
  readRawSettings,
  settingsRevision,
} from "./settings-store.js";
import {
  readCatalogSnapshot,
  resolveCatalogSnapshotPath,
} from "./catalog-store.js";
import { readConnectionSnapshot } from "./connection-store.js";
import { withStateLock } from "./state-lock.js";

export const refreshStatusPath = (settingsPath) =>
  join(dirname(settingsPath), "catalog-refresh.json");
const date = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
export async function readRefreshStatus(settingsPath) {
  try {
    const body = await readFile(refreshStatusPath(settingsPath), "utf8");
    if (Buffer.byteLength(body) > 16384)
      throw new Error("Invalid catalog refresh status.");
    const value = JSON.parse(body);
    return {
      attemptedAt: date(value.attemptedAt),
      succeededAt: date(value.succeededAt),
      discoverySucceededAt: date(value.discoverySucceededAt),
      pricingSucceededAt: date(value.pricingSucceededAt),
      complete: value.complete === true,
      status: ["success", "incomplete", "failure"].includes(value.status)
        ? value.status
        : "failure",
      pricingError: value.pricingError === true,
      installed: value.installed === true,
      version:
        typeof value.version === "string" &&
        /^[\w.+-]{1,64}$/.test(value.version)
          ? value.version
          : null,
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function writeRefreshStatus(value, settingsPath) {
  const path = refreshStatusPath(settingsPath),
    temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
// Reusable by panel, MCP, and the OpenCode plugin. All writes to either
// snapshot must hold the same settingsPath lock. No provider requests here.
export async function readControlSnapshot({
  settingsPath,
  catalogSnapshotPath = resolveCatalogSnapshotPath(settingsPath),
  fallbackCatalog = loadModelCatalog(),
  locked = false,
}) {
  const read = async () => {
    const savedCatalog = await readCatalogSnapshot({
      path: catalogSnapshotPath,
    });
    const catalog = savedCatalog ?? fallbackCatalog;
    const settings = await readSettings({
      path: settingsPath,
      migrate: (value) => migrateSettings(value, catalog),
      locked: true,
    });
    const raw = (await readRawSettings(settingsPath)).value;
    const connections = await readConnectionSnapshot({
      settingsPath,
      locked: true,
    });
    return {
      catalog,
      settings,
      connections: connections.connections,
      connectionScopeId: connections.scopeId,
      connectionRevision: connections.revision,
      settingsExists: raw !== undefined,
      catalogExists: savedCatalog !== null,
      settingsRevision: settingsRevision(raw),
      catalogRevision: catalog.revision,
      refresh: await readRefreshStatus(settingsPath),
    };
  };
  return locked ? read() : withStateLock(settingsPath, read);
}
