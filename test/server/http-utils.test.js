import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { safeStaticPath } from "../../src/server/http-utils.js";

test("static paths stay inside the build directory", () => {
  const root = join(process.cwd(), "dist");
  assert.equal(safeStaticPath(root, "/../package.json"), join(root, "package.json"));
  assert.equal(safeStaticPath(root, "/assets/app.js"), join(root, "assets", "app.js"));
});
