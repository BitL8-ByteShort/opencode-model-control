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
import { OpenCodeIntegrationInstaller } from "../installer/index.js";
import { buildOpenCodeConfig, renderOpenCodeConfig } from "../opencode/index.js";
import { BENCHMARK_SUMMARY } from "./benchmark-summary.js";
import {
  readCatalogSnapshot,
  resolveCatalogSnapshotPath,
  writeCatalogSnapshot,
} from "./catalog-store.js";
import { classifyRouteRequest } from "./task-classifier.js";
import { discoverOpenCode, mergeDiscoveredCatalog } from "./opencode-cli.js";
import { readOpenCodeUsage } from "./opencode-usage.js";
import { readSettings, resolveSettingsPath, writeSettings } from "./settings-store.js";

function evidenceFor(model) {
  if (model.evidence) return model.evidence;
  if (model.profileSource === "capability" || model.modalities.input.some((modality) => modality !== "text")) {
    return { status: "capability-only", label: "Capability verified; benchmark pending" };
  }
  return { status: "candidate", label: "Unbenchmarked role" };
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
  } = {}) {
    this.settingsPath = settingsPath ?? resolveSettingsPath();
    this.catalogSnapshotPath = catalogSnapshotPath ?? resolveCatalogSnapshotPath(this.settingsPath);
    this.discovery = discovery;
    this.integrationInstaller = integrationInstaller;
    this.usageReader = usageReader;
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
  }

  async initialize() {
    const persistedCatalog = await readCatalogSnapshot({ path: this.catalogSnapshotPath });
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
        ? "Stock OpenCode selects the primary model before delegation. A text-only primary cannot transparently receive the original attachment; use the vision agent directly until the optional gateway is available."
        : null;
    return { ...plan, task, integrationWarning };
  }

  getOpenCodeConfig() {
    const config = buildOpenCodeConfig({ catalog: this.catalog, settings: this.settings });
    return {
      config,
      text: renderOpenCodeConfig({ catalog: this.catalog, settings: this.settings }),
      warnings: [
        "The Connect action manages only the model-control MCP and omc-* agent entries; conflicting existing values are never overwritten.",
        "Attachment-aware pre-dispatch routing requires the planned optional gateway.",
      ],
    };
  }

  getBenchmarkSummary() {
    return BENCHMARK_SUMMARY;
  }

  async getUsage(window) {
    return this.usageReader({ window });
  }

  async getOpenCodeIntegration() {
    return this.integrationInstaller.status();
  }

  async installOpenCodeIntegration() {
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
