import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const directory = resolve(process.argv[2] || "artifact");
const stage = process.env.OMC_ARTIFACT_STAGE || "candidate";
assert.ok(["candidate", "final"].includes(stage));
const status = spawnSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
});
assert.equal(status.status, 0);
const sourceTreeClean = status.stdout.trim() === "";
if (stage === "final") {
  assert.ok(sourceTreeClean, "Final artifacts require a clean source tree");
  if (process.env.GITHUB_REF)
    assert.equal(
      process.env.GITHUB_REF,
      "refs/heads/main",
      "Final CI artifacts must come from protected main",
    );
}
await mkdir(directory, { recursive: true });
const result = spawnSync(
  "npm",
  ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
  { encoding: "utf8" },
);
assert.equal(result.status, 0, result.stderr);
const [{ filename }] = JSON.parse(result.stdout);
const sha256 = createHash("sha256")
  .update(await readFile(join(directory, filename)))
  .digest("hex");
await writeFile(join(directory, "SHA256SUMS"), `${sha256}  ${filename}\n`);
const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
assert.equal(commit.status, 0);
await writeFile(
  join(directory, "pack-evidence.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      stage,
      sourceTreeClean,
      commit: commit.stdout.trim(),
      node: process.version,
      filename,
      sha256,
      acceptance:
        "Required separately on Linux and macOS; this is pack evidence, not publication authorization",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ filename, sha256 }));
