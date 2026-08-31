import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getBenchmarkSummary,
  getOpenCodeIntegration,
  getState,
  getUsage,
  installOpenCodeIntegration,
  refreshCatalog,
  uninstallOpenCodeIntegration,
  updateSettings,
} from "./api";
import {
  catalogRefreshNotice,
  normalizeState,
  settingsEqual,
  settingsForApi,
  toggleEnabledModel,
} from "./model-control.js";
import type { BenchmarkSummary, ModelControlState, OpenCodeIntegrationStatus, OpenCodeUsage, RouterSettings, UsageWindow } from "./types";
import { AppShell } from "./components/AppShell";
import { BenchmarkPanel } from "./components/BenchmarkPanel";
import { ConfigPanel } from "./components/ConfigPanel";
import { ModelTable } from "./components/ModelTable";
import { RoleAssignments } from "./components/RoleAssignments";
import { RouteTester } from "./components/RouteTester";
import { RoutingOverview } from "./components/RoutingOverview";
import { UsagePanel } from "./components/UsagePanel";
import { EmptyCatalog, ErrorPanel, LoadingDashboard } from "./components/StatePanels";
import { Button, Icon, StatusDot } from "./components/Primitives";

function formatCatalogTime(value?: string) {
  if (!value) return "Not refreshed yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function App() {
  const [state, setState] = useState<ModelControlState | null>(null);
  const [savedSettings, setSavedSettings] = useState<RouterSettings | null>(null);
  const [draftSettings, setDraftSettings] = useState<RouterSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkSummary | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(true);
  const [benchmarkError, setBenchmarkError] = useState("");
  const [integration, setIntegration] = useState<OpenCodeIntegrationStatus | null>(null);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [usage, setUsage] = useState<OpenCodeUsage | null>(null);
  const [usageWindow, setUsageWindow] = useState<UsageWindow>("30d");
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState("");

  const applyState = useCallback((raw: ModelControlState) => {
    const normalized = normalizeState(raw) as ModelControlState;
    setState(normalized);
    setSavedSettings(normalized.settings);
    setDraftSettings(normalized.settings);
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      applyState(await getState());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The local state could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [applyState]);

  const loadBenchmarks = useCallback(async () => {
    setBenchmarkLoading(true);
    setBenchmarkError("");
    try {
      setBenchmark(await getBenchmarkSummary());
    } catch (error) {
      setBenchmarkError(error instanceof Error ? error.message : "Benchmark evidence could not be loaded.");
    } finally {
      setBenchmarkLoading(false);
    }
  }, []);

  const loadIntegration = useCallback(async () => {
    try {
      setIntegration(await getOpenCodeIntegration());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The OpenCode connection status could not be loaded.");
    }
  }, []);

  const loadUsage = useCallback(async (window: UsageWindow) => {
    setUsageLoading(true);
    setUsageError("");
    try {
      setUsage(await getUsage(window));
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : "OpenCode usage could not be loaded.");
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    void loadBenchmarks();
    void loadIntegration();
    void loadUsage("30d");
  }, [loadBenchmarks, loadDashboard, loadIntegration, loadUsage]);

  const changeUsageWindow = (nextWindow: UsageWindow) => {
    setUsageWindow(nextWindow);
    void loadUsage(nextWindow);
  };

  const dirty = useMemo(
    () => Boolean(savedSettings && draftSettings && !settingsEqual(savedSettings, draftSettings)),
    [draftSettings, savedSettings],
  );

  useEffect(() => {
    if (!dirty) return undefined;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty]);

  const save = async () => {
    if (!draftSettings || !dirty) return;
    setSaving(true);
    setActionError("");
    setNotice("");
    try {
      applyState(await updateSettings(settingsForApi(draftSettings) as RouterSettings));
      if (integration?.installed && integration.healthy) {
        try {
          const result = await installOpenCodeIntegration();
          setIntegration(result);
          setNotice(result.changed
            ? "Routing settings saved and the OpenCode connection was updated. Restart OpenCode to load the changes."
            : "Routing settings saved locally.");
        } catch (error) {
          setActionError(
            `Routing settings were saved, but the OpenCode connection could not be updated. ${
              error instanceof Error ? error.message : "Open the connection panel and try again."
            }`,
          );
          setNotice("Routing settings saved locally.");
        }
      } else {
        setNotice("Routing settings saved locally.");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (savedSettings) setDraftSettings(savedSettings);
    setActionError("");
    setNotice("Unsaved changes reverted.");
  };

  const refresh = async () => {
    setRefreshing(true);
    setActionError("");
    setNotice("");
    try {
      const refreshed = await refreshCatalog();
      if (refreshed && Array.isArray(refreshed.catalog)) applyState(refreshed);
      else applyState(await getState());
      const catalogWarning = refreshed?.system?.catalog?.warning;
      let connectionWarning = "";
      let connectionChanged = false;
      if (integration?.installed && integration.healthy) {
        try {
          const result = await installOpenCodeIntegration();
          setIntegration(result);
          connectionChanged = result.changed === true;
        } catch (error) {
          connectionWarning = `Models were updated, but the OpenCode connection could not be updated. ${
            error instanceof Error ? error.message : "Open the connection panel and try again."
          }`;
        }
      }
      const warnings = [catalogWarning, connectionWarning].filter(Boolean).join(" ");
      if (warnings) {
        setActionError(warnings);
        setNotice(catalogRefreshNotice({
          incomplete: Boolean(catalogWarning),
          connectionChanged,
        }));
      } else {
        setNotice(catalogRefreshNotice({ connectionChanged }));
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The catalog could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  };

  const connect = async () => {
    setIntegrationBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = await installOpenCodeIntegration();
      setIntegration(result);
      setNotice(result.changed
        ? "Connected safely. Restart OpenCode to load Model Control."
        : "OpenCode Model Control is already connected and current.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "OpenCode could not be connected safely.");
      await loadIntegration();
    } finally {
      setIntegrationBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Model Control from OpenCode? Your other OpenCode settings will be preserved.")) return;
    setIntegrationBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = await uninstallOpenCodeIntegration();
      setIntegration(result);
      setNotice("Disconnected safely. Restart OpenCode to finish removing Model Control.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "OpenCode could not be disconnected safely.");
      await loadIntegration();
    } finally {
      setIntegrationBusy(false);
    }
  };

  const toggleModel = (modelId: string, enabled: boolean) => {
    setDraftSettings((current) => {
      if (!current) return current;
      const next = toggleEnabledModel(current, modelId, enabled) as RouterSettings;
      if (!enabled) {
        const roleAssignments = { ...next.roleAssignments };
        for (const role of Object.keys(roleAssignments)) {
          if (roleAssignments[role] === modelId) roleAssignments[role] = "auto";
        }
        next.roleAssignments = roleAssignments;
      }
      return next;
    });
    setNotice("");
  };

  const localOnly = state?.system?.localOnly === true;
  const paidAllowed = draftSettings?.costPolicy === "known-cost";
  const opencodeReady = state?.system?.opencode?.installed !== false;

  const headerActions = (
    <>
      <div className={localOnly ? "lock-pill lock-pill--positive" : "lock-pill lock-pill--warning"} title="The control service binds locally; hosted model requests may still leave this computer.">
        <StatusDot tone={localOnly ? "positive" : "warning"} /><span>Control plane {localOnly ? "local-only" : "not confirmed local"}</span>
      </div>
      <div className={paidAllowed ? "lock-pill lock-pill--warning" : "lock-pill"}><Icon name="lock" size={15} /><span>{paidAllowed ? "Paid models allowed" : "Verified free only"}</span></div>
      {dirty ? <span className="unsaved-pill"><StatusDot tone="warning" />Unsaved changes</span> : null}
      {dirty ? <Button disabled={saving} onClick={reset} tone="quiet">Revert</Button> : null}
      <Button disabled={!dirty || saving} onClick={save} tone="primary">{saving ? "Saving…" : "Save changes"}</Button>
    </>
  );

  const footer = (
    <span className="system-health"><StatusDot tone={opencodeReady ? "positive" : "warning"} />{opencodeReady ? "Local service ready" : "OpenCode not detected"}</span>
  );

  return (
    <AppShell footer={footer} headerActions={headerActions}>
      <div aria-atomic="true" aria-live="polite" className="announcer">{notice}</div>
      {actionError ? <div className="global-alert" role="alert"><span>{actionError}</span><button aria-label="Dismiss error" onClick={() => setActionError("")} type="button">Dismiss</button></div> : null}
      {notice ? <div className="toast" role="status"><Icon name="check" size={16} />{notice}</div> : null}
      {loading ? <LoadingDashboard /> : loadError ? <ErrorPanel message={loadError} onRetry={loadDashboard} /> : state && draftSettings ? (
        <>
          <RoutingOverview catalog={state.catalog} settings={draftSettings} />
          <section aria-label="Control status" className="system-strip">
            <div><span>OpenCode</span><strong>{opencodeReady ? `Connected${state.system?.opencode?.version ? ` · v${state.system.opencode.version}` : ""}` : "Not detected"}</strong></div>
            <div><span>Catalog source</span><strong>{state.system?.catalog?.source ?? "Live OpenCode catalog"}</strong></div>
            <div><span>Last refreshed</span><strong>{formatCatalogTime(state.system?.catalog?.lastRefreshed)}</strong></div>
            <Button disabled={refreshing || dirty} icon="refresh" onClick={refresh} tone="quiet">{refreshing ? "Updating…" : "Update available models"}</Button>
          </section>
          <p className="privacy-note"><Icon name="lock" size={16} /><span><strong>Local control is not local inference.</strong> The dashboard and router stay on this computer, but enabled OpenCode provider models may receive routed content under their own data terms. Never include credentials or nonpublic personal data.</span></p>
          {state.catalog.length === 0 ? <EmptyCatalog loading={refreshing} onRefresh={refresh} /> : (
            <div className="dashboard-grid">
              <ModelTable catalog={state.catalog} onToggle={toggleModel} settings={draftSettings} />
              <div className="dashboard-side">
                <RoleAssignments catalog={state.catalog} onChange={setDraftSettings} settings={draftSettings} />
                <RouteTester catalog={state.catalog} />
                <ConfigPanel
                  hasUnsavedChanges={dirty}
                  integration={integration}
                  integrationBusy={integrationBusy}
                  onConnect={() => void connect()}
                  onDisconnect={() => void disconnect()}
                />
              </div>
            </div>
          )}
          <BenchmarkPanel catalog={state.catalog} error={benchmarkError} loading={benchmarkLoading} onReload={loadBenchmarks} summary={benchmark} />
          <UsagePanel
            error={usageError}
            loading={usageLoading}
            onReload={() => void loadUsage(usageWindow)}
            onWindowChange={changeUsageWindow}
            usage={usage}
            window={usageWindow}
          />
        </>
      ) : null}
    </AppShell>
  );
}
