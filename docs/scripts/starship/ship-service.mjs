import { saveInstallMinePlan } from "../actions/install-mine-plan.mjs";
import { installMines, changeKnownMod, discardStoredMine, operatorClassStatus } from "../engine/mine-stock.mjs";
import { syncMineContact, syncMineContactSafe } from "../sensor/mine-contact.mjs";
import { updateProtocolDrone } from "../actions/protocol-manual.mjs";
import { updatePetCabin } from "../actions/pet-onboard.mjs";
import { markManualIntercept } from "../actions/intercept-manual.mjs";
import { modifyOwnedMine } from "../actions/mine-modification.mjs";
import { combatGuard, snapshot } from "../history/history.mjs";
import { moveOwnedMine, uniqueOwnedMine } from "../actions/mine-resolution.mjs";
import { getTsc } from "../combat/tsc-state.mjs";
import { findObject } from "../engine/sensor-ops.mjs";
import { computeShipStats } from "./stats.mjs";
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
import { changeDrone } from "../engine/drone-state.mjs";
import { log } from "../utils/logging.mjs";

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
      // Сырые правки обходят правила дронов и разрешены только GM.
      if (payload.list === "drones" && !user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
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

  registerHandler("droneState", async ({ user, payload }) => {
    if (payload.op !== "add") throw new Error(T("SF2eTSC.droneControl.errors.useAction"));
    const s = await ship(payload.shipUuid);
    await patchStarship(s, (d) => {
      const st = stationOf(d, payload.stationId);
      if (!st || st.type !== "drone-console") throw new Error(T("SF2eTSC.droneControl.errors.station"));
      if (payload.op === "add") {
        if (!(user.isGM || can(user, s, "editEquipment"))) throw new Error(T("SF2eTSC.errors.noPermission"));
      } else {
        const operator = st.helmedBy ? fromUuidSync(st.helmedBy) : null;
        if (!user.isGM && !(can(user, s, "operateStation") && operator?.testUserPermission?.(user, "OWNER")))
          throw new Error(T("SF2eTSC.errors.noPermission"));
      }
      try {
        changeDrone(d, payload.op, payload, {
          definition: Content.stations.get("drone-console"),
          droneTypes: Content.drones,
          worldTime: game.time?.worldTime
        });
      } catch (err) {
        const codes = ["station", "legacy", "invalid", "capacity", "cooldown"];
        throw new Error(T(`SF2eTSC.droneControl.errors.${codes.includes(err.message) ? err.message : "invalid"}`), { cause: err });
      }
    });
    return true;
  });

  // Только подтверждённая ведущим ручная отметка; системный Strike этот обработчик не меняет.
  registerHandler("markManualIntercept", async ({ user, payload }) => {
    if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    if (payload.confirmManual !== true) throw new Error(T("SF2eTSC.interceptAssist.invalid"));
    const actor = await ship(payload.shipUuid);
    const combat = activeStarshipCombat();
    if (!combat?.id || payload.combatId !== combat.id) throw new Error(T("SF2eTSC.interceptAssist.invalid"));
    let changed;
    const writeOptions = { reason: T("SF2eTSC.interceptAssist.title"), undoable: false, announce: false };
    try {
      changed = await patchStarship(
        actor,
        async (data) => {
          if (!user.isGM || activeStarshipCombat()?.id !== combat.id) throw new Error("invalid");
          writeOptions.expected = snapshot(data);
          writeOptions.expectedCombat = combatGuard(combat);
          const operator = await fromUuidSafe(payload.operatorUuid);
          if (
            !user.isGM ||
            !operator ||
            operator.documentName !== "Actor" ||
            operator.uuid !== payload.operatorUuid ||
            activeStarshipCombat()?.id !== combat.id
          )
            throw new Error("invalid");
          return markManualIntercept(data, payload);
        },
        writeOptions
      );
    } catch (err) {
      throw new Error(T("SF2eTSC.interceptAssist.invalid"), { cause: err });
    }
    if (!changed) return false;
    try {
      const recipients = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
      if (!recipients.length) throw new Error("missing GM");
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        whisper: recipients,
        content: `<p>${foundry.utils.escapeHTML(T("SF2eTSC.interceptAssist.recorded", { drone: payload.droneId, strike: payload.strikeRef }))}</p><p>${foundry.utils.escapeHTML(T("SF2eTSC.interceptAssist.manual"))}</p>`
      });
    } catch (err) {
      log.error("Intercept marker saved, but chat failed", err);
      ui.notifications?.warn?.(T("SF2eTSC.interceptAssist.cardFailed"));
    }
    return true;
  });

  // Ручной план: не переносит персональные модификации на развёрнутые мины автоматически.
  registerHandler("installMinePlan", async ({ user, payload }) => {
    if (!user?.isGM || payload.confirmed !== true) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const actor = await ship(payload.shipUuid);
    const writeOptions = { reason: T("SF2eTSC.installMine.title"), undoable: false, announce: false };
    const changed = await patchStarship(
      actor,
      async (data) => {
        writeOptions.expected = snapshot(data);
        const operator = await fromUuidSafe(payload.operatorUuid);
        if (!operator || operator.documentName !== "Actor" || operator.uuid !== payload.operatorUuid)
          throw new Error(T("SF2eTSC.installMine.invalid"));
        try {
          return saveInstallMinePlan(data, payload);
        } catch (err) {
          throw new Error(T("SF2eTSC.installMine.invalid"), { cause: err });
        }
      },
      writeOptions
    );
    if (changed) {
      try {
        const recipients = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
        if (!recipients.length) throw new Error("missing GM");
        const esc = foundry.utils.escapeHTML;
        const rows = payload.entries.map((e) => `<li>${esc(e.mine.trim())}: ${esc(e.mod.trim())}</li>`).join("");
        await ChatMessage.create({
          whisper: recipients,
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<p><strong>${esc(T("SF2eTSC.installMine.title"))}</strong></p><ul>${rows}</ul><p>${esc(T("SF2eTSC.installMine.card"))}</p>`
        });
      } catch (err) {
        log.error("Install Mine plan saved but card failed", err);
        ui.notifications?.warn?.(T("SF2eTSC.installMine.cardFailed"));
      }
    }
    return changed;
  });

  const MINE_STOCK_ERRORS = ["invalid", "class", "mod", "stock", "modified", "receipts", "legacy"];
  const mineStockError = (err) =>
    new Error(T(`SF2eTSC.mineStock.errors.${MINE_STOCK_ERRORS.includes(err?.message) ? err.message : "invalid"}`), { cause: err });

  // Install Mine (Tech Core с. 184): подготовленные мины хранятся в неразвёрнутом дроне вместе с подтверждёнными модификациями.
  registerHandler("installMineStock", async ({ user, payload }) => {
    if (!user?.isGM || payload.confirmed !== true) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const actor = await ship(payload.shipUuid);
    const operator = await fromUuidSafe(payload.operatorUuid);
    if (!operator || operator.documentName !== "Actor" || operator.uuid !== payload.operatorUuid)
      throw new Error(T("SF2eTSC.mineStock.errors.invalid"));
    const writeOptions = { reason: T("SF2eTSC.mineStock.installTitle"), undoable: false, announce: false };
    let changed;
    try {
      changed = await patchStarship(
        actor,
        (data) => {
          writeOptions.expected = snapshot(data);
          return installMines(data, {
            stationId: payload.stationId,
            droneId: payload.droneId,
            operatorUuid: payload.operatorUuid,
            entries: payload.entries,
            operationId: payload.operationId,
            confirmed: payload.confirmed === true,
            operatorClass: operatorClassStatus(operator),
            gmOverride: payload.gmOverride === true,
            now: game.time?.worldTime
          });
        },
        writeOptions
      );
    } catch (err) {
      throw mineStockError(err);
    }
    if (changed) {
      try {
        const recipients = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
        if (!recipients.length) throw new Error("missing GM");
        const esc = foundry.utils.escapeHTML;
        const rows = payload.entries.map((e) => `<li>${esc(String(e.label ?? e.stockId ?? ""))}</li>`).join("");
        await ChatMessage.create({
          whisper: recipients,
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<p><strong>${esc(T("SF2eTSC.mineStock.installTitle"))}</strong> — ${esc(actor.name)} / ${esc(operator.name)}</p><ul>${rows}</ul><p>${esc(T("SF2eTSC.mineStock.card"))}</p>`
        });
      } catch (err) {
        log.error("Install Mine saved but card failed", err);
        ui.notifications?.warn?.(T("SF2eTSC.mineStock.cardFailed"));
      }
    }
    return changed;
  });

  // Известные модификации минного экзокортекса оператора: только подтверждённые ведущим непрозрачные записи.
  registerHandler("mineKnownMod", async ({ user, payload }) => {
    if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const actor = await ship(payload.shipUuid);
    try {
      return await patchStarship(
        actor,
        (data) =>
          changeKnownMod(data, {
            stationId: payload.stationId,
            operatorUuid: payload.operatorUuid,
            op: payload.op,
            modId: payload.modId,
            label: payload.label,
            confirmed: payload.confirmed === true
          }),
        { reason: T("SF2eTSC.mineStock.knownTitle"), undoable: false, announce: false }
      );
    } catch (err) {
      throw mineStockError(err);
    }
  });

  registerHandler("discardStoredMine", async ({ user, payload }) => {
    if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const actor = await ship(payload.shipUuid);
    try {
      return await patchStarship(
        actor,
        (data) => discardStoredMine(data, { stationId: payload.stationId, droneId: payload.droneId, stockId: payload.stockId }),
        { reason: T("SF2eTSC.mineStock.discard"), undoable: false, announce: false }
      );
    } catch (err) {
      throw mineStockError(err);
    }
  });

  // Явная повторная синхронизация проекции мины (Actor и контакт на карте) после сбоя.
  registerHandler("syncMineContact", async ({ user, payload }) => {
    if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const actor = await ship(payload.shipUuid);
    return syncMineContact({ shipUuid: actor.uuid, droneId: String(payload.droneId ?? ""), mineId: String(payload.mineId ?? "") });
  });

  // Ведущий подтверждает Modify; проверка и запись выполняются в очереди активного GM.
  registerHandler("modifyDroneMine", async ({ user, payload }) => {
    if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    if (payload.confirmPrerequisite !== true) throw new Error(T("SF2eTSC.errors.invalidData"));
    const actor = await ship(payload.shipUuid);
    const writeOptions = { reason: T("SF2eTSC.mineModify.title"), undoable: false, announce: false };
    let operatorName = "";
    const changed = await patchStarship(
      actor,
      async (data) => {
        if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
        const combat = activeStarshipCombat();
        writeOptions.expected = snapshot(data);
        const stations = data.stations.filter((s) => s?.id === payload.stationId);
        const operator = stations.length === 1 ? await fromUuidSafe(stations[0].helmedBy) : null;
        if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
        if (!combat || activeStarshipCombat()?.id !== combat.id) throw new Error(T("SF2eTSC.mineModify.invalid"));
        const map = getTsc(combat);
        const objects = map.objects.filter((o) => o?.key === actor.uuid);
        if (objects.length !== 1) throw new Error(T("SF2eTSC.mineModify.invalid"));
        writeOptions.expectedCombat = combatGuard(combat);
        operatorName = operator?.name ?? "";
        try {
          return modifyOwnedMine({
            data,
            shipUuid: actor.uuid,
            stationId: payload.stationId,
            droneId: payload.droneId,
            mineId: payload.mineId,
            operator,
            combat,
            shipZone: objects[0].zone,
            origin: payload.origin,
            type: payload.type,
            modificationId: payload.modificationId
          });
        } catch (err) {
          throw new Error(T("SF2eTSC.mineModify.invalid"), { cause: err });
        }
      },
      writeOptions
    ).catch((err) => {
      if (err.message === T("SF2eTSC.qol.undoConflict")) throw new Error(T("SF2eTSC.mineModify.changed"), { cause: err });
      throw err;
    });
    if (changed) {
      try {
        const recipients = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
        if (!recipients.length) throw new Error("No GM recipients");
        const esc = foundry.utils.escapeHTML;
        const kind = T(`SF2eTSC.mineModify.${payload.type}`);
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          whisper: recipients,
          content: `<p><strong>${esc(T("SF2eTSC.mineModify.title"))}</strong> — ${esc(actor.name)} / ${esc(operatorName)}</p><p>${esc(T("SF2eTSC.mineModify.card", { kind }))}</p>`
        });
      } catch (err) {
        log.error("Mine modification was saved, but the GM card failed", err);
        ui.notifications?.warn?.(T("SF2eTSC.mineModify.cardFailed"));
      }
    }
    return changed;
  });

  // GM attests the prerequisite; mutations are serialized and validated against current ship/map state.
  registerHandler("moveDroneMine", async ({ user, payload }) => {
    if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    if (payload.confirmPrerequisite !== true) throw new Error(T("SF2eTSC.errors.invalidData"));
    const actor = await ship(payload.shipUuid);
    const moved = await patchStarship(
      actor,
      (data) => {
        const combat = activeStarshipCombat();
        const map = combat ? getTsc(combat) : null;
        const operatorUuid = stationOf(data, payload.stationId)?.helmedBy;
        if (!combat || !operatorUuid) throw new Error(T("SF2eTSC.mineAssist.moveInvalid"));
        try {
          return moveOwnedMine({
            data,
            shipUuid: actor.uuid,
            stationId: payload.stationId,
            droneId: payload.droneId,
            mineId: payload.mineId,
            combatId: combat.id,
            shipZone: findObject(map, actor.uuid)?.zone,
            sensorRange: computeShipStats(actor).sensorRange,
            zones: map.zones,
            destination: payload.destination,
            origin: payload.origin,
            moveId: payload.moveId,
            operatorUuid
          });
        } catch (err) {
          throw new Error(T("SF2eTSC.mineAssist.moveInvalid"), { cause: err });
        }
      },
      { reason: T("SF2eTSC.mineAssist.move"), undoable: false, announce: false }
    );
    // Контакт на карте следует за записью мины; сбой проекции не откатывает уже сохранённый перенос.
    if (moved) await syncMineContactSafe({ shipUuid: actor.uuid, droneId: payload.droneId, mineId: payload.mineId });
    return moved;
  });

  registerHandler("protocolDroneManual", async ({ user, payload }) => {
    if (!user?.isGM || payload.confirmed !== true) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const actor = await ship(payload.shipUuid),
      combat = activeStarshipCombat();
    const operator = await fromUuidSafe(payload.operatorUuid);
    if (
      !combat ||
      combat.id !== payload.combatId ||
      !operator ||
      operator.documentName !== "Actor" ||
      operator.uuid !== payload.operatorUuid
    )
      throw new Error(T("SF2eTSC.protocolAssist.invalid"));
    const opts = { reason: T("SF2eTSC.protocolAssist.title"), undoable: false, announce: false };
    let changed;
    try {
      changed = await patchStarship(
        actor,
        (data) => {
          if (activeStarshipCombat()?.id !== combat.id) throw new Error("combat");
          opts.expected = snapshot(data);
          opts.expectedCombat = combatGuard(combat);
          return updateProtocolDrone(data, { ...payload, combat });
        },
        opts
      );
    } catch (err) {
      throw new Error(T("SF2eTSC.protocolAssist.invalid"), { cause: err });
    }
    if (changed) {
      try {
        const recipients = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
        if (!recipients.length) throw new Error("missing GM");
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          whisper: recipients,
          content: `<p>${foundry.utils.escapeHTML(T(payload.op === "block" ? "SF2eTSC.protocolAssist.blockRecorded" : "SF2eTSC.protocolAssist.fetchRecorded", { drone: payload.droneId }))}</p>`
        });
      } catch (err) {
        log.error("Drone protocol state saved, but card failed", err);
        ui.notifications?.warn?.(T("SF2eTSC.protocolAssist.cardFailed"));
      }
    }
    return { changed };
  });

  // GM удостоверяется в родстве, допустимом типе компаньона и близости: по Actor они не определяются надёжно.
  registerHandler("petCabin", async ({ user, payload }) => {
    if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const actor = await ship(payload.shipUuid);
    const pet = payload.op === "start" ? await fromUuidSafe(payload.petUuid) : null;
    const operator = payload.op === "start" ? await fromUuidSafe(payload.operatorUuid) : null;
    if (payload.op === "start" && (!operator || operator.documentName !== "Actor" || operator.uuid !== payload.operatorUuid))
      throw new Error(T("SF2eTSC.petCabin.invalid"));
    let changed;
    try {
      changed = await patchStarship(
        actor,
        (data) =>
          updatePetCabin(data, {
            stationId: payload.stationId,
            pet,
            operatorUuid: payload.operatorUuid,
            op: payload.op,
            operationId: payload.operationId,
            sessionId: payload.sessionId,
            now: game.time?.worldTime,
            confirmed: payload.confirmed === true
          }),
        { reason: T("SF2eTSC.petCabin.title"), undoable: false, announce: false }
      );
    } catch (err) {
      throw new Error(T("SF2eTSC.petCabin.invalid"), { cause: err });
    }
    if (changed) {
      try {
        const recipients = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
        if (!recipients.length) throw new Error("missing GM");
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          whisper: recipients,
          content: `<p>${foundry.utils.escapeHTML(T(payload.op === "start" ? "SF2eTSC.petCabin.started" : "SF2eTSC.petCabin.ended"))}</p>`
        });
      } catch (err) {
        log.error("Pet cabin saved, but card failed", err);
        ui.notifications?.warn?.(T("SF2eTSC.petCabin.cardFailed"));
      }
    }
    return { changed };
  });

  // GM-only bookkeeping after manual mine resolution; never performs a roll or applies damage.
  registerHandler("closeDroneMine", async ({ user, payload }) => {
    if (!user?.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    if (!["detonated", "removed"].includes(payload.resolution)) throw new Error(T("SF2eTSC.errors.invalidData"));
    const actor = await ship(payload.shipUuid);
    let changed = false;
    await patchStarship(
      actor,
      (data) => {
        let mine;
        try {
          ({ mine } = uniqueOwnedMine(data, { ...payload, shipUuid: actor.uuid }));
        } catch (err) {
          throw new Error(T("SF2eTSC.droneBlock.invalid"), { cause: err });
        }
        if (mine.state !== "armed") return;
        mine.state = payload.resolution;
        mine.resolvedBy = user.id;
        changed = true;
      },
      { reason: T("SF2eTSC.droneBlock.mineHistory"), undoable: false, announce: false }
    );
    // Взорванная или убранная мина снимается с карты, а её Actor получает отметку состояния.
    if (changed) await syncMineContactSafe({ shipUuid: actor.uuid, droneId: payload.droneId, mineId: payload.mineId });
    return { changed };
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
    const amount = (value) => {
      if (value === undefined || value === null) return 0;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(T("SF2eTSC.errors.invalidData"));
      return value;
    };
    const hp = amount(payload.hp);
    const sp = amount(payload.sp);
    if (payload.clearMalfunctions != null && typeof payload.clearMalfunctions !== "boolean")
      throw new Error(T("SF2eTSC.errors.invalidData"));
    if (payload.clearMalfunctions === true && !user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    const s = await ship(payload.shipUuid);
    let lostCompromised = false;
    await patchStarship(s, (d) => {
      // Полномочия могли измениться, пока запрос ожидал очередь корабля.
      if (!user.isGM && !can(user, s, "adjustVitals")) throw new Error(T("SF2eTSC.errors.gmOnly"));
      const before = d.hp.value;
      if (hp) d.hp.value = Math.min(d.hp.max, d.hp.value + hp);
      if (sp) d.sp.value = Math.min(d.sp.max, d.sp.value + sp);
      const r = resolveHullRestored({ compromised: d.compromised, wrecked: d.wrecked, inoperable: d.inoperable }, before, d.hp.value);
      d.compromised = r.compromised;
      d.wrecked = r.wrecked;
      d.inoperable = r.inoperable;
      if (payload.clearMalfunctions === true)
        d.stations.forEach((st) => {
          st.malfunctioning = false;
        });
      lostCompromised = r.lostCompromised;
    });
    if (lostCompromised) {
      const combat = activeStarshipCombat();
      if (combat) {
        try {
          await Initiative.leaveCompromised(combat, s);
        } catch (err) {
          log.error("Repair was saved, but compromised initiative cleanup failed", err);
          ui.notifications?.warn?.(T("SF2eTSC.errors.repairInitiativeFailed"));
        }
      }
    }
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
