import { changeDrone } from "../engine/drone-state.mjs";
import { Content } from "../content/loader.mjs";
import { patchStarship } from "../starship/starship-state.mjs";
import { activeStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { findObject } from "../engine/sensor-ops.mjs";
import { can } from "../crew/permissions.mjs";
import { fromUuidSafe, T } from "../utils/foundry.mjs";
import { postActionCard } from "../chat/chat-cards.mjs";
import { ct } from "../content/content-i18n.mjs";
import { log } from "../utils/logging.mjs";

/** Команда проходит через общую очередь корабля; её состояние и история не зависят от устаревшего Draft. */
export async function executeDroneMovement({ user, ship, crewUuid, stationId, options, action }) {
  const combat = activeStarshipCombat();
  if (!combat && !user.isGM) throw new Error(T("SF2eTSC.errors.noCombat"));
  const crew = await fromUuidSafe(crewUuid);
  if (!crew || (!user.isGM && !crew.testUserPermission?.(user, "OWNER"))) throw new Error(T("SF2eTSC.errors.noPermission"));
  const op = action.id === "deploy-drone" ? "deploy" : action.id === "retrieve-drone" ? "retrieve" : "mine";
  let stationName, droneName;
  const changed = await patchStarship(
    ship,
    (data) => {
      if (!user.isGM && !can(user, ship, "operateStation")) throw new Error(T("SF2eTSC.errors.noPermission"));
      const matches = data.stations.filter((s) => s?.id === stationId);
      const station = matches[0];
      if (matches.length !== 1 || !station || station.type !== "drone-console" || station.helmedBy !== crewUuid)
        throw new Error(T("SF2eTSC.errors.notHelming", { station: T("SF2eTSC.stations.drone-console") }));
      if (station.malfunctioning || data.destroyed)
        throw new Error(T(`SF2eTSC.errors.${station.malfunctioning ? "malfunctioning" : "shipDestroyed"}`));
      try {
        const updated =
          op === "mine"
            ? deployMine(data, { stationId, droneId: options.droneId, mineId: options.mineId, shipUuid: ship.uuid, crewUuid, combat })
            : changeDrone(
                data,
                op,
                { stationId, id: options.droneId },
                {
                  definition: Content.stations.get("drone-console"),
                  droneTypes: Content.drones,
                  worldTime: game.time?.worldTime,
                  combat: activeStarshipCombat()
                }
              );
        const record = data.drones.find((d) => d?.id === options.droneId && d?.stationId === stationId);
        stationName = station.name;
        droneName = ct(Content.drones.find((d) => d.id === record?.ref)?.name ?? record?.ref ?? "");
        return updated;
      } catch (err) {
        const allowed = ["station", "legacy", "invalid", "capacity", "cooldown", "mineZone", "mineRound", "mineMap", "mineOldMap"];
        throw new Error(T(`SF2eTSC.droneControl.errors.${allowed.includes(err.message) ? err.message : "invalid"}`), { cause: err });
      }
    },
    { reason: T(`SF2eTSC.actions.${action.id}`), announce: false, undoable: true }
  );
  // Повторный запрос не создаёт карточку, историю или запись в журнале боя.
  if (!changed) return { ok: true, changed: false };
  try {
    await postActionCard({
      actor: ship,
      action,
      crewName: crew.name,
      stationName,
      lines: [
        { label: T("SF2eTSC.droneControl.type"), value: droneName },
        { label: T("SF2eTSC.droneControl.cost"), value: T("SF2eTSC.droneControl.oneAction") }
      ]
    });
  } catch (err) {
    log.error("Drone action was saved, but its action card failed", err);
    ui.notifications?.warn?.(T("SF2eTSC.droneControl.errors.cardFailed"));
  }
  return { ok: true, changed: true };
}

/** Размещение не создаёт взрыв и не воздействует на другие корабли. */
export function deployMine(data, { stationId, droneId, mineId, shipUuid, crewUuid, combat }) {
  if (!combat?.id || !Number.isInteger(combat.round) || combat.round < 1) throw new Error("mineMap");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(mineId ?? "")) throw new Error("invalid");
  if (!Array.isArray(data.drones)) throw new Error("legacy");
  const matches = data.drones.filter((d) => d?.id === droneId);
  if (matches.length !== 1) throw new Error("legacy");
  const drone = matches[0];
  if (drone.stationId !== stationId || drone.tscVersion !== 1 || drone.ref !== "pyrotechnics-drone" || drone.deployed !== true)
    throw new Error("legacy");
  if (drone.mines != null && !Array.isArray(drone.mines)) throw new Error("legacy");
  const mines = drone.mines ?? [];
  const oldMatches = data.drones.flatMap((d) => (Array.isArray(d?.mines) ? d.mines : [])).filter((m) => m?.id === mineId);
  if (oldMatches.length > 1) throw new Error("legacy");
  const old = oldMatches[0];
  if (old) {
    if (old.droneId === droneId && old.shipUuid === shipUuid && old.operatorUuid === crewUuid) return false;
    throw new Error("invalid");
  }
  const obj = findObject(getTsc(combat), shipUuid);
  if (!obj || !Number.isInteger(obj.zone)) throw new Error("mineMap");
  if (mines.some((m) => m?.state === "armed" && m.combatId !== combat.id)) throw new Error("mineOldMap");
  if (mines.some((m) => m?.zone === obj.zone && m.state === "armed")) throw new Error("mineZone");
  if (data.droneMineFrequency != null && (typeof data.droneMineFrequency !== "object" || Array.isArray(data.droneMineFrequency)))
    throw new Error("legacy");
  const key = `${stationId}:deploy-starship-mine`;
  const last = data.droneMineFrequency?.[key];
  if (last?.combatId === combat.id && last?.round === combat.round) throw new Error("mineRound");
  drone.mines = [...mines, { id: mineId, droneId, shipUuid, operatorUuid: crewUuid, combatId: combat.id, zone: obj.zone, state: "armed" }];
  data.droneMineFrequency = { ...(data.droneMineFrequency ?? {}), [key]: { combatId: combat.id, round: combat.round } };
  return true;
}
