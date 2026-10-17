import { TscApp, tpl } from "./base-app.mjs";
import { getTsc } from "../combat/tsc-state.mjs";
import { normalizeMapAppearance, MAP_PALETTES, safeImagePath } from "../sensor/appearance.mjs";
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
    actions: { browseImage: MapAppearanceApplication.#browse, resetAppearance: MapAppearanceApplication.#reset }
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
      palette = MAP_PALETTES[a.theme];
    const object = this.key ? state.objects.find((o) => o.key === this.key) : null;
    return {
      objectMode: !!this.key,
      objectName: object?.name ?? "",
      art: safeImagePath(object?.art),
      a,
      textColor: a.textColor || palette.text,
      mutedColor: a.mutedColor || palette.dim,
      accentColor: a.accentColor || palette.accent,
      customColors: !!(a.textColor || a.mutedColor || a.accentColor),
      themes: ["dark", "light"].map((id) => ({ id, label: T(`SF2eTSC.mapAppearance.${id}`), selected: id === a.theme })),
      modes: ["art", "simple"].map((id) => ({ id, label: T(`SF2eTSC.mapAppearance.${id}`), selected: id === a.mode }))
    };
  }
  static #browse(event, target) {
    if (!game.user.isGM) return;
    const input = this.element.querySelector(`input[name="${target.dataset.field}"]`);
    if (!input) return;
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const picker = new FP({
      type: "image",
      current: input.value,
      callback: (path) => {
        input.value = safeImagePath(path);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    return picker.render?.(true) ?? picker.browse?.();
  }
  static async #reset() {
    if (!game.user.isGM) return;
    try {
      await request("sensorUpdate", {
        combatId: this.combat.id,
        op: this.key ? "art" : "appearance",
        key: this.key,
        art: "",
        appearance: {}
      });
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
      const payload = this.key
        ? { op: "art", key: this.key, art: f.art }
        : {
            op: "appearance",
            appearance: normalizeMapAppearance({ ...f, ...(!f.customColors ? { textColor: "", mutedColor: "", accentColor: "" } : {}) })
          };
      await request("sensorUpdate", { combatId: this.combat.id, ...payload });
      await this.close();
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  }
}
