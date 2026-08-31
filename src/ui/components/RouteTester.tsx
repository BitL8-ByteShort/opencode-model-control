import { useMemo, useState } from "react";
import { testRoute } from "../api";
import { modelDisplayName, routeModelId, routePlanView, roleLabel } from "../model-control.js";
import type { CatalogModel, RouteModality, RouteResponse } from "../types";
import { Button, Icon, Panel, StatusDot } from "./Primitives";

function displayModel(catalog: CatalogModel[], value: unknown) {
  const id = routeModelId(value);
  const model = catalog.find((candidate) => candidate.id === id);
  return model ? modelDisplayName(model) : id || "Not assigned";
}

export function RouteTester({ catalog }: { catalog: CatalogModel[] }) {
  const [task, setTask] = useState("");
  const [modality, setModality] = useState<RouteModality>("text");
  const [result, setResult] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const canSubmit = task.trim().length >= 4 && !loading;

  const plan = useMemo(
    () => routePlanView(result) as {
      primary: unknown;
      workers: Array<{ modelId?: string; role?: string }>;
      fallbacks: unknown[];
    },
    [result],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setResult(await testRoute(task.trim(), modality));
    } catch (routeError) {
      setError(routeError instanceof Error ? routeError.message : "The route could not be resolved.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel className="route-tester" id="routing">
      <div className="panel-heading panel-heading--compact">
        <div>
          <p className="section-kicker">Dry run</p>
          <h2>Test a route</h2>
          <p className="panel-description">See how the current policy resolves without starting a model run.</p>
        </div>
      </div>
      <form onSubmit={submit}>
        <label className="field field--stacked">
          <span className="field__label"><span>Task</span><small>Use public or synthetic details only</small></span>
          <textarea
            onChange={(event) => setTask(event.target.value)}
            placeholder="Example: inspect this screenshot and list the accessibility issues"
            rows={4}
            value={task}
          />
        </label>
        <div className="route-form-row">
          <fieldset className="modality-picker">
            <legend>Input modality</legend>
            {(["text", "image", "audio", "video", "pdf"] as RouteModality[]).map((option) => (
              <label key={option}>
                <input checked={modality === option} name="modality" onChange={() => setModality(option)} type="radio" />
                <span>{option === "text" ? <Icon name="code" size={15} /> : option === "image" ? <Icon name="image" size={15} /> : null}{roleLabel(option)}</span>
              </label>
            ))}
          </fieldset>
          <Button disabled={!canSubmit} icon="arrow" tone="primary" type="submit">{loading ? "Resolving…" : "Resolve route"}</Button>
        </div>
      </form>
      <div className="image-limit-note"><Icon name="image" size={17} /><span><strong>Multimodal input understanding only</strong><small>Eligible models can inspect their supported image, audio, video, or PDF inputs and return text. They do not generate new stock images or image files; image generation requires a separate tool.</small></span></div>
      {error ? <p className="inline-alert inline-alert--error" role="alert">{error}</p> : null}
      <div aria-live="polite" aria-busy={loading}>
        {result ? (
          <div className="route-result">
            <div className="route-result__header"><span><StatusDot tone="positive" />Resolved route</span><strong>{result.route ? roleLabel(result.route) : "Current policy"}</strong></div>
            <dl>
              <div><dt>Primary</dt><dd>{displayModel(catalog, plan.primary)}</dd></div>
              <div><dt>Workers</dt><dd>{plan.workers.length ? plan.workers.map((worker) => `${worker.role ? `${roleLabel(worker.role)}: ` : ""}${displayModel(catalog, worker)}`).join(", ") : "Direct — no worker"}</dd></div>
              <div><dt>Fallback</dt><dd>{plan.fallbacks.length ? plan.fallbacks.map((item) => displayModel(catalog, item)).join(", ") : "None"}</dd></div>
            </dl>
            {result.reasons?.length ? <ul className="reason-list">{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
            {result.integrationWarning ? <p className="inline-alert inline-alert--warning">{result.integrationWarning}</p> : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
