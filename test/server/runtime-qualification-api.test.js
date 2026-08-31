import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { handleApi } from "../../src/server/app.js";

const MUTATION_SESSION_SECRET = "A".repeat(43);

function request(path, { body, method = "GET", trusted = true } = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.url = path;
  stream.headers = {
    host: "127.0.0.1:47821",
    origin: "http://127.0.0.1:47821",
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(trusted
      ? {
          "x-omc-request": "1",
          "x-omc-session": MUTATION_SESSION_SECRET,
        }
      : {}),
  };
  return stream;
}

function response() {
  let statusCode;
  let body = "";
  return {
    writeHead(status) { statusCode = status; },
    end(chunk = "") { body += chunk; },
    result() { return { statusCode, body: JSON.parse(body) }; },
  };
}

test("runtime-check history is read without invoking a provider", async () => {
  let runs = 0;
  const service = {
    getRuntimeQualificationSummary() {
      return { schemaVersion: 1, automatic: false, results: [] };
    },
    async runRuntimeQualification() { runs += 1; },
  };
  const outgoing = response();

  assert.equal(await handleApi(
    request("/api/runtime-qualification"),
    outgoing,
    service,
    { mutationSessionSecret: MUTATION_SESSION_SECRET },
  ), true);
  assert.equal(outgoing.result().statusCode, 200);
  assert.equal(runs, 0);
});

test("runtime checks require a trusted explicit POST and pass confirmations unchanged", async () => {
  let received;
  const service = {
    async runRuntimeQualification(input) {
      received = input;
      return { schemaVersion: 1, automatic: false, results: [] };
    },
  };
  const body = {
    modelId: "opencode/example-model",
    acknowledgeProviderRequest: true,
    acknowledgeCostAndDataTerms: true,
  };
  const outgoing = response();

  assert.equal(await handleApi(
    request("/api/runtime-qualification/run", { body, method: "POST" }),
    outgoing,
    service,
    { mutationSessionSecret: MUTATION_SESSION_SECRET },
  ), true);
  assert.equal(outgoing.result().statusCode, 200);
  assert.deepEqual(received, body);

  await assert.rejects(
    handleApi(
      request("/api/runtime-qualification/run", { body, method: "POST", trusted: false }),
      response(),
      service,
      { mutationSessionSecret: MUTATION_SESSION_SECRET },
    ),
    (error) => error?.code === "REQUEST_MARKER_REQUIRED",
  );
});
