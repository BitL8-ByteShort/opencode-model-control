import assert from "node:assert/strict";
import test from "node:test";

import {
  captureMutationSession,
  MUTATION_SESSION_STORAGE_KEY,
} from "../../src/ui/session-auth.js";

const MUTATION_SESSION_SECRET = "A".repeat(43);

function browserFixture(href, { storageThrows = false } = {}) {
  const storage = new Map();
  let replacement = null;
  return {
    browser: {
      location: { href },
      history: {
        state: { retained: true },
        replaceState(state, title, url) {
          replacement = { state, title, url };
        },
      },
      sessionStorage: {
        getItem(key) {
          if (storageThrows) throw new Error("storage unavailable");
          return storage.get(key) ?? null;
        },
        setItem(key, value) {
          if (storageThrows) throw new Error("storage unavailable");
          storage.set(key, value);
        },
        removeItem(key) {
          if (storageThrows) throw new Error("storage unavailable");
          storage.delete(key);
        },
      },
    },
    replacement: () => replacement,
    storage,
  };
}

test("UI captures the launch session and immediately scrubs it from the URL", () => {
  const fixture = browserFixture(
    `http://127.0.0.1:47821/?view=models&omc_session=${MUTATION_SESSION_SECRET}#models`,
  );

  assert.equal(captureMutationSession(fixture.browser), MUTATION_SESSION_SECRET);
  assert.equal(
    fixture.storage.get(MUTATION_SESSION_STORAGE_KEY),
    MUTATION_SESSION_SECRET,
  );
  assert.deepEqual(fixture.replacement(), {
    state: { retained: true },
    title: "",
    url: "/?view=models#models",
  });

  fixture.browser.location.href = "http://127.0.0.1:47821/#models";
  assert.equal(captureMutationSession(fixture.browser), MUTATION_SESSION_SECRET);
});

test("UI fails closed for ambiguous launch tokens and removes them from the URL", () => {
  const fixture = browserFixture(
    `http://127.0.0.1:47821/?omc_session=${MUTATION_SESSION_SECRET}&omc_session=${"B".repeat(43)}`,
  );
  fixture.storage.set(MUTATION_SESSION_STORAGE_KEY, MUTATION_SESSION_SECRET);

  assert.equal(captureMutationSession(fixture.browser), null);
  assert.equal(fixture.storage.has(MUTATION_SESSION_STORAGE_KEY), false);
  assert.equal(fixture.replacement().url, "/");
});

test("UI keeps the query-delivered session in memory when sessionStorage is unavailable", () => {
  const fixture = browserFixture(
    `http://127.0.0.1:47821/?omc_session=${MUTATION_SESSION_SECRET}`,
    { storageThrows: true },
  );

  assert.equal(captureMutationSession(fixture.browser), MUTATION_SESSION_SECRET);
  assert.equal(fixture.replacement().url, "/");
});
