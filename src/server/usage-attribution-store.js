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
  return withStateLock(settingsPath, () => createSalt(settingsPath));
}

async function createSalt(settingsPath) {
  const path = resolveSaltPath(settingsPath);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== 32) throw new Error("Attribution salt is invalid.");
    const salt = await readFile(path);
    if (salt.length === 32) { await chmod(path, 0o600); return salt; }
    throw new Error("Attribution salt is invalid.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const salt = randomBytes(32);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, salt, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
    return salt;
  } finally {
    await unlink(temporary).catch(() => {});
  }
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
    failedWriteCount: 0,
    lastFailureCode: null,
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
      observations: validateRows(value.observations),
      pending: validateRows(Array.isArray(value.pending) ? value.pending : []),
      failedWriteCount: safeCount(value.failedWriteCount),
      diagnosticSessions: sanitizeSessions(value.diagnosticSessions),
      lastFailureCode: value.lastFailureCode === "ATTRIBUTION_WRITE_FAILED" ? value.lastFailureCode : null,
      droppedCount: safeCount(value.droppedCount),
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
  let pending = store.pending.filter(item => Date.parse(item.observedAt) >= cutoff);
  droppedCount += store.pending.length - pending.length;
  if (pending.length > MAX_PENDING) {
    droppedCount += pending.length - MAX_PENDING;
    pending = pending.slice(pending.length - MAX_PENDING);
  }
  return {
    ...store,
    schemaVersion: 1,
    observations,
    pending,
    droppedCount,
    truncated: store.truncated || droppedCount > store.droppedCount,
  };
}

async function writeStore(path, store) {
  while (Buffer.byteLength(`${JSON.stringify(store)}\n`) > MAX_FILE_BYTES) {
    if (store.observations.length) store.observations.shift();
    else if (store.pending.length) store.pending.shift();
    else throw new Error("Usage attribution is too large.");
    store.truncated = true;
    store.droppedCount++;
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
  pendingEventKey = null,
  now = Date.now(),
} = {}) {
  const path = resolveAttributionPath(settingsPath);
  return withStateLock(settingsPath, async () => {
    const normalized = validateUsageObservation(observation);
    normalized.priceSnapshotId = normalized.priceSnapshot ? digestPriceSnapshot(normalized.priceSnapshot) : null;
    const store = prune(await readStore(path), now);
    const list = pending ? store.pending : store.observations;
    const index = list.findIndex((item) => item.eventKey === normalized.eventKey);
    // Completed assistant messages are immutable and idempotent.
    if (index < 0 && (!pending || !store.observations.some(item => item.eventKey === normalized.eventKey))) list.push(normalized);
    if (!pending) {
      store.pending = store.pending.filter((item) => item.eventKey !== normalized.eventKey && item.eventKey !== pendingEventKey);
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
    const diagnostics = combinedDiagnostics(settingsPath, store);
    const observations = store.observations.filter((item) => {
      const at = Date.parse(item.observedAt);
      return at >= start && at <= end;
    });
    return {
      observations,
      coverage: {
        firstObservedAt: observations[0]?.observedAt ?? null,
        droppedCount: store.droppedCount + (diagnostics.droppedCount ?? 0),
        truncated: store.truncated || (diagnostics.droppedCount ?? 0) > 0,
        pendingCount: store.pending.length + (diagnostics.pendingCount ?? 0),
        failedWriteCount: (store.failedWriteCount + (diagnostics.failedWriteCount ?? 0)),
        partial: store.truncated || store.pending.length > 0 || (diagnostics.pendingCount ?? 0) > 0 || (store.failedWriteCount + (diagnostics.failedWriteCount ?? 0)) > 0 || (diagnostics.droppedCount ?? 0) > 0,
        lastFailureCode: diagnostics.lastFailureCode ?? store.lastFailureCode,
      },
    };
  });
}

export function digestPriceSnapshot(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot ?? null)).digest("hex");
}

function safeCount(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function validateRows(rows) { return rows.map(row => {
  const normalized = validateUsageObservation(row);
  if (normalized.priceSnapshot && normalized.priceSnapshotId !== digestPriceSnapshot(normalized.priceSnapshot)) throw new Error("Usage price evidence is invalid.");
  return normalized;
}); }
const liveDiagnostics = new Map();
function sanitizeSessions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id]) => /^[a-f0-9-]{36}$/.test(id)).slice(-1000).map(([id, counts]) => [id, { failedWriteCount: safeCount(counts?.failedWriteCount), droppedCount: safeCount(counts?.droppedCount) }]));
}
export function setAttributionDiagnostics(settingsPath, diagnostics) {
  if (!liveDiagnostics.has(settingsPath) && liveDiagnostics.size >= 1000) liveDiagnostics.delete(liveDiagnostics.keys().next().value);
  const sessions = liveDiagnostics.get(settingsPath) ?? new Map();
  if (!sessions.has(diagnostics.queueId) && sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
  sessions.set(diagnostics.queueId, diagnostics);
  liveDiagnostics.set(settingsPath, sessions);
}
function combinedDiagnostics(settingsPath, store) {
  const total = { pendingCount: 0, failedWriteCount: 0, droppedCount: 0, lastFailureCode: null };
  for (const [id, state] of liveDiagnostics.get(settingsPath) ?? []) {
    const persisted = store.diagnosticSessions?.[id] ?? {};
    total.pendingCount += state.pendingCount;
    for (const key of ["failedWriteCount", "droppedCount"]) total[key] += Math.max(0, state[key] - safeCount(persisted[key]));
    total.lastFailureCode = state.lastFailureCode ?? total.lastFailureCode;
  }
  return total;
}
export async function persistAttributionDiagnostics(settingsPath, diagnostics) {
  return withStateLock(settingsPath, async () => {
    const path = resolveAttributionPath(settingsPath);
    const store = prune(await readStore(path), Date.now());
    const previous = store.diagnosticSessions?.[diagnostics.queueId] ?? {};
    for (const key of ["failedWriteCount", "droppedCount"]) store[key] += Math.max(0, safeCount(diagnostics[key]) - safeCount(previous[key]));
    store.diagnosticSessions = sanitizeSessions({ ...store.diagnosticSessions, [diagnostics.queueId]: diagnostics });
    store.lastFailureCode = diagnostics.lastFailureCode ?? store.lastFailureCode;
    store.truncated ||= diagnostics.droppedCount > 0;
    await writeStore(path, store);
  });
}
