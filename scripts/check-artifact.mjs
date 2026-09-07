import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import assert from "node:assert/strict";
const directory = process.argv[2] || "artifact";
const evidence = JSON.parse(
  await readFile(join(directory, "pack-evidence.json"), "utf8"),
);
assert.match(evidence.filename, /^opencode-model-control-[\w.-]+\.tgz$/);
assert.deepEqual(
  (await readdir(directory)).filter((n) => n.endsWith(".tgz")),
  [evidence.filename],
);
const actual = createHash("sha256")
  .update(await readFile(join(directory, evidence.filename)))
  .digest("hex");
assert.equal(actual, evidence.sha256);
assert.equal(
  await readFile(join(directory, "SHA256SUMS"), "utf8"),
  `${actual}  ${evidence.filename}\n`,
);
console.log(
  JSON.stringify({
    passed: true,
    filename: evidence.filename,
    sha256: actual,
    stage: evidence.stage,
  }),
);
