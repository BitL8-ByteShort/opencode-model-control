import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { handleApi } from "../../src/server/app.js";

function request(path) {
  const stream = Readable.from([]);
  stream.method = "GET";
  stream.url = path;
  stream.headers = { host: "127.0.0.1:47821" };
  return stream;
}

function response() {
  let statusCode;
  let headers;
  let body = "";
  return {
    writeHead(status, nextHeaders) {
      statusCode = status;
      headers = nextHeaders;
    },
    end(chunk = "") { body += chunk; },
    result() {
      return { statusCode, headers, body: JSON.parse(body) };
    },
  };
}

async function dispatch(path, service) {
  const outgoing = response();
  const handled = await handleApi(request(path), outgoing, service);
  assert.equal(handled, true);
  return outgoing.result();
}

test("usage API is read-only, no-store, and defaults to 30d", async () => {
  let receivedWindow = "not-called";
  const service = {
    async getUsage(window) {
      receivedWindow = window;
      return { schemaVersion: 1, window: window ?? "30d", totals: { messages: 0 } };
    },
  };

  const result = await dispatch("/api/usage", service);
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(result.body.window, "30d");
  assert.equal(receivedWindow, undefined);
});

test("usage API passes one validated window to the service", async () => {
  const service = {
    async getUsage(window) { return { schemaVersion: 1, window }; },
  };
  const result = await dispatch("/api/usage?window=7d", service);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.window, "7d");
});

test("usage API rejects duplicate or unknown query controls", async () => {
  const service = {
    async getUsage() { throw new Error("must not be called"); },
  };

  await assert.rejects(
    dispatch("/api/usage?window=7d&window=30d", service),
    (error) => error.code === "INVALID_USAGE_WINDOW" && error.statusCode === 400,
  );
  await assert.rejects(
    dispatch("/api/usage?project=private", service),
    (error) => error.code === "INVALID_USAGE_WINDOW" && error.statusCode === 400,
  );
});
