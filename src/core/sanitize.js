import { CURRENT_RESULT_VERSION, MODEL_ROLES } from "./constants.js";

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:+/-]*$/i;
const SAFE_STATUSES = new Set([
  "completed",
  "failed",
  "blocked",
  "timed-out",
  "cancelled",
]);
const SAFE_ARTIFACT_KINDS = new Set(["file", "directory", "report", "image", "log"]);
const METRIC_KEYS = Object.freeze([
  "durationMs",
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningTokens",
  "requestCount",
  "retryCount",
]);

const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi;
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s]+/gi;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/=-]{6,}/gi;
const CREDENTIAL_PATTERN =
  /\b(?:[a-z0-9]+[_-])*(?:api[_ -]?key|access[_ -]?(?:token|key)|refresh[_ -]?token|token|client[_ -]?secret|authorization|password|passwd|private[_ -]?key|secret)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const UNIX_PRIVATE_PATH_PATTERN =
  /(?:^|\s)\/(?:Users|home|private|tmp|var|etc)\/[A-Za-z0-9._~!$&'()+,;=:@%/-]*/g;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\s]+/g;
const OPAQUE_DATA_PATTERN = /\b[A-Za-z0-9+/=_-]{96,}\b/g;

export function sanitizeText(value, limit = 2_000) {
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 10_000) : 2_000;
  let text = typeof value === "string" ? value : "";
  text = text
    .replace(PRIVATE_KEY_PATTERN, "[private-key-redacted]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(CREDENTIAL_PATTERN, "[credential]=[redacted]")
    .replace(URL_PATTERN, "[url]")
    .replace(UNIX_PRIVATE_PATH_PATTERN, (match) =>
      match.startsWith(" ") ? " [path]" : "[path]",
    )
    .replace(WINDOWS_PATH_PATTERN, "[path]")
    .replace(OPAQUE_DATA_PATTERN, "[opaque-data]");
  if (text.length <= boundedLimit) return text;
  const marker = "…[truncated]";
  return text.slice(0, Math.max(0, boundedLimit - marker.length)) + marker;
}

function safeArtifact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const path = value.path;
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > 1_024 ||
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.split(/[\\/]/).some((part) => part === "..")
  ) {
    return null;
  }
  const kind = SAFE_ARTIFACT_KINDS.has(value.kind) ? value.kind : "file";
  return { path, kind };
}

function safeMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const metrics = {};
  for (const key of METRIC_KEYS) {
    const metric = value[key];
    if (typeof metric === "number" && Number.isFinite(metric) && metric >= 0) {
      metrics[key] = metric;
    }
  }
  return metrics;
}

function safeErrors(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((error) => {
    const rawCode = typeof error?.code === "string" ? error.code : "WORKER_ERROR";
    const normalized = rawCode.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
    return {
      code: normalized || "WORKER_ERROR",
      message: sanitizeText(error?.message, 500),
    };
  });
}

export function sanitizeResult(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const status = SAFE_STATUSES.has(raw.status) ? raw.status : "failed";
  const modelId =
    typeof raw.modelId === "string" && MODEL_ID_PATTERN.test(raw.modelId)
      ? raw.modelId
      : null;
  const role = MODEL_ROLES.includes(raw.role) ? raw.role : null;
  const attemptCount =
    Number.isInteger(raw.attemptCount) && raw.attemptCount >= 0
      ? Math.min(raw.attemptCount, 2)
      : 0;
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.map(safeArtifact).filter(Boolean).slice(0, 50)
    : [];

  return {
    schemaVersion: CURRENT_RESULT_VERSION,
    status,
    modelId,
    role,
    summary: sanitizeText(raw.summary),
    terminalSeen: raw.terminalSeen === true,
    attemptCount,
    artifacts,
    metrics: safeMetrics(raw.metrics),
    errors: safeErrors(raw.errors),
  };
}
