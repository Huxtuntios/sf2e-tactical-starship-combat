import { privateContacts, changePrivateContact, addPrivateCustom, recoverPrivateReveals } from "../sensor/private-contacts.mjs";
import { LEGACY_ENVIRONMENT_TYPES } from "../sensor/environment-object-names.mjs";
import { legacyEnvironmentObjectDialogContent, submitLegacyEnvironmentObject } from "./legacy-environment-object-dialog.mjs";
import { ZONE_LIMITS, HEADINGS, STATUS_STATES, MODULE_ID } from "../constants.mjs";
import { TscApp, tpl } from "./base-app.mjs";
import { Targeting, pickSensorMapObject, preserveHoveredObject, registerNativeTargeting } from "./targeting.mjs";
import { targetingState } from "../engine/target-rules.mjs";
import { activeStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { viewFor, findObject } from "../engine/sensor-ops.mjs";
import { readStarship, statusOf, isStarship } from "../starship/starship-state.mjs";
import { MapActorCache } from "../sensor/map-actor-cache.mjs";
import { Content } from "../content/loader.mjs";
import { openApps, refreshApps } from "./base-app.mjs";
import { releaseMapBackground } from "./map-background.mjs";
import { request } from "../socket.mjs";
import { T, fromUuidSafe, isActiveGM } from "../utils/foundry.mjs";
import { resolveSensorActor, resolveSensorActorSync } from "../sensor/map-object.mjs";
import { notifyError } from "../utils/logging.mjs";
import { wireSensorMapDragDrop } from "./sensor-drop-ui.mjs";
import { SensorContactEditor } from "./sensor-contact-editor.mjs";
import { setPrivateContactZone } from "../sensor/contact-service.mjs";
import { gmEditRequests } from "../sensor/gm-edit.mjs";
import { DETECTION_LEVELS } from "../constants.mjs";
import { calculateZoneDistance } from "../engine/range.mjs";
import { HazardEngine } from "../hazards/hazard-engine.mjs";
import { displayDesignation } from "../utils/designations.mjs";
import { ICONS, observerKeys, canMoveKey, sensorPartsFor, sensorRangePresentation } from "../sensor/map-model.mjs";
import { buildGmHudContext, buildHudContext, runGmHudAction, runHudAction } from "./hud-model.mjs";
import { sendActionDescription, showActionDescription, showActionWarning } from "./action-controls.mjs";
import { openCrewManager } from "./launchers.mjs";
import { paintMapAppearance } from "./map-appearance-render.mjs";
import { MapAppearanceApplication } from "./map-appearance-app.mjs";
import { normalizeMapAppearance, safeImagePath, resolveArrowAppearance, visualTransform } from "../sensor/appearance.mjs";
import { objectTypeView, wireObjectType } from "./object-type-control.mjs";
import { can } from "../crew/permissions.mjs";
import { registerSensorHandlers as registerBaseSensorHandlers } from "../sensor/map-handlers.mjs";
import { gmActionSelection, openGmEffectManager, selectGmActionObject, wireGmActionObject } from "./sensor-gm-ui.mjs";

export { PLAYER_SENSOR_OPS, userControlsShip, canMoveKey, observerKeys, applySensorOp } from "../sensor/map-model.mjs";

const SENSOR_CACHE_INVALIDATE = "sf2e-tactical-starship-combat.invalidateSensorMapActors";
let rangeHooksRegistered = false;

export function registerSensorHandlers() {
  registerBaseSensorHandlers();
  registerNativeTargeting();
  if (rangeHooksRegistered) return;
  rangeHooksRegistered = true;
  const parentActor = (parent) =>
    parent?.documentName === "Actor" ? parent : parent?.parent?.documentName === "Actor" ? parent.parent : null;
  const refresh = (parent) => {
    const actor = parentActor(parent);
    if (!actor) return;
    invalidateSensorMapActors(actor);
    refreshApps("actor", actor);
  };
  for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, (item) => refresh(item?.parent));
  for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"])
    Hooks.on(hook, (effect) => refresh(effect?.parent));
}

/** Include instances still preparing their first render; refresh stays debounced and part-merged. */
export function invalidateSensorMapActors(actor = null) {
  Hooks.callAll(SENSOR_CACHE_INVALIDATE, actor);
  refreshApps("sensor-cache", actor);
}

/** Explicit same-URL image-content refresh; source paths remain untouched. */
export function invalidateSensorMapBackground() {
  for (const app of openApps(SensorMapApplication)) app.invalidateBackground();
  refreshApps("combat");
}

/** "12/20" -> 60 (percent for the mini bars; null when the value is hidden from this user). */
const hpPct = (text) => {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? "");
  return m ? Math.round((Number(m[1]) / Math.max(1, Number(m[2]))) * 100) : null;
};

const guardPrivate = (fn) =>
  async function (...args) {
    try {
      return await fn.apply(this, args);
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  };

export class SensorMapApplication extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-sensor-map",
    classes: ["sf2e-tsc", "tsc-sensor-map"],
    window: { title: "SF2eTSC.ui.sensorMap", icon: "fa-solid fa-satellite", resizable: true },
    position: { width: 920, height: 520 },
    actions: {
      privateMove: guardPrivate(SensorMapApplication.#privateMove),
      privateRemove: guardPrivate(SensorMapApplication.#privateRemove),
      privateReveal: guardPrivate(SensorMapApplication.#privateReveal),
      privateOpen: guardPrivate(SensorMapApplication.#privateOpen),
      privateDetect: guardPrivate(SensorMapApplication.#privateDetect),
      privateRename: guardPrivate(SensorMapApplication.#privateRename),
      mapAppearance: SensorMapApplication.#appearance,
      objectArt: SensorMapApplication.#objectArt,
      selectObject: SensorMapApplication.#select,
      selectActionObject: SensorMapApplication.#selectActionObject,
      pickZone: SensorMapApplication.#pickZone,
      addObject: SensorMapApplication.#addContact,
      addPublicObject: SensorMapApplication.#addObject,
      mineOpenShip: guardPrivate(SensorMapApplication.#mineOpenShip),
      mineDetonate: guardPrivate(SensorMapApplication.#mineDetonate),
      mineSync: guardPrivate(SensorMapApplication.#mineSync),
      removeObj: SensorMapApplication.#remove,
      flipHeading: SensorMapApplication.#flip,
      moveLeft: SensorMapApplication.#moveLeft,
      moveRight: SensorMapApplication.#moveRight,
      setDetect: SensorMapApplication.#detect,
      openSheet: SensorMapApplication.#openSheet,
      manageEffects: openGmEffectManager,
      triggerHazard: SensorMapApplication.#trigger,
      toggleHazard: SensorMapApplication.#toggleHazard,
      resizeZones: SensorMapApplication.#resize,
      toggleRanges: SensorMapApplication.#toggleRanges,
      toggleHidden: SensorMapApplication.#hidden,
      editZone: SensorMapApplication.#editZone,
      cancelTargeting: SensorMapApplication.#cancel,
      executeTargeting: SensorMapApplication.#executeTargeting,
      dockAct: SensorMapApplication.#dockAct,
      describeAction: showActionDescription,
      sendActionDescription,
      actionWarning: showActionWarning,
      dockPick: SensorMapApplication.#dockPick,
      openCrew: () => openCrewManager(),
      addInitiative: guardPrivate(SensorMapApplication.#addInitiative),
      addAllNpcInitiative: guardPrivate(SensorMapApplication.#addAllNpcInitiative),
      recoverReveals: guardPrivate(SensorMapApplication.#recoverReveals)
    }
  };
  static PARTS = {
    bar: { template: tpl("sensor-map-bar") },
    zones: { template: tpl("sensor-map-zones") },
    detail: { template: tpl("sensor-map-detail") },
    dock: { template: tpl("sensor-map-dock") }
  };
  channels = ["combat", "actor", "targeting", "settings", "crew", "sensor-cache"];
  actorCache = new MapActorCache();
  backgroundRevision = 0;
  invalidateActorCache(actor = null) {
    this.actorCache.invalidate(actor);
    this._mapPermissions = null;
  }
  invalidateBackground() {
    this.backgroundRevision = Math.max(Date.now(), this.backgroundRevision + 1);
  }
  _cleanup() {
    if (this._actorCacheHook != null) Hooks.off(SENSOR_CACHE_INVALIDATE, this._actorCacheHook);
    this._actorCacheHook = null;
    this.actorCache.dispose();
    this._mapPermissions = this._catalog = null;
    if (Targeting.hoverKey === this._hover) Targeting.hoverKey = null;
    this._hover = null;
    releaseMapBackground(this._backgroundLayer);
    this._backgroundLayer = null;
    super._cleanup?.();
  }
  selected = null;
  actionObjectKey = null;
  showRanges = true;
  dockIndex = 0;
  gmToolsOpen = false;
  wants(channel, doc) {
    if (channel === "settings") this.invalidateActorCache();
    return this.channels.includes(channel);
  }
  /** partial refresh — only the parts a channel affects are re-rendered (null = all). */
  partsFor(channel) {
    return sensorPartsFor(channel === "sensor-cache" ? "actor" : channel);
  }

  async _prepareContext(options = {}) {
    this._actorCacheHook ??= Hooks.on(SENSOR_CACHE_INVALIDATE, (actor) => this.invalidateActorCache(actor));
    const combat = activeStarshipCombat();
    const isGM = game.user.isGM;
    if (!combat) {
      this.actionObjectKey = null;
      this.actorCache.setVisible([], game.user);
      return {
        noCombat: true,
        isGM,
        actionObjects: isGM ? [] : undefined,
        actionSelection: null,
        rangeMode: isGM ? "gm" : "player",
        showRanges: this.showRanges,
        sensorRanges: [],
        backgroundRevision: this.backgroundRevision
      };
    }
    const catalog = [Content.stations, Content.upgrades, Content.stations.size, Content.upgrades.size];
    if (this._catalog?.some((value, i) => value !== catalog[i])) this.invalidateActorCache();
    this._catalog = catalog;
    const includes = (part) => !options.parts || options.parts.includes(part);
    const publicState = getTsc(combat);
    let privateObjects = [];
    let pendingRevealCount = 0;
    if (isGM) {
      try {
        const contacts = privateContacts(combat.id);
        pendingRevealCount = contacts.filter((contact) => contact.pendingReveal).length;
        privateObjects = contacts.filter(
          (o) =>
            !publicState.objects.some(
              (p) => !p.tscPrivateProjection && (o.actorUuid ? p.actorUuid === o.actorUuid || p.key === o.actorUuid : p.key === o.key)
            )
        );
      } catch (err) {
        notifyError("SF2eTSC.errors.generic", { message: err.message });
      }
    }
    this._privateObjects = privateObjects;
    const tsc = isGM
      ? { ...publicState, objects: [...publicState.objects.filter((o) => !privateObjects.some((p) => p.key === o.key)), ...privateObjects] }
      : publicState;
    const permissionKey = JSON.stringify([
      game.user.id,
      isGM,
      game.user.role,
      tsc.objects.map((o) => [o.key, o.actorUuid, o.type, !!o.mineRef])
    ]);
    if (this._mapPermissions?.key !== permissionKey) {
      this._mapPermissions = {
        key: permissionKey,
        own: observerKeys(tsc, game.user),
        movable: tsc.objects.filter((o) => (isGM ? !o.mineRef : canMoveKey(game.user, tsc, o.key))).map((o) => o.key)
      };
    }
    const permissions = this._mapPermissions;
    const own = permissions.own;
    const view = viewFor(tsc, {
      isGM,
      observerKeys: own,
      ownKeys: own,
      resolve: (uuid) => resolveSensorActorSync(combat, uuid)
    });
    const { actionObjects, actionSelection, actionObjectKey } = gmActionSelection(view, this.actionObjectKey, isGM);
    this.actionObjectKey = actionObjectKey;
    this.actorCache.setVisible(view, game.user);
    const resolved = new Map();
    if (includes("zones") || includes("detail")) {
      const unresolved = [...this.actorCache.active].some((uuid) => !this.actorCache.entries.get(uuid)?.actor);
      const entries = await Promise.all([...this.actorCache.active].map((uuid) => this.actorCache.get(uuid)));
      for (const entry of entries) if (this.actorCache.current(entry)) resolved.set(entry.uuid, entry);
      if (unresolved) this._mapPermissions = null;
    }
    const t = Targeting.current;
    const targetedKeys = new Set(Targeting.targetUUIDs());
    const targetTsc = t ? targetingState(publicState, t.shipUuid, privateObjects) : null;
    const appearance = normalizeMapAppearance(tsc.appearance);
    const arrows = new Map([["", resolveArrowAppearance(appearance)]]);
    const rangePresentation = sensorRangePresentation(tsc, {
      isGM,
      observerKeys: own,
      resolve: (uuid) => resolved.get(uuid)?.actor ?? resolveSensorActorSync(combat, uuid),
      showRanges: this.showRanges
    });
    const zones = [];
    for (let z = 1; includes("zones") && z <= tsc.zones; z++) {
      const info = tsc.zoneInfo?.[z] ?? {};
      const objs = view
        .filter((o) => o.zone === z)
        .map((o) => this.#decorate(o, targetTsc, targetedKeys, combat, resolved, appearance, arrows));
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
        outsideRange: rangePresentation.zones[z - 1]?.outsideRange ?? false,
        crowded: objs.length > 1
      });
    }
    const sel = this.selected ? view.find((o) => o.key === this.selected) : null;
    return {
      isGM,
      actionObjects,
      actionSelection,
      rangeMode: rangePresentation.rangeMode,
      showRanges: this.showRanges,
      sensorRanges: rangePresentation.ranges,
      combat: { round: combat.round, turn: combat.combatant?.name ?? "—" },
      zoneCount: tsc.zones,
      zones,
      targeting: t ? { label: t.label, range: t.range, hint: T("SF2eTSC.ui.pickTarget") } : null,
      detail: includes("detail") && sel ? this.#detail(sel, tsc, isGM, resolved, permissions.movable) : null,
      preview: this.#preview(targetTsc ?? tsc),
      zoneOptions: [12, 15].concat(ZONE_LIMITS.default === 12 ? [] : []),
      detectionLevels: DETECTION_LEVELS.map((l) => ({ id: l, label: T(`SF2eTSC.detection.${l}`) })),
      log: tsc.log
        .slice(-6)
        .reverse()
        .map((l) => l.text),
      privateKeys: privateObjects.map((o) => o.key),
      pendingRevealCount,
      movableKeys: permissions.movable,
      appearance,
      backgroundRevision: this.backgroundRevision,
      combatId: combat.id,
      dock: includes("dock")
        ? actionSelection
          ? await buildGmHudContext(this.actionObjectKey)
          : buildHudContext(this.dockIndex)
        : undefined,
      gmToolsOpen: this.gmToolsOpen
    };
  }

  #decorate(o, targetTsc, targetedKeys, combat, resolved, appearance, arrows) {
    const entry = o.known ? resolved.get(o.actorUuid ?? o.key) : null;
    const actor = o.fullDetails && o.type === "starship" ? entry?.actor : null;
    let status = o.fullDetails ? "operational" : null,
      hp = null,
      sp = null;
    const d = actor ? this.actorCache.data(entry) : null;
    if (d) {
      status = statusOf(d);
      hp = `${d.hp.value}/${d.hp.max}`;
      sp = `${d.sp.value}/${d.sp.max}`;
    }
    const arrowKey = o.arrowAppearance ? JSON.stringify(o.arrowAppearance) : "";
    if (!arrows.has(arrowKey)) arrows.set(arrowKey, resolveArrowAppearance(appearance, o.arrowAppearance));
    const arrowAppearance = arrows.get(arrowKey);
    const transform = visualTransform(o.mapTransform, o.heading, appearance.autoMirror, o.autoMirrorOverride);
    const cls = targetTsc ? Targeting.classify(targetTsc, o) : null;
    const currentMapKey = combat.combatant?.flags?.[MODULE_ID]?.sensorMapObject?.key;
    const isCurrent = (combat.combatant?.actorId && actor?.id === combat.combatant.actorId) || (currentMapKey && currentMapKey === o.key);
    const targeted = targetedKeys.has(o.key) || targetedKeys.has(o.actorUuid);
    return {
      key: o.key,
      label: displayDesignation(o.label),
      icon: o.icon ?? ICONS[o.type] ?? "◆",
      art: appearance.mode !== "simple" ? safeImagePath(o.art) || (o.known ? this.actorCache.artwork(entry) : "") : "",
      type: o.type,
      heading: o.heading,
      arrow: ["left", "right"].includes(o.heading) && arrowAppearance.arrowMode !== "none" ? (o.heading === "left" ? "←" : "→") : "",
      arrowEmoji: arrowAppearance.arrowMode === "emoji",
      arrowCustom: arrowAppearance.arrowMode === "custom" && !!arrowAppearance.arrowImage,
      arrowImage: arrowAppearance.arrowImage,
      arrowRotation: o.heading === "left" ? 180 : 0,
      arrowPosition: arrowAppearance.arrowPosition,
      arrowSize: arrowAppearance.arrowSize,
      arrowGap: arrowAppearance.arrowGap,
      arrowOpacity: arrowAppearance.arrowOpacity,
      transform,

      status,
      statusLabel: status ? T(`SF2eTSC.status.${status}`) : null,
      hp,
      sp,
      hpPct: hpPct(hp),
      spPct: hpPct(sp),
      selected: this.selected === o.key,
      actionSelected: this.actionObjectKey === o.key,
      targeted,
      target: cls?.status ?? null,
      targetLabel: cls ? T(`SF2eTSC.targeting.${cls.status}`) : null,
      current: !!isCurrent,
      hiddenObj: !!o.hidden,
      level: o.level
    };
  }

  #detail(sel, tsc, isGM, resolved, movable) {
    const obj = findObject(tsc, sel.key);
    const entry = sel.known ? resolved.get(sel.actorUuid ?? sel.key) : null;
    const actor = sel.fullDetails && sel.type === "starship" ? (entry?.actor ?? null) : null;
    const d = actor ? this.actorCache.data(entry) : null;
    const vitals =
      d && (isGM || can(game.user, actor, "adjustVitals"))
        ? { shipUuid: actor.uuid, hp: d.hp.value, hpMax: d.hp.max, sp: d.sp.value, spMax: d.sp.max }
        : null;
    if (obj?.privateContact) {
      return {
        key: obj.key,
        label: obj.name,
        privateContact: true,
        zone: obj.zone,
        canAddToInitiative: !!(isGM && d?.role === "npc"),
        zoneChoices: Array.from({ length: tsc.zones }, (_, i) => ({ id: i + 1, selected: i + 1 === obj.zone })),
        actorUuid: obj.actorUuid,
        canManageEffects: isGM && isStarship(actor),
        effectShipUuid: actor?.uuid,
        vitals,
        canRename: obj.type === "custom",
        detectionLabel: T(`SF2eTSC.detection.${obj.detection.party}`),
        detection: DETECTION_LEVELS.filter((id) => id !== "identified").map((id) => ({
          id,
          label: T(`SF2eTSC.detection.${id}`),
          active: obj.detection.party === id
        }))
      };
    }
    const hazardActor = sel.type === "hazard" ? entry?.actor : null;
    const mine = obj.mineRef && isGM ? obj.mineRef : null;
    const stats = d ? this.actorCache.stats(entry) : null;
    const rows = [{ k: T("SF2eTSC.ui.zone"), v: sel.zone }];
    rows.push({ k: T("SF2eTSC.ui.type"), v: T(`SF2eTSC.objectTypes.${sel.fullDetails ? sel.type : sel.category}`) });
    if (sel.heading) rows.push({ k: T("SF2eTSC.ui.heading"), v: T(`SF2eTSC.heading.${sel.heading}`) });
    if (!sel.fullDetails && sel.known && sel.size) rows.push({ k: T("SF2eTSC.ui.size"), v: sel.size });
    if (d)
      rows.push(
        { k: T("SF2eTSC.ui.level"), v: d.level },
        ...(vitals
          ? []
          : [
              { k: T("SF2eTSC.ui.hullPoints"), v: `${d.hp.value}/${d.hp.max}` },
              { k: T("SF2eTSC.ui.shieldPoints"), v: `${d.sp.value}/${d.sp.max}` }
            ]),
        { k: T("SF2eTSC.ui.ac"), v: stats.ac },
        { k: T("SF2eTSC.ui.status"), v: T(`SF2eTSC.status.${statusOf(d)}`) }
      );
    if (isGM && d?.compromised) rows.push({ k: T("SF2eTSC.ui.compromised"), v: d.compromised });
    const hs = tsc.hazardState?.[sel.key];
    const gm =
      isGM && d
        ? {
            shipUuid: actor.uuid,
            heading: sel.heading ?? null,
            headings: HEADINGS.map((h) => ({ id: h, label: T(`SF2eTSC.heading.${h}`), active: h === sel.heading })),
            statuses: STATUS_STATES.map((s) => ({ id: s, label: T(`SF2eTSC.status.${s}`), active: s === statusOf(d) }))
          }
        : null;
    return {
      gm,
      canManageEffects: isGM && isStarship(actor),
      effectShipUuid: actor?.uuid,
      typeOptions: objectTypeView(sel, isGM),
      vitals,
      canMove: movable.includes(sel.key),
      canAddToInitiative: isGM && sel.type === "starship" && d?.role === "npc" && !obj.privateContact && !obj.tscPrivateProjection,
      key: sel.key,
      label: displayDesignation(sel.label),
      type: sel.type,
      known: sel.known,
      rows,
      isHazard: sel.type === "hazard" && !obj.mineRef,
      mine,
      isMine: !!obj.mineRef,
      hazardDisabled: !!hs?.disabled,
      canOpen:
        !!sel.fullDetails && !!(actor ?? hazardActor) && (isGM || (actor ?? hazardActor).testUserPermission?.(game.user, "OBSERVER")),
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

  /** Абсолютный выбор зоны для приватного контакта; каждый select подключается один раз. */
  #wirePrivateZone() {
    this.element.querySelectorAll("[data-private-zone]").forEach((el) => {
      if (el.dataset.tscZone) return;
      el.dataset.tscZone = "1";
      el.addEventListener("change", async () => {
        try {
          await setPrivateContactZone(activeStarshipCombat(), el.dataset.privateZone, Number(el.value));
          this.render();
        } catch (err) {
          notifyError("SF2eTSC.errors.generic", { message: err.message });
        }
      });
    });
  }

  #syncTargetingControls() {
    this.element.querySelector("[data-tsc-execute-targeting]")?.remove();
    const session = Targeting.current;
    const banner = this.element.querySelector(".tsc-targeting-banner");
    if (!session || !banner) return;
    const count = Targeting.targetUUIDs().length;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = "executeTargeting";
    button.dataset.tscExecuteTargeting = "1";
    button.textContent = `${T("SF2eTSC.ui.execute")} (${count})`;
    button.disabled = count === 0 || (session.singleTarget && count !== 1);
    button.title = T(button.disabled ? "SF2eTSC.errors.badTarget" : "SF2eTSC.ui.execute");
    banner.append(button);
  }

  #paintPreview() {
    const span = this.element?.querySelector?.("[data-tsc-preview]");
    if (!span) return;
    const c = activeStarshipCombat();
    const t = Targeting.current;
    const p = c && t ? this.#preview(targetingState(getTsc(c), t.shipUuid, this._privateObjects)) : null;
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

  /** Foundry v14 protected hook: preserve the display layer before the zones part is replaced. */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState?.(partId, newElement, priorElement, state);
    if (partId !== "zones") return;
    const oldLayer = priorElement?.querySelector(".tsc-map-background");
    const placeholder = newElement?.querySelector(".tsc-map-background");
    if (oldLayer && placeholder) placeholder.replaceWith(oldLayer);
    else if (oldLayer) releaseMapBackground(oldLayer);
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

  _onRender(context, options) {
    super._onRender?.(context, options);
    const hovered = preserveHoveredObject(this.element, this._hover);
    this._hover = hovered;
    Targeting.hoverKey = hovered;
    const layer = this.element.querySelector(".tsc-map-background");
    if (this._backgroundLayer && this._backgroundLayer !== layer) releaseMapBackground(this._backgroundLayer);
    this._backgroundLayer = layer;
    paintMapAppearance(this.element, context);
    wireObjectType(this.element, context.combatId);
    this.#syncTargetingControls();
    wireGmActionObject(this, (event, select) => SensorMapApplication.#selectActionObject.call(this, event, select));
    this.#wireGmEdit();
    this.#wirePrivateZone();
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
      // Avoid hover rerenders replacing the button between mousedown and mouseup.
      el.addEventListener("mouseenter", () => {
        this._hover = el.dataset.objectKey;
        Targeting.hoverKey = this._hover;
        if (Targeting.current) this.#paintPreview();
      });
      el.addEventListener("mouseleave", () => {
        if (this._hover === el.dataset.objectKey) this._hover = null;
        if (Targeting.hoverKey === el.dataset.objectKey) Targeting.hoverKey = null;
      });
    });
    this.element.setAttribute("data-orientation", "horizontal");
    this.element.dataset.rangeMode = context.rangeMode;
    if (!this.element.dataset.tscEsc) {
      this.element.dataset.tscEsc = "1";
      this.element.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && Targeting.current) {
          ev.stopPropagation();
          Targeting.end();
        }
      });
    }
    wireSensorMapDragDrop(this.element, context);
    if (!options?.parts || options.parts.includes("zones")) this.#restoreScroll();
    if (Targeting.current && this._hover) this.#paintPreview();
  }

  /* ---------------------------------------------------------------- actions */
  static #select(event, target) {
    const key = target.dataset.objectKey;
    if (Targeting.current || !game.user.isGM) {
      const session = Targeting.current;
      if (!session) this.selected = key;
      const picked = pickSensorMapObject(key, { additive: !!event.shiftKey, privateObjects: this._privateObjects });
      if (!session) this.render({ parts: sensorPartsFor("select") });
      return picked;
    }
    this.selected = this.selected === key ? null : key;
    this.render({ parts: sensorPartsFor("select") });
  }
  static async #selectActionObject(_event, target) {
    return selectGmActionObject(this, target);
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
  static async #executeTargeting() {
    await Targeting.execute();
  }
  static async #dockAct(event, target) {
    if (game.user.isGM && this.actionObjectKey)
      return runGmHudAction(this.actionObjectKey, target.dataset.actionKey ?? target.dataset.actionId, event);
    await runHudAction(this.dockIndex, target.dataset.actionId, event);
  }
  static #dockPick(event, target) {
    this.dockIndex = Number(target.dataset.index);
    this.render({ parts: ["dock"] });
  }
  static async #resize() {
    const c = activeStarshipCombat();
    const v = await foundry.applications.api.DialogV2.prompt({
      classes: ["sf2e-tsc"],
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
  static async #addInitiative(_event, target) {
    const combat = activeStarshipCombat();
    const key = target.dataset.key;
    if (!game.user.isGM || !combat || !key) return;
    this._initiativeRequests ??= new Set();
    if (this._initiativeRequests.has(key)) return;
    this._initiativeRequests.add(key);
    try {
      const result = await request("sensorAddInitiative", { combatId: combat.id, key });
      if (result.status === "added") ui.notifications?.info?.(T("SF2eTSC.initiative.addedOne"));
      else if (result.status === "existing") ui.notifications?.info?.(T("SF2eTSC.initiative.existingOne"));
      else if (result.status === "skipped")
        ui.notifications?.warn?.(
          T("SF2eTSC.initiative.skippedOne", {
            reason: T(
              result.reason === "recoveryRequired" ? "SF2eTSC.privateMap.recoveryRequired" : `SF2eTSC.initiative.reasons.${result.reason}`
            )
          })
        );
      else ui.notifications?.error?.(T("SF2eTSC.initiative.failedOne"));
    } finally {
      this._initiativeRequests.delete(key);
    }
  }
  static async #addAllNpcInitiative() {
    const combat = activeStarshipCombat();
    if (!game.user.isGM || !combat || this._addingAllNpcInitiative) return;
    this._addingAllNpcInitiative = true;
    try {
      const report = await request("sensorAddAllNpcInitiative", { combatId: combat.id });
      ui.notifications?.info?.(T("SF2eTSC.initiative.bulkSummary", report));
      if (!report.reportCreated) ui.notifications?.warn?.(T("SF2eTSC.initiative.reportFailed"));
    } finally {
      this._addingAllNpcInitiative = false;
    }
  }
  static async #recoverReveals(_event, button) {
    const combat = activeStarshipCombat();
    if (!isActiveGM() || !combat || this._recoveringReveals) return;
    this._recoveringReveals = true;
    button.disabled = true;
    try {
      const report = await recoverPrivateReveals(combat);
      if (!game.user.isGM) return;
      if (report.completed.length) ui.notifications?.info?.(T("SF2eTSC.privateMap.recoveryComplete", { count: report.completed.length }));
      if (report.failed.length) ui.notifications?.warn?.(T("SF2eTSC.privateMap.recoveryFailed", { count: report.failed.length }));
    } finally {
      button.disabled = false;
      this._recoveringReveals = false;
      this.render();
    }
  }
  static #addContact() {
    const c = activeStarshipCombat();
    if (game.user.isGM && c) return new SensorContactEditor(c).render(true);
  }
  static async #mineShip(ref) {
    const ship = await fromUuidSafe(ref.shipUuid);
    if (!ship) throw new Error(T("SF2eTSC.mineContact.invalid"));
    return ship;
  }
  static async #mineOpenShip(e, t) {
    (await SensorMapApplication.#mineShip(t.dataset)).sheet?.render(true);
  }
  static async #mineSync(e, t) {
    const out = await request("syncMineContact", { shipUuid: t.dataset.shipUuid, droneId: t.dataset.droneId, mineId: t.dataset.mineId });
    ui.notifications?.info?.(T(`SF2eTSC.mineContact.sync.${out?.action ?? "unchanged"}`));
  }
  /** Тот же помощник детонации, что и на листе корабля: ничего не бросается и не применяется без подтверждений GM. */
  static async #mineDetonate(e, t) {
    const ship = await SensorMapApplication.#mineShip(t.dataset);
    const drone = readStarship(ship).drones.find((d) => d.id === t.dataset.droneId);
    if (!drone) throw new Error(T("SF2eTSC.mineContact.invalid"));
    const { prepareMineDetonation } = await import("./sheet/sheet-actions.mjs");
    return prepareMineDetonation.call({ document: ship }, e, {
      dataset: { stationId: drone.stationId, droneId: drone.id, mineId: t.dataset.mineId }
    });
  }
  static async #addObject() {
    const c = activeStarshipCombat();
    const typeOptions = LEGACY_ENVIRONMENT_TYPES.map((id) => ({ id, label: T(`SF2eTSC.objectTypes.${id}`) }));
    const content = legacyEnvironmentObjectDialogContent({
      nameLabel: T("SF2eTSC.ui.name"),
      typeLabel: T("SF2eTSC.ui.type"),
      zoneLabel: T("SF2eTSC.ui.zone"),
      errorLabel: T("SF2eTSC.ui.customObjectNameRequired"),
      typeOptions
    });
    new foundry.applications.api.DialogV2({
      classes: ["sf2e-tsc"],
      window: { title: T("SF2eTSC.ui.addObject") },
      content,
      form: { closeOnSubmit: false },
      buttons: [
        {
          action: "add",
          label: T("SF2eTSC.contactEditor.add"),
          default: true,
          callback: (event, button, dialog) =>
            submitLegacyEnvironmentObject(new foundry.applications.ux.FormDataExtended(button.form).object, {
              dialog,
              app: this,
              combat: c,
              existingObjects: () => {
                const objects = getTsc(c).objects;
                let contacts = [];
                try {
                  contacts = privateContacts(c.id);
                } catch (error) {
                  notifyError("SF2eTSC.errors.generic", { message: error.message });
                }
                return [...objects, ...contacts];
              },
              addCustom: (combat, name, zone) => addPrivateCustom(combat, name, zone),
              addPublic: (combat, object) =>
                request("sensorUpdate", {
                  op: "add",
                  combatId: combat.id,
                  object: {
                    key: foundry.utils.randomID(10),
                    ...object,
                    heading: null,
                    detection: { party: "observed" }
                  }
                })
            })
        }
      ],
      rejectClose: false
    }).render({ force: true });
  }
  static async #privateMove(e, t) {
    const c = activeStarshipCombat(),
      obj = this._privateObjects?.find((o) => o.key === t.dataset.key);
    if (obj) await changePrivateContact(c, obj.key, "move", Math.max(1, Math.min(getTsc(c).zones, obj.zone + Number(t.dataset.by))));
    this.render();
  }
  static async #privateRemove(e, t) {
    await changePrivateContact(activeStarshipCombat(), t.dataset.key, "remove");
    this.selected = null;
    this.render();
  }
  static async #privateReveal(e, t) {
    try {
      await changePrivateContact(activeStarshipCombat(), t.dataset.key, "reveal");
    } finally {
      this.selected = null;
      this.render();
    }
  }
  static async #privateDetect(e, t) {
    await changePrivateContact(activeStarshipCombat(), t.dataset.key, "detect", t.dataset.level);
    this.render();
  }
  static async #privateRename(e, t) {
    const obj = this._privateObjects?.find((o) => o.key === t.dataset.key);
    if (!obj || obj.type !== "custom") return;
    const name = await foundry.applications.api.DialogV2.prompt({
      classes: ["sf2e-tsc"],
      window: { title: T("SF2eTSC.privateMap.rename") },
      content: `<input name="name" maxlength="120" value="${foundry.utils.escapeHTML(obj.name)}">`,
      ok: { callback: (_e, b) => b.form.elements.name.value },
      rejectClose: false
    }).catch(() => null);
    if (name !== null) await changePrivateContact(activeStarshipCombat(), obj.key, "rename", name);
    this.render();
  }
  static async #privateOpen(e, t) {
    const obj = this._privateObjects?.find((o) => o.key === t.dataset.key);
    if (!obj) return;
    const actor = await resolveSensorActor(activeStarshipCombat(), obj.actorUuid);
    actor?.sheet?.render(true, actor.mapOnly ? { editable: false } : undefined);
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
  static #toggleRanges() {
    this.showRanges = !this.showRanges;
    this.render({ parts: ["bar", "zones"] });
  }
  static async #openSheet(e, t) {
    const actor = await resolveSensorActor(activeStarshipCombat(), t.dataset.key);
    actor?.sheet?.render(true, actor.mapOnly ? { editable: false } : undefined);
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
      classes: ["sf2e-tsc"],
      window: { title: `${T("SF2eTSC.ui.zone")} ${zone}` },
      content: `<div class="form-group"><label>${T("SF2eTSC.ui.cover")}</label><input type="checkbox" name="cover" ${info.cover ? "checked" : ""}></div><div class="form-group"><label>${T("SF2eTSC.ui.concealment")}</label><input type="checkbox" name="concealment" ${info.concealment ? "checked" : ""}></div><div class="form-group"><label>${T("SF2eTSC.ui.specialEffect")}</label><input type="text" name="special" value="${foundry.utils.escapeHTML(info.special ?? "")}"></div><div class="form-group"><label>${T("SF2eTSC.ui.publicNotes")}</label><textarea name="publicNotes">${foundry.utils.escapeHTML(info.publicNotes ?? "")}</textarea></div><p>${T("SF2eTSC.privateMap.legacyNotesWarning")}</p>`,
      ok: { callback: (ev, b) => new foundry.applications.ux.FormDataExtended(b.form).object },
      rejectClose: false
    }).catch(() => null);
    if (data) await request("sensorUpdate", { op: "zoneInfo", combatId: c.id, zone, info: data });
  }
}
