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
  blur: 2,
  arrowMode: "text",
  arrowImage: "",
  arrowSize: 18,
  arrowGap: 4,
  arrowPosition: "right",
  arrowOpacity: 1,
  autoMirror: false,
  backgroundRotation: 0,
  backgroundFlipX: false,
  backgroundFlipY: false
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
    blur: clamp(a.blur, 0, 20, d.blur),
    arrowMode: ["none", "text", "emoji", "custom"].includes(a.arrowMode) ? a.arrowMode : d.arrowMode,
    arrowImage: safeImagePath(a.arrowImage),
    arrowSize: Math.round(clamp(a.arrowSize, 10, 64, d.arrowSize)),
    arrowGap: Math.round(clamp(a.arrowGap, 0, 24, d.arrowGap)),
    arrowPosition: ["left", "right", "top", "bottom"].includes(a.arrowPosition) ? a.arrowPosition : d.arrowPosition,
    arrowOpacity: clamp(a.arrowOpacity, 0, 1, d.arrowOpacity),
    autoMirror: a.autoMirror === true,
    backgroundRotation: normalizeAngle(a.backgroundRotation),
    backgroundFlipX: a.backgroundFlipX === true,
    backgroundFlipY: a.backgroundFlipY === true
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

/** Визуальная ориентация не меняет курс или координаты игрового объекта. */
export const normalizeAngle = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? ((Math.round(n) % 360) + 360) % 360 : 0;
};
export function normalizeObjectTransform(value = {}) {
  const v = value && typeof value === "object" ? value : {};
  return {
    rotation: normalizeAngle(v.rotation),
    flipX: v.flipX === true,
    flipY: v.flipY === true,
    baseDirection: ["right", "left", "up", "down", "unknown"].includes(v.baseDirection) ? v.baseDirection : "right"
  };
}
/** Отражение выводится из курса, а не накапливается от событий. Курс карты сегодня только left/right. */
export function visualTransform(value, heading, autoMirror = false) {
  const t = normalizeObjectTransform(value);
  const horizontal = ["left", "right"].includes(t.baseDirection);
  const auto = autoMirror && horizontal && ["left", "right"].includes(heading) && heading !== t.baseDirection;
  return { ...t, auto, scaleX: t.flipX !== auto ? -1 : 1, scaleY: t.flipY ? -1 : 1 };
}
/** Сравнение полей отправляет только реально отредактированные абсолютные значения. */
export function changedFields(previous, next, keys) {
  return Object.fromEntries(keys.filter((key) => previous[key] !== next[key]).map((key) => [key, next[key]]));
}
