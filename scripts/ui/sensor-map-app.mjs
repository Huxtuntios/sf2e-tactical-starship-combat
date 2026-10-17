/**
 * Sensor Map (view). 0.8.1: rules live in ../sensor/map-model.mjs, GM handlers in ../sensor/map-handlers.mjs;
 * the window renders in three parts (bar | zones | detail) and refreshes only the affected ones.
 */
import { ZONE_LIMITS, HEADINGS, STATUS_STATES } from "../constants.mjs";
import { TscApp, tpl } from "./base-app.mjs";
import { Targeting } from "./targeting.mjs";
import { activeStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { viewFor, findObject } from "../engine/sensor-ops.mjs";
import { readStarship, statusOf, isStarship } from "../starship/starship-state.mjs";
import { computeShipStats } from "../starship/stats.mjs";
import { request } from "../socket.mjs";
import { T, moduleSetting, fromUuidSafe } from "../utils/foundry.mjs";
import { notifyWarn, notifyError } from "../utils/logging.mjs";
import { gmEditRequests } from "../sensor/gm-edit.mjs";
import { DETECTION_LEVELS } from "../constants.mjs";
import { calculateZoneDistance } from "../engine/range.mjs";
import { HazardEngine } from "../hazards/hazard-engine.mjs";
import { displayDesignation } from "../utils/designations.mjs";
import { ICONS, observerKeys, canMoveKey, sensorPartsFor } from "../sensor/map-model.mjs";
import { buildHudContext, runHudAction } from "./hud-model.mjs";
import { openCrewManager } from "./launchers.mjs";
import { paintMapAppearance } from "./map-appearance-render.mjs";
import { MapAppearanceApplication } from "./map-appearance-app.mjs";
import { normalizeMapAppearance, objectArtwork } from "../sensor/appearance.mjs";
import { objectTypeView, wireObjectType } from "./object-type-control.mjs";
import { can } from "../crew/permissions.mjs";

export { PLAYER_SENSOR_OPS, userControlsShip, canMoveKey, observerKeys, applySensorOp } from "../sensor/map-model.mjs";
export { registerSensorHandlers } from "../sensor/map-handlers.mjs";

/** "12/20" -> 60 (percent for the mini bars; null when the value is hidden from this user). */
const hpPct = (text) => {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? "");
  return m ? Math.round((Number(m[1]) / Math.max(1, Number(m[2]))) * 100) : null;
};

export class SensorMapApplication extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-sensor-map",
    classes: ["sf2e-tsc", "tsc-sensor-map"],
    window: { title: "SF2eTSC.ui.sensorMap", icon: "fa-solid fa-satellite", resizable: true },
    position: { width: 920, height: 520 },
    actions: {
      mapAppearance: SensorMapApplication.#appearance,
      objectArt: SensorMapApplication.#objectArt,
      selectObject: SensorMapApplication.#select,
      pickZone: SensorMapApplication.#pickZone,
      addObject: SensorMapApplication.#addObject,
      removeObj: SensorMapApplication.#remove,
      flipHeading: SensorMapApplication.#flip,
      moveLeft: SensorMapApplication.#moveLeft,
      moveRight: SensorMapApplication.#moveRight,
      setDetect: SensorMapApplication.#detect,
      openSheet: SensorMapApplication.#openSheet,
      triggerHazard: SensorMapApplication.#trigger,
      toggleHazard: SensorMapApplication.#toggleHazard,
      resizeZones: SensorMapApplication.#resize,
      toggleHidden: SensorMapApplication.#hidden,
      editZone: SensorMapApplication.#editZone,
      cancelTargeting: SensorMapApplication.#cancel,
      dockAct: SensorMapApplication.#dockAct,
      dockPick: SensorMapApplication.#dockPick,
      openCrew: () => openCrewManager()
    }
  };
  static PARTS = {
    bar: { template: tpl("sensor-map-bar") },
    zones: { template: tpl("sensor-map-zones") },
    detail: { template: tpl("sensor-map-detail") },
    dock: { template: tpl("sensor-map-dock") }
  };
  channels = ["combat", "actor", "targeting", "settings", "crew"];
  selected = null;
  dockIndex = 0;
  gmToolsOpen = false;
  wants(channel, doc) {
    return this.channels.includes(channel);
  }
  /** partial refresh — only the parts a channel affects are re-rendered (null = all). */
  partsFor(channel) {
    return sensorPartsFor(channel);
  }

  async _prepareContext() {
    const combat = activeStarshipCombat();
    const isGM = game.user.isGM;
    if (!combat) return { noCombat: true, isGM };
    const tsc = getTsc(combat);
    const own = observerKeys(tsc, game.user);
    const view = viewFor(tsc, { isGM, observerKeys: own, ownKeys: own, showUnknown: moduleSetting("showUnknownContacts") });
    const zones = [];
    for (let z = 1; z <= tsc.zones; z++) {
      const info = tsc.zoneInfo?.[z] ?? {};
      const objs = view.filter((o) => o.zone === z).map((o) => this.#decorate(o, tsc, combat));
      zones.push({
        zone: z,
        label: String(z).padStart(2, "0"),
        objects: objs,
        cover: !!info.cover,
        concealment: !!info.concealment,
        special: info.special ?? "",
        publicNotes: info.publicNotes ?? "",
        gmNotes: isGM ? (info.gmNotes ?? "") : "",
        hasNotes: !!(info.publicNotes || (isGM && info.gmNotes)),
        crowded: objs.length > 1
      });
    }
    const sel = this.selected ? view.find((o) => o.key === this.selected) : null;
    const t = Targeting.current;
    return {
      isGM,
      combat: { round: combat.round, turn: combat.combatant?.name ?? "—" },
      zoneCount: tsc.zones,
      zones,
      targeting: t ? { label: t.label, range: t.range, hint: T("SF2eTSC.ui.pickTarget") } : null,
      detail: sel ? await this.#detail(sel, tsc, isGM) : null,
      preview: this.#preview(tsc),
      zoneOptions: [12, 15].concat(ZONE_LIMITS.default === 12 ? [] : []),
      detectionLevels: DETECTION_LEVELS.map((l) => ({ id: l, label: T(`SF2eTSC.detection.${l}`) })),
      log: tsc.log
        .slice(-6)
        .reverse()
        .map((l) => l.text),
      movableKeys: tsc.objects.filter((o) => canMoveKey(game.user, tsc, o.key)).map((o) => o.key),
      appearance: normalizeMapAppearance(tsc.appearance),
      combatId: combat.id,
      dock: buildHudContext(this.dockIndex),
      gmToolsOpen: this.gmToolsOpen
    };
  }

  #decorate(o, tsc, combat) {
    const actor = o.type === "starship" && o.known ? fromUuidSync(o.actorUuid ?? o.key) : null;
    let status = "operational",
      hp = null,
      sp = null;
    if (actor && isStarship(actor)) {
      const d = readStarship(actor);
      status = statusOf(d);
      if (game.user.isGM || o.known) {
        hp = `${d.hp.value}/${d.hp.max}`;
        sp = `${d.sp.value}/${d.sp.max}`;
      }
    }
    const cls = Targeting.current ? Targeting.classify(tsc, o) : null;
    const isCurrent = combat.combatant?.actorId && actor?.id === combat.combatant.actorId;
    return {
      key: o.key,
      label: displayDesignation(o.label),
      icon: o.icon ?? ICONS[o.type] ?? "◆",
      art: objectArtwork(o, tsc.appearance, (uuid) => fromUuidSync(uuid)),
      type: o.type,
      heading: o.heading,
      arrow: o.heading === "left" ? "←" : o.heading === "right" ? "→" : "",
      status,
      statusLabel: T(`SF2eTSC.status.${status}`),
      hp,
      sp,
      hpPct: hpPct(hp),
      spPct: hpPct(sp),
      selected: this.selected === o.key,
      target: cls?.status ?? null,
      targetLabel: cls ? T(`SF2eTSC.targeting.${cls.status}`) : null,
      current: !!isCurrent,
      hiddenObj: !!o.hidden,
      level: o.level
    };
  }

  async #detail(sel, tsc, isGM) {
    const obj = findObject(tsc, sel.key);
    const actor = sel.type === "starship" && sel.known ? await fromUuidSafe(obj.actorUuid ?? obj.key) : null;
    const d = actor && isStarship(actor) ? readStarship(actor) : null;
    const stats = d ? computeShipStats(actor) : null;
    const rows = [{ k: T("SF2eTSC.ui.zone"), v: sel.zone }];
    if (sel.known) rows.push({ k: T("SF2eTSC.ui.type"), v: T(`SF2eTSC.objectTypes.${sel.type}`) });
    if (sel.heading) rows.push({ k: T("SF2eTSC.ui.heading"), v: T(`SF2eTSC.heading.${sel.heading}`) });
    if (d && (isGM || sel.known))
      rows.push(
        { k: T("SF2eTSC.ui.level"), v: d.level },
        { k: T("SF2eTSC.ui.hullPoints"), v: `${d.hp.value}/${d.hp.max}` },
        { k: T("SF2eTSC.ui.shieldPoints"), v: `${d.sp.value}/${d.sp.max}` },
        { k: T("SF2eTSC.ui.ac"), v: stats.ac },
        { k: T("SF2eTSC.ui.status"), v: T(`SF2eTSC.status.${statusOf(d)}`) }
      );
    if (isGM && d?.compromised) rows.push({ k: T("SF2eTSC.ui.compromised"), v: d.compromised });
    const hs = tsc.hazardState?.[sel.key];
    // current Hull / Shield Points: GM and the ship's crew (adjustVitals); the server re-checks every change
    const vitals =
      d && (isGM || can(game.user, actor, "adjustVitals"))
        ? { shipUuid: actor.uuid, hp: d.hp.value, hpMax: d.hp.max, sp: d.sp.value, spMax: d.sp.max }
        : null;
    const gm =
      isGM && d
        ? {
            shipUuid: actor.uuid,
            heading: sel.heading ?? null,
            headings: sel.heading ? HEADINGS.map((h) => ({ id: h, label: T(`SF2eTSC.heading.${h}`), active: h === sel.heading })) : [],
            statuses: STATUS_STATES.map((s) => ({ id: s, label: T(`SF2eTSC.status.${s}`), active: s === statusOf(d) }))
          }
        : null;
    return {
      gm,
      typeOptions: objectTypeView(sel, isGM),
      vitals,
      canMove: canMoveKey(game.user, tsc, sel.key),
      key: sel.key,
      label: displayDesignation(sel.label),
      type: sel.type,
      known: sel.known,
      rows,
      isHazard: sel.type === "hazard",
      hazardDisabled: !!hs?.disabled,
      canOpen: !!actor && (isGM || actor.testUserPermission?.(game.user, "OBSERVER")),
      level: sel.level,
      detection: isGM
        ? DETECTION_LEVELS.map((l) => ({ id: l, label: T(`SF2eTSC.detection.${l}`), active: (obj.detection?.party ?? "undetected") === l }))
        : null,
      hidden: !!obj.hidden
    };
  }

  /** GM quick edit (HP, SP, heading, status) in the detail panel; each input is wired once. */
  #wireGmEdit() {
    this.element.querySelectorAll("[data-gm-ship]").forEach((el) => {
      if (el.dataset.tscGm) return;
      el.dataset.tscGm = "1";
      el.addEventListener("change", async () => {
        try {
          const reqs = gmEditRequests({
            field: el.dataset.gmShip,
            value: el.value,
            shipUuid: el.dataset.ship,
            key: el.dataset.key,
            current: el.dataset.current,
            max: el.dataset.max,
            combatId: activeStarshipCombat()?.id
          });
          for (const r of reqs) await request(r.name, r.payload);
        } catch (err) {
          notifyError("SF2eTSC.errors.generic", { message: err.message });
        }
      });
    });
  }

  #paintPreview() {
    const span = this.element?.querySelector?.("[data-tsc-preview]");
    if (!span) return;
    const c = activeStarshipCombat();
    const p = c ? this.#preview(getTsc(c)) : null;
    if (!p) {
      span.hidden = true;
      span.textContent = "";
      return;
    }
    span.hidden = false;
    span.classList.toggle("ok", p.valid);
    span.classList.toggle("bad", !p.valid);
    span.textContent = `${T("SF2eTSC.ui.origin")}: ${p.origin} · ${T("SF2eTSC.ui.target")}: ${p.target} · ${T("SF2eTSC.ui.range")}: ${p.distance}/${p.weaponRange} · ${p.status}`;
  }

  #preview(tsc) {
    const t = Targeting.current;
    if (!t || !this._hover) return null;
    const me = findObject(tsc, t.shipUuid),
      to = findObject(tsc, this._hover);
    if (!me || !to) return null;
    const cls = Targeting.classify(tsc, to);
    return {
      origin: me.zone,
      target: to.zone,
      distance: calculateZoneDistance(me.zone, to.zone),
      weaponRange: t.range,
      status: T(`SF2eTSC.targeting.${cls.status}`),
      valid: ["valid", "same-zone"].includes(cls.status)
    };
  }

  async _preRender(context, options) {
    await super._preRender?.(context, options);
    const z = this.element?.querySelector?.(".tsc-zones");
    if (z) this._scroll = { left: z.scrollLeft, top: z.scrollTop, win: this.element.querySelector(".window-content")?.scrollTop ?? 0 };
  }

  #restoreScroll() {
    const z = this.element.querySelector(".tsc-zones");
    if (!z) return;
    if (this._scroll) {
      z.scrollLeft = this._scroll.left;
      z.scrollTop = this._scroll.top;
      const wc = this.element.querySelector(".window-content");
      if (wc) wc.scrollTop = this._scroll.win;
    } else this.element.querySelector(".tsc-obj.current")?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }

  #wireDragDrop(context) {
    if (!context.combatId) return;
    const movable = new Set(context.movableKeys ?? []);
    this.element.querySelectorAll(".tsc-obj[data-object-key]").forEach((el) => {
      if (el.dataset.tscDrag || !movable.has(el.dataset.objectKey)) return;
      el.dataset.tscDrag = "1";
      el.draggable = true;
      el.classList.add("tsc-draggable");
      el.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ tscKey: el.dataset.objectKey }));
        ev.dataTransfer.effectAllowed = "move";
      });
    });
    this.element.querySelectorAll(".tsc-zone[data-zone]").forEach((zone) => {
      if (zone.dataset.tscDrop) return;
      zone.dataset.tscDrop = "1"; // wired once per rendered element (partial renders)
      zone.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        zone.classList.add("tsc-drop");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("tsc-drop"));
      zone.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        zone.classList.remove("tsc-drop");
        let data;
        try {
          data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        } catch {
          return;
        }
        if (!data?.tscKey || !movable.has(data.tscKey)) return;
        try {
          await request("sensorUpdate", { op: "move", combatId: context.combatId, key: data.tscKey, zone: Number(zone.dataset.zone) });
        } catch (err) {
          notifyWarn("SF2eTSC.errors.generic", { message: err.message });
        }
      });
    });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    paintMapAppearance(this.element, context);
    wireObjectType(this.element, context.combatId);
    this.#wireGmEdit();
    this.element.querySelectorAll("details.tsc-gm-tools").forEach((d) => {
      if (d.dataset.tscToggle) return;
      d.dataset.tscToggle = "1";
      d.addEventListener("toggle", () => {
        this.gmToolsOpen = d.open;
      });
    });
    this.element.querySelectorAll("[data-object-key]").forEach((el) => {
      if (el.dataset.tscHover) return;
      el.dataset.tscHover = "1";
      // update only the preview text. A full re-render on hover replaced the button under the cursor
      // between mousedown and mouseup, so the click (= target pick) never reached the action handler.
      el.addEventListener("mouseenter", () => {
        if (Targeting.current) {
          this._hover = el.dataset.objectKey;
          this.#paintPreview();
        }
      });
    });
    this.element.setAttribute("data-orientation", "horizontal");
    if (!this.element.dataset.tscEsc) {
      this.element.dataset.tscEsc = "1";
      this.element.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && Targeting.current) {
          ev.stopPropagation();
          Targeting.end();
        }
      });
    }
    this.#wireDragDrop(context);
    if (!options?.parts || options.parts.includes("zones")) this.#restoreScroll();
    if (Targeting.current && this._hover) this.#paintPreview();
  }

  /* ---------------------------------------------------------------- actions */
  static #select(event, target) {
    const key = target.dataset.objectKey;
    if (Targeting.current) return Targeting.pick(key, getTsc(activeStarshipCombat()));
    this.selected = this.selected === key ? null : key;
    this.render({ parts: sensorPartsFor("select") });
  }
  static #pickZone(event, target) {
    if (Targeting.current?.zonePick) Targeting.current.onPickZone?.(Number(target.dataset.zone));
  }
  static #appearance() {
    const c = activeStarshipCombat();
    if (game.user.isGM && c) return new MapAppearanceApplication(c).render(true);
  }
  static #objectArt(event, target) {
    const c = activeStarshipCombat();
    if (game.user.isGM && c) return new MapAppearanceApplication(c, target.dataset.key).render(true);
  }
  static #cancel() {
    Targeting.end();
  }
  static async #dockAct(event, target) {
    await runHudAction(this.dockIndex, target.dataset.actionId);
  }
  static #dockPick(event, target) {
    this.dockIndex = Number(target.dataset.index);
    this.render({ parts: ["dock"] });
  }
  static async #resize() {
    const c = activeStarshipCombat();
    const v = await foundry.applications.api.DialogV2.prompt({
      window: { title: T("SF2eTSC.ui.zoneCount") },
      content: `<div class="form-group"><label>${T("SF2eTSC.ui.zoneCount")}</label><input type="number" name="zones" min="${ZONE_LIMITS.min}" max="${ZONE_LIMITS.max}" value="${getTsc(c).zones || 12}"></div>`,
      ok: { callback: (e, b) => Number(new foundry.applications.ux.FormDataExtended(b.form).object.zones) },
      rejectClose: false
    }).catch(() => null);
    if (v)
      await request("sensorUpdate", {
        op: "resize",
        combatId: c.id,
        zones: Math.min(Math.max(Math.round(v), ZONE_LIMITS.min), ZONE_LIMITS.max)
      });
  }
  static async #addObject() {
    const c = activeStarshipCombat();
    const types = ["asteroid", "station", "debris", "beacon", "planet", "custom"]
      .map((t) => `<option value="${t}">${T(`SF2eTSC.objectTypes.${t}`)}</option>`)
      .join("");
    const data = await foundry.applications.api.DialogV2.prompt({
      window: { title: T("SF2eTSC.ui.addObject") },
      content: `<div class="form-group"><label>${T("SF2eTSC.ui.name")}</label><input name="name" type="text"></div><div class="form-group"><label>${T("SF2eTSC.ui.type")}</label><select name="type">${types}</select></div><div class="form-group"><label>${T("SF2eTSC.ui.zone")}</label><input name="zone" type="number" min="1" value="1"></div>`,
      ok: { callback: (e, b) => new foundry.applications.ux.FormDataExtended(b.form).object },
      rejectClose: false
    }).catch(() => null);
    if (data?.name)
      await request("sensorUpdate", {
        op: "add",
        combatId: c.id,
        object: {
          key: foundry.utils.randomID(10),
          name: data.name,
          type: data.type,
          zone: Number(data.zone) || 1,
          heading: null,
          detection: { party: "observed" }
        }
      });
  }
  static async #remove(e, t) {
    await request("sensorUpdate", { op: "remove", combatId: activeStarshipCombat().id, key: t.dataset.key });
    this.selected = null;
    this.render({ parts: sensorPartsFor("select") });
  }
  static async #flip(e, t) {
    await request("sensorUpdate", { op: "flip", combatId: activeStarshipCombat().id, key: t.dataset.key });
  }
  static async #moveLeft(e, t) {
    await request("sensorUpdate", { op: "shift", combatId: activeStarshipCombat().id, key: t.dataset.key, by: -1 });
  }
  static async #moveRight(e, t) {
    await request("sensorUpdate", { op: "shift", combatId: activeStarshipCombat().id, key: t.dataset.key, by: 1 });
  }
  static async #detect(e, t) {
    await request("sensorUpdate", { op: "detect", combatId: activeStarshipCombat().id, key: t.dataset.key, level: t.dataset.level });
  }
  static async #hidden(e, t) {
    await request("sensorUpdate", { op: "hidden", combatId: activeStarshipCombat().id, key: t.dataset.key });
  }
  static async #openSheet(e, t) {
    const a = await fromUuidSafe(t.dataset.key);
    a?.sheet.render(true);
  }
  static async #trigger(e, t) {
    await HazardEngine.trigger(t.dataset.key, { reason: T("SF2eTSC.hazards.manualTrigger") });
  }
  static async #toggleHazard(e, t) {
    const c = activeStarshipCombat();
    const hs = getTsc(c).hazardState?.[t.dataset.key];
    hs?.disabled ? await HazardEngine.enable(t.dataset.key) : await HazardEngine.disable(t.dataset.key, "disable");
  }
  static async #editZone(e, t) {
    const c = activeStarshipCombat();
    const zone = Number(t.dataset.zone);
    const info = getTsc(c).zoneInfo?.[zone] ?? {};
    const data = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${T("SF2eTSC.ui.zone")} ${zone}` },
      content: `<div class="form-group"><label>${T("SF2eTSC.ui.cover")}</label><input type="checkbox" name="cover" ${info.cover ? "checked" : ""}></div><div class="form-group"><label>${T("SF2eTSC.ui.concealment")}</label><input type="checkbox" name="concealment" ${info.concealment ? "checked" : ""}></div><div class="form-group"><label>${T("SF2eTSC.ui.specialEffect")}</label><input type="text" name="special" value="${foundry.utils.escapeHTML(info.special ?? "")}"></div><div class="form-group"><label>${T("SF2eTSC.ui.publicNotes")}</label><textarea name="publicNotes">${foundry.utils.escapeHTML(info.publicNotes ?? "")}</textarea></div><div class="form-group"><label>${T("SF2eTSC.ui.gmNotes")}</label><textarea name="gmNotes">${foundry.utils.escapeHTML(info.gmNotes ?? "")}</textarea></div>`,
      ok: { callback: (ev, b) => new foundry.applications.ux.FormDataExtended(b.form).object },
      rejectClose: false
    }).catch(() => null);
    if (data) await request("sensorUpdate", { op: "zoneInfo", combatId: c.id, zone, info: data });
  }
}
