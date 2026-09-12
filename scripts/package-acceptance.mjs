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
    assert.ok(proof.scenarios.length >= 20);
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
  assert.ok(report.stats.expected >= 14);
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
  // Fetch only the fixed public baseline. Verify both registry integrity and the
  // independently recorded release digest before npm can install any bytes.
  const baselineUrl =
    "https://registry.npmjs.org/opencode-model-control/-/opencode-model-control-0.3.0.tgz";
  const baselineSha256 =
    "26a532b44c96d643c0543a78d2fef1ab2c1a3b83886e6715cef0ab683d3413ab";
  const metadataResponse = await fetch(
    "https://registry.npmjs.org/opencode-model-control/0.3.0",
    { redirect: "error", signal: AbortSignal.timeout(30000) },
  );
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.version, "0.3.0");
  assert.equal(metadata.dist.tarball, baselineUrl);
  const baselineResponse = await fetch(baselineUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(baselineResponse.status, 200);
  const baselineBytes = Buffer.from(await baselineResponse.arrayBuffer());
  assert.equal(
    createHash("sha256").update(baselineBytes).digest("hex"),
    baselineSha256,
  );
  assert.equal(
    `sha512-${createHash("sha512").update(baselineBytes).digest("base64")}`,
    metadata.dist.integrity,
  );
  const publicBaseline = join(root, "opencode-model-control-0.3.0.tgz");
  await writeFile(publicBaseline, baselineBytes, { mode: 0o600 });
  evidence.upgradeBaseline = {
    version: "0.3.0",
    url: baselineUrl,
    sha256: baselineSha256,
    integrity: metadata.dist.integrity,
    retrievedAt: new Date().toISOString(),
    traffic: "public npm artifact and metadata retrieval; no inference",
  };
  const installedBaselines = new Map();
  for (const scenario of [
    {
      version: "0.2.1",
      schema: 2,
      surface: 1,
      paid: false,
      autoInclude: true,
      tarball: join(sourceRoot, "packages/opencode-model-control-0.2.1.tgz"),
      digest:
        "b0c0e161bec91ac384d12336d9786aa41870a65d3a291a72760a1e84fb3a489c",
    },
    {
      version: "0.3.0",
      schema: 3,
      surface: 2,
      paid: false,
      autoInclude: true,
      tarball: publicBaseline,
      digest: baselineSha256,
    },
    {
      version: "0.3.0",
      schema: 3,
      surface: 2,
      paid: true,
      autoInclude: false,
      tarball: publicBaseline,
      digest: baselineSha256,
    },
  ]) {
    const label = `${scenario.version}-${scenario.paid ? "paid" : "free"}`;
    // Every upgrade starts from its old package's own catalog and receipt.
    await rename(env.OMC_CONFIG_DIR, join(root, `policy-before-${label}`));
    await mkdir(env.OMC_CONFIG_DIR);
    assert.equal(
      createHash("sha256")
        .update(await readFile(scenario.tarball))
        .digest("hex"),
      scenario.digest,
    );
    let oldInstalled = installedBaselines.get(scenario.version);
    if (!oldInstalled) {
      const oldPrefix = join(root, `prior-${scenario.version}`);
      await run(
        "npm",
        [
          "install",
          "--prefix",
          oldPrefix,
          "--omit=dev",
          "--no-audit",
          "--no-fund",
          scenario.tarball,
        ],
        { NODE_OPTIONS: "" },
      );
      oldInstalled = join(oldPrefix, "node_modules/opencode-model-control");
      assert.equal(
        JSON.parse(await readFile(join(oldInstalled, "package.json"), "utf8"))
          .version,
        scenario.version,
      );
      installedBaselines.set(scenario.version, oldInstalled);
    }
    const oldCore = await import(
      pathToFileURL(join(oldInstalled, "src/core/index.js"))
    );
    const legacySettings = JSON.parse(
      JSON.stringify(oldCore.createDefaultSettings()),
    );
    assert.equal(legacySettings.schemaVersion, scenario.schema);
    legacySettings.costPolicy = scenario.paid ? "known-cost" : "free-only";
    legacySettings.costPreference = scenario.paid ? "paid-first" : "free-first";
    if (scenario.schema === 3)
      legacySettings.autoIncludeNewModels = scenario.autoInclude;
    if (scenario.schema === 3) legacySettings.roleAssignments.reviewer = "absent/explicit-pin";
    // 0.2.1 rejects unknown identities. Keep its fixture valid; 0.3.0 must also
    // preserve absent disabled identities and requested pins.
    const disabledId = scenario.schema === 3 ? "absent/disabled-model" : Object.entries(legacySettings.modelControls).find(([id, control]) => control.enabled && !Object.values(legacySettings.roleAssignments).includes(id))?.[0];
    assert.ok(disabledId, `${label}: baseline must expose a model to disable`);
    legacySettings.modelControls[disabledId] =
      scenario.schema === 3
        ? { selection: "disabled", available: false }
        : { enabled: false, available: false };
    assert.deepEqual(oldCore.validateSettings(legacySettings).modelControls[disabledId], legacySettings.modelControls[disabledId]);
    const settingsPath = join(env.OMC_CONFIG_DIR, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify(legacySettings, null, 2) + "\n",
      { mode: 0o600 },
    );
    assert.equal(
      (
        await integrate(
          "connect",
          join(oldInstalled, "bin/opencode-model-control.js"),
        )
      ).installed,
      true,
    );
    const receiptPath = join(env.OMC_CONFIG_DIR, "opencode-integration.json");
    const oldReceipt = await readFile(receiptPath, "utf8");
    assert.equal(
      JSON.parse(oldReceipt).managedSurfaceVersion,
      scenario.surface,
    );
    const legacySaved = await readFile(settingsPath, "utf8");
    const savedDisabled = JSON.parse(legacySaved).modelControls[disabledId];
    if (scenario.schema === 3) assert.deepEqual(savedDisabled, legacySettings.modelControls[disabledId]);
    else assert.equal(savedDisabled?.enabled, false, `${label}: old Connect must retain the disabled choice`);
    if (scenario.schema === 3) assert.equal(JSON.parse(legacySaved).roleAssignments.reviewer, "absent/explicit-pin");
    const beforeUpdate = await readFile(env.OMC_OPENCODE_CONFIG_PATH, "utf8");
    assert.equal((await integrate("status")).code, "UPDATE_REQUIRED");
    // Merely observing an outdated connection must never install a new surface.
    assert.equal(await readFile(receiptPath, "utf8"), oldReceipt);
    assert.equal(
      await readFile(env.OMC_OPENCODE_CONFIG_PATH, "utf8"),
      beforeUpdate,
    );
    assert.equal((await integrate("connect")).installed, true);
    assert.equal((await integrate("status")).healthy, true);
    assert.match(
      await readFile(env.OMC_OPENCODE_CONFIG_PATH, "utf8"),
      /Preserve this user-owned fixture comment/,
    );
    assert.equal(
      JSON.parse(await readFile(receiptPath, "utf8")).managedSurfaceVersion,
      3,
    );
    const migrated = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(migrated.schemaVersion, 4);
    assert.equal(migrated.paidEligibility, "verified-pricing");
    for (const key of [
      "costPolicy",
      "costPreference",
      "roleAssignments",
      "makeRouterDefault",
      "maxDelegationDepth",
      "maxFallbacksPerAssignment",
    ])
      assert.deepEqual(
        migrated[key],
        JSON.parse(legacySaved)[key],
        `${label}: ${key}`,
      );
    assert.equal(migrated.autoIncludeNewModels, scenario.autoInclude);
    if (scenario.schema === 3)
      assert.deepEqual(
        migrated.modelControls,
        JSON.parse(legacySaved).modelControls,
      );
    assert.deepEqual(migrated.modelControls[disabledId], {
      selection: "disabled",
      available: savedDisabled.available,
    });
    const migrations = (await readdir(env.OMC_CONFIG_DIR)).filter((name) =>
      name.startsWith(`settings.json.v${scenario.schema}.backup-`),
    );
    assert.equal(migrations.length, 1);
    const backupPath = join(env.OMC_CONFIG_DIR, migrations[0]);
    assert.equal(await readFile(backupPath, "utf8"), legacySaved);
    assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
    evidence.checks.push(
      `actual-${label}-policy-preserving-v${scenario.schema}-v4-private-exact-backup`,
    );
    // Retain the final Paid fixture for real-host restart and recovery below.
    if (!scenario.paid) {
      assert.equal((await integrate("disconnect")).installed, false);
      assert.equal(
        await readFile(env.OMC_OPENCODE_CONFIG_PATH, "utf8"),
        original,
      );
    }
  }
  evidence.checks.push(
    "connection-update-status-without-config-or-receipt-write",
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
  evidence.checks.push("private-settings-receipt-and-config-backups");
  assert.equal((await integrate("disconnect")).installed, false);
  assert.equal(await readFile(env.OMC_OPENCODE_CONFIG_PATH, "utf8"), original);
  await restartHost(false);
  assert.equal((await integrate("status")).installed, false);
  evidence.checks.push(
    "disconnect-restores-exact-config",
    "actual-host-disconnected-restart-status",
  );
  // Recover through the normal guarded connector, never by copying an old
  // full-config backup over unrelated user changes.
  assert.equal((await integrate("connect")).installed, true);
  await restartHost(true);
  assert.equal((await integrate("status")).healthy, true);
  assert.equal((await integrate("disconnect")).installed, false);
  await restartHost(false);
  assert.equal(await readFile(env.OMC_OPENCODE_CONFIG_PATH, "utf8"), original);
  evidence.checks.push(
    "post-upgrade-disconnect-reconnect-recovery-with-explicit-restarts",
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
