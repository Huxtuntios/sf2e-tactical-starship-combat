import { TscApp, tpl } from "./base-app.mjs";
import { Content } from "../content/loader.mjs";
import { Importer } from "../content/importer.mjs";
import { MODULE_ID } from "../constants.mjs";
import { placeHazard } from "../hazards/hazard-engine.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { T } from "../utils/foundry.mjs";
import { notifyError, notifyInfo } from "../utils/logging.mjs";
import { pickActorImage } from "./image-edit.mjs";
import { checkLinksHTML } from "../content/inline-checks.mjs";
import { ct, ctPlain } from "../content/content-i18n.mjs";
import { traitsText } from "../utils/labels.mjs";
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const guard = (fn) =>
  async function (...a) {
    try {
      return await fn.apply(this, a);
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  };

/** Browser for starship hazards (and ships). Filters: level, type, simple/complex, environment, mechanics, magic, map. */
export class ContentBrowser extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-browser",
    window: { title: "SF2eTSC.ui.hazardBrowser", icon: "fa-solid fa-triangle-exclamation" },
    position: { width: 780, height: 600 },
    actions: {
      importOne: guard(ContentBrowser.#import),
      place: guard(ContentBrowser.#place),
      openActor: guard(ContentBrowser.#open),
      setMode: ContentBrowser.#mode,
      importAll: guard(ContentBrowser.#importAll),
      updateAll: guard(ContentBrowser.#updateAll),
      resetFilters: ContentBrowser.#reset,
      editImage: guard(ContentBrowser.#image)
    }
  };
  static PARTS = { main: { template: tpl("hazard-browser") } };
  channels = [];
  mode = "hazards";
  filters = { text: "", min: -1, max: 25, complexity: "", trait: "", map: "" };
  async _prepareContext() {
    const f = this.filters;
    const text = f.text.toLowerCase();
    const inWorld = new Map(game.actors.filter((a) => a.flags?.[MODULE_ID]?.content?.id).map((a) => [a.flags[MODULE_ID].content.id, a]));
    const list = (this.mode === "hazards" ? Content.hazards : Content.ships)
      .filter(
        (e) =>
          e.level >= f.min &&
          e.level <= f.max &&
          (!text || e.name.toLowerCase().includes(text) || String(ct(e.name)).toLowerCase().includes(text)) &&
          (!f.complexity || (this.mode === "hazards" ? e.complexity === f.complexity : true)) &&
          (!f.trait || (e.traits ?? []).includes(f.trait))
      )
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    const traits = [...new Set((this.mode === "hazards" ? Content.hazards : Content.ships).flatMap((e) => e.traits ?? []))]
      .map((id) => ({ id, label: traitsText([id]) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      hazards: this.mode === "hazards",
      f,
      traits,
      canPlace: !!activeStarshipCombat(),
      isGM: game.user.isGM,
      rows: list.map((e) => ({
        id: e.id,
        name: ct(e.name),
        level: e.level,
        type: this.mode === "hazards" ? T(`SF2eTSC.hazards.${e.complexity}`) : ct(e.faction ?? ""),
        traits: traitsText(e.traits),
        page: e.source?.page ?? "—",
        review: !!e.needsReview,
        inWorld: inWorld.get(e.id)?.uuid ?? null,
        img: inWorld.get(e.id)?.img ?? null,
        summary:
          this.mode === "hazards"
            ? checkLinksHTML(clip(ctPlain(e.description ?? ""), 160)) + (e.disable ? `<br>${checkLinksHTML(ct(e.disable))}` : "")
            : `${T("SF2eTSC.ui.ac")} ${e.ac ?? "?"} · ${T("SF2eTSC.ui.hpShort")} ${e.hp ?? "?"}${e.sp ? ` · ${T("SF2eTSC.ui.sp")} ${e.sp}` : ""} · ${T("SF2eTSC.ui.speed")} ${e.speed ?? "?"}`
      })),
      count: list.length
    };
  }
  _onRender(ctx, opts) {
    super._onRender?.(ctx, opts);
    this.element.querySelectorAll("[data-filter]").forEach((i) =>
      i.addEventListener("change", (ev) => {
        const k = ev.currentTarget.dataset.filter;
        const v = ev.currentTarget.value;
        this.filters[k] = ["min", "max"].includes(k) ? Number(v) : v;
        this.render();
      })
    );
    const t = this.element.querySelector("[data-filter=text]");
    if (t)
      t.addEventListener("input", (ev) => {
        this.filters.text = ev.currentTarget.value;
        clearTimeout(this._tt);
        this._tt = setTimeout(() => this.render(), 250);
      });
  }
  _cleanup() {
    clearTimeout(this._tt);
  }
  static #mode(e, t) {
    this.mode = t.dataset.mode;
    this.render();
  }
  static #reset() {
    this.filters = { text: "", min: -1, max: 25, complexity: "", trait: "", map: "" };
    this.render();
  }
  static async #ensureActor(id, mode) {
    const existing = game.actors.find((a) => a.flags?.[MODULE_ID]?.content?.id === id);
    if (existing) return existing;
    return mode === "hazards" ? Importer.createHazard(id) : Importer.createEnemyShip(id);
  }
  static async #import(e, t) {
    const a = await ContentBrowser.#ensureActor(t.dataset.id, this.mode);
    notifyInfo("SF2eTSC.ui.imported", { name: a.name });
    this.render();
  }
  static async #image(e, t) {
    const a = await ContentBrowser.#ensureActor(t.dataset.id, this.mode);
    pickActorImage(a, "img");
  }
  static async #open(e, t) {
    (await fromUuid(t.dataset.uuid))?.sheet.render(true);
  }
  static async #place(e, t) {
    const a = await ContentBrowser.#ensureActor(t.dataset.id, this.mode);
    if (this.mode === "hazards") await placeHazard(a, { zone: Number(t.dataset.zone) || 1, map: "sensor" });
    else {
      const { addObject } = await import("../engine/sensor-ops.mjs");
      const { mutateTsc } = await import("../combat/tsc-state.mjs");
      const { readStarship } = await import("../starship/starship-state.mjs");
      const c = activeStarshipCombat();
      const d = readStarship(a);
      await mutateTsc(c, (s) =>
        addObject(s, {
          key: a.uuid,
          actorUuid: a.uuid,
          type: "starship",
          name: a.name,
          zone: Math.max(1, s.zones - 1),
          heading: "left",
          level: d.level,
          detection: { party: "observed" }
        })
      );
      if (!c.combatants.some((x) => x.actorId === a.id)) await c.createEmbeddedDocuments("Combatant", [{ actorId: a.id }]);
    }
    notifyInfo("SF2eTSC.ui.placed", { name: a.name });
  }
  static async #updateAll() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: T("SF2eTSC.update.all") },
      content: `<p>${T("SF2eTSC.update.confirmAll")}</p>`,
      rejectClose: false
    }).catch(() => false);
    if (!ok) return;
    const r = await Importer.updateAllFromContent();
    notifyInfo("SF2eTSC.update.doneAll", r);
    this.render();
  }
  static async #importAll() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: T("SF2eTSC.ui.importAll") },
      content: `<p>${T("SF2eTSC.ui.importAllHint", { ships: Content.ships.length, hazards: Content.hazards.length })}</p>`,
      rejectClose: false
    }).catch(() => false);
    if (!ok) return;
    const n = await Importer.importAll();
    notifyInfo("SF2eTSC.ui.importedCount", { count: n });
    this.render();
  }
}
