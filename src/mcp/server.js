import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { ControlService } from "../server/service.js";

const MODEL_CONTROL_VERSION = "0.1.0";
const MODALITIES = ["text", "image", "audio", "video", "pdf"];

function stableError(error) {
  const known = new Set([
    "INVALID_TASK",
    "INVALID_MODALITY",
    "NO_ELIGIBLE_FREE_MODEL",
    "NO_ELIGIBLE_MODEL",
    "RECURSIVE_DELEGATION_BLOCKED",
    "INVALID_ROLE_ASSIGNMENT",
    "DELEGATION_DISABLED",
    "INVALID_SETTINGS",
  ]);
  return {
    code: known.has(error?.code) ? error.code : "ROUTING_FAILED",
    message: known.has(error?.code)
      ? error.message
      : "The model router could not produce a safe decision.",
  };
}

function toolResult(payload, { isError = false } = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

function agentForRole(role) {
  if (role === "orchestrator") return "omc-router";
  if (["code-worker", "vision-worker", "reviewer"].includes(role)) return `omc-${role}`;
  return null;
}

function compactRoute(result) {
  const { description: _description, ...task } = result.task;
  return {
    schemaVersion: result.schemaVersion,
    route: result.route,
    task,
    assignments: (result.assignments ?? []).map((assignment) => ({
      role: assignment.role,
      agentId: agentForRole(assignment.role),
      modelId: assignment.modelId,
      fallbackModelId: assignment.fallbackModelId ?? null,
      mayDelegate: assignment.mayDelegate === true,
    })),
    reasons: result.reasons ?? [],
    integrationWarning: result.integrationWarning ?? null,
  };
}

function compactStatus(state) {
  const costPolicy = state.settings.costPolicy;
  return {
    schemaVersion: state.schemaVersion,
    policy: {
      localOnly: true,
      freeOnly: costPolicy === "free-only",
      costPolicy,
      costPreference: state.settings.costPreference,
      maxDelegationDepth: state.settings.maxDelegationDepth,
    },
    openCode: {
      installed: state.system?.openCode?.installed ?? false,
      version: state.system?.openCode?.version ?? null,
      checkedAt: state.system?.openCode?.checkedAt ?? null,
    },
    roleAssignments: state.settings.roleAssignments,
    models: state.catalog.map((model) => ({
      id: model.id,
      label: model.label,
      enabled: model.enabled === true,
      available: model.available === true,
      pricingClass:
        model.free?.verified !== true
          ? "unknown"
          : model.free.inputUsdPerMillion === 0 && model.free.outputUsdPerMillion === 0
            ? "free"
            : "paid",
      inputModalities: model.modalities?.input ?? model.inputModalities ?? ["text"],
      evidence: model.evidence?.status ?? "unverified",
    })),
  };
}

export async function createModelControlMcpServer({ service } = {}) {
  const controlService = service ?? (await new ControlService().initialize());
  const server = new McpServer(
    { name: "opencode-model-control", version: MODEL_CONTROL_VERSION },
    {
      instructions:
        "Read-only policy-controlled model routing. Call route_task before delegating nontrivial work. Follow the returned agentId exactly, stop when route is direct, and never let a specialist delegate recursively.",
    },
  );

  server.registerTool(
    "get_model_status",
    {
      title: "Get model status",
      description:
        "Read the current local enable switches, availability, modalities, evidence level, and role assignments. Returns no credentials or OpenCode configuration values.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        await controlService.reloadSettings();
        return toolResult(compactStatus(controlService.getState()));
      } catch (error) {
        return toolResult({ error: stableError(error) }, { isError: true });
      }
    },
  );

  server.registerTool(
    "route_task",
    {
      title: "Route a task",
      description:
        "Return a deterministic delegation decision using the current capability and cost controls. This recommends an OpenCode agent; it never calls a model or changes files.",
      inputSchema: z.object({
        task: z.string().trim().min(1).max(4_000).describe("Concise task description without secrets"),
        modality: z.enum(MODALITIES).default("text"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ task, modality }) => {
      try {
        await controlService.reloadSettings();
        return toolResult(compactRoute(controlService.route({ task, modality })));
      } catch (error) {
        return toolResult({ error: stableError(error) }, { isError: true });
      }
    },
  );

  return server;
}
