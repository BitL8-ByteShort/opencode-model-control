import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { extname, join, normalize, resolve, sep } from "node:path";

export const MAX_JSON_BYTES = 64 * 1024;
export const MUTATION_SESSION_QUERY = "omc_session";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

export function setSecurityHeaders(response, { development = false } = {}) {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  if (!development) {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
    );
  }
}

export function json(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

export async function readJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw Object.assign(new Error("Requests that change settings must use JSON."), {
      code: "JSON_REQUIRED",
      statusCode: 415,
    });
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      throw Object.assign(new Error("Request payload is too large."), {
        code: "PAYLOAD_TOO_LARGE",
        statusCode: 413,
      });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body is not valid JSON."), {
      code: "INVALID_JSON",
      statusCode: 400,
    });
  }
}

export function createMutationSessionSecret() {
  return randomBytes(32).toString("base64url");
}

export function mutationSessionLaunchUrl(baseUrl, sessionSecret) {
  const url = new URL(baseUrl);
  url.searchParams.set(MUTATION_SESSION_QUERY, sessionSecret);
  return url.href;
}

function sessionSecretsMatch(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string" || !expected) return false;
  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

export function assertTrustedMutation(request, sessionSecret) {
  if (request.headers["x-omc-request"] !== "1") {
    throw Object.assign(new Error("Missing local request marker."), {
      code: "REQUEST_MARKER_REQUIRED",
      statusCode: 403,
    });
  }

  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host || !new Set([`http://${host}`, `https://${host}`]).has(origin)) {
    throw Object.assign(new Error("Cross-origin changes are not allowed."), {
      code: "CROSS_ORIGIN_REJECTED",
      statusCode: 403,
    });
  }

  if (!sessionSecretsMatch(request.headers["x-omc-session"], sessionSecret)) {
    throw Object.assign(
      new Error(
        "This browser tab is read-only. Relaunch OpenCode Model Control with the opencode-model-control command to make changes.",
      ),
      {
        code: "SESSION_AUTHORIZATION_REQUIRED",
        statusCode: 403,
      },
    );
  }
}

export function assertLoopbackHost(request) {
  const host = String(request.headers.host ?? "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    throw Object.assign(new Error("This service accepts loopback requests only."), {
      code: "LOOPBACK_ONLY",
      statusCode: 403,
    });
  }
}

export function safeStaticPath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const normalized = normalize(decoded).replace(/^([/\\])+/, "");
  const candidate = resolve(join(root, normalized || "index.html"));
  const resolvedRoot = resolve(root);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${sep}`)) return null;
  return candidate;
}

export function mimeType(path) {
  return MIME_TYPES.get(extname(path).toLowerCase()) ?? "application/octet-stream";
}
