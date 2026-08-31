import type { CatalogModel, RouterSettings } from "../types";
import { isModelAvailable, modelDisplayName, roleLabel } from "../model-control.js";
import { Icon, Panel, StatusDot } from "./Primitives";

function findModel(catalog: CatalogModel[], id?: string) {
  return catalog.find((model) => model.id === id);
}

export function RoutingOverview({ catalog, settings }: { catalog: CatalogModel[]; settings: RouterSettings }) {
  const primary = findModel(catalog, settings.roleAssignments.orchestrator);
  const lanes = ["code-worker", "vision-worker", "reviewer"] as const;

  return (
    <Panel className="routing-overview" id="overview">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Routing overview</p>
          <h2>Primary and specialist paths</h2>
        </div>
        <a className="button button--quiet" href="#routing-settings">Edit routing</a>
      </div>
      <div className="route-map">
        <div className="route-primary">
          <div className="model-symbol model-symbol--primary"><Icon name="routing" size={22} /></div>
          <div>
            <span className="route-label">Primary orchestrator</span>
            <strong>{primary ? modelDisplayName(primary) : settings.roleAssignments.orchestrator === "auto" ? "Automatic" : "Unassigned"}</strong>
            <span className="route-id">{primary?.id ?? (settings.roleAssignments.orchestrator === "auto" ? "Best eligible model at route time" : "Choose a model below")}</span>
          </div>
        </div>
        <div className="route-connector" aria-hidden="true"><span /></div>
        <div className="route-lanes">
          {lanes.map((role) => {
            const model = findModel(catalog, settings.roleAssignments[role]);
            const available = model ? isModelAvailable(model) : false;
            return (
              <div className="route-lane" key={role}>
                <div className={role === "vision-worker" ? "model-symbol model-symbol--vision" : "model-symbol"}>
                  <Icon name={role === "vision-worker" ? "image" : role === "reviewer" ? "check" : "code"} size={18} />
                </div>
                <div>
                  <span>{roleLabel(role)}</span>
                  <strong>{model ? modelDisplayName(model) : settings.roleAssignments[role] === "auto" ? "Automatic" : "Unassigned"}</strong>
                </div>
                <span className="route-state"><StatusDot tone={available ? "positive" : "neutral"} />{available ? "Available" : settings.roleAssignments[role] === "auto" ? "Policy selected" : "Not ready"}</span>
              </div>
            );
          })}
          <div className="route-lane route-lane--direct">
            <div className="model-symbol"><Icon name="arrow" size={18} /></div>
            <div><span>Direct handling</span><strong>Primary keeps the task</strong></div>
            <span className="route-state"><StatusDot tone="neutral" />No delegation</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
