import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("UI client uses every required API route and mutation protection header", async () => {
  const api = await source("src/ui/api.ts");

  for (const route of [
    "/api/state",
    "/api/settings",
    "/api/route",
    "/api/catalog/refresh",
    "/api/opencode/config",
    "/api/opencode/config/export",
    "/api/opencode/config/open",
    "/api/opencode/config/reveal",
    "/api/opencode/integration",
    "/api/opencode/integration/install",
    "/api/opencode/integration/uninstall",
    "/api/benchmarks/summary",
    "/api/usage",
  ]) {
    assert.match(api, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(api, /"X-OMC-Request": "1"/);
  assert.match(api, /errorBody\.message/);
});

test("core interactions expose semantic labels and unsaved-state protection", async () => {
  const [app, table, routeTester, config, roles, usage, shell] = await Promise.all([
    source("src/ui/App.tsx"),
    source("src/ui/components/ModelTable.tsx"),
    source("src/ui/components/RouteTester.tsx"),
    source("src/ui/components/ConfigPanel.tsx"),
    source("src/ui/components/RoleAssignments.tsx"),
    source("src/ui/components/UsagePanel.tsx"),
    source("src/ui/components/AppShell.tsx"),
  ]);

  assert.match(app, /beforeunload/);
  assert.match(app, /Unsaved changes/);
  assert.match(table, /<caption className="sr-only">/);
  assert.match(table, /<th scope="col">/);
  assert.match(table, /<input[\s\S]*type="checkbox"/);
  assert.match(routeTester, /<legend>Input modality<\/legend>/);
  assert.match(routeTester, /\["text", "image", "audio", "video", "pdf"\]/);
  assert.match(routeTester, /not generate new stock images or image files/i);
  assert.match(routeTester, /integrationWarning/);
  assert.match(app, /Update available models/);
  assert.match(config, /Save your routing changes before connecting or updating OpenCode/);
  assert.match(config, /Connect to OpenCode/);
  assert.match(config, /Disconnect/);
  assert.match(config, /Advanced tools for developers/);
  assert.match(config, /Resolved OpenCode config/);
  assert.match(config, /Copy path/);
  assert.match(config, /Open config/);
  assert.match(config, /Reveal in folder/);
  assert.match(config, /Generated integration/);
  assert.match(config, /Direct edits to Model Control-owned entries/);
  assert.match(roles, />Free<\/button>/);
  assert.match(roles, />Paid<\/button>/);
  assert.match(roles, /Provider charges may apply/);
  assert.match(shell, /label: "Usage"/);
  assert.match(shell, /hashchange/);
  assert.match(shell, /aria-current/);
  assert.match(usage, /Prompts and credentials are never read/);
  assert.match(usage, /Provider-reported accounting/);
  assert.match(usage, /No zero totals were substituted/);
  assert.match(usage, /OpenCode usage by model/);
});

test("responsive and focus-visible styles are present", async () => {
  const css = await source("src/ui/styles.css");
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /td::before/);
  assert.match(css, /\.switch\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.switch input\s*\{[^}]*inset:\s*0/s);
  assert.match(css, /scroll-margin-top/);
});

test("HTML shell identifies the product and loads the React entry", async () => {
  const html = await source("index.html");
  assert.match(html, /<title>OpenCode Model Control<\/title>/);
  assert.match(html, /src="\/src\/ui\/main\.tsx"/);
  assert.match(html, /name="viewport"/);
});
