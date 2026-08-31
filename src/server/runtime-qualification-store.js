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

const MAX_HISTORY_BYTES = 256 * 1024;
const MAX_RESULTS = 50;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:+/-]*$/i;
const RESULT_STATUSES = new Set(["passed", "failed"]);

function invalidHistory(message) {
  throw Object.assign(new Error(message), { code: "RUNTIME_QUALIFICATION_HISTORY_INVALID" });
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeFailure(value) {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.code !== "string" ||
    !/^[A-Z][A-Z0-9_]{1,63}$/u.test(value.code) ||
    typeof value.message !== "string" ||
    !value.message.trim() ||
    value.message.length > 300
  ) {
    invalidHistory("A runtime-check result has invalid failure metadata.");
  }
  return { code: value.code, message: value.message.trim() };
}

function normalizeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidHistory("Every runtime-check result must be an object.");
  }
  if (typeof value.id !== "string" || !/^[0-9a-f-]{36}$/iu.test(value.id)) {
    invalidHistory("A runtime-check result has an invalid ID.");
  }
  if (typeof value.modelId !== "string" || !MODEL_ID_PATTERN.test(value.modelId)) {
    invalidHistory("A runtime-check result has an invalid model ID.");
  }
  if (!RESULT_STATUSES.has(value.status)) {
    invalidHistory("A runtime-check result has an invalid status.");
  }
  if (!validTimestamp(value.startedAt) || !validTimestamp(value.completedAt)) {
    invalidHistory("A runtime-check result has an invalid timestamp.");
  }
  if (!Number.isInteger(value.durationMs) || value.durationMs < 0 || value.durationMs > 300_000) {
    invalidHistory("A runtime-check result has an invalid duration.");
  }
  if (
    value.evidenceType !== "runtime-access-only" ||
    ![true, false, null].includes(value.providerRequestAttempted) ||
    value.externalPluginsDisabled !== true ||
    value.isolatedWorkingDirectory !== true ||
    value.promptKind !== "fixed-synthetic-sentinel" ||
    typeof value.responseMatched !== "boolean" ||
    (value.exitCode !== null && (!Number.isInteger(value.exitCode) || value.exitCode < 0)) ||
    (value.openCodeVersion !== null &&
      (typeof value.openCodeVersion !== "string" || value.openCodeVersion.length > 64))
  ) {
    invalidHistory("A runtime-check result has invalid execution metadata.");
  }

  const failure = normalizeFailure(value.failure);
  if ((value.status === "passed") !== (value.responseMatched === true && failure === null)) {
    invalidHistory("A runtime-check result has inconsistent outcome metadata.");
  }
  if (value.status === "passed" && value.providerRequestAttempted !== true) {
    invalidHistory("A passing runtime-check result must include observed provider-response evidence.");
  }

  return {
    id: value.id,
    modelId: value.modelId,
    status: value.status,
    evidenceType: "runtime-access-only",
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    durationMs: value.durationMs,
    openCodeVersion: value.openCodeVersion,
    providerRequestAttempted: value.providerRequestAttempted,
    externalPluginsDisabled: true,
    isolatedWorkingDirectory: true,
    promptKind: "fixed-synthetic-sentinel",
    responseMatched: value.responseMatched,
    exitCode: value.exitCode,
    failure,
  };
}

export function emptyRuntimeQualificationHistory() {
  return { schemaVersion: 1, updatedAt: null, results: [] };
}

export function validateRuntimeQualificationHistory(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    (value.updatedAt !== null && !validTimestamp(value.updatedAt)) ||
    !Array.isArray(value.results) ||
    value.results.length > MAX_RESULTS
  ) {
    invalidHistory("Runtime-check history has an unsupported or invalid shape.");
  }

  const results = value.results.map(normalizeResult);
  if (new Set(results.map(({ id }) => id)).size !== results.length) {
    invalidHistory("Runtime-check history contains duplicate result IDs.");
  }
  return { schemaVersion: 1, updatedAt: value.updatedAt, results };
}

export function resolveRuntimeQualificationHistoryPath(settingsPath) {
  return join(dirname(settingsPath), "runtime-qualification-results.json");
}

export async function readRuntimeQualificationHistory({ path }) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      invalidHistory("Runtime-check history must be a regular file.");
    }
    if (metadata.size > MAX_HISTORY_BYTES) {
      throw Object.assign(new Error("Runtime-check history is too large."), {
        code: "RUNTIME_QUALIFICATION_HISTORY_TOO_LARGE",
      });
    }
    return validateRuntimeQualificationHistory(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyRuntimeQualificationHistory();
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error("Runtime-check history is not valid JSON."), {
        code: "RUNTIME_QUALIFICATION_HISTORY_INVALID_JSON",
      });
    }
    throw error;
  }
}

export async function writeRuntimeQualificationHistory(history, { path }) {
  const normalized = validateRuntimeQualificationHistory(history);
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(payload) > MAX_HISTORY_BYTES) {
    throw Object.assign(new Error("Runtime-check history is too large."), {
      code: "RUNTIME_QUALIFICATION_HISTORY_TOO_LARGE",
    });
  }

  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = join(directory, `.runtime-qualification-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Best-effort cleanup; preserve the original write failure.
    }
    throw error;
  }
  return normalized;
}

export async function appendRuntimeQualificationResult(history, result, { path }) {
  const normalizedResult = normalizeResult(result);
  const previous = validateRuntimeQualificationHistory(history);
  return writeRuntimeQualificationHistory({
    schemaVersion: 1,
    updatedAt: normalizedResult.completedAt,
    results: [normalizedResult, ...previous.results].slice(0, MAX_RESULTS),
  }, { path });
}
