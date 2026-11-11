import { activeModuleTheme } from "./sheet/sheet-theme.mjs";
import { TscApp, tpl } from "./base-app.mjs";
import { getTsc } from "../combat/tsc-state.mjs";
import {
  normalizeMapAppearance,
  DEFAULT_MAP_APPEARANCE,
  resolveArrowAppearance,
  normalizeObjectTransform,
  normalizeAutoMirrorOverride,
  normalizeAngle,
  changedFields,
  MAP_PALETTES,
  safeImagePath
} from "../sensor/appearance.mjs";

const APPEARANCE_FIELDS = [
  "mode",
  "artSize",
  "textColor",
  "mutedColor",
  "accentColor",
  "background",
  "opacity",
  "fade",
  "blur",
  "arrowMode",
  "arrowImage",
  "arrowSize",
  "arrowGap",
  "arrowPosition",
  "arrowOpacity",
  "autoMirror",
  "backgroundRotation",
  "backgroundFlipX",
  "backgroundFlipY"
];
const TRANSFORM_FIELDS = ["rotation", "flipX", "flipY", "baseDirection"];
import { request } from "../socket.mjs";
import { T } from "../utils/foundry.mjs";
import { notifyError } from "../utils/logging.mjs";

/** GM editor bound to one combat (never silently writes into a newly selected combat). */
export class MapAppearanceApplication extends TscApp {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["sf2e-tsc", "tsc-map-appearance"],
    position: { width: 480, height: "auto" },
    window: { title: "SF2eTSC.mapAppearance.title", resizable: true },
    form: { handler: MapAppearanceApplication.#submit, closeOnSubmit: false, submitOnChange: false },
    actions: {
      browseImage: MapAppearanceApplication.#browse,
      clearImage: MapAppearanceApplication.#clearImage,
      transformControl: MapAppearanceApplication.#transformControl,
      resetArrowAppearance: MapAppearanceApplication.#resetArrowAppearance,
      resetAppearance: MapAppearanceApplication.#reset
    }
  };
  static PARTS = { main: { template: tpl("map-appearance") } };
  channels = [];
  constructor(combat, key = null, options = {}) {
    super(options);
    this.combat = combat;
    this.key = key;
  }
  async _prepareContext() {
    const state = getTsc(this.combat),
      a = normalizeMapAppearance(state.appearance),
      palette = MAP_PALETTES[activeModuleTheme()];
    const object = this.key ? state.objects.find((o) => o.key === this.key) : null;
    const transform = normalizeObjectTransform(object?.mapTransform);
    const autoMirrorOverride = normalizeAutoMirrorOverride(object?.autoMirrorOverride);
    const arrowAppearanceOverride =
      object?.arrowAppearance && typeof object.arrowAppearance === "object" ? resolveArrowAppearance(a, object.arrowAppearance) : null;
    const arrowAppearance = resolveArrowAppearance(a, arrowAppearanceOverride);
    this._appearanceSnapshot = a;
    this._objectSnapshot = {
      art: safeImagePath(object?.art),
      autoMirrorOverride,
      arrowAppearanceOverride,
      ...transform
    };
    return {
      transform,
      arrowModes: ["none", "text", "emoji", "custom"].map((id) => ({
        id,
        label: T(`SF2eTSC.mapVisual.arrowModes.${id}`),
        selected: id === (this.key ? arrowAppearance : a).arrowMode
      })),
      positions: ["left", "right", "top", "bottom"].map((id) => ({
        id,
        label: T(`SF2eTSC.mapVisual.positions.${id}`),
        selected: id === (this.key ? arrowAppearance : a).arrowPosition
      })),
      directions: ["left", "right", "up", "down", "unknown"].map((id) => ({
        id,
        label: T(`SF2eTSC.mapVisual.positions.${id}`),
        selected: id === transform.baseDirection
      })),
      autoMirrorOptions: ["inherit", "on", "off"].map((id) => ({
        id,
        label: T(`SF2eTSC.mapVisual.autoMirrorOptions.${id}`),
        selected: (autoMirrorOverride === null ? "inherit" : autoMirrorOverride ? "on" : "off") === id
      })),
      autoMirrorOverride,
      arrowAppearance,
      arrowAppearanceMode: arrowAppearanceOverride ? "override" : "inherit",
      arrowAppearanceOverridden: !!arrowAppearanceOverride,
      arrowAppearanceOptions: ["inherit", "override"].map((id) => ({
        id,
        label: T(`SF2eTSC.mapVisual.arrowAppearanceOptions.${id}`),
        selected: (arrowAppearanceOverride ? "override" : "inherit") === id
      })),
      objectMode: !!this.key,
      objectName: object?.name ?? "",
      art: safeImagePath(object?.art),
      a,
      textColor: a.textColor || palette.text,
      mutedColor: a.mutedColor || palette.dim,
      accentColor: a.accentColor || palette.accent,
      customColors: !!(a.textColor || a.mutedColor || a.accentColor),
      modes: ["art", "simple"].map((id) => ({ id, label: T(`SF2eTSC.mapAppearance.${id}`), selected: id === a.mode }))
    };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    const preview = this.element.querySelector("[data-image-preview]");
    if (preview && !preview.dataset.wired) {
      preview.dataset.wired = "1";
      preview.addEventListener("error", () => {
        preview.hidden = true;
      });
      if (preview.complete && !preview.naturalWidth) preview.hidden = true;
    }
  }
  static #browse(event, target) {
    if (!game.user.isGM) return;
    const input = this.element.querySelector(`input[name="${target.dataset.field}"]`);
    if (!input) return;
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    if (!FP) return notifyError("SF2eTSC.mapVisual.noFilePicker");
    const picker = new FP({
      type: "image",
      current: input.value,
      callback: (path) => {
        input.value = safeImagePath(path);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const preview = this.element.querySelector(`[data-image-preview="${target.dataset.field}"]`);
        if (preview) {
          preview.src = input.value;
          preview.hidden = !input.value;
        }
      }
    });
    return picker.render?.(true) ?? picker.browse?.();
  }
  static #clearImage(event, target) {
    const input = this.element.querySelector(`input[name="${target.dataset.field}"]`);
    const preview = this.element.querySelector(`[data-image-preview="${target.dataset.field}"]`);
    if (input) input.value = "";
    if (preview) {
      preview.removeAttribute("src");
      preview.hidden = true;
    }
  }
  static #transformControl(event, target) {
    const form = target.closest("form") ?? this.element;
    const rotation = form.querySelector('input[name="rotation"]');
    const flipX = form.querySelector('input[name="flipX"]');
    const flipY = form.querySelector('input[name="flipY"]');
    if (!rotation || !flipX || !flipY) return;
    const op = target.dataset.op;
    if (op === "left") rotation.value = normalizeAngle(Number(rotation.value) - 90);
    if (op === "right") rotation.value = normalizeAngle(Number(rotation.value) + 90);
    if (op === "flipX") flipX.checked = !flipX.checked;
    if (op === "flipY") flipY.checked = !flipY.checked;
    if (["resetRotation", "resetAll"].includes(op)) rotation.value = 0;
    if (["resetFlipping", "resetAll"].includes(op)) {
      flipX.checked = false;
      flipY.checked = false;
    }
  }
  static async #resetArrowAppearance() {
    if (!game.user.isGM || !this.key || !this._objectSnapshot.arrowAppearanceOverride) return;
    try {
      await request("sensorUpdate", {
        combatId: this.combat.id,
        op: "objectVisual",
        key: this.key,
        visual: { arrowAppearance: null }
      });
      this.render();
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  }
  static async #reset() {
    if (!game.user.isGM) return;
    try {
      const payload = this.key
        ? { op: "objectVisual", key: this.key, visual: { art: "" } }
        : { op: "appearancePatch", appearance: changedFields(this._appearanceSnapshot, DEFAULT_MAP_APPEARANCE, APPEARANCE_FIELDS) };
      if ((this.key && !this._objectSnapshot.art) || (!this.key && !Object.keys(payload.appearance).length)) return;
      await request("sensorUpdate", { combatId: this.combat.id, ...payload });
      this.render();
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  }
  static async #submit(event, form, formData) {
    if (!game.user.isGM) return;
    try {
      const f = formData.object;
      const path = this.key ? f.art : f.background;
      if (path?.trim() && !safeImagePath(path)) throw new Error(T("SF2eTSC.mapAppearance.invalidPath"));
      if ((!this.key || f.arrowAppearanceMode === "override") && f.arrowImage?.trim() && !safeImagePath(f.arrowImage))
        throw new Error(T("SF2eTSC.mapAppearance.invalidPath"));
      let payload;
      if (this.key) {
        const next = normalizeObjectTransform({ ...f, flipX: !!f.flipX, flipY: !!f.flipY });
        const transform = changedFields(this._objectSnapshot, next, TRANSFORM_FIELDS);
        const art = safeImagePath(f.art);
        const selectedMirror = f.autoMirrorOverride;
        const autoMirrorOverride =
          selectedMirror === "on"
            ? true
            : selectedMirror === "off"
              ? false
              : selectedMirror === "inherit"
                ? null
                : this._objectSnapshot.autoMirrorOverride;
        const arrowAppearance = f.arrowAppearanceMode === "override" ? resolveArrowAppearance(this._appearanceSnapshot, f) : null;
        const visual = {
          ...(Object.keys(transform).length ? { transform } : {}),
          ...(art !== this._objectSnapshot.art ? { art } : {}),
          ...(autoMirrorOverride !== this._objectSnapshot.autoMirrorOverride ? { autoMirrorOverride } : {}),
          ...(arrowAppearance === null
            ? this._objectSnapshot.arrowAppearanceOverride
              ? { arrowAppearance: null }
              : {}
            : JSON.stringify(arrowAppearance) !== JSON.stringify(this._objectSnapshot.arrowAppearanceOverride)
              ? { arrowAppearance }
              : {})
        };
        if (!Object.keys(visual).length) {
          await this.close();
          return;
        }
        payload = { op: "objectVisual", key: this.key, visual };
      } else {
        const next = normalizeMapAppearance({
          ...f,
          autoMirror: !!f.autoMirror,
          backgroundFlipX: !!f.backgroundFlipX,
          backgroundFlipY: !!f.backgroundFlipY,
          theme: this._appearanceSnapshot.theme,
          ...(!f.customColors ? { textColor: "", mutedColor: "", accentColor: "" } : {})
        });
        const appearance = changedFields(this._appearanceSnapshot, next, APPEARANCE_FIELDS);
        if (!Object.keys(appearance).length) {
          await this.close();
          return;
        }
        payload = { op: "appearancePatch", appearance };
      }
      await request("sensorUpdate", { combatId: this.combat.id, ...payload });
      await this.close();
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  }
}
