import type { Connection, RouterSettings, BillingKind } from "../types";
import { billingLabel, evidenceSourceLabel, effectiveBilling } from "../model-control.js";
import { Panel } from "./Primitives";

export function ConnectionsPanel({connections, settings, onChange}: {connections: Connection[]; settings: RouterSettings; onChange: (settings: RouterSettings) => void}) {
  return <Panel className="settings-panel connections-panel" id="billing-connections">
    <h2>Configured connections</h2>
    <p className="panel-description">Each row is one configured OpenCode provider slot. Billing declarations describe your setup; they do not verify entitlement or free access.</p>
    {connections.length === 0 ? <p>Connection metadata not reported. Refresh the catalog to discover configured slots.</p> : connections.map(connection => {
      const billing = effectiveBilling(connection, settings);
      const declaration = settings.billingDeclarations?.[connection.id];
      const stale = declaration && declaration.bindingRevision !== connection.bindingRevision;
      const editable = !["host", "provider-adapter"].includes(connection.billing.source) && (connection.billing.kind === "unknown" || connection.billing.source === "user-declared");
      const quota = connection.quota;
      return <section className="connection-card" key={connection.id}>
        <h3>{connection.providerId}</h3>
        <p>{billingLabel(billing?.kind)} · {evidenceSourceLabel(billing?.source)}</p>
        <dl>
          <div><dt>Authentication</dt><dd>{({oauth: "OAuth", "api-key": "API key", none: "None", unknown: "Not reported"})[connection.authKind]}</dd></div>
          <div><dt>Access evidence</dt><dd>{connection.entitlement === "reported-revoked" ? "Revoked" : connection.entitlement === "reported-active" ? "Reported active" : "Not reported"}</dd></div>
          <div><dt>Inventory observed</dt><dd>{connection.inventoryObservedAt ?? "Not reported"}</dd></div>
          <div><dt>Transport visibility</dt><dd>{connection.transportVisibility === "host-managed" ? "Managed by OpenCode" : "Declared endpoint"}</dd></div>
          <div><dt>Billing observed</dt><dd>{billing?.observedAt ?? "Not reported"}</dd></div>
          <div><dt>Quota</dt><dd>{quota ? <>{Date.parse(quota.expiresAt) <= Date.now() ? "Stale observation · " : ""}{evidenceSourceLabel(quota.source)} · {quota.unit}. Used: {quota.used ?? "Not reported"}; remaining: {quota.remaining ?? "Not reported"}; limit: {quota.limit ?? "Not reported"}. Observed: {quota.observedAt}; expires: {quota.expiresAt}; resets: {quota.resetsAt ?? "Not reported"}</> : "Not reported"}</dd></div>
        </dl>
        {stale ? <p className="inline-alert inline-alert--warning">Connection changed — previous declaration needs review.</p> : null}
        {editable ? <label className="field"><span>Declare billing for {connection.providerId}</span><select aria-label={`Declare billing for ${connection.providerId}`} value={stale ? "unknown" : declaration?.kind ?? "unknown"} onChange={event => {
          const billingDeclarations = {...settings.billingDeclarations};
          if (event.target.value === "unknown") delete billingDeclarations[connection.id];
          else billingDeclarations[connection.id] = {kind: event.target.value as BillingKind, bindingRevision: connection.bindingRevision, source: "user-declared", declaredAt: new Date().toISOString()};
          onChange({...settings, billingDeclarations});
        }}>
          <option value="unknown">Not declared</option>
          {["subscription", "metered-api", "prepaid", "local", "free"].map(kind => <option key={kind} value={kind}>{billingLabel(kind)}</option>)}
        </select><small>Declared by you. Save changes to apply. No credentials are requested.</small></label> : null}
      </section>;
    })}
    <p className="field__hint">Binding checks detect changes exposed by the host. Credential changes the host does not report cannot be detected. Quota is never calculated from token prices.</p>
  </Panel>;
}
