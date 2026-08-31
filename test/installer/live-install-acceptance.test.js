import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OpenCodeIntegrationInstaller } from "../../src/installer/index.js";
import { parseJsoncDocument } from "../../src/installer/jsonc-document.js";

test("a real OpenCode process accepts an isolated install and disconnect restores user content", async (context) => {
  const probe = spawnSync("opencode", ["--version"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, NO_COLOR: "1" },
  });
  if (probe.error?.code === "ENOENT") {
    context.skip("OpenCode is not installed in this environment");
    return;
  }
  assert.equal(probe.status, 0, probe.stderr);

  const root = await mkdtemp(join(tmpdir(), "omc-live-install-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "opencode.jsonc");
  const receiptPath = join(root, "private", "integration.json");
  const original = `{
  // Preserve this user-owned value and comment.
  "theme": "system",
}
`;
  await writeFile(configPath, original, { mode: 0o640 });
  const installer = new OpenCodeIntegrationInstaller({ configPath, receiptPath });

  const installed = await installer.install();
  const installedConfig = parseJsoncDocument(await readFile(configPath, "utf8")).value;
  assert.equal(installed.installed, true);
  assert.equal(installedConfig.theme, "system");
  assert.equal(installedConfig.agent["omc-router"].mode, "primary");
  assert.equal(installedConfig.mcp["model-control"].type, "local");
  assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);

  const disconnected = await installer.uninstall();
  assert.equal(disconnected.installed, false);
  assert.equal(await readFile(configPath, "utf8"), original);
});
