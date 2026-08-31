import type { OpenCodeUsage, UsageWindow } from "../types";
import { Button, Icon, Panel } from "./Primitives";

const windows: Array<{ label: string; value: UsageWindow }> = [
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
  { label: "All time", value: "all" },
];

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value: number) {
  const maximumFractionDigits = value > 0 && value < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
}

function formatGeneratedAt(value?: string) {
  if (!value) return "Not loaded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function UsagePanel({
  error,
  loading,
  onReload,
  onWindowChange,
  usage,
  window,
}: {
  error: string;
  loading: boolean;
  onReload: () => void;
  onWindowChange: (window: UsageWindow) => void;
  usage: OpenCodeUsage | null;
  window: UsageWindow;
}) {
  const totals = usage?.totals;
  const tokenBreakdown = totals
    ? [
        ["Input", totals.tokens.input],
        ["Output", totals.tokens.output],
        ["Reasoning", totals.tokens.reasoning],
        ["Cache read", totals.tokens.cacheRead],
        ["Cache write", totals.tokens.cacheWrite],
      ] as const
    : [];

  return (
    <Panel className="usage-panel" id="usage">
      <div className="panel-heading usage-heading">
        <div>
          <p className="section-kicker">Local OpenCode accounting</p>
          <h2>Usage</h2>
          <p className="panel-description">Aggregate token and recorded-cost history from OpenCode. Prompts and credentials are never read.</p>
        </div>
        <Button disabled={loading} icon="refresh" onClick={onReload} tone="quiet">
          {loading ? "Refreshing…" : "Refresh usage"}
        </Button>
      </div>

      <div aria-label="Usage reporting window" className="usage-window" role="group">
        {windows.map((option) => (
          <button
            aria-pressed={window === option.value}
            className={window === option.value ? "is-active" : ""}
            disabled={loading}
            key={option.value}
            onClick={() => onWindowChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="usage-unavailable" role="alert">
          <Icon name="usage" size={22} />
          <div>
            <strong>Usage is unavailable</strong>
            <p>{error}</p>
            <p>No zero totals were substituted for missing accounting data.</p>
          </div>
        </div>
      ) : loading && !usage ? (
        <div aria-live="polite" className="usage-loading">Loading OpenCode usage…</div>
      ) : totals ? (
        <>
          <div className="usage-summary">
            <article><span>Sessions</span><strong>{formatCount(totals.sessions)}</strong></article>
            <article><span>Messages</span><strong>{formatCount(totals.messages)}</strong></article>
            <article><span>Total tokens</span><strong>{formatCount(totals.tokens.total)}</strong></article>
            <article><span>Recorded cost</span><strong>{formatCurrency(totals.costUsd)}</strong></article>
          </div>

          <div className="usage-breakdown">
            <div>
              <h3>Token breakdown</h3>
              <dl>
                {tokenBreakdown.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{formatCount(value)}</dd></div>
                ))}
              </dl>
            </div>
            <div className="usage-accounting-note">
              <Icon name="help" size={18} />
              <div>
                <strong>Provider-reported accounting</strong>
                <p>Recorded cost is an estimate stored by OpenCode, not a provider invoice. A zero can also mean the provider did not report usage.</p>
                <small>Updated {formatGeneratedAt(usage.generatedAt)}</small>
              </div>
            </div>
          </div>

          <div className="usage-models">
            <div className="usage-models__heading">
              <div>
                <h3>Usage by model</h3>
                <p>{usage.byModel.length > 0 ? `${usage.byModel.length} attributed model${usage.byModel.length === 1 ? "" : "s"}` : "No attributed model usage in this window"}</p>
              </div>
              {usage.diagnostics.modelsTruncated ? <span>Showing top {usage.diagnostics.modelsReturned}</span> : null}
            </div>
            {usage.byModel.length > 0 ? (
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">OpenCode usage by model</caption>
                  <thead><tr><th scope="col">Model</th><th scope="col">Sessions</th><th scope="col">Messages</th><th scope="col">Tokens</th><th scope="col">Recorded cost</th></tr></thead>
                  <tbody>
                    {usage.byModel.map((model) => (
                      <tr key={model.id}>
                        <td className="usage-model-id" data-label="Model"><strong>{model.modelId}</strong><small>{model.providerId}</small></td>
                        <td data-label="Sessions">{formatCount(model.sessions)}</td>
                        <td data-label="Messages">{formatCount(model.messages)}</td>
                        <td data-label="Tokens">{formatCount(model.tokens.total)}</td>
                        <td data-label="Recorded cost">{formatCurrency(model.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="usage-empty">OpenCode has no provider-reported usage for this window yet.</p>
            )}
          </div>
        </>
      ) : null}
    </Panel>
  );
}
