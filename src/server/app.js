import { access, readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ControlService } from "./service.js";
import {
  assertLoopbackHost,
  assertTrustedMutation,
  json,
  mimeType,
  readJson,
  safeStaticPath,
  setSecurityHeaders,
} from "./http-utils.js";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_ROOT = join(PROJECT_ROOT, "dist");

function errorPayload(error) {
  return {
    error: {
      code: error?.code ?? "INTERNAL_ERROR",
      message: error?.statusCode ? error.message : "The local control service encountered an error.",
    },
  };
}

function assertEmptyActionBody(body) {
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 0
  ) {
    throw Object.assign(new Error("This action does not accept a config path or other input."), {
      code: "INVALID_ACTION_BODY",
      statusCode: 400,
    });
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  let path = safeStaticPath(DIST_ROOT, url.pathname);
  if (!path) {
    json(response, 400, { error: { code: "INVALID_PATH", message: "Invalid path." } });
    return;
  }

  try {
    await access(path);
  } catch {
    path = join(DIST_ROOT, "index.html");
  }

  try {
    const body = await readFile(path);
    response.writeHead(200, {
      "Cache-Control": path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
      "Content-Length": body.length,
      "Content-Type": mimeType(path),
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
  } catch {
    json(response, 503, {
      error: {
        code: "UI_NOT_BUILT",
        message: "The control panel has not been built. Run npm run build first.",
      },
    });
  }
}

export async function handleApi(request, response, service) {
  const url = new URL(request.url, "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/health") {
    const policy = service.getState().settings.costPolicy;
    json(response, 200, {
      status: "ok",
      localOnly: true,
      costPolicy: policy,
      freeOnly: policy === "free-only",
    });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/state") {
    json(response, 200, service.getState());
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/usage") {
    const keys = [...url.searchParams.keys()];
    if (keys.some((key) => key !== "window") || url.searchParams.getAll("window").length > 1) {
      throw Object.assign(new Error("Usage accepts one optional window parameter."), {
        code: "INVALID_USAGE_WINDOW",
        statusCode: 400,
      });
    }
    json(response, 200, await service.getUsage(url.searchParams.get("window") ?? undefined));
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/opencode/config") {
    const result = service.getOpenCodeConfig();
    json(response, 200, result);
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/opencode/config/export") {
    const text = service.getOpenCodeConfig().text;
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="opencode-model-control.jsonc"',
      "Content-Length": Buffer.byteLength(text),
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(text);
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/opencode/integration") {
    json(response, 200, await service.getOpenCodeIntegration());
    return true;
  }
  if (
    request.method === "POST" &&
    [
      "/api/opencode/config/open",
      "/api/opencode/config/reveal",
    ].includes(url.pathname)
  ) {
    assertTrustedMutation(request);
    const body = await readJson(request);
    assertEmptyActionBody(body);
    const result = url.pathname.endsWith("/open")
      ? await service.openOpenCodeConfig()
      : await service.revealOpenCodeConfig();
    json(response, 200, result);
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/benchmarks/summary") {
    json(response, 200, service.getBenchmarkSummary());
    return true;
  }
  if (request.method === "PUT" && url.pathname === "/api/settings") {
    assertTrustedMutation(request);
    const body = await readJson(request);
    json(response, 200, await service.updateSettings(body?.settings ?? body));
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/route") {
    assertTrustedMutation(request);
    json(response, 200, service.route(await readJson(request)));
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/catalog/refresh") {
    assertTrustedMutation(request);
    if ((request.headers["content-length"] ?? "0") !== "0") await readJson(request);
    json(response, 200, await service.refreshCatalog());
    return true;
  }
  if (
    request.method === "POST" &&
    [
      "/api/opencode/integration/install",
      "/api/opencode/integration/uninstall",
    ].includes(url.pathname)
  ) {
    assertTrustedMutation(request);
    await readJson(request);
    const result = url.pathname.endsWith("/install")
      ? await service.installOpenCodeIntegration()
      : await service.uninstallOpenCodeIntegration();
    json(response, 200, result);
    return true;
  }
  if (url.pathname.startsWith("/api/")) {
    json(response, 404, { error: { code: "NOT_FOUND", message: "API route not found." } });
    return true;
  }
  return false;
}

export async function createControlServer({
  development = false,
  settingsPath,
  discovery,
  integrationInstaller,
  usageReader,
} = {}) {
  const service = await new ControlService({
    settingsPath,
    discovery,
    integrationInstaller,
    usageReader,
  }).initialize();
  const vite = development
    ? await import("vite").then(({ createServer }) =>
        createServer({ appType: "spa", server: { middlewareMode: true } }),
      )
    : null;

  const server = createHttpServer(async (request, response) => {
    setSecurityHeaders(response, { development });
    try {
      assertLoopbackHost(request);
      if (await handleApi(request, response, service)) return;
      if (!["GET", "HEAD"].includes(request.method)) {
        json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
        return;
      }
      if (vite) vite.middlewares(request, response, () => serveStatic(request, response));
      else await serveStatic(request, response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      json(response, error?.statusCode ?? 500, errorPayload(error));
    }
  });

  return {
    server,
    service,
    async close() {
      await Promise.all([
        new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
        vite?.close(),
      ]);
    },
  };
}
