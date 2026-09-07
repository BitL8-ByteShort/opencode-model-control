import { test, expect } from "@playwright/test";
import { createServer as createHttpServer } from "node:http";
import { createHash } from "node:crypto";
import { resolve, join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  capabilityDetailsSchema,
  pricingSchema,
} from "../../src/core/catalog-evidence.js";
const token = randomBytes(32).toString("base64url");
const clone = structuredClone;
const capabilities = {
  source: "opencode",
  observedAt: "2026-09-07T12:00:00.000Z",
  input: { text: true, image: true, audio: true, video: true, pdf: true },
  output: { text: true, image: false, audio: null, video: false, pdf: false },
  toolCall: true,
  reasoning: null,
  structuredOutput: false,
  temperature: true,
  attachment: true,
  interleaved: false,
  reasoningOptions: null,
  contextWindowTokens: 131072,
  inputLimitTokens: null,
  outputLimitTokens: 8192,
};
const model = (id, pricingClass = "free") => ({
  id,
  label: id.split("/")[1],
  provider: id.split("/")[0],
  available: true,
  pricingClass,
  pricing: {
    class: pricingClass,
    source: "https://models.dev/api.json",
    rates: {
      input: pricingClass === "paid" ? 1 : 0,
      output: pricingClass === "paid" ? 2 : 0,
    },
    digest: null,
    fetchedAt: "2026-09-07T12:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00Z",
    reasons: [],
  },
  capabilities: {
    effective: clone(capabilities),
    supplemental: {
      ...clone(capabilities),
      source: "models.dev",
      reasoning: true,
    },
  },
  toolCall: true,
  canOrchestrate: true,
  modalities: {
    input: ["text", "image", "audio", "video", "pdf"],
    output: ["text"],
  },
  access: ["read", "write"],
  roles: {
    orchestrator: 25,
    "code-worker": 25,
    "vision-worker": 25,
    reviewer: 25,
  },
  roleCapabilities: [
    "orchestrator",
    "code-worker",
    "vision-worker",
    "reviewer",
  ],
  selection: "policy",
  enabled: true,
  effectiveEnabled: pricingClass === "free",
  blockedReasons: pricingClass === "free" ? [] : ["paid-blocked"],
});
function initial() {
  return {
    schemaVersion: 3,
    settingsRevision: "s1",
    catalogRevision: "c1",
    blockedRoles: {},
    catalog: [
      model("fixture/Alpha"),
      model("other/Paid", "paid"),
      { ...model("fixture/Blocked", "unknown"), available: false },
    ],
    settings: {
      schemaVersion: 3,
      costPolicy: "free-only",
      costPreference: "free-first",
      autoIncludeNewModels: true,
      makeRouterDefault: true,
      maxDelegationDepth: 1,
      maxFallbacksPerAssignment: 1,
      modelControls: { "fixture/Blocked": { selection: "enabled" } },
      roleAssignments: {
        orchestrator: "auto",
        "code-worker": "auto",
        "vision-worker": "auto",
        reviewer: "fixture/Blocked",
      },
    },
    system: {
      localOnly: true,
      openCode: { installed: true, version: "1.18.28" },
      catalog: {
        source: "shared snapshot",
        lastRefreshed: "2026-09-07T12:00:00.000Z",
        succeededAt: "2026-09-07T12:00:00.000Z",
        attemptedAt: "2026-09-07T12:00:00.000Z",
        discoverySucceededAt: "2026-09-07T12:00:00.000Z",
        pricingSucceededAt: "2026-09-07T12:00:00.000Z",
        complete: true,
        status: "success",
        stale: false,
      },
    },
  };
}
let server,
  base,
  state,
  requests,
  refreshGate,
  saveGate,
  getGate,
  saveStarted,
  selectionConflict;
const pendingGates = new Set();
const gate = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  const release = () => {
    pendingGates.delete(release);
    resolve();
  };
  pendingGates.add(release);
  return { promise, release };
};
test.beforeAll(async () => {
  for (const entry of initial().catalog) {
    capabilityDetailsSchema.parse(entry.capabilities);
    pricingSchema.parse(entry.pricing);
  }
  const api = async (req, res, next) => {
    if (!req.url.startsWith("/api/")) return next();
    const path = req.url.split("?")[0];
    requests.push({ method: req.method, path });
    res.setHeader("Content-Type", "application/json");
    const send = (value, status = 200) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    if (
      req.method !== "GET" &&
      (req.headers["x-omc-session"] !== token ||
        req.headers["x-omc-request"] !== "1")
    )
      return send(
        {
          error: {
            code: "MUTATION_SESSION_REQUIRED",
            message:
              "This panel is read-only. Open an authorized panel to save.",
          },
        },
        403,
      );
    if (path === "/api/state") {
      const result = clone(state);
      const g = getGate;
      getGate = null;
      if (g) await g.promise;
      return send(result);
    }
    if (path === "/api/catalog/refresh") {
      if (refreshGate) await refreshGate.promise;
      return send(state);
    }
    if (path === "/api/settings") {
      let body = "";
      for await (const part of req) body += part;
      const input = JSON.parse(body);
      saveStarted = input;
      if (saveGate) await saveGate.promise;
      if (input.expectedSettingsRevision !== state.settingsRevision)
        return send(
          {
            error: {
              code: "SETTINGS_CONFLICT",
              message: "Saved settings changed elsewhere.",
              reasons: ["Review latest saved settings before retrying."],
            },
          },
          409,
        );
      if (selectionConflict)
        return send(
          {
            error: {
              code: "SELECTION_CONFLICT",
              message: "Selected model changed eligibility.",
              reasons: ["fixture/Alpha: unknown-pricing"],
            },
          },
          409,
        );
      if (input.settings?.schemaVersion !== 3)
        return send(
          {
            error: {
              code: "INVALID_SETTINGS",
              message: "Canonical settings v3 required.",
            },
          },
          400,
        );
      state = {
        ...state,
        settings: input.settings,
        settingsRevision: `s${Number(state.settingsRevision.slice(1)) + 1}`,
      };
      return send({
        ...state,
        rebased: input.catalogRevision !== state.catalogRevision,
      });
    }
    if (path === "/api/opencode/integration/install")
      return send({
        installed: true,
        managed: true,
        healthy: true,
        requiresAttention: false,
        changed: true,
        message: "Managed plugin updated.",
      });
    if (path === "/api/opencode/integration")
      return send({
        installed: true,
        managed: true,
        healthy: true,
        requiresAttention: false,
        message: "Managed plugin current.",
        defaultAgent: "omc-router",
      });
    if (path === "/api/opencode/config")
      return send({ text: "{}", config: {}, warnings: [] });
    if (path === "/api/benchmarks/summary")
      return send({ roles: [], caveats: [], status: "unverified" });
    if (path === "/api/runtime-qualification")
      return send({ results: [], boundaries: [], running: false });
    if (path === "/api/usage") return send(null);
    return send({ error: { message: "Unexpected fixture API action" } }, 404);
  };
  if (process.env.OMC_PACKAGE_ROOT) {
    expect(process.env.OMC_TARBALL_SHA256).toMatch(/^[a-f0-9]{64}$/);
    const dist = resolve(process.env.OMC_PACKAGE_ROOT, "dist");
    const assets = new Map();
    const http = createHttpServer((req, res) => {
      void api(req, res, async () => {
        try {
          const path = new URL(req.url, "http://fixture").pathname;
          const relative = path === "/" ? "index.html" : path.slice(1);
          const file = resolve(dist, relative);
          if (!file.startsWith(dist + "/")) {
            res.writeHead(404);
            res.end();
            return;
          }
          const bytes = await readFile(file);
          assets.set(path, createHash("sha256").update(bytes).digest("hex"));
          res.setHeader(
            "Content-Type",
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
            }[extname(file)] || "application/octet-stream",
          );
          res.end(bytes);
        } catch {
          res.writeHead(404);
          res.end();
        }
      }).catch(() => {
        res.writeHead(500);
        res.end();
      });
    });
    await new Promise((done, reject) => {
      http.once("error", reject);
      http.listen(0, "127.0.0.1", done);
    });
    base = `http://127.0.0.1:${http.address().port}/`;
    server = {
      close: async () => {
        http.closeAllConnections();
        await new Promise((done) => http.close(done));
        if (process.env.OMC_BROWSER_ASSET_EVIDENCE_PATH)
          await writeFile(
            process.env.OMC_BROWSER_ASSET_EVIDENCE_PATH,
            JSON.stringify({
              target: "installed-production-dist",
              tarballSha256: process.env.OMC_TARBALL_SHA256,
              assets: [...assets].map(([path, sha256]) => ({ path, sha256 })),
            }),
          );
      },
    };
  } else {
    const { createServer } = await import("vite");
    server = await createServer({
      server: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "isolated-panel-api",
          configureServer(s) {
            s.middlewares.use(api);
          },
        },
      ],
    });
    await server.listen();
    base = server.resolvedUrls.local[0];
  }
});
test.afterEach(async () => {
  for (const release of pendingGates) release();
  await new Promise((resolve) => setImmediate(resolve));
});
test.afterAll(async () => {
  await server?.close();
});
test.beforeEach(async () => {
  state = initial();
  requests = [];
  refreshGate = saveGate = getGate = null;
  saveStarted = null;
  selectionConflict = false;
});
async function open(page, authorized = true) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !m.text().includes("409") &&
      !m.text().includes("403")
    )
      errors.push(m.text());
  });
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  if (authorized)
    await page.addInitScript(
      (secret) => history.replaceState(null, "", `?omc_session=${secret}`),
      token,
    );
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Model availability" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("OpenCode Model Control");
  await expect.poll(() => new URL(page.url()).search).toBe("");
  return errors;
}
const row = (page, name) =>
  page
    .getByRole("row")
    .filter({ has: page.getByText(`fixture/${name}`, { exact: true }) });
const enroll = (page) =>
  page.getByRole("checkbox", { name: "Automatically include new models" });
const save = (page) =>
  page.getByRole("button", { name: "Save changes", exact: true });
const refresh = (page) =>
  page.getByRole("button", { name: "Update available models", exact: true });
async function observe(page) {
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
}

test("draft survives manual refresh, discovers details, filters and saves new selection without installation", async ({
  page,
}) => {
  const errors = await open(page);
  await enroll(page).uncheck();
  refreshGate = gate();
  await refresh(page).click();
  await page.getByRole("radio", { name: "Paid", exact: true }).click();
  state.catalog.push(model("fixture/New arrival"));
  state.catalogRevision = "c2";
  refreshGate.release();
  await expect(
    page.getByText("fixture/New arrival", { exact: true }),
  ).toBeVisible();
  await expect(enroll(page)).not.toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Paid", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("searchbox", { name: "Search models" })
    .fill("new arrival");
  await expect(
    page.getByRole("row").filter({ hasText: "fixture/Alpha" }),
  ).toHaveCount(0);
  const fresh = row(page, "New arrival");
  await fresh.getByText("Full capabilities", { exact: true }).click();
  await expect(fresh).toContainText("131,072");
  await expect(fresh).toContainText("8,192");
  await expect(fresh).toContainText("Not reported");
  await expect(fresh).toContainText("Unsupported");
  await expect(fresh).toContainText("models.dev");
  await page
    .getByRole("combobox", { name: "Primary orchestrator", exact: false })
    .selectOption("fixture/New arrival");
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  expect(state.settings.roleAssignments.orchestrator).toBe(
    "fixture/New arrival",
  );
  expect(state.settings.modelControls["fixture/New arrival"].selection).toBe(
    "enabled",
  );
  expect(requests.some((r) => r.path.includes("/install"))).toBe(false);
  expect(errors).toEqual([]);
});
test("policy enrollment, blocked off switch and pins remain explicit across Free/Paid", async ({
  page,
}) => {
  await open(page);
  const blocked = row(page, "Blocked");
  await blocked
    .getByRole("checkbox", { name: "Enable Blocked", exact: true })
    .uncheck();
  await expect(
    page.getByRole("combobox", { name: "Reviewer", exact: false }),
  ).toHaveValue("fixture/Blocked");
  await expect(blocked).toContainText("pricing");
  await enroll(page).uncheck();
  const alpha = row(page, "Alpha");
  await expect(alpha.getByRole("checkbox")).not.toBeChecked();
  await alpha.getByRole("checkbox").check();
  await alpha
    .getByRole("combobox", { name: "Selection for Alpha" })
    .selectOption("policy");
  await expect(alpha.getByRole("checkbox")).not.toBeChecked();
  await enroll(page).check();
  await expect(alpha.getByRole("checkbox")).toBeChecked();
  await page.getByRole("radio", { name: "Paid", exact: true }).click();
  const paid = page.getByRole("row").filter({ hasText: "other/Paid" });
  await expect(paid).toContainText("Eligible");
  await page.getByRole("radio", { name: "Free", exact: true }).click();
  await expect(paid).toContainText("Free policy");
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  expect(state.settings.roleAssignments.reviewer).toBe("fixture/Blocked");
  expect(state.settings.modelControls["fixture/Blocked"].selection).toBe(
    "disabled",
  );
});
test("save race retains later edits, stale responses are ignored, conflicts allow deliberate rebase", async ({
  page,
}) => {
  await open(page);
  await enroll(page).uncheck();
  getGate = gate();
  const oldGet = getGate;
  await observe(page);
  await expect.poll(() => getGate).toBe(null);
  saveGate = gate();
  await save(page).click();
  await expect.poll(() => saveStarted !== null).toBe(true);
  const duringSaveReads = requests.filter(
    (r) => r.path === "/api/state",
  ).length;
  await observe(page);
  await page.waitForTimeout(100);
  expect(requests.filter((r) => r.path === "/api/state").length).toBe(
    duringSaveReads,
  );
  await page.getByRole("radio", { name: "Paid", exact: true }).click();
  saveGate.release();
  await expect(save(page)).toBeEnabled();
  oldGet.release();
  await expect(enroll(page)).not.toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Paid", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  saveGate = null;
  state.settingsRevision = "s9";
  state.settings.maxDelegationDepth = 0;
  await save(page).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "SETTINGS_CONFLICT" }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Paid", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("button", { name: "Keep my edits on latest settings" })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Delegation depth", exact: false }),
  ).toHaveValue("0");
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  expect(state.settings.costPolicy).toBe("known-cost");
  expect(state.settings.maxDelegationDepth).toBe(0);
});
test("desktop/mobile details and provider/capability filters stay usable; read-only actions never write", async ({
  page,
  browser,
}) => {
  const errors = await open(page);
  await page
    .getByRole("combobox", { name: "Provider filter" })
    .selectOption("other");
  await expect(
    page.getByRole("row").filter({ hasText: "fixture/Alpha" }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Provider filter" })
    .selectOption("");
  await page
    .getByRole("combobox", { name: "Capability filter" })
    .selectOption("audio");
  await expect(row(page, "Alpha")).toBeVisible();
  await mkdir(
    process.env.OMC_BROWSER_SCREENSHOT_DIR || "/tmp/omc-task4-browser",
    { recursive: true },
  );
  await page.screenshot({
    path: join(
      process.env.OMC_BROWSER_SCREENSHOT_DIR || "/tmp/omc-task4-browser",
      "desktop.png",
    ),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await row(page, "Alpha")
    .getByText("Full capabilities", { exact: true })
    .click();
  const detailWidths = await row(page, "Alpha")
    .locator(".model-details")
    .first()
    .evaluate((element) => ({
      details: element.getBoundingClientRect().width,
      cell: element.parentElement.getBoundingClientRect().width,
    }));
  expect(detailWidths.details).toBeGreaterThan(detailWidths.cell * 0.9);
  await expect(row(page, "Alpha")).toContainText("Not reported");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(
      process.env.OMC_BROWSER_SCREENSHOT_DIR || "/tmp/omc-task4-browser",
      "mobile.png",
    ),
  });
  await page.screenshot({
    path: join(
      process.env.OMC_BROWSER_SCREENSHOT_DIR || "/tmp/omc-task4-browser",
      "mobile-full.png",
    ),
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "Capability filter" })
    .selectOption("reasoning");
  await expect(
    page.getByText("No models match these filters.", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  const context = await browser.newContext();
  const readOnly = await context.newPage();
  await open(readOnly, false);
  await enroll(readOnly).uncheck();
  await save(readOnly).click();
  await expect(
    readOnly.getByRole("alert").filter({ hasText: "read-only" }),
  ).toBeVisible();
  expect(state.settings.autoIncludeNewModels).toBe(true);
  await context.close();
});

test("refresh protects its result from a visibility poll and conflict rebase waits for a fresh snapshot", async ({
  page,
}) => {
  await open(page);
  await enroll(page).uncheck();
  refreshGate = gate();
  await refresh(page).click();
  const reads = requests.filter((r) => r.path === "/api/state").length;
  await observe(page);
  await page.waitForTimeout(150);
  expect(requests.filter((r) => r.path === "/api/state").length).toBe(reads);
  state.catalog.push(model("fixture/Refreshed"));
  state.catalogRevision = "c2";
  refreshGate.release();
  await expect(
    page.getByText("fixture/Refreshed", { exact: true }),
  ).toBeVisible();
  state.settingsRevision = "s9";
  state.settings.modelControls["other/Remote"] = { selection: "disabled" };
  getGate = gate();
  const pending = getGate;
  await save(page).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "SETTINGS_CONFLICT" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep my edits on latest settings" }),
  ).toBeDisabled();
  pending.release();
  await expect(
    page.getByRole("button", { name: "Keep my edits on latest settings" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Keep my edits on latest settings" })
    .click();
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  expect(state.settings.modelControls["other/Remote"]).toEqual({
    selection: "disabled",
  });
  expect(state.catalog.some((m) => m.id === "fixture/Refreshed")).toBe(true);
});

test("background state polling retains dirty edits and reports failed freshness without advancing success", async ({
  page,
}) => {
  await page.clock.install();
  await open(page);
  await enroll(page).uncheck();
  const successful = state.system.catalog.lastRefreshed;
  state.catalog.push(model("fixture/Background"));
  state.catalogRevision = "c2";
  state.system.catalog = {
    ...state.system.catalog,
    attemptedAt: "2026-09-07T15:00:00.000Z",
    status: "failure",
    complete: false,
    stale: true,
    warning: "Pricing refresh failed; previous successful snapshot retained.",
  };
  await page.clock.runFor(15000);
  await expect(
    page.getByText("fixture/Background", { exact: true }),
  ).toBeVisible();
  await expect(enroll(page)).not.toBeChecked();
  await expect(page.getByText(/Refresh failure/)).toBeVisible();
  await expect(
    page.getByText(
      "Pricing refresh failed; previous successful snapshot retained.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(state.system.catalog.lastRefreshed).toBe(successful);
  expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
});

test("selection conflict keeps the requested pin and intent visible until a corrective save", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("combobox", { name: "Primary orchestrator", exact: true })
    .selectOption("fixture/Alpha");
  selectionConflict = true;
  state.catalog[0].pricingClass = "unknown";
  state.catalogRevision = "c2";
  await save(page).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "SELECTION_CONFLICT" }),
  ).toContainText("fixture/Alpha: unknown-pricing");
  await expect(
    page.getByRole("combobox", { name: "Primary orchestrator", exact: true }),
  ).toHaveValue("fixture/Alpha");
  await expect(row(page, "Alpha").getByRole("checkbox")).toBeChecked();
  expect(state.settings.roleAssignments.orchestrator).toBe("auto");
  await row(page, "Alpha").getByRole("checkbox").uncheck();
  await expect(
    page.getByRole("combobox", { name: "Primary orchestrator", exact: true }),
  ).toHaveValue("fixture/Alpha");
  await page
    .getByRole("combobox", { name: "Primary orchestrator", exact: true })
    .selectOption("auto");
  selectionConflict = false;
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  expect(state.settings.modelControls["fixture/Alpha"].selection).toBe(
    "disabled",
  );
});

test("default-agent preference uses an explicit connection update after Save", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("checkbox", { name: "Open Omc-Router by default", exact: false })
    .uncheck();
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "Use Update connection" }),
  ).toBeVisible();
  expect(requests.filter((r) => r.path.endsWith("/install"))).toEqual([]);
  await page
    .getByRole("button", { name: "Update connection", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Restart OpenCode" }),
  ).toBeVisible();
  expect(requests.filter((r) => r.path.endsWith("/install")).length).toBe(1);
});

test("connection mutation stays unavailable during a Save even if later edits return to the old baseline", async ({
  page,
}) => {
  await open(page);
  await enroll(page).uncheck();
  saveGate = gate();
  await save(page).click();
  await expect.poll(() => saveStarted !== null).toBe(true);
  await enroll(page).check();
  await expect(
    page.getByRole("button", { name: "Update connection", exact: true }),
  ).toBeDisabled();
  saveGate.release();
  await expect(save(page)).toBeEnabled();
  await expect(enroll(page)).toBeChecked();
  expect(state.settings.autoIncludeNewModels).toBe(false);
  expect(requests.filter((r) => r.path.endsWith("/install"))).toEqual([]);
});

async function setVisibility(page, value) {
  await page.evaluate((visibility) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: visibility,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}

test("authorized stale return refreshes once with draft preservation and bounds failed-refresh retries", async ({
  page,
}) => {
  await page.clock.install();
  const errors = await open(page);
  await observe(page);
  await page.waitForTimeout(100);
  expect(
    requests.filter((request) => request.path === "/api/catalog/refresh"),
  ).toEqual([]);
  await enroll(page).uncheck();
  await setVisibility(page, "hidden");
  state.system.catalog.stale = true;
  refreshGate = gate();
  await setVisibility(page, "visible");
  await expect
    .poll(
      () =>
        requests.filter((request) => request.path === "/api/catalog/refresh")
          .length,
    )
    .toBe(1);
  await page.getByRole("radio", { name: "Paid", exact: true }).click();
  await observe(page);
  expect(
    requests.filter((request) => request.path === "/api/catalog/refresh")
      .length,
  ).toBe(1);
  state.catalog.push(model("fixture/Returned"));
  state.catalogRevision = "returned";
  state.system.catalog.status = "failure";
  state.system.catalog.complete = false;
  state.system.catalog.warning =
    "Refresh failed; previous source evidence retained.";
  refreshGate.release();
  await expect(
    page.getByText("fixture/Returned", { exact: true }),
  ).toBeVisible();
  await expect(enroll(page)).not.toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Paid", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await setVisibility(page, "hidden");
  await setVisibility(page, "visible");
  await page.clock.runFor(15000);
  expect(
    requests.filter((request) => request.path === "/api/catalog/refresh")
      .length,
  ).toBe(1);
  await page.clock.runFor(15 * 60 * 1000);
  expect(
    requests.filter((request) => request.path === "/api/catalog/refresh")
      .length,
  ).toBe(1);
  refreshGate = null;
  await setVisibility(page, "hidden");
  await setVisibility(page, "visible");
  await expect
    .poll(
      () =>
        requests.filter((request) => request.path === "/api/catalog/refresh")
          .length,
    )
    .toBe(2);
  await expect(refresh(page)).toBeEnabled();
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  expect(saveStarted.expectedSettingsRevision).toBe("s1");
  expect(state.settings.autoIncludeNewModels).toBe(false);
  expect(state.settings.costPolicy).toBe("known-cost");
  expect(requests.some((request) => request.path.endsWith("/install"))).toBe(
    false,
  );
  expect(errors).toEqual([]);
});

test("read-only stale return remains observational", async ({ page }) => {
  await open(page, false);
  state.system.catalog.stale = true;
  state.catalog.push(model("fixture/Read only return"));
  await setVisibility(page, "hidden");
  await setVisibility(page, "visible");
  await expect(
    page.getByText("fixture/Read only return", { exact: true }),
  ).toBeVisible();
  expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
});

test("delayed stale-return observation cannot start refresh after a newer Save or hidden transition", async ({
  page,
}) => {
  await open(page);
  await enroll(page).uncheck();
  state.system.catalog.stale = true;
  getGate = gate();
  const beforeSave = getGate;
  await setVisibility(page, "hidden");
  await setVisibility(page, "visible");
  await expect.poll(() => getGate).toBe(null);
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  beforeSave.release();
  await page.waitForTimeout(150);
  expect(
    requests.filter((request) => request.path === "/api/catalog/refresh"),
  ).toEqual([]);
  getGate = gate();
  const beforeHide = getGate;
  await observe(page);
  await expect.poll(() => getGate).toBe(null);
  await setVisibility(page, "hidden");
  beforeHide.release();
  await page.waitForTimeout(150);
  expect(
    requests.filter((request) => request.path === "/api/catalog/refresh"),
  ).toEqual([]);
});
