import * as filesystem from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  MODELS_DEV_URL,
  normalizeModelsDev,
  PRICING_TTL_MS,
} from "../core/pricing.js";
import { publicSnapshotSchema } from "../core/catalog-evidence.js";

const MAX_BYTES = 32 * 1024 * 1024;
const headerValue = (value) =>
  typeof value === "string" && value.length <= 512 && !/[\r\n]/.test(value)
    ? value
    : null;
export const resolveModelsDevCachePath = (settingsPath) =>
  join(dirname(settingsPath), "models-dev-cache.json");
export async function readModelsDevCache({
  path,
  fs = filesystem,
  maxBytes = MAX_BYTES,
}) {
  if (!path) return null;
  try {
    const meta = await fs.lstat(path);
    if (!meta.isFile() || meta.isSymbolicLink() || meta.size > maxBytes)
      throw new Error("Invalid public metadata cache.");
    const body = await fs.readFile(path, "utf8");
    if (Buffer.byteLength(body) > maxBytes)
      throw new Error("Public metadata cache too large.");
    const raw = JSON.parse(body);
    if (raw.version !== 1 || !Number.isFinite(Date.parse(raw.attemptedAt)))
      throw new Error("Invalid public metadata cache.");
    const snapshot = publicSnapshotSchema.parse(raw.snapshot);
    if (
      Date.parse(snapshot.expiresAt) !==
      Date.parse(snapshot.fetchedAt) + PRICING_TTL_MS
    )
      throw new Error("Invalid public metadata expiry.");
    return {
      version: 1,
      snapshot,
      attemptedAt: raw.attemptedAt,
      etag: headerValue(raw.etag),
      lastModified: headerValue(raw.lastModified),
      error: null,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
async function writeCache(value, { path, fs, maxBytes }) {
  if (!path) return;
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload) > maxBytes)
    throw new Error("Public metadata cache too large.");
  const directory = dirname(path);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporary = join(directory, `.models-dev-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, path);
    await fs.chmod(path, 0o600);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}
async function readBounded(response, maxBytes) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes)
    throw new Error("Public metadata response too large.");
  if (!response.body) throw new Error("Empty public metadata response.");
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new Error("Public metadata response too large.");
      parts.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts).toString("utf8");
}
export async function refreshModelsDev({
  path,
  previous,
  fetch = globalThis.fetch,
  now = Date.now,
  fs = filesystem,
  timeoutMs = 8000,
  maxBytes = MAX_BYTES,
} = {}) {
  const attemptedAt = new Date(now()).toISOString();
  let cached = previous ?? null;
  if (!cached && path)
    try {
      cached = await readModelsDevCache({ path, fs, maxBytes });
    } catch {
      /* Invalid cache cannot supply trusted evidence. */
    }
  const headers = { Accept: "application/json" };
  if (cached?.etag) headers["If-None-Match"] = headerValue(cached.etag);
  if (cached?.lastModified)
    headers["If-Modified-Since"] = headerValue(cached.lastModified);
  const controller = new AbortController();
  let timeout;
  try {
    const operation = (async () => {
      const response = await fetch(MODELS_DEV_URL, {
        headers,
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      const fetchedAt = new Date(now()).toISOString();
      if (response.status === 304) {
        if (!cached?.snapshot)
          throw new Error("Revalidation requires a cache.");
        const snapshot = publicSnapshotSchema.parse(cached.snapshot);
        snapshot.fetchedAt = fetchedAt;
        snapshot.expiresAt = new Date(
          Date.parse(fetchedAt) + PRICING_TTL_MS,
        ).toISOString();
        for (const model of Object.values(snapshot.models))
          model.capabilities.observedAt = fetchedAt;
        return {
          ...cached,
          snapshot,
          attemptedAt,
          etag: headerValue(response.headers.get("etag")) ?? cached.etag,
          lastModified:
            headerValue(response.headers.get("last-modified")) ??
            cached.lastModified,
          error: null,
        };
      }
      if (response.status !== 200)
        throw new Error("Public metadata fetch failed.");
      const body = await readBounded(response, maxBytes);
      const digest = createHash("sha256").update(body).digest("hex");
      const snapshot = normalizeModelsDev(JSON.parse(body), {
        fetchedAt: new Date(now()).toISOString(),
        digest,
      });
      return {
        version: 1,
        snapshot,
        attemptedAt,
        etag: headerValue(response.headers.get("etag")),
        lastModified: headerValue(response.headers.get("last-modified")),
        error: null,
      };
    })();
    const result = await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Public metadata fetch timed out."));
        }, timeoutMs);
      }),
    ]);
    await writeCache(result, { path, fs, maxBytes });
    return result;
  } catch {
    const result = {
      version: 1,
      snapshot: cached?.snapshot ?? null,
      etag: cached?.etag ?? null,
      lastModified: cached?.lastModified ?? null,
      attemptedAt,
      error: {
        code: "MODELS_DEV_UNAVAILABLE",
        message:
          "Public model metadata could not be refreshed. The last successful snapshot was kept.",
      },
    };
    if (result.snapshot)
      await writeCache(result, { path, fs, maxBytes }).catch(() => {});
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
