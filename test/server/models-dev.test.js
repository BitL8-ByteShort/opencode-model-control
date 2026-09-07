import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  refreshModelsDev,
  readModelsDevCache,
} from "../../src/server/models-dev.js";
const raw = {
  vendor: {
    id: "vendor",
    npm: "sdk",
    models: { new: { id: "new", cost: { input: 0, output: 0 } } },
  },
};
test("fixed public endpoint, credential-free fetch, private cache and conditional revalidation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omc-public-"));
  const path = join(dir, "cache.json");
  let now = Date.parse("2026-09-07T12:00:00Z");
  try {
    const first = await refreshModelsDev({
      path,
      now: () => now,
      fetch: async (url, options) => {
        assert.equal(url, "https://models.dev/api.json");
        assert.equal(options.credentials, "omit");
        assert.equal(options.redirect, "error");
        assert.equal(options.headers.Authorization, undefined);
        return new Response(JSON.stringify(raw), {
          headers: {
            etag: '"one"',
            "last-modified": "Mon, 07 Sep 2026 12:00:00 GMT",
          },
        });
      },
    });
    assert.equal(first.error, null);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    now += 900000;
    const second = await refreshModelsDev({
      path,
      now: () => now,
      fetch: async (_, options) => {
        assert.equal(options.headers["If-None-Match"], '"one"');
        assert.ok(options.headers["If-Modified-Since"]);
        return new Response(null, { status: 304 });
      },
    });
    assert.equal(second.snapshot.digest, first.snapshot.digest);
    assert.notEqual(second.snapshot.fetchedAt, first.snapshot.fetchedAt);
    assert.deepEqual(
      (await readModelsDevCache({ path })).snapshot,
      second.snapshot,
    );
    now += 900000;
    const failed = await refreshModelsDev({
      path,
      now: () => now,
      fetch: async () => {
        throw new Error("SECRET");
      },
    });
    assert.equal(failed.snapshot.fetchedAt, second.snapshot.fetchedAt);
    assert.notEqual(failed.attemptedAt, second.attemptedAt);
    assert.doesNotMatch(JSON.stringify(failed), /SECRET/);
    assert.equal(
      JSON.parse(await readFile(path, "utf8")).snapshot.fetchedAt,
      second.snapshot.fetchedAt,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("fetch bounds and malformed payloads fail without creating trusted evidence", async () => {
  for (const fetch of [
    async () => new Response("{}"),
    async () => new Response("x".repeat(30)),
    async () => new Response(null, { status: 304 }),
    async () => new Response("{}", { status: 500 }),
    async () => new Promise(() => {}),
  ]) {
    const result = await refreshModelsDev({
      fetch,
      maxBytes: 20,
      timeoutMs: 10,
    });
    assert.equal(result.snapshot, null);
    assert.ok(result.error);
  }
});
test("schema, redirect, declared length and cache write failures preserve prior successful timestamps", async () => {
  const first = await refreshModelsDev({
    fetch: async () => new Response(JSON.stringify(raw)),
    now: () => Date.parse("2026-09-07T12:00:00Z"),
  });
  for (const fetch of [
    async () =>
      new Response(JSON.stringify({ vendor: { id: "different", models: {} } })),
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://private.example/secret" },
      }),
    async () =>
      new Response("{}", { headers: { "content-length": "999999999" } }),
  ]) {
    const result = await refreshModelsDev({
      previous: first,
      fetch,
      now: () => Date.parse("2026-09-07T13:00:00Z"),
    });
    assert.equal(result.snapshot.fetchedAt, first.snapshot.fetchedAt);
    assert.equal(result.snapshot.expiresAt, first.snapshot.expiresAt);
    assert.doesNotMatch(JSON.stringify(result), /private.example|secret/);
  }
  const fs = {
    mkdir: async () => {
      throw new Error("disk failure SECRET");
    },
  };
  const failedWrite = await refreshModelsDev({
    path: "/isolated/cache.json",
    previous: first,
    fs,
    fetch: async () => new Response(JSON.stringify(raw)),
    now: () => Date.parse("2026-09-07T13:00:00Z"),
  });
  assert.equal(failedWrite.snapshot.fetchedAt, first.snapshot.fetchedAt);
  assert.doesNotMatch(JSON.stringify(failedWrite), /SECRET/);
});
test("invalid URL identity remains redacted and invalid across cache read and revalidation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omc-invalid-url-"));
  const path = join(dir, "cache.json");
  const invalid = {
    ...raw,
    vendor: { ...raw.vendor, api: "https://custom.example/v1?key=TOP_SECRET" },
  };
  try {
    const first = await refreshModelsDev({
      path,
      fetch: async () => new Response(JSON.stringify(invalid)),
    });
    assert.equal(first.error, null);
    const cached = await readModelsDevCache({ path });
    assert.equal(cached.snapshot.models["vendor/new"].api.urlValid, false);
    assert.equal(cached.snapshot.models["vendor/new"].pricing.class, "unknown");
    const revalidated = await refreshModelsDev({
      path,
      fetch: async () => new Response(null, { status: 304 }),
    });
    assert.equal(revalidated.snapshot.models["vendor/new"].api.urlValid, false);
    assert.equal(
      revalidated.snapshot.models["vendor/new"].pricing.class,
      "unknown",
    );
    assert.doesNotMatch(
      await readFile(path, "utf8"),
      /TOP_SECRET|custom\.example/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
