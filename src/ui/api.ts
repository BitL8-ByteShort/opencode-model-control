import type {
  BenchmarkSummary,
  ModelControlState,
  OpenCodeUsage,
  OpenCodeConfigResponse,
  OpenCodeConfigActionResponse,
  OpenCodeIntegrationStatus,
  RouteResponse,
  RouteModality,
  RouterSettings,
  RuntimeQualificationSummary,
  UsageWindow,
} from "./types";
import { captureMutationSession } from "./session-auth.js";

const mutationSession = captureMutationSession();
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  const mutation = MUTATING_METHODS.has(String(init.method ?? "GET").toUpperCase());

  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(mutation
          ? {
              "X-OMC-Request": "1",
              ...(mutationSession ? { "X-OMC-Session": mutationSession } : {}),
            }
          : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : "The local control service could not be reached.",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const errorBody =
      body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
        ? body.error as { code?: unknown; message?: unknown }
        : null;
    const detail =
      errorBody
        ? `${typeof errorBody.message === "string" ? errorBody.message : "Request failed."}${typeof errorBody.code === "string" ? ` (${errorBody.code})` : ""}`
        : body && typeof body === "object" && "error" in body
          ? String(body.error)
        : typeof body === "string" && body.trim()
          ? body.trim()
          : `Request failed with status ${response.status}.`;
    throw new ApiError(detail, response.status);
  }

  return body as T;
}

export function getState(signal?: AbortSignal): Promise<ModelControlState> {
  return requestJson<ModelControlState>("/api/state", { signal });
}

export function updateSettings(settings: RouterSettings): Promise<ModelControlState> {
  return requestJson<ModelControlState>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function testRoute(task: string, modality: RouteModality): Promise<RouteResponse> {
  return requestJson<RouteResponse>("/api/route", {
    method: "POST",
    body: JSON.stringify({ task, modality }),
  });
}

export function refreshCatalog(): Promise<ModelControlState | null> {
  return requestJson<ModelControlState | null>("/api/catalog/refresh", {
    method: "POST",
    body: "{}",
  });
}

export function getOpenCodeConfig(): Promise<OpenCodeConfigResponse> {
  return requestJson<OpenCodeConfigResponse>("/api/opencode/config");
}

export const openCodeConfigExportUrl = "/api/opencode/config/export";

export function getOpenCodeIntegration(signal?: AbortSignal): Promise<OpenCodeIntegrationStatus> {
  return requestJson<OpenCodeIntegrationStatus>("/api/opencode/integration", { signal });
}

export function openOpenCodeConfig(): Promise<OpenCodeConfigActionResponse> {
  return requestJson<OpenCodeConfigActionResponse>("/api/opencode/config/open", {
    method: "POST",
    body: "{}",
  });
}

export function revealOpenCodeConfig(): Promise<OpenCodeConfigActionResponse> {
  return requestJson<OpenCodeConfigActionResponse>("/api/opencode/config/reveal", {
    method: "POST",
    body: "{}",
  });
}

export function installOpenCodeIntegration(): Promise<OpenCodeIntegrationStatus> {
  return requestJson<OpenCodeIntegrationStatus>("/api/opencode/integration/install", {
    method: "POST",
    body: "{}",
  });
}

export function uninstallOpenCodeIntegration(): Promise<OpenCodeIntegrationStatus> {
  return requestJson<OpenCodeIntegrationStatus>("/api/opencode/integration/uninstall", {
    method: "POST",
    body: "{}",
  });
}

export function getBenchmarkSummary(signal?: AbortSignal): Promise<BenchmarkSummary> {
  return requestJson<BenchmarkSummary>("/api/benchmarks/summary", { signal });
}

export function getRuntimeQualification(signal?: AbortSignal): Promise<RuntimeQualificationSummary> {
  return requestJson<RuntimeQualificationSummary>("/api/runtime-qualification", { signal });
}

export function runRuntimeQualification(
  modelId: string,
  confirmations: {
    acknowledgeProviderRequest: boolean;
    acknowledgeCostAndDataTerms: boolean;
  },
): Promise<RuntimeQualificationSummary> {
  return requestJson<RuntimeQualificationSummary>("/api/runtime-qualification/run", {
    method: "POST",
    body: JSON.stringify({
      modelId,
      acknowledgeProviderRequest: confirmations.acknowledgeProviderRequest,
      acknowledgeCostAndDataTerms: confirmations.acknowledgeCostAndDataTerms,
    }),
  });
}

export function getUsage(window: UsageWindow = "30d", signal?: AbortSignal): Promise<OpenCodeUsage> {
  return requestJson<OpenCodeUsage>(`/api/usage?window=${encodeURIComponent(window)}`, { signal });
}
