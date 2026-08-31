import type { BenchmarkSummary, CatalogModel } from "../types";
import { modelDisplayName, roleLabel } from "../model-control.js";
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
  summary,
}: {
  catalog: CatalogModel[];
  error: string;
  loading: boolean;
  onReload: () => void;
  summary: BenchmarkSummary | null;
}) {
  const roles = Array.isArray(summary?.roles) ? summary.roles : [];
  const provisional = summary?.provisional !== false && summary?.evidenceStatus !== "qualified";

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
        </div>
        <aside className="methodology" id="methodology">
          <h3>Promotion method</h3>
          <ol>
            <li><span>01</span><p><strong>Same bounded fixtures</strong>Every candidate receives the same public or synthetic task, permissions, and budget.</p></li>
            <li><span>02</span><p><strong>Hard policy gates</strong>Leaks, out-of-scope writes, recursive delegation, or paid fallback disqualify a run.</p></li>
            <li><span>03</span><p><strong>Repeat before promotion</strong>Correctness, reliability, latency, and request burden are measured across seeds and days.</p></li>
          </ol>
          {summary?.methodology ? <p className="methodology__source">{summary.methodology}</p> : null}
          {summary?.caveats?.length ? <ul className="caveat-list">{summary.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul> : null}
        </aside>
      </div>
    </Panel>
  );
}
