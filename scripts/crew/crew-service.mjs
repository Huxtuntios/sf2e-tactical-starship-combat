import { HOOK_EVENTS } from "../constants.mjs";
import { patchStarship, readStarship, stationOf, activeCrew, loadStarship } from "../starship/starship-state.mjs";
import { registerHandler, request } from "../socket.mjs";
import { canControlCrewActor, can, canJoinShip } from "./permissions.mjs";
import { fromUuidSafe, T } from "../utils/foundry.mjs";
import { postSimpleCard } from "../chat/chat-cards.mjs";
import { randomId } from "../utils/ids.mjs";
import { CREW_ROLES } from "../constants.mjs";
import { assignStation, releaseStationIn, normalizeCrewAssignments } from "../engine/crew-assignments.mjs";
import { sanitizeNewStation } from "../engine/validation.mjs";

/**
 * Role / linked user a requester may set on a crew entry. Only a GM or a user with assignCrew on the ship may grant
 * "captain" or link another user; a player adding their own character always joins as plain "crew" linked to themself.
 */
export function crewEntryGrant(user, { canAssign, role, userId }) {
  const wanted = CREW_ROLES.includes(role) ? role : "crew";
  if (user?.isGM) return { role: wanted, userId: typeof userId === "string" && userId ? userId : null };
  if (canAssign) return { role: wanted, userId: userId === user?.id || userId == null ? (userId ?? null) : null };
  return { role: wanted === "observer" ? "observer" : "crew", userId: user?.id ?? null };
}

/** only starship actors are accepted — crew/station data is never written onto a PC, NPC or vehicle. */
const shipFrom = (uuid) => loadStarship(uuid);

/**
 * May `user` add `crewActor` to `ship`? GM / assignCrew may add anyone; otherwise the user must control the
 * character AND have access to the ship (canJoinShip). Exported for regression tests.
 */
export function canAddCrew(user, ship, crewActor) {
  if (user?.isGM || can(user, ship, "assignCrew")) return true;
  return canControlCrewActor(user, crewActor) && canJoinShip(user, ship);
}
/**
 * May `user` move `crewActor` onto a station of `ship`? Forced claims (evicting an occupant) need GM / assignCrew.
 * A normal claim needs either an existing crew entry the user controls (owns the character or is linked to the
 * entry), or — when the claim would add a new crew entry — the same access as addCrew.
 */
export function canClaimStation(user, ship, crewActor, { force = false } = {}) {
  if (user?.isGM || can(user, ship, "assignCrew")) return true;
  if (force) return false;
  const entry = readStarship(ship).crew.find((c) => c.actorUuid === crewActor?.uuid);
  if (entry) return canControlCrewActor(user, crewActor) || (!!entry.userId && entry.userId === user?.id);
  return canAddCrew(user, ship, crewActor);
}

/* ------------------------------------------------------------------ GM-side authoritative handlers */
async function addCrew({ user, payload }) {
  const ship = await shipFrom(payload.shipUuid);
  const crewActor = await fromUuidSafe(payload.crewUuid);
  if (!crewActor) throw new Error(T("SF2eTSC.errors.actorNotFound"));
  if (!canAddCrew(user, ship, crewActor)) throw new Error(T("SF2eTSC.errors.noPermission"));
  if (crewActor.uuid === ship.uuid) throw new Error(T("SF2eTSC.errors.invalidData"));
  const data = readStarship(ship);
  if (data.crew.some((c) => c.actorUuid === crewActor.uuid)) return true;
  if (data.crew.length >= 6 && !user.isGM) throw new Error(T("SF2eTSC.errors.crewFull"));
  const grant = crewEntryGrant(user, { canAssign: can(user, ship, "assignCrew"), role: payload.role, userId: payload.userId });
  await patchStarship(ship, (d) => {
    d.crew.push({ actorUuid: crewActor.uuid, name: crewActor.name, userId: grant.userId, role: grant.role, stationId: null, ready: false });
  });
  Hooks.callAll(HOOK_EVENTS.crewChanged, ship, crewActor);
  return true;
}
async function removeCrew({ user, payload }) {
  const ship = await shipFrom(payload.shipUuid);
  if (!user.isGM && !can(user, ship, "assignCrew")) throw new Error(T("SF2eTSC.errors.noPermission"));
  await patchStarship(ship, (d) => {
    d.crew = d.crew.filter((c) => c.actorUuid !== payload.crewUuid);
    normalizeCrewAssignments(d); // clears the station the removed member was helming
  });
  Hooks.callAll(HOOK_EVENTS.crewChanged, ship, null);
  return true;
}
async function setCrewRole({ user, payload }) {
  const ship = await shipFrom(payload.shipUuid);
  if (!user.isGM && !can(user, ship, "assignCrew")) throw new Error(T("SF2eTSC.errors.noPermission"));
  if (!CREW_ROLES.includes(payload.role)) throw new Error(T("SF2eTSC.errors.invalidData"));
  await patchStarship(ship, (d) => {
    const c = d.crew.find((x) => x.actorUuid === payload.crewUuid);
    if (c) c.role = payload.role;
  });
  Hooks.callAll(HOOK_EVENTS.crewChanged, ship, null);
  return true;
}
async function claimStation({ user, payload }) {
  const ship = await shipFrom(payload.shipUuid);
  const crewActor = await fromUuidSafe(payload.crewUuid);
  if (!crewActor) throw new Error(T("SF2eTSC.errors.actorNotFound"));
  const force = !!payload.force;
  // the player assigned to a crew entry may move it to a free station even without owning the actor
  // a claim that would create a new crew entry also needs access to the ship (see canClaimStation)
  if (!canClaimStation(user, ship, crewActor, { force })) throw new Error(T("SF2eTSC.errors.noPermission"));
  const data = readStarship(ship);
  const station = stationOf(data, payload.stationId);
  if (!station) throw new Error(T("SF2eTSC.errors.stationNotFound"));
  if (station.helmedBy && station.helmedBy !== crewActor.uuid && !force) {
    const other = data.crew.find((c) => c.actorUuid === station.helmedBy);
    throw new Error(T("SF2eTSC.crew.claimedBy", { name: other?.name ?? "?" }));
  }
  await patchStarship(ship, (d) => {
    let entry = d.crew.find((c) => c.actorUuid === crewActor.uuid);
    if (!entry) {
      entry = {
        actorUuid: crewActor.uuid,
        name: crewActor.name,
        userId: user.isGM ? null : user.id,
        role: "crew",
        stationId: null,
        ready: false
      };
      d.crew.push(entry);
    }
    // one station per crew member, one member per station: a forced claim evicts the previous occupant
    assignStation(d, crewActor.uuid, payload.stationId);
  });
  Hooks.callAll(HOOK_EVENTS.stationClaimed, ship, payload.stationId, crewActor);
  if (!payload.silent)
    await postSimpleCard({
      actor: ship,
      title: T("SF2eTSC.crew.helm"),
      body: T("SF2eTSC.crew.helmedMsg", { name: crewActor.name, station: station.name })
    });
  return true;
}
async function releaseStation({ user, payload }) {
  const ship = await shipFrom(payload.shipUuid);
  const data = readStarship(ship);
  const station = payload.stationId ? stationOf(data, payload.stationId) : data.stations.find((s) => s.helmedBy === payload.crewUuid);
  if (!station) return false;
  const crewActor = await fromUuidSafe(station.helmedBy);
  if (!(user.isGM || can(user, ship, "assignCrew") || (crewActor && canControlCrewActor(user, crewActor))))
    throw new Error(T("SF2eTSC.errors.noPermission"));
  await patchStarship(ship, (d) => {
    releaseStationIn(d, station.id);
  });
  Hooks.callAll(HOOK_EVENTS.crewChanged, ship, null);
  return true;
}
async function setReady({ user, payload }) {
  const ship = await shipFrom(payload.shipUuid);
  const crewActor = await fromUuidSafe(payload.crewUuid);
  if (!(user.isGM || (crewActor && canControlCrewActor(user, crewActor)))) throw new Error(T("SF2eTSC.errors.noPermission"));
  await patchStarship(ship, (d) => {
    const c = d.crew.find((x) => x.actorUuid === payload.crewUuid);
    if (c) c.ready = !!payload.ready;
  });
  return true;
}
async function addStation({ user, payload }) {
  const ship = await shipFrom(payload.shipUuid);
  if (!(user.isGM || can(user, ship, "configureShip"))) throw new Error(T("SF2eTSC.errors.noPermission"));
  // validated config only; helmedBy/ready/malfunction state cannot be injected through addStation
  const station = sanitizeNewStation(payload.station, randomId("station"));
  await patchStarship(ship, (d) => {
    if (d.stations.some((s) => s.id === station.id)) throw new Error(T("SF2eTSC.errors.invalidData"));
    if (d.stations.length >= 50) throw new Error(T("SF2eTSC.errors.invalidData"));
    d.stations.push(station);
  });
  return true;
}

/** GM repair: rewrite every starship with consistent crew/station data. Returns the list of repaired ships. */
export async function repairAllCrewAssignments() {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  const { allStarships } = await import("../starship/starship-state.mjs");
  const fixed = [];
  for (const ship of allStarships()) {
    const raw = ship.flags?.["sf2e-tactical-starship-combat"]?.starship;
    if (!raw) continue;
    const probe = normalizeCrewAssignments(foundry.utils.deepClone({ crew: raw.crew ?? [], stations: raw.stations ?? [] }));
    if (!probe.repairs.length) continue;
    await patchStarship(ship, () => {}); // readStarship already normalizes; the write persists it
    fixed.push({ name: ship.name, repairs: probe.repairs });
  }
  return fixed;
}
async function repairCrew({ user }) {
  if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  return repairAllCrewAssignments();
}

export function registerCrewHandlers() {
  registerHandler("repairCrewAssignments", repairCrew);
  registerHandler("addCrew", addCrew);
  registerHandler("removeCrew", removeCrew);
  registerHandler("setCrewRole", setCrewRole);
  registerHandler("claimStation", claimStation);
  registerHandler("releaseStation", releaseStation);
  registerHandler("setReady", setReady);
  registerHandler("addStation", addStation);
}

/* ------------------------------------------------------------------ client API */
export const Crew = {
  add: (shipUuid, crewUuid, role = "crew", userId = null) => request("addCrew", { shipUuid, crewUuid, role, userId }),
  remove: (shipUuid, crewUuid) => request("removeCrew", { shipUuid, crewUuid }),
  setRole: (shipUuid, crewUuid, role) => request("setCrewRole", { shipUuid, crewUuid, role }),
  claim: (shipUuid, stationId, crewUuid, force = false) => request("claimStation", { shipUuid, stationId, crewUuid, force }),
  release: (shipUuid, stationId, crewUuid) => request("releaseStation", { shipUuid, stationId, crewUuid }),
  setReady: (shipUuid, crewUuid, ready) => request("setReady", { shipUuid, crewUuid, ready }),
  addStation: (shipUuid, station) => request("addStation", { shipUuid, station })
};
export { activeCrew };
