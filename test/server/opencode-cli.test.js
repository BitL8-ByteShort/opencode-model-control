import test from "node:test";
import assert from "node:assert/strict";

import {
  discoverOpenCode,
  parseOpenCodeModelList,
  parseOpenCodeVerboseCatalog,
  parseOpenCodeVersion,
  mergeDiscoveredCatalog,
  toLiveAvailability,
} from "../../src/server/opencode-cli.js";

test("model discovery parser accepts only sanitized OpenCode model IDs", () => {
  const output = [
    "opencode/big-pickle",
    "noise from a plugin",
    "opencode/mimo-v2.5-free",
    "openai/gpt-5.4",
    "opencode/big-pickle",
    "https://example.test/?token=do-not-copy",
  ].join("\n");

  assert.deepEqual(parseOpenCodeModelList(output), [
    "openai/gpt-5.4",
    "opencode/big-pickle",
    "opencode/mimo-v2.5-free",
  ]);
});

test("verbose catalog parser retains only routing-safe facts", () => {
  const output = `opencode/mimo-v2.5-free
{
  "name": "MiMo V2.5 Free",
  "status": "active",
  "headers": {"authorization": "must-not-survive"},
  "cost": {"input": 0, "output": 0},
  "limit": {"context": 200000},
  "capabilities": {
    "toolcall": true,
    "input": {"text": true, "image": true, "audio": true, "video": true},
    "output": {"text": true}
  }
}`;
  const models = parseOpenCodeVerboseCatalog(output);

  assert.deepEqual(models, [
    {
      id: "opencode/mimo-v2.5-free",
      provider: "opencode",
      name: "MiMo V2.5 Free",
      status: "active",
      priceClass: "unknown",
      free: false,
      inputCost: 0,
      outputCost: 0,
      inputCostVerified: true,
      outputCostVerified: true,
      context: 200000,
      toolCall: true,
      inputModalities: ["text", "audio", "image", "video"],
      outputModalities: ["text"],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(models), /authorization|must-not-survive/u);
});

test("version parser fails closed on extra output", () => {
  assert.equal(parseOpenCodeVersion("1.18.22\n"), "1.18.22");
  assert.equal(parseOpenCodeVersion("version 1.18.22"), null);
});

test("live availability represents active known-price models without imposing cost policy", () => {
  const catalog = {
    models: [
      { id: "opencode/free" },
      { id: "opencode/paid" },
      { id: "opencode/unverified" },
    ],
  };
  const live = [
    {
      id: "opencode/free",
      status: "active",
      free: true,
      inputCostVerified: true,
      outputCostVerified: true,
      toolCall: true,
    },
    {
      id: "opencode/paid",
      status: "active",
      free: false,
      inputCostVerified: true,
      outputCostVerified: true,
      toolCall: true,
    },
    {
      id: "opencode/unverified",
      status: "active",
      free: true,
      inputCostVerified: false,
      outputCostVerified: false,
      toolCall: true,
    },
  ];

  assert.deepEqual(toLiveAvailability(catalog, live), {
    "opencode/free": { available: true },
    "opencode/paid": { available: true },
    "opencode/unverified": { available: false },
  });
});

test("successful discovery returns only sanitized live facts", async () => {
  const modelOutput = `opencode/big-pickle
{
  "name": "Big Pickle",
  "status": "active",
  "cost": {"input": 0, "output": 0},
  "capabilities": {"toolcall": true, "input": {"text": true}, "output": {"text": true}}
}`;
  const execFile = (_file, args, _options, callback) => {
    callback(null, args[0] === "models" ? modelOutput : "1.18.22\n", "");
  };

  const result = await discoverOpenCode({ execFile });
  assert.equal(result.installed, true);
  assert.equal(result.version, "1.18.22");
  assert.deepEqual(result.availableIds, ["opencode/big-pickle"]);
  assert.equal(result.complete, true);
  assert.equal(result.models[0].priceClass, "unknown");
  assert.equal(result.models[0].free, false);
});

test("plugin-free fallback is explicit and never presented as a complete catalog", async () => {
  const modelOutput = `openai/gpt-5.4
{
  "name": "GPT 5.4",
  "status": "active",
  "cost": {"input": 2.5, "output": 15},
  "capabilities": {"toolcall": true, "input": {"text": true}, "output": {"text": true}}
}`;
  let modelCalls = 0;
  const execFile = (_file, args, _options, callback) => {
    if (args[0] !== "models") return callback(null, "1.18.22\n", "");
    modelCalls += 1;
    if (!args.includes("--pure")) {
      return callback(Object.assign(new Error("plugin stalled"), { code: "ETIMEDOUT" }), "", "");
    }
    return callback(null, modelOutput, "");
  };

  const result = await discoverOpenCode({ execFile });
  assert.equal(modelCalls, 2);
  assert.equal(result.complete, false);
  assert.equal(result.error.code, "OPENCODE_PLUGIN_DISCOVERY_INCOMPLETE");
  assert.deepEqual(result.availableIds, ["openai/gpt-5.4"]);
  assert.equal(result.models[0].priceClass, "paid");
});

test("catalog merge trusts curated free evidence but blocks arbitrary reported zero prices", () => {
  const base = {
    schemaVersion: 1,
    snapshotDate: "2026-08-30",
    models: [{
      id: "opencode/big-pickle",
      label: "Big Pickle",
      status: "active",
      provisional: false,
      enabledByDefault: true,
      available: false,
      contextWindowTokens: 200000,
      free: { verified: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0, verifiedAt: "2026-08-30" },
      modalities: { input: ["text"], output: ["text"] },
      access: ["read", "write"],
      canOrchestrate: true,
      roles: { orchestrator: 100 },
    }],
  };
  const live = [
    {
      id: "opencode/big-pickle",
      provider: "opencode",
      name: "Big Pickle",
      status: "active",
      inputCost: 0,
      outputCost: 0,
      inputCostVerified: true,
      outputCostVerified: true,
      context: 200000,
      toolCall: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
    },
    {
      id: "custom/reported-zero",
      provider: "custom",
      name: "Reported Zero",
      status: "active",
      inputCost: 0,
      outputCost: 0,
      inputCostVerified: true,
      outputCostVerified: true,
      context: 100000,
      toolCall: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
    },
  ];

  const merged = mergeDiscoveredCatalog(base, live, { snapshotDate: "2026-08-30" });
  assert.equal(merged.models.find((model) => model.id === "opencode/big-pickle").free.verified, true);
  assert.equal(merged.models.find((model) => model.id === "custom/reported-zero").free.verified, false);
});

test("discovery reports a stable, secret-free failure", async () => {
  const execFile = (_file, _args, _options, callback) => {
    const error = Object.assign(new Error("spawn failed with secret=abc"), { code: "ENOENT" });
    callback(error, "", "credential-like stderr");
  };

  const result = await discoverOpenCode({ execFile });
  assert.equal(result.installed, false);
  assert.equal(result.error.code, "OPENCODE_NOT_FOUND");
  assert.doesNotMatch(JSON.stringify(result), /secret|credential-like|abc/u);
});
