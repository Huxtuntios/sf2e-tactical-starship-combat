/** GM window: add a world/compendium Hazard or Starship Actor, or a custom contact, with a detection state. */
import { TscApp, tpl } from "./base-app.mjs";
import { getTsc } from "../combat/tsc-state.mjs";
import { T } from "../utils/foundry.mjs";
import { notifyError, notifyInfo } from "../utils/logging.mjs";
import { worldHazardChoices, compendiumHazardChoices, addSensorContact } from "../sensor/contact-service.mjs";
import { contactEditorContext } from "../sensor/contact-editor-model.mjs";

export class SensorContactEditor extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-contact-editor",
    classes: ["sf2e-tsc", "tsc-contact-editor-window"],
    position: { width: 460, height: "auto" },
    window: { title: "SF2eTSC.contactEditor.title", icon: "fa-solid fa-plus", resizable: true },
    actions: { addContact: SensorContactEditor.#add, close: SensorContactEditor.#close }
  };
  static PARTS = { main: { template: tpl("sensor-contact-editor") } };
  channels = [];
  state = { source: "world", filter: "", uuid: "", name: "", zone: 1, detection: "undetected" };
  #compendium = null;
  constructor(combat, options = {}) {
    super(options);
    this.combat = combat;
  }
  async _prepareContext() {
    const source = this.state.source;
    if (source === "compendium" && !this.#compendium) this.#compendium = await compendiumHazardChoices();
    return contactEditorContext(this.state, {
      zones: getTsc(this.combat).zones,
      world: worldHazardChoices(),
      compendium: this.#compendium ?? []
    });
  }
  #read() {
    const f = this.element.querySelector(".tsc-contact-editor");
    const value = (n) => f.querySelector(`[name="${n}"]`);
    this.state = {
      source: f.querySelector('[name="source"]:checked')?.value ?? "world",
      filter: value("filter")?.value ?? this.state.filter,
      uuid: value("uuid")?.value ?? "",
      name: value("name")?.value ?? this.state.name,
      zone: Number(value("zone")?.value) || 1,
      detection: value("detection")?.value ?? "undetected"
    };
    return this.state;
  }
  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element.querySelector(".tsc-contact-editor");
    if (!root || root.dataset.tscWired) return;
    root.dataset.tscWired = "1";
    // Смена источника, фильтра или состояния перерисовывает только окно; выбранное значение сохраняется в this.state.
    root.addEventListener("change", (ev) => {
      const before = this.state;
      const now = this.#read();
      if (ev.target.name === "source" || ev.target.name === "filter" || ev.target.name === "detection" || now.source !== before.source)
        this.render();
    });
    root.addEventListener("input", (ev) => {
      if (ev.target.name === "filter") {
        this.#read();
        this.render();
      }
    });
  }
  static async #add() {
    const s = this.#read();
    try {
      const spec = { source: s.source, uuid: s.uuid, name: s.name, zone: s.zone, detection: s.detection };
      if (spec.source !== "custom" && !spec.uuid) throw new Error(T("SF2eTSC.contactEditor.pick"));
      if (spec.source === "custom" && !spec.name.trim()) throw new Error(T("SF2eTSC.contactEditor.nameRequired"));
      const out = await addSensorContact(this.combat, spec);
      notifyInfo(`SF2eTSC.contactEditor.done.${out.result}`);
      this.state = { ...this.state, uuid: "", name: "" };
      this.render();
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  }
  static #close() {
    return this.close();
  }
}
