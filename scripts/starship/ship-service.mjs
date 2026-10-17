import { patchStarship, stationOf, writeStarship, isStarship, loadStarship } from "./starship-state.mjs";
import { registerHandler, request } from "../socket.mjs";
import { can } from "../crew/permissions.mjs";
import { fromUuidSafe, T } from "../utils/foundry.mjs";
import { Content } from "../content/loader.mjs";
import { frameStatsAtLevel, stationGradeForLevel } from "../engine/advancement.mjs";
import { Draft } from "../actions/draft.mjs";
import { applyDamageInDraft } from "../damage/damage-service.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { runHullIntegrityCheck } from "../combat/hull-integrity.mjs";
import { postSimpleCard } from "../chat/chat-cards.mjs";
import { resolveHullRestored } from "../engine/compromised.mjs";
import { Initiative } from "../combat/initiative.mjs";
import { linkInline } from "../content/inline-links.mjs";
import { normalizeStarship, sanitizeShipField, sanitizePool, sanitizeStationField, sanitizeListItem } from "../engine/validation.mjs";
import { imageUpdate } from "../ui/image-edit.mjs";
import { planUpgradeChange, UpgradeError } from "../engine/upgrades.mjs";
import { stationTypeLabel } from "../utils/labels.mjs";
import { upgradeCatalog } from "../content/loader.mjs";
import { randomId } from "../utils/ids.mjs";

const EDITABLE_LISTS = ["weapons", "upgrades", "expansionBays", "effects", "strikes", "npcActions", "drones"];

/** State flags a crew member may flip by hand (everything else in STATE_KEYS is GM only). */
const CREW_STATE_KEYS = ["offKilter"];
const CONFIG_KEYS = [
  "level",
  "frame",
  "size",
  "sensorRange",
  "speed",
  "ac",
  "fort",
  "reflex",
  "will",
  "perception",
  "notes",
  "role",
  "traits",
  "immunities",
  "resistances",
  "weaknesses",
  "hardness",
  "customModifiers",
  "fortify",
  "skills",
  "faction"
];
const STATE_KEYS = ["compromised", "wrecked", "inoperable", "offKilter", "destroyed", "heading", "gmNotes"];

/** Every handler below writes starship data: only actors flagged as starships are accepted (0.9.1). */
const ship = (uuid) => loadStarship(uuid);

export function registerShipHandlers() {
  registerHandler("patchShip", async ({ user, payload }) => {
    const s = await ship(payload.shipUuid);
    const patch = payload.patch ?? {};
    await patchStarship(s, (d) => {
      for (const [k, v] of Object.entries(patch)) {
        // every value is type-checked (sanitize*) before it is stored; unknown keys are still ignored
        if (CONFIG_KEYS.includes(k)) {
          if (!(user.isGM || can(user, s, "configureShip"))) throw new Error(T("SF2eTSC.errors.noPermission"));
          d[k] = sanitizeShipField(k, v);
        } else if (STATE_KEYS.includes(k)) {
          if (!(user.isGM || (CREW_STATE_KEYS.includes(k) && can(user, s, "adjustVitals")))) throw new Error(T("SF2eTSC.errors.gmOnly"));
          d[k] = sanitizeShipField(k, v);
        } else if (k === "sp" || k === "hp") {
          // current values: GM and crew (adjustVitals); maximums: GM and whoever may configure the ship
          const pool = sanitizePool(k, v);
          const allowed = user.isGM || (("max" in pool ? can(user, s, "configureShip") : true) && can(user, s, "adjustVitals"));
          if (!allowed) throw new Error(T("SF2eTSC.errors.gmOnly"));
          d[k] = { ...d[k], ...pool };
        }
      }
      if (patch.compromised === 0) {
        d.inoperable = false;
      }
    });
    return true;
  });

  registerHandler("setStation", async ({ user, payload }) => {
    const s = await ship(payload.shipUuid);
    const stationPatch = payload.patch && typeof payload.patch === "object" ? payload.patch : {};
    await patchStarship(s, (d) => {
      const st = stationOf(d, payload.stationId);
      if (!st) throw new Error(T("SF2eTSC.errors.stationNotFound"));
      for (const [k, v] of Object.entries(stationPatch)) {
        if (k === "malfunctioning") {
          if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
          st.malfunctioning = sanitizeStationField(k, v);
        } else if (["grade", "name", "location", "weaponId", "upgrades", "actions", "type"].includes(k)) {
          if (!(user.isGM || can(user, s, "configureShip"))) throw new Error(T("SF2eTSC.errors.noPermission"));
          st[k] = sanitizeStationField(k, v);
        }
      }
    });
    return true;
  });

  registerHandler("removeStation", async ({ user, payload }) => {
    const s = await ship(payload.shipUuid);
    if (!(user.isGM || can(user, s, "configureShip"))) throw new Error(T("SF2eTSC.errors.noPermission"));
    await patchStarship(s, (d) => {
      d.stations = d.stations.filter((x) => x.id !== payload.stationId);
      d.crew.forEach((c) => {
        if (c.stationId === payload.stationId) c.stationId = null;
      });
      (d.upgrades ?? []).forEach((u) => {
        if (u?.stationId === payload.stationId) u.stationId = null;
      });
    }); // upgrades are kept, unassigned
    return true;
  });

  registerHandler("equipment", async ({ user, payload }) => {
    const s = await ship(payload.shipUuid);
    if (!(user.isGM || can(user, s, "editEquipment"))) throw new Error(T("SF2eTSC.errors.noPermission"));
    await patchStarship(s, (d) => {
      if (!EDITABLE_LISTS.includes(payload.list)) throw new Error(T("SF2eTSC.errors.invalidData"));
      // installing upgrades goes through "stationUpgrade" (capacity + compatibility); raw list edits are GM only
      if (payload.list === "upgrades" && payload.op !== "remove" && !user.isGM) throw new Error(T("SF2eTSC.errors.noPermission"));
      if (!Array.isArray(d[payload.list])) d[payload.list] = [];
      const list = d[payload.list];
      // items are addressed by id, or by index for statblock lists without ids (strikes, npcActions)
      const idx = Number.isInteger(payload.index) ? payload.index : list.findIndex((x) => x?.id === payload.id);
      if (payload.op === "add") {
        if (list.length >= 200) throw new Error(T("SF2eTSC.errors.invalidData"));
        list.push(sanitizeListItem(payload.list, payload.item));
      } else if (payload.op === "remove") {
        if (idx >= 0 && idx < list.length) list.splice(idx, 1);
      } else if (payload.op === "update") {
        if (idx >= 0 && idx < list.length) list[idx] = { ...list[idx], ...sanitizeListItem(payload.list, payload.item) };
      } else throw new Error(T("SF2eTSC.errors.invalidData"));
    });
    return true;
  });

  /**
   * install / remove / assign starship upgrades on battle stations (or at ship level for escape pods).
   * Same permission as the equipment list; capacity and compatibility are enforced for everyone except a GM who
   * explicitly overrides (stored on the record). Upgrade effects are never applied automatically.
   */
  registerHandler("stationUpgrade", async ({ user, payload }) => {
    const s = await ship(payload.shipUuid);
    if (!(user.isGM || can(user, s, "editEquipment"))) throw new Error(T("SF2eTSC.errors.noPermission"));
    if (!["add", "remove", "assign", "override"].includes(payload.op)) throw new Error(T("SF2eTSC.errors.invalidData"));
    const str = (v, max = 64) => (typeof v === "string" && v ? v.slice(0, max) : null);
    const clean = {
      key: str(payload.key, 100),
      id: str(payload.id),
      stationId: str(payload.stationId),
      override: payload.override === true,
      value: payload.value === true
    };
    await patchStarship(s, (d) => {
      try {
        d.upgrades = planUpgradeChange(d, payload.op, clean, {
          entries: upgradeCatalog(),
          stationDefs: Content.stations,
          isGM: user.isGM,
          newId: () => randomId("upg")
        });
      } catch (err) {
        if (err instanceof UpgradeError)
          throw new Error(
            T(`SF2eTSC.upgrades.errors.${err.code}`, { ...err.data, station: err.data?.station ? stationTypeLabel(err.data.station) : "" }),
            { cause: err }
          );
        throw err;
      }
    });
    return true;
  });

  /** Actor-level fields (name / portrait / token image). */
  registerHandler("actorBasics", async ({ user, payload }) => {
    const a = await fromUuidSafe(payload.actorUuid);
    if (!a) throw new Error(T("SF2eTSC.errors.shipNotFound"));
    if (!(user.isGM || a.testUserPermission?.(user, "OWNER") || (isStarship(a) && can(user, a, "configureShip"))))
      throw new Error(T("SF2eTSC.errors.noPermission"));
    const upd = {};
    if (typeof payload.name === "string" && payload.name.trim()) {
      upd.name = payload.name.trim();
      upd["prototypeToken.name"] = upd.name;
    }
    if (typeof payload.img === "string" && payload.img) Object.assign(upd, imageUpdate(a, payload.img, "img"));
    if (typeof payload.tokenImg === "string" && payload.tokenImg) upd["prototypeToken.texture.src"] = payload.tokenImg;
    if (Object.keys(upd).length) await a.update(upd);
    return true;
  });
  /** GM raw-JSON editor: replace the whole starship flag after validation. */
  registerHandler("replaceShip", async ({ user, payload }) => {
    if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const s = await ship(payload.shipUuid);
    const { data, errors } = normalizeStarship(payload.data ?? {});
    if (errors.length) throw new Error(errors.join("; "));
    await writeStarship(s, data, { hullPatch: data.hp });
    return true;
  });

  registerHandler("applyFrame", async ({ user, payload }) => {
    const s = await ship(payload.shipUuid);
    if (!(user.isGM || can(user, s, "configureShip"))) throw new Error(T("SF2eTSC.errors.noPermission"));
    const frame = Content.frames.get(payload.frameId);
    if (!frame) throw new Error(T("SF2eTSC.errors.unknownContent", { id: payload.frameId }));
    const level = sanitizeShipField("level", payload.level); // integer -1…25, never a raw request value
    const row = frameStatsAtLevel(frame, level);
    if (!row) throw new Error(T("SF2eTSC.errors.invalidData"));
    await patchStarship(s, (d) => {
      d.frame = frame.id;
      d.level = level;
      d.size = frame.size;
      d.sensorRange = frame.sensorRange;
      d.speed = row.speed;
      d.ac = row.ac;
      d.fort = row.fort;
      d.reflex = row.ref;
      d.will = row.will;
      d.sp.max = row.sp;
      d.sp.value = Math.min(d.sp.value, row.sp);
      d.hp = { value: Math.min(d.hp.value || row.hp, row.hp), max: row.hp };
      if (payload.autoGrades) for (const st of d.stations) if (st.type !== "custom") st.grade = stationGradeForLevel(st.type, level);
    });
    await s.update({ "system.details.level.value": level });
    return true;
  });

  /* GM tools */
  /** Damage / repair / hull integrity by hand: the GM, or the crew of the ship (adjustVitals). */
  const vitals = async (user, shipUuid) => {
    if (!user.isGM && !can(user, await ship(shipUuid), "adjustVitals")) throw new Error(T("SF2eTSC.errors.gmOnly"));
  };
  registerHandler("gmDamage", async ({ user, payload }) => {
    await vitals(user, payload.shipUuid);
    const draft = new Draft(activeStarshipCombat());
    draft.allowUndo = true;
    await applyDamageInDraft(draft, payload.shipUuid, {
      amount: payload.amount,
      damageType: payload.damageType ?? "untyped",
      traits: payload.traits ?? [],
      criticalHit: !!payload.crit,
      nonlethal: !!payload.nonlethal,
      source: typeof payload.reason === "string" && payload.reason.trim() ? payload.reason.trim().slice(0, 240) : T("SF2eTSC.ui.gmDamage")
    });
    await draft.commit();
    return true;
  });
  registerHandler("gmRepair", async ({ user, payload }) => {
    await vitals(user, payload.shipUuid);
    if (payload.clearMalfunctions && !user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const s = await ship(payload.shipUuid);
    await patchStarship(s, (d) => {
      const before = d.hp.value;
      if (payload.hp) d.hp.value = Math.min(d.hp.max, d.hp.value + payload.hp);
      if (payload.sp) d.sp.value = Math.min(d.sp.max, d.sp.value + payload.sp);
      const r = resolveHullRestored({ compromised: d.compromised, wrecked: d.wrecked, inoperable: d.inoperable }, before, d.hp.value);
      d.compromised = r.compromised;
      d.wrecked = r.wrecked;
      d.inoperable = r.inoperable;
      if (payload.clearMalfunctions)
        d.stations.forEach((st) => {
          st.malfunctioning = false;
        });
      if (r.lostCompromised) {
        const c = activeStarshipCombat();
        if (c) Initiative.leaveCompromised(c, s);
      }
    });
    return true;
  });
  registerHandler("hullIntegrity", async ({ user, payload }) => {
    await vitals(user, payload.shipUuid);
    return runHullIntegrityCheck(await ship(payload.shipUuid), activeStarshipCombat());
  });
  registerHandler("manualCard", async ({ user, payload }) => {
    if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const s = await ship(payload.shipUuid);
    await postSimpleCard({ actor: s, title: payload.title, body: `<p>${linkInline(foundry.utils.escapeHTML(payload.text))}</p>` });
    return true;
  });
  registerHandler("setZone", async ({ user, payload }) => {
    if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const combat = activeStarshipCombat();
    if (!combat) throw new Error(T("SF2eTSC.errors.noCombat"));
    const draft = new Draft(combat);
    const { moveObject } = await import("../engine/sensor-ops.mjs");
    draft.tsc = moveObject(draft.tsc, payload.key, payload.zone);
    await draft.commit();
    return true;
  });
}

export const Ship = {
  patch: (shipUuid, patch) => request("patchShip", { shipUuid, patch }),
  setStation: (shipUuid, stationId, patch) => request("setStation", { shipUuid, stationId, patch }),
  removeStation: (shipUuid, stationId) => request("removeStation", { shipUuid, stationId }),
  equipment: (shipUuid, list, op, extra) => request("equipment", { shipUuid, list, op, ...extra }),
  stationUpgrade: (shipUuid, op, extra = {}) => request("stationUpgrade", { shipUuid, op, ...extra }),
  applyFrame: (shipUuid, frameId, level, autoGrades = true) => request("applyFrame", { shipUuid, frameId, level, autoGrades }),
  damage: (shipUuid, amount, opts = {}) => request("gmDamage", { shipUuid, amount, ...opts }),
  repair: (shipUuid, opts) => request("gmRepair", { shipUuid, ...opts }),
  hullIntegrity: (shipUuid) => request("hullIntegrity", { shipUuid }),
  manualCard: (shipUuid, title, text) => request("manualCard", { shipUuid, title, text }),
  setZone: (key, zone) => request("setZone", { key, zone })
};
