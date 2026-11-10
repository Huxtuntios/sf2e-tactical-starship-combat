import { normalizeMapAppearance } from "../sensor/appearance.mjs";
import { paintSheetTheme } from "./sheet/sheet-theme.mjs";

/** Paint styles and wire image fallback after full OR partial map renders. */
export function paintMapAppearance(element, context) {
  const a = normalizeMapAppearance(context.appearance);
  element.dataset.tscTextColor = a.textColor;
  element.dataset.tscMutedColor = a.mutedColor;
  element.dataset.tscAccentColor = a.accentColor;
  paintSheetTheme(element);
  element.dataset.mapMode = a.mode;
  element.style.setProperty("--tsc-art-size", `${a.artSize}px`);
  element.style.setProperty("--tsc-arrow-size", `${a.arrowSize}px`);
  element.style.setProperty("--tsc-arrow-gap", `${a.arrowGap}px`);
  element.style.setProperty("--tsc-arrow-opacity", String(a.arrowOpacity));
  const viewport = element.querySelector(".tsc-map-viewport");
  viewport?.classList.toggle("has-background", !!a.background);
  const background = element.querySelector(".tsc-map-background");
  if (background) {
    // Не меняем стили сохранённого слоя при обновлении других частей карты.
    const values = {
      backgroundImage: a.background ? `url(${JSON.stringify(a.background)})` : "none",
      opacity: String(a.opacity),
      filter: `grayscale(${a.fade}) blur(${a.blur}px)`,
      transform: `rotate(${a.backgroundRotation}deg) scale(${a.backgroundFlipX ? -1 : 1}, ${a.backgroundFlipY ? -1 : 1})`
    };
    for (const [property, value] of Object.entries(values)) {
      if (background.style[property] !== value) background.style[property] = value;
    }
  }
  element.querySelectorAll("img.tsc-object-art, img.tsc-course-image").forEach((image) => {
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
