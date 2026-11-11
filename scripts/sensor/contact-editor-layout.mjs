export function fitContactEditorActorList(root, preferredHeight = null) {
  const picker = root?.querySelector(".tsc-contact-editor-actor-picker");
  const label = picker?.querySelector("label");
  const list = picker?.querySelector(".tsc-contact-editor-actor-list");
  if (!picker || !label || !list) return null;
  const gap = Number.parseFloat(globalThis.getComputedStyle(picker).rowGap) || 0;
  const availableHeight = Math.max(0, picker.clientHeight - label.offsetHeight - gap);
  const desiredHeight = Number.isFinite(preferredHeight) ? Math.max(0, preferredHeight) : availableHeight;
  const height = Math.min(desiredHeight, availableHeight);
  list.style.maxHeight = `${availableHeight}px`;
  list.style.height = `${height}px`;
  return { availableHeight, height };
}

export function readManualContactEditorActorListHeight(root, startHeight) {
  const list = root?.querySelector(".tsc-contact-editor-actor-list");
  return list && list.clientHeight !== startHeight ? list.clientHeight : null;
}
