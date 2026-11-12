import { snapshot } from "../history/history.mjs";
import { T, fromUuidSafe } from "../utils/foundry.mjs";
import { randomId } from "../utils/ids.mjs";
import { updateProtocolDrone } from "./protocol-manual.mjs";
import { patchStarship } from "../starship/starship-state.mjs";
import { Content } from "../content/loader.mjs";
import { ct } from "../content/content-i18n.mjs";
import { can } from "../crew/permissions.mjs";
import { postActionCard } from "../chat/chat-cards.mjs";
import { log } from "../utils/logging.mjs";

function selectedDrone(data, stationId, crew, droneId) {
  const stations = data.stations.filter((s) => s?.id === stationId);
  const drones = Array.isArray(data.drones) ? data.drones.filter((d) => d?.id === droneId) : [];
  const station = stations.length === 1 && stations[0].type === "drone-console" && stations[0].helmedBy === crew?.uuid ? stations[0] : null;
  const drone =
    drones.length === 1 && drones[0].stationId === stationId && drones[0].tscVersion === 1 && drones[0].deployed === true
      ? drones[0]
      : null;
  const level = crew?.system?.details?.level?.value ?? crew?.level;
  if (!station || station.malfunctioning || data.destroyed || !drone || !Number.isInteger(level) || level < 1)
    throw new Error(T("SF2eTSC.droneBlock.invalid"));
  return { drone, level };
}

function ensureStrikeUnused(data, strikeId) {
  const receipts = data.droneBlockReceipts;
  if (receipts != null && !Array.isArray(receipts)) throw new Error(T("SF2eTSC.droneBlock.invalid"));
  if ((receipts ?? []).some((receipt) => receipt?.strikeId === strikeId)) throw new Error(T("SF2eTSC.droneBlock.repeated"));
}

function appendReceipt(entry, data, field, receipt) {
  entry.writeOptions = { ...(entry.writeOptions ?? {}), expected: snapshot(entry.before) };
  data[field] = [...(data[field] ?? []), receipt];
}

/** Stage a base Drone Block inside the target ship's damage draft. Never works as an unbound standalone action. */
export async function stageDroneBlock({ draft, targetUuid, stationId, crew, droneId, strikeId, worldTime }) {
  if (!strikeId || !Number.isFinite(worldTime)) throw new Error(T("SF2eTSC.droneBlock.invalid"));
  const entry = await draft.ship(targetUuid);
  const data = entry.data;
  const { drone, level } = selectedDrone(data, stationId, crew, droneId);
  // Protocol changes the basic return/cooldown rule; don't silently apply the wrong version.
  if ((data.upgrades ?? []).some((u) => u.ref === "drone-shield-protocol" && u.stationId === stationId))
    throw new Error(T("SF2eTSC.droneBlock.protocolManual"));
  ensureStrikeUnused(data, strikeId);
  // Compare against persisted target state in the GM's per-actor queue before the one Actor.update.
  drone.deployed = false;
  drone.availableAt = worldTime + 600;
  appendReceipt(entry, data, "droneBlockReceipts", { strikeId, droneId, stationId, crewUuid: crew.uuid });
  return Math.floor(level / 2);
}

/** Record the confirmed manual block in the existing protocol ledger, without applying the base return or cooldown. */
export async function stageDroneShieldProtocolBlock({ draft, targetUuid, stationId, crew, droneId, strikeId, combat }) {
  if (!strikeId || !combat?.id) throw new Error(T("SF2eTSC.droneBlock.invalid"));
  const entry = await draft.ship(targetUuid);
  const data = entry.data;
  const { level } = selectedDrone(data, stationId, crew, droneId);
  if (!(data.upgrades ?? []).some((upgrade) => upgrade.ref === "drone-shield-protocol" && upgrade.stationId === stationId))
    throw new Error(T("SF2eTSC.droneBlock.invalid"));
  const changed = updateProtocolDrone(data, {
    stationId,
    droneId,
    operatorUuid: crew.uuid,
    operationId: randomId("drone-protocol"),
    op: "block",
    strikeRef: strikeId,
    combat,
    confirmed: true
  });
  if (!changed) throw new Error(T("SF2eTSC.droneBlock.repeated"));
  entry.writeOptions = { ...(entry.writeOptions ?? {}), expected: snapshot(entry.before) };
  return Math.floor(level / 2);
}

/**
 * Soft Drone Block from the sheet/HUD, outside a Strike: the operator (or GM) confirms on their own client,
 * the GM then returns the drone, starts the 10-minute cooldown and records a receipt. Resistance is reported
 * for the GM to apply against the triggering Strike; nothing is spent and no damage is applied here.
 */
export async function executeDroneBlockSoft({ user, ship, crewUuid, stationId, options, action }) {
  const crew = await fromUuidSafe(crewUuid);
  if (!crew || (!user.isGM && !crew.testUserPermission?.(user, "OWNER"))) throw new Error(T("SF2eTSC.errors.noPermission"));
  let resistance = 0;
  let droneName = "";
  let stationName = "";
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
      if ((data.upgrades ?? []).some((u) => u.ref === "drone-shield-protocol" && u.stationId === stationId))
        throw new Error(T("SF2eTSC.droneBlock.protocolManual"));
      const drones = (Array.isArray(data.drones) ? data.drones : []).filter((d) => d?.id === options.droneId);
      const drone =
        drones.length === 1 && drones[0].stationId === stationId && drones[0].tscVersion === 1 && drones[0].deployed === true
          ? drones[0]
          : null;
      const level = crew?.system?.details?.level?.value ?? crew?.level;
      if (!drone || !Number.isInteger(level) || level < 1) throw new Error(T("SF2eTSC.droneBlock.invalid"));
      resistance = Math.floor(level / 2);
      drone.deployed = false;
      drone.availableAt = (game.time?.worldTime ?? 0) + 600;
      data.droneBlockReceipts = [
        ...(data.droneBlockReceipts ?? []),
        { strikeId: `manual-${randomId(10)}`, droneId: drone.id, stationId, crewUuid, manual: true }
      ];
      stationName = station.name;
      droneName = ct(Content.drones.find((t) => t.id === drone.ref)?.name ?? drone.ref ?? "");
      return true;
    },
    { reason: T("SF2eTSC.actions.drone-block"), announce: false, undoable: false }
  );
  if (!changed) return { ok: true, changed: false };
  try {
    await postActionCard({
      actor: ship,
      action,
      crewName: crew.name,
      stationName,
      lines: [
        { label: T("SF2eTSC.droneControl.type"), value: droneName },
        { label: T("SF2eTSC.droneBlock.softResistance"), value: String(resistance) }
      ]
    });
  } catch (err) {
    log.error("Drone Block was saved, but its action card failed", err);
    ui.notifications?.warn?.(T("SF2eTSC.droneControl.errors.cardFailed"));
  }
  return { ok: true, changed: true, resistance };
}
