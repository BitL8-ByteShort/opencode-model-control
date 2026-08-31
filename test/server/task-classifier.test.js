import test from "node:test";
import assert from "node:assert/strict";

import { classifyRouteRequest } from "../../src/server/task-classifier.js";

test("non-text inputs always use the vision task family", () => {
  const task = classifyRouteRequest({ task: "Explain this screenshot", modality: "image" });
  assert.equal(task.kind, "vision");
  assert.deepEqual(task.modalities, ["image"]);
  assert.equal(task.delegationDepth, 0);
});

test("code reviews become mixed tasks", () => {
  const task = classifyRouteRequest({ task: "Review this React code for a regression" });
  assert.equal(task.kind, "mixed");
  assert.equal(task.requiresReview, true);
  assert.equal(task.access, "write");
});

test("short general text stays direct instead of inventing delegation", () => {
  const task = classifyRouteRequest({ task: "Explain HTTP caching", modality: "text" });
  assert.equal(task.kind, "general");
  assert.equal(task.complexity, "small");
  assert.equal(task.cohesive, true);
});

test("invalid task input is rejected", () => {
  assert.throws(() => classifyRouteRequest({ task: "", modality: "text" }), {
    code: "INVALID_TASK",
  });
  assert.throws(() => classifyRouteRequest({ task: "hello", modality: "zip" }), {
    code: "INVALID_MODALITY",
  });
});
