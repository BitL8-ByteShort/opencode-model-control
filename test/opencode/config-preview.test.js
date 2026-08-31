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
  loadModelCatalog,
} from "../../src/core/index.js";

const EXPECTED_ROLE_MODELS = {
  "code-worker": "opencode/ling-3.0-flash-fin-free",
  reviewer: "opencode/nemotron-3-ultra-free",
  "vision-worker": "opencode/mimo-v2.5-free",
};

test("standalone defaults build a Big Pickle primary and the current specialist team", () => {
  const config = buildOpenCodeConfig();

  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.equal(config.agent["omc-router"].mode, "primary");
  assert.equal(config.agent["omc-router"].model, "opencode/big-pickle");
  assert.deepEqual(config.mcp, {
    "model-control": {
      type: "local",
      command: ["opencode-model-control", "mcp"],
      enabled: true,
      timeout: 10_000,
    },
  });
  assert.deepEqual(config.agent["omc-router"].tools, {
    "model-control_*": true,
  });
  assert.deepEqual(config.tools, { "model-control_*": false });
  assert.equal(
    config.agent["omc-router"].permission["model-control_*"],
    "allow",
  );
  assert.equal(config.default_agent, undefined);

  for (const [role, model] of Object.entries(EXPECTED_ROLE_MODELS)) {
    assert.equal(config.agent[`omc-${role}`].mode, "subagent");
    assert.equal(config.agent[`omc-${role}`].model, model);
    assert.deepEqual(config.agent[`omc-${role}`].tools, {
      "model-control_*": false,
    });
    assert.equal(
      config.agent[`omc-${role}`].permission["model-control_*"],
      "deny",
    );
    assert.equal(config.agent[`omc-${role}`].permission.task, "deny");
  }
});

test("accepts the public catalog and settings contract", () => {
  const catalog = DEFAULT_FREE_CATALOG.map((entry) => ({ ...entry }));
  const settings = {
    schemaVersion: 1,
    freeOnly: true,
    maxDelegationDepth: 1,
    maxFallbacksPerAssignment: 1,
    modelControls: {},
    roleAssignments: {
      orchestrator: "opencode/big-pickle",
      ...EXPECTED_ROLE_MODELS,
    },
  };

  const config = buildOpenCodeConfig({ catalog, settings });

  assert.equal(config.agent["omc-router"].model, settings.roleAssignments.orchestrator);
  assert.equal(
    config.agent["omc-vision-worker"].model,
    settings.roleAssignments["vision-worker"],
  );
  assert.match(config.agent["omc-router"].prompt, /1 delegation level/);
});

test("accepts the core catalog container without mutating it", () => {
  const catalog = {
    schemaVersion: 1,
    snapshotDate: "2026-08-30",
    models: DEFAULT_FREE_CATALOG.map((entry) => ({
      ...entry,
      modalities: {
        input: [...entry.modalities.input],
        output: [...entry.modalities.output],
      },
    })),
  };
  const before = structuredClone(catalog);

  const config = buildOpenCodeConfig({ catalog });

  assert.equal(config.agent["omc-router"].model, "opencode/big-pickle");
  assert.deepEqual(catalog, before);
});

test("integrates with the core catalog and resolves auto assignments", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);

  const config = buildOpenCodeConfig({ catalog, settings });

  assert.equal(config.agent["omc-router"].model, "opencode/big-pickle");
  assert.equal(
    config.agent["omc-code-worker"].model,
    "opencode/ling-3.0-flash-fin-free",
  );
  assert.equal(
    config.agent["omc-vision-worker"].model,
    "opencode/mimo-v2.5-free",
  );
  assert.equal(
    config.agent["omc-reviewer"].model,
    "opencode/nemotron-3-ultra-free",
  );
});

test("automatic OpenCode assignments use the same qualified-evidence ranking as the core", () => {
  const catalog = loadModelCatalog();
  const qualified = catalog.models.find(
    ({ id }) => id === "opencode/nemotron-3.5-lightning-free",
  );
  qualified.evidence = {
    status: "qualified",
    source: "test fixture",
    verifiedAt: "2026-08-30",
  };
  qualified.quality = { "code-worker": 80 };
  const settings = createDefaultSettings(catalog);
  const expected = eligibleModelsForRole({
    catalog,
    settings,
    role: "code-worker",
    modalities: ["text"],
    access: "write",
  })[0].id;

  const config = buildOpenCodeConfig({ catalog, settings });

  assert.equal(expected, "opencode/nemotron-3.5-lightning-free");
  assert.equal(config.agent["omc-code-worker"].model, expected);
});

test("known-cost paid-first settings can generate an explicitly enabled paid specialist", () => {
  const paidModel = {
    ...DEFAULT_FREE_CATALOG.find((entry) => entry.id === "opencode/ling-3.0-flash-fin-free"),
    id: "openai/paid-code",
    label: "Paid Code",
    enabledByDefault: false,
    free: {
      verified: true,
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 8,
      verifiedAt: "2026-08-30",
    },
    roles: { "code-worker": 60 },
    canOrchestrate: false,
  };
  const config = buildOpenCodeConfig({
    catalog: [...DEFAULT_FREE_CATALOG, paidModel],
    settings: {
      schemaVersion: 2,
      costPreference: "paid-first",
      costPolicy: "known-cost",
      modelControls: { "openai/paid-code": { enabled: true, available: true } },
      roleAssignments: {
        orchestrator: "opencode/big-pickle",
        "code-worker": "auto",
        "vision-worker": "opencode/mimo-v2.5-free",
        reviewer: "auto",
      },
    },
  });

  assert.equal(config.agent["omc-code-worker"].model, "openai/paid-code");
  assert.match(config.agent["omc-router"].prompt, /user explicitly allows known-cost models/i);
});

test("rejects unverified, nonzero-cost, or unavailable selected models", () => {
  const unverifiedCatalog = DEFAULT_FREE_CATALOG.map((entry) =>
    entry.id === "opencode/big-pickle"
      ? { ...entry, free: { ...entry.free, verified: false } }
      : entry,
  );
  const nonzeroInputCatalog = DEFAULT_FREE_CATALOG.map((entry) =>
    entry.id === "opencode/big-pickle"
      ? { ...entry, free: { ...entry.free, inputUsdPerMillion: 0.01 } }
      : entry,
  );
  const nonzeroOutputCatalog = DEFAULT_FREE_CATALOG.map((entry) =>
    entry.id === "opencode/big-pickle"
      ? { ...entry, free: { ...entry.free, outputUsdPerMillion: 0.01 } }
      : entry,
  );
  const unavailableCatalog = DEFAULT_FREE_CATALOG.map((entry) =>
    entry.id === EXPECTED_ROLE_MODELS["vision-worker"]
      ? { ...entry, available: false }
      : entry,
  );

  assert.throws(
    () => buildOpenCodeConfig({ catalog: unverifiedCatalog }),
    /not allowed by the current cost policy/,
  );
  assert.throws(
    () => buildOpenCodeConfig({ catalog: nonzeroInputCatalog }),
    /not allowed by the current cost policy/,
  );
  assert.throws(
    () => buildOpenCodeConfig({ catalog: nonzeroOutputCatalog }),
    /not allowed by the current cost policy/,
  );
  assert.throws(
    () => buildOpenCodeConfig({ catalog: unavailableCatalog }),
    /is not currently available/,
  );
});

test("honors explicit model controls and permits an unassigned specialist", () => {
  const settings = {
    modelControls: {
      [EXPECTED_ROLE_MODELS["code-worker"]]: { enabled: false },
    },
    roleAssignments: {
      "code-worker": "",
    },
  };

  const config = buildOpenCodeConfig({ settings });

  assert.equal(config.agent["omc-code-worker"], undefined);
  assert.equal(config.agent["omc-vision-worker"].mode, "subagent");
});

test("auto assignment skips a disabled model but explicit disabled input is rejected", () => {
  const autoConfig = buildOpenCodeConfig({
    settings: {
      modelControls: {
        [EXPECTED_ROLE_MODELS["code-worker"]]: { enabled: false },
      },
    },
  });

  assert.equal(
    autoConfig.agent["omc-code-worker"].model,
    "opencode/nemotron-3.5-lightning-free",
  );
  assert.throws(
    () =>
      buildOpenCodeConfig({
        settings: {
          modelControls: {
            [EXPECTED_ROLE_MODELS["code-worker"]]: { enabled: false },
          },
          roleAssignments: {
            "code-worker": EXPECTED_ROLE_MODELS["code-worker"],
          },
        },
      }),
    /not currently available and enabled/,
  );
});

test("rejects explicit models that do not declare or satisfy the assigned role", () => {
  assert.throws(
    () =>
      buildOpenCodeConfig({
        settings: {
          roleAssignments: {
            "code-worker": "opencode/big-pickle",
          },
        },
      }),
    /not compatible with code-worker/,
  );

  assert.throws(
    () =>
      buildOpenCodeConfig({
        settings: {
          roleAssignments: {
            "vision-worker": "opencode/ling-3.0-flash-fin-free",
          },
        },
      }),
    /not compatible with vision-worker/,
  );

  const zeroScoreCatalog = DEFAULT_FREE_CATALOG.map((entry) =>
    entry.id === "opencode/ling-3.0-flash-fin-free"
      ? { ...entry, roles: { ...entry.roles, "code-worker": 0 } }
      : entry,
  );
  assert.throws(
    () =>
      buildOpenCodeConfig({
        catalog: zeroScoreCatalog,
        settings: {
          roleAssignments: {
            "code-worker": "opencode/ling-3.0-flash-fin-free",
          },
        },
      }),
    /not compatible with code-worker/,
  );
});

test("accepts only bounded zero-or-one routing limits", () => {
  assert.doesNotThrow(() =>
    buildOpenCodeConfig({
      settings: { maxDelegationDepth: 0, maxFallbacksPerAssignment: 0 },
    }),
  );
  assert.throws(
    () => buildOpenCodeConfig({ settings: { maxDelegationDepth: 2 } }),
    /maxDelegationDepth must be zero or one/,
  );
  assert.throws(
    () => buildOpenCodeConfig({ settings: { maxFallbacksPerAssignment: 2 } }),
    /maxFallbacksPerAssignment must be zero or one/,
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
  assert.equal(preview.mergedConfig.agent["omc-router"].model, "opencode/big-pickle");
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
  assert.throws(
    () => buildOpenCodeConfig({ settings: unsafe }),
    /unsafe key/,
  );

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

test("states the stock first-call and attachment limitations", () => {
  const preview = previewOpenCodeConfig();
  const warnings = preview.warnings.join(" ");

  assert.match(warnings, /MCP cannot choose the first model/i);
  assert.match(warnings, /image attachment/i);
  assert.match(warnings, /directly/i);
});

test("the primary prompt consults the live route and stops on direct", () => {
  const prompt = buildOpenCodeConfig().agent["omc-router"].prompt;

  assert.match(prompt, /model-control_route_task/);
  assert.match(prompt, /route is direct.*do not delegate/is);
  assert.match(prompt, /never recurse/i);
});
