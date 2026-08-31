import test from "node:test";
import assert from "node:assert/strict";

import { browserCommand } from "../../src/server/browser.js";

const url = "http://127.0.0.1:47821";

test("browser launch uses shell-free platform commands", () => {
  assert.deepEqual(browserCommand(url, { platform: "darwin", env: {} }), {
    command: "open",
    args: [url],
  });
  assert.deepEqual(browserCommand(url, { platform: "linux", env: {} }), {
    command: "xdg-open",
    args: [url],
  });
  assert.deepEqual(browserCommand(url, { platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } }), {
    command: "wslview",
    args: [url],
  });
});
