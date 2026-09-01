import type { CatalogModel, RouterSettings } from "../types";
import {
  isRoleModelAssignable,
  isRoleModelEligible,
  modelDisplayName,
  ROLE_DEFINITIONS,
  selectRoleModel,
  setCostMode,
} from "../model-control.js";
import { Icon, Panel } from "./Primitives";

function selectHint(role: string) {
  if (role === "vision-worker") return "Only image-input models are eligible.";
  if (role === "orchestrator") return "Only models reporting orchestration support are eligible.";
  return "Choose any compatible, available model allowed by the cost policy.";
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
    onChange(selectRoleModel(settings, catalog, role, modelId) as RouterSettings);
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
                  const assignable = isRoleModelAssignable(model, settings, role.key);
                  const eligible = isRoleModelEligible(model, settings, role.key);
                  const suffix = !assignable
                    ? " — not eligible"
                    : eligible
                      ? ""
                      : " — enable on selection";
                  return <option disabled={!assignable} key={model.id} value={model.id}>{modelDisplayName(model)}{suffix}</option>;
                })}
              </select>
            </span>
            <small className="field__hint" id={`${role.key}-hint`}>{selectHint(role.key)} Selecting a disabled model explicitly enables it for routing.</small>
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
      {enabledModels.length === 0 ? <p className="inline-alert inline-alert--warning">No models are enabled yet. Select a compatible model above or enable one in Models.</p> : null}
    </Panel>
  );
}
