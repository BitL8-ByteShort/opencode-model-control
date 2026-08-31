import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";

import { handleApi } from "../../src/server/app.js";

const MUTATION_SESSION_SECRET = "A".repeat(43);

function request({ method = "GET", path, headers = {}, body = "" }) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.method = method;
  stream.url = path;
  stream.headers = headers;
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
      return { statusCode, headers, body: body ? JSON.parse(body) : null };
    },
  };
}

function serviceFixture() {
  const calls = { install: 0, uninstall: 0, open: 0, reveal: 0 };
  const status = {
    installed: false,
    managed: false,
    healthy: true,
    requiresAttention: false,
    code: "NOT_INSTALLED",
    configPath: "/tmp/test-opencode.json",
    message: "Not connected.",
  };
  return {
    calls,
    service: {
      getOpenCodeConfig() {
        return {
          text: `${JSON.stringify({ mcp: { "model-control": { type: "local" } } }, null, 2)}\n`,
          warnings: [],
        };
      },
      async getOpenCodeIntegration() { return status; },
      async installOpenCodeIntegration() {
        calls.install += 1;
        return { ...status, installed: true, managed: true, code: "INSTALLED", changed: true };
      },
      async uninstallOpenCodeIntegration() {
        calls.uninstall += 1;
        return { ...status, changed: true };
      },
      async openOpenCodeConfig() {
        calls.open += 1;
        return { action: "open", configPath: status.configPath, opened: true };
      },
      async revealOpenCodeConfig() {
        calls.reveal += 1;
        return { action: "reveal", configPath: status.configPath, opened: true };
      },
    },
  };
}

async function dispatch(input, service) {
  const outgoing = response();
  try {
    const handled = await handleApi(request(input), outgoing, service, {
      mutationSessionSecret: MUTATION_SESSION_SECRET,
    });
    assert.equal(handled, true);
  } catch (error) {
    return { error };
  }
  return outgoing.result();
}

test("integration API exposes read-only status", async () => {
  const { service } = serviceFixture();
  const result = await dispatch(
    { path: "/api/opencode/integration", headers: { host: "127.0.0.1" } },
    service,
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.code, "NOT_INSTALLED");
});

test("generated config export is a direct downloadable JSONC file", async () => {
  const { service } = serviceFixture();
  const result = await dispatch(
    { path: "/api/opencode/config/export", headers: { host: "127.0.0.1" } },
    service,
  );

  assert.equal(result.statusCode, 200);
  assert.equal(
    result.headers["Content-Disposition"],
    'attachment; filename="opencode-model-control.jsonc"',
  );
  assert.equal(result.body.mcp["model-control"].type, "local");
});

test("integration API protects install and uninstall writes", async () => {
  const { service, calls } = serviceFixture();
  const rejected = await dispatch(
    {
      method: "POST",
      path: "/api/opencode/integration/install",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    service,
  );
  assert.equal(rejected.error.code, "REQUEST_MARKER_REQUIRED");
  assert.equal(calls.install, 0);

  const forgedMarker = await dispatch(
    {
      method: "POST",
      path: "/api/opencode/integration/install",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:47821",
        origin: "http://127.0.0.1:47821",
        "x-omc-request": "1",
      },
      body: "{}",
    },
    service,
  );
  assert.equal(forgedMarker.error.code, "SESSION_AUTHORIZATION_REQUIRED");
  assert.match(forgedMarker.error.message, /read-only.*opencode-model-control/i);
  assert.equal(calls.install, 0);

  const installed = await dispatch(
    {
      method: "POST",
      path: "/api/opencode/integration/install",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:47821",
        origin: "http://127.0.0.1:47821",
        "x-omc-request": "1",
        "x-omc-session": MUTATION_SESSION_SECRET,
      },
      body: "{}",
    },
    service,
  );
  assert.equal(installed.statusCode, 200);
  assert.equal(installed.body.installed, true);
  assert.equal(calls.install, 1);

  const uninstalled = await dispatch(
    {
      method: "POST",
      path: "/api/opencode/integration/uninstall",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:47821",
        origin: "http://127.0.0.1:47821",
        "x-omc-request": "1",
        "x-omc-session": MUTATION_SESSION_SECRET,
      },
      body: "{}",
    },
    service,
  );
  assert.equal(uninstalled.statusCode, 200);
  assert.equal(calls.uninstall, 1);
});

test("integration API requires JSON for mutations", async () => {
  const { service, calls } = serviceFixture();
  const result = await dispatch(
    {
      method: "POST",
      path: "/api/opencode/integration/install",
      headers: {
        host: "127.0.0.1:47821",
        origin: "http://127.0.0.1:47821",
        "x-omc-request": "1",
        "x-omc-session": MUTATION_SESSION_SECRET,
      },
    },
    service,
  );

  assert.equal(result.error.code, "JSON_REQUIRED");
  assert.equal(calls.install, 0);
});

test("advanced config actions require trusted same-origin JSON mutations", async () => {
  const { service, calls } = serviceFixture();
  const missingMarker = await dispatch(
    {
      method: "POST",
      path: "/api/opencode/config/open",
      headers: { "content-type": "application/json", host: "127.0.0.1" },
      body: "{}",
    },
    service,
  );
  assert.equal(missingMarker.error.code, "REQUEST_MARKER_REQUIRED");

  const crossOrigin = await dispatch(
    {
      method: "POST",
      path: "/api/opencode/config/reveal",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:47821",
        origin: "https://attacker.invalid",
        "x-omc-request": "1",
        "x-omc-session": MUTATION_SESSION_SECRET,
      },
      body: "{}",
    },
    service,
  );
  assert.equal(crossOrigin.error.code, "CROSS_ORIGIN_REJECTED");
  assert.deepEqual({ open: calls.open, reveal: calls.reveal }, { open: 0, reveal: 0 });

  const opened = await dispatch(
    {
      method: "POST",
      path: "/api/opencode/config/open",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:47821",
        origin: "http://127.0.0.1:47821",
        "x-omc-request": "1",
        "x-omc-session": MUTATION_SESSION_SECRET,
      },
      body: "{}",
    },
    service,
  );
  assert.equal(opened.statusCode, 200);
  assert.equal(opened.body.configPath, "/tmp/test-opencode.json");
  assert.equal(calls.open, 1);
});

test("advanced config API rejects caller-supplied paths", async () => {
  const { service, calls } = serviceFixture();
  const result = await dispatch(
    {
      method: "POST",
      path: "/api/opencode/config/open",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:47821",
        origin: "http://127.0.0.1:47821",
        "x-omc-request": "1",
        "x-omc-session": MUTATION_SESSION_SECRET,
      },
      body: JSON.stringify({ path: "/tmp/attacker-selected.json" }),
    },
    service,
  );

  assert.equal(result.error.code, "INVALID_ACTION_BODY");
  assert.equal(result.error.statusCode, 400);
  assert.equal(calls.open, 0);
});
