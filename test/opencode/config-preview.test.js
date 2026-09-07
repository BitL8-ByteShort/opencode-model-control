import { loadModelCatalog, syntheticPricing } from "../fixtures/catalog.js";
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FREE_CATALOG,
  OpenCodeConfigConflictError,
  buildOpenCodeConfig,
  previewOpenCodeConfig,
  renderOpenCodeConfig,
} from "../../src/opencode/index.js";
import {
  createDefaultSettings,
  eligibleModelsForRole,
} from "../../src/core/index.js";

const EXPECTED_ROLE_MODELS = {
  "code-worker": "opencode/ling-3.0-flash-fin-free",
  reviewer: "opencode/nemotron-3-ultra-free",
  "vision-worker": "opencode/mimo-v2.5-free",
};

test("stable agents omit model assignments and remain identical across live policy changes", () => {
  const before = buildOpenCodeConfig();
  const after = buildOpenCodeConfig({
    catalog: [],
    settings: {
      schemaVersion: 3,
      costPolicy: "known-cost",
      costPreference: "paid-first",
      maxDelegationDepth: 0,
      maxFallbacksPerAssignment: 0,
      modelControls: { "custom/paid": { selection: "enabled" } },
      roleAssignments: {
        orchestrator: "custom/paid",
        "code-worker": "",
        reviewer: "auto",
      },
    },
  });
  assert.deepEqual(after, before);
  assert.deepEqual(Object.keys(before.agent).sort(), [
    "omc-code-worker",
    "omc-reviewer",
    "omc-router",
    "omc-vision-worker",
  ]);
  for (const agent of Object.values(before.agent))
    assert.equal(agent.model, undefined);
  assert.deepEqual(before.agent["omc-vision-worker"].permission, {
    "*": "deny",
  });
  assert.equal(before.agent["omc-reviewer"].permission.read, "allow");
  assert.equal(before.agent["omc-reviewer"].permission["*"], "deny");
  assert.equal(before.agent["omc-code-worker"].permission.task, "deny");
  assert.equal(
    before.agent["omc-router"].permission.task["omc-code-worker"],
    "allow",
  );
});

test("renders deterministic JSON with a trailing newline", () => {
  const first = renderOpenCodeConfig();
  const second = renderOpenCodeConfig();

  assert.equal(first, second);
  assert.match(first, /\n$/);
  assert.deepEqual(JSON.parse(first), buildOpenCodeConfig());
});

test("previews a merge without changing the caller's config", () => {
  const existingConfig = {
    $schema: "https://opencode.ai/config.json",
    theme: "system",
    agent: {
      existing: { mode: "subagent", model: "example/existing" },
    },
  };
  const before = structuredClone(existingConfig);

  const preview = previewOpenCodeConfig({ existingConfig });

  assert.deepEqual(existingConfig, before);
  assert.equal(preview.mutation, "none");
  assert.deepEqual(preview.writes, []);
  assert.equal(preview.mergedConfig.theme, "system");
  assert.deepEqual(preview.mergedConfig.agent.existing, before.agent.existing);
  assert.equal(preview.mergedConfig.agent["omc-router"].model, undefined);
  assert.deepEqual(
    preview.mergedConfig.mcp["model-control"],
    preview.fragment.mcp["model-control"],
  );
  assert.ok(preview.changes.some(({ path }) => path === "agent.omc-router"));
  assert.ok(preview.changes.some(({ path }) => path === "mcp.model-control"));
  assert.equal(preview.mergedConfig.tools["model-control_*"], false);
});

test("merges the global MCP tool deny without replacing unrelated tool controls", () => {
  const existingConfig = {
    tools: {
      "existing-tool_*": true,
    },
  };
  const before = structuredClone(existingConfig);

  const preview = previewOpenCodeConfig({ existingConfig });

  assert.deepEqual(existingConfig, before);
  assert.deepEqual(preview.mergedConfig.tools, {
    "existing-tool_*": true,
    "model-control_*": false,
  });
  assert.ok(
    preview.changes.some(
      ({ action, path, value }) =>
        action === "add" && path === "tools.model-control_*" && value === false,
    ),
  );
});

test("fails closed when the global MCP tool control already conflicts", () => {
  assert.throws(
    () =>
      previewOpenCodeConfig({
        existingConfig: {
          tools: { "model-control_*": true },
        },
      }),
    (error) =>
      error instanceof OpenCodeConfigConflictError &&
      error.path === "tools.model-control_*",
  );
});

test("fails closed when a generated agent would overwrite user config", () => {
  const existingConfig = {
    agent: {
      "omc-router": { mode: "primary", model: "someone/else" },
    },
  };

  assert.throws(
    () => previewOpenCodeConfig({ existingConfig }),
    OpenCodeConfigConflictError,
  );
});

test("rejects unsafe object keys and does not emit provider config", () => {
  const unsafe = JSON.parse('{"__proto__":{"polluted":true}}');

  assert.throws(
    () => previewOpenCodeConfig({ existingConfig: unsafe }),
    /unsafe key/,
  );
  assert.throws(() => buildOpenCodeConfig({ settings: unsafe }), /unsafe key/);

  const config = buildOpenCodeConfig();
  assert.equal(config.provider, undefined);
  assert.equal({}.polluted, undefined);
});

test("fails closed when the local MCP bridge name is already configured differently", () => {
  assert.throws(
    () =>
      previewOpenCodeConfig({
        existingConfig: {
          mcp: {
            "model-control": {
              type: "remote",
              url: "https://example.invalid/mcp",
            },
          },
        },
      }),
    (error) =>
      error instanceof OpenCodeConfigConflictError &&
      error.path === "mcp.model-control",
  );
});

test("the primary prompt consults the live route and stops on direct", () => {
  const prompt = buildOpenCodeConfig().agent["omc-router"].prompt;

  assert.match(prompt, /model-control_route_task/);
  assert.match(prompt, /route is direct.*do not delegate/is);
  assert.match(prompt, /never recurse/i);
  assert.match(prompt, /without waiting for the user to request delegation/i);
  assert.match(prompt, /one independent review/i);
  assert.match(prompt, /one bounded repair task/i);
  assert.match(prompt, /local pre-call router/i);
});

test("workflow instructions read limits from live MCP policy", () => {
  const prompt = buildOpenCodeConfig().agent["omc-router"].prompt;
  assert.match(prompt, /model-control_get_model_status/);
  assert.match(prompt, /maxDelegationDepth/);
  assert.match(prompt, /maxFallbacksPerAssignment/);
});
