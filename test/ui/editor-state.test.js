import assert from "node:assert/strict";
import test from "node:test";
import {
  createEditor,
  receiveSnapshot,
  editDraft,
  startSave,
  finishSave,
  rebaseDraft,
} from "../../src/ui/editor-state.js";
const snapshot = (rev, extra = {}) => ({
  settingsRevision: rev,
  catalogRevision: rev,
  catalog: [{ id: rev }],
  settings: {
    schemaVersion: 3,
    costPolicy: "free-only",
    autoIncludeNewModels: true,
    modelControls: {},
    roleAssignments: { reviewer: "auto" },
    ...extra,
  },
});
test("metadata updates retain dirty baseline and draft; older responses cannot replace a newer catalog", () => {
  let e = createEditor(snapshot("a"), 1);
  e = editDraft(e, { ...e.draft, autoIncludeNewModels: false });
  e = receiveSnapshot(e, snapshot("b", { costPolicy: "known-cost" }), 3);
  assert.equal(e.baselineRevision, "a");
  assert.equal(e.baseline.costPolicy, "free-only");
  assert.equal(e.draft.autoIncludeNewModels, false);
  assert.equal(e.state.catalog[0].id, "b");
  e = receiveSnapshot(e, snapshot("a"), 2);
  assert.equal(e.state.catalog[0].id, "b");
});
test("save preserves edits made in flight and fences pre-save metadata responses", () => {
  let e = createEditor(snapshot("a"), 1);
  e = editDraft(e, { ...e.draft, autoIncludeNewModels: false });
  e = startSave(e, 3);
  e = editDraft(e, { ...e.draft, costPolicy: "known-cost" });
  e = receiveSnapshot(e, snapshot("older"), 2);
  e = finishSave(e, snapshot("saved", { autoIncludeNewModels: false }), 3);
  assert.equal(e.baselineRevision, "saved");
  assert.equal(e.baseline.costPolicy, "free-only");
  assert.equal(e.draft.costPolicy, "known-cost");
  assert.equal(e.draft.autoIncludeNewModels, false);
  assert.equal(
    receiveSnapshot(e, snapshot("stale"), 2).state.catalog[0].id,
    "saved",
  );
});
test("explicit conflict rebase applies local changes to latest saved settings without losing unrelated external edits", () => {
  let e = createEditor(snapshot("a"), 1);
  e = editDraft(e, { ...e.draft, autoIncludeNewModels: false });
  e = receiveSnapshot(
    e,
    snapshot("b", {
      costPolicy: "known-cost",
      modelControls: { "fixture/new": { selection: "disabled" } },
    }),
    2,
  );
  e = rebaseDraft(e);
  assert.equal(e.baselineRevision, "b");
  assert.equal(e.draft.autoIncludeNewModels, false);
  assert.equal(e.draft.costPolicy, "known-cost");
  assert.equal(e.draft.modelControls["fixture/new"].selection, "disabled");
});

test("conflict rebase preserves remote fields when both editors add the same model control", () => {
  let editor = createEditor(snapshot("base"), 1);
  editor = editDraft(editor, {
    ...editor.draft,
    modelControls: { "fixture/new": { selection: "enabled" } },
  });
  editor = receiveSnapshot(
    editor,
    snapshot("remote", {
      modelControls: {
        "fixture/new": { selection: "policy", available: false },
      },
    }),
    2,
  );
  editor = rebaseDraft(editor);
  assert.deepEqual(editor.draft.modelControls["fixture/new"], {
    selection: "enabled",
    available: false,
  });
  assert.equal(editor.baselineRevision, "remote");
  assert.deepEqual(editor.baseline.modelControls["fixture/new"], {
    selection: "policy",
    available: false,
  });
});

test("edits during Save preserve new remote control fields while applying only the locally added selection", () => {
  let editor = createEditor(snapshot("base"), 1);
  editor = editDraft(editor, { ...editor.draft, autoIncludeNewModels: false });
  editor = startSave(editor, 2);
  editor = editDraft(editor, {
    ...editor.draft,
    modelControls: { "fixture/new": { selection: "enabled" } },
  });
  editor = finishSave(
    editor,
    snapshot("saved", {
      autoIncludeNewModels: false,
      modelControls: {
        "fixture/new": { selection: "policy", available: false },
      },
    }),
    2,
  );
  assert.deepEqual(editor.draft.modelControls["fixture/new"], {
    selection: "enabled",
    available: false,
  });
  assert.equal(editor.baselineRevision, "saved");
});
