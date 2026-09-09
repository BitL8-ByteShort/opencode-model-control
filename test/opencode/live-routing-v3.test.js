import assert from "node:assert/strict";
import test from "node:test";
import { loadModelCatalog } from "../fixtures/catalog.js";
import {
  createDefaultSettings,
  assertExplicitAssignments,
  validateCatalog,
} from "../../src/core/index.js";
import { deriveConnectionId } from "../../src/core/connections.js";
import {
  createMediaRoutingHooks,
  resolveMediaWorker,
} from "../../src/opencode/plugin-runtime.js";
import {
  readUsageAttribution,
} from "../../src/server/usage-attribution-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const A = "opencode/ling-3.0-flash-fin-free",
  B = "opencode/nemotron-3.5-lightning-free";
function fixture({ connections = [], connectionScopeId, recordUsage = false, settingsPath } = {}) {
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
    recordUsage, settingsPath,
    loadPolicy: async () => ({
      catalog,
      settings,
      connections,
      connectionScopeId,
    }),
    client,
    directory: "/isolated",
  });
  let messageSequence = 0;
  const turn = async (
    agent = "omc-code-worker",
    sessionID = "child",
    parts = [{ type: "text", text: "Implement requested change" }],
  ) => {
    const output = {
      message: {
        id: `${sessionID}-message-${++messageSequence}`,
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
  return { catalog, settings, host, hooks, turn, dispatch, client };
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
test("dispatch rejects a missing pinned connection and a revoked connection", async () => {
  const connectionScopeId = "11111111-1111-4111-8111-111111111111";
  const f = fixture({
    connectionScopeId,
    connections: [
      {
        id: deriveConnectionId(connectionScopeId, "opencode"),
        providerId: "opencode",
        bindingRevision: "b".repeat(32),
        authKind: "unknown",
        billing: { kind: "unknown", source: "unknown", observedAt: null },
        transportVisibility: "host-managed",
        inventoryObservedAt: new Date().toISOString(),
        entitlement: "reported-revoked",
        quota: null,
      },
    ],
  });
  await assert.rejects(f.turn(), (error) =>
    ["OMC_ROUTE_UNAVAILABLE", "OMC_DISPATCH_IDENTITY_CONFLICT"].includes(
      error.code,
    ),
  );
  const missing = fixture();
  missing.settings.roleConnections["code-worker"] = {
    connectionId: "a".repeat(32),
    bindingRevision: "b".repeat(32),
  };
  missing.settings.costPolicy = "known-cost";
  await assert.rejects(missing.turn(), (error) =>
    ["OMC_ROUTE_UNAVAILABLE", "OMC_DISPATCH_IDENTITY_CONFLICT"].includes(
      error.code,
    ),
  );
});

test("repair stops when the original connection binding switches billing", async () => {
  const connection = {
    id: "a".repeat(32),
    providerId: "opencode",
    bindingRevision: "b".repeat(32),
    authKind: "unknown",
    billing: { kind: "unknown", source: "unknown", observedAt: null },
    transportVisibility: "host-managed",
    inventoryObservedAt: new Date().toISOString(),
    entitlement: "not-reported",
    quota: null,
  };
  const f = fixture({ connections: [connection] });
  await f.turn("omc-router", "parent");
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "work" },
    { args: { subagent_type: "omc-code-worker" } },
  );
  const worker = await f.turn();
  await f.dispatch(worker);
  await f.hooks["tool.execute.after"](
    { tool: "task", sessionID: "parent", callID: "work" },
    { metadata: { sessionId: "child" } },
  );
  await f.hooks["tool.execute.before"](
    { tool: "task", sessionID: "parent", callID: "review" },
    { args: { subagent_type: "omc-reviewer" } },
  );
  await f.turn("omc-reviewer", "review");
  await f.hooks["tool.execute.after"](
    { tool: "task", sessionID: "parent", callID: "review" },
    { metadata: { sessionId: "review" } },
  );
  connection.bindingRevision = "c".repeat(32);
  connection.billing = {
    kind: "metered-api",
    source: "unknown",
    observedAt: null,
  };
  await assert.rejects(
    f.hooks["tool.execute.before"](
      { tool: "task", sessionID: "parent", callID: "repair" },
      { args: { subagent_type: "omc-code-worker", task_id: "child" } },
    ),
    { code: "OMC_DISPATCH_IDENTITY_CONFLICT" },
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
    (i) => (i.model.options.fetch = () => {}),
  ])
    await assert.rejects(f.dispatch(o, "child", mutate), {
      code: "OMC_DISPATCH_IDENTITY_CONFLICT",
    });
});
test("free policy does not certify an opaque provider fetch", async () => {
  const f = fixture();
  const o = await f.turn();
  await assert.rejects(
    f.dispatch(o, "child", (i) => {
      i.provider.options.fetch = async () => new Response("{}");
    }),
    { code: "OMC_DISPATCH_IDENTITY_CONFLICT" },
  );
});
test("usage attribution completes after a successful owned assistant message", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omc-attr-"));
  const settingsPath = join(directory, "settings.json");
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
  const hooks = createMediaRoutingHooks({
    loadPolicy: async () => ({ catalog, settings }),
    client: {
      config: {
        providers: async () => ({
          data: {
            providers: [
              {
                id: "opencode",
                models: Object.fromEntries(host.map((m) => [m.id, m])),
              },
            ],
          },
        }),
      },
    },
    directory: "/isolated",
    recordUsage: true,
    settingsPath,
  });
  const output = {
    message: {
      id: "msg-1",
      agent: "omc-code-worker",
      model: { providerID: "opencode", modelID: "big-pickle" },
    },
    parts: [{ type: "text", text: "Implement requested change" }],
  };
  await hooks["chat.message"](
    { agent: "omc-code-worker", sessionID: "child" },
    output,
  );
  const model = structuredClone(
    host.find((m) => m.id === output.message.model.modelID),
  );
  await hooks["chat.params"](
    {
      sessionID: "child",
      agent: output.message.agent,
      model,
      provider: { id: "opencode", options: {} },
      message: output.message,
    },
    { options: {} },
  );
  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-1",
          sessionID: "child",
          role: "assistant",
          agent: "omc-code-worker",
          parentID: output.message.id,
          time: { completed: Date.now() },
          finish: "stop",
          tokens: { input: 11, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
        },
      },
    },
  });
  const step = { id: "assistant-tools", sessionID: "child", role: "assistant", agent: "omc-code-worker", parentID: output.message.id, time: { completed: Date.now() }, finish: "tool-calls", tokens: { input: 7, output: 2 }, cost: 0.1 };
  await hooks.event({ event: { type: "message.updated", properties: { info: step } } });
  await hooks.event({ event: { type: "message.updated", properties: { info: { ...step, tokens: { input: 999 } } } } });
  assert.equal((await hooks.dispose()).complete, true);
  await hooks.flushAttribution();
  const attributed = await readUsageAttribution({ settingsPath });
  assert.equal(attributed.observations.length, 2);
  assert.equal(attributed.observations[1].tokens.input, 7);
  assert.equal(attributed.coverage.pendingCount, 0);
  assert.equal(attributed.observations[0].tokens.input, 11);
  assert.equal(attributed.observations[0].recordedCost.amount, 0);
  await rm(directory, { recursive: true, force: true });
});

test("provider-owned authentication fetch is accepted when the exact binding matches", async () => {
  const f = fixture();
  f.settings.costPolicy = "known-cost";
  const o = await f.turn();
  await f.dispatch(o, "child", (i) => {
    i.provider.options.fetch = async () => new Response("{}");
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

function beginTask(f, callID, agent, child, parent = "parent") {
  return f.hooks["tool.execute.before"](
    { tool: "task", sessionID: parent, callID },
    { args: { subagent_type: agent, ...(child ? { task_id: child } : {}) } },
  );
}
function finishTask(f, callID, child, parent = "parent", background = false) {
  return f.hooks["tool.execute.after"](
    { tool: "task", sessionID: parent, callID },
    {
      metadata: {
        sessionId: child,
        ...(background ? { background: true } : {}),
      },
    },
  );
}
async function reviewedWorker(f) {
  await f.turn("omc-router", "parent");
  await beginTask(f, "worker", "omc-code-worker");
  await f.turn();
  await finishTask(f, "worker", "child");
  await beginTask(f, "review", "omc-reviewer");
  await f.turn("omc-reviewer", "review");
  await finishTask(f, "review", "review");
}

test("completed repair does not retain A for an unrelated parent's later resumed worker", async () => {
  const f = fixture();
  await reviewedWorker(f);
  await beginTask(f, "repair", "omc-code-worker", "child");
  const repair = await f.turn();
  f.settings.roleAssignments["code-worker"] = B;
  await f.dispatch(repair);
  await f.dispatch(repair); // Tool-loop inference continuation keeps authorized A.
  await finishTask(f, "repair", "child");
  await f.turn("other", "unrelated");
  await beginTask(f, "ordinary", "omc-code-worker", "child", "unrelated");
  const next = await f.turn();
  assert.equal(next.message.model.modelID, "nemotron-3.5-lightning-free");
  await f.dispatch(next);
});

test("terminal background repair completion releases retention before a later direct child message", async () => {
  const f = fixture();
  await reviewedWorker(f);
  await beginTask(f, "repair", "omc-code-worker", "child");
  const repair = await f.turn();
  await finishTask(f, "repair", "child", "parent", true);
  f.settings.roleAssignments["code-worker"] = B;
  await f.dispatch(repair);
  await f.hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          sessionID: "child",
          parentID: repair.message.id,
          role: "assistant",
          agent: "omc-code-worker",
          finish: "stop",
          time: { completed: Date.now() },
        },
      },
    },
  });
  const next = await f.turn();
  assert.equal(next.message.model.modelID, "nemotron-3.5-lightning-free");
  await f.dispatch(next);
});

test("terminal repair completion releases retention while attribution state lock is paused", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-repair-accounting-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, "settings.json");
  const f = fixture({ recordUsage: true, settingsPath });
  await reviewedWorker(f);
  await beginTask(f, "repair", "omc-code-worker", "child");
  const repair = await f.turn();
  await finishTask(f, "repair", "child", "parent", true);
  f.settings.roleAssignments["code-worker"] = B;
  await f.dispatch(repair);
  await f.hooks.flushAttribution();
  const { acquireFileLock } = await import("../../src/server/state-lock.js");
  const release = await acquireFileLock(`${settingsPath}.lock`);
  t.after(release);
  await Promise.race([f.hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "repair-assistant",
          sessionID: "child",
          parentID: repair.message.id,
          role: "assistant",
          agent: "omc-code-worker",
          finish: "stop",
          time: { completed: Date.now() },
        },
      },
    },
  }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Accounting blocked completion")), 500); timer.unref(); })]);
  const next = await f.turn();
  assert.equal(next.message.model.modelID, "nemotron-3.5-lightning-free");
  await f.dispatch(next);
  await release();
  assert.equal((await f.hooks.dispose()).complete, true);
});

test("review of W1 never turns an independent W2 resume into repair", async () => {
  for (const consumeRepair of [false, true]) {
    const f = fixture();
    await reviewedWorker(f);
    if (consumeRepair) {
      await beginTask(f, "repair", "omc-code-worker", "child");
      await f.turn();
      await finishTask(f, "repair", "child");
    }
    await beginTask(f, "new-worker", "omc-code-worker");
    await f.turn("omc-code-worker", "second-child");
    await finishTask(f, "new-worker", "second-child");
    f.settings.roleAssignments["code-worker"] = B;
    await beginTask(f, "ordinary", "omc-code-worker", "second-child");
    const next = await f.turn("omc-code-worker", "second-child");
    assert.equal(next.message.model.modelID, "nemotron-3.5-lightning-free");
    await f.dispatch(next, "second-child");
  }
});

test("late reviewer completion for W1 cannot authorize repair of replacement W2", async () => {
  const f = fixture();
  await f.turn("omc-router", "parent");
  await beginTask(f, "w1", "omc-code-worker");
  await f.turn();
  await finishTask(f, "w1", "child");
  await beginTask(f, "old-review", "omc-reviewer");
  const reviewer = await f.turn("omc-reviewer", "review");
  await finishTask(f, "old-review", "review", "parent", true);
  await beginTask(f, "w2", "omc-code-worker");
  await f.turn("omc-code-worker", "second-child");
  await finishTask(f, "w2", "second-child");
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
  f.settings.roleAssignments["code-worker"] = B;
  await beginTask(f, "ordinary", "omc-code-worker", "second-child");
  const next = await f.turn("omc-code-worker", "second-child");
  assert.equal(next.message.model.modelID, "nemotron-3.5-lightning-free");
  await f.dispatch(next, "second-child");
});

test("an unrelated next child message consumes no pending repair authorization", async () => {
  const f = fixture();
  await reviewedWorker(f);
  await beginTask(f, "repair", "omc-code-worker", "child");
  f.settings.roleAssignments["code-worker"] = B;
  await f.turn("other", "child");
  const ordinary = await f.turn();
  assert.equal(ordinary.message.model.modelID, "nemotron-3.5-lightning-free");
  await f.dispatch(ordinary);
});

test("missing host pin emits bounded reload guidance and notification failure cannot permit dispatch", async () => {
  const f = fixture();
  f.settings.roleAssignments["code-worker"] = A;
  f.host.splice(
    f.host.findIndex((m) => m.id === A.split("/")[1]),
    1,
  );
  const notifications = [];
  f.client.tui = {
    showToast: async (args) => {
      notifications.push(args);
    },
  };
  await assert.rejects(f.turn(), (e) => e.code === "OMC_HOST_MODEL_MISSING");
  assert.deepEqual(notifications, [
    {
      query: { directory: "/isolated" },
      body: {
        title: "OpenCode Model Control",
        message:
          "OMC_HOST_MODEL_MISSING: The saved model is absent from this running OpenCode instance. Reload OpenCode and retry.",
        variant: "error",
        duration: 10000,
      },
    },
  ]);
  f.client.tui.showToast = async () => {
    throw new Error("secret notification transport");
  };
  await assert.rejects(
    f.turn(),
    (e) => e.code === "OMC_HOST_MODEL_MISSING" && !e.message.includes("secret"),
  );
});

test("only the completed owned slash invocation authorizes its verified synthetic summary", async () => {
  for (const condition of [
    "valid",
    "unsynthetic",
    "wrong-command",
    "new-user",
    "changed-pin",
    "wrong-session",
    "lookup-failed",
  ]) {
    const f = fixture();
    const parent = await f.turn("omc-router", "parent", [
      { type: "subtask", agent: "omc-code-worker", command: "fixture-worker" },
    ]);
    const args = {
      subagent_type: "omc-code-worker",
      command:
        condition === "wrong-command" ? "other-command" : "fixture-worker",
    };
    await f.hooks["tool.execute.before"](
      { tool: "task", sessionID: "parent", callID: "slash-call" },
      { args },
    );
    await f.turn();
    await f.hooks["tool.execute.after"](
      { tool: "task", sessionID: "parent", callID: "slash-call", args },
      { metadata: { sessionId: "child" } },
    );
    const summary = structuredClone(parent);
    summary.message.id = "host-summary";
    f.client.session = {
      message: async (request) => {
        assert.deepEqual(request, {
          path: { id: "parent", messageID: "host-summary" },
          query: { directory: "/isolated" },
          throwOnError: true,
        });
        if (condition === "lookup-failed")
          throw new Error("private transport detail");
        return {
          data: {
            info: {
              ...summary.message,
              role: "user",
              sessionID: condition === "wrong-session" ? "other" : "parent",
            },
            parts: [
              {
                type: "text",
                synthetic: condition !== "unsynthetic",
                text: "Summarize the task tool output above and continue with your task.",
              },
            ],
          },
        };
      },
    };
    if (condition === "new-user") await f.turn("omc-router", "parent");
    if (condition === "changed-pin")
      f.settings.roleAssignments.orchestrator = B;
    if (condition === "valid") {
      await f.dispatch(summary, "parent");
      await f.dispatch(summary, "parent");
      summary.message.id = "another-summary";
    }
    await assert.rejects(f.dispatch(summary, "parent"), (e) =>
      /^OMC_/.test(e.code),
    );
  }
});
