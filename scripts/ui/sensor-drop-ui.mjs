import { sensorDragData } from "../sensor/actor-drop.mjs";
import { getTsc } from "../combat/tsc-state.mjs";
import { changePrivateContact } from "../sensor/private-contacts.mjs";
import { addSensorContact } from "../sensor/contact-service.mjs";
import { readStarship, isStarship } from "../starship/starship-state.mjs";
import { request } from "../socket.mjs";
import { T, fromUuidSafe } from "../utils/foundry.mjs";
import { notifyWarn, notifyInfo } from "../utils/logging.mjs";

/** Слушатели добавляются один раз к каждой отрисованной зоне; права проверяет активный GM. */
export function wireSensorMapDragDrop(element, context, deps = {}) {
  if (!context.combatId) return;
  const send = deps.send ?? request,
    resolve = deps.resolve ?? fromUuidSafe;
  const warn = deps.warn ?? notifyWarn,
    info = deps.info ?? notifyInfo;
  const movable = new Set(context.movableKeys ?? []);
  element.querySelectorAll(".tsc-obj[data-object-key]").forEach((el) => {
    if (el.dataset.tscDrag || !movable.has(el.dataset.objectKey)) return;
    el.dataset.tscDrag = "1";
    el.draggable = true;
    el.classList.add("tsc-draggable");
    el.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData("text/plain", JSON.stringify({ tscKey: el.dataset.objectKey }));
      ev.dataTransfer.effectAllowed = "move";
    });
  });
  element.querySelectorAll(".tsc-zone[data-zone]").forEach((zone) => {
    if (zone.dataset.tscDrop) return;
    zone.dataset.tscDrop = "1";
    zone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      zone.classList.add("tsc-drop");
    });
    zone.addEventListener("dragleave", (ev) => {
      if (!zone.contains(ev.relatedTarget)) zone.classList.remove("tsc-drop");
    });
    zone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      zone.classList.remove("tsc-drop");
      const data = sensorDragData(ev),
        zoneNumber = Number(zone.dataset.zone);
      try {
        if (data?.tscKey) {
          if (!movable.has(data.tscKey)) return;
          if ((context.privateKeys ?? []).includes(data.tscKey))
            await changePrivateContact(game.combats.get(context.combatId), data.tscKey, "move", zoneNumber);
          else await send("sensorUpdate", { op: "move", combatId: context.combatId, key: data.tscKey, zone: zoneNumber });
          return;
        }
        if (!game.user.isGM) return warn("SF2eTSC.errors.gmOnly");
        if (data?.type !== "Actor" || typeof data.uuid !== "string") return warn("SF2eTSC.mapDrop.unsupportedActor");
        const actor = await resolve(data.uuid);
        if (!actor || actor.documentName !== "Actor" || actor.uuid !== data.uuid) return warn("SF2eTSC.mapDrop.invalidActor");
        if (!isStarship(actor) && actor.type !== "hazard") return warn("SF2eTSC.mapDrop.unsupportedActor");
        const combat = game.combats.get(context.combatId);
        const alreadyPresent = getTsc(combat).objects.some((o) => o.actorUuid === data.uuid || o.key === data.uuid);
        if (!alreadyPresent && (actor.type === "hazard" || (isStarship(actor) && readStarship(actor).role === "npc"))) {
          const result = await addSensorContact(combat, {
            source: "world",
            uuid: actor.uuid,
            zone: zoneNumber,
            detection: "undetected"
          });
          if (result.result === "unchanged") info("SF2eTSC.mapDrop.unchanged");
          return;
        }
        let publicActor = false;
        if (!alreadyPresent) {
          const accepted = await (
            deps.confirm
              ? deps.confirm()
              : foundry.applications.api.DialogV2.confirm({
                  classes: ["sf2e-tsc"],
                  window: { title: T("SF2eTSC.mapDrop.disclosureTitle") },
                  content: `<p>${T("SF2eTSC.mapDrop.disclosure")}</p>`,
                  rejectClose: false
                })
          ).catch(() => false);
          if (!accepted) return;
          publicActor = true;
        }
        const result = await send("sensorUpdate", {
          op: "dropActor",
          combatId: context.combatId,
          actorUuid: data.uuid,
          zone: zoneNumber,
          publicActor
        });
        if (result === "unchanged") info("SF2eTSC.mapDrop.unchanged");
      } catch (err) {
        warn("SF2eTSC.errors.generic", { message: err.message });
      }
    });
  });
}
