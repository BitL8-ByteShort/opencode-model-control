// Live public metadata only. No model inference, credentials, or runtime config.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { refreshModelsDev } from "../src/server/models-dev.js";
const result = await refreshModelsDev({});
assert.equal(
  result.error,
  null,
  "Live models.dev metadata refresh must succeed",
);
assert.ok(result.snapshot);
const modelCount = Object.keys(result.snapshot.models).length;
assert.ok(modelCount > 0, "Live metadata must contain normalized models");
const evidence = {
  schemaVersion: 1,
  kind: "live-public-metadata-no-inference",
  source: result.snapshot.source,
  digest: result.snapshot.digest,
  fetchedAt: result.snapshot.fetchedAt,
  expiresAt: result.snapshot.expiresAt,
  passed: true,
  inferenceRequests: 0,
  modelCount,
};
if (process.env.OMC_EVIDENCE_PATH)
  await writeFile(
    process.env.OMC_EVIDENCE_PATH,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
console.log(JSON.stringify(evidence));
