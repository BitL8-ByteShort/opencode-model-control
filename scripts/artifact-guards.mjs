// Negative proof: damaged package bytes must not be rescued by checkout code.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir, release, arch } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
const tarball = resolve(process.argv[2] || "");
assert.ok(process.argv[2], "Supply a known-good local candidate tarball");
assert.ok(
  process.env.OMC_HOST_BINARY,
  "Supply the exact isolated host executable",
);
const source = fileURLToPath(new URL("..", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "omc-artifact-guards-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidence = {
  schemaVersion: 1,
  kind: "intentional-artifact-corruption-regression",
  originalTarballSha256: digest(await readFile(tarball)),
  node: process.version,
  platform: process.platform,
  osRelease: release(),
  architecture: arch(),
  realProviderInferenceRequests: 0,
  checks: [],
};
const env = {
  PATH: process.env.PATH,
  HOME: root,
  TMPDIR: root,
  npm_config_userconfig: join(root, "empty-npmrc"),
  npm_config_cache: join(root, "npm-cache"),
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"),
  NO_COLOR: "1",
};
async function execute(command, args, cwd, extra = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const code = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", done);
  });
  return { code, stdout, stderr };
}
async function command(command, args, cwd, extra) {
  const result = await execute(command, args, cwd, extra);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}
try {
  await writeFile(env.npm_config_userconfig, "");
  for (const kind of ["plugin", "ui"]) {
    const work = join(root, kind);
    await mkdir(work);
    await command("tar", ["-xzf", tarball, "-C", work], root);
    const unpacked = join(work, "package");
    let changedAssetDigest;
    if (kind === "plugin")
      await writeFile(
        join(unpacked, "src/opencode/plugin.js"),
        "export const OmcRouterPlugin = async () => ({});\n",
      );
    else {
      const html = await readFile(join(unpacked, "dist/index.html"), "utf8");
      const asset = html.match(/<script[^>]+src="\/([^\"]+)"/)[1];
      assert.match(asset, /^assets\/[\w.-]+\.js$/);
      const broken =
        'document.getElementById("root").textContent = "Intentionally broken packaged UI fixture";\n';
      await writeFile(join(unpacked, "dist", asset), broken);
      changedAssetDigest = digest(broken);
    }
    const packed = JSON.parse(
      await command(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", work],
        unpacked,
      ),
    )[0];
    const corruptTarball = join(work, packed.filename),
      sha256 = digest(await readFile(corruptTarball));
    assert.notEqual(sha256, evidence.originalTarballSha256);
    const prefix = join(work, "installed");
    await command(
      "npm",
      [
        "install",
        "--prefix",
        prefix,
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        corruptTarball,
      ],
      root,
    );
    const installed = join(prefix, "node_modules/opencode-model-control");
    const target = { OMC_PACKAGE_ROOT: installed, OMC_TARBALL_SHA256: sha256 };
    if (kind === "plugin") {
      const path = join(work, "host.json");
      const result = await execute(
        process.execPath,
        [join(source, "scripts/host-acceptance.mjs")],
        source,
        {
          ...target,
          OMC_HOST_BINARY: process.env.OMC_HOST_BINARY,
          OMC_EVIDENCE_PATH: path,
        },
      );
      assert.notEqual(
        result.code,
        0,
        "A broken packaged plugin must fail despite healthy checkout source",
      );
      const proof = JSON.parse(await readFile(path, "utf8"));
      assert.equal(proof.target, "installed-tarball");
      assert.equal(proof.tarballSha256, sha256);
      assert.ok(proof.requests.length > 0);
      assert.equal(
        proof.scenarios.some((s) => s.name === "all-owned-roles-b"),
        false,
      );
      evidence.checks.push({
        kind,
        tarballSha256: sha256,
        detected: true,
        target: proof.target,
        actualRequestModels: proof.requests.map((r) => r.model),
      });
    } else {
      const reportPath = join(work, "browser.json"),
        assetsPath = join(work, "assets.json");
      const result = await execute(
        process.execPath,
        [
          "--import",
          join(source, "scripts/browser/environment.mjs"),
          join(source, "node_modules/@playwright/test/cli.js"),
          "test",
          "--config",
          join(source, "scripts/browser/playwright.config.mjs"),
          "--reporter=json",
          "--grep",
          "draft survives manual refresh",
        ],
        source,
        {
          ...target,
          OMC_BROWSER_EXECUTABLE:
            process.env.OMC_BROWSER_EXECUTABLE || chromium.executablePath(),
          OMC_BROWSER_ASSET_EVIDENCE_PATH: assetsPath,
          PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
          OMC_BROWSER_OUTPUT_DIR: join(work, "browser-output"),
          OMC_BROWSER_SCREENSHOT_DIR: join(work, "screenshots"),
        },
      );
      assert.notEqual(
        result.code,
        0,
        "A broken packaged UI must fail despite healthy checkout source",
      );
      const report = JSON.parse(await readFile(reportPath, "utf8")),
        assets = JSON.parse(await readFile(assetsPath, "utf8"));
      assert.equal(report.stats.unexpected, 1);
      assert.equal(report.stats.skipped, 0);
      assert.equal(assets.target, "installed-production-dist");
      assert.equal(assets.tarballSha256, sha256);
      assert.ok(
        assets.assets.some((a) => a.sha256 === changedAssetDigest),
        "Browser must actually receive the corrupted packaged JavaScript",
      );
      evidence.checks.push({
        kind,
        tarballSha256: sha256,
        detected: true,
        target: assets.target,
        failedTests: report.stats.unexpected,
        servedCorruptAssetSha256: changedAssetDigest,
      });
    }
  }
  evidence.passed = true;
} finally {
  if (process.env.OMC_EVIDENCE_PATH)
    await writeFile(
      process.env.OMC_EVIDENCE_PATH,
      JSON.stringify(evidence, null, 2) + "\n",
    );
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(evidence));
