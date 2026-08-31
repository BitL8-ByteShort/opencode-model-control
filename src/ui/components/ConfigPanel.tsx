import { useEffect, useRef, useState } from "react";
import {
  getOpenCodeConfig,
  openOpenCodeConfig,
  openCodeConfigExportUrl,
  revealOpenCodeConfig,
} from "../api";
import { configText } from "../model-control.js";
import type { OpenCodeConfigResponse, OpenCodeIntegrationStatus } from "../types";
import { Button, Panel, StatusDot } from "./Primitives";

export function ConfigPanel({
  hasUnsavedChanges,
  integration,
  integrationBusy,
  settingsBusy,
  makeRouterDefault,
  onConnect,
  onDisconnect,
  onMakeRouterDefaultChange,
}: {
  hasUnsavedChanges: boolean;
  integration: OpenCodeIntegrationStatus | null;
  integrationBusy: boolean;
  settingsBusy: boolean;
  makeRouterDefault: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onMakeRouterDefaultChange: (enabled: boolean) => void;
}) {
  const [response, setResponse] = useState<OpenCodeConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewCopied, setPreviewCopied] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [configAction, setConfigAction] = useState<"open" | "reveal" | "">("");
  const [advancedNotice, setAdvancedNotice] = useState("");
  const previewRequestId = useRef(0);
  const previewAllowed = useRef(true);
  const text = response ? configText(response) : "";
  const configPath = integration?.configPath ?? "";

  previewAllowed.current = !hasUnsavedChanges && !settingsBusy;

  useEffect(() => {
    if (hasUnsavedChanges || settingsBusy) {
      previewRequestId.current += 1;
      setResponse(null);
      setPreviewCopied(false);
    }
  }, [hasUnsavedChanges, settingsBusy]);

  const preview = async () => {
    const requestId = ++previewRequestId.current;
    setLoading(true);
    setError("");
    try {
      const next = await getOpenCodeConfig();
      if (requestId === previewRequestId.current && previewAllowed.current) {
        setResponse(next);
      }
    } catch (previewError) {
      if (requestId === previewRequestId.current && previewAllowed.current) {
        setError(previewError instanceof Error ? previewError.message : "Configuration preview failed.");
      }
    } finally {
      if (requestId === previewRequestId.current) setLoading(false);
    }
  };

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setPreviewCopied(true);
      window.setTimeout(() => setPreviewCopied(false), 1800);
    } catch {
      setError("The browser blocked clipboard access. Export the file instead.");
    }
  };

  const copyPath = async () => {
    if (!configPath) return;
    setError("");
    setAdvancedNotice("");
    try {
      await navigator.clipboard.writeText(configPath);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1800);
    } catch {
      setError("The browser blocked clipboard access. Select and copy the path manually.");
    }
  };

  const runConfigAction = async (action: "open" | "reveal") => {
    setConfigAction(action);
    setError("");
    setAdvancedNotice("");
    try {
      if (action === "open") await openOpenCodeConfig();
      else await revealOpenCodeConfig();
      setAdvancedNotice(action === "open"
        ? "Opened the resolved OpenCode config in its default app."
        : "Revealed the resolved OpenCode config on this computer.");
    } catch (actionError) {
      setError(actionError instanceof Error
        ? actionError.message
        : "The resolved OpenCode config could not be opened.");
    } finally {
      setConfigAction("");
    }
  };

  const exportConfig = () => {
    if (!text) return;
    const anchor = document.createElement("a");
    anchor.href = openCodeConfigExportUrl;
    anchor.download = "opencode-model-control.jsonc";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <Panel className="config-panel" id="opencode">
      <div className="panel-heading panel-heading--compact">
        <div>
          <p className="section-kicker">OpenCode handoff</p>
          <h2>OpenCode connection</h2>
          <p className="panel-description">Install and maintain the local router without editing configuration files yourself.</p>
        </div>
      </div>
      <div className={`connection-state ${integration?.installed && integration.healthy ? "connection-state--connected" : integration?.requiresAttention ? "connection-state--warning" : ""}`}>
        <span className="inline-status">
          <StatusDot tone={integration?.installed && integration.healthy ? "positive" : integration?.requiresAttention ? "warning" : "neutral"} />
          <strong>{integration?.installed && integration.healthy ? "Connected" : integration?.requiresAttention ? "Needs attention" : "Not connected"}</strong>
        </span>
        <p>{integration?.message ?? "Checking the local OpenCode connection…"}</p>
      </div>
      <label className="default-agent-control">
        <input
          checked={makeRouterDefault}
          disabled={integrationBusy || settingsBusy}
          onChange={(event) => onMakeRouterDefaultChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Open Omc-Router by default</strong>
          <small>Applied only when OpenCode has no user-selected default. Existing defaults are preserved, and disconnect removes only a Model Control-owned setting.</small>
        </span>
      </label>
      {integration?.defaultAgentPreserved ? (
        <p className="advanced-config__hint">OpenCode currently keeps your existing default agent: <code>{integration.defaultAgent}</code>. Omc-Router remains available from the agent picker.</p>
      ) : null}
      {hasUnsavedChanges ? <p className="inline-alert inline-alert--warning">Save your routing changes before connecting or updating OpenCode.</p> : null}
      <div className="button-row">
        <Button
          disabled={hasUnsavedChanges || integrationBusy || !integration}
          icon={integration?.installed ? "refresh" : "check"}
          onClick={onConnect}
          tone="primary"
        >
          {integrationBusy ? "Working…" : integration?.installed ? "Update connection" : "Connect to OpenCode"}
        </Button>
        {integration?.installed || integration?.managed ? (
          <Button disabled={integrationBusy} onClick={onDisconnect} tone="danger">Disconnect</Button>
        ) : null}
      </div>
      {error ? <p className="inline-alert inline-alert--error" role="alert">{error}</p> : null}
      <details className="advanced-config">
        <summary>Advanced tools for developers</summary>
        <p className="panel-description">Optional access to the exact OpenCode file and the generated Model Control entries. Everyday setup only needs the buttons above.</p>
        <section className="advanced-config__section" aria-labelledby="resolved-config-heading">
          <div className="advanced-config__heading">
            <div>
              <h3 id="resolved-config-heading">Resolved OpenCode config</h3>
              <p>Model Control derives this path from OpenCode-compatible config precedence; the browser cannot substitute another target.</p>
            </div>
            <Button disabled={!configPath} icon={pathCopied ? "check" : "copy"} onClick={() => void copyPath()} tone="quiet">{pathCopied ? "Path copied" : "Copy path"}</Button>
          </div>
          <code className="resolved-config-path" tabIndex={0}>{configPath || "Checking the resolved OpenCode path…"}</code>
          <div className="button-row">
            <Button
              disabled={!integration?.configExists || Boolean(configAction)}
              icon="code"
              onClick={() => void runConfigAction("open")}
            >
              {configAction === "open" ? "Opening…" : "Open config"}
            </Button>
            <Button
              disabled={!integration?.configExists || Boolean(configAction)}
              icon="arrow"
              onClick={() => void runConfigAction("reveal")}
            >
              {configAction === "reveal" ? "Revealing…" : "Reveal in folder"}
            </Button>
          </div>
          {!integration?.configExists ? <p className="advanced-config__hint">The file does not exist yet. Connect Model Control or create an OpenCode config first.</p> : null}
          <p className="advanced-config__hint advanced-config__hint--warning">Direct edits to Model Control-owned entries will mark the connection as needing attention; reconnect never silently overwrites those edits.</p>
        </section>
        <section className="advanced-config__section" aria-labelledby="generated-config-heading">
          <div className="advanced-config__heading">
            <div>
              <h3 id="generated-config-heading">Generated integration</h3>
              <p>Inspect or export the entries Model Control would generate from your last saved routing policy.</p>
            </div>
          </div>
          <div className="button-row">
            <Button disabled={hasUnsavedChanges || settingsBusy || loading} icon="code" onClick={preview}>{loading ? "Generating…" : response ? "Refresh preview" : "Preview config"}</Button>
            <Button disabled={!text || hasUnsavedChanges || settingsBusy} icon="download" onClick={exportConfig}>Export generated</Button>
          </div>
          {response?.warnings?.length ? (
            <div className="config-warnings" role="status">
              <strong>Integration boundaries</strong>
              <ul>{response.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          ) : null}
          {text ? (
            <div className="config-preview">
              <div className="config-preview__bar"><span>Generated OpenCode config</span><Button icon={previewCopied ? "check" : "copy"} onClick={copy} tone="quiet">{previewCopied ? "Copied" : "Copy"}</Button></div>
              <pre tabIndex={0}><code>{text}</code></pre>
            </div>
          ) : null}
        </section>
        {advancedNotice ? <p className="advanced-config__notice" role="status">{advancedNotice}</p> : null}
      </details>
    </Panel>
  );
}
