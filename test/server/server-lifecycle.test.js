import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createControlServer } from "../../src/server/app.js";

test("control server cleanup is safe before listen and remains idempotent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "omc-server-lifecycle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await createControlServer({
    settingsPath: join(directory, "settings.json"),
    discovery: async () => ({
      installed: false,
      version: null,
      availableIds: [],
      models: [],
      complete: false,
      checkedAt: "2026-08-31T12:00:00.000Z",
      error: { code: "OPENCODE_NOT_FOUND", message: "OpenCode was not found." },
    }),
  });

  await app.close();
  await app.close();
});
