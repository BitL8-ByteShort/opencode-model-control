import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createDefaultSettings,
  loadModelCatalog,
  planRoute,
} from "../../src/core/index.js";

const fixtureUrl = new URL(
  "../../benchmarks/fixtures/routing-cases.json",
  import.meta.url,
);
const fixtures = JSON.parse(readFileSync(fixtureUrl, "utf8"));

function paidCodeModel(id, overrides = {}) {
  const source = structuredClone(loadModelCatalog().models[1]);
  return {
    ...source,
    id,
    label: id,
    free: {
      verified: true,
      inputUsdPerMillion: 0.25,
      outputUsdPerMillion: 1,
      verifiedAt: "2026-08-30",
    },
    ...overrides,
  };
}

test("routing fixtures produce stable role and model assignments", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);

  for (const fixture of fixtures.cases) {
    const first = planRoute({ task: fixture.task, catalog, settings });
    const second = planRoute({ task: fixture.task, catalog, settings });

    assert.deepEqual(first, second, fixture.id);
    assert.equal(first.route, fixture.expected.route, fixture.id);
    assert.deepEqual(
      first.assignments.map(({ role, modelId }) => ({ role, modelId })),
      fixture.expected.assignments,
      fixture.id,
    );
    assert.ok(
      first.assignments.every(
        (assignment) =>
          assignment.fallbackModelId === null ||
          typeof assignment.fallbackModelId === "string",
      ),
      fixture.id,
    );
    assert.ok(
      first.assignments.every((assignment) => assignment.fallbackCount <= 1),
      fixture.id,
    );
  }
});

test("only the root orchestrator assignment may delegate", () => {
  const plan = planRoute({
    task: {
      kind: "mixed",
      complexity: "large",
      modalities: ["text", "image"],
      access: "write",
      requiresReview: true,
      delegationDepth: 0,
    },
  });

  assert.equal(plan.route, "orchestrator");
  assert.equal(plan.assignments[0].role, "orchestrator");
  assert.equal(plan.assignments[0].mayDelegate, true);
  assert.ok(
    plan.assignments.slice(1).every((assignment) => !assignment.mayDelegate),
  );
  assert.throws(
    () =>
      planRoute({
        task: {
          kind: "code",
          complexity: "medium",
          modalities: ["text"],
          access: "write",
          delegationDepth: 1,
        },
      }),
    (error) => error.code === "RECURSIVE_DELEGATION_BLOCKED",
  );
});

test("availability controls deterministically promote the next compatible free model", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);
  settings.modelControls["opencode/ling-3.0-flash-fin-free"].available = false;

  const plan = planRoute({
    task: {
      kind: "code",
      complexity: "medium",
      modalities: ["text"],
      access: "write",
      delegationDepth: 0,
    },
    catalog,
    settings,
  });

  const worker = plan.assignments.find(
    (assignment) => assignment.role === "code-worker",
  );
  assert.equal(worker.modelId, "opencode/nemotron-3.5-lightning-free");
});

test("a valid explicit role assignment overrides automatic ranking", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);
  settings.roleAssignments["code-worker"] =
    "opencode/nemotron-3.5-lightning-free";

  const plan = planRoute({
    task: {
      kind: "code",
      complexity: "medium",
      modalities: ["text"],
      access: "write",
      delegationDepth: 0,
    },
    catalog,
    settings,
  });

  const worker = plan.assignments.find(
    (assignment) => assignment.role === "code-worker",
  );
  assert.equal(worker.modelId, "opencode/nemotron-3.5-lightning-free");
  assert.equal(worker.selection, "explicit");
});

test("a compatible provisional model is used only after explicit enablement", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);
  settings.roleAssignments["vision-worker"] = "auto";
  settings.modelControls["opencode/mimo-v2.5-free"].available = false;

  assert.throws(
    () =>
      planRoute({
        task: {
          kind: "vision",
          complexity: "medium",
          modalities: ["text", "image"],
          access: "read",
          delegationDepth: 0,
        },
        catalog,
        settings,
      }),
    (error) => error.code === "NO_ELIGIBLE_FREE_MODEL",
  );

  settings.modelControls[
    "opencode/muse-spark-1.2-contributor-free"
  ].enabled = true;
  const plan = planRoute({
    task: {
      kind: "vision",
      complexity: "medium",
      modalities: ["text", "image"],
      access: "read",
      delegationDepth: 0,
    },
    catalog,
    settings,
  });
  const worker = plan.assignments.find(
    (assignment) => assignment.role === "vision-worker",
  );
  assert.equal(worker.modelId, "opencode/muse-spark-1.2-contributor-free");
});

test("routing fails closed when every compatible free model is disabled", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);
  for (const role of Object.keys(settings.roleAssignments)) {
    settings.roleAssignments[role] = "auto";
  }
  for (const control of Object.values(settings.modelControls)) {
    control.enabled = false;
  }

  assert.throws(
    () =>
      planRoute({
        task: {
          kind: "code",
          complexity: "medium",
          modalities: ["text"],
          access: "write",
          delegationDepth: 0,
        },
        catalog,
        settings,
      }),
    (error) => error.code === "NO_ELIGIBLE_FREE_MODEL",
  );
});

test("non-text code work is orchestrated across code and vision specialists", () => {
  const task = {
    kind: "code",
    complexity: "medium",
    modalities: ["image", "text"],
    access: "write",
    delegationDepth: 0,
  };
  const plan = planRoute({ task });

  assert.equal(plan.route, "orchestrator");
  assert.deepEqual(
    plan.assignments.map((assignment) => assignment.role),
    ["orchestrator", "code-worker", "vision-worker"],
  );
  assert.deepEqual(
    plan.assignments.find((assignment) => assignment.role === "vision-worker")
      .modalities,
    ["text", "image"],
  );
});

test("automatic selection is stable across equivalent modality ordering", () => {
  const baseTask = {
    kind: "vision",
    complexity: "medium",
    access: "read",
    delegationDepth: 0,
  };
  const first = planRoute({
    task: { ...baseTask, modalities: ["image", "text", "image"] },
  });
  const second = planRoute({
    task: { ...baseTask, modalities: ["text", "image"] },
  });

  assert.deepEqual(first, second);
});

test("a task-specific modality mismatch fails an explicit assignment closed", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);

  assert.throws(
    () =>
      planRoute({
        task: {
          kind: "vision",
          complexity: "medium",
          modalities: ["text", "pdf"],
          access: "read",
          delegationDepth: 0,
        },
        catalog,
        settings,
      }),
    (error) => error.code === "INVALID_ROLE_ASSIGNMENT",
  );
});

test("each assignment has at most one distinct fallback and can disable it", () => {
  const catalog = loadModelCatalog();
  const settings = createDefaultSettings(catalog);
  const task = {
    kind: "code",
    complexity: "medium",
    modalities: ["text"],
    access: "write",
    delegationDepth: 0,
  };

  const withFallback = planRoute({ task, catalog, settings });
  assert.ok(
    withFallback.assignments.every(
      (assignment) =>
        assignment.fallbackCount <= 1 &&
        assignment.fallbackModelId !== assignment.modelId,
    ),
  );

  settings.maxFallbacksPerAssignment = 0;
  const withoutFallback = planRoute({ task, catalog, settings });
  assert.ok(
    withoutFallback.assignments.every(
      (assignment) =>
        assignment.fallbackCount === 0 && assignment.fallbackModelId === null,
    ),
  );
});

test("review-required specialist work includes an independent reviewer", () => {
  const plan = planRoute({
    task: {
      kind: "code",
      complexity: "large",
      modalities: ["text"],
      access: "write",
      requiresReview: true,
      delegationDepth: 0,
    },
  });

  assert.equal(plan.route, "orchestrator");
  assert.deepEqual(
    plan.assignments.map((assignment) => assignment.role),
    ["orchestrator", "code-worker", "reviewer"],
  );
});

test("text-only general work stays direct when no specialist role is needed", () => {
  const plan = planRoute({
    task: {
      kind: "general",
      complexity: "large",
      modalities: ["text"],
      access: "read",
      cohesive: false,
      delegationDepth: 0,
    },
  });

  assert.equal(plan.route, "direct");
  assert.deepEqual(
    plan.assignments.map((assignment) => assignment.role),
    ["orchestrator"],
  );
  assert.equal(plan.assignments[0].mayDelegate, false);
});

test("automatic ranking applies cost preference before role score", () => {
  const catalog = structuredClone(loadModelCatalog());
  const paid = paidCodeModel("provider/paid-code", {
    roles: { "code-worker": 1 },
  });
  catalog.models.push(paid);
  const settings = createDefaultSettings(catalog);
  settings.costPolicy = "known-cost";

  const task = {
    kind: "code",
    complexity: "medium",
    modalities: ["text"],
    access: "write",
    delegationDepth: 0,
  };
  const freeFirst = planRoute({ task, catalog, settings });
  assert.equal(
    freeFirst.assignments.find(({ role }) => role === "code-worker").modelId,
    "opencode/ling-3.0-flash-fin-free",
  );

  settings.costPreference = "paid-first";
  const paidFirst = planRoute({ task, catalog, settings });
  assert.equal(
    paidFirst.assignments.find(({ role }) => role === "code-worker").modelId,
    paid.id,
  );
  assert.deepEqual(paidFirst.policy, {
    freeOnly: false,
    costPreference: "paid-first",
    costPolicy: "known-cost",
    maxDelegationDepth: 1,
    maxFallbacksPerAssignment: 1,
    recursiveDelegation: false,
  });
});

test("qualified role quality ranks before cost preference and curated role score", () => {
  const catalog = structuredClone(loadModelCatalog());
  const paid = paidCodeModel("provider/evidence-winner", {
    roles: { "code-worker": 1 },
    evidence: { status: "qualified", verifiedAt: "2026-08-30" },
    quality: { "code-worker": 80 },
  });
  catalog.models.push(paid);
  const settings = createDefaultSettings(catalog);
  settings.costPolicy = "known-cost";
  settings.costPreference = "free-first";

  const plan = planRoute({
    task: {
      kind: "code",
      complexity: "medium",
      modalities: ["text"],
      access: "write",
      delegationDepth: 0,
    },
    catalog,
    settings,
  });
  assert.equal(
    plan.assignments.find(({ role }) => role === "code-worker").modelId,
    paid.id,
  );
});

test("equal-evidence and equal-cost candidates use role score then stable ID", () => {
  const catalog = structuredClone(loadModelCatalog());
  const candidates = [
    paidCodeModel("provider/beta", { roles: { "code-worker": 10 } }),
    paidCodeModel("provider/zeta", { roles: { "code-worker": 20 } }),
    paidCodeModel("provider/alpha", { roles: { "code-worker": 10 } }),
  ];
  catalog.models.push(...candidates);
  const settings = createDefaultSettings(catalog);
  settings.costPolicy = "known-cost";
  settings.costPreference = "paid-first";
  settings.roleAssignments["vision-worker"] = "auto";
  for (const [modelId, control] of Object.entries(settings.modelControls)) {
    if (!modelId.startsWith("provider/") && modelId !== "opencode/big-pickle") {
      control.enabled = false;
    }
  }

  const plan = planRoute({
    task: {
      kind: "code",
      complexity: "medium",
      modalities: ["text"],
      access: "write",
      delegationDepth: 0,
    },
    catalog,
    settings,
  });
  const worker = plan.assignments.find(({ role }) => role === "code-worker");
  assert.equal(worker.modelId, "provider/zeta");
  assert.equal(worker.fallbackModelId, "provider/alpha");
});

test("known-cost routing errors stay cost-neutral when no model qualifies", () => {
  const catalog = structuredClone(loadModelCatalog());
  const settings = createDefaultSettings(catalog);
  settings.costPolicy = "known-cost";
  settings.costPreference = "paid-first";
  settings.roleAssignments["vision-worker"] = "auto";
  for (const [modelId, control] of Object.entries(settings.modelControls)) {
    if (modelId !== "opencode/big-pickle") control.enabled = false;
  }

  assert.throws(
    () =>
      planRoute({
        task: {
          kind: "code",
          complexity: "medium",
          modalities: ["text"],
          access: "write",
          delegationDepth: 0,
        },
        catalog,
        settings,
      }),
    (error) =>
      error.code === "NO_ELIGIBLE_MODEL" &&
      /known-cost/.test(error.message) &&
      !/free-only|free model/i.test(error.message),
  );
});
