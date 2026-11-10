import { snapshot } from "../history/history.mjs";
import { T } from "../utils/foundry.mjs";

/** Stage a base Drone Block inside the target ship's damage draft. Never works as an unbound standalone action. */
export async function stageDroneBlock({ draft, targetUuid, stationId, crew, droneId, strikeId, worldTime }) {
  if (!strikeId || !Number.isFinite(worldTime)) throw new Error(T("SF2eTSC.droneBlock.invalid"));
  const entry = await draft.ship(targetUuid);
  const data = entry.data;
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
  // Protocol changes the basic return/cooldown rule; don't silently apply the wrong version.
  if ((data.upgrades ?? []).some((u) => u.ref === "drone-shield-protocol" && u.stationId === stationId))
    throw new Error(T("SF2eTSC.droneBlock.protocolManual"));
  if (data.droneBlockReceipts != null && !Array.isArray(data.droneBlockReceipts)) throw new Error(T("SF2eTSC.droneBlock.invalid"));
  if ((data.droneBlockReceipts ?? []).some((r) => r?.strikeId === strikeId)) throw new Error(T("SF2eTSC.droneBlock.repeated"));
  // Compare against persisted target state in the GM's per-actor queue before the one Actor.update.
  entry.writeOptions = { ...(entry.writeOptions ?? {}), expected: snapshot(entry.before) };
  drone.deployed = false;
  drone.availableAt = worldTime + 600;
  data.droneBlockReceipts = [...(data.droneBlockReceipts ?? []), { strikeId, droneId, stationId, crewUuid: crew.uuid }];
  return Math.floor(level / 2);
}
