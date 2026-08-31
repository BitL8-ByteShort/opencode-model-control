import type { CatalogModel, RoleAssignments as RoleMap, RouterSettings } from "../types";
import {
  isModelCostAllowed,
  isModelAvailable,
  modelDisplayName,
  ROLE_DEFINITIONS,
  roleModelCompatible,
  setCostMode,
} from "../model-control.js";
import { Icon, Panel } from "./Primitives";

function selectHint(role: string) {
  if (role === "vision-worker") return "Only image-input models are eligible.";
  if (role === "orchestrator") return "Only models reporting orchestration support are eligible.";
  return "Choose from enabled, available models allowed by the cost policy.";
}

export function RoleAssignments({
  catalog,
  settings,
  onChange,
}: {
  catalog: CatalogModel[];
  settings: RouterSettings;
  onChange: (next: RouterSettings) => void;
}) {
  const enabledModels = catalog.filter((model) => settings.modelControls[model.id]?.enabled);

  const updateRole = (role: string, modelId: string) => {
    const roleAssignments: RoleMap = { ...settings.roleAssignments, [role]: modelId };
    onChange({ ...settings, roleAssignments });
  };

  return (
    <Panel className="settings-panel" id="routing-settings">
      <div className="panel-heading panel-heading--compact">
        <div>
          <p className="section-kicker">Router policy</p>
          <h2>Role assignments</h2>
          <p className="panel-description">Roles stay provisional until benchmark evidence qualifies them.</p>
        </div>
      </div>
      <fieldset className="preference-control">
        <legend>Preference</legend>
        <p>Controls automatic role choices. Explicit compatible role selections remain in place.</p>
        <div aria-label="Model cost preference" className="preference-toggle" role="radiogroup">
          <button
            aria-checked={settings.costPolicy !== "known-cost"}
            className={settings.costPolicy !== "known-cost" ? "is-active" : ""}
            onClick={() => onChange(setCostMode(settings, catalog, "free") as RouterSettings)}
            role="radio"
            type="button"
          >Free</button>
          <button
            aria-checked={settings.costPolicy === "known-cost"}
            className={settings.costPolicy === "known-cost" ? "is-active" : ""}
            onClick={() => onChange(setCostMode(settings, catalog, "paid") as RouterSettings)}
            role="radio"
            type="button"
          >Paid</button>
        </div>
        <small>{settings.costPolicy === "known-cost"
          ? "Paid-first automatic routing is enabled. Provider charges may apply; unknown-cost models stay blocked."
          : "Only models with independently verified free pricing can be routed."}</small>
      </fieldset>
      <div className="form-stack">
        {ROLE_DEFINITIONS.map((role) => (
          <label className="field" key={role.key}>
            <span className="field__label"><span>{role.label}</span><small>{role.hint}</small></span>
            <span className="select-wrap">
              <Icon name={role.key === "vision-worker" ? "image" : role.key === "reviewer" ? "check" : "code"} size={16} />
              <select
                aria-describedby={`${role.key}-hint`}
                onChange={(event) => updateRole(role.key, event.target.value)}
                value={settings.roleAssignments[role.key] ?? ""}
              >
                <option value="auto">Automatic</option>
                {catalog.map((model) => {
                  const eligible =
                    isModelCostAllowed(model, settings) &&
                    isModelAvailable(model) &&
                    settings.modelControls[model.id]?.enabled &&
                    roleModelCompatible(model, role.key);
                  const selected = settings.roleAssignments[role.key] === model.id;
                  return <option disabled={!eligible && !selected} key={model.id} value={model.id}>{modelDisplayName(model)}{eligible ? "" : " — not eligible"}</option>;
                })}
              </select>
            </span>
            <small className="field__hint" id={`${role.key}-hint`}>{selectHint(role.key)}</small>
          </label>
        ))}
      </div>
      <div className="policy-grid">
        <label className="field field--short">
          <span className="field__label"><span>Delegation depth</span><small>Loop ceiling</small></span>
          <input
            max={1}
            min={0}
            onChange={(event) => onChange({ ...settings, maxDelegationDepth: Number(event.target.value) })}
            type="number"
            value={settings.maxDelegationDepth}
          />
        </label>
        <label className="field field--short">
          <span className="field__label"><span>Review repair passes</span><small>0 or 1 after review</small></span>
          <input
            max={1}
            min={0}
            onChange={(event) => onChange({ ...settings, maxFallbacksPerAssignment: Number(event.target.value) })}
            type="number"
            value={settings.maxFallbacksPerAssignment}
          />
          <small className="field__hint">Allows one bounded return to the same code worker after a reviewer finds a concrete defect. It does not switch to another model.</small>
        </label>
      </div>
      <div className={settings.costPolicy === "known-cost" ? "locked-setting locked-setting--warning" : "locked-setting"}><Icon name="lock" size={16} /><span><strong>{settings.costPolicy === "known-cost" ? "Known paid models allowed" : "Verified-free policy active"}</strong><small>Unknown or unverified pricing is always excluded from automatic routing.</small></span></div>
      {enabledModels.length === 0 ? <p className="inline-alert inline-alert--warning">Enable at least one available model before saving a role assignment.</p> : null}
    </Panel>
  );
}
