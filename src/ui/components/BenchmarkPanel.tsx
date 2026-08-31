import { useState } from "react";
import type { BenchmarkSummary, CatalogModel, RuntimeQualificationSummary } from "../types";
import { isModelAvailable, modelDisplayName, roleLabel } from "../model-control.js";
import { Button, Panel, StatusDot } from "./Primitives";

function formatDate(value?: string) {
  if (!value) return "No completed run";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatRate(value?: number) {
  if (typeof value !== "number") return "—";
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

export function BenchmarkPanel({
  catalog,
  error,
  loading,
  onReload,
  onRunRuntimeQualification,
  qualification,
  qualificationError,
  qualificationLoading,
  qualificationRunning,
  summary,
}: {
  catalog: CatalogModel[];
  error: string;
  loading: boolean;
  onReload: () => void;
  onRunRuntimeQualification: (
    modelId: string,
    confirmations: {
      acknowledgeProviderRequest: boolean;
      acknowledgeCostAndDataTerms: boolean;
    },
  ) => void;
  qualification: RuntimeQualificationSummary | null;
  qualificationError: string;
  qualificationLoading: boolean;
  qualificationRunning: boolean;
  summary: BenchmarkSummary | null;
}) {
  const [selectedModelId, setSelectedModelId] = useState("");
  const [providerRequestConfirmed, setProviderRequestConfirmed] = useState(false);
  const [costAndDataTermsConfirmed, setCostAndDataTermsConfirmed] = useState(false);
  const roles = Array.isArray(summary?.roles) ? summary.roles : [];
  const provisional = summary?.provisional !== false && summary?.evidenceStatus !== "qualified";
  const availableModels = catalog.filter(isModelAvailable);
  const latestRuntimeResult = qualification?.results.find(
    ({ modelId }) => modelId === selectedModelId,
  );

  const selectModel = (modelId: string) => {
    setSelectedModelId(modelId);
    setProviderRequestConfirmed(false);
    setCostAndDataTermsConfirmed(false);
  };

  const runRuntimeCheck = () => {
    onRunRuntimeQualification(selectedModelId, {
      acknowledgeProviderRequest: providerRequestConfirmed,
      acknowledgeCostAndDataTerms: costAndDataTermsConfirmed,
    });
    setProviderRequestConfirmed(false);
    setCostAndDataTermsConfirmed(false);
  };

  return (
    <Panel className="benchmark-panel" id="benchmarks">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Evidence, not claims</p>
          <h2>Benchmarks and methodology</h2>
          <p className="panel-description">Role labels are earned from repeatable fixtures and remain provisional until promotion gates pass.</p>
        </div>
        <div className="heading-actions">
          <span className={provisional ? "evidence-label evidence-label--warning" : "evidence-label evidence-label--positive"}><StatusDot tone={provisional ? "warning" : "positive"} />{provisional ? "Evidence: provisional" : "Qualified evidence"}</span>
          <Button disabled={loading} icon="refresh" onClick={onReload} tone="quiet">{loading ? "Loading…" : "Reload summary"}</Button>
        </div>
      </div>
      {error ? <p className="inline-alert inline-alert--error" role="alert">{error}</p> : null}
      <div className="benchmark-layout">
        <div>
          {summary?.headline || summary?.explanation ? (
            <div className="benchmark-copy">
              {summary.headline ? <strong>{summary.headline}</strong> : null}
              {summary.explanation ? <p>{summary.explanation}</p> : null}
            </div>
          ) : null}
          <div className="benchmark-meta">
            <div><span>Latest evidence</span><strong>{formatDate(summary?.generatedAt ?? summary?.lastRun)}</strong></div>
            <div><span>Sample size</span><strong>{summary?.sampleSize ?? "Not reported"}</strong></div>
            <div><span>Status</span><strong>{summary?.status ? roleLabel(summary.status) : provisional ? "Provisional" : "Qualified"}</strong></div>
          </div>
          {roles.length ? (
            <div className="benchmark-roles" aria-label="Role benchmark summary">
              {roles.map((role, index) => {
                const roleId = role.role ?? role.id ?? "Unassigned role";
                const modelId = role.modelId ?? role.model ?? role.qualifiedModelId ?? "";
                const model = catalog.find((candidate) => candidate.id === modelId);
                return (
                  <article key={`${roleId}-${index}`}>
                    <span>{roleLabel(roleId)}</span>
                    <strong>{model ? modelDisplayName(model) : modelId || "No candidate"}</strong>
                    <dl><div><dt>Status</dt><dd>{role.status ? roleLabel(role.status) : "—"}</dd></div><div><dt>Pass rate</dt><dd>{formatRate(role.passRate)}</dd></div><div><dt>Runs</dt><dd>{role.runs ?? "—"}</dd></div></dl>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-evidence"><strong>No promoted role evidence yet</strong><span>The router can operate provisionally, but this panel will not present an unrun benchmark as proof.</span></div>
          )}
          <section className="runtime-check" aria-labelledby="runtime-check-heading">
            <div className="runtime-check__heading">
              <div>
                <h3 id="runtime-check-heading">Manual runtime access check</h3>
                <p>This is one bounded provider check run, not a quality benchmark. OpenCode may retry retryable provider failures. A pass confirms only that this model returned the expected synthetic response at that time.</p>
              </div>
              <span className="evidence-label evidence-label--warning"><StatusDot tone="warning" />Never automatic</span>
            </div>
            <div className="runtime-check__boundary">
              <strong>Provider-call boundary</strong>
              <p>The check sends a fixed text-only sentinel through OpenCode. It includes no project files, attachments, customer data, credentials, or custom prompt. User and project instructions, MCP servers, and external plugins are excluded and verified before the provider phase; configured provider authentication remains available. Raw output is discarded by Model Control. OpenCode can retry a retryable provider failure, and OpenCode or the provider may retain each attempt and account metadata under their own terms.</p>
            </div>
            {qualification?.warning ? <p className="inline-alert inline-alert--warning" role="status">{qualification.warning}</p> : null}
            {qualificationError ? <p className="inline-alert inline-alert--error" role="alert">{qualificationError}</p> : null}
            <fieldset className="runtime-check__controls" disabled={qualificationLoading || qualificationRunning}>
              <legend>Choose and confirm a provider check</legend>
              <label className="runtime-check__model">
                <span>Model</span>
                <select onChange={(event) => selectModel(event.target.value)} value={selectedModelId}>
                  <option value="">Select an available model</option>
                  {availableModels.map((model) => <option key={model.id} value={model.id}>{modelDisplayName(model)} · {model.id}</option>)}
                </select>
              </label>
              <label className="runtime-check__confirmation">
                <input checked={providerRequestConfirmed} onChange={(event) => setProviderRequestConfirmed(event.target.checked)} type="checkbox" />
                <span>I understand this starts a real provider check, may be retried by OpenCode after a retryable failure, and may consume quota or incur charges for each attempt.</span>
              </label>
              <label className="runtime-check__confirmation">
                <input checked={costAndDataTermsConfirmed} onChange={(event) => setCostAndDataTermsConfirmed(event.target.checked)} type="checkbox" />
                <span>I understand the provider processes the fixed synthetic prompt under its data and retention terms.</span>
              </label>
              <Button
                disabled={!selectedModelId || !providerRequestConfirmed || !costAndDataTermsConfirmed || qualificationLoading || qualificationRunning}
                onClick={runRuntimeCheck}
                tone="primary"
                type="button"
              >
                {qualificationRunning ? "Running one provider check…" : "Run one runtime check"}
              </Button>
            </fieldset>
            <div className="runtime-check__result" aria-live="polite">
              {qualificationLoading ? (
                <span>Loading stored runtime-check evidence…</span>
              ) : latestRuntimeResult ? (
                <>
                  <span className={latestRuntimeResult.status === "passed" ? "runtime-check__status runtime-check__status--passed" : "runtime-check__status runtime-check__status--failed"}>
                    <StatusDot tone={latestRuntimeResult.status === "passed" ? "positive" : "negative"} />
                    {latestRuntimeResult.status === "passed" ? "Runtime access confirmed once" : "Runtime access not confirmed"}
                  </span>
                  <strong>{formatDate(latestRuntimeResult.completedAt)} · {(latestRuntimeResult.durationMs / 1000).toFixed(1)}s</strong>
                  <p>{latestRuntimeResult.status === "passed"
                    ? "The expected synthetic response was returned. Model quality, role fitness, reliability, and future access remain unverified."
                    : latestRuntimeResult.failure?.message ?? "The expected synthetic response was not returned."}</p>
                </>
              ) : (
                <span>{selectedModelId ? "No stored runtime check for this model." : "Select a model to view or create its local runtime-check evidence."}</span>
              )}
            </div>
          </section>
        </div>
        <aside className="methodology" id="methodology">
          <h3>Promotion method</h3>
          <ol>
            <li><span>01</span><p><strong>Same bounded fixtures</strong>Every candidate receives the same public or synthetic task, permissions, and budget.</p></li>
            <li><span>02</span><p><strong>Hard policy gates</strong>Leaks, out-of-scope writes, recursive delegation, or paid-model use under a Free policy disqualify a run.</p></li>
            <li><span>03</span><p><strong>Repeat before promotion</strong>Correctness, reliability, latency, and request burden are measured across seeds and days.</p></li>
          </ol>
          {summary?.methodology ? <p className="methodology__source">{summary.methodology}</p> : null}
          {summary?.caveats?.length ? <ul className="caveat-list">{summary.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul> : null}
        </aside>
      </div>
    </Panel>
  );
}
