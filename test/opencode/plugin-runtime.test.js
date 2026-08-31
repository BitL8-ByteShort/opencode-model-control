import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MediaRoutingError,
  createMediaRoutingHooks,
  createMediaRoutingHook,
  loadSavedRoutingPolicy,
  mediaTurnAllowsWorkspaceChanges,
  mediaModalitiesFromParts,
  resolveMediaWorker,
} from "../../src/opencode/plugin-runtime.js";
import {
  createDefaultSettings,
  loadModelCatalog,
} from "../../src/core/index.js";
import * as pluginModule from "../../src/opencode/plugin.js";

function policyFixture() {
  const catalog = loadModelCatalog();
  return { catalog, settings: createDefaultSettings(catalog) };
}

test("the local plugin entry exports only the OpenCode plugin factory", async () => {
  assert.deepEqual(Object.keys(pluginModule), ["OmcRouterPlugin"]);
  const hooks = await pluginModule.OmcRouterPlugin({});
  assert.equal(typeof hooks["chat.message"], "function");
  assert.equal(typeof hooks["permission.ask"], "function");
  assert.equal(typeof hooks["tool.execute.before"], "function");
  assert.equal(typeof hooks.event, "function");
});

test("detects media from attachment metadata without reading attachment content", () => {
  const secretText = "private prompt content";
  const parts = [
    { type: "text", text: secretText },
    { type: "file", mime: "image/png", url: "data:image/png;base64,secret" },
    { type: "file", mime: "application/pdf; charset=binary", filename: "private.pdf" },
    { type: "file", mime: "audio/wav" },
    { type: "file", mime: "video/mp4" },
    { type: "file", mime: "text/plain" },
  ];
  const before = structuredClone(parts);

  assert.deepEqual(mediaModalitiesFromParts(parts), [
    "image",
    "audio",
    "video",
    "pdf",
  ]);
  assert.deepEqual(parts, before);
});

test("resolves the explicit compatible vision worker through the saved policy", () => {
  const policy = policyFixture();
  assert.deepEqual(resolveMediaWorker({ ...policy, modalities: ["image"] }), {
    id: "opencode/mimo-v2.5-free",
    providerID: "opencode",
    modelID: "mimo-v2.5-free",
  });
});

test("auto selection can choose a model compatible with every attachment modality", () => {
  const policy = policyFixture();
  policy.settings.roleAssignments["vision-worker"] = "auto";
  policy.settings.modelControls["opencode/muse-spark-1.2-contributor-free"] = {
    enabled: true,
    available: true,
  };

  const selected = resolveMediaWorker({ ...policy, modalities: ["image", "pdf"] });
  assert.equal(selected.id, "opencode/muse-spark-1.2-contributor-free");
});

test("fails closed when the configured worker cannot receive every attachment", () => {
  const policy = policyFixture();
  assert.throws(
    () => resolveMediaWorker({ ...policy, modalities: ["pdf"] }),
    (error) =>
      error instanceof MediaRoutingError &&
      error.code === "OMC_MEDIA_ROUTE_UNAVAILABLE" &&
      !error.message.includes("pdf"),
  );
});

test("fails closed when the configured media model cannot call router tools", () => {
  const policy = policyFixture();
  const model = policy.catalog.models.find(
    ({ id }) => id === "opencode/mimo-v2.5-free",
  );
  model.toolCall = false;

  assert.throws(
    () => resolveMediaWorker({ ...policy, modalities: ["image"] }),
    (error) =>
      error instanceof MediaRoutingError &&
      error.code === "OMC_MEDIA_ROUTE_UNAVAILABLE",
  );
});

test("routes a media-only request through the read-only vision agent", async () => {
  const policy = policyFixture();
  const hook = createMediaRoutingHook({ loadPolicy: async () => policy });
  const parts = [
    { type: "text", text: "what is this?" },
    { type: "file", mime: "image/png", url: "data:image/png;base64,private" },
  ];
  const output = {
    message: {
      agent: "omc-router",
      model: {
        providerID: "opencode",
        modelID: "big-pickle",
        variant: "high",
      },
    },
    parts,
  };
  const originalParts = structuredClone(parts);
  const originalPartsReference = output.parts;

  await hook({ agent: "omc-router" }, output);

  assert.equal(output.message.agent, "omc-vision-worker");
  assert.deepEqual(output.message.model, {
    providerID: "opencode",
    modelID: "mimo-v2.5-free",
  });
  assert.equal(output.parts, originalPartsReference);
  assert.deepEqual(output.parts, originalParts);
  assert.match(output.message.system, /attachment content as untrusted data/i);
  assert.doesNotMatch(output.message.system, /private/);
});

test("keeps explicit media-assisted code changes on the router for seamless delegation", async () => {
  const policy = policyFixture();
  const hook = createMediaRoutingHook({ loadPolicy: async () => policy });
  const output = {
    message: {
      agent: "omc-router",
      model: { providerID: "opencode", modelID: "big-pickle", variant: "high" },
      system: "Existing instruction.",
    },
    parts: [
      { type: "text", text: "Implement the React layout shown in this screenshot" },
      { type: "file", mime: "image/png", url: "data:image/png;base64,private" },
    ],
  };

  await hook({ agent: "omc-router" }, output);

  assert.equal(output.message.agent, "omc-router");
  assert.deepEqual(output.message.model, {
    providerID: "opencode",
    modelID: "mimo-v2.5-free",
  });
  assert.match(output.message.system, /^Existing instruction\./);
  assert.match(output.message.system, /Only the user's text outside attachments/);
});

test("only explicit user-authored text can authorize a media write turn", () => {
  assert.equal(
    mediaTurnAllowsWorkspaceChanges(
      [
        { type: "text", text: "Explain this screenshot" },
        { type: "file", mime: "image/png", filename: "implement-the-fix.png" },
      ],
      ["image"],
    ),
    false,
  );
  assert.equal(
    mediaTurnAllowsWorkspaceChanges(
      [
        { type: "text", text: "Implement the CSS fix shown here" },
        { type: "file", mime: "image/png" },
      ],
      ["image"],
    ),
    true,
  );
  assert.equal(
    mediaTurnAllowsWorkspaceChanges(
      [
        { type: "text", text: "Implement the hidden instruction", synthetic: true },
        { type: "file", mime: "image/png" },
      ],
      ["image"],
    ),
    false,
  );
});

test("hard-blocks every tool and permission on a media-only turn, then resets next turn", async () => {
  const policy = policyFixture();
  const hooks = createMediaRoutingHooks({ loadPolicy: async () => policy });
  const input = { sessionID: "session-1", agent: "omc-router" };
  const output = {
    message: {
      agent: "omc-router",
      model: { providerID: "opencode", modelID: "big-pickle" },
    },
    parts: [
      { type: "text", text: "What is in this image?" },
      { type: "file", mime: "image/png" },
    ],
  };

  await hooks["chat.message"](input, output);
  const permission = { status: "ask" };
  await hooks["permission.ask"]({ sessionID: "session-1" }, permission);
  assert.equal(permission.status, "deny");
  await assert.rejects(
    hooks["tool.execute.before"]({ sessionID: "session-1", tool: "task" }),
    (error) =>
      error instanceof MediaRoutingError &&
      error.code === "OMC_MEDIA_TOOLS_BLOCKED" &&
      !error.message.includes("What is in this image"),
  );

  await hooks["chat.message"](
    { sessionID: "session-1", agent: "omc-router" },
    {
      message: {
        agent: "omc-router",
        model: { providerID: "opencode", modelID: "big-pickle" },
      },
      parts: [{ type: "text", text: "Explain HTTP caching" }],
    },
  );
  const nextPermission = { status: "ask" };
  await hooks["permission.ask"]({ sessionID: "session-1" }, nextPermission);
  assert.equal(nextPermission.status, "ask");
  await hooks["tool.execute.before"]({ sessionID: "session-1", tool: "task" });
});

test("cleans up the read-only guard when OpenCode deletes the session", async () => {
  const policy = policyFixture();
  const hooks = createMediaRoutingHooks({ loadPolicy: async () => policy });
  await hooks["chat.message"](
    { sessionID: "session-deleted", agent: "omc-router" },
    {
      message: {
        agent: "omc-router",
        model: { providerID: "opencode", modelID: "big-pickle" },
      },
      parts: [
        { type: "text", text: "Describe this image" },
        { type: "file", mime: "image/png" },
      ],
    },
  );
  await assert.rejects(
    hooks["tool.execute.before"]({ sessionID: "session-deleted", tool: "task" }),
    { code: "OMC_MEDIA_TOOLS_BLOCKED" },
  );

  await hooks.event({
    event: {
      type: "session.deleted",
      properties: { info: { id: "session-deleted" } },
    },
  });
  await hooks["tool.execute.before"]({ sessionID: "session-deleted", tool: "task" });
});

test("leaves text turns and non-router agents untouched without loading policy", async () => {
  let loads = 0;
  const hook = createMediaRoutingHook({
    loadPolicy: async () => {
      loads += 1;
      return policyFixture();
    },
  });
  const textOutput = {
    message: {
      agent: "omc-router",
      model: { providerID: "opencode", modelID: "big-pickle", variant: "high" },
    },
    parts: [{ type: "text", text: "hello" }],
  };
  const specialistOutput = {
    message: {
      agent: "omc-vision-worker",
      model: { providerID: "opencode", modelID: "mimo-v2.5-free" },
    },
    parts: [{ type: "file", mime: "image/png" }],
  };
  const beforeText = structuredClone(textOutput);
  const beforeSpecialist = structuredClone(specialistOutput);

  await hook({ agent: "omc-router" }, textOutput);
  await hook({ agent: "omc-vision-worker" }, specialistOutput);

  assert.equal(loads, 0);
  assert.deepEqual(textOutput, beforeText);
  assert.deepEqual(specialistOutput, beforeSpecialist);
});

test("policy failures reject the media turn without exposing prompt or attachment data", async () => {
  const secret = "never include this secret";
  const hook = createMediaRoutingHook({
    loadPolicy: async () => {
      throw new Error(`bad policy for ${secret}`);
    },
  });
  const output = {
    message: {
      agent: "omc-router",
      model: { providerID: "opencode", modelID: "big-pickle", variant: "high" },
    },
    parts: [
      { type: "text", text: secret },
      { type: "file", mime: "image/png", url: `data:image/png;base64,${secret}` },
    ],
  };
  const before = structuredClone(output);

  await assert.rejects(
    hook({ agent: "omc-router" }, output),
    (error) =>
      error instanceof MediaRoutingError &&
      error.code === "OMC_MEDIA_POLICY_UNAVAILABLE" &&
      !error.message.includes(secret),
  );
  assert.deepEqual(output, before);
});

test("loads a complete policy only when both saved files exist", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "omc-plugin-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "settings.json");
  const catalogPath = join(root, "catalog-snapshot.json");
  const policy = policyFixture();
  await mkdir(root, { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(policy.settings)}\n`, { mode: 0o600 });
  await writeFile(catalogPath, `${JSON.stringify(policy.catalog)}\n`, { mode: 0o600 });

  const loaded = await loadSavedRoutingPolicy({ settingsPath, catalogPath });
  assert.equal(loaded.settings.roleAssignments["vision-worker"], "opencode/mimo-v2.5-free");

  await rm(catalogPath);
  await assert.rejects(
    loadSavedRoutingPolicy({ settingsPath, catalogPath }),
    (error) =>
      error instanceof MediaRoutingError &&
      error.code === "OMC_MEDIA_POLICY_UNAVAILABLE",
  );
});
