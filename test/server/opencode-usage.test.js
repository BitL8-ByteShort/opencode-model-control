import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOpenCodeUsageRows,
  readOpenCodeUsage,
  usageSqlForWindow,
  validateUsageWindow,
} from "../../src/server/opencode-usage.js";

function rows(overrides = {}) {
  const summary = {
    kind: "summary",
    provider_id: null,
    model_id: null,
    sessions: 2,
    messages: 3,
    cost_usd: 0.25,
    tokens_input: 100,
    tokens_output: 20,
    tokens_reasoning: 5,
    tokens_cache_read: 300,
    tokens_cache_write: 10,
    earliest: 1_700_000_000_000,
    latest: 1_700_000_100_000,
    model_count: 2,
    unattributed_messages: 0,
    zero_token_messages: 1,
    invalid_accounting_messages: 0,
    ...overrides.summary,
  };
  const models = overrides.models ?? [
    {
      kind: "model",
      provider_id: "opencode",
      model_id: "big-pickle",
      sessions: 1,
      messages: 2,
      cost_usd: 0,
      tokens_input: 80,
      tokens_output: 10,
      tokens_reasoning: 5,
      tokens_cache_read: 300,
      tokens_cache_write: 0,
      earliest: 1_700_000_000_000,
      latest: 1_700_000_100_000,
      model_count: null,
      unattributed_messages: null,
      zero_token_messages: 0,
      invalid_accounting_messages: null,
    },
    {
      kind: "model",
      provider_id: "custom",
      model_id: "worker/v2",
      sessions: 1,
      messages: 1,
      cost_usd: 0.25,
      tokens_input: 20,
      tokens_output: 10,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 10,
      earliest: 1_700_000_050_000,
      latest: 1_700_000_050_000,
      model_count: null,
      unattributed_messages: null,
      zero_token_messages: 1,
      invalid_accounting_messages: null,
    },
  ];
  return [summary, ...models];
}

test("usage windows are a fixed allowlist and cannot inject SQL", () => {
  assert.equal(validateUsageWindow(), "30d");
  assert.equal(validateUsageWindow("all"), "all");
  assert.throws(
    () => validateUsageWindow("30d' OR 1=1 --"),
    (error) => error.code === "INVALID_USAGE_WINDOW" && error.statusCode === 400,
  );

  assert.match(usageSqlForWindow("7d"), /'-7 days'/u);
  assert.match(usageSqlForWindow("all"), /AND 1 = 1/u);
});

test("usage SQL projects only aggregate accounting metadata", () => {
  const sql = usageSqlForWindow("30d");

  assert.match(sql, /FROM message/u);
  assert.match(sql, /\$\.providerID/u);
  assert.match(sql, /\$\.modelID/u);
  assert.match(sql, /\$\.tokens\.cache\.read/u);
  assert.doesNotMatch(sql, /\bpart\b|session_input|session_context_epoch|credential|control_account/iu);
  assert.doesNotMatch(sql, /\$\.content|\$\.prompt|\$\.title|\$\.directory|SELECT\s+message\.data/iu);
});

test("usage parser returns bounded provider-reported totals and model attribution", () => {
  const result = parseOpenCodeUsageRows(JSON.stringify(rows()), {
    window: "30d",
    generatedAt: new Date("2026-08-30T12:00:00.000Z"),
  });

  assert.equal(result.generatedAt, "2026-08-30T12:00:00.000Z");
  assert.equal(result.accounting, "provider-reported");
  assert.equal(result.totals.tokens.total, 435);
  assert.equal(result.byModel[0].id, "opencode/big-pickle");
  assert.equal(result.byModel[0].tokens.total, 395);
  assert.equal(result.byModel[1].id, "custom/worker/v2");
  assert.deepEqual(result.diagnostics, {
    modelsSeen: 2,
    modelsReturned: 2,
    modelsTruncated: false,
    unattributedMessages: 0,
    zeroTokenMessages: 1,
    earliestMessageAt: "2023-11-14T22:13:20.000Z",
    latestMessageAt: "2023-11-14T22:15:00.000Z",
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /session_id|message_id|prompt|content|credential|access_token|directory|title/iu,
  );
});

test("an empty compatible database is distinct from unavailable usage", () => {
  const empty = rows({
    summary: {
      sessions: 0,
      messages: 0,
      cost_usd: 0,
      tokens_input: 0,
      tokens_output: 0,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      earliest: null,
      latest: null,
      model_count: 0,
      unattributed_messages: 0,
      zero_token_messages: 0,
    },
    models: [],
  });
  const result = parseOpenCodeUsageRows(JSON.stringify(empty), {
    generatedAt: "2026-08-30T12:00:00.000Z",
  });

  assert.equal(result.totals.tokens.total, 0);
  assert.equal(result.totals.messages, 0);
  assert.deepEqual(result.byModel, []);
  assert.equal(result.diagnostics.earliestMessageAt, null);
});

test("schema drift and malformed output fail closed instead of becoming zero", () => {
  assert.throws(
    () => parseOpenCodeUsageRows("not json"),
    (error) => error.code === "OPENCODE_USAGE_INVALID" && error.statusCode === 502,
  );
  assert.throws(
    () => parseOpenCodeUsageRows(JSON.stringify(rows({
      summary: { invalid_accounting_messages: 1 },
    }))),
    (error) => error.code === "OPENCODE_USAGE_SCHEMA_MISMATCH" && error.statusCode === 503,
  );
  assert.throws(
    () => parseOpenCodeUsageRows(JSON.stringify(rows({
      summary: { tokens_input: -1 },
    }))),
    (error) => error.code === "OPENCODE_USAGE_INVALID",
  );
  assert.throws(
    () => parseOpenCodeUsageRows(JSON.stringify(rows({
      models: [{ ...rows()[1], provider_id: "unsafe\nprovider" }],
      summary: { model_count: 1 },
    }))),
    (error) => error.code === "OPENCODE_USAGE_INVALID",
  );
});

test("usage reader invokes a fixed plugin-free JSON query with strict bounds", async () => {
  let invocation;
  const execFile = (file, args, options, callback) => {
    invocation = { file, args, options };
    callback(null, JSON.stringify(rows()), "");
  };

  const result = await readOpenCodeUsage({
    execFile,
    window: "90d",
    cwd: "/safe/project",
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });

  assert.equal(result.window, "90d");
  assert.equal(invocation.file, "opencode");
  assert.deepEqual(invocation.args.slice(0, 2), ["--pure", "db"]);
  assert.deepEqual(invocation.args.slice(-2), ["--format", "json"]);
  assert.match(invocation.args[2], /'-90 days'/u);
  assert.equal(invocation.options.cwd, "/safe/project");
  assert.equal(invocation.options.timeout, 10_000);
  assert.equal(invocation.options.maxBuffer, 1024 * 1024);
  assert.equal(invocation.options.env.NO_COLOR, "1");
  assert.equal(invocation.options.shell, undefined);
});

test("usage reader returns secret-free stable process failures", async () => {
  const unavailable = (_file, _args, _options, callback) => {
    callback(Object.assign(new Error("token=private-value"), {
      code: "SQLITE_ERROR",
      stderr: "credential details",
    }), "", "credential details");
  };
  await assert.rejects(
    readOpenCodeUsage({ execFile: unavailable }),
    (error) =>
      error.code === "OPENCODE_USAGE_UNAVAILABLE" &&
      error.statusCode === 503 &&
      !/private-value|credential details/u.test(error.message),
  );

  const timeout = (_file, _args, _options, callback) => {
    callback(Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }), "", "");
  };
  await assert.rejects(
    readOpenCodeUsage({ execFile: timeout }),
    (error) => error.code === "OPENCODE_USAGE_TIMEOUT" && error.statusCode === 504,
  );
});
