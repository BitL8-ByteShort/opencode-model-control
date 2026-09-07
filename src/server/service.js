import {
  classifyModelPricing,
  createDefaultSettings,
  loadModelCatalog,
  modelSupports,
  modelEnabled,
  eligibleModelsForRole,
  assertExplicitAssignments,
  CATALOG_REFRESH_MS,
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
import {
  resolveSettingsPath,
  writeSettings,
  settingsConflict,
} from "./settings-store.js";
import { readControlSnapshot, writeRefreshStatus } from "./state-snapshot.js";
import { acquireFileLock, withStateLock } from "./state-lock.js";
import {
  readModelsDevCache,
  refreshModelsDev,
  resolveModelsDevCachePath,
} from "./models-dev.js";

function evidenceFor(model) {
  if (model.evidence) return model.evidence;
  if (
    model.profileSource === "capability" ||
    model.modalities.input.some((modality) => modality !== "text")
  ) {
    return {
      status: "capability-only",
      label: "Reported capability; runtime unverified",
    };
  }
  return { status: "candidate", label: "Unbenchmarked role" };
}

function invalidRuntimeQualification(
  message,
  code = "INVALID_RUNTIME_QUALIFICATION_REQUEST",
) {
  throw Object.assign(new Error(message), { code, statusCode: 400 });
}

function validateRuntimeQualificationRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalidRuntimeQualification(
      "Runtime checks require a selected model and explicit confirmations.",
    );
  }
  const allowedKeys = new Set([
    "modelId",
    "acknowledgeProviderRequest",
    "acknowledgeCostAndDataTerms",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    invalidRuntimeQualification(
      "Runtime checks do not accept prompts, files, or custom provider options.",
    );
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

function modelBlockReasons(model, settings) {
  const reasons = [];
  if (!modelEnabled(settings, model.id)) reasons.push("disabled");
  if (!model.available || settings.modelControls[model.id]?.available === false)
    reasons.push("unavailable");
  const pricing = classifyModelPricing(model);
  if (pricing === "unknown") reasons.push("unknown-pricing");
  else if (pricing === "paid" && settings.costPolicy === "free-only")
    reasons.push("paid-blocked");
  return reasons;
}

function publicCatalog(catalog, settings) {
  return catalog.models.map((model) => {
    const blockedReasons = modelBlockReasons(model, settings);
    return {
      ...model,
      displayName: model.label,
      provider: model.provider ?? model.id.split("/", 1)[0],
      selection: settings.modelControls[model.id]?.selection ?? "policy",
      enabled: modelEnabled(settings, model.id),
      effectiveEnabled: blockedReasons.length === 0,
      pricingClass: classifyModelPricing(model),
      blockedReasons,
      inputModalities: model.modalities.input,
      roleCapabilities: Object.entries(model.roles)
        .filter(([, score]) => score > 0)
        .map(([role]) => role),
      evidence: evidenceFor(model),
    };
  });
}

function blockedRoles(catalog, settings) {
  return Object.fromEntries(
    Object.entries(ROLE_REQUIREMENTS).map(([role, requirement]) => {
      const selected = settings.roleAssignments[role];
      const eligible = eligibleModelsForRole({
        catalog,
        settings,
        role,
        modalities: [...requirement.modalities],
        access: requirement.access,
      });
      if (selected === "auto")
        return [role, eligible.length ? [] : ["no-eligible-model"]];
      const model = catalog.models.find((m) => m.id === selected);
      if (!model) return [role, ["unavailable"]];
      const reasons = modelBlockReasons(model, settings);
      if (
        !modelSupports({
          model,
          role,
          modalities: [...requirement.modalities],
          access: requirement.access,
        })
      )
        reasons.push("incompatible-capabilities");
      return [role, reasons];
    }),
  );
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
    metadataFetch = globalThis.fetch,
    now = Date.now,
    setInterval: scheduleInterval = globalThis.setInterval,
    clearInterval: cancelInterval = globalThis.clearInterval,
    integrationInstaller = new OpenCodeIntegrationInstaller(),
    usageReader = readOpenCodeUsage,
    runtimeQualificationRunner = runOpenCodeRuntimeQualification,
    runtimeQualificationHistoryPath,
  } = {}) {
    this.settingsPath = settingsPath ?? resolveSettingsPath();
    this.catalogSnapshotPath =
      catalogSnapshotPath ?? resolveCatalogSnapshotPath(this.settingsPath);
    this.runtimeQualificationHistoryPath =
      runtimeQualificationHistoryPath ??
      resolveRuntimeQualificationHistoryPath(this.settingsPath);
    this.discovery = discovery;
    this.metadataFetch = metadataFetch;
    this.now = now;
    this.scheduleInterval = scheduleInterval;
    this.cancelInterval = cancelInterval;
    this.metadataCachePath = resolveModelsDevCachePath(this.settingsPath);
    this.refreshState = null;
    this.refreshPromise = null;
    this.closed = false;
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
    await this.reloadSettings();
    try {
      this.runtimeQualificationHistory = await readRuntimeQualificationHistory({
        path: this.runtimeQualificationHistoryPath,
      });
    } catch {
      this.runtimeQualificationHistory = emptyRuntimeQualificationHistory();
      this.runtimeQualificationWarning =
        "Stored runtime-check history is unreadable and was ignored. Remove the local history file before running another check.";
    }
    await this.refreshCatalog({ staleOnly: true });
    this.refreshTimer = this.scheduleInterval(
      () => this.refreshCatalog({ staleOnly: true }).catch(() => {}),
      CATALOG_REFRESH_MS,
    );
    this.refreshTimer?.unref?.();
    return this;
  }

  async close() {
    if (!this.closed) {
      this.closed = true;
      this.cancelInterval(this.refreshTimer);
    }
    await this.refreshPromise;
  }

  getState() {
    return {
      schemaVersion: 3,
      settingsRevision: this.settingsRevision,
      catalogRevision: this.catalog.revision,
      blockedRoles: blockedRoles(this.catalog, this.settings),
      system: {
        localOnly: true,
        freeOnly: this.settings.costPolicy === "free-only",
        costPreference: this.settings.costPreference,
        costPolicy: this.settings.costPolicy,
        openCode: {
          ...this.openCode,
          diagnosticsSource: "process-local-discovery",
        },
        catalog: {
          revision: this.catalog.revision,
          ...this.refreshState,
          source: "OpenCode CLI + Models.dev",
          snapshotDate: this.catalog.snapshotDate,
          lastRefreshed: this.refreshState?.succeededAt ?? null,
          stale:
            !this.refreshState?.succeededAt ||
            this.now() - Date.parse(this.refreshState.succeededAt) >=
              CATALOG_REFRESH_MS ||
            this.refreshState.status !== "success",
          complete: this.refreshState?.complete === true,
          warning:
            [
              this.refreshState?.complete !== true
                ? "OpenCode discovery was incomplete; prior model availability was retained."
                : null,
              this.refreshState?.pricingError
                ? "Public pricing could not be refreshed; the last successful pricing snapshot was retained."
                : null,
            ]
              .filter(Boolean)
              .join(" ") || null,
        },
      },
      catalog: publicCatalog(this.catalog, this.settings),
      settings: this.settings,
    };
  }

  async refreshCatalog({ staleOnly = false } = {}) {
    if (this.closed) return this.getState();
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.#refresh({ staleOnly }).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async #refresh({ staleOnly }) {
    const observedAttempt = this.refreshState?.attemptedAt;
    const release = await acquireFileLock(`${this.settingsPath}.refresh-lease`);
    if (!release) {
      await this.reloadSettings();
      return this.getState();
    }
    try {
      await this.reloadSettings();
      const last = this.refreshState?.attemptedAt;
      if (
        (last && last !== observedAttempt) ||
        (staleOnly &&
          last &&
          this.now() - Date.parse(last) < CATALOG_REFRESH_MS)
      )
        return this.getState();
      if (this.closed) return this.getState();
      const attemptedAt = new Date(this.now()).toISOString();
      let previous;
      try {
        previous = await readModelsDevCache({ path: this.metadataCachePath });
      } catch {
        previous = null;
      }
      const [discovered, metadata] = await Promise.all([
        this.discovery({ refresh: !staleOnly }).catch(() => ({
          installed: this.openCode.installed,
          models: [],
          complete: false,
          error: {
            code: "DISCOVERY_FAILED",
            message: "OpenCode discovery failed.",
          },
        })),
        refreshModelsDev({
          path: this.metadataCachePath,
          previous,
          fetch: this.metadataFetch,
          now: this.now,
        }),
      ]);
      await withStateLock(this.settingsPath, async () => {
        await this.reloadSettings({ locked: true });
        const previousCatalog = this.catalog;
        const models = Array.isArray(discovered.models)
          ? discovered.models
          : [];
        let merged = mergeDiscoveredCatalog(previousCatalog, models, {
          curatedCatalog: this.baseCatalog,
          publicMetadata: metadata.snapshot,
          now: this.now(),
        });
        if (discovered.complete !== true) {
          const found = new Set(models.map((model) => model.id));
          const prior = new Map(
            previousCatalog.models.map((model) => [model.id, model]),
          );
          merged = {
            ...merged,
            models: merged.models.map((model) =>
              found.has(model.id) || !prior.has(model.id)
                ? model
                : {
                    ...model,
                    available: prior.get(model.id).available,
                    discovered: prior.get(model.id).discovered,
                    runtimeVerified: prior.get(model.id).runtimeVerified,
                  },
            ),
          };
        }
        this.catalog = await writeCatalogSnapshot(merged, {
          path: this.catalogSnapshotPath,
        });
        const complete = discovered.complete === true;
        this.refreshState = {
          attemptedAt,
          succeededAt:
            complete && !metadata.error
              ? new Date(this.now()).toISOString()
              : (this.refreshState?.succeededAt ?? null),
          discoverySucceededAt: complete
            ? attemptedAt
            : (this.refreshState?.discoverySucceededAt ?? null),
          pricingSucceededAt:
            metadata.snapshot?.fetchedAt ??
            this.refreshState?.pricingSucceededAt ??
            null,
          complete,
          status: metadata.error
            ? complete
              ? "incomplete"
              : "failure"
            : complete
              ? "success"
              : "incomplete",
          pricingError: Boolean(metadata.error),
          installed: discovered.installed === true,
          version: discovered.version ?? null,
        };
        await writeRefreshStatus(this.refreshState, this.settingsPath);
        this.openCode = { ...discovered, checkedAt: attemptedAt };
        // Catalog refresh never persists inferred intent.
        await this.reloadSettings({ locked: true });
      });
      return this.getState();
    } finally {
      await release();
    }
  }

  async reloadSettings({ locked = false } = {}) {
    const snapshot = await readControlSnapshot({
      settingsPath: this.settingsPath,
      catalogSnapshotPath: this.catalogSnapshotPath,
      fallbackCatalog: this.catalog,
      locked,
    });
    this.catalog = snapshot.catalog;
    this.settings = snapshot.settings;
    this.settingsRevision = snapshot.settingsRevision;
    this.refreshState = snapshot.refresh;
    this.hasLiveSnapshot = Boolean(snapshot.refresh);
    if (snapshot.refresh)
      this.openCode = {
        ...this.openCode,
        installed: snapshot.refresh.installed,
        version: snapshot.refresh.version,
      };
    return this.getState();
  }

  async updateSettings(
    input,
    { expectedSettingsRevision, catalogRevision } = {},
  ) {
    if (typeof expectedSettingsRevision !== "string")
      throw settingsConflict("SETTINGS_REVISION_REQUIRED", [
        "Save requires the expected settings revision.",
      ]);
    return withStateLock(this.settingsPath, async () => {
      await this.reloadSettings({ locked: true });
      if (expectedSettingsRevision !== this.settingsRevision)
        throw settingsConflict();
      let settings;
      try {
        settings = validateSettings(input, this.catalog);
      } catch (error) {
        error.statusCode = 400;
        throw error;
      }
      const editedRoles = Object.keys(settings.roleAssignments).filter(
        (role) =>
          settings.roleAssignments[role] !==
          this.settings.roleAssignments[role],
      );
      try {
        assertExplicitAssignments(settings, this.catalog, editedRoles);
        for (const [id, control] of Object.entries(settings.modelControls)) {
          if (
            control.selection !== "enabled" ||
            this.settings.modelControls[id]?.selection === "enabled"
          )
            continue;
          const model = this.catalog.models.find((model) => model.id === id);
          if (!model || modelBlockReasons(model, settings).length)
            throw new Error(
              "The edited model selection is not currently eligible.",
            );
        }
      } catch {
        throw settingsConflict("SELECTION_CONFLICT", [
          "An edited selection is no longer eligible under the current catalog and policy.",
        ]);
      }
      await writeSettings(settings, {
        path: this.settingsPath,
        expectedRevision: expectedSettingsRevision,
        locked: true,
      });
      await this.reloadSettings({ locked: true });
      return {
        ...this.getState(),
        rebased:
          typeof catalogRevision === "string" &&
          catalogRevision !== this.catalog.revision,
      };
    });
  }

  route(input) {
    const task = classifyRouteRequest(input);
    const plan = planRoute({
      task,
      catalog: this.catalog,
      settings: this.settings,
    });
    const integrationWarning =
      input?.modality && input.modality !== "text"
        ? "Seamless media routing requires the installed Model Control plugin and an omc-router session. Connect or update Model Control, restart OpenCode, and use Omc-Router."
        : null;
    return {
      ...plan,
      task,
      integrationWarning,
      settingsRevision: this.settingsRevision,
      catalogRevision: this.catalog.revision,
    };
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
        "The bundled local plugin applies saved policy to every owned OMC role on its next request. Media-only turns stay read-only, and unavailable or unknown-cost routes fail closed.",
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
      throw Object.assign(
        new Error("Another runtime check is already in progress."),
        {
          code: "RUNTIME_QUALIFICATION_IN_PROGRESS",
          statusCode: 409,
        },
      );
    }
    if (this.openCode.installed !== true) {
      throw Object.assign(
        new Error("OpenCode must be installed before a runtime check can run."),
        {
          code: "OPENCODE_NOT_FOUND",
          statusCode: 409,
        },
      );
    }
    const model = this.catalog.models.find(
      (candidate) => candidate.id === modelId,
    );
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
        this.runtimeQualificationHistory =
          await appendRuntimeQualificationResult(
            this.runtimeQualificationHistory,
            result,
            { path: this.runtimeQualificationHistoryPath },
          );
        this.runtimeQualificationWarning = null;
      } catch {
        throw Object.assign(
          new Error(
            "The provider check finished, but its result could not be saved. Do not rerun it until the local configuration directory is writable.",
          ),
          {
            code: "RUNTIME_QUALIFICATION_PERSIST_FAILED",
            statusCode: 500,
          },
        );
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
    await withStateLock(this.settingsPath, async () => {
      await this.reloadSettings({ locked: true });
      await writeSettings(this.settings, {
        path: this.settingsPath,
        expectedRevision: this.settingsRevision,
        locked: true,
      });
      await this.reloadSettings({ locked: true });
    });
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
