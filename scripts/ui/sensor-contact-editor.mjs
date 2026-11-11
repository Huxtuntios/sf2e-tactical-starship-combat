/** GM window: add a world/compendium Hazard or Starship Actor, or a custom contact, with a detection state. */
import { TscApp, tpl } from "./base-app.mjs";
import { getTsc } from "../combat/tsc-state.mjs";
import { T } from "../utils/foundry.mjs";
import { notifyError, notifyInfo } from "../utils/logging.mjs";
import { worldHazardChoices, compendiumHazardChoices, addSensorContact } from "../sensor/contact-service.mjs";
import { contactEditorContext } from "../sensor/contact-editor-model.mjs";
import { fitContactEditorActorList, readManualContactEditorActorListHeight } from "../sensor/contact-editor-layout.mjs";

export class SensorContactEditor extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-contact-editor",
    classes: ["sf2e-tsc", "tsc-contact-editor-window"],
    position: { width: 460, height: 560 },
    window: { title: "SF2eTSC.contactEditor.title", icon: "fa-solid fa-plus", resizable: true },
    actions: { addContact: SensorContactEditor.#add, close: SensorContactEditor.#close }
  };
  static PARTS = { main: { template: tpl("sensor-contact-editor") } };
  channels = [];
  state = { source: "world", filter: "", uuid: "", listHeight: null, name: "", zone: 1, detection: "undetected" };
  #compendium = null;
  #resizeObserver = null;
  #observedContent = null;
  #observedPicker = null;
  #resizePointerUp = null;
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
      listHeight: this.state.listHeight,
      name: value("name")?.value ?? this.state.name,
      zone: Number(value("zone")?.value) || 1,
      detection: value("detection")?.value ?? "undetected"
    };
    return this.state;
  }
  _onRender(context, options) {
    super._onRender?.(context, options);
    fitContactEditorActorList(this.element, this.state.listHeight);
    if (!this.#resizeObserver && globalThis.ResizeObserver) {
      this.#resizeObserver = new ResizeObserver(() => fitContactEditorActorList(this.element, this.state.listHeight));
    }
    if (this.#resizeObserver) {
      const content = this.element.querySelector(".window-content");
      const picker = this.element.querySelector(".tsc-contact-editor-actor-picker");
      if (content && content !== this.#observedContent) {
        this.#resizeObserver.observe(content);
        this.#observedContent = content;
      }
      if (picker !== this.#observedPicker) {
        if (this.#observedPicker) this.#resizeObserver.unobserve(this.#observedPicker);
        if (picker) this.#resizeObserver.observe(picker);
        this.#observedPicker = picker;
      }
    }
    const root = this.element.querySelector(".tsc-contact-editor");
    if (!root || root.dataset.tscWired) return;
    root.dataset.tscWired = "1";
    root.addEventListener("pointerdown", (ev) => {
      const list = ev.target.closest?.(".tsc-contact-editor-actor-list");
      if (!list) return;
      if (this.#resizePointerUp) globalThis.document.removeEventListener("pointerup", this.#resizePointerUp);
      const startHeight = list.clientHeight;
      const stopResize = () => {
        globalThis.document.removeEventListener("pointerup", stopResize);
        this.#resizePointerUp = null;
        const height = readManualContactEditorActorListHeight(this.element, startHeight);
        if (height !== null) {
          this.state.listHeight = height;
          fitContactEditorActorList(this.element, this.state.listHeight);
        }
      };
      this.#resizePointerUp = stopResize;
      globalThis.document.addEventListener("pointerup", stopResize, { once: true });
    });
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
  _onClose(options) {
    if (this.#resizePointerUp) globalThis.document.removeEventListener("pointerup", this.#resizePointerUp);
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#observedContent = null;
    this.#observedPicker = null;
    super._onClose?.(options);
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
