// Install and exercise the exact candidate/public tarball in an ephemeral prefix.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir, release, arch } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const tarball = resolve(process.argv[2] || "");
assert.ok(
  process.argv[2],
  "Usage: node scripts/package-acceptance.mjs /exact/package.tgz",
);
const sha256 = createHash("sha256")
  .update(await readFile(tarball))
  .digest("hex");
if (process.env.OMC_EXPECTED_SHA256)
  assert.equal(sha256, process.env.OMC_EXPECTED_SHA256);
const hostMatrix = [
  { version: "1.18.22", binary: process.env.OMC_HOST_BINARY_122 },
  {
    version: "1.18.28",
    binary: process.env.OMC_HOST_BINARY_128 || process.env.OMC_HOST_BINARY,
  },
];
for (const host of hostMatrix)
  assert.ok(
    host.binary,
    `Exact-package acceptance requires OpenCode ${host.version} (OMC_HOST_BINARY_122 and OMC_HOST_BINARY_128)`,
  );
const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const browserExecutable =
  process.env.OMC_BROWSER_EXECUTABLE || chromium.executablePath();
await stat(browserExecutable);
const evidenceBase = process.env.OMC_EVIDENCE_PATH
  ? resolve(process.env.OMC_EVIDENCE_PATH).replace(/\.json$/, "")
  : null;
const root = await mkdtemp(join(tmpdir(), "omc-package-acceptance-"));
const evidence = {
  schemaVersion: 1,
  kind: "exact-tarball-local-acceptance",
  sha256,
  node: process.version,
  platform: process.platform,
  osRelease: release(),
  architecture: arch(),
  checks: [],
  realProviderInferenceRequests: 0,
  mockedProviderRequests: 0,
  publicMetadata: "mocked unavailable; separate live metadata smoke required",
};
const env = {
  PATH: `${dirname(resolve(hostMatrix[1].binary))}:${process.env.PATH}`,
  HOME: root,
  TMPDIR: root,
  LANG: "C",
  NO_COLOR: "1",
  npm_config_cache: join(root, "npm-cache"),
  npm_config_userconfig: join(root, "empty-npmrc"),
  OMC_CONFIG_DIR: join(root, "policy"),
  OMC_OPENCODE_CONFIG_PATH: join(root, "config/opencode/opencode.jsonc"),
  OPENCODE_TEST_HOME: root,
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_SHARE: "1",
  OPENCODE_AUTH_CONTENT: "{}",
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"),
};
const children = new Set();
function start(command, args, extra = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let out = "",
    err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  return { child, output: () => out, error: () => err };
}
async function run(command, args, extra) {
  const p = start(command, args, extra);
  const code = await new Promise((r, reject) => {
    p.child.once("error", reject);
    p.child.once("exit", r);
  });
  children.delete(p.child);
  assert.equal(code, 0, `${command} ${args[0]} failed: ${p.error()}`);
  return p.output();
}
async function stop(p) {
  if (p.child.exitCode !== null || p.child.signalCode !== null) return;
  p.child.kill("SIGTERM");
  await new Promise((r) => {
    const t = setTimeout(() => {
      p.child.kill("SIGKILL");
    }, 5000);
    p.child.once("exit", () => {
      clearTimeout(t);
      r();
    });
  });
  children.delete(p.child);
}
async function until(fn) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Acceptance readiness timeout");
}
async function port() {
  const s = createServer();
  await new Promise((r, reject) => {
    s.once("error", reject);
    s.listen(0, "127.0.0.1", r);
  });
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
try {
  await writeFile(env.npm_config_userconfig, "");
  await mkdir(dirname(env.OMC_OPENCODE_CONFIG_PATH), { recursive: true });
  await mkdir(env.OMC_CONFIG_DIR);
  const original =
    '{\n  "$schema": "https://opencode.ai/config.json",\n  // Preserve this user-owned fixture comment.\n  "share": "disabled",\n  "autoupdate": false,\n}\n';
  await writeFile(env.OMC_OPENCODE_CONFIG_PATH, original, { mode: 0o640 });
  const preload = join(root, "isolate.mjs");
  await writeFile(
    preload,
    `Object.defineProperty(process.stdout, "isTTY", { value: true });\nconst original = globalThis.fetch; globalThis.fetch = (url, options) => { const u = new URL(typeof url === "string" ? url : url.url || String(url)); if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return original(url, options); if (u.href === "https://models.dev/api.json") return Promise.resolve(new Response("{}", {status:503})); throw new Error("External traffic denied by isolated package fixture"); };\n`,
  );
  env.NODE_OPTIONS = `--import=${pathToFileURL(preload).href}`;
  // npm receives no preload: registry downloads are install traffic, not inference.
  const prefix = join(root, "current");
  await run(
    "npm",
    [
      "install",
      "--prefix",
      prefix,
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    { NODE_OPTIONS: "" },
  );
  const installed = join(prefix, "node_modules/opencode-model-control");
  const cli = join(installed, "bin/opencode-model-control.js");
  evidence.version = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  ).version;
  assert.equal(
    (await run(process.execPath, [cli, "--version"])).trim(),
    evidence.version,
  );
  assert.match(
    await readFile(join(installed, "dist/index.html"), "utf8"),
    /<html/,
  );
  await assert.rejects(stat(join(prefix, "node_modules/vite")), {
    code: "ENOENT",
  });
  evidence.checks.push("clean-production-tarball-install");
  evidence.hostAcceptance = [];
  for (const host of hostMatrix) {
    const path = `${evidenceBase || join(root, "surface")}.host-${host.version}.json`;
    await run(
      process.execPath,
      [join(sourceRoot, "scripts/host-acceptance.mjs")],
      {
        NODE_OPTIONS: "",
        OMC_HOST_BINARY: host.binary,
        OMC_PACKAGE_ROOT: installed,
        OMC_TARBALL_SHA256: sha256,
        OMC_EVIDENCE_PATH: path,
      },
    );
    const proof = JSON.parse(await readFile(path, "utf8"));
    assert.equal(proof.target, "installed-tarball");
    assert.equal(proof.tarballSha256, sha256);
    assert.equal(proof.host, host.version);
    assert.equal(proof.passed, true);
    assert.equal(proof.scenarios.length, 19);
    evidence.mockedProviderRequests += proof.requests.length;
    evidence.hostAcceptance.push({
      host: proof.host,
      target: proof.target,
      tarballSha256: proof.tarballSha256,
      passed: proof.passed,
      scenarios: proof.scenarios.length,
      actualRequests: proof.requests.length,
    });
  }
  evidence.checks.push("installed-tarball-plugin-both-real-hosts");
  const browserReport = join(root, "browser-report.json"),
    assetReport = join(root, "browser-assets.json");
  const browser = start(
    process.execPath,
    [
      "--import",
      join(sourceRoot, "scripts/browser/environment.mjs"),
      join(sourceRoot, "node_modules/@playwright/test/cli.js"),
      "test",
      "--config",
      join(sourceRoot, "scripts/browser/playwright.config.mjs"),
      "--reporter=json",
    ],
    {
      NODE_OPTIONS: "",
      OMC_PACKAGE_ROOT: installed,
      OMC_TARBALL_SHA256: sha256,
      OMC_BROWSER_EXECUTABLE: browserExecutable,
      OMC_BROWSER_ASSET_EVIDENCE_PATH: assetReport,
      OMC_BROWSER_OUTPUT_DIR: join(root, "browser-output"),
      OMC_BROWSER_SCREENSHOT_DIR: join(root, "browser-screenshots"),
      PLAYWRIGHT_JSON_OUTPUT_FILE: browserReport,
    },
  );
  const browserCode = await new Promise((done, reject) => {
    browser.child.once("error", reject);
    browser.child.once("exit", done);
  });
  children.delete(browser.child);
  const report = JSON.parse(await readFile(browserReport, "utf8"));
  const assets = JSON.parse(
    await readFile(assetReport, "utf8").catch(() => "{}"),
  );
  const browserProof = {
    schemaVersion: 1,
    kind: "installed-production-ui-browser",
    tarballSha256: sha256,
    node: process.version,
    platform: process.platform,
    osRelease: release(),
    architecture: arch(),
    passed: browserCode === 0,
    expected: report.stats.expected,
    unexpected: report.stats.unexpected,
    skipped: report.stats.skipped,
    flaky: report.stats.flaky,
    assets: assets.assets || [],
  };
  if (evidenceBase)
    await writeFile(
      `${evidenceBase}.browser.json`,
      JSON.stringify(browserProof, null, 2) + "\n",
    );
  evidence.browserAcceptance = browserProof;
  assert.equal(
    browserCode,
    0,
    "Installed production UI browser scenarios failed; see redacted browser evidence",
  );
  assert.equal(report.stats.expected, 12);
  assert.equal(report.stats.unexpected, 0);
  assert.equal(report.stats.skipped, 0);
  assert.equal(report.stats.flaky, 0);
  assert.equal(assets.target, "installed-production-dist");
  assert.equal(assets.tarballSha256, sha256);
  for (const extension of ["/", ".js", ".css"])
    assert.ok(
      assets.assets.some((asset) =>
        extension === "/" ? asset.path === "/" : asset.path.endsWith(extension),
      ),
      `Browser must receive packaged ${extension} assets`,
    );
  evidence.checks.push("installed-production-dist-browser-interactions");

  const integrate = async (command, commandCli = cli) =>
    JSON.parse(
      await run(process.execPath, [
        commandCli,
        command,
        ...(command === "status" ? [] : ["--yes"]),
        "--json",
      ]),
    );
  assert.equal((await integrate("connect")).installed, true);
  assert.equal((await integrate("status")).healthy, true);
  assert.equal((await integrate("disconnect")).installed, false);
  assert.equal(await readFile(env.OMC_OPENCODE_CONFIG_PATH, "utf8"), original);
  evidence.checks.push("fresh-current-connect-status-disconnect");
  // Upgrade starts from the old version's own state, never a downgrade of
  // the newer catalog that the independent fresh-install fixture just wrote.
  await rename(env.OMC_CONFIG_DIR, join(root, "fresh-install-policy"));
  await mkdir(env.OMC_CONFIG_DIR);
  // An actual 0.2.1 install creates its own managed surface and receipt.
  const prior = resolve("packages/opencode-model-control-0.2.1.tgz");
  assert.equal(
    createHash("sha256")
      .update(await readFile(prior))
      .digest("hex"),
    "b0c0e161bec91ac384d12336d9786aa41870a65d3a291a72760a1e84fb3a489c",
  );
  const oldPrefix = join(root, "prior");
  await run(
    "npm",
    [
      "install",
      "--prefix",
      oldPrefix,
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      prior,
    ],
    { NODE_OPTIONS: "" },
  );
  const oldCore = await import(
    pathToFileURL(
      join(oldPrefix, "node_modules/opencode-model-control/src/core/index.js"),
    )
  );
  const legacySettings = oldCore.createDefaultSettings();
  assert.equal(legacySettings.schemaVersion, 2);
  await writeFile(
    join(env.OMC_CONFIG_DIR, "settings.json"),
    JSON.stringify(legacySettings),
    { mode: 0o600 },
  );
  assert.equal(
    (
      await integrate(
        "connect",
        join(
          oldPrefix,
          "node_modules/opencode-model-control/bin/opencode-model-control.js",
        ),
      )
    ).installed,
    true,
  );
  const oldReceipt = JSON.parse(
    await readFile(
      join(env.OMC_CONFIG_DIR, "opencode-integration.json"),
      "utf8",
    ),
  );
  assert.equal(oldReceipt.managedSurfaceVersion, 1);
  const legacySaved = await readFile(
    join(env.OMC_CONFIG_DIR, "settings.json"),
    "utf8",
  );
  assert.equal(JSON.parse(legacySaved).schemaVersion, 2);
  assert.equal((await integrate("status")).code, "UPDATE_REQUIRED");
  assert.equal((await integrate("connect")).installed, true);
  assert.equal((await integrate("status")).healthy, true);
  const installedConfig = await readFile(env.OMC_OPENCODE_CONFIG_PATH, "utf8");
  assert.match(installedConfig, /Preserve this user-owned fixture comment/);
  const receipt = JSON.parse(
    await readFile(
      join(env.OMC_CONFIG_DIR, "opencode-integration.json"),
      "utf8",
    ),
  );
  assert.equal(receipt.managedSurfaceVersion, 2);
  evidence.checks.push(
    "actual-0.2.1-managed-surface-upgrade",
    "connection-update-status",
    "config-comment-preserved",
  );
  const hostBinary = hostMatrix[1].binary;
  assert.ok(
    hostBinary,
    "OMC_HOST_BINARY is required for actual connect/restart/disconnect acceptance",
  );
  const restartHost = async (connected) => {
    const p = start(
      hostBinary,
      ["serve", "--hostname", "127.0.0.1", "--port", "0"],
      {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          enabled_providers: ["fixture"],
          model: "fixture/a",
          small_model: "fixture/a",
          provider: {
            fixture: {
              npm: "@ai-sdk/openai-compatible",
              api: "http://127.0.0.1:1/v1",
              options: { baseURL: "http://127.0.0.1:1/v1", apiKey: "fixture" },
              models: {
                a: {
                  name: "A",
                  cost: { input: 0, output: 0 },
                  limit: { context: 10000, output: 1000 },
                },
              },
            },
          },
        }),
      },
    );
    const origin = await until(
      () => p.output().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0],
    );
    const response = await fetch(
      `${origin}/agent?directory=${encodeURIComponent(root)}`,
    );
    assert.equal(response.status, 200);
    const agents = await response.json();
    assert.equal(
      agents.some((a) => a.name === "omc-router"),
      connected,
    );
    await stop(p);
  };
  await restartHost(true);
  evidence.checks.push("actual-host-connected-restart");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp"],
    cwd: root,
    env,
    stderr: "pipe",
  });
  const client = new Client({
    name: "isolated-tarball-acceptance",
    version: "1.0.0",
  });
  try {
    await client.connect(transport);
    assert.deepEqual(
      (await client.listTools()).tools.map((t) => t.name).sort(),
      ["get_model_status", "route_task"],
    );
    const status = await client.callTool({
      name: "get_model_status",
      arguments: {},
    });
    assert.ok(status.content.length);
  } finally {
    await client.close();
  }
  evidence.checks.push("installed-cli-mcp-handshake-and-status");
  const startPanel = async () => {
    const n = await port();
    const p = start(process.execPath, [cli, "--no-open"], {
      OMC_PORT: String(n),
      NODE_ENV: "development",
    });
    await until(() => p.output().includes("Private write-enabled URL"));
    const token = new URL(
      p.output().match(/Private write-enabled URL \(do not share\): (\S+)/)[1],
    ).searchParams.get("omc_session");
    const origin = `http://127.0.0.1:${n}`;
    return { ...p, token, origin };
  };
  const mutate = async (p, token) =>
    fetch(`${p.origin}/api/catalog/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: p.origin,
        "x-omc-request": "1",
        ...(token ? { "x-omc-session": token } : {}),
      },
      body: "{}",
    });
  let panel = await startPanel();
  const oldToken = panel.token;
  assert.equal((await fetch(`${panel.origin}/`)).status, 200);
  assert.equal((await fetch(`${panel.origin}/api/state`)).status, 200);
  assert.equal((await mutate(panel)).status, 403);
  assert.equal((await mutate(panel, panel.token)).status, 200);
  await stop(panel);
  panel = await startPanel();
  assert.notEqual(panel.token, oldToken);
  assert.equal((await mutate(panel, oldToken)).status, 403);
  assert.equal((await mutate(panel, panel.token)).status, 200);
  await stop(panel);
  evidence.checks.push(
    "production-start-without-vite",
    "read-only-panel",
    "restart-token-rotation-and-stale-token-rejection",
  );
  for (const file of await readdir(env.OMC_CONFIG_DIR))
    if (/settings|integration/.test(file))
      assert.equal(
        (await stat(join(env.OMC_CONFIG_DIR, file))).mode & 0o777,
        0o600,
        file,
      );
  const backups = (await readdir(dirname(env.OMC_OPENCODE_CONFIG_PATH))).filter(
    (f) => f.includes(".omc-backup-"),
  );
  assert.ok(backups.length >= 2);
  for (const file of backups)
    assert.equal(
      (await stat(join(dirname(env.OMC_OPENCODE_CONFIG_PATH), file))).mode &
        0o777,
      0o600,
    );
  const migrations = (await readdir(env.OMC_CONFIG_DIR)).filter((n) =>
    n.startsWith("settings.json.v2.backup-"),
  );
  assert.equal(migrations.length, 1);
  assert.equal(
    await readFile(join(env.OMC_CONFIG_DIR, migrations[0]), "utf8"),
    legacySaved,
  );
  assert.equal(
    JSON.parse(
      await readFile(join(env.OMC_CONFIG_DIR, "settings.json"), "utf8"),
    ).schemaVersion,
    3,
  );
  evidence.checks.push(
    "private-settings-receipt-and-config-backups",
    "actual-v2-v3-migration-and-private-exact-backup",
  );
  assert.equal((await integrate("disconnect")).installed, false);
  assert.equal(await readFile(env.OMC_OPENCODE_CONFIG_PATH, "utf8"), original);
  await restartHost(false);
  assert.equal((await integrate("status")).installed, false);
  evidence.checks.push(
    "disconnect-restores-exact-config",
    "actual-host-disconnected-restart-status",
  );
  evidence.passed = true;
} finally {
  for (const child of children) await stop({ child });
  if (process.env.OMC_EVIDENCE_PATH)
    await writeFile(
      process.env.OMC_EVIDENCE_PATH,
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(evidence));
