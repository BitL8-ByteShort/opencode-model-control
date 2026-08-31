import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeResult, sanitizeText } from "../../src/core/index.js";

test("sanitized results expose only bounded allowlisted evidence", () => {
  const raw = {
    status: "completed",
    modelId: "opencode/ling-3.0-flash-fin-free",
    role: "code-worker",
    summary:
      "Finished. Authorization: Bearer example-secret-value https://example.test/private?token=secret /Users/example/private.txt",
    terminalSeen: true,
    attemptCount: 99,
    prompt: "private prompt",
    toolCalls: [{ input: "secret" }],
    artifacts: [
      { path: "src/core/router.js", kind: "file" },
      { path: "/etc/passwd", kind: "file" },
      { path: "../outside.txt", kind: "file" },
    ],
    metrics: {
      durationMs: 125,
      inputTokens: 10,
      outputTokens: 5,
      rawPrompt: "must not escape",
    },
    errors: [
      {
        code: "provider_timeout",
        message: "token=private-value at https://provider.test/log",
      },
    ],
  };

  const result = sanitizeResult(raw);

  assert.deepEqual(Object.keys(result), [
    "schemaVersion",
    "status",
    "modelId",
    "role",
    "summary",
    "terminalSeen",
    "attemptCount",
    "artifacts",
    "metrics",
    "errors",
  ]);
  assert.equal(result.attemptCount, 2);
  assert.deepEqual(result.artifacts, [
    { path: "src/core/router.js", kind: "file" },
  ]);
  assert.deepEqual(result.metrics, {
    durationMs: 125,
    inputTokens: 10,
    outputTokens: 5,
  });
  assert.equal("prompt" in result, false);
  assert.equal("toolCalls" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /example-secret-value|private-value/);
  assert.doesNotMatch(JSON.stringify(result), /https?:\/\//);
  assert.doesNotMatch(JSON.stringify(result), /\/Users\/example/);
});

test("sanitization normalizes unsafe status, identifiers, and oversized text", () => {
  const longText = `password=hunter-two ${"x".repeat(8_000)}`;
  const result = sanitizeResult({
    status: "definitely-fine",
    modelId: "bad model id",
    role: "unknown-role",
    summary: longText,
    terminalSeen: "yes",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.modelId, null);
  assert.equal(result.role, null);
  assert.equal(result.terminalSeen, false);
  assert.ok(result.summary.length <= 2_000);
  assert.doesNotMatch(result.summary, /hunter-two/);
});

test("sanitizeText removes credential-like values, URLs, private keys, and absolute paths", () => {
  const privateKeyFixture = ["-----BEGIN", "PRIVATE KEY-----abc-----END", "PRIVATE KEY-----"].join(" ");
  const input = [
    "api_key=super-secret-value",
    "OPENAI_API_KEY=provider-prefixed-secret",
    "AWS_SECRET_ACCESS_KEY=cloud-secret-value",
    "https://example.test/callback?access_token=secret",
    "/home/alice/.config/private.json",
    privateKeyFixture,
  ].join(" ");
  const output = sanitizeText(input);

  assert.doesNotMatch(
    output,
    /super-secret-value|provider-prefixed-secret|cloud-secret-value|access_token=secret|PRIVATE KEY/,
  );
  assert.doesNotMatch(output, /https?:\/\//);
  assert.doesNotMatch(output, /\/home\/alice/);
});
