/** Serializable, combat-scoped presentation. No document writes or client-local storage. */
export const MAP_PALETTES = {
  dark: {
    bg: "#0e1522",
    panel: "#162133",
    line: "#405574",
    text: "#e3ecfa",
    dim: "#a8bad3",
    accent: "#38bdf8",
    ok: "#34d399",
    warn: "#fbbf24",
    bad: "#f87171"
  },
  light: {
    bg: "#eef3f9",
    panel: "#ffffff",
    line: "#a5b4c7",
    text: "#172b45",
    dim: "#465e7a",
    accent: "#006398",
    ok: "#096c45",
    warn: "#805700",
    bad: "#b42335"
  }
};
export const DEFAULT_MAP_APPEARANCE = Object.freeze({
  theme: "dark",
  mode: "art",
  textColor: "",
  mutedColor: "",
  accentColor: "",
  artSize: 64,
  background: "",
  opacity: 0.35,
  fade: 0.25,
  blur: 2
});
const clamp = (v, min, max, fallback) =>
  v === "" || v == null || !Number.isFinite(Number(v)) ? fallback : Math.max(min, Math.min(max, Number(v)));
const hex = (v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : "");
/** Paths from Foundry's picker or HTTP(S) images only; never executable/data URLs or CSS fragments. */
export function safeImagePath(value) {
  if (typeof value !== "string") return "";
  const path = value.trim();
  if (
    !path ||
    path.length > 4096 ||
    [...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    /[<>"\\]/.test(path) ||
    /^(?:javascript|data|vbscript|file):/i.test(path)
  )
    return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^https?:\/\//i.test(path)) return "";
  return path;
}
export function normalizeMapAppearance(value = {}) {
  const a = value && typeof value === "object" ? value : {};
  const d = DEFAULT_MAP_APPEARANCE;
  return {
    theme: a.theme === "light" ? "light" : "dark",
    mode: a.mode === "simple" ? "simple" : "art",
    textColor: hex(a.textColor),
    mutedColor: hex(a.mutedColor),
    accentColor: hex(a.accentColor),
    artSize: Math.round(clamp(a.artSize, 32, 128, d.artSize)),
    background: safeImagePath(a.background),
    opacity: clamp(a.opacity, 0, 1, d.opacity),
    fade: clamp(a.fade, 0, 1, d.fade),
    blur: clamp(a.blur, 0, 20, d.blur)
  };
}
/** Called only with the redacted object from viewFor: unknown contacts must never resolve a document. */
export function objectArtwork(object, appearance, resolve = () => null) {
  if (!object?.known || normalizeMapAppearance(appearance).mode === "simple") return "";
  const override = safeImagePath(object.art);
  if (override) return override;
  if (!["starship", "hazard"].includes(object.type)) return "";
  const actor = resolve(object.actorUuid ?? object.key);
  return safeImagePath(actor?.img) || safeImagePath(actor?.prototypeToken?.texture?.src);
}
