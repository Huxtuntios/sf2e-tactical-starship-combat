export function fitContactEditorActorList(root) {
  const picker = root?.querySelector(".tsc-contact-editor-actor-picker");
  const label = picker?.querySelector("label");
  const list = picker?.querySelector(".tsc-contact-editor-actor-list");
  if (!picker || !label || !list) return;
  const gap = Number.parseFloat(globalThis.getComputedStyle(picker).rowGap) || 0;
  const height = picker.clientHeight - label.offsetHeight - gap;
  if (height > 0) list.style.height = `${Math.max(100, height)}px`;
}
