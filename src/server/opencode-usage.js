import { execFile as nodeExecFile } from "node:child_process";

export const DEFAULT_USAGE_WINDOW = "30d";
export const USAGE_WINDOWS = Object.freeze({
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
});

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_MODEL_ROWS = 250;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/u;
const CAVEATS = Object.freeze([
  "Token counts are usage. OpenCode-recorded cost is not a provider bill or subscription charge.",
  "Missing cost or token fields stay unreported instead of becoming zero.",
  "Historical OpenCode totals are not classified by today's login or billing mode.",
  "Cache-read tokens are cumulative usage, not the current context size.",
  "Plan quota is not reported unless a supported host adapter exposes it.",
]);

function usageError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function execute(file, args, options, execFile = nodeExecFile) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout = "", stderr = "") => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function validateUsageWindow(value = DEFAULT_USAGE_WINDOW) {
  if (typeof value !== "string" || !Object.hasOwn(USAGE_WINDOWS, value)) {
    throw usageError(
      "INVALID_USAGE_WINDOW",
      "Usage window must be one of 7d, 30d, 90d, or all.",
      400,
    );
  }
  return value;
}

function windowFilter(window) {
  const days = USAGE_WINDOWS[window];
  if (days === null) return "1 = 1";
  return `message.time_created >= CAST(strftime('%s', 'now', '-${days} days') AS INTEGER) * 1000`;
}

export function usageSqlForWindow(input = DEFAULT_USAGE_WINDOW) {
  const window = validateUsageWindow(input);
  return `WITH filtered AS (
  SELECT
    message.session_id AS session_id,
    message.time_created AS time_created,
    CASE WHEN json_type(message.data, '$.providerID') = 'text'
      THEN json_extract(message.data, '$.providerID') END AS provider_id,
    CASE WHEN json_type(message.data, '$.modelID') = 'text'
      THEN json_extract(message.data, '$.modelID') END AS model_id,
    CASE WHEN json_type(message.data, '$.cost') IN ('integer', 'real')
      AND json_extract(message.data, '$.cost') >= 0
      THEN json_extract(message.data, '$.cost') END AS cost_usd,
    CASE WHEN json_type(message.data, '$.tokens.input') IN ('integer', 'real')
      AND json_extract(message.data, '$.tokens.input') >= 0
      THEN json_extract(message.data, '$.tokens.input') END AS tokens_input,
    CASE WHEN json_type(message.data, '$.tokens.output') IN ('integer', 'real')
      AND json_extract(message.data, '$.tokens.output') >= 0
      THEN json_extract(message.data, '$.tokens.output') END AS tokens_output,
    CASE WHEN json_type(message.data, '$.tokens.reasoning') IN ('integer', 'real')
      AND json_extract(message.data, '$.tokens.reasoning') >= 0
      THEN json_extract(message.data, '$.tokens.reasoning') END AS tokens_reasoning,
    CASE WHEN json_type(message.data, '$.tokens.cache.read') IN ('integer', 'real')
      AND json_extract(message.data, '$.tokens.cache.read') >= 0
      THEN json_extract(message.data, '$.tokens.cache.read') END AS tokens_cache_read,
    CASE WHEN json_type(message.data, '$.tokens.cache.write') IN ('integer', 'real')
      AND json_extract(message.data, '$.tokens.cache.write') >= 0
      THEN json_extract(message.data, '$.tokens.cache.write') END AS tokens_cache_write,
    CASE WHEN
      (json_type(message.data, '$.cost') IS NOT NULL AND json_type(message.data, '$.cost') != 'null'
        AND (json_type(message.data, '$.cost') NOT IN ('integer', 'real') OR json_extract(message.data, '$.cost') < 0))
      OR (json_type(message.data, '$.tokens.input') IS NOT NULL AND json_type(message.data, '$.tokens.input') != 'null'
        AND (json_type(message.data, '$.tokens.input') NOT IN ('integer', 'real') OR json_extract(message.data, '$.tokens.input') < 0))
      OR (json_type(message.data, '$.tokens.output') IS NOT NULL AND json_type(message.data, '$.tokens.output') != 'null'
        AND (json_type(message.data, '$.tokens.output') NOT IN ('integer', 'real') OR json_extract(message.data, '$.tokens.output') < 0))
      OR (json_type(message.data, '$.tokens.reasoning') IS NOT NULL AND json_type(message.data, '$.tokens.reasoning') != 'null'
        AND (json_type(message.data, '$.tokens.reasoning') NOT IN ('integer', 'real') OR json_extract(message.data, '$.tokens.reasoning') < 0))
      OR (json_type(message.data, '$.tokens.cache.read') IS NOT NULL AND json_type(message.data, '$.tokens.cache.read') != 'null'
        AND (json_type(message.data, '$.tokens.cache.read') NOT IN ('integer', 'real') OR json_extract(message.data, '$.tokens.cache.read') < 0))
      OR (json_type(message.data, '$.tokens.cache.write') IS NOT NULL AND json_type(message.data, '$.tokens.cache.write') != 'null'
        AND (json_type(message.data, '$.tokens.cache.write') NOT IN ('integer', 'real') OR json_extract(message.data, '$.tokens.cache.write') < 0))
      THEN 1 ELSE 0 END AS invalid_accounting
  FROM message
  WHERE json_extract(message.data, '$.role') = 'assistant'
    AND ${windowFilter(window)}
), model_usage AS (
  SELECT
    provider_id,
    model_id,
    COUNT(DISTINCT session_id) AS sessions,
    COUNT(*) AS messages,
    SUM(cost_usd) AS cost_usd,
    SUM(tokens_input) AS tokens_input,
    SUM(tokens_output) AS tokens_output,
    SUM(tokens_reasoning) AS tokens_reasoning,
    SUM(tokens_cache_read) AS tokens_cache_read,
    SUM(tokens_cache_write) AS tokens_cache_write,
    MIN(time_created) AS earliest,
    MAX(time_created) AS latest,
    SUM(CASE WHEN tokens_input IS NOT NULL AND tokens_output IS NOT NULL AND COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0) + COALESCE(tokens_reasoning, 0) + COALESCE(tokens_cache_read, 0) + COALESCE(tokens_cache_write, 0) = 0 THEN 1 ELSE 0 END) AS zero_token_messages
  FROM filtered
  WHERE provider_id IS NOT NULL AND model_id IS NOT NULL
  GROUP BY provider_id, model_id
  ORDER BY SUM(tokens_input + tokens_output + tokens_reasoning + tokens_cache_read + tokens_cache_write) DESC,
    provider_id ASC,
    model_id ASC
  LIMIT ${MAX_MODEL_ROWS}
)
SELECT
  'summary' AS kind,
  NULL AS provider_id,
  NULL AS model_id,
  COUNT(DISTINCT session_id) AS sessions,
  COUNT(*) AS messages,
  SUM(cost_usd) AS cost_usd,
  SUM(tokens_input) AS tokens_input,
  SUM(tokens_output) AS tokens_output,
  SUM(tokens_reasoning) AS tokens_reasoning,
  SUM(tokens_cache_read) AS tokens_cache_read,
  SUM(tokens_cache_write) AS tokens_cache_write,
  MIN(time_created) AS earliest,
  MAX(time_created) AS latest,
  COUNT(DISTINCT CASE WHEN provider_id IS NOT NULL AND model_id IS NOT NULL
    THEN provider_id || char(0) || model_id END) AS model_count,
  COALESCE(SUM(CASE WHEN provider_id IS NULL OR model_id IS NULL THEN 1 ELSE 0 END), 0) AS unattributed_messages,
   COALESCE(SUM(CASE WHEN tokens_input IS NOT NULL AND tokens_output IS NOT NULL AND COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0) + COALESCE(tokens_reasoning, 0) + COALESCE(tokens_cache_read, 0) + COALESCE(tokens_cache_write, 0) = 0 THEN 1 ELSE 0 END), 0) AS zero_token_messages,
  COALESCE(SUM(invalid_accounting), 0) AS invalid_accounting_messages
FROM filtered
UNION ALL
SELECT
  'model' AS kind,
  provider_id,
  model_id,
  sessions,
  messages,
  cost_usd,
  tokens_input,
  tokens_output,
  tokens_reasoning,
  tokens_cache_read,
  tokens_cache_write,
  earliest,
  latest,
  NULL AS model_count,
  NULL AS unattributed_messages,
  zero_token_messages,
  NULL AS invalid_accounting_messages
FROM model_usage`;
}

function finiteNumber(value, field, { integer = false, optional = false } = {}) {
  if (value === null || value === undefined) {
    if (optional) return null;
    throw usageError("OPENCODE_USAGE_INVALID", `OpenCode returned invalid ${field} usage.`, 502);
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw usageError("OPENCODE_USAGE_INVALID", `OpenCode returned invalid ${field} usage.`, 502);
  }
  if (integer && !Number.isSafeInteger(value)) {
    throw usageError("OPENCODE_USAGE_INVALID", `OpenCode returned invalid ${field} usage.`, 502);
  }
  return value;
}

function timestamp(value, field) {
  if (value === null) return null;
  const milliseconds = finiteNumber(value, field, { integer: true });
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw usageError("OPENCODE_USAGE_INVALID", `OpenCode returned invalid ${field} usage.`, 502);
  }
  return date.toISOString();
}

function tokenCounts(row) {
  const tokens = {
    input: finiteNumber(row.tokens_input, "input token", { integer: true, optional: true }),
    output: finiteNumber(row.tokens_output, "output token", { integer: true, optional: true }),
    reasoning: finiteNumber(row.tokens_reasoning, "reasoning token", { integer: true, optional: true }),
    cacheRead: finiteNumber(row.tokens_cache_read, "cache-read token", { integer: true, optional: true }),
    cacheWrite: finiteNumber(row.tokens_cache_write, "cache-write token", { integer: true, optional: true }),
  };
  const present = Object.values(tokens).filter((value) => value !== null);
  const total = present.length ? present.reduce((sum, value) => sum + value, 0) : null;
  if (total !== null && !Number.isSafeInteger(total)) {
    throw usageError("OPENCODE_USAGE_INVALID", "OpenCode returned an unsafe token total.", 502);
  }
  return { ...tokens, total };
}

function safeModelComponent(value, field, pattern) {
  if (typeof value !== "string" || value.length > 256 || !pattern.test(value)) {
    throw usageError("OPENCODE_USAGE_INVALID", `OpenCode returned an invalid ${field}.`, 502);
  }
  return value;
}

export function parseOpenCodeUsageRows(stdout, {
  window: inputWindow = DEFAULT_USAGE_WINDOW,
  generatedAt = new Date(),
} = {}) {
  const window = validateUsageWindow(inputWindow);
  let rows;
  try {
    rows = JSON.parse(String(stdout));
  } catch {
    throw usageError("OPENCODE_USAGE_INVALID", "OpenCode returned unreadable usage data.", 502);
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_MODEL_ROWS + 1) {
    throw usageError("OPENCODE_USAGE_INVALID", "OpenCode returned an unexpected usage result.", 502);
  }

  const summaries = rows.filter((row) => row?.kind === "summary");
  const modelRows = rows.filter((row) => row?.kind === "model");
  if (summaries.length !== 1 || summaries.length + modelRows.length !== rows.length) {
    throw usageError("OPENCODE_USAGE_INVALID", "OpenCode returned an unexpected usage result.", 502);
  }

  const summary = summaries[0];
  const invalidAccounting = finiteNumber(
    summary.invalid_accounting_messages,
    "invalid-accounting message",
    { integer: true },
  );
  if (invalidAccounting > 0) {
    throw usageError(
      "OPENCODE_USAGE_SCHEMA_MISMATCH",
      "OpenCode usage fields are not compatible with this release.",
      503,
    );
  }

  const totals = {
    sessions: finiteNumber(summary.sessions, "session", { integer: true }),
    messages: finiteNumber(summary.messages, "message", { integer: true }),
    costUsd: finiteNumber(summary.cost_usd, "cost", { optional: true }),
    tokens: tokenCounts(summary),
  };
  const modelsSeen = finiteNumber(summary.model_count, "model", { integer: true });
  const seen = new Set();
  const byModel = modelRows.map((row) => {
    const providerId = safeModelComponent(row.provider_id, "provider ID", PROVIDER_ID_PATTERN);
    const modelId = safeModelComponent(row.model_id, "model ID", MODEL_ID_PATTERN);
    const id = `${providerId}/${modelId}`;
    if (seen.has(id)) {
      throw usageError("OPENCODE_USAGE_INVALID", "OpenCode returned duplicate model usage.", 502);
    }
    seen.add(id);
    return {
      id,
      providerId,
      modelId,
      sessions: finiteNumber(row.sessions, "model session", { integer: true }),
      messages: finiteNumber(row.messages, "model message", { integer: true }),
      costUsd: finiteNumber(row.cost_usd, "model cost", { optional: true }),
      tokens: tokenCounts(row),
    };
  }).sort((left, right) => {
    const tokenDifference = right.tokens.total - left.tokens.total;
    if (tokenDifference !== 0) return tokenDifference;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });

  const generated = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  if (Number.isNaN(generated.getTime())) {
    throw usageError("OPENCODE_USAGE_INVALID", "Usage generation time is invalid.", 502);
  }

  return {
    schemaVersion: 2,
    source: "opencode-local-accounting",
    accounting: "opencode-recorded",
    costLabel: "OpenCode-recorded cost",
    window,
    windowDays: USAGE_WINDOWS[window],
    generatedAt: generated.toISOString(),
    totals,
    byModel,
    diagnostics: {
      modelsSeen,
      modelsReturned: byModel.length,
      modelsTruncated: modelsSeen > byModel.length,
      unattributedMessages: finiteNumber(
        summary.unattributed_messages,
        "unattributed message",
        { integer: true },
      ),
      zeroTokenMessages: finiteNumber(
        summary.zero_token_messages,
        "zero-token message",
        { integer: true },
      ),
      earliestMessageAt: timestamp(summary.earliest, "earliest timestamp"),
      latestMessageAt: timestamp(summary.latest, "latest timestamp"),
    },
    quota: { status: "not-reported" },
    attributed: {
      observations: [],
      coverage: {
        firstObservedAt: null,
        droppedCount: 0,
        truncated: false,
      },
    },
    caveats: [...CAVEATS],
  };
}

function executionError(error) {
  if (error?.code === "ENOENT") {
    return usageError("OPENCODE_NOT_FOUND", "OpenCode was not found on this computer.", 503);
  }
  if (error?.killed === true || error?.code === "ETIMEDOUT" || error?.signal === "SIGTERM") {
    return usageError(
      "OPENCODE_USAGE_TIMEOUT",
      "OpenCode usage took too long to read. Try again after OpenCode is idle.",
      504,
    );
  }
  return usageError(
    "OPENCODE_USAGE_UNAVAILABLE",
    "OpenCode usage is unavailable. No usage values were changed or estimated.",
    503,
  );
}

export async function readOpenCodeUsage({
  execFile = nodeExecFile,
  window: inputWindow = DEFAULT_USAGE_WINDOW,
  cwd,
  now = () => new Date(),
} = {}) {
  const window = validateUsageWindow(inputWindow);
  const query = usageSqlForWindow(window);
  let result;
  try {
    result = await execute(
      "opencode",
      ["--pure", "db", query, "--format", "json"],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: DEFAULT_TIMEOUT_MS,
      },
      execFile,
    );
  } catch (error) {
    throw executionError(error);
  }
  return parseOpenCodeUsageRows(result.stdout, { window, generatedAt: now() });
}
