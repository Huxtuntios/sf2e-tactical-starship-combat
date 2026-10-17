import { parseZoneList } from "../combat/copies.mjs";
import { TscApp, tpl } from "./base-app.mjs";
import { allStarships, readStarship } from "../starship/starship-state.mjs";
import { startStarshipCombat } from "../combat/starship-combat.mjs";
import { isStarshipHazard } from "../hazards/hazard-engine.mjs";
import { moduleSetting, T } from "../utils/foundry.mjs";
import { notifyError } from "../utils/logging.mjs";
import { openDashboard } from "./launchers.mjs";
import { fromUuidSync_ } from "../utils/foundry.mjs";
import { combatantForActor } from "../combat/tsc-state.mjs";
import { occupantView } from "../crew/occupant.mjs";
import { ZONE_LIMITS, DETECTION_LEVELS } from "../constants.mjs";
import { listPresets, savePreset, deletePreset, normalizePreset, clampZones, DEFAULT_ZONES } from "../combat/presets.mjs";

import { OBJECT_TYPES } from "../sensor/object-types.mjs";
export { OBJECT_TYPES } from "../sensor/object-types.mjs";
const esc = (k) => String(k).replace(/\./g, "__DOT__");
const unesc = (k) => k.replace(/__DOT__/g, ".");

/** GM wizard: Presets -> Player Ship (+ start zone) -> Crew -> Zone count -> Enemy Ships -> Hazards -> Objects -> Start. */
export class StartCombatWizard extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-start",
    tag: "form",
    window: { title: "SF2eTSC.ui.startCombat", icon: "fa-solid fa-jet-fighter" },
    position: { width: 600, height: 720 },
    form: { handler: StartCombatWizard.#submit, closeOnSubmit: true },
    actions: {
      pickObjectArt: StartCombatWizard.#pickObjectArt,
      addObjRow: StartCombatWizard.#addObjRow,
      removeObjRow: StartCombatWizard.#removeObjRow,
      loadPreset: StartCombatWizard.#loadPreset,
      deletePreset: StartCombatWizard.#deletePreset,
      savePreset: StartCombatWizard.#savePreset
    }
  };
  static PARTS = { main: { template: tpl("start-wizard") } };
  async _prepareContext() {
    const ships = allStarships();
    const player = ships.filter((s) => ["player", "ally"].includes(readStarship(s).role));
    const enemies = ships.filter((s) => !["player"].includes(readStarship(s).role));
    const hazards = game.actors.filter((a) => isStarshipHazard(a));
    const combat = game.combat;
    const crewIds = new Set(player.flatMap((s) => readStarship(s).crew.map((c) => c.actorUuid)));
    const crewGroups = player.map((s, i) => {
      const d = readStarship(s);
      return {
        shipUuid: s.uuid,
        shipName: s.name,
        visible: i === 0,
        members: d.crew.map((c) => {
          const a = fromUuidSync_(c.actorUuid);
          const st = d.stations.find((x) => x.helmedBy === c.actorUuid);
          const inCombat = !!(a && combat && combatantForActor(combat, a));
          return {
            uuid: c.actorUuid,
            name: a?.name ?? c.name ?? "?",
            occupant: occupantView(c.actorUuid, { fallbackName: c.name }),
            missing: !a,
            observer: c.role === "observer",
            checked: !!a && c.role !== "observer",
            station: st?.name ?? null,
            inCombat
          };
        })
      };
    });
    const characters = game.actors.filter((a) => a.type === "character" && !crewIds.has(a.uuid));
    const zones = clampZones(moduleSetting("sensorMapSize") ?? DEFAULT_ZONES);
    return {
      player: player.map((s, i) => ({ uuid: s.uuid, name: s.name, checked: i === 0, level: readStarship(s).level, zone: 2 + i * 2 })),
      crewGroups,
      characters: characters.map((c) => ({ uuid: c.uuid, name: c.name, checked: false })),
      scope: T(`SF2eTSC.settings.crewInitiativeScope.${moduleSetting("crewInitiativeScope")}`),
      enemies: enemies.map((s, i) => ({ uuid: s.uuid, name: s.name, level: readStarship(s).level, zone: Math.max(1, zones - 1 - i * 2) })),
      hazards: hazards.map((h, i) => ({
        uuid: h.uuid,
        name: h.name,
        level: h.system.details.level.value,
        complex: !!h.system.details.isComplex,
        zone: Math.ceil(zones / 2) + i
      })),
      detectionLevels: DETECTION_LEVELS.map((id) => ({ id, label: T(`SF2eTSC.detection.${id}`) })),
      zones,
      zoneMin: ZONE_LIMITS.min,
      zoneMax: ZONE_LIMITS.max,
      midZone: Math.ceil(zones / 2),
      objectTypes: OBJECT_TYPES.map((t) => ({ id: t, label: T(`SF2eTSC.objectTypes.${t}`) })),
      presets: listPresets(),
      none: !player.length
    };
  }
  _onRender(context, options) {
    super._onRender?.(context, options);
    const sync = () =>
      this.element.querySelectorAll("[data-crew-group]").forEach((g) => {
        const box = this.element.querySelector(`input[name="ship.${g.dataset.crewGroup}"]`);
        g.hidden = !box?.checked;
        g.querySelectorAll("input[type=checkbox]").forEach((i) => {
          i.disabled = !box?.checked || i.dataset.locked === "true";
        });
      });
    this.element.querySelectorAll('input[name^="ship."]').forEach((i) => i.addEventListener("change", sync));
    this._syncCrew = sync;
    sync();
  }
  #addRow(o = {}) {
    const tplEl = this.element.querySelector("[data-obj-template]");
    const row = tplEl.content.firstElementChild.cloneNode(true);
    if (o.name) row.querySelector('[data-f="name"]').value = o.name;
    if (o.type) row.querySelector('[data-f="type"]').value = o.type;
    if (o.art) row.querySelector('[data-f="art"]').value = o.art;
    if (o.zone) row.querySelector('[data-f="zone"]').value = o.zone;
    this.element.querySelector("[data-obj-rows]").append(row);
  }
  static #pickObjectArt(event, target) {
    const input = target.closest(".tsc-obj-row")?.querySelector('[data-f="art"]');
    if (!input) return;
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "image",
      current: input.value,
      callback: (path) => {
        input.value = path;
      }
    }).render(true);
  }
  static #addObjRow() {
    this.#addRow();
  }
  static #removeObjRow(event, target) {
    target.closest(".tsc-obj-row")?.remove();
  }

  /** Reads the current form into a normalised start configuration (also used for presets). */
  #readConfig() {
    const el = this.element;
    const q = (s) => [...el.querySelectorAll(s)];
    const zoneOf = (prefix, k) => Number(el.querySelector(`input[name="${prefix}.${k}"]`)?.value) || undefined;
    const zonesOf = (prefix, k) => parseZoneList(el.querySelector(`input[name="${prefix}.${k}"]`)?.value);
    const checked = (prefix) =>
      q(`input[type=checkbox][name^="${prefix}."]`)
        .filter((i) => i.checked)
        .map((i) => i.name.slice(prefix.length + 1));
    const enemyDetection = el.querySelector('[name="enemyDetection"]')?.value || "observed";
    return normalizePreset({
      zones: el.querySelector('[name="zones"]')?.value,
      playerShips: checked("ship").map((k) => ({
        uuid: unesc(k),
        zone: zoneOf("shipZone", k),
        detection: el.querySelector(`[name="shipDetection.${k}"]`)?.value ?? "identified"
      })),
      enemies: checked("enemy").map((k) => ({
        uuid: unesc(k),
        zone: zoneOf("enemyZone", k),
        detection: el.querySelector(`[name="enemyDetection.${k}"]`)?.value ?? enemyDetection,
        count: zoneOf("enemyCount", k) ?? 1,
        zones: zonesOf("enemyZones", k)
      })),
      hazards: checked("hazard").map((k) => ({
        uuid: unesc(k),
        zone: zoneOf("hazardZone", k),
        count: zoneOf("hazardCount", k) ?? 1,
        zones: zonesOf("hazardZones", k)
      })),
      objects: q(".tsc-obj-row").map((r) => ({
        name: r.querySelector('[data-f="name"]').value.trim(),
        type: r.querySelector('[data-f="type"]').value,
        art: r.querySelector('[data-f="art"]').value,
        zone: Number(r.querySelector('[data-f="zone"]').value) || 1
      })),
      enemyDetection
    });
  }
  static async #savePreset() {
    const name = this.element.querySelector('[name="presetName"]')?.value?.trim();
    if (!name) return ui.notifications.warn(T("SF2eTSC.wizard.presetNameRequired"));
    const p = await savePreset({ ...this.#readConfig(), name });
    if (p) {
      ui.notifications.info(game.i18n.format("SF2eTSC.wizard.presetSaved", { name: p.name }));
      this.render();
    }
  }
  static async #deletePreset() {
    const id = this.element.querySelector('[name="presetPick"]')?.value;
    if (!id) return;
    await deletePreset(id);
    this.render();
  }
  static #loadPreset() {
    const id = this.element.querySelector('[name="presetPick"]')?.value;
    const p = listPresets().find((x) => x.id === id);
    if (!p) return;
    const el = this.element;
    const set = (name, v) => {
      const i = el.querySelector(`[name="${name}"]`);
      if (i) {
        if (i.type === "checkbox") i.checked = !!v;
        else i.value = v;
      }
    };
    el.querySelectorAll(
      'input[type=checkbox][name^="ship."], input[type=checkbox][name^="enemy."], input[type=checkbox][name^="hazard."]'
    ).forEach((i) => {
      i.checked = false;
    });
    el.querySelectorAll('input[name^="enemyCount."], input[name^="hazardCount."]').forEach((i) => {
      i.value = 1;
    });
    el.querySelectorAll('input[name^="enemyZones."], input[name^="hazardZones."]').forEach((i) => {
      i.value = "";
    });
    set("zones", p.zones);
    for (const s of p.playerShips) {
      set(`ship.${esc(s.uuid)}`, true);
      set(`shipDetection.${esc(s.uuid)}`, s.detection ?? "identified");
      if (s.zone) set(`shipZone.${esc(s.uuid)}`, s.zone);
    }
    for (const s of p.enemies) {
      set(`enemy.${esc(s.uuid)}`, true);
      set(`enemyDetection.${esc(s.uuid)}`, s.detection);
      if (s.zone) set(`enemyZone.${esc(s.uuid)}`, s.zone);
      set(`enemyCount.${esc(s.uuid)}`, s.count ?? 1);
      set(`enemyZones.${esc(s.uuid)}`, (s.zones ?? []).join(", "));
    }
    for (const s of p.hazards) {
      set(`hazard.${esc(s.uuid)}`, true);
      if (s.zone) set(`hazardZone.${esc(s.uuid)}`, s.zone);
      set(`hazardCount.${esc(s.uuid)}`, s.count ?? 1);
      set(`hazardZones.${esc(s.uuid)}`, (s.zones ?? []).join(", "));
    }
    set("enemyDetection", p.enemyDetection);
    el.querySelector("[data-obj-rows]").replaceChildren();
    for (const o of p.objects) this.#addRow(o);
    set("presetName", p.name);
    this._syncCrew?.();
    const missing = [...p.playerShips, ...p.enemies, ...p.hazards].filter((s) => !fromUuidSync_(s.uuid)).length;
    ui.notifications.info(
      game.i18n.format(missing ? "SF2eTSC.wizard.presetLoadedMissing" : "SF2eTSC.wizard.presetLoaded", { name: p.name, count: missing })
    );
  }
  static async #submit(event, form, formData) {
    const f = foundry.utils.expandObject(formData.object);
    const pick = (o) =>
      Object.entries(o ?? {})
        .filter(([, v]) => v === true || v === "on")
        .map(([k]) => k);
    const cfg = this.#readConfig();
    try {
      const playerShips = cfg.playerShips.map((s) => s.uuid);
      const positions = Object.fromEntries(cfg.playerShips.filter((s) => s.zone).map((s) => [s.uuid, Math.min(s.zone, cfg.zones)]));
      const chosen = new Set(pick(f.member).map(unesc));
      const excludeCrew = [];
      for (const uuid of playerShips) {
        const ship = fromUuidSync_(uuid);
        for (const c of ship ? readStarship(ship).crew : []) if (!chosen.has(c.actorUuid)) excludeCrew.push(c.actorUuid);
      }
      await startStarshipCombat({
        playerShips,
        positions,
        detections: Object.fromEntries(cfg.playerShips.map((s) => [s.uuid, s.detection])),
        crew: pick(f.crew).map(unesc),
        excludeCrew,
        zones: cfg.zones,
        enemies: cfg.enemies,
        hazards: cfg.hazards,
        objects: cfg.objects
      });
      await this.close().catch(() => null);
      await openDashboard();
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  }
}
