import test from "node:test";
import assert from "node:assert/strict";

import { classifyRouteRequest } from "../../src/server/task-classifier.js";

test("non-text explanations use the vision task family", () => {
  const task = classifyRouteRequest({ task: "Explain this screenshot", modality: "image" });
  assert.equal(task.kind, "vision");
  assert.deepEqual(task.modalities, ["text", "image"]);
  assert.equal(task.delegationDepth, 0);
});

test("image-assisted implementation keeps its code intent", () => {
  const task = classifyRouteRequest({
    task: "Implement the UI changes shown in this screenshot",
    modality: "image",
  });

  assert.equal(task.kind, "code");
  assert.deepEqual(task.modalities, ["text", "image"]);
  assert.equal(task.access, "write");
  assert.equal(task.requiresReview, true);
});

test("pure image inspection stays read-only while requesting review", () => {
  const task = classifyRouteRequest({
    task: "Inspect this screenshot for accessibility issues",
    modality: "image",
  });

  assert.equal(task.kind, "vision");
  assert.equal(task.access, "read");
  assert.equal(task.requiresReview, true);
});

test("read-only code reviews route to the reviewer without inventing a write", () => {
  const task = classifyRouteRequest({ task: "Review this React code for a regression" });
  assert.equal(task.kind, "review");
  assert.equal(task.requiresReview, true);
  assert.equal(task.access, "read");
});

test("code changes always request one bounded independent review", () => {
  const task = classifyRouteRequest({ task: "Implement API endpoint authentication" });
  assert.equal(task.kind, "code");
  assert.equal(task.requiresReview, true);
  assert.equal(task.access, "write");
});

test("standalone text implementation requests preserve their code intent", () => {
  const task = classifyRouteRequest({ task: "Refactor this" });
  assert.equal(task.kind, "code");
  assert.equal(task.requiresReview, true);
  assert.equal(task.access, "write");
});

test("code explanations stay with the primary model", () => {
  const task = classifyRouteRequest({ task: "Explain how this Python function works" });
  assert.equal(task.kind, "general");
  assert.equal(task.requiresReview, false);
  assert.equal(task.access, "read");

  const uiTask = classifyRouteRequest({ task: "Explain how this UI component works" });
  assert.equal(uiTask.kind, "general");
  assert.equal(uiTask.requiresReview, false);
  assert.equal(uiTask.access, "read");
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
