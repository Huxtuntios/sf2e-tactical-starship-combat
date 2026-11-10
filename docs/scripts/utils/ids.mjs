export function randomId(prefix = "id") {
  return `${prefix}-${foundry.utils.randomID(8)}`;
}
export function slugify(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
