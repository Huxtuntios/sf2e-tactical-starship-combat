import { TscApp, tpl } from "./base-app.mjs";
import { allStarships, readStarship } from "../starship/starship-state.mjs";
import { isStarshipHazard } from "../hazards/hazard-engine.mjs";
import { estimateEncounter, suggestShips, suggestHazards, rateEntry, THREAT_ORDER } from "../engine/encounter.mjs";
import { Content } from "../content/loader.mjs";
import { Importer } from "../content/importer.mjs";
import { ct } from "../content/content-i18n.mjs";
import { shipNameWithLevel } from "../content/ship-docs.mjs";
import { T } from "../utils/foundry.mjs";
import { notifyError, notifyInfo } from "../utils/logging.mjs";

const MODULE = "sf2e-tactical-starship-combat";
const guard = (fn) =>
  async function (...a) {
    try {
      return await fn.apply(this, a);
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  };
const levelShort = () => (game.i18n.has("SF2eTSC.ui.levelShort") ? T("SF2eTSC.ui.levelShort") : "Lv");

/**
 * Starship Encounter Builder: player crew/ship vs enemy ships, hazards and boarding threats.
 * Shows the XP total, the threat rating against the Tech Core budget (small-crew rule included) and
 * suggests compendium starships that fill the remaining budget for the chosen threat.
 */
export class EncounterBuilder extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-encounter",
    window: { title: "SF2eTSC.ui.encounterBuilder", icon: "fa-solid fa-scale-balanced", resizable: true },
    position: { width: 700, height: 680 },
    actions: {
      toggle: EncounterBuilder.#toggle,
      setThreat: EncounterBuilder.#setThreat,
      adjust: EncounterBuilder.#adjust,
      importSuggestion: guard(EncounterBuilder.#importSuggestion),
      importHazard: guard(EncounterBuilder.#importHazard)
    }
  };
  static PARTS = { main: { template: tpl("encounter-builder") } };
  channels = [];
  picked = new Set();
  target = "moderate";
  levelOverride = null;
  sizeOverride = null;

  async _prepareContext() {
    const pcs = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
    const ship = allStarships().find((s) => readStarship(s).role === "player");
    const shipData = ship ? readStarship(ship) : null;
    const autoLevel = shipData?.level ?? (Math.round(pcs.reduce((n, a) => n + a.level, 0) / Math.max(1, pcs.length)) || 1);
    const autoSize = shipData?.crew?.length || pcs.length || 4;
    const partyLevel = this.levelOverride ?? autoLevel;
    const partySize = this.sizeOverride ?? autoSize;
    const entries = [];
    for (const s of allStarships().filter((x) => readStarship(x).role !== "player"))
      entries.push({ uuid: s.uuid, name: s.name, kind: "ship", level: readStarship(s).level });
    for (const h of game.actors.filter((a) => isStarshipHazard(a)))
      entries.push({
        uuid: h.uuid,
        name: h.name,
        kind: h.system.details.isComplex ? "complexHazard" : "simpleHazard",
        level: h.system.details.level.value
      });
    for (const n of game.actors.filter((a) => a.type === "npc" && !a.flags?.[MODULE]?.starship))
      entries.push({ uuid: n.uuid, name: n.name, kind: "creature", level: n.level });
    entries.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    const chosen = entries.filter((e) => this.picked.has(e.uuid));
    const est = estimateEncounter({ partyLevel, partySize, entries: chosen });
    const suggestions = suggestShips({
      partyLevel,
      partySize,
      threat: this.target,
      ships: Content.ships,
      currentXP: est.xp,
      limit: 10
    }).map((s) => ({ ...s, label: shipNameWithLevel(ct(s.name), s.level, levelShort()), faction: s.faction ? ct(s.faction) : "" }));
    const threatLabel = (r) => (r.threat === "minor" ? T("SF2eTSC.encounter.minor") : T(`SF2eTSC.encounter.${r.threat}`));
    const rate = (e) => {
      const r = rateEntry(e, { partyLevel, partySize, target: this.target });
      return { ...r, threatLabel: threatLabel(r), threatClass: `tsc-threat-${r.threat}` };
    };
    const hazardSuggestions = suggestHazards({
      partyLevel,
      partySize,
      threat: this.target,
      hazards: Content.hazards,
      currentXP: est.xp,
      limit: 10
    }).map((h) => ({
      ...h,
      label: shipNameWithLevel(ct(h.name), h.level, levelShort()),
      kindLabel: T(`SF2eTSC.encounter.${h.kind}`),
      rating: rate(h)
    }));
    const suggestionRows = suggestions.map((s) => ({ ...s, rating: rate({ kind: "ship", level: s.level }) }));
    const threats = THREAT_ORDER.map((t) => ({
      id: t,
      label: T(`SF2eTSC.encounter.${t}`),
      budget: est.budgets[t],
      active: t === this.target,
      current: t === est.threat
    }));
    return {
      partyLevel,
      partySize,
      auto: { level: autoLevel, size: autoSize },
      ship: ship?.name ?? "—",
      crew: pcs.map((p) => p.name).join(", "),
      small: est.small,
      est,
      threat: T(`SF2eTSC.encounter.${est.threat}`),
      beyond: est.beyond,
      threats,
      target: T(`SF2eTSC.encounter.${this.target}`),
      remaining: Math.max(0, est.budgets[this.target] - est.xp),
      suggestions: suggestionRows,
      hazardSuggestions,
      isGM: game.user.isGM,
      entries: entries.map((e) => ({
        ...e,
        kindLabel: T(`SF2eTSC.encounter.${e.kind}`),
        checked: this.picked.has(e.uuid),
        rating: rate(e)
      }))
    };
  }
  static #toggle(e, t) {
    const u = t.dataset.uuid;
    this.picked.has(u) ? this.picked.delete(u) : this.picked.add(u);
    this.render();
  }
  static #setThreat(e, t) {
    if (THREAT_ORDER.includes(t.dataset.threat)) this.target = t.dataset.threat;
    this.render();
  }
  static #adjust(e, t) {
    const d = Number(t.dataset.delta) || 0;
    if (t.dataset.field === "level") this.levelOverride = Math.max(1, Math.min(20, (this.levelOverride ?? Number(t.dataset.current)) + d));
    else if (t.dataset.field === "size") this.sizeOverride = Math.max(1, Math.min(8, (this.sizeOverride ?? Number(t.dataset.current)) + d));
    else {
      this.levelOverride = null;
      this.sizeOverride = null;
    }
    this.render();
  }
  static async #importHazard(e, t) {
    if (!game.user.isGM) return;
    const a = await Importer.createHazard(t.dataset.id);
    if (a?.uuid) this.picked.add(a.uuid);
    notifyInfo("SF2eTSC.encounter.importedHazard", { name: a?.name ?? t.dataset.id });
    this.render();
  }
  static async #importSuggestion(e, t) {
    if (!game.user.isGM) return;
    const count = Math.max(1, Number(t.dataset.count) || 1);
    for (let i = 0; i < count; i++) {
      const a = await Importer.createEnemyShip(t.dataset.id);
      if (a?.uuid) this.picked.add(a.uuid);
    }
    notifyInfo("SF2eTSC.encounter.imported", { count });
    this.render();
  }
}
