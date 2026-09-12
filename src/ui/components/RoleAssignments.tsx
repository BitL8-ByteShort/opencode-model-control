import type { CatalogModel, RouterSettings } from "../types";
import {
  isRoleModelAssignable,
  modelIntentEnabled,
  modelEligibilityReasons,
  isRoleModelEligible,
  modelDisplayName,
  ROLE_DEFINITIONS,
  selectRoleModel,
  setCostMode,
  adoptConfiguredPaid,
  billingLabel,
  effectiveBilling,
} from "../model-control.js";
import { Icon, Panel } from "./Primitives";

function selectHint(role: string) {
  if (role === "vision-worker") return "Media inputs may include image, audio, video or PDF; each request must match the reported inputs.";
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
  const enabledModels = catalog.filter((model) => modelIntentEnabled(settings, model.id));

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
        <label className="enrollment-control"><input type="checkbox" checked={settings.autoIncludeNewModels} onChange={event => onChange({...settings, autoIncludeNewModels: event.target.checked})} />Automatically include new models</label>
        <small>{settings.autoIncludeNewModels ? "Policy-following models join automatically when eligible. In Paid mode, newly discovered configured paid models can be enrolled. Explicit disables remain off." : "New policy-following models stay off until explicitly enabled. Returning a model to Policy uses this setting."}</small>
        <small>{settings.costPolicy === "known-cost"
          ? settings.paidEligibility === "configured-connections"
            ? "Allow configured paid connections, including subscriptions. Cost estimates may be unavailable."
            : "Legacy Paid policy still requires verified prices. Save the new Paid option to allow configured connections."
          : "Only models with independently verified free pricing can be routed."}</small>
        {settings.costPolicy === "known-cost" && settings.paidEligibility !== "configured-connections" ? (
          <p className="inline-alert inline-alert--warning">
            Paid used to require verified public prices. Save Paid again to allow configured connections, including subscriptions, when estimates are unavailable.
            <button
              type="button"
              onClick={() => onChange(adoptConfiguredPaid(settings) as RouterSettings)}
            >
              Allow configured paid connections
            </button>
          </p>
        ) : null}
      </fieldset>
      <div className="form-stack">
        {ROLE_DEFINITIONS.map((role) => (
          <label className="field" key={role.key}>
            <span className="field__label"><span>{role.label}</span><small>{role.hint}</small></span>
            <span className="select-wrap">
              <Icon name={role.key === "vision-worker" ? "image" : role.key === "reviewer" ? "check" : "code"} size={16} />
              <select
                aria-label={role.label}
                aria-describedby={`${role.key}-hint`}
                onChange={(event) => updateRole(role.key, event.target.value)}
                value={settings.roleAssignments[role.key] ?? ""}
              >
                <option value="auto">Automatic</option>
                {settings.roleAssignments[role.key] !== "auto" && !catalog.some(model => model.id === settings.roleAssignments[role.key]) ? <option value={settings.roleAssignments[role.key]} disabled>{settings.roleAssignments[role.key]} — unavailable; retained pin</option> : null}
                {catalog.map((model) => {
                  const assignable = isRoleModelAssignable(model, settings, role.key);
                  const eligible = isRoleModelEligible(model, settings, role.key);
                  const suffix = !assignable
                    ? ` — ${modelEligibilityReasons(model, settings, role.key, false).join(" ")}`
                    : eligible
                      ? ""
                      : " — enable on selection";
                  return <option disabled={!assignable} key={model.id} value={model.id}>{modelDisplayName(model)} · {model.provider ?? "Configured slot"} · {billingLabel(effectiveBilling(model.connection, settings)?.kind)}{suffix}</option>;
                })}
              </select>
            </span>
            {settings.roleAssignments[role.key] !== "auto" && modelEligibilityReasons(catalog.find(model => model.id === settings.roleAssignments[role.key]), settings, role.key).length > 0 ? <small className="inline-alert inline-alert--warning">Retained pin: {settings.roleAssignments[role.key]}. {modelEligibilityReasons(catalog.find(model => model.id === settings.roleAssignments[role.key]), settings, role.key).join(" ")} Choose Automatic or another model to replace it.</small> : null}
            {settings.roleAssignments[role.key] !== "auto" && modelEligibilityReasons(catalog.find(model => model.id === settings.roleAssignments[role.key]), settings, role.key).some(reason => reason.includes("Connection changed") || reason.includes("Connection selection required")) ? <button type="button" onClick={() => updateRole(role.key, settings.roleAssignments[role.key]!)}>Use current connection for {role.label}</button> : null}
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
      <div className={settings.costPolicy === "known-cost" ? "locked-setting locked-setting--warning" : "locked-setting"}><Icon name="lock" size={16} /><span><strong>{settings.costPolicy === "known-cost" ? (settings.paidEligibility === "configured-connections" ? "Configured paid connections allowed" : "Legacy verified-price Paid policy") : "Verified-free policy active"}</strong><small>{settings.costPolicy !== "known-cost" ? "Unknown or unverified pricing cannot authorize Free routing." : settings.paidEligibility === "configured-connections" ? "Missing estimates do not block a configured host route." : "Unknown public prices stay blocked until you adopt configured Paid access."}</small></span></div>
      {enabledModels.length === 0 ? <p className="inline-alert inline-alert--warning">No models are enabled yet. Select a compatible model above or enable one in Models.</p> : null}
    </Panel>
  );
}
