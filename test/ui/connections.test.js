import test from "node:test";
import assert from "node:assert/strict";
import {normalizeState, selectRoleModel, modelEligibilityReasons, effectiveBilling, toggleEnabledModel} from "../../src/ui/model-control.js";
import {createEditor, editDraft, receiveSnapshot, finishSave, startSave} from "../../src/ui/editor-state.js";
import {attributedUsageGroups, attributionCoverageWarning} from "../../src/ui/usage-view.js";
const connection = {id: "private-id", providerId: "newvendor", bindingRevision: "r1", billing: {kind: "unknown", source: "unknown"}, entitlement: "not-reported"};
const raw = {settingsRevision: "s1", connectionRevision: "c1", connections: [connection], settings: {costPolicy: "known-cost", paidEligibility: "configured-connections"}, catalog: [{id:"newvendor/model", available:true, modalities:{input:["text"],output:["text"]}, roles:{reviewer:1}, access:["read"], pricingClass:"unknown"}]};
test("pins capture exact slot binding and retain old pins when the binding changes", () => {
 const state=normalizeState(raw);
 const selected=selectRoleModel(state.settings,state.catalog,"reviewer","newvendor/model");
 assert.deepEqual(selected.roleConnections.reviewer,{connectionId:connection.id,bindingRevision:"r1"});
 const changed={...state.catalog[0],connection:{...connection,bindingRevision:"r2"}};
 assert.ok(modelEligibilityReasons(changed,selected,"reviewer").some(x=>x.includes("Connection changed")));
 assert.equal(selected.roleConnections.reviewer.bindingRevision,"r1");
 assert.equal(selectRoleModel(selected,[changed],"reviewer","auto").roleConnections.reviewer,null);
});
test("declarations never infer API billing from auth, cannot replace host evidence and expire with bindings",()=>{
 const settings={billingDeclarations:{[connection.id]:{kind:"subscription",source:"user-declared",bindingRevision:"r1",declaredAt:"date"}}};
 assert.equal(effectiveBilling({...connection,authKind:"api-key"},{}).kind,"unknown");
 assert.equal(effectiveBilling(connection,settings).source,"user-declared");
 assert.equal(effectiveBilling({...connection,bindingRevision:"r2"},settings).kind,"unknown");
 assert.equal(effectiveBilling({...connection,billing:{kind:"prepaid",source:"host"}},settings).kind,"prepaid");
});
test("connection baseline survives dirty refresh and advances only with successful save",()=>{
 let editor=createEditor(raw);
 editor=editDraft(editor,{...editor.draft,billingDeclarations:{[connection.id]:{kind:"subscription",bindingRevision:"r1"}}});
 editor=receiveSnapshot(editor,{...raw,connectionRevision:"c2"},2);
 assert.equal(editor.baselineConnectionRevision,"c1");
 editor=startSave(editor,3); editor=finishSave(editor,{...raw,connectionRevision:"c3",settings:editor.draft},3);
 assert.equal(editor.baselineConnectionRevision,"c3");
});
test("captured usage separates bindings billing currencies, hides identifiers and preserves null versus zero",()=>{
 const observation={connectionId:"secret-id",bindingRevision:"r1",billingKind:"subscription",billingSource:"user-declared",tokens:{input:0,output:null,reasoning:null,cacheRead:null,cacheWrite:null},recordedCost:{amount:0,currency:"USD"}};
 const groups=attributedUsageGroups([observation,{...observation,recordedCost:{amount:2,currency:"EUR"}},{...observation,bindingRevision:"r2",billingKind:"metered-api",recordedCost:null}]);
 assert.equal(groups.length,3); assert.equal(groups[0].cost,0); assert.equal(groups[0].tokens.output,null); assert.equal(groups[2].cost,null); assert.equal(groups[0].connectionLabel,"Captured connection 1");
});
test("revoked evidence and a subscription declaration block eligibility without preventing explicit disable",()=>{
 const state=normalizeState(raw);
 const revoked={...state.catalog[0],connection:{...connection,entitlement:"reported-revoked"}};
 assert.ok(modelEligibilityReasons(revoked,state.settings,"reviewer").some(x=>x.includes("revoked")));
 assert.equal(toggleEnabledModel(state.settings,revoked.id,false).modelControls[revoked.id].selection,"disabled");
 const subscription={...state.settings,costPolicy:"free-only",billingDeclarations:{[connection.id]:{kind:"subscription",source:"user-declared",bindingRevision:"r1"}}};
 assert.ok(modelEligibilityReasons({...state.catalog[0],pricingClass:"free"},subscription,"reviewer").some(x=>x.includes("subscription access is paid")));
});

test("attribution coverage exposes actual failed-write and failed-read diagnostics",()=>{
 assert.match(attributionCoverageWarning({failedWriteCount:3,partial:true,lastFailureCode:"ATTRIBUTION_WRITE_FAILED"}),/could not be saved/);
 assert.match(attributionCoverageWarning({failedWriteCount:0,partial:true,lastFailureCode:"ATTRIBUTION_READ_FAILED"}),/could not be read/);
 assert.match(attributionCoverageWarning({failedWriteCount:0,pendingCount:1,partial:true,lastFailureCode:null}),/Capture is incomplete/);
 assert.equal(attributionCoverageWarning({failedWriteCount:0,pendingCount:0,partial:false,lastFailureCode:null}),"");
 const groups=attributedUsageGroups([{connectionId:null,bindingRevision:null,billingKind:"unknown",billingSource:"unknown",tokens:{},recordedCost:{amount:null,currency:"USD"},priceSnapshot:null}]);
 assert.equal(groups[0].cost,null);
});
