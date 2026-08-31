import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildOpenCodeConfig } from "../../src/opencode/index.js";

function isolatedEnvironment(root, config) {
  return {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG ?? "C",
    NO_COLOR: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_TEST_HOME: root,
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
  };
}

test("the installed OpenCode CLI accepts the generated config without a live config write", async (context) => {
  const probe = spawnSync("opencode", ["--version"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, NO_COLOR: "1" },
  });
  if (probe.error?.code === "ENOENT") {
    context.skip("OpenCode is not installed in this environment");
    return;
  }
  assert.equal(probe.status, 0, probe.stderr);

  const root = await mkdtemp(join(tmpdir(), "omc-opencode-acceptance-"));
  try {
    const config = buildOpenCodeConfig();
    const result = spawnSync("opencode", ["debug", "config", "--pure"], {
      encoding: "utf8",
      env: isolatedEnvironment(root, config),
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000,
    });

    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const resolved = JSON.parse(result.stdout);
    assert.equal(resolved.agent?.["omc-router"]?.model, "opencode/big-pickle");
    assert.equal(resolved.agent?.["omc-code-worker"]?.mode, "subagent");
    assert.equal(resolved.agent?.["omc-vision-worker"]?.model, "opencode/mimo-v2.5-free");
    assert.equal(resolved.agent?.["omc-reviewer"]?.mode, "subagent");
    assert.deepEqual(resolved.mcp?.["model-control"]?.command, [
      "opencode-model-control",
      "mcp",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
