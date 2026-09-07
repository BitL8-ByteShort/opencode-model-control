import assert from "node:assert/strict";
import test from "node:test";
import { loadModelCatalog } from "../fixtures/catalog.js";
import {
  createDefaultSettings,
  assertExplicitAssignments,
  validateCatalog,
} from "../../src/core/index.js";
import {
  createMediaRoutingHooks,
  resolveMediaWorker,
} from "../../src/opencode/plugin-runtime.js";

const A = "opencode/ling-3.0-flash-fin-free",
  B = "opencode/nemotron-3.5-lightning-free";
function fixture() {
  const catalog = loadModelCatalog();
  for (const m of catalog.models)
    m.api = {
      id: m.id.split("/").slice(1).join("/"),
      npm: "@ai-sdk/openai-compatible",
      url: "https://example.invalid/v1",
      urlValid: true,
    };
  const settings = createDefaultSettings(catalog);
  const host = catalog.models.map((m) => ({
    id: m.api.id,
    providerID: "opencode",
    api: m.api,
    capabilities: {
      toolcall: m.toolCall !== false,
      input: Object.fromEntries(m.modalities.input.map((x) => [x, true])),
      output: { text: true },
    },
    options: {},
    cost: { input: 0, output: 0 },
  }));
  const client = {
    config: {
      providers: async (args) => {
        assert.deepEqual(args, {
          query: { directory: "/isolated" },
          throwOnError: true,
        });
        return {
          data: {
            providers: [
              {
                id: "opencode",
                models: Object.fromEntries(host.map((m) => [m.id, m])),
              },
            ],
          },
        };
      },
    },
  };
  const hooks = createMediaRoutingHooks({
    loadPolicy: async () => ({ catalog, settings }),
    client,
    directory: "/isolated",
  });
  const turn = async (
    agent = "omc-code-worker",
    sessionID = "child",
    parts = [{ type: "text", text: "Implement requested change" }],
  ) => {
    const output = {
      message: {
        id: `${sessionID}-message`,
        agent,
        model: {
          providerID: "opencode",
          modelID: "big-pickle",
          variant: "inherited",
        },
        variant: "inherited",
      },
      parts,
    };
    await hooks["chat.message"]({ agent, sessionID }, output);
    return output;
  };
  const dispatch = (output, sessionID = "child", mutate = () => {}) => {
    const model = structuredClone(
      host.find((m) => m.id === output.message.model.modelID),
    );
    const input = {
      sessionID,
      agent: output.message.agent,
      model,
      provider: { id: "opencode", options: {} },
      message: output.message,
    };
    const params = { options: {} };
    mutate(input, params);
    return hooks["chat.params"](input, params);
  };
  return { catalog, settings, host, hooks, turn, dispatch };
}

test("all four owned roles apply live saved selection and clear inherited variants", async () => {
  const f = fixture();
  for (const [agent, want] of [
    ["omc-router", "big-pickle"],
    ["omc-code-worker", "ling-3.0-flash-fin-free"],
    ["omc-reviewer", "nemotron-3-ultra-free"],
    ["omc-vision-worker", "mimo-v2.5-free"],
  ]) {
    const o = await f.turn(agent);
    assert.equal(o.message.model.modelID, want);
    assert.equal(o.message.variant, undefined);
    assert.equal(o.message.model.variant, undefined);
    await f.dispatch(o);
  }
  f.settings.roleAssignments["code-worker"] = B;
  assert.equal(
    (await f.turn()).message.model.modelID,
    "nemotron-3.5-lightning-free",
  );
});
test("host inventory limits automatic candidates; explicit missing pin requests reload", async () => {
  const f = fixture();
  f.host.splice(
    f.host.findIndex((m) => m.id === "ling-3.0-flash-fin-free"),
    1,
  );
  assert.equal(
    (await f.turn()).message.model.modelID,
    "nemotron-3.5-lightning-free",
  );
  f.settings.roleAssignments["code-worker"] = A;
  await assert.rejects(
    f.turn(),
    (e) => e.code === "OMC_HOST_MODEL_MISSING" && /reload/i.test(e.message),
  );
});
test("effective route, API identity, endpoint options, capabilities and saved eligibility are rechecked", async () => {
  const f = fixture();
  const o = await f.turn();
  for (const mutate of [
    (i) => (i.model.id = "other"),
    (i) => (i.model.api.id = "other"),
    (i) => (i.model.api.npm = "@other/sdk"),
    (i) => (i.model.api.url = "https://secret.invalid/secret"),
    (i) => (i.model.api.urlValid = false),
    (i) => (i.provider.options.baseURL = "https://secret.invalid/secret"),
    (i, p) => (p.options.baseURL = "https://secret.invalid/secret"),
    (i) => (i.model.capabilities.toolcall = false),
  ])
    await assert.rejects(
      f.dispatch(o, "child", mutate),
      (e) => /^OMC_/.test(e.code) && !/secret|https:/.test(e.message),
    );
  await f.dispatch(o, "child", (i, p) => {
    i.provider.options = {
      apiKey: "secret",
      timeout: 3000,
      headers: { Authorization: "secret" },
    };
    p.options = { reasoningEffort: "high" };
  });
  f.settings.modelControls[A] = { selection: "disabled" };
  await assert.rejects(
    f.dispatch(o),
    (e) => e.code === "OMC_ROUTE_UNAVAILABLE",
  );
});
test("ordinary resumed worker adopts live policy while reviewed repair retains exact original model", async () => {
  const f = fixture();
  await f.turn("omc-router", "parent");
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "work" },
    { args: { subagent_type: "omc-code-worker" } },
  );
  const worker = await f.turn();
  await f.dispatch(worker);
  await f.hooks["tool.execute.after"](
    {
      tool: "task",
      sessionID: "parent",
      callID: "work",
      args: { subagent_type: "omc-code-worker" },
    },
    { metadata: { sessionId: "child" } },
  );
  f.settings.roleAssignments["code-worker"] = B;
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "resume" },
    { args: { subagent_type: "omc-code-worker", task_id: "child" } },
  );
  assert.equal(
    (await f.turn()).message.model.modelID,
    "nemotron-3.5-lightning-free",
  );
  await f.hooks["tool.execute.after"](
    {
      tool: "task",
      sessionID: "parent",
      callID: "resume",
      args: { subagent_type: "omc-code-worker", task_id: "child" },
    },
    { metadata: { sessionId: "child" } },
  );
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "review" },
    { args: { subagent_type: "omc-reviewer" } },
  );
  await f.turn("omc-reviewer", "review");
  await f.hooks["tool.execute.after"](
    {
      tool: "task",
      sessionID: "parent",
      callID: "review",
      args: { subagent_type: "omc-reviewer" },
    },
    { metadata: { sessionId: "review" } },
  );
  f.settings.roleAssignments["code-worker"] = A;
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "repair" },
    { args: { subagent_type: "omc-code-worker", task_id: "child" } },
  );
  const repair = await f.turn();
  assert.equal(repair.message.model.modelID, "nemotron-3.5-lightning-free");
  await f.dispatch(repair);
  f.settings.modelControls[B] = { selection: "disabled" };
  await assert.rejects(
    f.dispatch(repair),
    (e) => e.code === "OMC_ROUTE_UNAVAILABLE",
  );
});
test("unrelated agents never load saved policy or host inventory", async () => {
  const hooks = createMediaRoutingHooks({
    loadPolicy: async () => {
      throw Error("must not load");
    },
  });
  const o = {
    message: {
      agent: "other",
      model: { providerID: "custom", modelID: "own", variant: "high" },
    },
    parts: [],
  };
  const before = structuredClone(o);
  await hooks["chat.message"]({ sessionID: "unrelated" }, o);
  await hooks["chat.params"]({ agent: "other", sessionID: "unrelated" }, {});
  assert.deepEqual(o, before);
});
test("unfamiliar text and audio model serves audio with tools but not image input", () => {
  const f = fixture();
  const m = f.catalog.models.find((m) => m.id === "opencode/mimo-v2.5-free");
  m.modalities.input = ["text", "audio"];
  assert.doesNotThrow(() => validateCatalog(f.catalog));
  assert.equal(resolveMediaWorker({ ...f, modalities: ["audio"] }).id, m.id);
  assert.throws(() => resolveMediaWorker({ ...f, modalities: ["image"] }));
  m.toolCall = false;
  assert.throws(() => resolveMediaWorker({ ...f, modalities: ["audio"] }));
});
test("a new parent turn clears reviewed repair retention and unrelated parents cannot retain a child", async () => {
  const f = fixture();
  const task = async (parent, call, agent, child) => {
    await f.hooks["tool.execute.before"](
      { tool: "task", sessionID: parent, callID: call },
      { args: { subagent_type: agent, ...(child ? { task_id: child } : {}) } },
    );
  };
  const done = (parent, call, agent, child) =>
    f.hooks["tool.execute.after"](
      {
        tool: "task",
        sessionID: parent,
        callID: call,
        args: { subagent_type: agent },
      },
      { metadata: { sessionId: child } },
    );
  await f.turn("omc-router", "parent");
  await task("parent", "w", "omc-code-worker");
  await f.turn();
  await done("parent", "w", "omc-code-worker", "child");
  await task("parent", "r", "omc-reviewer");
  await f.turn("omc-reviewer", "review");
  await done("parent", "r", "omc-reviewer", "review");
  f.settings.roleAssignments["code-worker"] = B;
  await task("parent", "fix", "omc-code-worker", "child");
  assert.equal(
    (await f.turn()).message.model.modelID,
    "ling-3.0-flash-fin-free",
  );
  await f.turn("omc-router", "parent");
  await task("parent", "new", "omc-code-worker", "child");
  assert.equal(
    (await f.turn()).message.model.modelID,
    "nemotron-3.5-lightning-free",
  );
  await f.turn("omc-router", "other");
  f.settings.roleAssignments["code-worker"] = A;
  await task("other", "resume", "omc-code-worker", "child");
  assert.equal(
    (await f.turn()).message.model.modelID,
    "ling-3.0-flash-fin-free",
  );
});
test("workflow gates and specialist hard permissions follow current saved limits", async () => {
  const f = fixture();
  await f.turn("omc-router", "parent");
  f.settings.maxDelegationDepth = 0;
  await assert.rejects(
    f.hooks["tool.execute.before"](
      { tool: "task", sessionID: "parent", callID: "blocked" },
      { args: { subagent_type: "omc-code-worker" } },
    ),
    { code: "OMC_DELEGATION_DISABLED" },
  );
  await f.turn("omc-reviewer", "review");
  await f.hooks["tool.execute.before"](
    { tool: "read", sessionID: "review" },
    {},
  );
  await assert.rejects(
    f.hooks["tool.execute.before"]({ tool: "bash", sessionID: "review" }, {}),
    { code: "OMC_SPECIALIST_TOOLS_BLOCKED" },
  );
  await f.turn();
  await assert.rejects(
    f.hooks["tool.execute.before"]({ tool: "task", sessionID: "child" }, {}),
    { code: "OMC_SPECIALIST_RECURSION_BLOCKED" },
  );
});
test("dispatch rejects stale evidence and host positive pricing after selection", async () => {
  const f = fixture();
  const o = await f.turn();
  await assert.rejects(
    f.dispatch(
      o,
      "child",
      (i) =>
        (i.model.cost = { input: 0, output: 0, cache: { read: 1, write: 0 } }),
    ),
    { code: "OMC_DISPATCH_PRICING_CONFLICT" },
  );
  f.catalog.models.find((m) => m.id === A).pricing.expiresAt = new Date(
    Date.now() - 1,
  ).toISOString();
  await assert.rejects(f.dispatch(o), { code: "OMC_ROUTE_UNAVAILABLE" });
});
test("dispatch requires actual effective base rates to remain well formed", async () => {
  const f = fixture();
  const o = await f.turn();
  for (const cost of [
    { input: -1, output: 0 },
    { input: 0 },
    { input: "0", output: 0 },
  ])
    await assert.rejects(
      f.dispatch(o, "child", (i) => (i.model.cost = cost)),
      { code: "OMC_DISPATCH_PRICING_CONFLICT" },
    );
});
test("effective provider mismatch or a custom transport cannot bypass endpoint identity", async () => {
  const f = fixture();
  const o = await f.turn();
  for (const mutate of [
    (i) => (i.provider.id = "other"),
    (i) => (i.provider.options.fetch = () => {}),
    (i) => (i.model.options.fetch = () => {}),
  ])
    await assert.rejects(f.dispatch(o, "child", mutate), {
      code: "OMC_DISPATCH_IDENTITY_CONFLICT",
    });
});
test("background review acknowledgement cannot authorize retained repair", async () => {
  const f = fixture();
  await f.turn("omc-router", "parent");
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "w" },
    { args: { subagent_type: "omc-code-worker" } },
  );
  await f.turn();
  await f.hooks["tool.execute.after"](
    { tool: "task", sessionID: "parent", callID: "w" },
    { metadata: { sessionId: "child" } },
  );
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "r" },
    { args: { subagent_type: "omc-reviewer", background: true } },
  );
  await f.turn("omc-reviewer", "review");
  await f.hooks["tool.execute.after"](
    { tool: "task", sessionID: "parent", callID: "r" },
    { metadata: { sessionId: "review", background: true } },
  );
  f.settings.roleAssignments["code-worker"] = B;
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "resume" },
    { args: { subagent_type: "omc-code-worker", task_id: "child" } },
  );
  assert.equal(
    (await f.turn()).message.model.modelID,
    "nemotron-3.5-lightning-free",
  );
});
test("actual background reviewer completion arms repair across its synthetic parent continuation", async () => {
  const f = fixture();
  await f.turn("omc-router", "parent");
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "w" },
    { args: { subagent_type: "omc-code-worker" } },
  );
  await f.turn();
  await f.hooks["tool.execute.after"](
    { tool: "task", sessionID: "parent", callID: "w" },
    { metadata: { sessionId: "child" } },
  );
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "r" },
    { args: { subagent_type: "omc-reviewer", background: true } },
  );
  await f.hooks["tool.execute.after"](
    { tool: "task", sessionID: "parent", callID: "r" },
    { metadata: { sessionId: "review", background: true } },
  );
  const reviewer = await f.turn("omc-reviewer", "review");
  await f.hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          sessionID: "review",
          parentID: reviewer.message.id,
          role: "assistant",
          agent: "omc-reviewer",
          finish: "stop",
          time: { completed: Date.now() },
        },
      },
    },
  });
  await f.turn("omc-router", "parent", [
    { type: "text", synthetic: true, text: "Background task completed" },
  ]);
  f.settings.roleAssignments["code-worker"] = B;
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "repair" },
    { args: { subagent_type: "omc-code-worker", task_id: "child" } },
  );
  assert.equal(
    (await f.turn()).message.model.modelID,
    "ling-3.0-flash-fin-free",
  );
});
test("switching to an unrelated agent clears stale owned-session tool guards", async () => {
  const f = fixture();
  await f.turn("omc-vision-worker", "same");
  await f.turn("other", "same");
  await f.hooks["tool.execute.before"]({ tool: "bash", sessionID: "same" }, {});
  const p = { status: "ask" };
  await f.hooks["permission.ask"]({ sessionID: "same" }, p);
  assert.equal(p.status, "ask");
});

test("saved media pins use generic role compatibility before exact request inputs", () => {
  const f = fixture();
  const m = f.catalog.models.find((m) => m.id === "opencode/mimo-v2.5-free");
  m.modalities.input = ["text", "audio"];
  assert.doesNotThrow(() =>
    assertExplicitAssignments(f.settings, f.catalog, ["vision-worker"]),
  );
  assert.throws(() => resolveMediaWorker({ ...f, modalities: ["image"] }));
});
