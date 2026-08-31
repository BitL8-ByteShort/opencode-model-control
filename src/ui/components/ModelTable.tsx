import type { CatalogModel, RouterSettings, RuntimeQualificationSummary } from "../types";
import {
  catalogSummary,
  evidenceMeta,
  isModelCostAllowed,
  isModelAvailable,
  modelCostClass,
  modelDisplayName,
  modelInputModalities,
  modelRoles,
} from "../model-control.js";
import { Icon, Panel, StatusDot } from "./Primitives";

function modelTags(model: CatalogModel) {
  const tags = new Set<string>();
  for (const modality of modelInputModalities(model)) tags.add(modality.toLowerCase());
  for (const role of modelRoles(model)) tags.add(role);
  return [...tags].slice(0, 6);
}

export function ModelTable({
  catalog,
  qualification,
  settings,
  onToggle,
}: {
  catalog: CatalogModel[];
  qualification: RuntimeQualificationSummary | null;
  settings: RouterSettings;
  onToggle: (modelId: string, enabled: boolean) => void;
}) {
  const summary = catalogSummary(catalog, settings);

  return (
    <Panel className="models-panel" id="models">
      <div className="panel-heading panel-heading--table">
        <div>
          <p className="section-kicker">Live catalog</p>
          <h2>Model availability</h2>
        </div>
        <span className="summary-count">{summary.enabled} of {summary.total} enabled</span>
      </div>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Current OpenCode models, pricing class, and routing eligibility</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Availability</th>
              <th scope="col">Evidence</th>
              <th scope="col">Inputs and roles</th>
              <th scope="col">Cost</th>
              <th scope="col">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((model) => {
              const available = isModelAvailable(model);
              const runtimeResult = qualification?.results.find(({ modelId }) => modelId === model.id);
              const evidence = evidenceMeta(runtimeResult
                ? {
                    status: runtimeResult.status === "passed"
                      ? "runtime-access-only"
                      : "runtime-access-failed",
                    label: runtimeResult.status === "passed"
                      ? "Runtime access checked; role benchmark pending"
                      : "Runtime access not confirmed; role benchmark pending",
                  }
                : model.evidence ?? (model.provisional === true ? true : null));
              const checked = Boolean(settings.modelControls[model.id]?.enabled);
              const costClass = modelCostClass(model);
              const canEnable = isModelCostAllowed(model, settings) && available;
              const tags = modelTags(model);
              return (
                <tr className={!available ? "model-row model-row--muted" : "model-row"} key={model.id}>
                  <td data-label="Model">
                    <div className="model-cell">
                      <span className={tags.includes("image") ? "model-symbol model-symbol--vision" : "model-symbol"}>
                        <Icon name={tags.includes("image") ? "image" : "code"} size={18} />
                      </span>
                      <span>
                        <strong>{modelDisplayName(model)}</strong>
                        <small>{model.id}</small>
                      </span>
                    </div>
                  </td>
                  <td data-label="Availability">
                    <span className="inline-status"><StatusDot tone={available ? "positive" : "negative"} />{available ? "Available" : "Unavailable"}</span>
                  </td>
                  <td data-label="Evidence">
                    <span className={`evidence-label evidence-label--${evidence.tone}`}><StatusDot tone={evidence.tone === "positive" ? "positive" : evidence.tone === "warning" ? "warning" : "neutral"} />{evidence.label}</span>
                  </td>
                  <td data-label="Inputs and roles">
                    <div className="tag-list">
                      {tags.length > 0 ? tags.map((tag) => <span className="tag" key={tag}>{tag}</span>) : <span className="muted-copy">Not reported</span>}
                    </div>
                  </td>
                  <td data-label="Cost">
                    <span className={costClass === "free" ? "free-chip" : costClass === "paid" ? "cost-chip cost-chip--paid" : "cost-chip"}>
                      {costClass === "free" ? "Verified free" : costClass === "paid" ? "Paid" : "Unknown — blocked"}
                    </span>
                  </td>
                  <td data-label="Enabled">
                    <label className="switch">
                      <span className="sr-only">Enable {modelDisplayName(model)}</span>
                      <input
                        checked={checked}
                        disabled={!canEnable}
                        onChange={(event) => onToggle(model.id, event.target.checked)}
                        type="checkbox"
                      />
                      <span aria-hidden="true" className="switch__track"><span /></span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer" aria-label="Catalog summary">
        <span>{summary.total} live models</span>
        <span><StatusDot tone="positive" />{summary.available} available</span>
        <span><StatusDot tone="warning" />{summary.unbenchmarked} unbenchmarked</span>
      </div>
    </Panel>
  );
}
