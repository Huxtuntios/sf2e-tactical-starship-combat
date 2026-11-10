import { readStarship, isPlayerStarship } from "../starship/starship-state.mjs";

/**
 * Permission layer on top of Foundry ownership (players don't need to own the ship actor).
 * adjustVitals (crew, captain, owner, GM): change current Hull / Shield Points, apply damage or repairs and flip off-kilter
 * by hand, so the table never has to wait for the GM to track its own ship. Maximums and every other state flag stay
 * with configureShip / the GM.
 */
const ALL = ["viewShip", "operateStation", "moveShip", "assignCrew", "adjustVitals", "configureShip", "editEquipment", "gmOverride"];
const BY_ROLE = {
  captain: ["viewShip", "operateStation", "moveShip", "assignCrew", "adjustVitals"],
  crew: ["viewShip", "operateStation", "moveShip", "adjustVitals"],
  observer: ["viewShip"]
};

/** Crew entries of the ship that this user controls. */
export function crewOfUser(user, data) {
  return data.crew.filter((c) => {
    const actor = fromUuidSync(c.actorUuid);
    return (c.userId && c.userId === user.id) || actor?.testUserPermission?.(user, "OWNER");
  });
}
export function permissionsFor(user, actor) {
  if (user.isGM) return new Set(ALL);
  const data = readStarship(actor);
  const set = new Set();
  if (actor.testUserPermission?.(user, "OWNER"))
    ["viewShip", "operateStation", "moveShip", "assignCrew", "adjustVitals", "editEquipment", "configureShip"].forEach((p) => set.add(p));
  else if (actor.testUserPermission?.(user, "OBSERVER")) set.add("viewShip");
  for (const c of crewOfUser(user, data)) for (const p of BY_ROLE[c.role] ?? []) set.add(p);
  return set;
}
export const can = (user, actor, permission) => permissionsFor(user, actor).has(permission);
export function roleOf(user, actor) {
  if (user.isGM) return "gm";
  const entries = crewOfUser(user, readStarship(actor));
  if (entries.some((c) => c.role === "captain")) return "captain";
  if (entries.some((c) => c.role === "crew")) return "crew";
  return entries.length ? "observer" : actor.testUserPermission?.(user, "OBSERVER") ? "observer" : "none";
}
/**
 * may this user put one of their own characters aboard `ship` (addCrew / first claimStation)?
 * Controlling the character is not enough — the user also needs access to the ship:
 *  - GM, ship owner or a user with assignCrew (captain) on the ship: always;
 *  - otherwise only on a *player* starship the GM shared with them (Observer or better).
 * NPC / enemy / neutral ships are never joinable without GM, ownership or assignCrew.
 */
export function canJoinShip(user, ship) {
  if (!user || !ship) return false;
  if (user.isGM) return true;
  if (ship.testUserPermission?.(user, "OWNER")) return true;
  if (can(user, ship, "assignCrew")) return true;
  return isPlayerStarship(ship) && !!ship.testUserPermission?.(user, "OBSERVER");
}
export function canControlCrewActor(user, crewActor) {
  return user.isGM || !!crewActor?.testUserPermission?.(user, "OWNER");
}
