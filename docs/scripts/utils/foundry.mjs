import { MODULE_ID } from "../constants.mjs";
export const T = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
export const moduleSetting = (key) => game.settings.get(MODULE_ID, key);
export const activeGM = () => game.users.activeGM ?? null;
export const isActiveGM = () => !!game.user.isGM && activeGM()?.id === game.user.id;
export async function fromUuidSafe(uuid) {
  if (!uuid) return null;
  try {
    return await fromUuid(uuid);
  } catch {
    return null;
  }
}
export function fromUuidSync_(uuid) {
  try {
    return fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}
export function moduleActive(id) {
  return !!game.modules.get(id)?.active;
}
export const deepClone = (o) => foundry.utils.deepClone(o);
export const mergeObject = (a, b, o) => foundry.utils.mergeObject(a, b, o);
export function escapeHtml(s) {
  return foundry.utils.escapeHTML
    ? foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
/** Standard PF2e/SF2e DC by level (Player Core / GM Core table). */
export const DC_BY_LEVEL = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
export const levelDC = (level) => DC_BY_LEVEL[Math.min(Math.max(0, level), DC_BY_LEVEL.length - 1)];
