import test from "node:test";
import assert from "node:assert/strict";

import { announceControlPanel, browserCommand } from "../../src/server/browser.js";

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

test("startup logs only the public URL and sends the session URL only to the browser", () => {
  const messages = [];
  const launches = [];
  const publicUrl = "http://127.0.0.1:47821";
  const launchUrl = `${publicUrl}/?omc_session=${"A".repeat(43)}`;

  announceControlPanel(
    { publicUrl, launchUrl, open: true },
    {
      write(message) { messages.push(message); },
      launch(nextUrl) { launches.push(nextUrl); },
    },
  );

  assert.deepEqual(messages, [
    `OpenCode Model Control: ${publicUrl}\n`,
    "If the browser does not open, rerun opencode-model-control --no-open in your terminal.\n",
  ]);
  assert.equal(messages.join("").includes("omc_session"), false);
  assert.deepEqual(launches, [launchUrl]);
});

test("no-open prints a private write URL only to an interactive terminal", () => {
  const publicUrl = "http://127.0.0.1:47821";
  const launchUrl = `${publicUrl}/?omc_session=${"A".repeat(43)}`;
  const interactiveMessages = [];
  const redirectedMessages = [];

  announceControlPanel(
    { publicUrl, launchUrl, open: false, interactive: true },
    { write(message) { interactiveMessages.push(message); } },
  );
  announceControlPanel(
    { publicUrl, launchUrl, open: false, interactive: false },
    { write(message) { redirectedMessages.push(message); } },
  );

  assert.match(interactiveMessages.join(""), /Private write-enabled URL \(do not share\)/);
  assert.match(interactiveMessages.join(""), /omc_session=/);
  assert.equal(redirectedMessages.join("").includes("omc_session"), false);
  assert.match(redirectedMessages.join(""), /read-only.*without --no-open/i);
});
