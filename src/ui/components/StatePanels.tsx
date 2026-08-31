import { Button, Panel } from "./Primitives";

export function LoadingDashboard() {
  return (
    <div aria-label="Loading model control" className="loading-dashboard" role="status">
      <span className="sr-only">Loading model control</span>
      <div className="skeleton skeleton--hero" />
      <div className="skeleton-grid"><div className="skeleton skeleton--table" /><div className="skeleton skeleton--side" /></div>
    </div>
  );
}
export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel className="state-panel">
      <div className="state-panel__mark">!</div>
      <p className="section-kicker">Local service unavailable</p>
      <h2>Model control could not load</h2>
      <p>{message}</p>
      <Button icon="refresh" onClick={onRetry} tone="primary">Try again</Button>
    </Panel>
  );
}

export function EmptyCatalog({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <Panel className="state-panel" id="models">
      <div className="state-panel__mark state-panel__mark--empty">0</div>
      <p className="section-kicker">Catalog empty</p>
      <h2>No eligible models were returned</h2>
      <p>The control panel will not invent or silently substitute model rows. Refresh the live free-model catalog to try again.</p>
      <Button disabled={loading} icon="refresh" onClick={onRefresh} tone="primary">{loading ? "Refreshing…" : "Refresh catalog"}</Button>
    </Panel>
  );
}
