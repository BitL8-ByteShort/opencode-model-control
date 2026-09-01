import {
  classifyModelPricing,
  createDefaultSettings,
  loadModelCatalog,
  migrateSettings,
  modelSupports,
  planRoute,
  validateCatalog,
  validateSettings,
} from "../core/index.js";
import { ROLE_REQUIREMENTS } from "../core/constants.js";
import {
  OpenCodeIntegrationInstaller,
  buildManagedOpenCodeFragment,
} from "../installer/index.js";
import { BENCHMARK_SUMMARY } from "./benchmark-summary.js";
import {
  readCatalogSnapshot,
  resolveCatalogSnapshotPath,
  writeCatalogSnapshot,
} from "./catalog-store.js";
import { classifyRouteRequest } from "./task-classifier.js";
import { discoverOpenCode, mergeDiscoveredCatalog } from "./opencode-cli.js";
import { readOpenCodeUsage } from "./opencode-usage.js";
import { runOpenCodeRuntimeQualification } from "./runtime-qualification.js";
import {
  appendRuntimeQualificationResult,
  emptyRuntimeQualificationHistory,
  readRuntimeQualificationHistory,
  resolveRuntimeQualificationHistoryPath,
} from "./runtime-qualification-store.js";
import { readSettings, resolveSettingsPath, writeSettings } from "./settings-store.js";

function evidenceFor(model) {
  if (model.evidence) return model.evidence;
  if (model.profileSource === "capability" || model.modalities.input.some((modality) => modality !== "text")) {
    return { status: "capability-only", label: "Reported capability; runtime unverified" };
  }
  return { status: "candidate", label: "Unbenchmarked role" };
}

function invalidRuntimeQualification(message, code = "INVALID_RUNTIME_QUALIFICATION_REQUEST") {
  throw Object.assign(new Error(message), { code, statusCode: 400 });
}

function validateRuntimeQualificationRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalidRuntimeQualification("Runtime checks require a selected model and explicit confirmations.");
  }
  const allowedKeys = new Set([
    "modelId",
    "acknowledgeProviderRequest",
    "acknowledgeCostAndDataTerms",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    invalidRuntimeQualification("Runtime checks do not accept prompts, files, or custom provider options.");
  }
  if (typeof input.modelId !== "string" || !input.modelId.trim()) {
    invalidRuntimeQualification("Choose one available model to check.");
  }
  if (
    input.acknowledgeProviderRequest !== true ||
    input.acknowledgeCostAndDataTerms !== true
  ) {
    invalidRuntimeQualification(
      "Confirm both the real provider request and its possible cost and data-processing terms before running the check.",
      "RUNTIME_QUALIFICATION_CONFIRMATION_REQUIRED",
    );
  }
  return input.modelId.trim();
}

function publicCatalog(catalog, settings) {
  return catalog.models.map((model) => ({
    ...model,
    displayName: model.label,
    provider: model.provider ?? model.id.split("/", 1)[0],
    enabled: settings.modelControls[model.id]?.enabled ?? false,
    inputModalities: model.modalities.input,
    capabilities: Object.entries(model.roles)
      .filter(([, score]) => score > 0)
      .sort((left, right) => right[1] - left[1])
      .map(([role]) => role),
    evidence: evidenceFor(model),
  }));
}

function reconcileRuntimeSettings(input, liveCatalog) {
  const prepared = input && typeof input === "object" ? structuredClone(input) : input;
  const catalogIds = new Set(liveCatalog.models.map((model) => model.id));
  if (prepared?.modelControls && typeof prepared.modelControls === "object") {
    for (const modelId of Object.keys(prepared.modelControls)) {
      if (!catalogIds.has(modelId)) delete prepared.modelControls[modelId];
    }
    for (const model of liveCatalog.models) {
      if (prepared.modelControls[model.id]) {
        prepared.modelControls[model.id].available = model.available;
      }
    }
  }
  if (prepared?.roleAssignments && typeof prepared.roleAssignments === "object") {
    const costPolicy = prepared.schemaVersion === 2
      ? prepared.costPolicy
      : "free-only";
    for (const [role, modelId] of Object.entries(prepared.roleAssignments)) {
      const control = prepared.modelControls?.[modelId];
      const model = liveCatalog.models.find((entry) => entry.id === modelId);
      const requirement = ROLE_REQUIREMENTS[role];
      const pricing = classifyModelPricing(model);
      const costAllowed = costPolicy === "known-cost"
        ? pricing !== "unknown"
        : pricing === "free";
      if (modelId !== "auto" && (
        !model ||
        !requirement ||
        (control?.enabled ?? model?.enabledByDefault) !== true ||
        model.available !== true ||
        !costAllowed ||
        !modelSupports({
          model,
          role,
          modalities: [...requirement.modalities],
          access: requirement.access,
        })
      )) {
        prepared.roleAssignments[role] = "auto";
      }
    }
  }
  const settings = migrateSettings(prepared, liveCatalog);
  for (const model of liveCatalog.models) {
    settings.modelControls[model.id].available = model.available;
  }
  for (const role of Object.keys(settings.roleAssignments)) {
    const modelId = settings.roleAssignments[role];
    if (modelId === "auto") continue;
    const control = settings.modelControls[modelId];
    const model = liveCatalog.models.find((entry) => entry.id === modelId);
    if (!model?.available || !control?.available || !control?.enabled) {
      settings.roleAssignments[role] = "auto";
    }
  }
  return validateSettings(settings, liveCatalog);
}

function unavailableCatalog(catalog) {
  return validateCatalog({
    ...catalog,
    models: catalog.models.map((model) => ({
      ...model,
      available: false,
      discovered: false,
      runtimeVerified: false,
    })),
  });
}

export class ControlService {
  constructor({
    settingsPath,
    catalogSnapshotPath,
    discovery = discoverOpenCode,
    integrationInstaller = new OpenCodeIntegrationInstaller(),
    usageReader = readOpenCodeUsage,
    runtimeQualificationRunner = runOpenCodeRuntimeQualification,
    runtimeQualificationHistoryPath,
  } = {}) {
    this.settingsPath = settingsPath ?? resolveSettingsPath();
    this.catalogSnapshotPath = catalogSnapshotPath ?? resolveCatalogSnapshotPath(this.settingsPath);
    this.runtimeQualificationHistoryPath = runtimeQualificationHistoryPath ??
      resolveRuntimeQualificationHistoryPath(this.settingsPath);
    this.discovery = discovery;
    this.integrationInstaller = integrationInstaller;
    this.usageReader = usageReader;
    this.runtimeQualificationRunner = runtimeQualificationRunner;
    this.baseCatalog = loadModelCatalog();
    this.catalog = unavailableCatalog(this.baseCatalog);
    this.hasLiveSnapshot = false;
    this.settings = createDefaultSettings(this.catalog);
    this.openCode = {
      installed: null,
      version: null,
      availableIds: [],
      models: [],
      complete: false,
      checkedAt: null,
      error: null,
    };
    this.runtimeQualificationHistory = emptyRuntimeQualificationHistory();
    this.runtimeQualificationWarning = null;
    this.runtimeQualificationRunning = false;
  }

  async initialize() {
    const persistedCatalog = await readCatalogSnapshot({ path: this.catalogSnapshotPath });
    try {
      this.runtimeQualificationHistory = await readRuntimeQualificationHistory({
        path: this.runtimeQualificationHistoryPath,
      });
    } catch {
      this.runtimeQualificationHistory = emptyRuntimeQualificationHistory();
      this.runtimeQualificationWarning =
        "Stored runtime-check history is unreadable and was ignored. Remove the local history file before running another check.";
    }
    if (persistedCatalog) {
      this.catalog = persistedCatalog;
      this.hasLiveSnapshot = true;
    }
    await this.#applyDiscovery(await this.discovery({ refresh: false }));
    this.settings = await readSettings({
      path: this.settingsPath,
      migrate: (value) => reconcileRuntimeSettings(value, this.catalog),
    });
    this.settings = reconcileRuntimeSettings(this.settings, this.catalog);
    return this;
  }

  getState() {
    return {
      schemaVersion: 2,
      system: {
        localOnly: true,
        freeOnly: this.settings.costPolicy === "free-only",
        costPreference: this.settings.costPreference,
        costPolicy: this.settings.costPolicy,
        openCode: this.openCode,
        catalog: {
          source: this.openCode.complete === false
            ? "OpenCode CLI (plugin-free fallback)"
            : "OpenCode CLI",
          snapshotDate: this.catalog.snapshotDate,
          lastRefreshed: this.openCode.checkedAt,
          stale: Boolean(this.openCode.error),
          complete: this.openCode.complete === true,
          warning: this.openCode.error?.message ?? null,
        },
      },
      catalog: publicCatalog(this.catalog, this.settings),
      settings: this.settings,
    };
  }

  async refreshCatalog() {
    await this.#applyDiscovery(await this.discovery({ refresh: true }));
    this.settings = reconcileRuntimeSettings(this.settings, this.catalog);
    await writeSettings(this.settings, { path: this.settingsPath });
    return this.getState();
  }

  async #applyDiscovery(result) {
    const previousCatalog = this.catalog;
    this.openCode = result;
    if (Array.isArray(result.models) && result.models.length > 0) {
      let merged = mergeDiscoveredCatalog(
        this.hasLiveSnapshot ? previousCatalog : this.baseCatalog,
        result.models,
        { curatedCatalog: this.baseCatalog },
      );
      if (result.complete === false && this.hasLiveSnapshot) {
        const discoveredIds = new Set(result.models.map((model) => model.id));
        const previousById = new Map(previousCatalog.models.map((model) => [model.id, model]));
        merged = {
          ...merged,
          models: merged.models.map((model) =>
            discoveredIds.has(model.id) || !previousById.has(model.id)
              ? model
              : previousById.get(model.id),
          ),
        };
      }
      this.catalog = validateCatalog(merged);
      this.hasLiveSnapshot = true;
      if (result.complete === true) {
        this.catalog = await writeCatalogSnapshot(this.catalog, {
          path: this.catalogSnapshotPath,
        });
      }
    } else if (!this.hasLiveSnapshot) {
      this.catalog = unavailableCatalog(this.baseCatalog);
    }
  }

  async reloadSettings() {
    const stored = await readSettings({
      path: this.settingsPath,
      migrate: (value) => reconcileRuntimeSettings(value, this.catalog),
    });
    this.settings = reconcileRuntimeSettings(stored, this.catalog);
    return this.getState();
  }

  async updateSettings(input) {
    const settings = reconcileRuntimeSettings(input, this.catalog);
    await writeSettings(settings, { path: this.settingsPath });
    this.settings = settings;
    return this.getState();
  }

  route(input) {
    const task = classifyRouteRequest(input);
    const plan = planRoute({ task, catalog: this.catalog, settings: this.settings });
    const integrationWarning =
      input?.modality && input.modality !== "text"
        ? "Seamless media routing requires the installed Model Control plugin and an omc-router session. Connect or update Model Control, restart OpenCode, and use Omc-Router."
        : null;
    return { ...plan, task, integrationWarning };
  }

  getOpenCodeConfig() {
    const config = buildManagedOpenCodeFragment({
      catalog: this.catalog,
      settings: this.settings,
      includeDefaultAgent: this.settings.makeRouterDefault,
    });
    const text = `${JSON.stringify(config, null, 2)}\n`;
    return {
      config,
      text,
      warnings: [
        "Connect manages only the model-control MCP, omc-* agents, its exact plugin array item, and an optional receipt-owned default_agent. Conflicting or user-owned values are never overwritten.",
        "The preview shows the requested default_agent entry. Connect omits it when OpenCode already has a user-owned default.",
        "The bundled local plugin performs attachment-aware model selection only for omc-router turns and fails closed when the saved policy has no compatible worker.",
      ],
    };
  }

  getBenchmarkSummary() {
    return BENCHMARK_SUMMARY;
  }

  getRuntimeQualificationSummary() {
    return {
      schemaVersion: 1,
      automatic: false,
      action: "manual-provider-request",
      evidenceType: "runtime-access-only",
      benchmarkPromotion: false,
      running: this.runtimeQualificationRunning,
      warning: this.runtimeQualificationWarning,
      updatedAt: this.runtimeQualificationHistory.updatedAt,
      results: this.runtimeQualificationHistory.results,
      boundaries: [
        "A check run sends one fixed synthetic text prompt through OpenCode to the selected provider. OpenCode may retry retryable provider failures.",
        "User and project instructions, MCP servers, and external plugins are excluded and verified before the provider phase; configured provider authentication remains available.",
        "Raw model output is discarded; only redacted result metadata is stored locally.",
        "A passing check confirms one response at one time. It does not qualify model quality or a routing role.",
      ],
    };
  }

  async runRuntimeQualification(input) {
    const modelId = validateRuntimeQualificationRequest(input);
    if (this.runtimeQualificationRunning) {
      throw Object.assign(new Error("Another runtime check is already in progress."), {
        code: "RUNTIME_QUALIFICATION_IN_PROGRESS",
        statusCode: 409,
      });
    }
    if (this.openCode.installed !== true) {
      throw Object.assign(new Error("OpenCode must be installed before a runtime check can run."), {
        code: "OPENCODE_NOT_FOUND",
        statusCode: 409,
      });
    }
    const model = this.catalog.models.find((candidate) => candidate.id === modelId);
    if (!model || model.discovered === false || model.available !== true) {
      invalidRuntimeQualification(
        "The selected model is not currently available in the OpenCode catalog. Update available models and try again.",
        "RUNTIME_QUALIFICATION_MODEL_UNAVAILABLE",
      );
    }

    this.runtimeQualificationRunning = true;
    try {
      const result = await this.runtimeQualificationRunner({
        modelId,
        openCodeVersion: this.openCode.version ?? null,
      });
      try {
        this.runtimeQualificationHistory = await appendRuntimeQualificationResult(
          this.runtimeQualificationHistory,
          result,
          { path: this.runtimeQualificationHistoryPath },
        );
        this.runtimeQualificationWarning = null;
      } catch {
        throw Object.assign(new Error(
          "The provider check finished, but its result could not be saved. Do not rerun it until the local configuration directory is writable.",
        ), {
          code: "RUNTIME_QUALIFICATION_PERSIST_FAILED",
          statusCode: 500,
        });
      }
    } finally {
      this.runtimeQualificationRunning = false;
    }
    return this.getRuntimeQualificationSummary();
  }

  async getUsage(window) {
    return this.usageReader({ window });
  }

  async getOpenCodeIntegration() {
    return this.integrationInstaller.status();
  }

  async installOpenCodeIntegration() {
    // The media plugin runs in OpenCode, outside this service process. Persist
    // the exact validated policy before registering the plugin so a first-time
    // Connect is immediately usable even when the user has not changed a
    // default setting yet.
    await writeSettings(this.settings, { path: this.settingsPath });
    return this.integrationInstaller.install({
      catalog: this.catalog,
      settings: this.settings,
    });
  }

  async uninstallOpenCodeIntegration() {
    return this.integrationInstaller.uninstall();
  }

  async openOpenCodeConfig() {
    return this.integrationInstaller.openConfig();
  }

  async revealOpenCodeConfig() {
    return this.integrationInstaller.revealConfig();
  }
}
