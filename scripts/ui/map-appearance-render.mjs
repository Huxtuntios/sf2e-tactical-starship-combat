import { normalizeMapAppearance, MAP_PALETTES } from "../sensor/appearance.mjs";

/** Paint styles and wire image fallback after full OR partial map renders. */
export function paintMapAppearance(element, context) {
  const a = normalizeMapAppearance(context.appearance);
  const palette = {
    ...MAP_PALETTES[a.theme],
    ...(a.textColor ? { text: a.textColor } : {}),
    ...(a.mutedColor ? { dim: a.mutedColor } : {}),
    ...(a.accentColor ? { accent: a.accentColor } : {})
  };
  element.dataset.mapTheme = a.theme;
  element.dataset.mapMode = a.mode;
  for (const [key, value] of Object.entries(palette)) element.style.setProperty(`--tsc-${key}`, value);
  element.style.setProperty("--tsc-art-size", `${a.artSize}px`);
  const viewport = element.querySelector(".tsc-map-viewport");
  viewport?.classList.toggle("has-background", !!a.background);
  const background = element.querySelector(".tsc-map-background");
  if (background) {
    background.style.backgroundImage = a.background ? `url(${JSON.stringify(a.background)})` : "none";
    background.style.opacity = String(a.opacity);
    background.style.filter = `grayscale(${a.fade}) blur(${a.blur}px)`;
  }
  element.querySelectorAll("img.tsc-object-art").forEach((image) => {
    if (image.dataset.tscFallback) return;
    image.dataset.tscFallback = "1";
    const fallback = () => {
      image.hidden = true;
      const label = image.nextElementSibling;
      if (label) label.hidden = false;
    };
    image.addEventListener("error", fallback, { once: true });
    if (image.complete && !image.naturalWidth) fallback();
  });
}
