import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { handleApi } from "../../src/server/app.js";
import {
  assertTrustedMutation,
  createMutationSessionSecret,
  mutationSessionLaunchUrl,
} from "../../src/server/http-utils.js";

const MUTATION_SESSION_SECRET = "A".repeat(43);

function request({ method = "GET", path = "/api/state", headers = {}, body = "" } = {}) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.method = method;
  stream.url = path;
  stream.headers = { host: "127.0.0.1:47821", ...headers };
  return stream;
}

function response() {
  let statusCode;
  let body = "";
  return {
    writeHead(status) { statusCode = status; },
    end(chunk = "") { body += chunk; },
    result() { return { statusCode, body: body ? JSON.parse(body) : null }; },
  };
}

test("mutation session secrets are high-entropy base64url values and rotate", () => {
  const first = createMutationSessionSecret();
  const second = createMutationSessionSecret();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("authenticated launch URL carries the session without changing the public origin", () => {
  const launchUrl = new URL(mutationSessionLaunchUrl(
    "http://127.0.0.1:47821/#models",
    MUTATION_SESSION_SECRET,
  ));
  assert.equal(launchUrl.origin, "http://127.0.0.1:47821");
  assert.equal(launchUrl.searchParams.get("omc_session"), MUTATION_SESSION_SECRET);
  assert.equal(launchUrl.hash, "#models");
});

test("trusted mutations require the per-server session in addition to existing controls", () => {
  const baseHeaders = {
    origin: "http://127.0.0.1:47821",
    "x-omc-request": "1",
  };

  for (const received of [undefined, "wrong", [MUTATION_SESSION_SECRET]]) {
    assert.throws(
      () => assertTrustedMutation(
        request({ headers: { ...baseHeaders, "x-omc-session": received } }),
        MUTATION_SESSION_SECRET,
      ),
      (error) => error?.code === "SESSION_AUTHORIZATION_REQUIRED"
        && error?.statusCode === 403
        && /read-only.*opencode-model-control/i.test(error.message),
    );
  }

  assert.doesNotThrow(() => assertTrustedMutation(
    request({
      headers: { ...baseHeaders, "x-omc-session": MUTATION_SESSION_SECRET },
    }),
    MUTATION_SESSION_SECRET,
  ));
  assert.throws(
    () => assertTrustedMutation(
      request({
        headers: {
          "x-omc-request": "1",
          "x-omc-session": MUTATION_SESSION_SECRET,
        },
      }),
      MUTATION_SESSION_SECRET,
    ),
    (error) => error?.code === "CROSS_ORIGIN_REJECTED",
  );
  assert.throws(
    () => assertTrustedMutation(
      request({
        headers: {
          ...baseHeaders,
          origin: "https://attacker.invalid",
          "x-omc-session": MUTATION_SESSION_SECRET,
        },
      }),
      MUTATION_SESSION_SECRET,
    ),
    (error) => error?.code === "CROSS_ORIGIN_REJECTED",
  );
});

test("forged local mutation headers cannot reach a service side effect", async () => {
  let routes = 0;
  const service = {
    getState() { return { settings: { costPolicy: "free-only" } }; },
    route() {
      routes += 1;
      return { route: { type: "direct" } };
    },
  };
  const forged = request({
    method: "POST",
    path: `/api/route?omc_session=${MUTATION_SESSION_SECRET}`,
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:47821",
      "x-omc-request": "1",
    },
    body: JSON.stringify({ task: "test", modality: "text" }),
  });
  await assert.rejects(
    handleApi(forged, response(), service, {
      mutationSessionSecret: MUTATION_SESSION_SECRET,
    }),
    (error) => error?.code === "SESSION_AUTHORIZATION_REQUIRED",
  );
  assert.equal(routes, 0);

  const authorizedResponse = response();
  assert.equal(await handleApi(
    request({
      method: "POST",
      path: "/api/route",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:47821",
        "x-omc-request": "1",
        "x-omc-session": MUTATION_SESSION_SECRET,
      },
      body: JSON.stringify({ task: "test", modality: "text" }),
    }),
    authorizedResponse,
    service,
    { mutationSessionSecret: MUTATION_SESSION_SECRET },
  ), true);
  assert.equal(authorizedResponse.result().statusCode, 200);
  assert.equal(routes, 1);

  const readOnlyResponse = response();
  assert.equal(await handleApi(request(), readOnlyResponse, service), true);
  assert.equal(readOnlyResponse.result().statusCode, 200);
});

test("catalog refresh keeps the trusted JSON mutation contract", async () => {
  let refreshes = 0;
  const service = {
    async refreshCatalog() {
      refreshes += 1;
      return null;
    },
  };
  const trustedHeaders = {
    host: "127.0.0.1:47821",
    origin: "http://127.0.0.1:47821",
    "x-omc-request": "1",
    "x-omc-session": MUTATION_SESSION_SECRET,
  };

  await assert.rejects(
    handleApi(
      request({ method: "POST", path: "/api/catalog/refresh", headers: trustedHeaders }),
      response(),
      service,
      { mutationSessionSecret: MUTATION_SESSION_SECRET },
    ),
    (error) => error?.code === "JSON_REQUIRED",
  );
  assert.equal(refreshes, 0);

  const outgoing = response();
  assert.equal(await handleApi(
    request({
      method: "POST",
      path: "/api/catalog/refresh",
      headers: { ...trustedHeaders, "content-type": "application/json" },
      body: "{}",
    }),
    outgoing,
    service,
    { mutationSessionSecret: MUTATION_SESSION_SECRET },
  ), true);
  assert.equal(outgoing.result().statusCode, 200);
  assert.equal(refreshes, 1);
});
