import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SCHEMA_FILES = [
  "model-catalog.schema.json",
  "router-settings.schema.json",
  "connection-store.schema.json",
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
  const expectedVersions = new Map([
    ["router-settings.schema.json", 4],
    ["model-catalog.schema.json", 2],
  ]);
  for (const file of SCHEMA_FILES) {
    const schema = readJson(`benchmarks/schemas/${file}`);
    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );
    assert.match(
      schema.$id,
      /^https:\/\/opencode-model-control\.local\/schemas\//,
    );
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.equal(
      schema.properties.schemaVersion.const,
      expectedVersions.get(file) ?? 1,
    );
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
  assert.ok(
    fixtures.cases.every((fixture) => routes.has(fixture.expected.route)),
  );
});
test("published identity and rate patterns accept the same uppercase values as runtime schemas", async () => {
  const { z } = await import("zod");
  const { apiIdentitySchema, pricingSchema } = await import(
    "../../src/core/catalog-evidence.js"
  );
  const published = readJson("benchmarks/schemas/model-catalog.schema.json")
    .$defs.model.properties;
  const accepts = (schema, value) =>
    schema.anyOf
      ? schema.anyOf.some((branch) => accepts(branch, value))
      : schema.type === "null"
        ? value === null
        : typeof value === "string" &&
          (!schema.pattern || new RegExp(schema.pattern).test(value));
  const identity = {
    id: "Nested/Model",
    npm: "@Vendor/SDK",
    url: null,
    urlValid: true,
  };
  assert.deepEqual(z.fromJSONSchema(published.api).parse(identity), identity);
  assert.equal(apiIdentitySchema.safeParse(identity).success, true);
  for (const key of ["id", "npm"])
    assert.equal(
      accepts(published.api.properties[key], identity[key]),
      true,
      key,
    );
  for (const key of [
    "mode:Fast.output",
    "MODE:Fast.OUTPUT",
    "CONTEXT_OVER_200K.INPUT_AUDIO",
  ]) {
    const rates = { input: 0, output: 0, [key]: 0 };
    assert.equal(pricingSchema.shape.rates.safeParse(rates).success, true);
    assert.equal(
      new RegExp(published.pricing.properties.rates.propertyNames.pattern).test(
        key,
      ),
      true,
      key,
    );
  }
});
