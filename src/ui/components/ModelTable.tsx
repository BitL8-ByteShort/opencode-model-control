import { useState } from "react";
import type {
  CapabilityDetails,
  CatalogModel,
  RouterSettings,
  RuntimeQualificationSummary,
  ModelControl,
} from "../types";
import {
  catalogSummary,
  evidenceMeta,
  isModelAvailable,
  modelCostClass,
  modelDisplayName,
  modelInputModalities,
  modelRoles,
  modelIntentEnabled,
  modelSelection,
  modelEligibilityReasons,
} from "../model-control.js";
import { Panel, StatusDot } from "./Primitives";

const reported = (value: unknown): string =>
  value == null
    ? "Not reported"
    : value === true
      ? "Supported"
      : value === false
        ? "Unsupported"
        : typeof value === "number"
          ? value.toLocaleString()
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value);
function sourceAge(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not reported";
  const hours = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 3600000),
  );
  return `${value} · ${hours < 1 ? "less than 1 hour" : `${hours} hours`} ago`;
}
function CapabilitySource({
  details,
  title,
}: {
  details?: CapabilityDetails | null;
  title: string;
}) {
  return (
    <section className="capability-source">
      <h4>{title}</h4>
      <p>
        Source: {details?.source ?? "Not reported"} · Observed:{" "}
        {sourceAge(details?.observedAt)}
      </p>
      <dl>
        {["input", "output"].map((direction) => (
          <div key={direction}>
            <dt>{direction === "input" ? "Inputs" : "Outputs"}</dt>
            <dd>
              {Object.entries(
                details?.[direction as "input" | "output"] ?? {
                  text: null,
                  image: null,
                  audio: null,
                  video: null,
                  pdf: null,
                },
              ).map(([name, value]) => (
                <span className="capability-value" key={name}>
                  {name}: {reported(value)}
                </span>
              ))}
            </dd>
          </div>
        ))}
        {[
          ["Tools", details?.toolCall],
          ["Reasoning", details?.reasoning],
          ["Structured output", details?.structuredOutput],
          ["Context tokens", details?.contextWindowTokens],
          ["Max input tokens", details?.inputLimitTokens],
          ["Max output tokens", details?.outputLimitTokens],
          ["Temperature", details?.temperature],
          ["Attachments", details?.attachment],
          ["Interleaved reasoning", details?.interleaved],
          ["Reasoning options", details?.reasoningOptions],
        ].map(([name, value]) => (
          <div key={String(name)}>
            <dt>{String(name)}</dt>
            <dd>{reported(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
export function ModelTable({
  catalog,
  qualification,
  settings,
  onToggle,
  onSelection,
}: {
  catalog: CatalogModel[];
  qualification: RuntimeQualificationSummary | null;
  settings: RouterSettings;
  onToggle: (modelId: string, enabled: boolean) => void;
  onSelection: (modelId: string, selection: ModelControl["selection"]) => void;
}) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [capability, setCapability] = useState("");
  const summary = catalogSummary(catalog, settings);
  const providers = [
    ...new Set(
      catalog.map((model) => model.provider ?? model.id.split("/")[0]),
    ),
  ].sort();
  const filtered = catalog.filter((model) => {
    const matchesQuery = `${model.id} ${modelDisplayName(model)}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    const effective = model.capabilities?.effective;
    const matchesCapability =
      !capability ||
      (["toolCall", "reasoning", "structuredOutput"].includes(capability)
        ? effective?.[
            capability as "toolCall" | "reasoning" | "structuredOutput"
          ] === true
        : modelInputModalities(model).includes(capability));
    return (
      matchesQuery &&
      (!provider || (model.provider ?? model.id.split("/")[0]) === provider) &&
      matchesCapability
    );
  });
  return (
    <Panel className="models-panel" id="models">
      <div className="panel-heading panel-heading--table">
        <div>
          <p className="section-kicker">Live catalog</p>
          <h2>Model availability</h2>
        </div>
        <span className="summary-count">
          {summary.enabled} of {summary.total} enabled by intent
        </span>
      </div>
      <div className="model-filters">
        <label>
          Search models
          <input
            type="search"
            aria-label="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or provider/model ID"
          />
        </label>
        <label>
          Provider
          <select
            aria-label="Provider filter"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
          >
            <option value="">All providers</option>
            {providers.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Capability
          <select
            aria-label="Capability filter"
            value={capability}
            onChange={(event) => setCapability(event.target.value)}
          >
            <option value="">All capabilities</option>
            {["text", "image", "audio", "video", "pdf"].map((value) => (
              <option key={value} value={value}>
                {value} input
              </option>
            ))}
            <option value="toolCall">Tools</option>
            <option value="reasoning">Reasoning</option>
            <option value="structuredOutput">Structured output</option>
          </select>
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">
            Current OpenCode models, pricing class, and routing eligibility
          </caption>
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
            {filtered.map((model) => {
              const name = modelDisplayName(model);
              const available = isModelAvailable(model);
              const checked = modelIntentEnabled(settings, model.id);
              const reasons = modelEligibilityReasons(model, settings);
              const canEnable =
                modelEligibilityReasons(model, settings, undefined, false)
                  .length === 0;
              const costClass = modelCostClass(model);
              const runtime = qualification?.results.find(
                (result) => result.modelId === model.id,
              );
              const evidence = evidenceMeta(
                runtime
                  ? {
                      status:
                        runtime.status === "passed"
                          ? "runtime-access-only"
                          : "runtime-access-failed",
                    }
                  : model.evidence,
              );
              const tags = [
                ...new Set([
                  ...modelInputModalities(model),
                  ...modelRoles(model),
                ]),
              ];
              return (
                <tr
                  className={
                    !available ? "model-row model-row--muted" : "model-row"
                  }
                  key={model.id}
                >
                  <td data-label="Model">
                    <div className="model-cell">
                      <span>
                        <strong>{name}</strong>
                        <small>{model.id}</small>
                      </span>
                    </div>
                  </td>
                  <td data-label="Availability">
                    <span className="inline-status">
                      <StatusDot tone={available ? "positive" : "negative"} />
                      {available ? "Available" : "Unavailable"}
                    </span>
                    <p className="eligibility-reasons">
                      {reasons.length
                        ? reasons.join(" ")
                        : "Eligible under draft policy"}
                    </p>
                  </td>
                  <td data-label="Evidence">
                    <span
                      className={`evidence-label evidence-label--${evidence.tone}`}
                    >
                      {evidence.label}
                    </span>
                  </td>
                  <td data-label="Inputs and roles">
                    <div className="tag-list">
                      {tags.length ? (
                        tags.map((tag) => (
                          <span className="tag" key={tag}>
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span>Not reported</span>
                      )}
                    </div>
                    <details className="model-details">
                      <summary>Full capabilities</summary>
                      <CapabilitySource
                        title="Effective OpenCode capabilities"
                        details={model.capabilities?.effective}
                      />
                      <CapabilitySource
                        title="Supplemental metadata (does not grant host support)"
                        details={model.capabilities?.supplemental}
                      />
                      <p>
                        Compatible roles:{" "}
                        {modelRoles(model).join(", ") || "None reported"}. Each
                        route still requires matching inputs and access.
                      </p>
                    </details>
                  </td>
                  <td data-label="Cost">
                    <span
                      className={
                        costClass === "free"
                          ? "free-chip"
                          : costClass === "paid"
                            ? "cost-chip cost-chip--paid"
                            : "cost-chip"
                      }
                    >
                      {costClass === "free"
                        ? "Verified free"
                        : costClass === "paid"
                          ? "Paid"
                          : "Unknown — blocked"}
                    </span>
                    <details className="model-details">
                      <summary>Pricing evidence</summary>
                      <p>Source: {model.pricing?.source ?? "Not reported"}</p>
                      <p>Retrieved: {sourceAge(model.pricing?.fetchedAt)}</p>
                      <p>
                        Expires: {model.pricing?.expiresAt ?? "Not reported"}
                      </p>
                      {model.pricing?.reasons?.length ? (
                        <p>{model.pricing.reasons.join(", ")}</p>
                      ) : null}
                    </details>
                  </td>
                  <td data-label="Enabled">
                    <label className="switch">
                      <span className="sr-only">Enable {name}</span>
                      <input
                        checked={checked}
                        disabled={!canEnable && !checked}
                        onChange={(event) =>
                          onToggle(model.id, event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span aria-hidden="true" className="switch__track">
                        <span />
                      </span>
                    </label>
                    <select
                      className="selection-control"
                      aria-label={`Selection for ${name}`}
                      value={modelSelection(settings, model.id)}
                      onChange={(event) =>
                        onSelection(
                          model.id,
                          event.target.value as ModelControl["selection"],
                        )
                      }
                    >
                      <option value="policy">Policy</option>
                      <option value="enabled" disabled={!canEnable}>
                        Enabled
                      </option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <p className="panel-description">
            No models match these filters. Change the search or filters to see
            retained catalog entries.
          </p>
        ) : null}
      </div>
      <div className="table-footer" aria-label="Catalog summary">
        <span>
          {filtered.length} of {summary.total} models shown
        </span>
        <span>
          <StatusDot tone="positive" />
          {summary.available} available
        </span>
        <span>
          <StatusDot tone="warning" />
          {summary.unbenchmarked} unbenchmarked
        </span>
      </div>
    </Panel>
  );
}
