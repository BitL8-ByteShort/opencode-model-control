import { createHmac, randomBytes, createHash } from "node:crypto";
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
import { validateUsageObservation } from "../core/usage-accounting.js";
import { withStateLock } from "./state-lock.js";

const MAX_RECORDS = 10_000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PENDING = 1_000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = MAX_BYTES;

export function resolveAttributionPath(settingsPath) {
  return join(dirname(settingsPath), "usage-attribution.json");
}

function resolveSaltPath(settingsPath) {
  return join(dirname(settingsPath), "usage-attribution.salt");
}

export async function readOrCreateAttributionSalt(settingsPath) {
  const path = resolveSaltPath(settingsPath);
  try {
    const salt = await readFile(path);
    if (salt.length >= 32) return salt;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const salt = randomBytes(32);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, salt, { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return salt;
}

export function attributionEventKey(salt, sessionId, messageId) {
  return createHmac("sha256", salt)
    .update(`${sessionId}\0${messageId}`)
    .digest("hex");
}

function emptyStore() {
  return {
    schemaVersion: 1,
    observations: [],
    pending: [],
    droppedCount: 0,
    truncated: false,
  };
}

async function readStore(path) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw Object.assign(new Error("Usage attribution must be a regular file."), {
        code: "USAGE_ATTRIBUTION_INVALID",
      });
    }
    if (metadata.size > MAX_FILE_BYTES) {
      throw Object.assign(new Error("Usage attribution is too large."), {
        code: "USAGE_ATTRIBUTION_TOO_LARGE",
      });
    }
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.observations))
      return { ...emptyStore(), droppedCount: 1, truncated: true };
    return {
      schemaVersion: 1,
      observations: value.observations,
      pending: Array.isArray(value.pending) ? value.pending : [],
      droppedCount: Number.isInteger(value.droppedCount) ? value.droppedCount : 0,
      truncated: value.truncated === true,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return emptyStore();
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error("Usage attribution is not valid JSON."), {
        code: "USAGE_ATTRIBUTION_INVALID_JSON",
      });
    }
    throw error;
  }
}

function prune(store, now) {
  const cutoff = now - RETENTION_MS;
  let observations = store.observations.filter(
    (item) => Date.parse(item.observedAt) >= cutoff,
  );
  let droppedCount = store.droppedCount + (store.observations.length - observations.length);
  if (observations.length > MAX_RECORDS) {
    droppedCount += observations.length - MAX_RECORDS;
    observations = observations.slice(observations.length - MAX_RECORDS);
  }
  let pending = store.pending;
  if (pending.length > MAX_PENDING) {
    droppedCount += pending.length - MAX_PENDING;
    pending = pending.slice(pending.length - MAX_PENDING);
  }
  return {
    schemaVersion: 1,
    observations,
    pending,
    droppedCount,
    truncated: store.truncated || droppedCount > store.droppedCount,
  };
}

async function writeStore(path, store) {
  const payload = `${JSON.stringify(store)}\n`;
  if (Buffer.byteLength(payload) > MAX_FILE_BYTES) {
    store.observations = store.observations.slice(-Math.floor(MAX_RECORDS / 2));
    store.truncated = true;
    store.droppedCount += 1;
  }
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = join(directory, `.usage-attribution-${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(store)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {
      /* original error is more useful */
    }
    throw error;
  }
}

export async function upsertUsageObservation({
  settingsPath,
  observation,
  pending = false,
  now = Date.now(),
} = {}) {
  const path = resolveAttributionPath(settingsPath);
  return withStateLock(settingsPath, async () => {
    const normalized = validateUsageObservation(observation);
    const store = prune(await readStore(path), now);
    const list = pending ? store.pending : store.observations;
    const index = list.findIndex((item) => item.eventKey === normalized.eventKey);
    if (index >= 0) list[index] = normalized;
    else list.push(normalized);
    if (!pending) {
      store.pending = store.pending.filter((item) => item.eventKey !== normalized.eventKey);
    }
    await writeStore(path, prune(store, now));
  });
}

export async function readUsageAttribution({
  settingsPath,
  from,
  to,
  now = Date.now(),
} = {}) {
  const path = resolveAttributionPath(settingsPath);
  return withStateLock(settingsPath, async () => {
    const store = prune(await readStore(path), now);
    const start = from ? Date.parse(from) : 0;
    const end = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
    const observations = store.observations.filter((item) => {
      const at = Date.parse(item.observedAt);
      return at >= start && at <= end;
    });
    return {
      observations,
      coverage: {
        firstObservedAt: observations[0]?.observedAt ?? null,
        droppedCount: store.droppedCount,
        truncated: store.truncated,
      },
    };
  });
}

export function digestPriceSnapshot(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot ?? null)).digest("hex");
}
