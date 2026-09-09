// Real OpenCode processes; synthetic loopback provider responses, never quality claims.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir, release, arch } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadModelCatalog } from "../test/fixtures/catalog.js";
import { liveModel, publicFixture } from "../test/fixtures/public-metadata.js";
const targetRoot = resolve(
  process.env.OMC_PACKAGE_ROOT || fileURLToPath(new URL("..", import.meta.url)),
);
const tarballSha256 = process.env.OMC_TARBALL_SHA256 || null;
if (process.env.OMC_PACKAGE_ROOT)
  assert.match(
    tarballSha256 || "",
    /^[a-f0-9]{64}$/,
    "Installed-package tests require their tarball SHA256",
  );
const targetImport = (path) =>
  import(pathToFileURL(join(targetRoot, path)).href);
const [
  { createDefaultSettings, validateCatalog },
  { ControlService },
  { unknownPricing },
  { buildOpenCodeConfig },
  { readControlSnapshot },
] = await Promise.all([
  targetImport("src/core/index.js"),
  targetImport("src/server/service.js"),
  targetImport("src/core/pricing.js"),
  targetImport("src/opencode/index.js"),
  targetImport("src/server/state-snapshot.js"),
]);

const binary = resolve(
  process.env.OMC_HOST_BINARY ||
    process.argv[2] ||
    "node_modules/.bin/opencode",
);
const version = spawnSync(binary, ["--version"], {
  encoding: "utf8",
  env: { PATH: process.env.PATH },
});
assert.equal(version.status, 0, "Pinned OpenCode executable is required");
assert.match(version.stdout.trim(), /^1\.18\.(22|28)$/);
const root = await mkdtemp(join(tmpdir(), "omc-host-acceptance-"));
const evidence = {
  schemaVersion: 1,
  kind: "actual-host-mocked-inference",
  target: process.env.OMC_PACKAGE_ROOT
    ? "installed-tarball"
    : "checkout-source",
  tarballSha256,
  host: version.stdout.trim(),
  node: process.version,
  platform: process.platform,
  osRelease: release(),
  architecture: arch(),
  scenarios: [],
  requests: [],
};
let eventController;
const toasts = [];
let child,
  handler = async () => ({ text: "Fixture complete." }),
  active = "initialization",
  fatal;
const fake = createServer(async (req, res) => {
  try {
    assert.equal(req.url, "/v1/chat/completions");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.ok(
      ["a", "b"].includes(body.model),
      `Invalid provider model ${body.model}`,
    );
    if (active === "subscription-shaped-provider-fetch") {
      assert.equal(
        req.headers["x-omc-fixture-transport"],
        "subscription",
        "subscription auth-loader fetch must handle the provider request",
      );
    }
    evidence.requests.push({
      scenario: active,
      path: req.url,
      model: body.model,
      tools: (body.tools || []).map((t) => t.function.name).sort(),
    });
    const result = await handler(body);
    const chunk = (delta, finish_reason = null) => ({
      id: "fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    });
    res.writeHead(200, { "content-type": "text/event-stream" });
    const delta = result.task
      ? {
          tool_calls: [
            {
              index: 0,
              id: `call_${evidence.requests.length}`,
              type: "function",
              function: {
                name: "task",
                arguments: JSON.stringify(result.task),
              },
            },
          ],
        }
      : { content: result.text || "Fixture complete." };
    for (const value of [
      chunk({ role: "assistant" }),
      chunk(delta),
      chunk({}, result.task ? "tool_calls" : "stop"),
    ])
      res.write(`data: ${JSON.stringify(value)}\n\n`);
    res.end("data: [DONE]\n\n");
  } catch (error) {
    fatal = error;
    res.writeHead(500);
    res.end("Fixture assertion failed");
  }
});
await new Promise((r, reject) => {
  fake.once("error", reject);
  fake.listen(0, "127.0.0.1", r);
});
try {
  const endpoint = `http://127.0.0.1:${fake.address().port}/v1`;
  const template = loadModelCatalog().models.find(
    (m) => m.id === "opencode/mimo-v2.5-free",
  );
  const model = (id) => ({
    ...structuredClone(template),
    id: `omctest/${id}`,
    api: { id, npm: "@ai-sdk/openai-compatible", url: endpoint },
    roles: {
      orchestrator: 50,
      "code-worker": 50,
      "vision-worker": 50,
      reviewer: 50,
    },
    canOrchestrate: true,
    toolCall: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  });
  let catalog = validateCatalog({
    schemaVersion: 2,
    snapshotDate: new Date().toISOString().slice(0, 10),
    models: [model("a"), model("b")],
  });
  let settings = createDefaultSettings(catalog);
  const policyPath = join(root, "policy/settings.json");
  const save = async () => {
    await writeFile(policyPath, JSON.stringify(settings), { mode: 0o600 });
    await writeFile(
      join(root, "policy/catalog-snapshot.json"),
      JSON.stringify(catalog),
      { mode: 0o600 },
    );
    await readControlSnapshot({ settingsPath: policyPath });
  };
  const pin = async (id) => {
    settings.roleAssignments = Object.fromEntries(
      ["orchestrator", "code-worker", "vision-worker", "reviewer"].map(
        (role) => [role, id === "auto" ? id : `omctest/${id}`],
      ),
    );
    await save();
  };
  await mkdir(join(root, "policy"));
  await mkdir(join(root, "project"));
  await pin("a");
  const hm = (id) => ({
    id,
    name: id.toUpperCase(),
    attachment: true,
    reasoning: false,
    tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 100000, output: 1000 },
    cost: { input: 0, output: 0 },
  });
  // A fixture-only second plugin changes ordinary saved files between the real
  // OMC chat.message selection and chat.params revalidation. It grants nothing.
  const fetchFlag = join(root, "enable-subscription-fetch");
  const fetchMarker = join(root, "subscription-fetch-used");
  const subscriptionPlugin = join(root, "subscription-auth.mjs");
  await writeFile(
    subscriptionPlugin,
    `import { access, appendFile } from "node:fs/promises";
const inner = globalThis.fetch.bind(globalThis);
async function subscriptionFetch(input, init = {}) {
  try { await access(${JSON.stringify(fetchFlag)}); } catch { return inner(input, init); }
  await appendFile(${JSON.stringify(fetchMarker)}, "1");
  if (input instanceof Request) {
    const headers = new Headers(input.headers);
    headers.set("x-omc-fixture-transport", "subscription");
    return inner(new Request(input, { headers }));
  }
  const headers = new Headers(init.headers);
  headers.set("x-omc-fixture-transport", "subscription");
  return inner(input, { ...init, headers });
}
globalThis.fetch = subscriptionFetch;
export default async () => ({
  auth: {
    provider: "omctest",
    async loader() {
      return { apiKey: "fixture", fetch: subscriptionFetch };
    },
  },
});
`,
  );
  const interleavePlugin = join(root, "interleave.mjs");
  await writeFile(
    interleavePlugin,
    `import {readFile,writeFile} from "node:fs/promises";
export default async () => ({ "chat.message": async (_input, output) => {
 const text = output.parts.filter(p => p.type === "text").map(p => p.text).join(" ");
 if (text.includes("REVALIDATE_REVOKE")) { const path = ${JSON.stringify(policyPath)}; const value = JSON.parse(await readFile(path,"utf8")); value.modelControls["omctest/a"]={selection:"disabled"}; await writeFile(path,JSON.stringify(value)); }
 if (text.includes("REVALIDATE_IDENTITY")) { const path = ${JSON.stringify(join(root, "policy/catalog-snapshot.json"))}; const value = JSON.parse(await readFile(path,"utf8")); value.models.find(m => m.id === "omctest/a").api.url += "/conflict"; await writeFile(path,JSON.stringify(value)); }
}});`,
  );
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: "omctest/a",
    small_model: "omctest/a",
    enabled_providers: ["omctest"],
    share: "disabled",
    autoupdate: false,
    formatter: false,
    lsp: false,
    provider: {
      omctest: {
        api: endpoint,
        npm: "@ai-sdk/openai-compatible",
        name: "Fixture",
        env: [],
        options: { baseURL: endpoint, apiKey: "fixture" },
        models: { a: hm("a"), b: hm("b") },
      },
    },
    agent: buildOpenCodeConfig().agent,
    plugin: [
      pathToFileURL(subscriptionPlugin).href,
      pathToFileURL(join(targetRoot, "src/opencode/plugin.js")).href,
      pathToFileURL(interleavePlugin).href,
    ],
    default_agent: "omc-router",
    command: {
      "fixture-worker": {
        template: "SLASH_WORKER",
        agent: "omc-code-worker",
        subtask: true,
      },
    },
  };
  const configPath = join(root, "config/opencode/opencode.json");
  await mkdir(join(root, "config/opencode"), { recursive: true });
  const configBytes = JSON.stringify(config);
  await writeFile(configPath, configBytes);
  await writeFile(join(root, "models.json"), "{}");
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    TMPDIR: root,
    OMC_CONFIG_DIR: join(root, "policy"),
    LANG: "C",
    NO_COLOR: "1",
    OPENCODE_TEST_HOME: root,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_MODELS_PATH: join(root, "models.json"),
    OPENCODE_DISABLE_SHARE: "1",
    OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true",
    OPENCODE_AUTH_CONTENT: "{}",
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
  };
  child = spawn(
    binary,
    ["--print-logs", "serve", "--hostname", "127.0.0.1", "--port", "0"],
    { cwd: join(root, "project"), env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20000)));
  const origin = await new Promise((r, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Host readiness timeout: ${stderr}`)),
      30000,
    );
    child.stdout.on("data", (d) => {
      stdout += d;
      const m = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        r(m[0]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Host exit ${code}: ${stderr}`));
    });
  });
  const request = async (path, body, allowError = false) => {
    const res = await fetch(
      `${origin}${path}?directory=${encodeURIComponent(join(root, "project"))}`,
      {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(60000),
      },
    );
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { text };
    }
    if (!allowError) {
      assert.equal(res.status, 200, JSON.stringify(data) + stderr);
      assert.equal(
        data.info?.error,
        undefined,
        JSON.stringify(data.info?.error),
      );
    }
    if (fatal) throw fatal;
    return data;
  };
  eventController = new AbortController();
  const eventResponse = await fetch(
    `${origin}/event?directory=${encodeURIComponent(join(root, "project"))}`,
    { signal: eventController.signal },
  );
  const eventRead = (async () => {
    let pending = "";
    for await (const bytes of eventResponse.body) {
      pending += new TextDecoder().decode(bytes);
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines)
        if (line.startsWith("data: ")) {
          const event = JSON.parse(line.slice(6));
          if (event.type === "tui.toast.show") toasts.push(event.properties);
        }
    }
  })().catch(() => {});
  const session = async () =>
    (await request("/session", { title: "Isolated fixture" })).id;
  const turn = async (
    id,
    agent = "omc-router",
    text = "Fixture request",
    parts = [],
    allowError = false,
  ) =>
    request(
      `/session/${id}/message`,
      {
        agent,
        model: { providerID: "omctest", modelID: "a" },
        parts: [{ type: "text", text }, ...parts],
      },
      allowError,
    );
  const check = async (name, fn) => {
    active = name;
    const start = evidence.requests.length;
    await fn();
    assert.equal(child.exitCode, null);
    assert.equal(await readFile(configPath, "utf8"), configBytes);
    evidence.scenarios.push({
      name,
      passed: true,
      models: evidence.requests.slice(start).map((r) => r.model),
      configUnchanged: true,
      hostRestarted: false,
    });
    console.log(JSON.stringify(evidence.scenarios.at(-1)));
  };
  const inventory = await request("/config/providers");
  assert.deepEqual(
    inventory.providers.map((p) => p.id),
    ["omctest"],
  );
  assert.deepEqual(Object.keys(inventory.providers[0].models).sort(), [
    "a",
    "b",
  ]);
  for (const selected of ["a", "b"])
    await check(`all-owned-roles-${selected}`, async () => {
      await pin(selected);
      for (const agent of [
        "omc-router",
        "omc-code-worker",
        "omc-reviewer",
        "omc-vision-worker",
      ]) {
        const start = evidence.requests.length;
        await turn(await session(), agent);
        assert.deepEqual(
          evidence.requests.slice(start).map((r) => r.model),
          [selected],
        );
      }
    });
  await check("missing-new-c-and-auto-loaded", async () => {
    const discovered = ["a", "b", "c"].map((id) =>
      liveModel(`omctest/${id}`, {
        inputModalities: ["text", "image"],
        api: model(id).api,
      }),
    );
    const publicData = publicFixture(discovered);
    publicData.omctest.api = endpoint;
    const service = new ControlService({
      settingsPath: policyPath,
      discovery: async () => ({
        installed: true,
        version: evidence.host,
        models: discovered,
        availableIds: discovered.map((m) => m.id),
        complete: true,
        error: null,
        checkedAt: new Date().toISOString(),
      }),
      metadataFetch: async () => new Response(JSON.stringify(publicData)),
      integrationInstaller: {},
      usageReader: async () => {
        throw new Error("Usage inspection forbidden in host fixture");
      },
    });
    try {
      await service.initialize();
      const state = service.getState();
      assert.equal(
        state.catalog.find((m) => m.id === "omctest/c").effectiveEnabled,
        true,
      );
      const saved = await service.updateSettings(
        {
          ...state.settings,
          roleAssignments: {
            ...state.settings.roleAssignments,
            "code-worker": "omctest/c",
          },
        },
        {
          expectedSettingsRevision: state.settingsRevision,
          catalogRevision: state.catalogRevision,
        },
      );
      settings = saved.settings;
      catalog = service.catalog;
    } finally {
      await service.close();
    }
    const start = evidence.requests.length;
    const result = await turn(
      await session(),
      "omc-code-worker",
      "Missing fixture",
      [],
      true,
    );
    for (let i = 0; i < 60 && !toasts.length; i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.match(
      JSON.stringify(toasts.at(-1)),
      /OMC_HOST_MODEL_MISSING.*Reload/,
    );
    assert.equal(evidence.requests.length, start);
    await pin("auto");
    await turn(await session(), "omc-code-worker");
    assert.ok(["a", "b"].includes(evidence.requests.at(-1).model));
  });
  for (const reason of ["disabled", "unavailable", "unknown-price"])
    await check(`blocked-${reason}`, async () => {
      await pin("a");
      const original = structuredClone(catalog);
      if (reason === "disabled")
        settings.modelControls["omctest/a"] = { selection: "disabled" };
      if (reason === "unavailable")
        settings.modelControls["omctest/a"] = {
          selection: "enabled",
          available: false,
        };
      if (reason === "unknown-price")
        catalog.models.find((m) => m.id === "omctest/a").pricing =
          unknownPricing();
      await save();
      const start = evidence.requests.length;
      const result = await turn(
        await session(),
        "omc-code-worker",
        "Blocked fixture",
        [],
        true,
      );
      assert.ok(
        result.name || result.info?.error,
        "Blocked request returns an error",
      );
      assert.equal(evidence.requests.length, start);
      settings.modelControls = {};
      catalog = original;
      await pin("a");
    });
  const image = {
    type: "file",
    mime: "image/png",
    filename: "fixture.png",
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  };
  await check("media-only", async () => {
    await pin("b");
    const result = await turn(
      await session(),
      "omc-router",
      "Describe this image.",
      [image],
    );
    assert.equal(result.info.agent, "omc-vision-worker");
    assert.equal(evidence.requests.at(-1).model, "b");
    assert.deepEqual(evidence.requests.at(-1).tools, []);
  });
  await check("media-assisted-code", async () => {
    const result = await turn(
      await session(),
      "omc-router",
      "Implement the code change shown in this image.",
      [image],
    );
    assert.equal(result.info.agent, "omc-router");
    assert.equal(evidence.requests.at(-1).model, "b");
    assert.ok(evidence.requests.at(-1).tools.includes("task"));
  });
  // Workflow scenarios below drive the host's own task tool with valid model tool calls.
  const task = (prompt, role = "omc-code-worker", extra = {}) => ({
    description: "Isolated fixture task",
    prompt,
    subagent_type: role,
    ...extra,
  });
  const userText = (b) =>
    b.messages
      .filter((m) => m.role === "user")
      .map((m) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      )
      .join("\n");
  const childID = (b) => {
    const text = JSON.stringify(b.messages.filter((m) => m.role === "tool"));
    const match = text.match(
      /(?:task_id: |task id=\\")((?:ses)[a-zA-Z0-9_-]+)/,
    );
    assert.ok(match, "Actual task result must expose child ID");
    return match[1];
  };
  for (const repair of [false, true])
    await check(
      repair ? "reviewed-exact-repair" : "ordinary-task-resume",
      async () => {
        await pin("a");
        let parentCalls = 0,
          workerCalls = 0,
          returnedChild;
        handler = async (b) => {
          if (userText(b).includes("CHILD_WORK")) {
            workerCalls++;
            assert.equal(b.model, workerCalls === 1 || repair ? "a" : "b");
            return {};
          }
          if (userText(b).includes("CHILD_REVIEW")) return {};
          parentCalls++;
          if (parentCalls === 1) return { task: task("CHILD_WORK") };
          if (parentCalls === 2) {
            returnedChild = childID(b);
            settings.roleAssignments["code-worker"] = "omctest/b";
            await save();
            return {
              task: repair
                ? task("CHILD_REVIEW", "omc-reviewer")
                : task("CHILD_WORK", "omc-code-worker", {
                    task_id: childID(b),
                  }),
            };
          }
          if (repair && parentCalls === 3)
            return {
              task: task("CHILD_WORK", "omc-code-worker", {
                task_id: childID(b),
              }),
            };
          return {};
        };
        await turn(await session(), "omc-router", "PARENT_WORK");
        assert.equal(workerCalls, 2);
        if (repair) {
          handler = async (b) => {
            assert.equal(b.model, "b");
            return {};
          };
          await turn(returnedChild, "omc-code-worker", "ORDINARY_AFTER_REPAIR");
        }
        handler = async () => ({});
      },
    );
  await check("reviewed-repair-revalidated-after-selection", async () => {
    await pin("a");
    let parentCalls = 0,
      workerCalls = 0,
      workerID;
    handler = async (b) => {
      if (userText(b).includes("LATE_CHILD_WORK")) {
        workerCalls++;
        return {};
      }
      if (userText(b).includes("LATE_CHILD_REVIEW")) return {};
      parentCalls++;
      if (parentCalls === 1) return { task: task("LATE_CHILD_WORK") };
      if (parentCalls === 2) {
        workerID = childID(b);
        settings.roleAssignments["code-worker"] = "omctest/b";
        await save();
        return { task: task("LATE_CHILD_REVIEW", "omc-reviewer") };
      }
      if (parentCalls === 3)
        return {
          task: task("LATE_CHILD_WORK REVALIDATE_REVOKE", "omc-code-worker", {
            task_id: workerID,
          }),
        };
      return {};
    };
    const result = await turn(
      await session(),
      "omc-router",
      "LATE_PARENT",
      [],
      true,
    );
    assert.ok(result.name || result.info?.error);
    assert.equal(workerCalls, 1);
    assert.equal(parentCalls, 3);
    settings.modelControls = {};
    await pin("a");
    handler = async () => ({});
  });
  const until = async (predicate) => {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      if (fatal) throw fatal;
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error("Background completion timeout");
  };
  for (const revoke of [false, true])
    await check(
      revoke ? "background-revoked-repair" : "background-reviewed-exact-repair",
      async () => {
        await pin("a");
        let parentCalls = 0,
          workerCalls = 0,
          reviewerStarted = false,
          releaseReviewer;
        const reviewerGate = new Promise((r) => (releaseReviewer = r));
        const parentID = await session();
        handler = async (b) => {
          if (userText(b).includes("BG_CHILD_WORK")) {
            workerCalls++;
            assert.equal(b.model, "a");
            return {};
          }
          if (userText(b).includes("BG_CHILD_REVIEW")) {
            reviewerStarted = true;
            await reviewerGate;
            return {};
          }
          parentCalls++;
          if (parentCalls === 1) return { task: task("BG_CHILD_WORK") };
          if (parentCalls === 2)
            return {
              task: task("BG_CHILD_REVIEW", "omc-reviewer", {
                background: true,
              }),
            };
          if (parentCalls === 4)
            return {
              task: task("BG_CHILD_WORK", "omc-code-worker", {
                task_id: childID(b),
              }),
            };
          return {};
        };
        try {
          await turn(parentID, "omc-router", "BG_PARENT");
          await until(() => reviewerStarted);
          assert.equal(workerCalls, 1); // acknowledgement alone did not authorize a repair
          settings.roleAssignments["code-worker"] = "omctest/b";
          if (revoke)
            settings.modelControls["omctest/a"] = { selection: "disabled" };
          // Keep parent/reviewer eligible while revoking the original worker.
          if (revoke) settings.roleAssignments.orchestrator = "omctest/b";
          await save();
          releaseReviewer();
          await until(() => parentCalls >= 5);
          await until(
            async () => !(await request("/session/status"))[parentID],
          );
          assert.equal(workerCalls, revoke ? 1 : 2);
        } finally {
          releaseReviewer();
          settings.modelControls = {};
          await pin("a");
          handler = async () => ({});
        }
      },
    );
  await check("background-worker-ordinary-resume-b", async () => {
    await pin("a");
    let parentCalls = 0,
      workerCalls = 0,
      started = false,
      release;
    const gate = new Promise((r) => (release = r)),
      parentID = await session();
    handler = async (b) => {
      if (userText(b).includes("BG_RESUME_CHILD")) {
        workerCalls++;
        assert.equal(b.model, workerCalls === 1 ? "a" : "b");
        if (workerCalls === 1) {
          started = true;
          await gate;
        }
        return {};
      }
      parentCalls++;
      if (parentCalls === 1)
        return {
          task: task("BG_RESUME_CHILD", "omc-code-worker", {
            background: true,
          }),
        };
      if (parentCalls === 3)
        return {
          task: task("BG_RESUME_CHILD", "omc-code-worker", {
            background: true,
            task_id: childID(b),
          }),
        };
      return {};
    };
    try {
      await turn(parentID, "omc-router", "BG_RESUME_PARENT");
      await until(() => started);
      settings.roleAssignments["code-worker"] = "omctest/b";
      await save();
      release();
      await until(() => parentCalls >= 5);
      await until(async () => !(await request("/session/status"))[parentID]);
      assert.equal(workerCalls, 2);
    } finally {
      release();
      handler = async () => ({});
    }
  });
  for (const change of ["REVOKE", "IDENTITY"])
    await check(`post-selection-${change.toLowerCase()}-blocked`, async () => {
      await pin("a");
      const start = evidence.requests.length;
      const result = await turn(
        await session(),
        "omc-code-worker",
        `REVALIDATE_${change}`,
        [],
        true,
      );
      assert.ok(result.name || result.info?.error);
      assert.equal(evidence.requests.length, start);
      await save();
    });
  await check("unrelated-concurrent-session", async () => {
    await pin("b");
    let release,
      started = false;
    const gate = new Promise((r) => (release = r));
    handler = async (b) => {
      if (userText(b).includes("OWNED_CONCURRENT")) {
        started = true;
        assert.equal(b.model, "b");
        await gate;
      } else assert.equal(b.model, "a");
      return {};
    };
    const owned = turn(await session(), "omc-code-worker", "OWNED_CONCURRENT");
    try {
      await until(() => started);
      await turn(await session(), "build", "UNRELATED_CONCURRENT");
      release();
      await owned;
    } finally {
      release();
      handler = async () => ({});
    }
  });
  await check("owned-slash-subtask", async () => {
    await pin("b");
    const start = evidence.requests.length;
    const result = await request(`/session/${await session()}/command`, {
      command: "fixture-worker",
      arguments: "",
      agent: "omc-router",
      model: "omctest/a",
    });
    assert.deepEqual(
      evidence.requests.slice(start).map((r) => r.model),
      ["b", "b"],
    );
  });
  await check("slash-summary-changed-parent-pin-blocked", async () => {
    await pin("a");
    const start = evidence.requests.length;
    handler = async (b) => {
      assert.equal(b.model, "a");
      settings.roleAssignments.orchestrator = "omctest/b";
      await save();
      return {};
    };
    const result = await request(
      `/session/${await session()}/command`,
      {
        command: "fixture-worker",
        arguments: "",
        agent: "omc-router",
        model: "omctest/a",
      },
      true,
    );
    assert.ok(result.name || result.info?.error);
    assert.equal(evidence.requests.length - start, 1);
    handler = async () => ({});
  });
  await check("subscription-shaped-provider-fetch", async () => {
    settings.costPolicy = "known-cost";
    settings.paidEligibility = "configured-connections";
    await pin("b");
    await writeFile(fetchFlag, "1");
    const start = evidence.requests.length;
    await turn(await session(), "omc-code-worker", "SUBSCRIPTION_FETCH");
    assert.ok(evidence.requests.length > start);
    assert.match(await readFile(fetchMarker, "utf8"), /1/);
    await rm(fetchFlag, { force: true });
    settings.costPolicy = "free-only";
    settings.paidEligibility = "verified-pricing";
    await pin("a");
  });
  evidence.passed = true;
} finally {
  eventController?.abort();
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  fake.closeAllConnections();
  await new Promise((r) => fake.close(r));
  if (process.env.OMC_EVIDENCE_PATH)
    await writeFile(
      process.env.OMC_EVIDENCE_PATH,
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  await rm(root, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    passed: evidence.passed,
    host: evidence.host,
    scenarios: evidence.scenarios.length,
    actualRequests: evidence.requests.length,
  }),
);
