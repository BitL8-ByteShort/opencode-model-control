import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SCHEMA_FILES = [
  "model-catalog.schema.json",
  "router-settings.schema.json",
  "route-plan.schema.json",
  "sanitized-result.schema.json",
  "routing-cases.schema.json",
];

function readJson(relativePath) {
  return JSON.parse(
    readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8"),
  );
}

test("benchmark contracts are strict versioned JSON Schemas", () => {
  const expectedVersions = new Map([["router-settings.schema.json", 2]]);
  for (const file of SCHEMA_FILES) {
    const schema = readJson(`benchmarks/schemas/${file}`);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.match(schema.$id, /^https:\/\/opencode-model-control\.local\/schemas\//);
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.schemaVersion.const, expectedVersions.get(file) ?? 1);
    assert.ok(schema.required.includes("schemaVersion"));
  }
});

test("routing benchmark fixtures use unique IDs and supported route names", () => {
  const fixtures = readJson("benchmarks/fixtures/routing-cases.json");
  const ids = fixtures.cases.map((fixture) => fixture.id);
  const routes = new Set([
    "direct",
    "orchestrator",
    "code-worker",
    "vision-worker",
    "reviewer",
  ]);

  assert.equal(fixtures.schemaVersion, 1);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)));
  assert.ok(fixtures.cases.every((fixture) => routes.has(fixture.expected.route)));
});
