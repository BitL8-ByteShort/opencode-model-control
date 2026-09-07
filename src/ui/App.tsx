import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ApiError,
  hasMutationSession,
  getBenchmarkSummary,
  getOpenCodeIntegration,
  getRuntimeQualification,
  getState,
  getUsage,
  installOpenCodeIntegration,
  refreshCatalog,
  runRuntimeQualification,
  uninstallOpenCodeIntegration,
  updateSettings,
} from "./api";
import {
  settingsEqual,
  settingsForApi,
  toggleEnabledModel,
  selectModelPolicy,
} from "./model-control.js";
import { createEditor, receiveSnapshot, editDraft, startSave, finishSave, failSave, rebaseDraft } from "./editor-state.js";
import type { EditorState, BenchmarkSummary, ModelControlState, OpenCodeIntegrationStatus, OpenCodeUsage, RouterSettings, RuntimeQualificationSummary, UsageWindow } from "./types";
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
  const [editor, setEditor] = useState<EditorState | null>(null);
  const editorRef = useRef<EditorState | null>(null);
  const requestSequence = useRef(0);
  const refreshInFlight = useRef(false);
  const lastRefreshAttempt = useRef<number | null>(null);
  const [conflict, setConflict] = useState(false);
  const state = editor?.state ?? null;
  const savedSettings = editor?.baseline ?? null;
  const draftSettings = editor?.draft ?? null;
  const publishEditor = useCallback((next: EditorState) => { editorRef.current = next; setEditor(next); }, []);
  const setDraftSettings = (update: RouterSettings | ((current: RouterSettings | null) => RouterSettings | null)) => {
    const current = editorRef.current;
    if (!current) return;
    const next = typeof update === "function" ? update(current.draft) : update;
    if (next) publishEditor(editDraft(current, next));
  };
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkSummary | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(true);
  const [benchmarkError, setBenchmarkError] = useState("");
  const [runtimeQualification, setRuntimeQualification] = useState<RuntimeQualificationSummary | null>(null);
  const [runtimeQualificationLoading, setRuntimeQualificationLoading] = useState(true);
  const [runtimeQualificationRunning, setRuntimeQualificationRunning] = useState(false);
  const [runtimeQualificationError, setRuntimeQualificationError] = useState("");
  const [integration, setIntegration] = useState<OpenCodeIntegrationStatus | null>(null);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [usage, setUsage] = useState<OpenCodeUsage | null>(null);
  const [usageWindow, setUsageWindow] = useState<UsageWindow>("30d");
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState("");

  const applyState = useCallback((raw: ModelControlState, requestId: number) => {
    publishEditor(editorRef.current ? receiveSnapshot(editorRef.current, raw, requestId) : createEditor(raw, requestId));
  }, [publishEditor]);

  const refresh = useCallback(async () => {
    if (editorRef.current?.saving || refreshInFlight.current) return;
    const requestId = ++requestSequence.current;
    refreshInFlight.current = true;
    lastRefreshAttempt.current = Date.now();
    setRefreshing(true); setActionError(""); setNotice("");
    try {
      const refreshed = await refreshCatalog() ?? await getState();
      applyState(refreshed, requestId);
      const metadata = refreshed.system?.catalog;
      setNotice(metadata?.complete ? "Available model metadata updated. Unsaved edits are preserved." : "Metadata refresh incomplete. Previous successful source times are preserved.");
      if (metadata?.warning) setActionError(metadata.warning);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The catalog could not be refreshed.");
    } finally { refreshInFlight.current = false; setRefreshing(false); }
  }, [applyState]);

  const observeState = useCallback(async (onReturn = false) => {
    if (editorRef.current?.saving || refreshInFlight.current) return;
    const requestId = ++requestSequence.current;
    try {
      const observed = await getState();
      applyState(observed, requestId);
      // A return observation can become obsolete while the request is pending.
      // Only its accepted, still-visible state may start the guarded refresh.
      if (onReturn && hasMutationSession && observed.system?.catalog?.stale === true &&
          document.visibilityState === "visible" && editorRef.current?.requestId === requestId &&
          (lastRefreshAttempt.current === null || Date.now() - lastRefreshAttempt.current >= 15 * 60 * 1000)) {
        await refresh();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The shared state could not be checked.");
    }
  }, [applyState, refresh]);

  useEffect(() => {
    const poll = () => { if (document.visibilityState === "visible") void observeState(); };
    const onReturn = () => { if (document.visibilityState === "visible") void observeState(true); };
    const timer = window.setInterval(poll, 15000);
    document.addEventListener("visibilitychange", onReturn);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onReturn); };
  }, [observeState]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const requestId = ++requestSequence.current;
      applyState(await getState(), requestId);
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

  const loadRuntimeQualification = useCallback(async () => {
    setRuntimeQualificationLoading(true);
    setRuntimeQualificationError("");
    try {
      setRuntimeQualification(await getRuntimeQualification());
    } catch (error) {
      setRuntimeQualificationError(error instanceof Error ? error.message : "Runtime-check evidence could not be loaded.");
    } finally {
      setRuntimeQualificationLoading(false);
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
    void loadRuntimeQualification();
    void loadUsage("30d");
  }, [loadBenchmarks, loadDashboard, loadIntegration, loadRuntimeQualification, loadUsage]);

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
    const current = editorRef.current;
    if (!current || current.saving || settingsEqual(current.baseline, current.draft)) return;
    const requestId = ++requestSequence.current;
    publishEditor(startSave(current, requestId));
    setSaving(true);
    setActionError(""); setNotice("");
    try {
      const result = await updateSettings(settingsForApi(current.draft) as RouterSettings, current.baselineRevision, current.state.catalogRevision);
      publishEditor(finishSave(editorRef.current, result, requestId));
      setConflict(false);
      setNotice(current.baseline.makeRouterDefault !== current.draft.makeRouterDefault
        ? "Settings saved. Use Update connection to apply the default-agent change, then restart OpenCode."
        : `Routing settings saved locally.${result.rebased ? " Latest catalog retained." : ""}`);
      if (current.baseline.makeRouterDefault !== current.draft.makeRouterDefault) void loadIntegration();
    } catch (error) {
      if (editorRef.current) publishEditor(failSave(editorRef.current));
      setActionError(error instanceof Error ? error.message : "Settings could not be saved.");
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        await observeState();
      }
    } finally { setSaving(false); }
  };

  const rebase = () => {
    if (!editorRef.current) return;
    publishEditor(rebaseDraft(editorRef.current));
    setConflict(false); setActionError("");
    setNotice("Your edits now use the latest saved settings. Review the draft, then Save changes.");
  };

  const reset = () => {
    if (savedSettings) setDraftSettings(savedSettings);
    setActionError("");
    setNotice("Unsaved changes reverted.");
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

  const runOneRuntimeQualification = async (
    modelId: string,
    confirmations: {
      acknowledgeProviderRequest: boolean;
      acknowledgeCostAndDataTerms: boolean;
    },
  ) => {
    setRuntimeQualificationRunning(true);
    setRuntimeQualificationError("");
    setActionError("");
    setNotice("");
    try {
      const result = await runRuntimeQualification(modelId, confirmations);
      setRuntimeQualification(result);
      const latest = result.results.find((entry) => entry.modelId === modelId);
      setNotice(latest?.status === "passed"
        ? "One runtime access check passed. Benchmark qualification remains unverified."
        : "The runtime access check finished without confirming access. See the stored result below.");
    } catch (error) {
      setRuntimeQualificationError(error instanceof Error ? error.message : "The runtime check could not be completed.");
    } finally {
      setRuntimeQualificationRunning(false);
    }
  };

  const toggleModel = (modelId: string, enabled: boolean) => {
    setDraftSettings((current) => {
      if (!current) return current;
      const next = toggleEnabledModel(current, modelId, enabled) as RouterSettings;
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
      {conflict ? <div className="global-alert"><span>Your draft is retained. Reload the latest saved state, then deliberately keep your edits on it before retrying.</span><Button onClick={() => void observeState()} tone="quiet">Check latest saved settings</Button><Button disabled={saving} onClick={rebase} tone="quiet">Keep my edits on latest settings</Button></div> : null}
      {notice ? <div className="toast" role="status"><Icon name="check" size={16} />{notice}</div> : null}
      {loading ? <LoadingDashboard /> : loadError ? <ErrorPanel message={loadError} onRetry={loadDashboard} /> : state && draftSettings ? (
        <>
          <RoutingOverview catalog={state.catalog} settings={draftSettings} />
          <section aria-label="Control status" className="system-strip">
            <div title="Process-local CLI detection; does not confirm a running host inventory."><span>OpenCode CLI diagnostic</span><strong>{opencodeReady ? `Detected${state.system?.opencode?.version ? ` · v${state.system.opencode.version}` : ""}` : "Not detected"}</strong></div>
            <div><span>Catalog source</span><strong>{state.system?.catalog?.source ?? "Live OpenCode catalog"}</strong></div>
            <div><span>Last complete success</span><strong>{formatCatalogTime(state.system?.catalog?.lastRefreshed)}</strong></div>
            <Button disabled={refreshing || saving} icon="refresh" onClick={refresh} tone="quiet">{refreshing ? "Updating…" : "Update available models"}</Button>
          </section>
          <p className="catalog-freshness">Refresh {state.system?.catalog?.status ?? "not attempted"}{state.system?.catalog?.stale ? " · stale metadata — update available models" : ""}. Last attempt: {formatCatalogTime(state.system?.catalog?.attemptedAt)}. Discovery success: {formatCatalogTime(state.system?.catalog?.discoverySucceededAt)}. Pricing success: {formatCatalogTime(state.system?.catalog?.pricingSucceededAt)}.</p>
          {state.system?.catalog?.warning ? <p className="inline-alert inline-alert--warning">{state.system.catalog.warning}</p> : null}
          <p className="catalog-freshness">Saved policy applies at the next owned model selection. Host-loaded model inventory is checked by the plugin at dispatch; if it reports OMC_HOST_MODEL_MISSING, reload OpenCode. A managed plugin update is separate and requires the connection action below.</p>
          <p className="privacy-note"><Icon name="lock" size={16} /><span><strong>Local control is not local inference.</strong> The dashboard and router stay on this computer, but enabled OpenCode provider models may receive routed content under their own data terms. Never include credentials or nonpublic personal data.</span></p>
          {state.catalog.length === 0 ? <EmptyCatalog loading={refreshing} onRefresh={refresh} /> : (
            <div className="dashboard-grid">
              <ModelTable
                catalog={state.catalog}
                onToggle={toggleModel}
                onSelection={(id, selection) => setDraftSettings(current => current ? selectModelPolicy(current, id, selection) as RouterSettings : current)}
                qualification={runtimeQualification}
                settings={draftSettings}
              />
              <RoleAssignments catalog={state.catalog} onChange={setDraftSettings} settings={draftSettings} />
              <RouteTester catalog={state.catalog} />
              <ConfigPanel
                hasUnsavedChanges={dirty}
                integration={integration}
                integrationBusy={integrationBusy}
                makeRouterDefault={draftSettings.makeRouterDefault}
                settingsBusy={saving}
                onConnect={() => void connect()}
                onDisconnect={() => void disconnect()}
                onMakeRouterDefaultChange={(makeRouterDefault) => {
                  setDraftSettings((current) => current
                    ? { ...current, makeRouterDefault }
                    : current);
                  setNotice("");
                }}
              />
            </div>
          )}
          <BenchmarkPanel
            catalog={state.catalog}
            error={benchmarkError}
            loading={benchmarkLoading}
            onReload={() => {
              void loadBenchmarks();
              void loadRuntimeQualification();
            }}
            onRunRuntimeQualification={(modelId, confirmations) => void runOneRuntimeQualification(modelId, confirmations)}
            qualification={runtimeQualification}
            qualificationError={runtimeQualificationError}
            qualificationLoading={runtimeQualificationLoading}
            qualificationRunning={runtimeQualificationRunning}
            summary={benchmark}
          />
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
