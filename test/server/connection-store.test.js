import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readConnectionSnapshot,
  writeConnectionSnapshot,
} from "../../src/server/connection-store.js";
import { deriveConnectionId } from "../../src/core/connections.js";
import { observeConnections } from "../../src/opencode/connection-observer.js";

test("connection snapshots persist atomically with private permissions and stable scope", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-connections-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, "settings.json");
  const first = await readConnectionSnapshot({ settingsPath });
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.connections.length, 0);
  assert.match(
    first.scopeId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  const observed = observeConnections({
    scopeId: first.scopeId,
    now: Date.parse("2026-09-08T12:00:00.000Z"),
    providers: [
      {
        id: "xai",
        models: {
          "grok-4.6": {
            id: "grok-4.6",
            providerID: "xai",
            api: { id: "grok-4.6", npm: "@ai-sdk/xai", url: "" },
          },
        },
      },
    ],
  });
  const written = await writeConnectionSnapshot({
    settingsPath,
    snapshot: { ...first, connections: observed },
  });
  const path = join(directory, "connections.json");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(path, "utf8"), /token|apiKey|\/home\//);
  const reread = await readConnectionSnapshot({ settingsPath });
  assert.equal(reread.scopeId, first.scopeId);
  assert.equal(reread.connections[0].id, deriveConnectionId(first.scopeId, "xai"));
  assert.equal(reread.revision, written.revision);
});
