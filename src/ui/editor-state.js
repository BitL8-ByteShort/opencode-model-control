import { normalizeState, settingsEqual } from "./model-control.js";

// Apply only changes made by the local editor. Unrelated changes in the latest
// snapshot survive a deliberate conflict rebase or edits made during a Save.
function mergeEdits(before, after, latest) {
  if (settingsEqual(before, after)) return latest;
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object" ||
    Array.isArray(after)
  )
    return after;
  const result = { ...latest };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (settingsEqual(before[key], after[key])) continue;
    if (!(key in after)) delete result[key];
    else result[key] = mergeEdits(before[key], after[key], latest?.[key]);
  }
  return result;
}

/** @returns {import("./types").EditorState} */
export function createEditor(raw, requestId = 0) {
  const state = normalizeState(raw);
  return {
    state,
    baseline: state.settings,
    draft: state.settings,
    baselineRevision: state.settingsRevision,
    requestId,
    saving: null,
  };
}
export function editDraft(editor, draft) {
  return { ...editor, draft };
}
export function receiveSnapshot(editor, raw, requestId) {
  if (!editor) return createEditor(raw, requestId);
  if (requestId < editor.requestId || editor.saving) return editor;
  const state = normalizeState(raw);
  const dirty = !settingsEqual(editor.baseline, editor.draft);
  return {
    ...editor,
    state,
    requestId,
    ...(!dirty
      ? {
          baseline: state.settings,
          draft: state.settings,
          baselineRevision: state.settingsRevision,
        }
      : {}),
  };
}
export function startSave(editor, requestId) {
  return {
    ...editor,
    requestId,
    saving: { requestId, submitted: editor.draft },
  };
}
export function finishSave(editor, raw, requestId) {
  if (editor.saving?.requestId !== requestId) return editor;
  const state = normalizeState(raw);
  return {
    ...editor,
    state,
    baseline: state.settings,
    baselineRevision: state.settingsRevision,
    draft: mergeEdits(editor.saving.submitted, editor.draft, state.settings),
    requestId,
    saving: null,
  };
}
export function failSave(editor) {
  return { ...editor, saving: null };
}
export function rebaseDraft(editor) {
  return {
    ...editor,
    baseline: editor.state.settings,
    baselineRevision: editor.state.settingsRevision,
    draft: mergeEdits(editor.baseline, editor.draft, editor.state.settings),
  };
}
